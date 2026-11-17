import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type LaneInventory,
	PAGES,
	type PageName,
	pageFile,
	readSite,
	type SiteInventory,
} from "../../scripts/lib/read-site";

const dist = new URL("../../dist/public", import.meta.url).pathname;
const expectedDir = new URL("../expected/", import.meta.url).pathname;

/** What differs, each difference naming the lane and the step or connector. */
function diff(actual: SiteInventory, expected: SiteInventory): string[] {
	const out: string[] = [];
	const byId = (lanes: LaneInventory[]) => new Map(lanes.map((l) => [l.id, l]));
	const have = byId(actual.lanes);
	const want = byId(expected.lanes);
	for (const id of want.keys()) if (!have.has(id)) out.push(`lane ${id}: missing from the page`);
	for (const id of have.keys()) if (!want.has(id)) out.push(`lane ${id}: not in the expected file`);
	for (const [id, a] of have) {
		const e = want.get(id);
		if (!e) continue;
		for (const key of ["steps", "connectors", "manualConnectors"] as const)
			if (a[key] !== e[key]) out.push(`lane ${id}: ${key} is ${a[key]}, expected ${e[key]}`);
		const steps = new Map(e.stepList.map((s) => [s.id, s]));
		for (const s of a.stepList) {
			const w = steps.get(s.id);
			if (!w) out.push(`lane ${id} step ${s.id}: not in the expected file`);
			else if (JSON.stringify(s) !== JSON.stringify(w))
				out.push(`lane ${id} step ${s.id}: ${JSON.stringify(s)} expected ${JSON.stringify(w)}`);
		}
		for (const s of e.stepList)
			if (!a.stepList.some((x) => x.id === s.id))
				out.push(`lane ${id} step ${s.id}: missing from the page`);
		if (JSON.stringify(a.connectorList) !== JSON.stringify(e.connectorList))
			out.push(
				`lane ${id}: connectors ${JSON.stringify(a.connectorList)} expected ${JSON.stringify(e.connectorList)}`,
			);
	}
	return out;
}

const expectedFiles = readdirSync(expectedDir)
	.map((f) => /^inventory\.(\w+)\.json$/.exec(f))
	.filter((m): m is RegExpExecArray => m !== null && m[1] in PAGES)
	.map((m) => [m[1] as PageName, m[0]] as const);

describe("the inventory of a built page", () => {
	it.each(expectedFiles)("%s equals its expected file, in both directions (%s)", (page, file) => {
		const actual = readSite(readFileSync(pageFile(dist, page), "utf8"), page);
		const expected = JSON.parse(readFileSync(`${expectedDir}${file}`, "utf8")) as SiteInventory;
		expect(diff(actual, expected)).toEqual([]);
	});
});
