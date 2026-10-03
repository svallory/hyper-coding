import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Args, Flags } from "@oclif/core";
import { ConfigError, configPath, loadConfig } from "#config/index";
import {
	isValidSpaceName,
	type SpaceEntry,
	type SpaceRepo,
	type SyncCadence,
} from "#config/schema";
import { BaseCommand, type BaseFlags } from "#lib/base-command";
import { findSecretPaths, renderGitignore } from "#services/allowlist";
import { driveCheckoutDir, ensureDriveCheckout, upsertSpace } from "#services/manifest";
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

/**
 * The first colliding ref on the remote, or `null`.
 *
 * Runs through the space's own git dir (C-2) — `git ls-remote` against the
 * remote URL needs no work tree, so the dir it runs through does not matter
 * for correctness, only for keeping every space-shaped git call in one module.
 */
function refClash(root: string, remote: string, name: string, group: string | null): string | null {
	const { stdout } = spaceGit(root, [
		"ls-remote",
		"--heads",
		remote,
		...clashPatterns(name, group),
	]);
	for (const line of stdout.split("\n")) {
		const ref = line.split("\t")[1]?.trim();
		if (ref !== undefined && ref !== "") return ref;
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
 */
function writeAllowlist(root: string, tracked: string[]): void {
	const gitignore = renderGitignore(tracked);
	const path = join(root, ".gitignore");
	if (existsSync(path) && readFileSync(path, "utf-8") === gitignore) return;
	writeFileSync(path, gitignore, "utf-8");
}

/** The project repositories of a space, as the manifest records them. */
function spaceReposOf(root: string, layout: "bare" | "multi", slugs: string[]): SpaceRepo[] {
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
	// the repo has one (design.md, "Known gaps").
	if (missing.length > 0) {
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
			description: "Extra directory to track (repeatable)",
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
					: result.committed === 0
						? "Committed: nothing — the space is already up to date"
						: `Committed: ${result.committed} ${result.committed === 1 ? "file" : "files"}`,
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
		SpaceEntry & { committed: number; refreshed: boolean; remote: string; unborn: boolean }
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
		if (!refreshed) {
			try {
				const clash = refClash(root, remote, name, group);
				if (clash !== null) throw clashError(clash, name, group);
			} catch (err) {
				if (created.created) removeSpaceGitDir(root);
				throw err;
			}
		}

		const tracked = [...(flags.tracked ?? [])];

		writeAllowlist(root, tracked);

		// C-11: the git dir's config is the truth, so it is written before the
		// first commit — a branch pushed without its cadence would leave the
		// manifest recording a cadence nothing on the remote knows.
		writeCadence(root, cadence);

		// Everything past here can fail, so it shares one cleanup: a refusal
		// never leaves a staged secret or an unregistered git dir behind.
		let committed = 0;
		let unborn = false;
		try {
			const staged = this.firstCommit(root, name, branch);
			committed = staged.committed;
			unborn = staged.unborn;
		} catch (err) {
			// Unstage first: `initSpaceGitDir` is a no-op on a second run, so a
			// secret refusal on a refresh must not leave the index full of it.
			spaceGit(root, ["reset", "--quiet"], { allowFailure: true });
			if (created.created) removeSpaceGitDir(root);
			throw err;
		}

		const entry: SpaceEntry = {
			name,
			branch,
			group,
			path: realpathSync(root),
			layout: info.layout,
			repos: spaceReposOf(root, info.layout, info.repos),
			cadence,
			tracked,
			public: [],
		};
		upsertSpace(entry);
		return { ...entry, committed, refreshed, remote, unborn };
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
	 * Returns how many files the commit carried, and whether the space still
	 * has no commit at all. An empty index is not one thing: on a `--refresh`
	 * with nothing changed it means "already up to date", while on a space
	 * whose first run had nothing allowlisted it means there is no branch to
	 * push — and telling a user their space is empty when it is merely
	 * unchanged sends them looking for the wrong problem.
	 */
	private firstCommit(
		root: string,
		name: string,
		branch: string,
	): {
		committed: number;
		unborn: boolean;
	} {
		spaceGit(root, ["add", "-A"]);
		const staged = spaceGit(root, ["diff", "--cached", "--name-only"])
			.stdout.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");

		const secrets = findSecretPaths(staged);
		if (secrets.length > 0) {
			throw new Error(
				`refusing to make the first commit of ${branch}: ${secrets.join(", ")} ` +
					`${secrets.length === 1 ? "matches" : "match"} the secret guard (a .env, a key, a ` +
					`credentials file). Move ${secrets.length === 1 ? "it" : "them"} out of the space, or ` +
					`keep ${secrets.length === 1 ? "it" : "them"} out of the allowlist.`,
			);
		}

		if (staged.length === 0) {
			const unborn =
				spaceGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status !== 0;
			if (unborn) {
				process.stderr.write(
					`warning: the allowlist matched no files in ${root}, so there is nothing to commit and no branch to push.\n`,
				);
			}
			return { committed: 0, unborn };
		}

		spaceGit(root, [
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"-m",
			`space: init ${name}`,
		]);
		// A plain push, never force: this branch is new, and a force here would
		// be able to rewrite a space that another machine already pushed.
		spaceGit(root, ["push", "-u", "origin", branch]);
		return { committed: staged.length, unborn: false };
	}

	/**
	 * When this space syncs: the flag, then `[defaults] cadence` from
	 * drive.toml, then — on a refresh — whatever the git dir already says
	 * (C-11: the git config is the truth, so a refresh must not quietly
	 * downgrade it), then a prompt on a TTY, then a refusal that names the
	 * flag. The prompt is skipped whenever an answer is available, so a
	 * scripted run never stops for one.
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
		if (fromDefaults !== "") return fromDefaults;
		if (refreshed) {
			const existing = readCadence(root);
			if (existing !== "") return existing;
		}
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
