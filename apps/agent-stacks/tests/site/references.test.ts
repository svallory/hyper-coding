import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGES, type PageName, pageFile, readSourceLinks } from "../../scripts/lib/read-site";
import { parseLineSpec } from "../../src/model/links";

const dist = new URL("../../dist/public", import.meta.url).pathname;
type Manifest = Record<string, Record<string, { lines?: number; dir?: true }>>;

const read = (page: PageName) => {
	const manifestFile = new URL(`../../src/content/${page}/sources.manifest.json`, import.meta.url);
	return {
		links: readSourceLinks(readFileSync(pageFile(dist, page), "utf8")),
		manifest: existsSync(manifestFile)
			? (JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest)
			: undefined,
	};
};

describe("the reference manifest of a page", () => {
	it.each(Object.keys(PAGES) as PageName[])(
		"%s: every source link is in it, and its last line is in range",
		(page) => {
			const { links, manifest } = read(page);
			const problems: string[] = [];
			if (links.length && !manifest) problems.push(`page ${page} has source links and no manifest`);
			for (const l of links) {
				if (!manifest) break;
				const entry = manifest[l.source]?.[l.path];
				const at = `${page} ${l.panel || l.lane}: ${l.source} ${l.path}`;
				if (!entry) problems.push(`${at} is not in the manifest`);
				else if (l.path.endsWith("/")) {
					if (!entry.dir) problems.push(`${at} is a directory the manifest does not record as one`);
				} else if (l.lines !== undefined) {
					const last = Math.max(...parseLineSpec(l.lines).map((p) => p.to));
					if (entry.lines === undefined || last > entry.lines)
						problems.push(`${at}:${l.lines} is past the ${entry.lines} lines recorded`);
				}
			}
			expect(problems).toEqual([]);
		},
	);
});
