import { readFileSync } from "node:fs";
import { type HTMLElement, type Node, parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import { PAGES, type PageName, pageFile } from "../../scripts/lib/read-site";

const dist = new URL("../../dist/public", import.meta.url).pathname;
const names = Object.keys(PAGES) as PageName[];
const roots = Object.fromEntries(
	names.map((p) => [p, parse(readFileSync(pageFile(dist, p), "utf8"), { comment: false })]),
) as Record<PageName, HTMLElement>;

/** Every text node outside script and style. */
function textNodes(node: Node, out: string[] = []): string[] {
	for (const child of node.childNodes) {
		if (child.nodeType === 3) out.push(child.text);
		else if (child.nodeType === 1) {
			const tag = (child as HTMLElement).tagName?.toLowerCase();
			if (tag !== "script" && tag !== "style") textNodes(child, out);
		}
	}
	return out;
}

const attr = (el: HTMLElement, name: string) => el.getAttribute(name) ?? "";

describe("the pstack lane on the comparison page", () => {
	it("shows the worker.md row under poteto-agent with a :20 link to line 20 of poteto-mode", () => {
		const rows = roots.comparison.querySelectorAll("[data-row]");
		const row = rows.find(
			(r) =>
				r.querySelector("[data-row-name]")?.text.trim() === "worker.md" &&
				r.parentNode?.closest("[data-row]")?.querySelector("[data-row-name]")?.text.trim() ===
					"poteto-agent",
		);
		const link = row?.querySelector("a[data-slot]");
		expect(link?.text.trim()).toBe(":20");
		expect(attr(link as HTMLElement, "href")).toMatch(/poteto-mode\/SKILL\.md\?plain=1#L20$/);
	});
});

describe.each(names)("the %s page", (page) => {
	const root = roots[page];

	it("shows no path with a line number, no 'named in', no Evidence label (AC-8, C-7)", () => {
		const bad = textNodes(root)
			.map((t) => t.trim())
			.filter(
				(t) =>
					/[\w.-]+\/[\w./-]+:\d+/.test(t) || /named in \S+:\d+/.test(t) || /^Evidence:?$/.test(t),
			);
		expect(bad).toEqual([]);
	});

	it("gives every source link that cites lines a target with #L (AC-8)", () => {
		const bad = root
			.querySelectorAll("[data-ref][data-lines]")
			.filter((a) => !attr(a, "href").includes("#L"))
			.map((a) => attr(a, "data-path"));
		expect(bad).toEqual([]);
	});

	it("makes a row with child rows a details, open at depth 0 and 1 only (C-10)", () => {
		const bad: string[] = [];
		for (const row of root.querySelectorAll("[data-row]")) {
			if (!row.querySelector("[data-row]")) continue;
			const depth = Number(attr(row, "data-depth"));
			const name = row.querySelector("[data-row-name]")?.text.trim();
			if (row.tagName.toLowerCase() !== "details") bad.push(`${depth} ${name}: not a details`);
			else if (row.hasAttribute("open") !== depth <= 1)
				bad.push(`${depth} ${name}: ${row.hasAttribute("open") ? "open" : "closed"}`);
		}
		expect(bad).toEqual([]);
	});

	it("resolves every in-page link to an element, a step link to a step panel (C-11)", () => {
		const ids = root.querySelectorAll("[id]").map((e) => attr(e, "id"));
		const bad: string[] = [];
		for (const a of root.querySelectorAll("[href^='#']")) {
			const target = attr(a, "href").slice(1);
			if (target && !ids.includes(target)) bad.push(`${attr(a, "href")} has no element`);
		}
		for (const a of root.querySelectorAll("[data-step]")) {
			const panel = root.querySelector(`[data-panel="step"][id="${attr(a, "href").slice(1)}"]`);
			if (!panel) bad.push(`${attr(a, "href")} has no step panel`);
		}
		expect(bad).toEqual([]);
	});

	it("repeats no id (C-11)", () => {
		const ids = root.querySelectorAll("[id]").map((e) => attr(e, "id"));
		expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
	});

	it("loads scripts, stylesheets and images from root-relative URLs (C-13)", () => {
		const urls = [
			...root.querySelectorAll("script[src]").map((e) => attr(e, "src")),
			...root.querySelectorAll("link[href]").map((e) => attr(e, "href")),
			...root.querySelectorAll("img[src]").map((e) => attr(e, "src")),
		];
		expect(urls.filter((u) => !/^\/(?!\/)/.test(u))).toEqual([]);
	});
});
