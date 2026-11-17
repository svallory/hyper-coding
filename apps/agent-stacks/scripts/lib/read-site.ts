import { join } from "node:path";
import { type HTMLElement, parse } from "node-html-parser";

/** The pages the app builds: the name a command takes, and the file under `dist/public`. */
export const PAGES = {
	comparison: "index.html",
	playbooks: "pstack/playbooks/index.html",
} as const;
export type PageName = keyof typeof PAGES;

export function pageFile(distDir: string, page: PageName): string {
	return join(distDir, PAGES[page]);
}

export interface StepInventory {
	id: string;
	warnings: number;
	/** `"<depth> <name>"` in page order; choice groups are not rows. */
	rows: string[];
	manualRows: number;
	citations: number;
}

export interface ConnectorInventory {
	id: string;
	citations: number;
}

export interface LaneInventory {
	id: string;
	steps: number;
	connectors: number;
	manualConnectors: number;
	stepList: StepInventory[];
	connectorList: ConnectorInventory[];
}

export interface SiteInventory {
	page: string;
	lanes: LaneInventory[];
}

/**
 * One source link of a page. A comma list of lines (`:20, :30`) is one link with `lines` "20,30".
 * `lines` is absent on a link to a whole file or directory.
 */
export interface SourceLink {
	/** The lane the link sits in; "" outside any lane. */
	lane: string;
	/** The id of the panel the link sits in ("<lane>/<step>" or "<lane>/<from>~<to>"); "" outside one. */
	panel: string;
	source: string;
	path: string;
	lines?: string;
	/** The word a cited line must contain (a row's `word`). */
	word?: string;
}

const attr = (el: HTMLElement, name: string): string | undefined => el.getAttribute(name);
const squash = (text: string): string => text.replace(/\s+/g, " ").trim();
const parseHtml = (html: string): HTMLElement => parse(html, { comment: false });

/** The panel (or, failing that, the lane section) an element is in. */
function context(el: HTMLElement): { lane: string; panel: string } {
	const panel = el.closest("[data-panel]");
	const panelId = panel ? (attr(panel, "id") ?? "") : "";
	const section = el.closest("[data-lane]");
	const lane = section ? (attr(section, "id") ?? "") : panelId.split("/")[0];
	return { lane, panel: panelId };
}

/** The source links of a page, comma lists of lines merged into one link each. */
export function readSourceLinks(html: string): SourceLink[] {
	const links: SourceLink[] = [];
	let previous: { el: HTMLElement; link: SourceLink } | undefined;
	for (const el of parseHtml(html).querySelectorAll("[data-ref][data-path]")) {
		const source = attr(el, "data-source") ?? "";
		const path = attr(el, "data-path") ?? "";
		const lines = attr(el, "data-lines");
		const slot = el.hasAttribute("data-slot");
		// Another part of the list the previous link starts: a `data-more` link, or a slot link
		// that follows a slot link of the same path with only ", " between them.
		const sibling = el.previousElementSibling;
		const joins =
			lines !== undefined &&
			previous !== undefined &&
			previous.link.path === path &&
			previous.link.source === source &&
			previous.link.lines !== undefined &&
			(el.hasAttribute("data-more") ||
				(slot &&
					sibling === previous.el &&
					el.previousSibling !== null &&
					el.previousSibling !== sibling &&
					el.previousSibling.text.trim() === ","));
		if (joins && previous && lines !== undefined) {
			previous.link.lines += `,${lines}`;
			previous.el = el;
			continue;
		}
		const link: SourceLink = { ...context(el), source, path };
		if (lines !== undefined) link.lines = lines;
		// A slot link's word is its row's: the name link in the same line carries it.
		const word = slot
			? el.parentNode?.parentNode?.querySelector("[data-row-name] a[data-word]")
			: el;
		const w = word && attr(word, "data-word");
		if (w) link.word = w;
		links.push(link);
		previous = { el, link };
	}
	return links;
}

const citationCount = (links: SourceLink[], panel: string): number =>
	links.filter((l) => l.panel === panel && l.lines !== undefined).length;

/** What a built page contains, in the shape of `tests/expected/inventory.<page>.json`. */
export function readSite(html: string, page: string): SiteInventory {
	const root = parseHtml(html);
	const links = readSourceLinks(html);

	const laneIds = root.querySelectorAll("[data-lane]").map((s) => attr(s, "id") ?? "");
	const panels = root.querySelectorAll("[data-panel]");
	for (const p of panels) {
		const lane = (attr(p, "id") ?? "").split("/")[0];
		if (lane && !laneIds.includes(lane)) laneIds.push(lane);
	}

	const lanes = laneIds.map((id): LaneInventory => {
		const own = (kind: string) =>
			panels.filter(
				(p) => attr(p, "data-panel") === kind && (attr(p, "id") ?? "").startsWith(`${id}/`),
			);
		const stepList = own("step").map((p): StepInventory => {
			const panelId = attr(p, "id") ?? "";
			const rowNames = p.querySelectorAll("[data-row-name]");
			return {
				id: panelId.slice(id.length + 1),
				warnings: p.querySelectorAll("[data-warning]").length,
				rows: rowNames.map((n) => {
					const depth = n.closest("[data-row]")?.getAttribute("data-depth") ?? "?";
					return `${depth} ${squash(n.text)}`;
				}),
				manualRows: p.querySelectorAll("[data-row][data-manual]").length,
				citations: citationCount(links, panelId),
			};
		});

		const connectors = new Map<string, { citations: number; manual: boolean }>();
		for (const p of own("connector")) {
			const panelId = attr(p, "id") ?? "";
			connectors.set(panelId.slice(id.length + 1), {
				citations: citationCount(links, panelId),
				manual: p.querySelector('header [data-chip="manual"]') !== null,
			});
		}
		// The connector elements of the flow view name connectors that have no panel.
		const section = root.querySelector(`[data-lane][id="${id}"]`);
		for (const c of section?.querySelectorAll("[data-connector]") ?? []) {
			const cid = attr(c, "data-connector") ?? "";
			const known = connectors.get(cid) ?? { citations: 0, manual: false };
			if (c.hasAttribute("data-manual")) known.manual = true;
			connectors.set(cid, known);
		}

		return {
			id,
			steps: stepList.length,
			connectors: connectors.size,
			manualConnectors: [...connectors.values()].filter((c) => c.manual).length,
			stepList,
			connectorList: [...connectors].map(([cid, c]) => ({ id: cid, citations: c.citations })),
		};
	});
	return { page, lanes };
}
