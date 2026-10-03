import { spawnSync } from "node:child_process";
import {
	closeSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
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
import { isHyperAllowlist } from "#services/allowlist";
import { ensureDriveCheckout, readManifest } from "#services/manifest";
import { libPath } from "#services/space";
import { isLocalDriveRemote, validateCloneEntry } from "#services/space-clone-validation";
import {
	cleanGitEnv,
	cloneProjectRepoBare,
	fetchSpaceClone,
	initSpaceGitDir,
	SpaceGitError,
	SpaceGitInterruptedError,
	spaceGit,
	writeCadence,
	writeTracked,
} from "#services/space-git";
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
			`The manifest path ${JSON.stringify(recorded)} isn't a safe home-relative destination on this machine. Pass an explicit path: hyper space clone <name> <path>.`,
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
			`The recorded destination resolves outside HOME through a symlink. Pass an explicit path to hyper space clone instead: ${target}`,
		);
	}
	const segments = inside.split(sep);
	if (
		segments.some((segment) => segment.startsWith(".")) ||
		segments[0].toLowerCase() === "library"
	) {
		throw new Error(
			`The recorded destination resolves into a protected HOME path through a symlink (${physical}). Pass an explicit path to hyper space clone instead.`,
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
			`I couldn't finish the space layout with ${fn}. Check bash and filesystem permissions, then retry. ${result.error?.message ?? result.stderr.trim()}`,
		);
	}
}

/** Validate the remote tree BEFORE checkout can overwrite our private git dir. */
function checkCloneTree(root: string, branch: string): string[] {
	const entries = spaceGit(root, ["ls-tree", "-r", "-z", `refs/remotes/origin/${branch}`])
		.stdout.split("\0")
		.filter(Boolean);
	for (const entry of entries) {
		const tab = entry.indexOf("\t");
		const mode = entry.slice(0, 6);
		const path = entry.slice(tab + 1);
		const lower = path.toLowerCase();
		const reserved = [".git", ".hyper/space.git", "code", "worktrees", "scratch"];
		if (
			reserved.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`)) ||
			(lower === ".hyper" && mode !== "040000") ||
			(lower === ".gitignore" && mode !== "100644" && mode !== "100755") ||
			mode === "160000"
		) {
			throw new Error(
				`The space branch contains an unsafe layout path ${JSON.stringify(path)}. Repair the branch on the original machine before cloning it.`,
			);
		}
	}
	return entries.map((entry) => entry.slice(entry.indexOf("\t") + 1));
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
				"there's no `remote` yet — run `hyper drive init` first.",
			);
		ensureDriveCheckout(config.remote);
		const spaces = readManifest().spaces;
		const entry = spaces.find((space) => space.name === name);
		if (!entry)
			throw new Error(
				`No space named ${JSON.stringify(name)} is registered. Known spaces: ${spaces.map((space) => space.name).join(", ") || "none yet"}. Use one of those names, or run hyper space init on the original machine.`,
			);
		validateCloneEntry(entry, config.remote);
		root = cloneTargetPath(entry.path, explicitPath);
		const warnings: string[] = [];
		if (explicitPath === undefined) {
			assertPhysicalHome(root);
			if (!options.yes) {
				if (!options.confirmTarget)
					throw new Error(
						`The manifest proposes ${root} (recorded as ${JSON.stringify(entry.path)}). Review that target and pass --yes, or provide an explicit path.`,
					);
				if (!(await options.confirmTarget(root, entry.path)))
					throw new Error("Clone cancelled; no target was created.");
			}
		} else {
			let parent = dirname(root);
			while (!lstatSync(parent, { throwIfNoEntry: false })) parent = dirname(parent);
			const physical = resolve(realpathSync(parent), relative(parent, root));
			if (physical !== root)
				warnings.push(
					`The explicit target ${root} has a symlinked parent; its physical destination is ${physical}.`,
				);
		}
		const before = lstatSync(root, { throwIfNoEntry: false });
		if (
			before &&
			(!before.isDirectory() || before.isSymbolicLink() || readdirSync(root).length > 0)
		)
			throw new Error(
				`The target ${root} already exists and isn't an empty directory. Choose a new path or an empty directory; nothing there was changed.`,
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
		const incomingPaths = checkCloneTree(root, entry.branch);
		// Checkout privately, then publish files with exclusive creation. A
		// raced-in user file cannot be overwritten or mistaken for our output.
		const staging = mkdtempSync(join(root, ".hyper", "clone-"));
		ownedGitDirs.add(staging);
		spaceGit(root, [
			"--work-tree",
			staging,
			"checkout",
			"-B",
			entry.branch,
			`refs/remotes/origin/${entry.branch}`,
			"--",
		]);
		const ignore = join(staging, ".gitignore");
		if (
			!lstatSync(ignore, { throwIfNoEntry: false })?.isFile() ||
			!isHyperAllowlist(readFileSync(ignore, "utf8"))
		)
			throw new Error(
				"The checked-out .gitignore is not a hyper allowlist. Repair it on the original machine with hyper space init --refresh, then retry.",
			);
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
		writeTracked(root, entry.tracked);
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
			untrustedConfiguration: incomingPaths.filter(
				(path) =>
					path === ".claude/settings.json" || path.startsWith("bin/") || path === ".config/wt.toml",
			),
		};
		if (result.untrustedConfiguration.length)
			result.warnings.push(
				`${result.untrustedConfiguration.map((path) => JSON.stringify(path)).join(", ")}: these came from the hyperdrive; review before trusting this space.`,
			);
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
					`Skipping ${repo.slug ?? name}: no project URL in the manifest. Add its origin on the original machine and run hyper space init --refresh.`,
				);
				continue;
			}
			const repoRoot: string = entry.layout === "bare" ? root : join(root, "code", repo.slug!);
			if (repoRoot !== root) {
				mkdirSync(repoRoot);
				ownedDirectories.add(repoRoot);
			}
			const gitDir = join(repoRoot, ".git");
			cloneProjectRepoBare(gitDir, repo.url, repo.default_branch, {
				allowLocal: isLocalDriveRemote(config.remote),
			});
			ownedGitDirs.add(gitDir);
			cloneLibrary("ensure_worktrunk_config", [gitDir, repo.default_branch]);
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
		const detail = error instanceof Error ? error.message : String(error);
		const cleanup = failures.length
			? ` Cleanup is incomplete at ${failures.join(", ")}; inspect it before retrying.`
			: "";
		if (error instanceof SpaceGitInterruptedError)
			throw new SpaceGitInterruptedError(
				error.signal,
				`Clone interrupted; ${failures.length ? "cleanup is incomplete" : "the target was restored"}. Run the command again when ready.${cleanup}`,
			);
		throw new SpaceGitError(
			`I couldn't clone ${JSON.stringify(name)}: ${detail}${cleanup} Once the problem is fixed, run hyper space clone again.`,
		);
	} finally {
		process.off("SIGINT", onInt);
		process.off("SIGTERM", onTerm);
	}
}
