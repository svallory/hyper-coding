import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assertDist } from "../scripts/assert-dist";

const root = mkdtempSync(join(tmpdir(), "assert-dist-"));
let dir = "";
let n = 0;

function put(rel: string, html: string): void {
	const file = join(dir, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, html);
}

beforeEach(() => {
	dir = join(root, `case-${n++}`);
	mkdirSync(dir, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("assertDist", () => {
	it("has no problem when both pages exist and show no content error", () => {
		put("index.html", "<h1>a</h1>");
		put("pstack/playbooks/index.html", "<h1>b</h1>");
		expect(assertDist(dir)).toEqual([]);
	});

	it.each([
		["a missing playbooks page", { "index.html": "<h1>a</h1>" }, "pstack/playbooks/index.html"],
		[
			"an empty home page",
			{ "index.html": "", "pstack/playbooks/index.html": "<h1>b</h1>" },
			"index.html",
		],
	])("names the page for %s", (_name, files, page) => {
		for (const [rel, html] of Object.entries(files)) put(rel, html);
		const problems = assertDist(dir);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(page);
	});

	it("names a page with a content error", () => {
		put("index.html", "<h1>a</h1>");
		put("pstack/playbooks/index.html", "<pre data-content-error>bad</pre>");
		const problems = assertDist(dir);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("pstack/playbooks/index.html");
	});
});
