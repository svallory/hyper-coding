/** Incoming space history is untrusted: inspect objects before any checkout or fast-forward. */
import { existsSync, realpathSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import {
	isHyperAllowlist,
	normaliseTrackedEntry,
	RESERVED_PATHS,
	renderGitignore,
} from "#services/allowlist";
import { readSpaceBlobPrefixes, SpaceGitError, spaceGit } from "#services/space-git";

export interface IncomingSpaceValidation {
	tip: string;
	tracked: string[];
}

export class SpaceIncomingError extends SpaceGitError {
	/** Stable slug for `--json` consumers; never parse the prose for this. */
	readonly reason = "incoming-history-refused";
	constructor(path: string, reason: string) {
		super(
			`Refusing incoming space history: ${JSON.stringify(path)} ${reason}. Local history and files were not changed; repair the remote history before retrying.`,
		);
		this.name = "SpaceIncomingError";
	}
}

function refuse(path: string, reason: string): never {
	throw new SpaceIncomingError(path, reason);
}

/** Parse only the renderer's allowlist grammar, never arbitrary user-controlled ignore rules. */
function incomingTrackedEntries(contents: string): string[] {
	if (contents.includes("\0")) refuse(".gitignore", "contains a NUL byte");
	if (!isHyperAllowlist(contents)) refuse(".gitignore", "is not hyper's allowlist");
	const base = new Set(renderGitignore().trimEnd().split("\n"));
	const tracked: string[] = [];
	for (const line of contents.trimEnd().split("\n")) {
		if (base.has(line)) continue;
		const match = /^!\/(.+)\/(?:\*\*)?$/.exec(line);
		if (!match)
			refuse(".gitignore", `contains an unsupported allowlist rule ${JSON.stringify(line)}`);
		let entry: string;
		try {
			entry = normaliseTrackedEntry(match[1]);
		} catch (error) {
			refuse(
				".gitignore",
				`has an invalid tracked entry: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (unsafePath(entry)) refuse(".gitignore", `tracks a protected path ${JSON.stringify(entry)}`);
		if (!tracked.includes(entry)) tracked.push(entry);
	}
	// Merely retaining the marker is not authority to add negations or reorder safety rules.
	// Tracking an already-default directory adds only the safety tail. Recover one
	// equivalent validated entry rather than accepting a non-canonical byte form.
	if (tracked.length === 0 && contents === renderGitignore(["notes"]))
		tracked.push(normaliseTrackedEntry("notes"));
	if (contents !== renderGitignore(tracked))
		refuse(
			".gitignore",
			"does not match hyper's canonical allowlist; rerender it with space init on the publishing machine",
		);
	return tracked;
}

function unsafePath(path: string): boolean {
	const parts = path.split("/").map((part) =>
		part
			.normalize("NFC")
			.toLowerCase()
			.replace(/[ .]+$/, ""),
	);
	if (parts.some((part) => part === ".git" || part === ".gitmodules" || part === ".gitattributes"))
		return true;
	const normalised = parts.join("/");
	return RESERVED_PATHS.some(
		(reserved) => normalised === reserved || normalised.startsWith(`${reserved}/`),
	);
}

/** Resolve incoming link chains before normalising .., and check existing local ancestors. */
function validateSymlinkResolution(
	root: string,
	path: string,
	target: string,
	links: Map<string, string>,
	rejectReservedAncestor = false,
): void {
	let remaining = [...posix.dirname(path).split("/"), ...target.split("/")];
	const parts: string[] = [];
	let expansions = 0;
	while (remaining.length > 0) {
		const next = remaining.shift()!;
		if (next === "." || next === "") continue;
		if (next === "..") {
			if (parts.length === 0) refuse(path, "has a symlink chain escaping the space");
			parts.pop();
			continue;
		}
		parts.push(next);
		if (unsafePath(parts.join("/"))) refuse(path, "has a symlink chain into a reserved location");
		const link = links.get(parts.join("/"));
		if (link !== undefined) {
			if (
				++expansions > 40 ||
				posix.isAbsolute(link) ||
				/^[a-z]:/i.test(link) ||
				link.includes("\\")
			)
				refuse(path, "has an unsafe or cyclic symlink chain");
			parts.pop();
			remaining = [...link.split("/"), ...remaining];
		} else {
			const candidate = join(root, ...parts);
			if (existsSync(candidate)) {
				const physical = relative(realpathSync(root), realpathSync(candidate));
				if (unsafePath(physical.split(sep).join("/")))
					refuse(path, "resolves through a local symlink into a reserved location");
				if (physical === ".." || physical.startsWith(`..${sep}`))
					refuse(path, "resolves through a local symlink outside the space");
			}
		}
	}
	if (rejectReservedAncestor) {
		const candidate = join(root, ...parts);
		const targetPath = (
			existsSync(candidate)
				? relative(realpathSync(root), realpathSync(candidate)).split(sep).join("/")
				: parts.join("/")
		)
			.normalize("NFC")
			.toLowerCase()
			.replace(/[ .]+$/, "");
		if (
			targetPath === "" ||
			RESERVED_PATHS.some((reserved) => reserved.startsWith(`${targetPath}/`))
		)
			refuse(path, "has a symlink target that is an ancestor of reserved metadata");
	}
}

interface TreeEntry {
	mode: string;
	hash: string;
	path: string;
}
function treeEntries(root: string, commit: string): TreeEntry[] {
	// -z bypasses core.quotePath: Unicode, tabs and newlines remain literal paths.
	return spaceGit(root, ["ls-tree", "-r", "-z", commit])
		.stdout.split("\0")
		.filter(Boolean)
		.map((record) => {
			const tab = record.indexOf("\t");
			const [mode, , hash] = record.slice(0, tab).split(" ");
			return { mode, hash, path: record.slice(tab + 1) };
		});
}

/**
 * Validate only the complete tip tree: historical commits are not materialized.
 * The optional base remains accepted for API compatibility; reporting uses it
 * separately. Pure object inspection: no index/work-tree writes.
 * Returns the immutable checked tip SHA and its extra tracked directories.
 */
export async function validateIncomingSpace(
	root: string,
	tip: string,
	_base?: string,
): Promise<IncomingSpaceValidation> {
	const resolved = spaceGit(root, ["rev-parse", "--verify", `${tip}^{commit}`]).stdout.trim();
	const entries = treeEntries(root, resolved);
	for (const entry of entries) {
		if (unsafePath(entry.path))
			refuse(
				entry.path,
				"is protected metadata, a reserved location, or executable Git configuration",
			);
		if (entry.mode === "160000") refuse(entry.path, "is a gitlink");
		if (!["100644", "100755", "120000"].includes(entry.mode))
			refuse(entry.path, "has an unsupported tree mode");
	}
	const ignore = entries.find((entry) => entry.path === ".gitignore");
	if (ignore?.mode !== "100644") refuse(".gitignore", "must be a regular hyper allowlist file");
	const inspect = [ignore, ...entries.filter((entry) => entry.mode === "120000")];
	const blobs = await readSpaceBlobPrefixes(
		root,
		inspect.map((entry) => entry.hash),
		64 * 1024,
	);
	const ignoreBlob = blobs.get(ignore.hash)!;
	if (ignoreBlob.size > ignoreBlob.prefix.length)
		refuse(".gitignore", "exceeds the 64 KiB allowlist limit");
	const contents = ignoreBlob.prefix.toString("utf8");
	if (!Buffer.from(contents, "utf8").equals(ignoreBlob.prefix))
		refuse(".gitignore", "is not valid UTF-8");
	const tracked = incomingTrackedEntries(contents);
	const links = new Map(
		entries
			.filter((entry) => entry.mode === "120000")
			.map((entry) => [entry.path, blobs.get(entry.hash)!.prefix.toString("utf8")]),
	);
	const directories = ["notes", "data", "bin", ".hyper", ".claude", ...tracked];
	const markers = new Set([".gitignore", "HYPER.md", "AGENTS.md", "CLAUDE.md"]);
	for (const entry of entries) {
		if (!markers.has(entry.path) && !directories.some((dir) => entry.path.startsWith(`${dir}/`)))
			refuse(entry.path, "is outside the incoming allowlist");
		// Regular files can also traverse a local or incoming symlink ancestor.
		validateSymlinkResolution(root, entry.path, posix.basename(entry.path), links);
		if (entry.mode !== "120000") continue;
		const blob = blobs.get(entry.hash)!;
		const target = blob.prefix.toString("utf8");
		const resolvedTarget = posix.normalize(posix.join(posix.dirname(entry.path), target));
		if (
			blob.size > 4096 ||
			target.includes("\0") ||
			target.includes("\\") ||
			posix.isAbsolute(target) ||
			/^[a-z]:/i.test(target) ||
			resolvedTarget === ".." ||
			resolvedTarget.startsWith("../")
		)
			refuse(entry.path, "has a symlink target that is absolute or escapes the space");
		validateSymlinkResolution(root, entry.path, target, links, true);
	}
	return { tip: resolved, tracked };
}

/** Agent instruction files, matched by basename at any depth, case-insensitively. */
const REVIEW_NAMES: ReadonlySet<string> = new Set([
	"claude.md",
	"claude.local.md",
	"agents.md",
	"gemini.md",
	"hyper.md",
]);
/** Directories whose contents can run commands or shape what an agent does. */
const REVIEW_DIRECTORIES: readonly string[] = [
	".claude/",
	".config/",
	".cursor/",
	".codex/",
	".vscode/",
	".pi/",
	".hyper/memory/",
	"bin/",
];

function isReviewPath(path: string): boolean {
	// A directory name matches as a tree, as a link or as a file: a peer that
	// replaces `.hyper/memory` with a symlink must not slip past the match just
	// by dropping the trailing slash.
	const normalized = path.normalize("NFC").toLowerCase().replace(/\/+$/, "");
	if (REVIEW_NAMES.has(posix.basename(normalized))) return true;
	return REVIEW_DIRECTORIES.some((dir) => {
		const bare = dir.replace(/\/+$/, "");
		return normalized === bare || normalized.startsWith(dir);
	});
}

/**
 * Resolve every component of `start` through the tip's links, so a path that
 * merely *lives behind* a symlinked directory lands on its real location.
 * Bounded and loop-safe; returns the input unchanged when it cannot be followed.
 */
function resolveThroughLinks(start: string, links: Map<string, string>, limit = 40): string {
	const parts: string[] = [];
	// An index cursor over segments, not a mutating queue: expanding a link
	// splices the target's segments IN PLACE of the link itself, and the
	// segments after the link keep their place.
	const segments = start.split("/");
	let index = 0;
	const seen = new Set<string>();
	let hops = 0;
	while (index < segments.length) {
		const next = segments[index++];
		if (next === "" || next === ".") continue;
		if (next === "..") {
			if (parts.length > 0) parts.pop();
			continue;
		}
		parts.push(next);
		// Check EVERY accumulated prefix, not just the whole path: a change can
		// sit behind a symlinked directory component, not only behind a link
		// that happens to be the last segment.
		const candidate = parts.join("/");
		const link = links.get(candidate);
		if (link === undefined) continue;
		if (++hops > limit || seen.has(candidate) || posix.isAbsolute(link) || link.includes("\\"))
			return start;
		seen.add(candidate);
		parts.pop();
		segments.splice(index, 0, ...link.split("/"));
	}
	return parts.join("/");
}

/**
 * Added, changed or deleted files that can execute commands or instruct agents,
 * plus whatever a review symlink points at. Deletions count: removing a
 * `.claude/settings.json` silently drops its deny rules. A changed executable
 * counts wherever it lives. Omit `base` for clone (the whole tip is new).
 *
 * Two tree listings plus one batched read of symlink targets — no per-path
 * spawns, so the process count does not grow with the size of the space.
 * Advisory: this reports, it never blocks or grants execution.
 */
export async function incomingReviewPaths(
	root: string,
	tip: string,
	base?: string,
): Promise<string[]> {
	const tipTree = new Map(treeEntries(root, tip).map((entry) => [entry.path, entry]));
	const baseTree = base
		? new Map(treeEntries(root, base).map((entry) => [entry.path, entry]))
		: new Map<string, TreeEntry>();
	const symlinks = [...tipTree.values()].filter((entry) => entry.mode === "120000");
	const links = new Map(symlinks.map((entry) => [entry.path, ""]));
	const targets = await readSpaceBlobPrefixes(
		root,
		symlinks.map((entry) => entry.hash),
		4096,
	);
	for (const entry of symlinks)
		links.set(entry.path, targets.get(entry.hash)!.prefix.toString("utf8"));
	const changed = (path: string): boolean => {
		const tipEntry = tipTree.get(path);
		const baseEntry = baseTree.get(path);
		return tipEntry?.hash !== baseEntry?.hash || tipEntry?.mode !== baseEntry?.mode;
	};
	const reported = new Set<string>();
	const changedPaths = [...new Set([...tipTree.keys(), ...baseTree.keys()])].filter(changed);
	for (const path of changedPaths) {
		const tipEntry = tipTree.get(path);
		const baseEntry = baseTree.get(path);
		// A changed path counts when it is itself a review path, when it sits
		// behind a symlinked directory that a review path points at, or when it
		// gained (or lost) the executable bit.
		const resolved = resolveThroughLinks(path, links);
		if (
			isReviewPath(path) ||
			isReviewPath(resolved) ||
			tipEntry?.mode === "100755" ||
			baseEntry?.mode === "100755"
		)
			reported.add(path);
	}
	// A reviewed path that is a symlink is only half the story: whoever wrote it
	// can change the file behind it later without the link itself changing. The
	// target may be a file several hops away, or a whole directory.
	for (const [path, entry] of tipTree) {
		if (entry.mode !== "120000" || !isReviewPath(path)) continue;
		const target = resolveThroughLinks(path, links);
		for (const changed of changedPaths) {
			if (changed === target || changed.startsWith(`${target}/`)) reported.add(changed);
		}
	}
	return [...reported].sort();
}
