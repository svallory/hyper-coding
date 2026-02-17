import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DynamicCacheManager } from "#dynamic/cache";
import type { DynamicCache } from "#dynamic/types";

/**
 * Tests for DynamicCacheManager.load()
 *
 * We only test the load() method here since rebuild() depends on
 * @hypercli/core kit discovery which requires real kit files on disk.
 * The load() method handles cache file reading and staleness detection.
 */

describe("DynamicCacheManager.load", () => {
	let tmpDir: string;
	let cacheDir: string;
	let projectRoot: string;

	const sampleCache: DynamicCache = {
		builtAt: new Date().toISOString(),
		kits: ["nextjs", "react"],
		cookbooks: { nextjs: ["crud"], react: ["component"] },
		recipes: { "nextjs:crud": ["resource"], "react:component": ["basic"] },
		variables: {
			"nextjs:crud:resource": [{ name: "name", type: "string", position: 0 }],
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyper-cache-test-"));
		cacheDir = path.join(tmpDir, "cache");
		projectRoot = path.join(tmpDir, "project");
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.mkdirSync(path.join(projectRoot, ".hyper", "kits"), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when cache file does not exist", () => {
		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		expect(manager.load()).toBeNull();
	});

	it("returns cached data when file exists and no manifest present", () => {
		// Write cache but no manifest.json — cache is always fresh
		fs.writeFileSync(
			path.join(cacheDir, "dynamic-cache.json"),
			JSON.stringify(sampleCache, null, 2),
			"utf-8",
		);

		// Remove the .hyper/kits dir so manifest doesn't exist
		fs.rmSync(path.join(projectRoot, ".hyper"), { recursive: true, force: true });

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		const result = manager.load();

		expect(result).not.toBeNull();
		expect(result!.kits).toEqual(["nextjs", "react"]);
		expect(result!.cookbooks).toEqual({ nextjs: ["crud"], react: ["component"] });
	});

	it("returns cached data when cache is newer than manifest", () => {
		// Write manifest first
		const manifestPath = path.join(projectRoot, ".hyper", "kits", "manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify({ version: 1 }), "utf-8");

		// Wait a tiny bit, then write cache (so cache is newer)
		const cachePath = path.join(cacheDir, "dynamic-cache.json");
		// Manually set mtimes to control ordering
		fs.writeFileSync(cachePath, JSON.stringify(sampleCache, null, 2), "utf-8");

		// Set manifest mtime to 10 seconds ago, cache to now
		const past = new Date(Date.now() - 10_000);
		fs.utimesSync(manifestPath, past, past);

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		const result = manager.load();

		expect(result).not.toBeNull();
		expect(result!.kits).toEqual(["nextjs", "react"]);
	});

	it("returns null when manifest is newer than cache (stale)", () => {
		// Write cache first
		const cachePath = path.join(cacheDir, "dynamic-cache.json");
		fs.writeFileSync(cachePath, JSON.stringify(sampleCache, null, 2), "utf-8");

		// Set cache mtime to 10 seconds ago
		const past = new Date(Date.now() - 10_000);
		fs.utimesSync(cachePath, past, past);

		// Write manifest now (newer than cache)
		const manifestPath = path.join(projectRoot, ".hyper", "kits", "manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify({ version: 2 }), "utf-8");

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		expect(manager.load()).toBeNull();
	});

	it("returns null when cache file contains invalid JSON", () => {
		fs.writeFileSync(path.join(cacheDir, "dynamic-cache.json"), "not valid json {{{", "utf-8");

		// Remove manifest so staleness check doesn't interfere
		fs.rmSync(path.join(projectRoot, ".hyper"), { recursive: true, force: true });

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		expect(manager.load()).toBeNull();
	});

	it("returns cache with empty kits array when cache has no kits", () => {
		const emptyCache: DynamicCache = {
			builtAt: new Date().toISOString(),
			kits: [],
			cookbooks: {},
			recipes: {},
			variables: {},
		};

		fs.writeFileSync(
			path.join(cacheDir, "dynamic-cache.json"),
			JSON.stringify(emptyCache, null, 2),
			"utf-8",
		);

		fs.rmSync(path.join(projectRoot, ".hyper"), { recursive: true, force: true });

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		const result = manager.load();

		expect(result).not.toBeNull();
		expect(result!.kits).toEqual([]);
	});

	it("handles manifest and cache with exactly equal mtimes by returning cache", () => {
		const cachePath = path.join(cacheDir, "dynamic-cache.json");
		const manifestPath = path.join(projectRoot, ".hyper", "kits", "manifest.json");

		fs.writeFileSync(cachePath, JSON.stringify(sampleCache, null, 2), "utf-8");
		fs.writeFileSync(manifestPath, JSON.stringify({ version: 1 }), "utf-8");

		// Set both to exact same mtime
		const now = new Date();
		fs.utimesSync(cachePath, now, now);
		fs.utimesSync(manifestPath, now, now);

		const manager = new DynamicCacheManager(cacheDir, projectRoot);
		// Equal mtime means manifest is NOT newer, so cache should be returned
		const result = manager.load();
		expect(result).not.toBeNull();
	});
});
