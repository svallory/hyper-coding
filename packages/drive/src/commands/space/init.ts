import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Args, Flags } from "@oclif/core";
import { ConfigError, configPath, loadConfig } from "#config/index";
import {
	isValidSpaceName,
	ManifestError,
	type SpaceEntry,
	type SpaceRepo,
	type SyncCadence,
} from "#config/schema";
import { BaseCommand, type BaseFlags } from "#lib/base-command";
import { findSecretPaths, renderGitignore } from "#services/allowlist";
import {
	driveCheckoutDir,
	ensureDriveCheckout,
	readManifest,
	upsertSpace,
} from "#services/manifest";
import { detectSpace } from "#services/space";
import {
	hasSpaceGit,
	initSpaceGitDir,
	projectRepoInfo,
	readCadence,
	readSpaceConfig,
	removeSpaceGitDir,
	SpaceGitError,
	spaceGit,
	spaceGitDir,
	writeCadence,
} from "#services/space-git";

/**
 * `hyper space init` — put a hyper space under the hyperdrive.
 *
 * The wiring lives here; every block already exists (T-2 detection, T-3 the
 * space git dir and the allowlist, T-4 the manifest). What this command adds
 * is the ORDER and the refusals, and they are the whole job:
 *
 *   1. detect the space and refuse anything that is not one;
 *   2. refuse a name or group the manifest could never hold (T-4's rule);
 *   3. make sure the hyperdrive checkout exists (T-4) BEFORE touching the
 *      space, so an unreachable remote cannot leave a git dir behind;
 *   4. refuse an already-initialised space unless `--refresh`, and refuse a
 *      refresh that computes a different branch or remote — `initSpaceGitDir`
 *      is a silent no-op on those, which used to look like success;
 *   5. create the git dir, then run the ref-clash check through it (AC-7) —
 *      `space/x` and `space/x/y` cannot both exist, because the second one is
 *      ambiguous to every later `space commit` / `space pull`;
 *   6. render the allowlist, resolve the cadence (C-11: the git dir's config
 *      is the truth), stage, refuse secrets (C-7), commit, push — never force;
 *   7. upsert the manifest entry.
 *
 * C-3: nothing here ever writes inside `<root>/.git`. The project's own repo is
 * read (its `remote.origin.url` and default branch, for the manifest) and
 * never touched — see `projectRepoInfo`.
 */

/** The cadences a `--cadence` flag may name (C-11). */
const CADENCES = ["manual", "session-end", "session-end+push"] as const;

function nameProblem(value: string, flag: "--name" | "--group"): Error {
	return new Error(
		`${JSON.stringify(value)} isn't a space name: a name is lowercase letters, digits, dots, ` +
			`underscores and dashes, starting with a letter or digit, and never containing "..". ` +
			`Names are also path segments and half a branch name, so they have to be boring by ` +
			`construction. Pass a different ${flag}.`,
	);
}

/**
 * The first ref on the remote matching one `ls-remote` pattern, or null.
 *
 * Runs through the space's own git dir (C-2) — `git ls-remote` against the
 * remote URL needs no work tree, so the dir it runs through does not matter
 * for correctness, only for keeping every space-shaped git call in one module.
 */
function remoteRef(root: string, remote: string, pattern: string): string | null {
	const { stdout } = spaceGit(root, ["ls-remote", "--heads", remote, pattern]);
	for (const line of stdout.split("\n")) {
		const ref = line.split("\t")[1]?.trim();
		if (ref !== undefined && ref !== "") return ref;
	}
	return null;
}

/**
 * The refs on the remote that would collide with the branch about to be made,
 * as `ls-remote` patterns.
 *
 * A space is `space/<name>`, a grouped space is `space/<group>/<name>`. Both
 * spellings therefore clash: `space/x` cannot also be the group holding
 * `space/x/y`, and `space/g` cannot be both a space and a group.
 */
function clashPatterns(name: string, group: string | null): string[] {
	return group === null
		? [`refs/heads/space/${name}`, `refs/heads/space/${name}/*`]
		: [`refs/heads/space/${group}`];
}

/** The first colliding ref on the remote, or `null`. */
function refClash(root: string, remote: string, name: string, group: string | null): string | null {
	for (const pattern of clashPatterns(name, group)) {
		const ref = remoteRef(root, remote, pattern);
		if (ref !== null) return ref;
	}
	return null;
}

/**
 * Why a colliding ref cannot be used, said as the two ways out: another group,
 * or another name. Both spellings of the clash are the same problem — `space/x`
 * would be both a space and the group holding other spaces — so they read the
 * same way round.
 */
function clashError(clash: string, name: string, group: string | null): SpaceGitError {
	if (group === null) {
		return new SpaceGitError(
			`your hyperdrive already has ${clash}. A space called ${JSON.stringify(name)} cannot ` +
				`also be the group that holds other spaces — pass \`--group\` to place this space under ` +
				`one, or \`--name\` to give it its own.`,
		);
	}
	return new SpaceGitError(
		`your hyperdrive already has ${clash}, which is a space called ${JSON.stringify(group)}. A ` +
			`space cannot live under another space — pass \`--group\` with a different group, or ` +
			`\`--name\` to rename this space.`,
	);
}

/**
 * Refuse a `--refresh` that would silently do nothing: `initSpaceGitDir` is a
 * no-op on an existing git dir, so a space sitting on another branch or
 * another hyperdrive would be reported as refreshed while nothing about it
 * changed. A space keeps one branch and one remote for its life.
 */
function assertExistingSpaceMatches(root: string, branch: string, remote: string): void {
	const { status, stdout } = spaceGit(root, ["symbolic-ref", "-q", "HEAD"], { allowFailure: true });
	const head = status === 0 ? stdout.trim() : "";
	if (head !== `refs/heads/${branch}`) {
		throw new SpaceGitError(
			`${spaceGitDir(root)} is on ${head === "" ? "a detached HEAD" : head}, but this run would ` +
				`use ${branch}. A space keeps one branch for its life — pass the --name/--group you meant, ` +
				`or register this space on the hyperdrive under a name of its own.`,
		);
	}
	const origin = readSpaceConfig(root, "remote.origin.url");
	if (origin !== remote) {
		throw new SpaceGitError(
			`${spaceGitDir(root)} is a clone of ${JSON.stringify(origin)}, but your drive.toml points at ` +
				`${JSON.stringify(remote)}. A space's history lives on one hyperdrive — fix \`remote\`, or ` +
				`move this space onto the new hyperdrive.`,
		);
	}
}

/**
 * Render the tracked `.gitignore`, writing it only when it differs: a
 * `--refresh` of an unchanged space must leave the file alone, or "nothing
 * changed" could never be true and every refresh would look like an edit.
 *
 * A `.gitignore` that is already there and differs is refused on a FIRST init
 * and overwritten on a refresh. The first case is a user's own ignore file —
 * silently replacing it would change what a tool they configured ignores,
 * including what hyper would stage; a refresh is by definition hyper
 * re-rendering its own allowlist, and the file at that point is hyper's.
 *
 * Returns whether this call wrote the file, so a later refusal can take it back
 * off disk.
 */
function writeAllowlist(root: string, tracked: string[], refreshed: boolean): boolean {
	const gitignore = renderGitignore(tracked);
	const path = join(root, ".gitignore");
	if (!existsSync(path)) {
		writeFileSync(path, gitignore, "utf-8");
		return true;
	}
	const current = readFileSync(path, "utf-8");
	if (current === gitignore) return false;
	if (!refreshed) {
		throw new Error(
			`${path} already exists and isn't the allowlist hyper would write for this space. It is ` +
				`a tracked file, so hyper cannot commit its own version without either replacing yours or ` +
				`leaving the space's history and its ignore rules disagreeing. Move yours aside ` +
				`(e.g. \`mv ${path} .gitignore.pre-hyper\`), or delete it, and run this again.`,
		);
	}
	writeFileSync(path, gitignore, "utf-8");
	return true;
}

/**
 * What `--tracked` means for this run, against the space's registered list.
 *
 * A refresh with no `--tracked` KEEPS the manifest's list: re-rendering the
 * allowlist from an empty list would drop every tracked directory the space
 * was registered with, and the next file written under one of them would be
 * silently ignored. `--tracked` on a refresh ADDS to that list rather than
 * replacing it, because "track one more directory" is what a user passing it a
 * second time means, and replacing would need a flag to undo.
 *
 * On a first init there is no entry to keep, so the flag is the whole list.
 */
function resolveTracked(flags: string[] | undefined, registered: SpaceEntry | null): string[] {
	const fromFlags = flags ?? [];
	if (registered === null) return [...new Set(fromFlags)];
	const merged = [...registered.tracked];
	for (const entry of fromFlags) if (!merged.includes(entry)) merged.push(entry);
	return merged;
}

/**
 * The commit a remote ref points at, or null when the ref is not there.
 *
 * Read from the remote itself, NOT from `refs/remotes/origin/…`: a space git
 * dir is built by hand (`git init --bare` plus config flips) and never fetches,
 * so its remote-tracking ref can be missing even straight after a successful
 * push. Asking the remote is one `ls-remote` more and it is the only answer to
 * "what does the hyperdrive actually have".
 */
function remoteSha(root: string, remote: string, branch: string): string | null {
	const { stdout } = spaceGit(root, ["ls-remote", remote, `refs/heads/${branch}`]);
	const first = stdout.split("\n")[0] ?? "";
	return first.trim() === "" ? null : (first.split("\t")[0] ?? "").trim();
}

/** The project repositories of a space, as the manifest records them. */
function spaceReposOf(
	root: string,
	layout: "bare" | "multi",
	slugs: string[],
	warn: boolean,
): SpaceRepo[] {
	const repos: SpaceRepo[] = [];
	const missing: string[] = [];
	const add = (slug: string | undefined) => {
		const info = projectRepoInfo(
			slug === undefined ? join(root, ".git") : join(root, "code", slug, ".git"),
		);
		if (info === null) {
			missing.push(slug ?? root);
			return;
		}
		const repo: SpaceRepo = { url: info.url, default_branch: info.defaultBranch };
		repos.push(slug === undefined ? repo : { ...repo, slug });
	};
	if (layout === "bare") add(undefined);
	else for (const slug of slugs) add(slug);

	// A repo with no `remote.origin.url` has nothing truthful to record. Warn
	// rather than invent a URL; `hyper space status` can offer a refresh once
	// the repo has one (design.md, "Known gaps"). Warned once per init, not on
	// every refresh: a space whose repos have no origin is a standing condition,
	// and a line on stderr of every command makes the real warnings unreadable.
	if (missing.length > 0 && warn) {
		process.stderr.write(
			`warning: no remote.origin.url for ${missing.join(", ")} — not recorded in the manifest.\n`,
		);
	}
	return repos;
}

export default class Init extends BaseCommand<typeof Init> {
	static override description = "Put this hyper space under your hyperdrive";

	static override examples = [
		"<%= config.bin %> space init",
		"<%= config.bin %> space init --group work --cadence session-end",
		"<%= config.bin %> space init --name research --tracked extra/",
		"<%= config.bin %> space init --refresh",
	];

	static override args = {
		dir: Args.string({
			description: "Directory inside the space (defaults to the current directory)",
			required: false,
		}),
	};

	static override flags = {
		...BaseCommand.baseFlags,
		name: Flags.string({ description: "Name for this space (defaults to the space directory)" }),
		group: Flags.string({ description: "Group this space under, as space/<group>/<name>" }),
		cadence: Flags.string({
			description: "When this space syncs to the hyperdrive",
			options: [...CADENCES],
		}),
		tracked: Flags.string({
			description:
				"Extra directory to track (repeatable); with --refresh, adds to the space's tracked list",
			multiple: true,
		}),
		refresh: Flags.boolean({
			description: "Re-render an already-initialised space instead of refusing",
			default: false,
		}),
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Init);
		try {
			const result = await this.initSpace(flags, args.dir);
			if (flags.json) {
				this.log(JSON.stringify(result, null, 2));
				return;
			}
			this.log(
				`Space:    ${result.name}${result.group === null ? "" : ` (group ${result.group})`}`,
			);
			this.log(`Layout:   ${result.layout}`);
			this.log(`Branch:   ${result.branch}`);
			this.log(`Remote:   ${result.remote}`);
			this.log(`Cadence:  ${result.cadence}`);
			this.log(
				result.unborn
					? "Committed: nothing — the allowlist matched no files in this space"
					: result.committed > 0
						? `Committed: ${result.committed} ${result.committed === 1 ? "file" : "files"}`
						: result.upToDate
							? "Committed: nothing — the space is already up to date"
							: "Committed: nothing new — pushed what the hyperdrive was missing",
			);
			this.log(
				`Manifest: ${result.refreshed ? "refreshed" : "registered"} (in ${driveCheckoutDir()})`,
			);
		} catch (err) {
			// Everything this command throws is a message meant for a person
			// (ConfigError, ManifestError, SpaceGitError, AllowlistError and its
			// own refusals all set `stack = message` or are re-wrapped here), so
			// the stack is dropped unless --debug asked for it.
			if (!(err instanceof Error)) throw err;
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}
	}

	/**
	 * The whole flow, returning the record the manifest ended up with plus the
	 * two facts only this run knows: how many files it committed and whether
	 * it refreshed an existing space.
	 */
	private async initSpace(
		flags: BaseFlags<typeof Init>,
		dirArg: string | undefined,
	): Promise<
		SpaceEntry & {
			committed: number;
			refreshed: boolean;
			remote: string;
			unborn: boolean;
			upToDate: boolean;
		}
	> {
		const dir = resolve(dirArg ?? process.cwd());
		if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
			throw new Error(`There's no directory at ${dir}.`);
		}

		const info = detectSpace(dir);
		if (info.root === null || info.layout === null) {
			throw new Error(
				`${dir} is not inside a hyper space — no bare or multi-repo space root above it. ` +
					`A space is a bare repo at its root with worktrees/, or a HYPER.md marker with bare repos under code/.`,
			);
		}
		const root = info.root;

		const defaultName = basename(root);
		const name = flags.name ?? defaultName;
		if (!isValidSpaceName(name)) {
			throw flags.name === undefined
				? new Error(
						`The space directory is called ${JSON.stringify(defaultName)}, which isn't a valid ` +
							`space name. A name is lowercase letters, digits, dots, underscores and dashes, ` +
							`starting with a letter or digit, and never containing "..". Pass \`--name\` with a ` +
							`name of your own.`,
					)
				: nameProblem(name, "--name");
		}
		const group = flags.group ?? null;
		if (group !== null && !isValidSpaceName(group)) throw nameProblem(group, "--group");
		const branch = group === null ? `space/${name}` : `space/${group}/${name}`;

		// The hyperdrive checkout comes BEFORE the space is touched: an
		// unreachable or mismatched remote must not leave a git dir behind for
		// a space that was never registered.
		const config = loadConfig();
		if (!config.remote) {
			throw new ConfigError(
				configPath(),
				"there's no `remote` yet — run `hyper drive init` first.",
			);
		}
		const remote = config.remote;
		ensureDriveCheckout(remote);

		const refreshed = hasSpaceGit(root);
		if (refreshed && !flags.refresh) {
			throw new Error(
				`${root} is already a hyper space — its history is at ${spaceGitDir(root)}. ` +
					`Pass \`--refresh\` to re-render its allowlist, re-apply its cadence and re-register it.`,
			);
		}
		// `initSpaceGitDir` is a silent no-op when the git dir is already there,
		// so a space whose branch or remote differs from this run would be
		// reported as initialised while sitting on the old answer.
		if (refreshed) assertExistingSpaceMatches(root, branch, remote);

		// The space's registered entry, which a refresh keeps rather than
		// replaces: the cadence it already has, and the tracked list it was
		// registered with. Read after the branch/remote comparison above, so
		// the entry looked up is this space's and not another one's.
		const registered = refreshed ? this.registeredEntry(name) : null;

		// Resolved BEFORE the git dir is created: with no flag, no default and
		// no TTY this refuses, and a refusal must not leave a space that looks
		// half-initialised. The only value it needs from the git dir is the
		// cadence an existing space already has, and that path only runs on a
		// refresh, where the dir is already there.
		const cadence = await this.resolveCadence(
			flags.cadence,
			config.defaults.cadence,
			root,
			refreshed,
		);

		// Created BEFORE the checks below, because both the ref-clash probe and
		// the secret guard have to run through it (C-2). A refusal removes the
		// dir it just created, so a failed init leaves the space exactly as it
		// found it.
		const created = initSpaceGitDir(root, { branch, remote });
		// The clash probe guards CREATING a ref. A space whose branch is not on
		// the remote yet is about to create one — a first init, a space whose
		// first push failed, or one whose allowlist was empty until now — so it
		// gets the probe too, not just a first init.
		if (remoteSha(root, remote, branch) === null) {
			try {
				const clash = refClash(root, remote, name, group);
				if (clash !== null) throw clashError(clash, name, group);
			} catch (err) {
				if (created.created) removeSpaceGitDir(root);
				throw err;
			}
		}

		const tracked = resolveTracked(flags.tracked, registered);

		// Everything from here on writes, so everything from here on shares one
		// cleanup: a refusal never leaves a staged secret, a half-written
		// allowlist or an unregistered git dir behind.
		let wroteGitignore = false;
		let committed = 0;
		let unborn = false;
		let upToDate = false;
		try {
			wroteGitignore = writeAllowlist(root, tracked, refreshed);

			// C-11: the git dir's config is the truth, so it is written before
			// the first commit — a branch pushed without its cadence would leave
			// the manifest recording a cadence nothing on the remote knows.
			writeCadence(root, cadence);

			const staged = this.firstCommit(root, name, branch, remote);
			committed = staged.committed;
			unborn = staged.unborn;
			upToDate = staged.upToDate;
		} catch (err) {
			// Unstage first: `initSpaceGitDir` is a no-op on a second run, so a
			// secret refusal on a refresh must not leave the index full of it.
			spaceGit(root, ["reset", "--quiet"], { allowFailure: true });
			// Only an allowlist THIS RUN created: on a refresh the file was
			// hyper's already, and a refusal to rewrite it changes nothing.
			if (wroteGitignore) rmSync(join(root, ".gitignore"), { force: true });
			// Only a git dir THIS RUN created: on a refresh the dir holds the
			// space's history, including a commit whose push failed — removing
			// it would throw away the very commit the next refresh must publish.
			if (created.created) removeSpaceGitDir(root);
			throw err;
		}

		const entry: SpaceEntry = {
			name,
			branch,
			group,
			path: realpathSync(root),
			layout: info.layout,
			repos: spaceReposOf(root, info.layout, info.repos, !refreshed),
			cadence,
			tracked,
			public: [],
		};
		try {
			upsertSpace(entry);
		} catch (err) {
			// The branch is already on the hyperdrive at this point, so saying
			// only "the manifest write failed" leaves the user thinking the space
			// was lost. It is not: the history is pushed, and a refresh is all
			// that is missing.
			throw new ManifestError(
				branch,
				`${branch} was committed and pushed to ${remote}, but registering it in the manifest ` +
					`failed: ${err instanceof Error ? err.message : String(err)} — the space itself is fine. ` +
					`Rerun \`hyper space init --refresh\` once the manifest can be written.`,
			);
		}
		return { ...entry, committed, refreshed, remote, unborn, upToDate };
	}

	/**
	 * The space's current manifest entry, or null when it has none (never
	 * registered, or registered under another name before a rename).
	 *
	 * A manifest that cannot be read is an error, not a null: falling back to
	 * "no entry" would quietly re-render the allowlist from an empty tracked
	 * list and drop the space's tracked directories, which is the one thing a
	 * refresh must never do.
	 */
	private registeredEntry(name: string): SpaceEntry | null {
		return readManifest().spaces.find((space) => space.name === name) ?? null;
	}

	/**
	 * Stage the allowlisted files, refuse anything the secret guard matches,
	 * commit `space: init <name>` and push the branch.
	 *
	 * The commit runs unsigned and with hooks off, like the manifest's
	 * bookkeeping commits: this commit is written by the CLI on the user's
	 * behalf, and a signer or a hook that is unavailable to (or hostile to)
	 * the CLI would otherwise strand the space between its git dir and the
	 * hyperdrive. Everything the user authors later (`hyper space commit`) is
	 * their own work and does respect their config.
	 *
	 * Returns how many files the commit carried, whether the space still has no
	 * commit at all, and whether the hyperdrive ended up exactly level with it.
	 *
	 * The push runs whenever HEAD exists, NOT only when this run committed
	 * something: a push that failed once (an offline moment, a remote hook that
	 * said no) leaves the commit sitting locally forever, because the next
	 * refresh sees an empty index and would call the space up to date. "Nothing
	 * staged" is not evidence that the hyperdrive has the space's history.
	 *
	 * An empty index is likewise not one thing: on a `--refresh` with nothing
	 * changed it means "already up to date", while on a space whose first run
	 * had nothing allowlisted it means there is no branch to push at all — and
	 * telling a user their space is empty when it is merely unchanged sends
	 * them looking for the wrong problem.
	 */
	private firstCommit(
		root: string,
		name: string,
		branch: string,
		remote: string,
	): {
		committed: number;
		unborn: boolean;
		upToDate: boolean;
	} {
		spaceGit(root, ["add", "-A"]);
		const staged = spaceGit(root, ["diff", "--cached", "--name-only"])
			.stdout.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");

		const secrets = findSecretPaths(staged);
		if (secrets.length > 0) {
			throw new Error(
				`refusing to commit ${branch}: ${secrets.join(", ")} ` +
					`${secrets.length === 1 ? "matches" : "match"} the secret guard (a .env, a key, a ` +
					`credentials file). Move ${secrets.length === 1 ? "it" : "them"} out of the space, or ` +
					`keep ${secrets.length === 1 ? "it" : "them"} out of the allowlist.`,
			);
		}

		const unborn =
			spaceGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status !== 0;
		if (staged.length > 0) {
			spaceGit(root, [
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				"commit",
				"-m",
				`space: init ${name}`,
			]);
		} else if (unborn) {
			process.stderr.write(
				`warning: the allowlist matched no files in ${root}, so there is nothing to commit and no branch to push.\n`,
			);
			return { committed: 0, unborn: true, upToDate: true };
		}

		// What the hyperdrive had BEFORE this push, which is the only thing that
		// can tell "nothing to publish" from "published what was missing". Asked
		// after the push it would always answer "level" — that is what the push
		// just made true — and a refused push would read as success.
		const head = spaceGit(root, ["rev-parse", "HEAD"], { allowFailure: true }).stdout.trim();
		const publishedBefore = remoteSha(root, remote, branch);
		// A plain push, never force: `--force-with-lease` is what would be able
		// to rewrite a space another machine has already pushed.
		spaceGit(root, ["push", "-u", "origin", branch]);
		return {
			committed: staged.length,
			unborn: false,
			upToDate: head !== "" && head === publishedBefore,
		};
	}

	/**
	 * When this space syncs, in order of authority: the flag, then — on a
	 * refresh — whatever the git dir already says, then `[defaults] cadence`
	 * from drive.toml, then a prompt on a TTY, then a refusal naming the flag.
	 *
	 * The space's OWN cadence outranks the machine-wide default, and it has to:
	 * `[defaults] cadence` is what a space is GIVEN when it is first created,
	 * and a machine whose default changed since then must not silently
	 * downgrade every space it refreshes (C-11: the git dir's config is the
	 * truth). Defaults fill in a space that has no cadence yet, which is every
	 * first init.
	 *
	 * The prompt is skipped whenever an answer is available, so a scripted run
	 * never stops for one.
	 */
	private async resolveCadence(
		flag: string | undefined,
		fromDefaults: SyncCadence,
		root: string,
		refreshed: boolean,
	): Promise<SyncCadence> {
		// oclif has already checked `--cadence` against `CADENCES`; the cast is
		// only about the flag's declared type being a plain string.
		if (flag !== undefined) return flag as SyncCadence;
		if (refreshed) {
			const existing = readCadence(root);
			if (existing !== "") return existing;
		}
		if (fromDefaults !== "") return fromDefaults;
		if (process.stdin.isTTY) {
			const answer = await p.select({
				message: "When should this space sync to your hyperdrive?",
				options: [
					{ value: "manual", label: "manual", hint: "only when I run hyper space push" },
					{ value: "session-end", label: "session-end", hint: "when an agent session ends" },
					{
						value: "session-end+push",
						label: "session-end+push",
						hint: "at session end, and pushed as well",
					},
				],
				initialValue: "manual",
			});
			if (p.isCancel(answer)) {
				p.cancel("Space setup cancelled.");
				throw new Error("space setup was cancelled — nothing was changed.");
			}
			return answer as SyncCadence;
		}
		throw new Error(
			"I need to know when this space syncs: pass `--cadence manual|session-end|session-end+push`, " +
				"or set `[defaults] cadence` in your drive.toml so every space can share it.",
		);
	}
}
