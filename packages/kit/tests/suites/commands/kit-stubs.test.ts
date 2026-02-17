/**
 * Tests for stub commands (list and info)
 */

import { describe, expect, it } from "vitest";
import KitInfo from "#commands/kit/info";
import KitList from "#commands/kit/list";

describe("KitList", () => {
	it("has correct description", () => {
		expect(KitList.description).toBe("List installed kits");
	});

	it("defines json flag", () => {
		expect(KitList.flags.json).toBeDefined();
	});

	it("defines verbose flag", () => {
		expect(KitList.flags.verbose).toBeDefined();
	});

	it("defines base flags", () => {
		expect(KitList.flags.cwd).toBeDefined();
		expect(KitList.flags.debug).toBeDefined();
	});
});

describe("KitInfo", () => {
	it("has correct description", () => {
		expect(KitInfo.description).toBe("Show detailed information about a kit");
	});

	it("defines json flag", () => {
		expect(KitInfo.flags.json).toBeDefined();
	});

	it("requires kit argument", () => {
		expect(KitInfo.args.kit.required).toBe(true);
	});

	it("defines base flags", () => {
		expect(KitInfo.flags.cwd).toBeDefined();
		expect(KitInfo.flags.debug).toBeDefined();
	});
});
