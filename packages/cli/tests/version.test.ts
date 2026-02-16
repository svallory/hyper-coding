import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { version } from "../src/index";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

describe("Package exports", () => {
	it("should export version constant", () => {
		expect(version).toBeDefined();
	});

	it("should match package.json version", () => {
		expect(version).toBe(pkg.version);
	});

	it("should be a string", () => {
		expect(typeof version).toBe("string");
	});
});
