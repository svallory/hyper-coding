import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

	it("links every badge list item to its step, and its row in that step's tree by id", () => {
		// Indexed once per panel: a selector per item over the whole page is slow on a busy CI runner.
		const rowsOf = new Map<string, Set<string>>();
		for (const p of root.querySelectorAll("[data-panel='step']"))
			rowsOf.set(
				attr(p, "id"),
				new Set(p.querySelectorAll("[data-row][id]").map((r) => attr(r, "id"))),
			);
		const items = root.querySelectorAll(".badge-pop-item");
		expect(items.length).toBeGreaterThan(0);
		const bad: string[] = [];
		for (const a of items) {
			const step = attr(a, "href").slice(1);
			const rid = attr(a, "data-row");
			if (!rowsOf.has(step)) bad.push(`${attr(a, "href")} has no step panel`);
			else if (!rowsOf.get(step)?.has(rid)) bad.push(`${step}: no row ${rid} inside it`);
		}
		expect(bad).toEqual([]);
	});

	it("reserves no column and writes no placeholder for the panel (AC-1)", () => {
		expect(root.text).not.toContain("Pick a step");
	});

	it("pads the page for the panel only while it is open (AC-1)", () => {
		const assets = join(dist, "assets");
		const css = readdirSync(assets)
			.filter((f) => f.endsWith(".css"))
			.map((f) => readFileSync(join(assets, f), "utf8"))
			.join("\n");
		const rules = [...css.matchAll(/([^{}]+)\{[^{}]*padding-right:\s*var\(--side-w\)/g)].map(
			(m) => m[1],
		);
		expect(rules.length).toBeGreaterThan(0);
		expect(rules.filter((s) => !/data-open|:target/.test(s))).toEqual([]);
	});

	it("has one top bar with the title, the page's section links and a link to the other page (AC-6)", () => {
		const bars = root.querySelectorAll("nav.site-nav");
		expect(bars).toHaveLength(1);
		const bar = bars[0];
		expect(bar.querySelector("a.tb")?.text.trim()).toBe("Agent stacks");
		const links = bar.querySelectorAll(".tl a[href^='#']").map((a) => attr(a, "href").slice(1));
		expect(links.length).toBeGreaterThan(5);
		const ids = root.querySelectorAll("[id]").map((e) => attr(e, "id"));
		expect(links.filter((l) => !ids.includes(l))).toEqual([]);
		expect(attr(bar.querySelector("a.other") as HTMLElement, "href")).toBe(
			page === "comparison" ? "/pstack/playbooks/" : "/",
		);
		const toggle = bar.querySelector("button.theme-toggle");
		expect(attr(toggle as HTMLElement, "aria-label")).toMatch(/^Switch to (dark|light) theme$/);
		expect(toggle?.text.trim()).toBe("");
		expect(toggle?.querySelector("svg")).not.toBeNull();
	});

	it("closes the panel with a link to #side that holds a <kbd> esc", () => {
		const close = root.querySelector("a.side-close");
		expect(attr(close as HTMLElement, "href")).toBe("#side");
		expect(attr(close as HTMLElement, "aria-label")).toBe("Close details panel");
		expect(close?.querySelector("kbd")?.text.trim()).toBe("esc");
	});

	it("shows the Esc key of the how paragraph as a <kbd>", () => {
		expect(root.querySelector("p.how kbd")?.text.trim()).toBe("Esc");
	});

	it("words the pinned header as bold text to release by unselecting the node", () => {
		const assets = join(dist, "assets");
		const js = readdirSync(assets)
			.filter((f) => f.endsWith(".js"))
			.map((f) => readFileSync(join(assets, f), "utf8"))
			.join("\n");
		expect(js).toContain("Pinned. Unselect node to release.");
		expect(js).not.toContain("Click it again to release");
	});

	it("has no row of lane links outside the top bar (AC-6)", () => {
		const outside = root
			.querySelectorAll("[data-lane-link], .lane-nav, .nav-row")
			.filter((e) => !e.closest("nav.site-nav"));
		expect(outside).toEqual([]);
	});

	it("names the lane, the position and the group under each step panel's title (AC-11)", () => {
		const subs = root
			.querySelectorAll("[data-panel='step']")
			.map((p) => p.querySelector(".panel-sub")?.text.trim() ?? "");
		expect(subs.length).toBeGreaterThan(0);
		expect(
			subs.filter((s) => !/^.+, step \d+ of \d+, (plan|build|check|ship|learn)\b/.test(s)),
		).toEqual([]);
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
