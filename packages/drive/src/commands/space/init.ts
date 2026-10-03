import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { isHyperAllowlist, normaliseTrackedEntry, renderGitignore } from "#services/allowlist";
import {
	driveCheckoutDir,
	ensureDriveCheckout,
	readManifest,
	SpaceNameConflictError,
	upsertSpace,
} from "#services/manifest";
import { shellQuote } from "#services/remote";
import { detectSpace } from "#services/space";
import {
	clearCadence,
	hasSpaceGit,
	initSpaceGitDir,
	projectRepoInfo,
	readCadence,
	readSpaceConfig,
	readTracked,
	removeSpaceGitDir,
	SpaceGitError,
	SpaceGitInterruptedError,
	spaceGit,
	spaceGitDir,
	writeCadence,
	writeTracked,
} from "#services/space-git";

import {
	commitAndPushSpace,
	remoteRef,
	remoteSha,
	SpacePushRefusedError,
} from "#services/space-sync";

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
				`use ${branch}. A space keeps one branch for its life, and moving a space between hyperdrives is ` +
				`not available yet — the branch is this space's identity, so renaming it now is the only ` +
				`way forward.`,
		);
	}
	const origin = readSpaceConfig(root, "remote.origin.url");
	if (origin !== remote) {
		throw new SpaceGitError(
			`${spaceGitDir(root)} is a clone of ${JSON.stringify(origin)}, but your drive.toml points at ` +
				`${JSON.stringify(remote)}. A space's history lives on one hyperdrive — fix \`remote\`, or ` +
				`init this space as a new one under a name of its own. Moving an existing space to ` +
				`another hyperdrive is not available yet.`,
		);
	}
}

/** What a call to `writeAllowlist` did, so a later rollback knows what to undo. */
type AllowlistWrite =
	| { state: "created" }
	| { state: "replaced"; previous: string }
	| { state: "untouched" };

/**
 * Render the tracked `.gitignore`, writing it only when it differs: a
 * `--refresh` of an unchanged space must leave the file alone, or "nothing
 * changed" could never be true and every refresh would look like an edit.
 *
 * A `.gitignore` that is already there and does NOT carry the marker is
 * refused, on a refresh exactly as on a first init. "Not hyper's" is decided
 * from THE FILE and from nothing else: not from byte equality with today's
 * render (a space initialised with `--tracked extra` holds a perfectly good
 * hyper render that differs from today's), and not from `refreshed` (an
 * interrupted first init leaves a git dir, and the `--refresh` the tool
 * recommends for it used to skip this guard and overwrite the user's own file
 * with no backup, then report a space that was never registered as "refreshed").
 *
 * The three-way result is what makes the rollback safe. `untouched` and
 * `created` both used to answer "null" — and a rollback that reads null as
 * "delete it" then removed a file it had never written, so a refused run could
 * delete an allowlist it never touched. `untouched` must stay distinct.
 */
function writeAllowlist(root: string, tracked: string[]): AllowlistWrite {
	const gitignore = renderGitignore(tracked);
	const path = join(root, ".gitignore");
	if (!existsSync(path)) {
		writeFileSync(path, gitignore, "utf-8");
		return { state: "created" };
	}
	const current = readFileSync(path, "utf-8");
	if (current === gitignore) return { state: "untouched" };
	if (!isHyperAllowlist(current)) {
		// Both paths absolute and inside the space, so the suggested command
		// works from wherever the reader happens to be standing.
		const backup = join(root, ".gitignore.pre-hyper");
		throw new Error(
			`${path} already exists and hyper did not write it. It is a tracked file, so hyper cannot ` +
				`commit its own allowlist without either replacing yours or leaving the space's history ` +
				`and its ignore rules disagreeing. Move yours aside and run this again:` +
				`\n\n  mv ${path} ${backup}\n`,
		);
	}
	writeFileSync(path, gitignore, "utf-8");
	return { state: "replaced", previous: current };
}

/** Undo a `writeAllowlist`, and only what it actually did. */
function restoreAllowlist(root: string, wrote: AllowlistWrite): void {
	const path = join(root, ".gitignore");
	if (wrote.state === "created") rmSync(path, { force: true });
	else if (wrote.state === "replaced") writeFileSync(path, wrote.previous, "utf-8");
}

/**
 * What `--tracked` means for this run, against the space's recorded list and
 * the manifest's copy.
 *
 * A refresh with no `--tracked` KEEPS the list: re-rendering the allowlist from
 * an empty list would drop every tracked directory the space has, and the next
 * file written under one of them would be silently ignored. `--tracked` on a
 * refresh ADDS rather than replacing, because "track one more directory" is what
 * a user passing it a second time means, and replacing would need a flag to
 * undo.
 *
 * The union is taken from BOTH places it is recorded — `hyper.tracked` in the
 * space's own git dir and the manifest entry — because neither write always
 * happens: a push the hyperdrive refuses, or a manifest that cannot be written,
 * leaves the two out of step, and the next run has to converge them rather than
 * pick a loser. Entries are normalised first, so `extra` and `extra/` are one
 * directory and not two.
 */
function resolveTracked(
	flags: string[] | undefined,
	inGitDir: string[],
	registered: SpaceEntry | null,
): string[] {
	const merged: string[] = [];
	for (const raw of [...inGitDir, ...(registered?.tracked ?? []), ...(flags ?? [])]) {
		const entry = normaliseTrackedEntry(raw);
		if (!merged.includes(entry)) merged.push(entry);
	}
	return merged;
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
			this.error(problem, { exit: err instanceof SpaceGitInterruptedError ? 130 : 2 });
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
			skipped: string[];
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

		// A git dir on its own is not a registered space. An UNBORN HEAD means a
		// first init that never finished — interrupted between creating the dir
		// and its first commit, which is a window with two network round-trips —
		// and an unfinished init is something to RESUME, not a reason to refuse
		// and send the user to `--refresh`. Refusing here is what made the trap
		// the reviewer found: plain init said "already a hyper space", the
		// recommended `--refresh` then took a first-init path over a space whose
		// manifest entry was never written.
		const hasGitDir = hasSpaceGit(root);
		const unfinished =
			hasGitDir &&
			spaceGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status !== 0;
		if (unfinished) {
			// A failed HEAD read alone could also mean damaged history. Only a
			// symbolic HEAD with no ref and no committed refs is safe to recreate.
			const symbolic = spaceGit(root, ["symbolic-ref", "-q", "HEAD"], { allowFailure: true });
			const missing =
				symbolic.status === 0 &&
				spaceGit(root, ["show-ref", "--verify", "--quiet", symbolic.stdout.trim()], {
					allowFailure: true,
				}).status === 1;
			const history = spaceGit(root, ["rev-list", "--all", "--max-count=1"], {
				allowFailure: true,
			});
			if (!missing || history.status !== 0 || history.stdout.trim() !== "") {
				throw new SpaceGitError(
					`${spaceGitDir(root)} has an unreadable HEAD or other committed history, not an unfinished first init. ` +
						`It was left untouched; repair its HEAD or move the git dir aside before trying again.`,
				);
			}
		}
		const refreshed = hasGitDir && !unfinished;
		if (refreshed && !flags.refresh) {
			throw new Error(
				`${root} is already a hyper space — its history is at ${spaceGitDir(root)}. ` +
					`Pass \`--refresh\` to re-render its allowlist, re-apply its cadence and re-register it.`,
			);
		}
		if (unfinished && flags.refresh) {
			// `--refresh` on an unfinished first init is a first init with a
			// different word on it. Treating it as a refresh is what let the
			// foreign-file guard be skipped over a space that had never
			// registered anything.
			process.stderr.write(
				`warning: ${spaceGitDir(root)} has no commit yet, so this space's first init never finished; ` +
					`continuing it as a first init.\n`,
			);
		}
		// `initSpaceGitDir` is a silent no-op when the git dir is already there,
		// so a space whose branch or remote differs from this run would be
		// reported as initialised while sitting on the old answer. An unfinished
		// init is recreated below, using THIS run's branch and remote.
		if (refreshed) assertExistingSpaceMatches(root, branch, remote);

		// The space's manifest entry, which a refresh converges with rather than
		// replaces. Read after the branch/remote comparison above, so the entry
		// looked up is this space's and not another one's.
		const registered = this.registeredEntry(name);
		// Names are unique across the whole manifest (T-4 keys it by name), so a
		// name already recorded on a DIFFERENT branch is somebody else's space.
		// Never compared by path: the same space lives at different paths on
		// different machines, and refusing that would break the fleet this
		// exists for.
		if (registered !== null && registered.branch !== branch) {
			throw new Error(
				`your hyperdrive already has a space called ${JSON.stringify(name)}, on branch ` +
					`${registered.branch}. Space names are unique across groups, so this one would take ` +
					`that space's place in the manifest. Pass \`--name\` with a name of its own` +
					(registered.group === null
						? `, or run this again without \`--group\` to re-initialise ${registered.branch} itself.`
						: `, or pass \`--group ${registered.group}\` to re-initialise ${registered.branch} itself.`),
			);
		}

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

		// Everything from the git dir onwards shares ONE cleanup, because every
		// step of it writes something: a refusal must not leave a staged secret,
		// a rewritten allowlist, a half-applied `--tracked` or `--cadence`, or a
		// git dir that makes the next plain `init` answer "already a hyper space".
		//
		// The three pieces of state this run may change are SNAPSHOTTED first,
		// because "put it back" is only meaningful against what was there. The
		// rule is whether the new commit stays: keep its matching state, otherwise
		// restore all three. A definite first-init push refusal discards the new
		// git dir; a refresh or an uncertain push keeps its history.
		//
		// Read AFTER `initSpaceGitDir`, which is where they live: on a first init
		// the dir does not exist yet, and a config read against nothing is an
		// error rather than an empty answer. A dir that was just created holds no
		// `hyper.tracked` and no `hyper.cadence`, so "just created" and "had
		// neither" are the same snapshot — which is what this needs.
		let created = false;
		let gitReady = false;
		let snapshotReady = false;
		let beforeTracked: string[] = [];
		let beforeCadence: SyncCadence = "";
		let allowlist: AllowlistWrite = { state: "untouched" };
		let tracked: string[] = [];
		let manifestEntry: SpaceEntry;
		let committed = 0;
		let unborn = false;
		let upToDate = false;
		let skipped: string[] = [];
		let pushAttempted = false;

		// Cleanup is best-effort per step: a second Ctrl-C must not prevent
		// independent restores, nor let us falsely claim nothing was changed.
		const rollback = (
			keepsCommit: boolean,
		): { signal: "SIGINT" | "SIGTERM" | null; failures: string[] } => {
			let signal: "SIGINT" | "SIGTERM" | null = null;
			const failures: string[] = [];
			const attempt = (left: string, action: () => void): void => {
				try {
					action();
				} catch (err) {
					if (err instanceof SpaceGitInterruptedError) signal = err.signal;
					failures.push(left);
				}
			};
			if (gitReady && hasSpaceGit(root)) {
				attempt("the index may still contain staged files", () => {
					spaceGit(root, ["reset", "--quiet"], { allowFailure: true });
				});
			}
			if (!keepsCommit) {
				attempt(".gitignore may not be restored", () => restoreAllowlist(root, allowlist));
				if (snapshotReady) {
					attempt("hyper.tracked may not be restored", () => writeTracked(root, beforeTracked));
					attempt("hyper.cadence may not be restored", () => {
						if (beforeCadence === "") clearCadence(root);
						else writeCadence(root, beforeCadence);
					});
				}
				if (created)
					attempt("the space git dir could not be removed", () => {
						if (hasSpaceGit(root) && !removeSpaceGitDir(root)) throw new Error("not removed");
					});
			}
			return { signal, failures };
		};

		// These listeners suppress Node's default process-group termination so
		// spaceGit can inspect the CHILD's signal and the catch can roll back.
		// They cannot fire while spawnSync blocks and perform no rollback.
		// A Node-only signal during a git child is not acted on until that child
		// returns, and then only if the child also died from it. If the event
		// loop does turn and a listener runs, remember it for the next safe point;
		// otherwise a Node-only signal may go unobserved (documented limitation).
		// Backstop only: this flag cannot be set inside the synchronous section.
		let pendingSignal: "SIGINT" | "SIGTERM" | null = null;
		const onInt = (): void => {
			pendingSignal = "SIGINT";
		};
		const onTerm = (): void => {
			pendingSignal = "SIGTERM";
		};
		const checkSignal = (): void => {
			if (pendingSignal !== null) throw new SpaceGitInterruptedError(pendingSignal);
		};
		process.on("SIGINT", onInt);
		process.on("SIGTERM", onTerm);
		try {
			checkSignal();
			// Guards are installed BEFORE recreation/initialisation: these git
			// children can be interrupted too, including before core.worktree exists.
			if (unfinished && !removeSpaceGitDir(root)) {
				throw new SpaceGitError(
					`I couldn't reset the unfinished git dir at ${spaceGitDir(root)}. Move it aside and try again.`,
				);
			}
			created = initSpaceGitDir(root, { branch, remote }).created;
			gitReady = true;
			beforeTracked = readTracked(root);
			beforeCadence = readCadence(root);
			snapshotReady = true;
			// The clash probe guards CREATING a ref. A space whose branch is not
			// on the remote yet is about to create one — a first init, a space
			// whose first push failed, or one whose allowlist was empty until
			// now — so it gets the probe too, not just a first init.
			if (remoteSha(root, remote, branch) === null) {
				const clash = refClash(root, remote, name, group);
				if (clash !== null) throw clashError(clash, name, group);
			}

			// C-11: the space's own git dir is the truth for the tracked list
			// and the manifest is the copy that travels. A refused push or an
			// unwritable manifest leaves the two out of step, so the union is
			// what converges them again.
			tracked = resolveTracked(flags.tracked, beforeTracked, registered);
			writeTracked(root, tracked);
			allowlist = writeAllowlist(root, tracked);
			writeCadence(root, cadence);

			const staged = await commitAndPushSpace(
				root,
				name,
				branch,
				remote,
				(files) => {
					committed = files;
				},
				() => {
					checkSignal();
					// Narrow (not eliminate) the race: fetch the latest manifest just
					// before publishing. The locked upsert remains the final check.
					ensureDriveCheckout(remote);
					const latest = this.registeredEntry(name);
					if (latest !== null && latest.branch !== branch) {
						throw new SpaceNameConflictError(name, branch, latest.branch);
					}
					pushAttempted = true;
				},
			);
			checkSignal();
			committed = staged.committed;
			unborn = staged.unborn;
			upToDate = staged.upToDate;
			skipped = staged.skipped;

			manifestEntry = this.buildEntry(
				name,
				branch,
				group,
				root,
				info.layout,
				info.repos,
				cadence,
				tracked,
				refreshed,
			);
		} catch (err) {
			let failure = err;
			let confirmed = false;
			const refused = err instanceof SpacePushRefusedError;
			if (pushAttempted && !refused && !(err instanceof SpaceGitInterruptedError)) {
				try {
					const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
					confirmed = head !== "" && remoteSha(root, remote, branch) === head;
				} catch (probeError) {
					// Unknown is not success. Also preserve a re-probe interruption
					// as an interruption, never an ordinary network failure.
					if (probeError instanceof SpaceGitInterruptedError) failure = probeError;
				}
			}
			const interrupted = failure instanceof SpaceGitInterruptedError;
			// A definite refusal on a first init is safe to undo. Unclassified
			// failures may have landed; existing spaces always keep their history.
			const keepsCommit =
				committed > 0 && (!created || (!refused && (pushAttempted || interrupted)));
			const cleanup = rollback(keepsCommit);
			if (cleanup.failures.length > 0) {
				const remains = hasSpaceGit(root)
					? `${spaceGitDir(root)} remains; ${cleanup.failures.join("; ")}. Inspect it before retrying.`
					: `no space git dir remains; ${cleanup.failures.includes(".gitignore may not be restored") ? ".gitignore may not be restored — inspect it before retrying" : ".gitignore was restored; run the command again when ready"}.`;
				const signal =
					cleanup.signal ?? (failure instanceof SpaceGitInterruptedError ? failure.signal : null);
				if (signal !== null)
					throw new SpaceGitInterruptedError(signal, `interrupted during cleanup: ${remains}`);
				throw new SpaceGitError(
					`cleanup incomplete: ${remains} ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			if (err instanceof SpacePushRefusedError) {
				throw new SpaceGitError(
					err.message + (refreshed ? " Your local history was kept." : err.firstInitAdvice),
				);
			}
			if (failure instanceof SpaceGitInterruptedError) {
				throw new SpaceGitInterruptedError(
					failure.signal,
					keepsCommit || pushAttempted
						? `interrupted: your commit is kept locally with its allowlist, tracked paths and cadence; publication was not confirmed. Run \`hyper space init --refresh\` to publish it.`
						: `interrupted: nothing was changed in the space. Run the command again when ready.`,
				);
			}
			if (!confirmed) {
				if (pushAttempted) {
					throw new SpaceGitError(
						`${err instanceof Error ? err.message : String(err)} I couldn't confirm the push of ${branch} ` +
							`to ${remote}; your commit is kept locally. Run \`hyper space init --refresh\` to publish it.`,
					);
				}
				throw err;
			}
			// The push reported failure but the hyperdrive holds this commit
			// anyway — an ambiguous failure (a dropped connection, a killed
			// client) where the one thing that matters did happen. Deleting the
			// git dir here would destroy the only local copy of it; rethrowing
			// would report a space that exists as a failure. Continue to the
			// manifest write, which is the only step left.
			manifestEntry ??= this.buildEntry(
				name,
				branch,
				group,
				root,
				info.layout,
				info.repos,
				cadence,
				tracked,
				refreshed,
			);
			process.stderr.write(
				`warning: the push reported a failure, but ${branch} is on ${remote}. Continuing.\n`,
			);
		} finally {
			process.off("SIGINT", onInt);
			process.off("SIGTERM", onTerm);
		}

		// The manifest write is DELIBERATELY outside the rollback above. By now
		// the branch is committed and pushed and the tracked list is in the
		// space's own git dir, so undoing anything here would destroy a space
		// that exists — and the message below promises the reader the opposite.
		try {
			upsertSpace(manifestEntry);
		} catch (err) {
			if (err instanceof SpaceNameConflictError) {
				throw new Error(
					`${branch} was pushed to ${remote}, but the name ${JSON.stringify(name)} now belongs to ${err.existingBranch}. ` +
						`Remove ${spaceGitDir(root)} and run \`hyper space init --name <another>\`. ` +
						`The pushed branch stays on the hyperdrive until removed by hand; hyper never deletes remote refs. ` +
						`To remove it yourself, run:\n\n  git push ${shellQuote(remote)} --delete ${shellQuote(branch)}\n`,
				);
			}
			throw new Error(
				`${branch} was committed and pushed to ${remote}, but writing the hyperdrive manifest ` +
					`failed — the space itself is fine: ${err instanceof Error ? err.message : String(err)} ` +
					`Rerun \`hyper space init --refresh\` once the manifest can be written.`,
			);
		}
		return {
			...manifestEntry,
			committed,
			refreshed: registered !== null,
			remote,
			unborn,
			upToDate,
			skipped,
		};
	}

	/**
	 * The manifest entry for this space, from everything this run resolved.
	 *
	 * A method rather than inline because the push-failure path needs it too:
	 * when a push reports failure but the hyperdrive took the commit, the run
	 * continues to write the manifest and needs the same entry the happy path
	 * would have built.
	 */
	private buildEntry(
		name: string,
		branch: string,
		group: string | null,
		root: string,
		layout: "bare" | "multi",
		repos: string[],
		cadence: SyncCadence,
		tracked: string[],
		refreshed: boolean,
	): SpaceEntry {
		return {
			name,
			branch,
			group,
			path: realpathSync(root),
			layout,
			repos: spaceReposOf(root, layout, repos, !refreshed),
			cadence,
			tracked,
			public: [],
		};
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
					// No command named here: `hyper space push` is T-7 and does not
					// exist yet, and a hint that cannot be typed is worse than none.
					{ value: "manual", label: "manual", hint: "only when I ask hyper to sync it" },
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
