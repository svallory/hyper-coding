import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLineSpec } from "../src/model/links";
import { PAGES, type PageName, pageFile, readSourceLinks, type SourceLink } from "./lib/read-site";

/** What the check needs of a clone: whether a path is a file or a directory, and a file's text. */
export interface Reader {
	kind(path: string): "file" | "dir" | undefined;
	text(path: string): string;
}

export interface CheckResult {
	/** Cited line ranges checked, plus whole files and directories cited without a line. */
	checked: number;
	problems: string[];
}

/** The lines of a file, without the empty piece a final newline leaves. */
function linesOf(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

const where = (l: SourceLink): string =>
	`${l.lane || "-"} ${l.panel ? l.panel.slice(l.lane.length + 1) : "-"} ${l.path}${l.lines ? `:${l.lines}` : ""}`;

/**
 * The pure core of the citation check: a problem for a missing file, a cited line past the end,
 * and a link with a word of which no cited line holds it. A directory is fine when it exists.
 */
export function checkCitations(links: SourceLink[], read: Reader): CheckResult {
	const problems: string[] = [];
	let checked = 0;
	const seen = new Set<string>();
	for (const link of links) {
		const kind = read.kind(link.path);
		if (link.lines === undefined) {
			// The same whole-file link can appear many times; one check each.
			if (seen.has(link.path)) continue;
			seen.add(link.path);
			checked++;
			if (!kind)
				problems.push(
					`${where(link)}: missing: no such ${link.path.endsWith("/") ? "directory" : "file"}`,
				);
			continue;
		}
		const parts = parseLineSpec(link.lines);
		checked += parts.length;
		if (kind !== "file") {
			problems.push(`${where(link)}: missing: no such file`);
			continue;
		}
		const lines = linesOf(read.text(link.path));
		let allInside = true;
		for (const part of parts) {
			if (part.to > lines.length) {
				allInside = false;
				problems.push(
					`${where(link)}: out of range: ${part.from === part.to ? part.from : `${part.from}-${part.to}`} but the file has ${lines.length} lines`,
				);
			}
		}
		if (allInside && link.word) {
			const word = link.word;
			const found = parts.some((p) => lines.slice(p.from - 1, p.to).some((l) => l.includes(word)));
			if (!found) problems.push(`${where(link)}: the word "${word}" is on none of the cited lines`);
		}
	}
	return { checked, problems };
}

/** The last line of the report. */
export const summaryLine = (r: CheckResult): string =>
	`cited lines checked: ${r.checked} problems: ${r.problems.length}`;

/** A manifest entry: a file's line count, or a directory. */
export type ManifestEntry = { lines: number } | { dir: true };
/** `{ "<source id>": { "<path>": entry } }` */
export type Manifest = Record<string, Record<string, ManifestEntry>>;

/** The entries of one source: every cited path once, with its line count, sorted by path. */
export function buildManifestEntries(
	links: SourceLink[],
	read: Reader,
): Record<string, ManifestEntry> {
	const entries: Record<string, ManifestEntry> = {};
	for (const path of [...new Set(links.map((l) => l.path))].sort()) {
		const kind = read.kind(path);
		if (kind === "dir") entries[path] = { dir: true };
		else if (kind === "file") entries[path] = { lines: linesOf(read.text(path)).length };
	}
	return entries;
}

function cloneReader(root: string): Reader {
	return {
		kind(path) {
			const full = join(root, path);
			if (!existsSync(full)) return undefined;
			return statSync(full).isDirectory() ? "dir" : "file";
		},
		text: (path) => readFileSync(join(root, path), "utf8"),
	};
}

function main(argv: string[]): number {
	const args = argv.filter((a) => !a.startsWith("--"));
	const writeManifest = argv.includes("--write-manifest");
	const [page, sourceId, clone] = args;
	if (!page || !(page in PAGES) || !sourceId || !clone) {
		console.error(
			"usage: bun run cite-check <comparison|playbooks> <source id> <clone path> [--write-manifest]",
		);
		return 2;
	}
	if (!existsSync(clone) || !statSync(clone).isDirectory()) {
		console.error(`cite-check: ${clone} is not a directory`);
		return 2;
	}
	const app = fileURLToPath(new URL("..", import.meta.url));
	const file = pageFile(join(app, "dist/public"), page as PageName);
	if (!existsSync(file)) {
		console.error(`cite-check: ${file} is missing; run the build first.`);
		return 2;
	}
	const links = readSourceLinks(readFileSync(file, "utf8")).filter((l) => l.source === sourceId);
	const read = cloneReader(clone);
	const result = checkCitations(links, read);
	for (const problem of result.problems) console.log(problem);
	console.log(summaryLine(result));

	if (writeManifest) {
		const path = join(app, "src/content", page, "sources.manifest.json");
		const manifest: Manifest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
		manifest[sourceId] = buildManifestEntries(links, read);
		const sorted = Object.fromEntries(
			Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
		);
		writeFileSync(path, `${JSON.stringify(sorted, null, "\t")}\n`);
		console.log(`manifest written: ${Object.keys(manifest[sourceId]).length} paths of ${sourceId}`);
	}
	return result.problems.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
