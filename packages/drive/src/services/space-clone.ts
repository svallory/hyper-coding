import { spawnSync } from "node:child_process";
import {
	closeSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { ConfigError, configPath, loadConfig } from "#config/index";
import type { SpaceEntry } from "#config/schema";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { isClaudeUserStatePath, normaliseTrackedEntry } from "#services/allowlist";
import { ensureDriveCheckout, readManifest, recordSpacePath } from "#services/manifest";
import { libPath } from "#services/space";
import { isLocalDriveRemote, validateCloneEntry } from "#services/space-clone-validation";
import {
	cleanGitEnv,
	cloneProjectRepoBare,
	describeReviewPaths,
	fetchSpaceClone,
	initSpaceGitDir,
	quoteChildOutput,
	redactGitSecrets,
	SpaceGitCommandError,
	SpaceGitError,
	SpaceGitInterruptedError,
	sanitizeForTerminal,
	spaceGit,
	writeCadence,
	writeTracked,
} from "#services/space-git";
import {
	incomingReview,
	SpaceIncomingError,
	validateIncomingSpace,
} from "#services/space-incoming";
import { spaceWorktrunkWarning } from "#services/space-worktrunk";

/**
 * The manifest has no source-home field. Recognise conventional macOS/Linux
 * homes only; never interpret an arbitrary remote path as permission to write
 * outside this machine's HOME. Explicit paths are the operator's choice.
 */
export function cloneTargetPath(recorded: string, explicit?: string, home = homedir()): string {
	if (explicit !== undefined) return resolve(explicit);
	const refuse = (): never => {
		throw new Error(
			`The manifest path ${quoteForTerminal(recorded)} isn't a safe home-relative destination on this machine. Pass an explicit path: hyper space clone <name> <path>.`,
		);
	};
	if (
		!isAbsolute(recorded) ||
		normalize(recorded) !== recorded ||
		recorded.endsWith("/") ||
		/[\0\r\n\\]/.test(recorded) ||
		recorded.split("/").some((part) => part === ".." || part.trim() !== part)
	)
		refuse();
	const currentHome = resolve(home);
	let target: string;
	if (recorded.startsWith(`${currentHome}/`)) target = recorded;
	else {
		const match = /^\/(?:Users\/[^/]+|home\/[^/]+|root)\/(.+)$/.exec(recorded);
		if (!match) return refuse();
		target = resolve(currentHome, match[1]);
	}
	const inside = relative(currentHome, target);
	if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) refuse();
	const segments = inside.split(sep);
	if (
		segments.some((segment) => segment.startsWith(".")) ||
		segments[0].toLowerCase() === "library"
	)
		refuse();
	return target;
}

/** Reject symlink ancestors escaping HOME, including paths not created yet. */
function assertPhysicalHome(target: string): void {
	let ancestor = target;
	while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
	const home = realpathSync(homedir());
	const physical = resolve(realpathSync(ancestor), relative(ancestor, target));
	const inside = relative(home, physical);
	if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
		throw new Error(
			`The recorded destination resolves outside HOME through a symlink. Pass an explicit path to hyper space clone instead: ${escapeControlCharacters(target)}`,
		);
	}
	const segments = inside.split(sep);
	if (
		segments.some((segment) => segment.startsWith(".")) ||
		segments[0].toLowerCase() === "library"
	) {
		throw new Error(
			`The recorded destination resolves into a protected HOME path through a symlink (${escapeControlCharacters(physical)}). Pass an explicit path to hyper space clone instead.`,
		);
	}
}

/**
 * The shared review step, or a refusal that says so in a sentence. What
 * failed is the REVIEW of what this branch would bring in: it runs after the
 * checkout was published, so the files this clone wrote are removed again by
 * the caller's rollback (which reports it if that cleanup is incomplete).
 * git's own words are quoted like every other child output.
 *
 * Names are remote data: a format character (bidi, ZWJ) is legitimate in a
 * real filename, so it is returned raw and escaped only in text output.
 */
async function reviewOrFail(
	root: string,
	tip: string,
): Promise<Awaited<ReturnType<typeof incomingReview>>> {
	try {
		return await incomingReview(root, tip);
	} catch (error) {
		if (error instanceof SpaceGitInterruptedError) throw error;
		const detail =
			error instanceof SpaceGitCommandError
				? quoteChildOutput(redactGitSecrets(error.said))
				: error instanceof Error
					? error.message
					: escapeControlCharacters(String(error));
		throw new SpaceGitError(
			"I couldn't finish the review of what this space would bring in, so the clone stopped there; " +
				"the files this clone wrote were removed again. Retry the clone, or inspect the branch on the original machine if it keeps failing.\n" +
				detail,
		);
	}
}

/** Shell functions, not a TypeScript reimplementation of the space library. */
function cloneLibrary(
	fn: "ensure_worktrunk_config" | "write_hyper_md_bare" | "write_hyper_md_multi",
	args: string[],
): void {
	const result = spawnSync("bash", ["-e", "-c", `source "$0"; ${fn} "$@"`, libPath(), ...args], {
		encoding: "utf8",
		env: cleanGitEnv(),
	});
	if (result.signal === "SIGINT" || result.signal === "SIGTERM")
		throw new SpaceGitInterruptedError(result.signal);
	if (result.error || result.status !== 0) {
		throw new Error(
			`I couldn't finish the space layout with ${fn}. Check bash and filesystem permissions, then retry. ${result.error?.message ?? sanitizeForTerminal(result.stderr.trim())}`,
		);
	}
}

export interface CloneSpaceResult {
	name: string;
	path: string;
	originalPath: string;
	remapped: boolean;
	branch: string;
	cadence: SpaceEntry["cadence"];
	layout: SpaceEntry["layout"];
	reposCloned: string[];
	worktrees: string[];
	libraryWrites: string[];
	warnings: string[];
	untrustedConfiguration: string[];
	/**
	 * What happened to the manifest's `path` for this space: `unchanged` when
	 * it already named this clone's physical path, `recorded` when it now
	 * does, `not recorded` when the write failed (the clone itself is kept;
	 * the warning says how to record it later).
	 */
	manifestPath: "unchanged" | "recorded" | "not recorded";
}

/** A declined prompt is not an error to fix: exit 1 with the plain reason. */
export class CloneCancelledError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CloneCancelledError";
		this.stack = message;
	}
}

export interface CloneSpaceOptions {
	yes?: boolean;
	confirmTarget?: (target: string, recorded: string) => Promise<boolean>;
}

/** Recreate a manifest space; on failure undo only this invocation's target. */
export async function cloneSpace(
	name: string,
	explicitPath?: string,
	options: CloneSpaceOptions = {},
): Promise<CloneSpaceResult> {
	// Scoped guards cover manifest children as well as space/project children.
	let pendingSignal: "SIGINT" | "SIGTERM" | null = null;
	const onInt = (): void => {
		pendingSignal = "SIGINT";
	};
	const onTerm = (): void => {
		pendingSignal = "SIGTERM";
	};
	const checkSignal = (): void => {
		if (pendingSignal) throw new SpaceGitInterruptedError(pendingSignal);
	};
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
	let root: string | undefined;
	let ownsTarget = false;
	let createdTarget = false;
	const createdParents: string[] = [];
	const ownedFiles = new Map<string, { dev: number; ino: number }>();
	const ownedDirectories = new Set<string>();
	const ownedGitDirs = new Set<string>();
	const markFile = (path: string): void => {
		if (!root) throw new Error("Clone target is not ready.");
		const inside = relative(root, path);
		if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
			throw new Error("Refusing to record a path outside the clone target.");
		const stat = lstatSync(path);
		ownedFiles.set(path, { dev: stat.dev, ino: stat.ino });
	};
	try {
		const config = loadConfig();
		if (!config.remote)
			throw new ConfigError(
				configPath(),
				"there's no `remote` yet — run `hyper drive setup` first.",
			);
		ensureDriveCheckout(config.remote);
		const spaces = readManifest().spaces;
		const entry = spaces.find((space) => space.name === name);
		if (!entry)
			throw new Error(
				`No space named ${quoteForTerminal(name)} is registered. Known spaces: ${spaces.map((space) => escapeControlCharacters(space.name)).join(", ") || "none yet"}. Use one of those names, or run hyper space init on the original machine.`,
			);
		validateCloneEntry(entry, config.remote);
		root = cloneTargetPath(entry.path, explicitPath);
		const warnings: string[] = [];
		if (explicitPath === undefined) {
			assertPhysicalHome(root);
			if (!options.yes) {
				if (!options.confirmTarget)
					throw new Error(
						`The manifest proposes ${escapeControlCharacters(root)} (recorded as ${quoteForTerminal(entry.path)}). Review that target and pass --yes, or provide an explicit path.`,
					);
				if (!(await options.confirmTarget(root, entry.path)))
					throw new CloneCancelledError("Clone cancelled; no target was created.");
			}
		} else {
			let parent = dirname(root);
			while (!lstatSync(parent, { throwIfNoEntry: false })) parent = dirname(parent);
			const physical = resolve(realpathSync(parent), relative(parent, root));
			if (physical !== root)
				warnings.push(
					`The explicit target ${escapeControlCharacters(root)} has a symlinked parent; its physical destination is ${escapeControlCharacters(physical)}.`,
				);
		}
		const before = lstatSync(root, { throwIfNoEntry: false });
		if (
			before &&
			(!before.isDirectory() || before.isSymbolicLink() || readdirSync(root).length > 0)
		)
			throw new Error(
				`The target ${escapeControlCharacters(root)} already exists and isn't an empty directory. Choose a new path or an empty directory; nothing there was changed.`,
			);
		checkSignal();
		if (!before) {
			const missingParents: string[] = [];
			let parent = dirname(root);
			while (!lstatSync(parent, { throwIfNoEntry: false })) {
				missingParents.push(parent);
				parent = dirname(parent);
			}
			for (const path of missingParents.reverse()) {
				mkdirSync(path);
				createdParents.unshift(path);
			}
			mkdirSync(root);
			createdTarget = true;
		}
		ownsTarget = true;
		mkdirSync(join(root, ".hyper"));
		ownedDirectories.add(join(root, ".hyper"));
		initSpaceGitDir(root, { branch: entry.branch, remote: config.remote });
		ownedGitDirs.add(join(root, ".hyper", "space.git"));
		fetchSpaceClone(root, entry.branch);
		const incoming = await validateIncomingSpace(root, `refs/remotes/origin/${entry.branch}`);
		checkSignal();
		const incomingPaths = spaceGit(root, ["ls-tree", "-r", "--name-only", "-z", incoming.tip])
			.stdout.split("\0")
			.filter(Boolean);
		const allowedTracked = new Set(incoming.tracked);
		const extraManifestTracked = entry.tracked
			.map(normaliseTrackedEntry)
			.filter((path) => !allowedTracked.has(path));
		if (extraManifestTracked.length)
			warnings.push(
				`Manifest tracked entries ${extraManifestTracked.map((path) => quoteForTerminal(path)).join(", ")} are not in the incoming allowlist; trusting the allowlist instead.`,
			);
		// Checkout privately, then publish files with exclusive creation. A
		// raced-in user file cannot be overwritten or mistaken for our output.
		// Inside the space's own private git dir: `.hyper/space.git/` is
		// reserved and already ignored, so a leftover staging directory from a
		// killed clone can never reach `hyper space commit`, and rollback
		// removes it with the git dir it belongs to.
		const staging = mkdtempSync(join(root, ".hyper", "space.git", "clone-"));
		ownedGitDirs.add(staging);
		spaceGit(root, ["--work-tree", staging, "checkout", "-B", entry.branch, incoming.tip, "--"]);

		for (const path of incomingPaths) {
			const destination = resolve(root, path);
			const inside = relative(root, destination);
			if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
				throw new Error("Incoming path escapes the clone target.");
			const missing: string[] = [];
			for (
				let parent = dirname(destination);
				parent !== root && !ownedDirectories.has(parent);
				parent = dirname(parent)
			)
				missing.push(parent);
			for (const directory of missing.reverse()) {
				mkdirSync(directory);
				ownedDirectories.add(directory);
			}
			const source = join(staging, path);
			if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
			else linkSync(source, destination);
			markFile(destination);
		}
		rmSync(staging, { recursive: true, force: true });
		ownedGitDirs.delete(staging);
		writeCadence(root, entry.cadence);
		writeTracked(root, incoming.tracked);
		const review = await reviewOrFail(root, incoming.tip);
		const result: CloneSpaceResult = {
			name,
			path: root,
			originalPath: entry.path,
			remapped: explicitPath === undefined && root !== entry.path,
			branch: entry.branch,
			cadence: entry.cadence,
			layout: entry.layout,
			reposCloned: [],
			worktrees: [],
			libraryWrites: [],
			warnings,
			// Raw, like every `--json` value: a format character is legitimate
			// in a real filename, and JSON serialisation is the consumer's
			// escaping. The text warning below escapes each name.
			untrustedConfiguration: review.paths,
			manifestPath: "unchanged",
		};
		// Claude user state another machine committed (an older hyper): say
		// what it is, not the generic instruction-file warning (review of PR
		// #54, N4). It is checked out like the rest, and this machine's next
		// commit stops tracking it; the files stay on disk.
		const userState = incomingPaths.filter(isClaudeUserStatePath);
		if (userState.length > 0)
			result.warnings.push(
				`${userState.length} Claude user-state file${userState.length === 1 ? "" : "s"} from another machine (prompt history, transcripts, …) came with this space under .claude/: ${userState.slice(0, 3).map(quoteForTerminal).join(", ")}${userState.length > 3 ? ", …" : ""}. A space never tracks them: your next \`hyper space commit\` stops tracking them (the files stay on disk; delete them if you don't want them here).`,
			);
		const reviewPaths = review.paths.filter((path) => !isClaudeUserStatePath(path));
		if (reviewPaths.length) result.warnings.push(describeReviewPaths(reviewPaths, review.facts));
		if (entry.layout === "bare") {
			mkdirSync(join(root, "worktrees"));
			ownedDirectories.add(join(root, "worktrees"));
			result.worktrees.push(join(root, "worktrees"));
		} else {
			mkdirSync(join(root, "code"));
			ownedDirectories.add(join(root, "code"));
		}
		for (const repo of entry.repos) {
			checkSignal();
			if (!repo.url.trim()) {
				result.warnings.push(
					`Skipping ${escapeControlCharacters(repo.slug ?? name)}: no project URL in the manifest. Add its origin on the original machine and run hyper space init --refresh.`,
				);
				continue;
			}
			const repoRoot: string = entry.layout === "bare" ? root : join(root, "code", repo.slug!);
			if (repoRoot !== root) {
				mkdirSync(repoRoot);
				ownedDirectories.add(repoRoot);
			}
			const gitDir = join(repoRoot, ".git");
			const cloned = cloneProjectRepoBare(gitDir, repo.url, repo.default_branch, {
				allowLocal: isLocalDriveRemote(config.remote),
				label: repo.slug ?? name,
			});
			ownedGitDirs.add(gitDir);
			if (cloned.fellBack)
				result.warnings.push(
					`The manifest names ${quoteForTerminal(cloned.requestedBranch)} as ${escapeControlCharacters(repo.slug ?? name)}'s default branch, but that branch is not on the remote; using its HEAD branch ${quoteForTerminal(cloned.branch)} instead. Fix the branch on the original machine and run hyper space init --refresh.`,
				);
			cloneLibrary("ensure_worktrunk_config", [gitDir, cloned.branch]);
			result.libraryWrites.push(join(gitDir, "config"));
			if (entry.layout === "multi") {
				mkdirSync(join(repoRoot, "worktrees"));
				ownedDirectories.add(join(repoRoot, "worktrees"));
				result.worktrees.push(join(repoRoot, "worktrees"));
			}
			result.reposCloned.push(repo.slug ?? name);
			const placementWarning = spaceWorktrunkWarning(repoRoot);
			if (placementWarning) result.warnings.push(placementWarning);
		}
		// A tracked marker, including a symlink, belongs to the user. Never
		// regenerate it just because this machine's paths differ.
		if (!lstatSync(join(root, "HYPER.md"), { throwIfNoEntry: false })) {
			closeSync(openSync(join(root, "HYPER.md"), "wx"));
			markFile(join(root, "HYPER.md"));
			cloneLibrary(entry.layout === "bare" ? "write_hyper_md_bare" : "write_hyper_md_multi", [
				root,
				name,
			]);
			result.libraryWrites.push(join(root, "HYPER.md"));
		}
		checkSignal();
		// The manifest records where the space lives (AC-8): this clone's
		// physical path. DELIBERATELY outside the rollback: the space is fully
		// cloned by now, and a manifest that cannot be written (offline, lock
		// held) must not delete it. `hyper space init --refresh` in the space
		// records it later.
		const physical = realpathSync(root);
		try {
			result.manifestPath = recordSpacePath(name, physical);
		} catch (error) {
			result.manifestPath = "not recorded";
			result.warnings.push(
				`The space is cloned, but its path wasn't recorded in the manifest: ${error instanceof Error ? error.message : String(error)} Run \`hyper space init --refresh\` in ${escapeControlCharacters(physical)} to record it.`,
			);
		}
		return result;
	} catch (error) {
		const failures: string[] = [];
		if (ownsTarget && root) {
			try {
				if (createdTarget) rmSync(root, { recursive: true, force: true });
				else {
					// The directory belonged to the user: never sweep unrelated
					// files another process may have added while the network ran.
					for (const path of ownedGitDirs) rmSync(path, { recursive: true, force: true });
					for (const [path, identity] of ownedFiles) {
						const current = lstatSync(path, { throwIfNoEntry: false });
						if (current?.dev === identity.dev && current.ino === identity.ino)
							rmSync(path, { force: true });
					}
					for (const path of [...ownedDirectories].sort((a, b) => b.length - a.length)) {
						try {
							rmdirSync(path);
						} catch {
							/* Preserve nonempty directories. */
						}
					}
				}
			} catch {
				failures.push(root);
			}
		}
		for (const parent of createdParents) {
			try {
				rmdirSync(parent);
			} catch {
				/* Never remove a nonempty parent. */
			}
		}
		const detail =
			error instanceof SpaceIncomingError
				? `${error.message} Clone refused before checkout; review and repair the branch on the original machine.`
				: error instanceof Error
					? error.message
					: String(error);
		const cleanup = failures.length
			? ` Cleanup is incomplete at ${escapeControlCharacters(failures.join(", "))}; inspect it before retrying.`
			: "";
		if (error instanceof SpaceGitInterruptedError)
			throw new SpaceGitInterruptedError(
				error.signal,
				`Clone interrupted; ${failures.length ? "cleanup is incomplete" : "the target was restored"}. Run the command again when ready.${cleanup}`,
			);
		if (error instanceof CloneCancelledError) throw error;
		throw new SpaceGitError(
			`I couldn't clone ${quoteForTerminal(name)}: ${detail}${cleanup} Once the problem is fixed, run hyper space clone again.`,
		);
	} finally {
		process.off("SIGINT", onInt);
		process.off("SIGTERM", onTerm);
	}
}
