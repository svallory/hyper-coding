import { describe, expect, it } from "vitest";
import { lineLabel, parseLineSpec, sourceHref, sourceHrefs } from "../../src/model/links";
import type { Source } from "../../src/model/types";

const plain: Source = { id: "a", repo: "https://example.test/o/a", commit: "c0ffee", prefix: "" };
const prefixed: Source = {
	id: "b",
	repo: "https://example.test/o/b",
	commit: "beef",
	prefix: "pkg/",
};

describe("sourceHrefs", () => {
	it.each([
		["no line", plain, "x/y.md", undefined, ["https://example.test/o/a/blob/c0ffee/x/y.md"]],
		[
			"one line",
			plain,
			"x/y.md",
			"20",
			["https://example.test/o/a/blob/c0ffee/x/y.md?plain=1#L20"],
		],
		[
			"a range",
			plain,
			"x/y.md",
			"12-14",
			["https://example.test/o/a/blob/c0ffee/x/y.md?plain=1#L12-L14"],
		],
		[
			"a comma list",
			plain,
			"x/y.md",
			"3,7-9",
			[
				"https://example.test/o/a/blob/c0ffee/x/y.md?plain=1#L3",
				"https://example.test/o/a/blob/c0ffee/x/y.md?plain=1#L7-L9",
			],
		],
		[
			"a prefix",
			prefixed,
			"x/y.md",
			"5",
			["https://example.test/o/b/blob/beef/pkg/x/y.md?plain=1#L5"],
		],
		[
			"a directory",
			prefixed,
			"skills/",
			undefined,
			["https://example.test/o/b/tree/beef/pkg/skills/"],
		],
		[
			"a directory, no prefix",
			plain,
			"skills/",
			undefined,
			["https://example.test/o/a/tree/c0ffee/skills/"],
		],
	])("%s", (_name, source, path, line, expected) => {
		expect(sourceHrefs(source, path, line)).toEqual(expected);
	});

	it("a line on a directory is a content error", () => {
		expect(() => sourceHref(plain, "skills/", { from: 1, to: 1 })).toThrow(/directory/);
	});
});

describe("line specs", () => {
	it.each([
		["120", ":120"],
		["150-162", ":150-162"],
	])("%s is shown as %s", (spec, label) => {
		expect(lineLabel(parseLineSpec(spec)[0])).toBe(label);
	});

	it.each(["", "a", "0", "9-3", "1,,2", "1-"])("rejects %j", (spec) => {
		expect(() => parseLineSpec(spec)).toThrow(/Bad line spec/);
	});
});
