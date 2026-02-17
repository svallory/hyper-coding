import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompletionResolver } from "#dynamic/resolver";
import type { DynamicCache } from "#dynamic/types";

/**
 * Tests for CompletionResolver
 *
 * parseContext() is a pure function — no cache needed.
 * complete() and getEnumValues() need a loaded cache, which we provide
 * by writing a dynamic-cache.json to a temp directory.
 */

describe("CompletionResolver.parseContext", () => {
	let resolver: CompletionResolver;

	beforeEach(() => {
		// parseContext doesn't touch the cache, so paths don't matter
		resolver = new CompletionResolver("/fake/cache", "/fake/project");
	});

	it("returns kit level with empty prefix for empty words", () => {
		const ctx = resolver.parseContext([]);
		expect(ctx).toEqual({ level: "kit", prefix: "" });
	});

	it("returns kit level with prefix for a single incomplete word", () => {
		const ctx = resolver.parseContext(["ne"]);
		expect(ctx).toEqual({ level: "kit", prefix: "ne" });
	});

	it("returns cookbook level when one complete word plus empty string", () => {
		const ctx = resolver.parseContext(["nextjs", ""]);
		expect(ctx).toEqual({ level: "cookbook", kit: "nextjs", prefix: "" });
	});

	it("returns cookbook level with prefix for one complete word plus partial", () => {
		const ctx = resolver.parseContext(["nextjs", "cr"]);
		expect(ctx).toEqual({ level: "cookbook", kit: "nextjs", prefix: "cr" });
	});

	it("returns recipe level for two complete words plus prefix", () => {
		const ctx = resolver.parseContext(["nextjs", "crud", "re"]);
		expect(ctx).toEqual({
			level: "recipe",
			kit: "nextjs",
			cookbook: "crud",
			prefix: "re",
		});
	});

	it("returns variable level for three complete words plus prefix", () => {
		const ctx = resolver.parseContext(["nextjs", "crud", "resource", "--na"]);
		expect(ctx).toEqual({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "resource",
			prefix: "--na",
		});
	});

	it("returns variable level for three+ complete words plus empty prefix", () => {
		const ctx = resolver.parseContext(["nextjs", "crud", "resource", ""]);
		expect(ctx).toEqual({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "resource",
			prefix: "",
		});
	});

	describe("treats all words as content tokens (routing stripped upstream)", () => {
		it("treats 'gen' as a kit name since routing is stripped by generate command", () => {
			const ctx = resolver.parseContext(["gen", "nextjs"]);
			// Without upstream stripping, "gen" is treated as kit name
			expect(ctx).toEqual({ level: "cookbook", kit: "gen", prefix: "nextjs" });
		});

		it("treats 'kit' as a kit name since routing is stripped by generate command", () => {
			const ctx = resolver.parseContext(["kit", "info"]);
			expect(ctx).toEqual({ level: "cookbook", kit: "kit", prefix: "info" });
		});

		it("handles already-stripped words from gen context", () => {
			// generate.ts strips "gen" → passes ["nextjs", "cr"]
			const ctx = resolver.parseContext(["nextjs", "cr"]);
			expect(ctx).toEqual({ level: "cookbook", kit: "nextjs", prefix: "cr" });
		});

		it("handles already-stripped words from kit info context", () => {
			// generate.ts strips "kit info" → passes ["nextjs"]
			const ctx = resolver.parseContext(["nextjs"]);
			expect(ctx).toEqual({ level: "kit", prefix: "nextjs" });
		});
	});

	it("does not mutate the original words array", () => {
		const words = ["nextjs", "crud", "resource"];
		resolver.parseContext(words);
		expect(words).toEqual(["nextjs", "crud", "resource"]);
	});
});

describe("CompletionResolver.complete", () => {
	let tmpDir: string;
	let resolver: CompletionResolver;

	const testCache: DynamicCache = {
		builtAt: new Date().toISOString(),
		kits: ["nextjs", "react"],
		cookbooks: {
			nextjs: ["crud", "project"],
			react: ["component"],
		},
		recipes: {
			"nextjs:crud": ["resource", "list-page"],
			"nextjs:project": ["create"],
			"react:component": ["basic"],
		},
		variables: {
			"nextjs:crud:resource": [
				{ name: "name", type: "string", position: 0 },
				{
					name: "pages",
					type: "enum",
					values: ["list", "detail", "create", "edit"],
				},
				{ name: "api-route", type: "boolean" },
			],
			"react:component:basic": [{ name: "componentName", type: "string", position: 0 }],
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyper-resolver-test-"));
		// Write the cache file so the resolver loads it without rebuild
		fs.writeFileSync(
			path.join(tmpDir, "dynamic-cache.json"),
			JSON.stringify(testCache, null, 2),
			"utf-8",
		);
		// projectRoot needs no manifest.json so the cache is treated as fresh
		resolver = new CompletionResolver(tmpDir, tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- Kit level ---

	it("returns all kits with empty prefix", async () => {
		const result = await resolver.complete({ level: "kit", prefix: "" });
		expect(result).toEqual(["nextjs", "react"]);
	});

	it("filters kits by prefix", async () => {
		const result = await resolver.complete({ level: "kit", prefix: "ne" });
		expect(result).toEqual(["nextjs"]);
	});

	it("returns empty for non-matching kit prefix", async () => {
		const result = await resolver.complete({ level: "kit", prefix: "x" });
		expect(result).toEqual([]);
	});

	it("filters kits case-insensitively", async () => {
		const result = await resolver.complete({ level: "kit", prefix: "NE" });
		expect(result).toEqual(["nextjs"]);
	});

	// --- Cookbook level ---

	it("returns all cookbooks for a known kit", async () => {
		const result = await resolver.complete({
			level: "cookbook",
			kit: "nextjs",
			prefix: "",
		});
		expect(result).toEqual(["crud", "project"]);
	});

	it("filters cookbooks by prefix", async () => {
		const result = await resolver.complete({
			level: "cookbook",
			kit: "nextjs",
			prefix: "cr",
		});
		expect(result).toEqual(["crud"]);
	});

	it("returns empty for unknown kit at cookbook level", async () => {
		const result = await resolver.complete({
			level: "cookbook",
			kit: "unknown",
			prefix: "",
		});
		expect(result).toEqual([]);
	});

	// --- Recipe level ---

	it("returns all recipes for a known kit:cookbook", async () => {
		const result = await resolver.complete({
			level: "recipe",
			kit: "nextjs",
			cookbook: "crud",
			prefix: "",
		});
		expect(result).toEqual(["resource", "list-page"]);
	});

	it("filters recipes by prefix", async () => {
		const result = await resolver.complete({
			level: "recipe",
			kit: "nextjs",
			cookbook: "crud",
			prefix: "re",
		});
		expect(result).toEqual(["resource"]);
	});

	it("returns empty for unknown cookbook at recipe level", async () => {
		const result = await resolver.complete({
			level: "recipe",
			kit: "nextjs",
			cookbook: "unknown",
			prefix: "",
		});
		expect(result).toEqual([]);
	});

	// --- Variable level ---

	it("returns flag-style completions with -- prefix", async () => {
		const result = await resolver.complete({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "resource",
			prefix: "--",
		});
		expect(result).toEqual(["--name", "--pages", "--api-route"]);
	});

	it("filters flags by prefix after --", async () => {
		const result = await resolver.complete({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "resource",
			prefix: "--pa",
		});
		expect(result).toEqual(["--pages"]);
	});

	it("returns empty without -- prefix at variable level", async () => {
		const result = await resolver.complete({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "resource",
			prefix: "na",
		});
		expect(result).toEqual([]);
	});

	it("returns empty for unknown recipe at variable level", async () => {
		const result = await resolver.complete({
			level: "variable",
			kit: "nextjs",
			cookbook: "crud",
			recipe: "unknown",
			prefix: "--",
		});
		expect(result).toEqual([]);
	});
});

describe("CompletionResolver.getEnumValues", () => {
	let tmpDir: string;
	let resolver: CompletionResolver;

	const testCache: DynamicCache = {
		builtAt: new Date().toISOString(),
		kits: ["nextjs"],
		cookbooks: { nextjs: ["crud"] },
		recipes: { "nextjs:crud": ["resource"] },
		variables: {
			"nextjs:crud:resource": [
				{ name: "name", type: "string", position: 0 },
				{
					name: "pages",
					type: "enum",
					values: ["list", "detail", "create", "edit"],
				},
			],
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyper-enum-test-"));
		fs.writeFileSync(
			path.join(tmpDir, "dynamic-cache.json"),
			JSON.stringify(testCache, null, 2),
			"utf-8",
		);
		resolver = new CompletionResolver(tmpDir, tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns enum values for an enum-typed variable", async () => {
		const result = await resolver.getEnumValues("nextjs", "crud", "resource", "pages");
		expect(result).toEqual(["list", "detail", "create", "edit"]);
	});

	it("returns empty array for a non-enum variable", async () => {
		const result = await resolver.getEnumValues("nextjs", "crud", "resource", "name");
		expect(result).toEqual([]);
	});

	it("returns empty array for unknown variable", async () => {
		const result = await resolver.getEnumValues("nextjs", "crud", "resource", "nonexistent");
		expect(result).toEqual([]);
	});

	it("returns empty array for unknown recipe", async () => {
		const result = await resolver.getEnumValues("nextjs", "crud", "unknown", "pages");
		expect(result).toEqual([]);
	});
});
