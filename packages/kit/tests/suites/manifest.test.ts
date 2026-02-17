/**
 * Tests for manifest management functions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	addKitToManifest,
	extractGitInfo,
	extractPackageVersion,
	getKitFromManifest,
	getManifestPath,
	isKitInstalled,
	listInstalledKits,
	loadManifest,
	removeKitFromManifest,
	saveManifest,
} from "#manifest";
import {
	CORRUPTED_JSON_STRING,
	EMPTY_MANIFEST,
	POPULATED_MANIFEST,
	SAMPLE_KIT_ENTRY,
	SAMPLE_KIT_ENTRY_NPM,
} from "../fixtures/manifests.js";
import { createKitDir, createTempProject } from "../helpers/temp-project.js";

describe("getManifestPath", () => {
	it("returns correct path for .hyper/kits/manifest.json", () => {
		const result = getManifestPath("/my/project");
		expect(result).toBe("/my/project/.hyper/kits/manifest.json");
	});

	it("handles paths without trailing slash", () => {
		const result = getManifestPath("/my/project");
		expect(result).toBe("/my/project/.hyper/kits/manifest.json");
	});
});

describe("loadManifest", () => {
	it("returns empty manifest when file does not exist", () => {
		const project = createTempProject();

		const result = loadManifest(project.root);

		expect(result).toEqual(EMPTY_MANIFEST);

		project.cleanup();
	});

	it("parses valid manifest JSON", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = loadManifest(project.root);

		expect(result).toEqual(POPULATED_MANIFEST);

		project.cleanup();
	});

	it("returns empty manifest on corrupted JSON and logs warning", () => {
		const project = createTempProject();
		// Ensure the .hyper/kits directory exists
		mkdirSync(project.kitsDir, { recursive: true });
		const manifestPath = join(project.kitsDir, "manifest.json");
		writeFileSync(manifestPath, CORRUPTED_JSON_STRING);

		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = loadManifest(project.root);

		expect(result).toEqual(EMPTY_MANIFEST);
		expect(consoleSpy).toHaveBeenCalledWith(
			"Warning: Failed to read manifest.json, creating new one",
		);

		consoleSpy.mockRestore();
		project.cleanup();
	});
});

describe("saveManifest", () => {
	it("creates directories recursively if missing", () => {
		const project = createTempProject();

		saveManifest(project.root, EMPTY_MANIFEST);

		expect(existsSync(project.kitsDir)).toBe(true);
		expect(existsSync(project.manifestPath)).toBe(true);

		project.cleanup();
	});

	it("writes pretty-printed JSON", () => {
		const project = createTempProject();

		saveManifest(project.root, POPULATED_MANIFEST);

		const content = readFileSync(project.manifestPath, "utf-8");
		expect(content).toContain('{\n  "version"');
		expect(content).toContain('\n  "kits": {');

		project.cleanup();
	});

	it("overwrites existing manifest", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		saveManifest(project.root, EMPTY_MANIFEST);

		const result = loadManifest(project.root);
		expect(result).toEqual(EMPTY_MANIFEST);

		project.cleanup();
	});
});

describe("addKitToManifest", () => {
	it("adds new kit entry", () => {
		const project = createTempProject();

		addKitToManifest(project.root, SAMPLE_KIT_ENTRY);

		const manifest = loadManifest(project.root);
		expect(manifest.kits.nextjs).toEqual(SAMPLE_KIT_ENTRY);

		project.cleanup();
	});

	it("updates existing kit entry", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const updatedEntry = { ...SAMPLE_KIT_ENTRY, version: "2.0.0" };
		addKitToManifest(project.root, updatedEntry);

		const manifest = loadManifest(project.root);
		expect(manifest.kits.nextjs.version).toBe("2.0.0");

		project.cleanup();
	});

	it("preserves other kits when updating one", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		addKitToManifest(project.root, SAMPLE_KIT_ENTRY_NPM);

		const manifest = loadManifest(project.root);
		expect(manifest.kits.nextjs).toBeDefined();
		expect(manifest.kits.react).toBeDefined();
		expect(manifest.kits.vue).toBeDefined();
		expect(manifest.kits[SAMPLE_KIT_ENTRY_NPM.name]).toEqual(SAMPLE_KIT_ENTRY_NPM);

		project.cleanup();
	});
});

describe("removeKitFromManifest", () => {
	it("removes existing kit", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		removeKitFromManifest(project.root, "nextjs");

		const manifest = loadManifest(project.root);
		expect(manifest.kits.nextjs).toBeUndefined();
		expect(manifest.kits.react).toBeDefined();

		project.cleanup();
	});

	it("is no-op when kit does not exist", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		removeKitFromManifest(project.root, "nonexistent");

		const manifest = loadManifest(project.root);
		expect(Object.keys(manifest.kits)).toHaveLength(3);

		project.cleanup();
	});
});

describe("isKitInstalled", () => {
	it("returns true for existing kit", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = isKitInstalled(project.root, "nextjs");

		expect(result).toBe(true);

		project.cleanup();
	});

	it("returns false for missing kit", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = isKitInstalled(project.root, "nonexistent");

		expect(result).toBe(false);

		project.cleanup();
	});

	it("returns false when manifest does not exist", () => {
		const project = createTempProject();

		const result = isKitInstalled(project.root, "any-kit");

		expect(result).toBe(false);

		project.cleanup();
	});
});

describe("getKitFromManifest", () => {
	it("returns entry for existing kit", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = getKitFromManifest(project.root, "nextjs");

		expect(result).toEqual(SAMPLE_KIT_ENTRY);

		project.cleanup();
	});

	it("returns undefined for missing kit", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = getKitFromManifest(project.root, "nonexistent");

		expect(result).toBeUndefined();

		project.cleanup();
	});
});

describe("listInstalledKits", () => {
	it("returns empty array for empty manifest", () => {
		const project = createTempProject();

		const result = listInstalledKits(project.root);

		expect(result).toEqual([]);

		project.cleanup();
	});

	it("returns all kit entries", () => {
		const project = createTempProject({ manifest: POPULATED_MANIFEST });

		const result = listInstalledKits(project.root);

		expect(result).toHaveLength(3);
		expect(result.map((k) => k.name)).toContain("nextjs");
		expect(result.map((k) => k.name)).toContain("react");
		expect(result.map((k) => k.name)).toContain("vue");

		project.cleanup();
	});
});

describe("extractGitInfo", () => {
	it("returns empty object (stub behavior)", async () => {
		const result = await extractGitInfo("/any/path");

		expect(result).toEqual({});
	});
});

describe("extractPackageVersion", () => {
	it("returns version from valid package.json", () => {
		const project = createTempProject();
		createKitDir(project.root, "test-kit", { version: "1.2.3" });

		const kitDir = join(project.root, ".hyper", "kits", "test-kit");
		const result = extractPackageVersion(kitDir);

		expect(result).toBe("1.2.3");

		project.cleanup();
	});

	it("returns undefined when no package.json exists", () => {
		const project = createTempProject();
		createKitDir(project.root, "test-kit");

		const kitDir = join(project.root, ".hyper", "kits", "test-kit");
		const result = extractPackageVersion(kitDir);

		expect(result).toBeUndefined();

		project.cleanup();
	});

	it("returns undefined on malformed package.json", () => {
		const project = createTempProject();
		const kitDir = createKitDir(project.root, "test-kit");
		writeFileSync(join(kitDir, "package.json"), "{invalid json");

		const result = extractPackageVersion(kitDir);

		expect(result).toBeUndefined();

		project.cleanup();
	});

	it("returns undefined when version field is missing", () => {
		const project = createTempProject();
		const kitDir = createKitDir(project.root, "test-kit");
		writeFileSync(join(kitDir, "package.json"), JSON.stringify({ name: "test" }));

		const result = extractPackageVersion(kitDir);

		expect(result).toBeUndefined();

		project.cleanup();
	});
});
