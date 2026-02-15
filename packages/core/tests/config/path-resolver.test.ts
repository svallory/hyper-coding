/**
 * PathResolver Tests
 *
 * Comprehensive tests for the PathResolver class which resolves CLI path segments
 * into concrete recipe file paths or group directories.
 *
 * Resolution algorithm:
 *   1. Direct file paths (./  ../  /  .yml  .yaml)
 *   2. Kit-based resolution (kit -> cookbook -> recipe)
 *   3. Search-dir fallback (greedy filesystem walk)
 *   4. Slash-separated single arg splitting
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKitFile } from "#/parsers/kit-parser";
import type { ParsedKit } from "#/parsers/kit-parser";
import { PathResolver } from "#/parsers/path-resolver";
import type { ResolvedPath } from "#/parsers/path-resolver";

// ---------------------------------------------------------------------------
// Helpers to build the fixture directory tree
// ---------------------------------------------------------------------------

function writeYaml(filePath: string, content: string): void {
	fs.mkdirpSync(path.dirname(filePath));
	fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Create the full fixture directory structure under `root`:
 *
 * root/
 *   kits/
 *     nextjs/
 *       kit.yml
 *       cookbooks/
 *         component/
 *           cookbook.yml  (defaults.recipe: "add")
 *           add/recipe.yml
 *           remove/recipe.yml
 *         crud/
 *           cookbook.yml  (no defaults)
 *           resource/recipe.yml
 *           list/recipe.yml
 *   search/
 *     my-cookbook/
 *       my-recipe/
 *         recipe.yml
 *   direct-recipes/
 *     simple/
 *       recipe.yml
 *   cwd/                 (simulated current working directory)
 *     local-recipe.yml
 *     subdir/
 *       nested-recipe.yml
 */
function createFixtures(root: string): void {
	// -- Kit: nextjs ----------------------------------------------------------
	writeYaml(
		path.join(root, "kits", "nextjs", "kit.yml"),
		`\
name: "@kit/nextjs"
cookbooks:
  - "./cookbooks/*/cookbook.yml"
defaults:
  cookbook: component
`,
	);

	// Cookbook: component (with default recipe)
	writeYaml(
		path.join(root, "kits", "nextjs", "cookbooks", "component", "cookbook.yml"),
		`\
name: "component"
defaults:
  recipe: "add"
`,
	);
	writeYaml(
		path.join(
			root,
			"kits",
			"nextjs",
			"cookbooks",
			"component",
			"add",
			"recipe.yml",
		),
		`\
name: component-add
steps: []
`,
	);
	writeYaml(
		path.join(
			root,
			"kits",
			"nextjs",
			"cookbooks",
			"component",
			"remove",
			"recipe.yml",
		),
		`\
name: component-remove
steps: []
`,
	);

	// Cookbook: crud (no defaults)
	writeYaml(
		path.join(root, "kits", "nextjs", "cookbooks", "crud", "cookbook.yml"),
		`\
name: "crud"
`,
	);
	writeYaml(
		path.join(
			root,
			"kits",
			"nextjs",
			"cookbooks",
			"crud",
			"resource",
			"recipe.yml",
		),
		`\
name: crud-resource
steps: []
`,
	);
	writeYaml(
		path.join(
			root,
			"kits",
			"nextjs",
			"cookbooks",
			"crud",
			"list",
			"recipe.yml",
		),
		`\
name: crud-list
steps: []
`,
	);

	// -- Search directory ------------------------------------------------------
	writeYaml(
		path.join(root, "search", "my-cookbook", "my-recipe", "recipe.yml"),
		`\
name: my-recipe
steps: []
`,
	);

	// -- Direct recipes search directory ---------------------------------------
	writeYaml(
		path.join(root, "direct-recipes", "simple", "recipe.yml"),
		`\
name: simple-recipe
steps: []
`,
	);

	// -- Simulated cwd with local files ----------------------------------------
	writeYaml(
		path.join(root, "cwd", "local-recipe.yml"),
		`\
name: local-recipe
steps: []
`,
	);
	writeYaml(
		path.join(root, "cwd", "subdir", "nested-recipe.yml"),
		`\
name: nested-recipe
steps: []
`,
	);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("PathResolver", () => {
	let tempDir: string;
	let cwdDir: string;
	let kitMap: Map<string, ParsedKit>;
	let searchDirs: string[];

	beforeEach(async () => {
		// Create a unique temp directory for every test
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "path-resolver-test-"));
		cwdDir = path.join(tempDir, "cwd");

		// Build the fixture tree
		createFixtures(tempDir);

		// Parse the kit to get a real ParsedKit via the kit-parser
		const kitYmlPath = path.join(tempDir, "kits", "nextjs", "kit.yml");
		const parsedKit = await parseKitFile(kitYmlPath);
		expect(parsedKit.isValid).toBe(true);

		kitMap = new Map<string, ParsedKit>();
		// Register under the short name "nextjs" (mirrors deriveShortName("@kit/nextjs"))
		kitMap.set("nextjs", parsedKit);

		searchDirs = [
			path.join(tempDir, "search"),
			path.join(tempDir, "direct-recipes"),
		];
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// =========================================================================
	// 1. Direct file path bypass
	// =========================================================================

	describe("Direct file path bypass", () => {
		it("resolves a ./ relative path to the absolute file, remaining empty", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["./local-recipe.yml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(path.join(cwdDir, "local-recipe.yml"));
			expect(result?.consumed).toEqual(["./local-recipe.yml"]);
			expect(result?.remaining).toEqual([]);
		});

		it("puts extra segments into remaining when using a direct path", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["./local-recipe.yml", "extra"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(path.join(cwdDir, "local-recipe.yml"));
			expect(result?.consumed).toEqual(["./local-recipe.yml"]);
			expect(result?.remaining).toEqual(["extra"]);
		});

		it("returns null when the direct .yml file does not exist", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nonexistent.yml"]);

			expect(result).toBeNull();
		});

		it("treats segments starting with ../ as direct paths", async () => {
			// From cwd/subdir/, "../local-recipe.yml" should resolve
			const subDir = path.join(cwdDir, "subdir");
			const resolver = new PathResolver(kitMap, searchDirs, subDir);
			const result = await resolver.resolve(["../local-recipe.yml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(path.join(cwdDir, "local-recipe.yml"));
			expect(result?.consumed).toEqual(["../local-recipe.yml"]);
			expect(result?.remaining).toEqual([]);
		});

		it("treats segments starting with / as direct (absolute) paths", async () => {
			const absolutePath = path.join(cwdDir, "local-recipe.yml");
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([absolutePath]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(absolutePath);
			expect(result?.consumed).toEqual([absolutePath]);
			expect(result?.remaining).toEqual([]);
		});

		it("treats a bare .yaml-ending segment as a direct path", async () => {
			// Create a .yaml file for this case
			const yamlFile = path.join(cwdDir, "another.yaml");
			writeYaml(yamlFile, "name: another\nsteps: []\n");

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["another.yaml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(yamlFile);
		});

		it("resolves a ./ path with nested subdirectory", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["./subdir/nested-recipe.yml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(cwdDir, "subdir", "nested-recipe.yml"),
			);
		});

		it("returns null for a nonexistent absolute path", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["/absolutely/does/not/exist.yml"]);

			expect(result).toBeNull();
		});

		it("preserves multiple extra segments in remaining", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([
				"./local-recipe.yml",
				"arg1",
				"arg2",
				"arg3",
			]);

			expect(result).not.toBeNull();
			expect(result?.remaining).toEqual(["arg1", "arg2", "arg3"]);
		});
	});

	// =========================================================================
	// 2. Kit-based resolution
	// =========================================================================

	describe("Kit-based resolution", () => {
		it("resolves [kit, cookbook, recipe] to the recipe path with empty remaining", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "component", "add"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
			expect(result?.consumed).toEqual(["nextjs", "component", "add"]);
			expect(result?.remaining).toEqual([]);
			// fullPath should point to the actual recipe.yml
			expect(result?.fullPath).toBe(
				path.join(
					tempDir,
					"kits",
					"nextjs",
					"cookbooks",
					"component",
					"add",
					"recipe.yml",
				),
			);
		});

		it("puts extra segments after recipe into remaining", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([
				"nextjs",
				"component",
				"add",
				"Button",
			]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
			expect(result?.consumed).toEqual(["nextjs", "component", "add"]);
			expect(result?.remaining).toEqual(["Button"]);
		});

		it("resolves a different cookbook/recipe combination", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "crud", "resource"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("crud");
			expect(result?.recipe).toBe("resource");
			expect(result?.fullPath).toBe(
				path.join(
					tempDir,
					"kits",
					"nextjs",
					"cookbooks",
					"crud",
					"resource",
					"recipe.yml",
				),
			);
			expect(result?.remaining).toEqual([]);
		});

		it("resolves [kit, cookbook] to the default recipe when the cookbook defines one", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "component"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
			expect(result?.consumed).toEqual(["nextjs", "component"]);
			expect(result?.remaining).toEqual([]);
		});

		it("resolves [kit, cookbook] as group when cookbook has no default recipe", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "crud"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("group");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("crud");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "kits", "nextjs", "cookbooks", "crud"),
			);
			expect(result?.consumed).toEqual(["nextjs", "crud"]);
			expect(result?.remaining).toEqual([]);
		});

		it("resolves [kit] alone using kit defaults (cookbook -> default recipe)", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
			// consumed should include kit + cookbook (both resolved via defaults)
			expect(result?.consumed).toEqual(["nextjs", "component"]);
			expect(result?.remaining).toEqual([]);
		});

		it("falls through to search dirs when kit name does not match", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["unknown-kit", "something"]);

			// Should not match the nextjs kit; falls through to search dirs.
			// Neither search dir has "unknown-kit/something", so null.
			expect(result).toBeNull();
		});

		it("resolves the other recipe in the component cookbook", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "component", "remove"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.recipe).toBe("remove");
			expect(result?.fullPath).toBe(
				path.join(
					tempDir,
					"kits",
					"nextjs",
					"cookbooks",
					"component",
					"remove",
					"recipe.yml",
				),
			);
		});

		it("resolves crud/list recipe correctly", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "crud", "list"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("crud");
			expect(result?.recipe).toBe("list");
		});

		it("passes remaining segments when recipe has no match but cookbook has a default", async () => {
			// ["nextjs", "component", "Button"] -- "Button" is not a recipe name.
			// Because the component cookbook has a default recipe "add", the resolver should
			// use that default and treat "Button" as a positional arg.
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "component", "Button"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.recipe).toBe("add");
			expect(result?.remaining).toEqual(["Button"]);
		});

		it("treats unmatched recipe under no-default cookbook as group with remaining", async () => {
			// ["nextjs", "crud", "nonexistent"] -- "nonexistent" is not a recipe.
			// crud has no default recipe, so it becomes a group execution with "nonexistent" in remaining.
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs", "crud", "nonexistent"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("group");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("crud");
			expect(result?.remaining).toEqual(["nonexistent"]);
		});

		it("resolves multiple extra segments after a known recipe", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([
				"nextjs",
				"crud",
				"resource",
				"Org",
				"--force",
			]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.recipe).toBe("resource");
			expect(result?.remaining).toEqual(["Org", "--force"]);
		});

		it("returns null when kit has no default cookbook and only kit name given", async () => {
			// Create a kit without defaults
			const noDefaultKitDir = path.join(tempDir, "kits", "bare");
			writeYaml(
				path.join(noDefaultKitDir, "kit.yml"),
				`\
name: "bare-kit"
`,
			);
			const bareKit = await parseKitFile(path.join(noDefaultKitDir, "kit.yml"));
			const localKitMap = new Map<string, ParsedKit>();
			localKitMap.set("bare", bareKit);

			const resolver = new PathResolver(localKitMap, [], cwdDir);
			const result = await resolver.resolve(["bare"]);

			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// 3. Search-dir fallback
	// =========================================================================

	describe("Search-dir fallback", () => {
		it("resolves [cookbook, recipe] via search dirs", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["my-cookbook", "my-recipe"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "my-cookbook", "my-recipe", "recipe.yml"),
			);
			expect(result?.consumed).toContain("my-cookbook");
			expect(result?.consumed).toContain("my-recipe");
			expect(result?.remaining).toEqual([]);
		});

		it("resolves a single-level recipe name via search dirs", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["simple"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "direct-recipes", "simple", "recipe.yml"),
			);
		});

		it("tries the first search dir before the second", async () => {
			// Create an overlapping recipe in both search dirs
			writeYaml(
				path.join(tempDir, "search", "overlap", "recipe.yml"),
				"name: overlap-search\nsteps: []\n",
			);
			writeYaml(
				path.join(tempDir, "direct-recipes", "overlap", "recipe.yml"),
				"name: overlap-direct\nsteps: []\n",
			);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["overlap"]);

			expect(result).not.toBeNull();
			// First search dir should win
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "overlap", "recipe.yml"),
			);
		});

		it("skips nonexistent search directories gracefully", async () => {
			const resolver = new PathResolver(
				kitMap,
				["/nonexistent/search/dir", path.join(tempDir, "direct-recipes")],
				cwdDir,
			);
			const result = await resolver.resolve(["simple"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
		});

		it("returns null when no search dirs match", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["totally-unknown"]);

			expect(result).toBeNull();
		});

		it("resolves a group when the directory has subdirs with recipe.yml but no recipe.yml itself", async () => {
			// my-cookbook/ has no recipe.yml at its root but has my-recipe/recipe.yml inside
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["my-cookbook"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("group");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "my-cookbook"),
			);
		});

		it("uses greedy matching: prefers the longest segment match", async () => {
			// Create a structure where both a/recipe.yml and a/b/recipe.yml exist
			writeYaml(
				path.join(tempDir, "search", "deep", "recipe.yml"),
				"name: deep-shallow\nsteps: []\n",
			);
			writeYaml(
				path.join(tempDir, "search", "deep", "nested", "recipe.yml"),
				"name: deep-nested\nsteps: []\n",
			);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);

			// With ["deep", "nested"], greedy matching should prefer deep/nested/recipe.yml
			const result = await resolver.resolve(["deep", "nested"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "deep", "nested", "recipe.yml"),
			);
			expect(result?.remaining).toEqual([]);
		});

		it("falls back to shorter match when longer path does not exist", async () => {
			// deep/recipe.yml exists but deep/nonexistent/ does not
			writeYaml(
				path.join(tempDir, "search", "deep2", "recipe.yml"),
				"name: deep2\nsteps: []\n",
			);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["deep2", "extra-arg"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "deep2", "recipe.yml"),
			);
			expect(result?.remaining).toEqual(["extra-arg"]);
		});

		it("puts leftover segments into remaining after greedy match", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([
				"my-cookbook",
				"my-recipe",
				"positional-arg",
			]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.remaining).toEqual(["positional-arg"]);
		});
	});

	// =========================================================================
	// 4. Slash-separated single arg
	// =========================================================================

	describe("Slash-separated single arg", () => {
		it('splits "cookbook/recipe" and resolves via search dirs', async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["my-cookbook/my-recipe"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(
				path.join(tempDir, "search", "my-cookbook", "my-recipe", "recipe.yml"),
			);
		});

		it('splits "kit/cookbook/recipe" and resolves via kit', async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs/crud/resource"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("crud");
			expect(result?.recipe).toBe("resource");
		});

		it("returns null for an unresolvable slash-separated path", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nonexistent/path/here"]);

			expect(result).toBeNull();
		});

		it("does not attempt slash-splitting when there are multiple segments", async () => {
			// Slash-splitting only kicks in for a single segment containing "/"
			// Multi-segment input goes through the normal algorithm directly
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["my-cookbook", "my-recipe"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
		});

		it('splits "kit/cookbook" and resolves to default recipe', async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs/component"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
		});
	});

	// =========================================================================
	// 5. Edge cases
	// =========================================================================

	describe("Edge cases", () => {
		it("returns null for empty segments array", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve([]);

			expect(result).toBeNull();
		});

		it("returns null with no kits, no search dirs, and a non-direct path", async () => {
			const resolver = new PathResolver(new Map(), [], cwdDir);
			const result = await resolver.resolve(["some", "random", "path"]);

			expect(result).toBeNull();
		});

		it("returns null for a single non-matching segment with no fallbacks", async () => {
			const resolver = new PathResolver(new Map(), [], cwdDir);
			const result = await resolver.resolve(["nope"]);

			expect(result).toBeNull();
		});

		it("still resolves direct paths when no kits or search dirs are configured", async () => {
			const resolver = new PathResolver(new Map(), [], cwdDir);
			const result = await resolver.resolve(["./local-recipe.yml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(path.join(cwdDir, "local-recipe.yml"));
		});

		it("handles a segment that looks like a path but is not a file", async () => {
			// "./nonexistent-dir/file.yml" -- starts with ./ but the file does not exist
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["./nonexistent-dir/file.yml"]);

			expect(result).toBeNull();
		});

		it("handles kit registered with empty cookbooks directory", async () => {
			const emptyKitDir = path.join(tempDir, "kits", "empty");
			writeYaml(
				path.join(emptyKitDir, "kit.yml"),
				`\
name: "empty-kit"
cookbooks:
  - "./cookbooks/*/cookbook.yml"
defaults:
  cookbook: nothing
`,
			);
			fs.mkdirpSync(path.join(emptyKitDir, "cookbooks"));

			const emptyKit = await parseKitFile(path.join(emptyKitDir, "kit.yml"));
			const localKitMap = new Map<string, ParsedKit>();
			localKitMap.set("empty", emptyKit);

			const resolver = new PathResolver(localKitMap, [], cwdDir);
			const result = await resolver.resolve(["empty"]);

			// Kit has defaults.cookbook: "nothing" but no actual cookbooks exist
			expect(result).toBeNull();
		});

		it("does not confuse a file name segment with a kit name", async () => {
			// If a segment matches a kit name but there is a direct-path indicator (.yml), direct takes priority
			writeYaml(
				path.join(cwdDir, "nextjs.yml"),
				"name: nextjs-direct\nsteps: []\n",
			);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["nextjs.yml"]);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("recipe");
			expect(result?.fullPath).toBe(path.join(cwdDir, "nextjs.yml"));
			// Should NOT have kit/cookbook/recipe set since this is a direct path
			expect(result?.kit).toBeUndefined();
		});

		it('the ResolvedPath type field is always "recipe" or "group"', async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);

			const recipeResult = await resolver.resolve([
				"nextjs",
				"component",
				"add",
			]);
			expect(recipeResult?.type).toBe("recipe");

			const groupResult = await resolver.resolve(["nextjs", "crud"]);
			expect(groupResult?.type).toBe("group");
		});

		it("handles segments with only whitespace by not matching anything", async () => {
			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			const result = await resolver.resolve(["  "]);

			expect(result).toBeNull();
		});

		it("handles multiple kits in the map", async () => {
			// Add a second kit
			const secondKitDir = path.join(tempDir, "kits", "react");
			writeYaml(
				path.join(secondKitDir, "kit.yml"),
				`\
name: "react-kit"
cookbooks:
  - "./cookbooks/*/cookbook.yml"
`,
			);
			writeYaml(
				path.join(secondKitDir, "cookbooks", "hooks", "cookbook.yml"),
				`\
name: "hooks"
defaults:
  recipe: "add"
`,
			);
			writeYaml(
				path.join(secondKitDir, "cookbooks", "hooks", "add", "recipe.yml"),
				`\
name: hooks-add
steps: []
`,
			);

			const reactKit = await parseKitFile(path.join(secondKitDir, "kit.yml"));
			kitMap.set("react", reactKit);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);

			// Both kits should resolve independently
			const nextjsResult = await resolver.resolve([
				"nextjs",
				"component",
				"add",
			]);
			expect(nextjsResult).not.toBeNull();
			expect(nextjsResult?.kit).toBe("nextjs");

			const reactResult = await resolver.resolve(["react", "hooks", "add"]);
			expect(reactResult).not.toBeNull();
			expect(reactResult?.kit).toBe("react");
			expect(reactResult?.cookbook).toBe("hooks");
			expect(reactResult?.recipe).toBe("add");
		});

		it("kit resolution takes priority over search-dir fallback for same name", async () => {
			// Create a directory in search dirs that matches the kit name
			writeYaml(
				path.join(tempDir, "search", "nextjs", "recipe.yml"),
				"name: nextjs-in-search\nsteps: []\n",
			);

			const resolver = new PathResolver(kitMap, searchDirs, cwdDir);
			// "nextjs" should match the kit first, not the search dir
			const result = await resolver.resolve(["nextjs"]);

			expect(result).not.toBeNull();
			// Kit resolution gives us the default cookbook/recipe
			expect(result?.kit).toBe("nextjs");
			expect(result?.cookbook).toBe("component");
			expect(result?.recipe).toBe("add");
		});
	});
});
