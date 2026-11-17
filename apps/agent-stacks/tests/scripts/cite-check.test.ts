import { describe, expect, it } from "vitest";
import {
	buildManifestEntries,
	checkCitations,
	type Reader,
	summaryLine,
} from "../../scripts/cite-check";
import type { SourceLink } from "../../scripts/lib/read-site";

const FILES: Record<string, string> = {
	"a.md": "one\ntwo\nthree\nfour\n",
	"b.md": "alpha\nbeta",
};
const reader: Reader = {
	kind: (p) => (p === "dir/" ? "dir" : p in FILES ? "file" : undefined),
	text: (p) => FILES[p],
};
const link = (path: string, lines?: string, word?: string): SourceLink => ({
	lane: "l",
	panel: "l/s",
	source: "x",
	path,
	lines,
	word,
});

describe("checkCitations", () => {
	it("passes a file that exists with its lines and word, and counts each cited range", () => {
		const r = checkCitations([link("a.md", "2,3-4", "three"), link("dir/")], reader);
		expect(r.problems).toEqual([]);
		expect(summaryLine(r)).toBe("cited lines checked: 3 problems: 0");
	});

	it("names lane, step and path for a missing file", () => {
		const r = checkCitations([link("gone.md", "1")], reader);
		expect(r.problems).toEqual(["l s gone.md:1: missing: no such file"]);
	});

	it("reports a line past the end of the file, counting a final newline as no line", () => {
		expect(checkCitations([link("a.md", "4")], reader).problems).toEqual([]);
		const r = checkCitations([link("a.md", "3-5")], reader);
		expect(r.problems).toEqual(["l s a.md:3-5: out of range: 3-5 but the file has 4 lines"]);
	});

	it("reports a word that is on none of the cited lines, and accepts it on any one", () => {
		expect(checkCitations([link("a.md", "1,3", "three")], reader).problems).toEqual([]);
		expect(checkCitations([link("a.md", "1-2", "three")], reader).problems).toEqual([
			'l s a.md:1-2: the word "three" is on none of the cited lines',
		]);
	});

	it("says a directory cannot cite lines, rather than that a file is missing", () => {
		expect(checkCitations([link("dir/", "3")], reader).problems).toEqual([
			"l s dir/:3: a directory cannot cite lines",
		]);
	});

	it("reports a missing directory and ends with the summary line", () => {
		const r = checkCitations([link("nope/"), link("a.md", "9")], reader);
		expect(r.problems).toHaveLength(2);
		expect(summaryLine(r)).toBe("cited lines checked: 2 problems: 2");
	});
});

describe("buildManifestEntries", () => {
	it("holds each cited path once, with its line count, or as a directory", () => {
		const entries = buildManifestEntries(
			[link("b.md", "1"), link("a.md", "1"), link("b.md", "2"), link("dir/"), link("gone.md")],
			reader,
		);
		expect(entries).toEqual({
			"a.md": { lines: 4 },
			"b.md": { lines: 2 },
			"dir/": { dir: true },
		});
		expect(Object.keys(entries)).toEqual(["a.md", "b.md", "dir/"]);
	});
});
