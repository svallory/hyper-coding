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
 * Validate every incoming commit plus the complete tip tree. Pass base=local HEAD
 * for pull, omit it for clone. Pure object inspection: no index/work-tree writes.
 * Returns the immutable checked tip SHA and its extra tracked directories.
 */
export async function validateIncomingSpace(
	root: string,
	tip: string,
	base?: string,
): Promise<IncomingSpaceValidation> {
	const resolved = spaceGit(root, ["rev-parse", "--verify", `${tip}^{commit}`]).stdout.trim();
	const commits = spaceGit(root, ["rev-list", "--reverse", resolved, ...(base ? [`^${base}`] : [])])
		.stdout.trim()
		.split("\n")
		.filter(Boolean);
	if (!commits.includes(resolved)) commits.push(resolved);
	let tracked: string[] = [];
	for (const commit of commits) {
		const entries = treeEntries(root, commit);
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
		tracked = incomingTrackedEntries(contents);
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
			validateSymlinkResolution(root, entry.path, target, links);
		}
	}
	return { tip: resolved, tracked };
}
