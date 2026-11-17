import { readFileSync } from "node:fs";
import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import { pageFile } from "../../scripts/lib/read-site";

const dist = new URL("../../dist/public", import.meta.url).pathname;
const doc = parse(readFileSync(pageFile(dist, "playbooks"), "utf8"));

describe("the playbooks page", () => {
	it("has 24 lanes", () => {
		expect(doc.querySelectorAll("[data-lane]")).toHaveLength(24);
	});

	it("has 50 hand-offs, each leading to a lane on the page", () => {
		const lanes = new Set(doc.querySelectorAll("[data-lane]").map((l) => l.getAttribute("id")));
		const handoffs = doc.querySelectorAll("[data-handoff]");
		expect(handoffs).toHaveLength(50);
		const broken = handoffs
			.map((h) => h.getAttribute("data-handoff") ?? "")
			.filter((id) => !lanes.has(id));
		expect(broken).toEqual([]);
	});
});
