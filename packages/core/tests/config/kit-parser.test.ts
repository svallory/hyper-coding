import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deriveShortName,
	discoverKits,
	getDefaultKitSearchDirs,
	parseKitFile,
	resolveKitCookbooks,
} from "#parsers/kit-parser";

describe("KitParser", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "hypergen-kit-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// parseKitFile
	// ---------------------------------------------------------------------------

	describe("parseKitFile", () => {
		it("parses a valid full kit.yml with all fields", async () => {
			const kitDir = path.join(tempDir, "full-kit");
			fs.mkdirSync(kitDir, { recursive: true });

			const kitYml = path.join(kitDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "@kit/nextjs"
description: "Next.js code generation kit"
version: "1.0.0"
author: "Test Author"
license: "MIT"
keywords:
  - nextjs
  - react
  - generator
defaults:
  cookbook: "component"
  recipe: "add"
cookbooks:
  - "cookbooks/*/cookbook.yml"
  - "cookbooks/**/recipe.yml"
recipes:
  - "recipes/*/recipe.yml"
tags:
  - frontend
  - fullstack
categories:
  - web
  - framework
`.trim(),
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.filePath).toBe(kitYml);
			expect(result.dirPath).toBe(kitDir);
			expect(result.config.name).toBe("@kit/nextjs");
			expect(result.config.description).toBe("Next.js code generation kit");
			expect(result.config.version).toBe("1.0.0");
			expect(result.config.author).toBe("Test Author");
			expect(result.config.license).toBe("MIT");
			expect(result.config.keywords).toEqual(["nextjs", "react", "generator"]);
			expect(result.config.defaults).toEqual({
				cookbook: "component",
				recipe: "add",
			});
			expect(result.config.cookbooks).toEqual([
				"cookbooks/*/cookbook.yml",
				"cookbooks/**/recipe.yml",
			]);
			expect(result.config.recipes).toEqual(["recipes/*/recipe.yml"]);
			expect(result.config.tags).toEqual(["frontend", "fullstack"]);
			expect(result.config.categories).toEqual(["web", "framework"]);
		});

		it("parses a minimal kit.yml with only name", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, 'name: "simple-kit"\n', "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.config.name).toBe("simple-kit");
			expect(result.config.description).toBeUndefined();
			expect(result.config.version).toBeUndefined();
			expect(result.config.author).toBeUndefined();
			expect(result.config.license).toBeUndefined();
			expect(result.config.keywords).toBeUndefined();
			expect(result.config.defaults).toBeUndefined();
			expect(result.config.cookbooks).toBeUndefined();
			expect(result.config.recipes).toBeUndefined();
			expect(result.config.tags).toBeUndefined();
			expect(result.config.categories).toBeUndefined();
		});

		it("reports error and isValid=false when name field is missing", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, 'description: "No name kit"\nversion: "0.1.0"\n', "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(1);
			expect(result.errors.some((e) => e.includes("name"))).toBe(true);
			expect(result.config.name).toBe("");
		});

		it("reports error and isValid=false when name is not a string", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, "name: 123\n", "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("name"))).toBe(true);
		});

		it("reports error for non-existent file path", async () => {
			const fakePath = path.join(tempDir, "does-not-exist", "kit.yml");

			const result = await parseKitFile(fakePath);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Kit file not found");
			expect(result.errors[0]).toContain(fakePath);
			expect(result.filePath).toBe(fakePath);
			expect(result.dirPath).toBe(path.dirname(fakePath));
		});

		it("reports error for empty file", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, "", "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Invalid YAML format or empty file");
		});

		it("reports error for file with only whitespace/comments", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, "# just a comment\n\n", "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Invalid YAML format or empty file");
		});

		it("reports error for invalid YAML syntax", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "test
  bad-indent: [
    unclosed
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(1);
			expect(result.errors[0]).toContain("Failed to parse kit file");
		});

		it("filters out non-string values from array fields", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "filter-test"
keywords:
  - 1
  - "valid-keyword"
  - true
  - null
  - "another-keyword"
tags:
  - 42
  - "real-tag"
categories:
  - "legit"
  - false
cookbooks:
  - 999
  - "cookbooks/*/cookbook.yml"
recipes:
  - "recipes/*/recipe.yml"
  - 0
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.config.keywords).toEqual(["valid-keyword", "another-keyword"]);
			expect(result.config.tags).toEqual(["real-tag"]);
			expect(result.config.categories).toEqual(["legit"]);
			expect(result.config.cookbooks).toEqual(["cookbooks/*/cookbook.yml"]);
			expect(result.config.recipes).toEqual(["recipes/*/recipe.yml"]);
		});

		it("parses defaults with only cookbook set (no recipe)", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "defaults-test"
defaults:
  cookbook: "page"
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.config.defaults).toEqual({ cookbook: "page" });
			expect(result.config.defaults?.recipe).toBeUndefined();
		});

		it("parses defaults with only recipe set (no cookbook)", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "defaults-test"
defaults:
  recipe: "create"
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.config.defaults).toEqual({ recipe: "create" });
			expect(result.config.defaults?.cookbook).toBeUndefined();
		});

		it("ignores non-string description/version/author/license values", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "type-check-test"
description: 123
version: true
author: 456
license: false
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.config.description).toBeUndefined();
			expect(result.config.version).toBeUndefined();
			expect(result.config.author).toBeUndefined();
			expect(result.config.license).toBeUndefined();
		});

		it("ignores defaults when it is not an object", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "bad-defaults"
defaults: "not-an-object"
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			// defaults: "not-an-object" passes typeof === 'object' check? No, string is not object.
			// So defaults should be undefined.
			expect(result.config.defaults).toBeUndefined();
		});

		it("ignores non-string defaults.cookbook and defaults.recipe", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "bad-defaults-values"
defaults:
  cookbook: 123
  recipe: true
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			// defaults is an object, but cookbook/recipe are not strings, so they won't be set
			expect(result.config.defaults).toEqual({});
		});

		it("ignores keywords when not an array", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(
				kitYml,
				`
name: "non-array-keywords"
keywords: "not-an-array"
`,
				"utf-8",
			);

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(true);
			expect(result.config.keywords).toBeUndefined();
		});

		it("handles YAML with scalar value (not an object)", async () => {
			const kitYml = path.join(tempDir, "kit.yml");
			fs.writeFileSync(kitYml, '"just a string"', "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Invalid YAML format or empty file");
		});

		it("sets dirPath to the parent directory of the kit file", async () => {
			const nested = path.join(tempDir, "a", "b", "c");
			fs.mkdirSync(nested, { recursive: true });
			const kitYml = path.join(nested, "kit.yml");
			fs.writeFileSync(kitYml, 'name: "nested"\n', "utf-8");

			const result = await parseKitFile(kitYml);

			expect(result.dirPath).toBe(nested);
		});
	});

	// ---------------------------------------------------------------------------
	// deriveShortName
	// ---------------------------------------------------------------------------

	describe("deriveShortName", () => {
		it("strips @kit/ scope from scoped name", () => {
			expect(deriveShortName("@kit/nextjs")).toBe("nextjs");
		});

		it("strips arbitrary @scope/ prefix", () => {
			expect(deriveShortName("@scope/my-kit")).toBe("my-kit");
		});

		it("returns plain name unchanged", () => {
			expect(deriveShortName("plain-name")).toBe("plain-name");
		});

		it("only strips the first scope segment from names with slashes", () => {
			// @a/b/c => replace(@a/, '') => b/c
			expect(deriveShortName("@a/b/c")).toBe("b/c");
		});

		it("returns empty string for empty input", () => {
			expect(deriveShortName("")).toBe("");
		});

		it("does not strip when @ is not at start", () => {
			expect(deriveShortName("name@scope/foo")).toBe("name@scope/foo");
		});

		it("handles scope with complex characters", () => {
			expect(deriveShortName("@my-org-123/cool-kit")).toBe("cool-kit");
		});
	});

	// ---------------------------------------------------------------------------
	// getDefaultKitSearchDirs
	// ---------------------------------------------------------------------------

	describe("getDefaultKitSearchDirs", () => {
		it("returns .hyper/kits, kits/, and node_modules/@kit/ relative to project root", () => {
			const dirs = getDefaultKitSearchDirs("/my/project");

			expect(dirs).toHaveLength(3);
			expect(dirs[0]).toBe(path.join("/my/project", ".hyper", "kits"));
			expect(dirs[1]).toBe(path.join("/my/project", "kits"));
			expect(dirs[2]).toBe(path.join("/my/project", "node_modules", "@kit"));
		});

		it("works with trailing slash in project root", () => {
			// path.join normalizes, so trailing slash is handled
			const dirs = getDefaultKitSearchDirs("/my/project/");

			expect(dirs).toHaveLength(3);
			expect(dirs[0]).toBe(path.join("/my/project", ".hyper", "kits"));
			expect(dirs[1]).toBe(path.join("/my/project", "kits"));
			expect(dirs[2]).toBe(path.join("/my/project", "node_modules", "@kit"));
		});

		it("works with relative-looking project root", () => {
			const dirs = getDefaultKitSearchDirs(".");

			expect(dirs).toHaveLength(3);
			expect(dirs[0]).toBe(path.join(".", ".hyper", "kits"));
			expect(dirs[1]).toBe(path.join(".", "kits"));
			expect(dirs[2]).toBe(path.join(".", "node_modules", "@kit"));
		});
	});

	// ---------------------------------------------------------------------------
	// discoverKits
	// ---------------------------------------------------------------------------

	describe("discoverKits", () => {
		it("discovers kits in subdirectories containing kit.yml", async () => {
			const kitsDir = path.join(tempDir, "kits");

			// Create two valid kits as subdirectories
			const kitA = path.join(kitsDir, "kit-a");
			const kitB = path.join(kitsDir, "kit-b");
			fs.mkdirSync(kitA, { recursive: true });
			fs.mkdirSync(kitB, { recursive: true });

			fs.writeFileSync(path.join(kitA, "kit.yml"), 'name: "alpha-kit"\n', "utf-8");
			fs.writeFileSync(path.join(kitB, "kit.yml"), 'name: "@scope/beta-kit"\n', "utf-8");

			const result = await discoverKits([kitsDir]);

			expect(result.size).toBe(2);
			expect(result.has("alpha-kit")).toBe(true);
			expect(result.has("beta-kit")).toBe(true);
			expect(result.get("alpha-kit")?.config.name).toBe("alpha-kit");
			expect(result.get("beta-kit")?.config.name).toBe("@scope/beta-kit");
		});

		it("skips non-directory entries in search directories", async () => {
			const kitsDir = path.join(tempDir, "kits");
			fs.mkdirSync(kitsDir, { recursive: true });

			// Create a file (not a directory) named "not-a-dir"
			fs.writeFileSync(path.join(kitsDir, "not-a-dir"), "just a file\n", "utf-8");

			// Create a valid kit directory
			const realKit = path.join(kitsDir, "real-kit");
			fs.mkdirSync(realKit, { recursive: true });
			fs.writeFileSync(path.join(realKit, "kit.yml"), 'name: "real-kit"\n', "utf-8");

			const result = await discoverKits([kitsDir]);

			expect(result.size).toBe(1);
			expect(result.has("real-kit")).toBe(true);
		});

		it("skips invalid kits (missing name field)", async () => {
			const kitsDir = path.join(tempDir, "kits");
			const invalidKit = path.join(kitsDir, "bad-kit");
			const validKit = path.join(kitsDir, "good-kit");
			fs.mkdirSync(invalidKit, { recursive: true });
			fs.mkdirSync(validKit, { recursive: true });

			fs.writeFileSync(path.join(invalidKit, "kit.yml"), 'description: "no name here"\n', "utf-8");
			fs.writeFileSync(path.join(validKit, "kit.yml"), 'name: "good-kit"\n', "utf-8");

			const result = await discoverKits([kitsDir]);

			expect(result.size).toBe(1);
			expect(result.has("good-kit")).toBe(true);
		});

		it("silently ignores non-existent search directories", async () => {
			const nonExistent = path.join(tempDir, "does-not-exist");

			const result = await discoverKits([nonExistent]);

			expect(result.size).toBe(0);
		});

		it("discovers a direct kit.yml at the search dir root", async () => {
			const directKitDir = path.join(tempDir, "direct-kit");
			fs.mkdirSync(directKitDir, { recursive: true });
			fs.writeFileSync(path.join(directKitDir, "kit.yml"), 'name: "direct-kit"\n', "utf-8");

			const result = await discoverKits([directKitDir]);

			expect(result.size).toBe(1);
			expect(result.has("direct-kit")).toBe(true);
		});

		it("first discovery wins: does not overwrite with later directory discovery", async () => {
			// Two search dirs, each with a kit that has the same derived short name.
			// The first one found should be kept.
			const dir1 = path.join(tempDir, "dir1");
			const dir2 = path.join(tempDir, "dir2");

			// dir1: subdirectory kit named "@scope/mykit" (short: "mykit")
			const kit1 = path.join(dir1, "mykit-subdir");
			fs.mkdirSync(kit1, { recursive: true });
			fs.writeFileSync(
				path.join(kit1, "kit.yml"),
				'name: "@scope/mykit"\ndescription: "first"\n',
				"utf-8",
			);

			// dir2: direct kit.yml also named "mykit" (short: "mykit")
			fs.mkdirSync(dir2, { recursive: true });
			fs.writeFileSync(
				path.join(dir2, "kit.yml"),
				'name: "mykit"\ndescription: "second"\n',
				"utf-8",
			);

			const result = await discoverKits([dir1, dir2]);

			expect(result.size).toBe(1);
			expect(result.get("mykit")?.config.description).toBe("first");
		});

		it("subdirectory kit discovery takes precedence over direct kit.yml in the same dir", async () => {
			// If a dir has both a subdirectory kit and a direct kit.yml with the same short name,
			// the subdirectory is discovered first in the loop, so it wins.
			const kitsDir = path.join(tempDir, "kits");
			const subKit = path.join(kitsDir, "mykit");
			fs.mkdirSync(subKit, { recursive: true });

			fs.writeFileSync(
				path.join(subKit, "kit.yml"),
				'name: "mykit"\ndescription: "from-subdir"\n',
				"utf-8",
			);
			// Also a direct kit.yml in kitsDir with same short name
			fs.writeFileSync(
				path.join(kitsDir, "kit.yml"),
				'name: "mykit"\ndescription: "from-direct"\n',
				"utf-8",
			);

			const result = await discoverKits([kitsDir]);

			expect(result.size).toBe(1);
			expect(result.get("mykit")?.config.description).toBe("from-subdir");
		});

		it("discovers kits from multiple search directories", async () => {
			const dir1 = path.join(tempDir, "dir1");
			const dir2 = path.join(tempDir, "dir2");

			const kitA = path.join(dir1, "kit-a");
			const kitB = path.join(dir2, "kit-b");
			fs.mkdirSync(kitA, { recursive: true });
			fs.mkdirSync(kitB, { recursive: true });

			fs.writeFileSync(path.join(kitA, "kit.yml"), 'name: "kit-a"\n', "utf-8");
			fs.writeFileSync(path.join(kitB, "kit.yml"), 'name: "kit-b"\n', "utf-8");

			const result = await discoverKits([dir1, dir2]);

			expect(result.size).toBe(2);
			expect(result.has("kit-a")).toBe(true);
			expect(result.has("kit-b")).toBe(true);
		});

		it("skips subdirectories without a kit.yml", async () => {
			const kitsDir = path.join(tempDir, "kits");
			const emptySubdir = path.join(kitsDir, "no-kit");
			const validSubdir = path.join(kitsDir, "has-kit");
			fs.mkdirSync(emptySubdir, { recursive: true });
			fs.mkdirSync(validSubdir, { recursive: true });

			// No kit.yml in emptySubdir
			fs.writeFileSync(path.join(validSubdir, "kit.yml"), 'name: "has-kit"\n', "utf-8");

			const result = await discoverKits([kitsDir]);

			expect(result.size).toBe(1);
			expect(result.has("has-kit")).toBe(true);
		});

		it("returns an empty map when all search dirs are empty", async () => {
			const emptyDir = path.join(tempDir, "empty");
			fs.mkdirSync(emptyDir, { recursive: true });

			const result = await discoverKits([emptyDir]);

			expect(result.size).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// resolveKitCookbooks
	// ---------------------------------------------------------------------------

	describe("resolveKitCookbooks", () => {
		it("resolves glob patterns to cookbook directories", async () => {
			const kitDir = path.join(tempDir, "mykit");

			// Create cookbook structure
			const cb1 = path.join(kitDir, "cookbooks", "component");
			const cb2 = path.join(kitDir, "cookbooks", "page");
			fs.mkdirSync(cb1, { recursive: true });
			fs.mkdirSync(cb2, { recursive: true });

			fs.writeFileSync(path.join(cb1, "cookbook.yml"), "name: component\n", "utf-8");
			fs.writeFileSync(path.join(cb2, "cookbook.yml"), "name: page\n", "utf-8");

			const result = await resolveKitCookbooks(kitDir, ["cookbooks/*/cookbook.yml"]);

			expect(result).toHaveLength(2);
			expect(result).toContain(cb1);
			expect(result).toContain(cb2);
		});

		it("de-duplicates directories found through multiple glob patterns", async () => {
			const kitDir = path.join(tempDir, "dedup-kit");
			const cbDir = path.join(kitDir, "cookbooks", "crud");
			fs.mkdirSync(cbDir, { recursive: true });

			fs.writeFileSync(path.join(cbDir, "cookbook.yml"), "name: crud\n", "utf-8");

			// Both patterns will match the same directory
			const result = await resolveKitCookbooks(kitDir, [
				"cookbooks/*/cookbook.yml",
				"cookbooks/crud/cookbook.yml",
			]);

			expect(result).toHaveLength(1);
			expect(result[0]).toBe(cbDir);
		});

		it("resolves directory matches directly (not just files)", async () => {
			const kitDir = path.join(tempDir, "dir-match-kit");
			const cbDir = path.join(kitDir, "cookbooks", "action");
			fs.mkdirSync(cbDir, { recursive: true });

			// The glob pattern matches the directory itself
			const result = await resolveKitCookbooks(kitDir, ["cookbooks/*"]);

			expect(result).toHaveLength(1);
			expect(result[0]).toBe(cbDir);
		});

		it("uses parent directory when glob matches a file", async () => {
			const kitDir = path.join(tempDir, "file-match-kit");
			const cbDir = path.join(kitDir, "cookbooks", "form");
			fs.mkdirSync(cbDir, { recursive: true });

			fs.writeFileSync(path.join(cbDir, "cookbook.yml"), "name: form\n", "utf-8");

			const result = await resolveKitCookbooks(kitDir, ["cookbooks/*/cookbook.yml"]);

			expect(result).toHaveLength(1);
			// The match is a file, so dirname is used
			expect(result[0]).toBe(cbDir);
		});

		it("returns empty array when no patterns match", async () => {
			const kitDir = path.join(tempDir, "empty-kit");
			fs.mkdirSync(kitDir, { recursive: true });

			const result = await resolveKitCookbooks(kitDir, ["nonexistent/*/cookbook.yml"]);

			expect(result).toHaveLength(0);
		});

		it("handles multiple different glob patterns matching different directories", async () => {
			const kitDir = path.join(tempDir, "multi-pattern-kit");

			const cb1 = path.join(kitDir, "cookbooks", "alpha");
			const rec1 = path.join(kitDir, "recipes", "beta");
			fs.mkdirSync(cb1, { recursive: true });
			fs.mkdirSync(rec1, { recursive: true });

			fs.writeFileSync(path.join(cb1, "cookbook.yml"), "name: alpha\n", "utf-8");
			fs.writeFileSync(path.join(rec1, "recipe.yml"), "name: beta\n", "utf-8");

			const result = await resolveKitCookbooks(kitDir, [
				"cookbooks/*/cookbook.yml",
				"recipes/*/recipe.yml",
			]);

			expect(result).toHaveLength(2);
			expect(result).toContain(cb1);
			expect(result).toContain(rec1);
		});

		it("handles deeply nested glob patterns", async () => {
			const kitDir = path.join(tempDir, "deep-kit");
			const deepCb = path.join(kitDir, "cookbooks", "crud", "add");
			fs.mkdirSync(deepCb, { recursive: true });

			fs.writeFileSync(path.join(deepCb, "recipe.yml"), "name: add\n", "utf-8");

			const result = await resolveKitCookbooks(kitDir, ["cookbooks/**/recipe.yml"]);

			expect(result).toHaveLength(1);
			expect(result[0]).toBe(deepCb);
		});

		it("returns empty array for empty globs list", async () => {
			const kitDir = path.join(tempDir, "no-globs-kit");
			fs.mkdirSync(kitDir, { recursive: true });

			const result = await resolveKitCookbooks(kitDir, []);

			expect(result).toHaveLength(0);
		});
	});
});
