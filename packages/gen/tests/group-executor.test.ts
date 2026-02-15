/**
 * GroupExecutor Tests
 *
 * Tests for the GroupExecutor class which discovers recipes in a directory,
 * builds a dependency graph based on provides/required variables, resolves
 * execution order via topological sort, and executes batches — piping
 * providedValues between recipes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
	GroupExecutor,
	type GroupRecipeEntry,
	type RecipeGroup,
} from "#/recipe-engine/group-executor";
import type { RecipeConfig } from "#/recipe-engine/types";
import type {
	RecipeExecutionResult,
	RecipeExecutionOptions,
	RecipeSource,
} from "#/recipe-engine/recipe-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "hypergen-group-test-"));
}

function cleanupTempDir(dirPath: string): void {
	if (dirPath && fs.existsSync(dirPath)) {
		fs.rmSync(dirPath, { recursive: true, force: true });
	}
}

function writeRecipeYml(dirPath: string, content: string = "name: test\nsteps: []\n"): void {
	fs.mkdirSync(dirPath, { recursive: true });
	fs.writeFileSync(path.join(dirPath, "recipe.yml"), content, "utf-8");
}

function makeEntry(
	name: string,
	provides?: Array<{ name: string; type?: string; description?: string }>,
	variables?: Record<string, any>,
): GroupRecipeEntry {
	return {
		name,
		recipeYmlPath: `/fake/${name}/recipe.yml`,
		config: {
			name,
			steps: [],
			provides: provides as any,
			variables: variables as any,
		} as RecipeConfig,
	};
}

function makeSuccessResult(
	recipeName: string,
	variables: Record<string, any> = {},
	providedValues: Record<string, any> = {},
): RecipeExecutionResult {
	return {
		executionId: `exec-${recipeName}`,
		recipe: { name: recipeName, steps: [], variables: {} } as RecipeConfig,
		success: true,
		stepResults: [],
		duration: 10,
		filesCreated: [],
		filesModified: [],
		filesDeleted: [],
		errors: [],
		warnings: [],
		variables,
		metadata: {
			startTime: new Date(),
			endTime: new Date(),
			workingDir: "/tmp",
			totalSteps: 0,
			completedSteps: 0,
			failedSteps: 0,
			skippedSteps: 0,
			providedValues,
		},
	};
}

function makeFailResult(recipeName: string, errorMsg: string): RecipeExecutionResult {
	return {
		executionId: `exec-${recipeName}`,
		recipe: { name: recipeName, steps: [], variables: {} } as RecipeConfig,
		success: false,
		stepResults: [],
		duration: 5,
		filesCreated: [],
		filesModified: [],
		filesDeleted: [],
		errors: [errorMsg],
		warnings: [],
		variables: {},
		metadata: {
			startTime: new Date(),
			endTime: new Date(),
			workingDir: "/tmp",
			totalSteps: 1,
			completedSteps: 0,
			failedSteps: 1,
			skippedSteps: 0,
		},
	};
}

/**
 * Create a mock RecipeEngine whose executeRecipe implementation can be
 * controlled per-recipe. `recipeEntries` is the set of GroupRecipeEntry[]
 * that the mock uses to resolve loadRecipe calls. `executeImpl` allows
 * tests to override the behavior of executeRecipe per recipe name.
 */
function createMockRecipeEngine(
	recipeEntries: GroupRecipeEntry[],
	executeImpl?: (
		source: RecipeSource,
		options: RecipeExecutionOptions,
	) => Promise<RecipeExecutionResult>,
) {
	return {
		loadRecipe: async (source: string | RecipeSource) => {
			const normalized =
				typeof source === "string" ? { type: "file" as const, path: source } : source;
			const entry = recipeEntries.find((e) => e.recipeYmlPath === (normalized as any).path);
			return {
				recipe: entry?.config || ({ name: "unknown", steps: [], variables: {} } as any),
				source: normalized,
				validation: {
					isValid: true,
					errors: [],
					warnings: [],
					recipe: entry?.config as any,
					context: {} as any,
				},
				dependencies: [],
			};
		},
		executeRecipe:
			executeImpl ??
			(async (_source: string | RecipeSource, options: RecipeExecutionOptions = {}) => {
				return makeSuccessResult("test", options.variables || {});
			}),
	} as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GroupExecutor", () => {
	// =========================================================================
	// discoverGroup
	// =========================================================================
	describe("discoverGroup", () => {
		let tempDir: string;
		let executor: GroupExecutor;

		beforeEach(() => {
			tempDir = makeTempDir();
			// discoverGroup only uses the filesystem, but GroupExecutor requires a
			// RecipeEngine in the constructor — we pass a minimal mock since
			// discoverGroup does not call any engine methods.
			executor = new GroupExecutor({} as any);
		});

		afterEach(() => {
			cleanupTempDir(tempDir);
		});

		it("discovers immediate subdirectories with recipe.yml", async () => {
			writeRecipeYml(path.join(tempDir, "recipe-a"), "name: recipe-a\nsteps: []\n");
			writeRecipeYml(path.join(tempDir, "recipe-b"), "name: recipe-b\nsteps: []\n");

			const group = await executor.discoverGroup(tempDir);

			expect(group.dirPath).toBe(tempDir);
			expect(group.recipes).toHaveLength(2);

			const names = group.recipes.map((r) => r.name).sort();
			expect(names).toEqual(["recipe-a", "recipe-b"]);

			// Verify recipeYmlPath is set correctly
			for (const recipe of group.recipes) {
				expect(recipe.recipeYmlPath).toBe(path.join(tempDir, recipe.name, "recipe.yml"));
			}
		});

		it("recurses into directories without recipe.yml (subgroups)", async () => {
			// subgroup/ has no recipe.yml, but subgroup/recipe-c/ does
			writeRecipeYml(path.join(tempDir, "recipe-a"), "name: recipe-a\nsteps: []\n");
			const subgroupDir = path.join(tempDir, "subgroup");
			fs.mkdirSync(subgroupDir, { recursive: true });
			writeRecipeYml(path.join(subgroupDir, "recipe-c"), "name: recipe-c\nsteps: []\n");

			const group = await executor.discoverGroup(tempDir);

			const names = group.recipes.map((r) => r.name).sort();
			expect(names).toEqual(["recipe-a", "recipe-c"]);

			// recipe-c should be found inside the subgroup
			const recipeC = group.recipes.find((r) => r.name === "recipe-c")!;
			expect(recipeC.recipeYmlPath).toBe(path.join(subgroupDir, "recipe-c", "recipe.yml"));
		});

		it("ignores non-directory entries", async () => {
			writeRecipeYml(path.join(tempDir, "recipe-a"), "name: recipe-a\nsteps: []\n");
			// Create a plain file (not a directory) at the same level
			fs.writeFileSync(path.join(tempDir, "not-a-recipe"), "just a file", "utf-8");

			const group = await executor.discoverGroup(tempDir);

			expect(group.recipes).toHaveLength(1);
			expect(group.recipes[0].name).toBe("recipe-a");
		});

		it("returns empty recipes list for an empty directory", async () => {
			const group = await executor.discoverGroup(tempDir);
			expect(group.recipes).toEqual([]);
			expect(group.dirPath).toBe(tempDir);
		});

		it("returns empty recipes list for a non-existent directory", async () => {
			const group = await executor.discoverGroup(path.join(tempDir, "does-not-exist"));
			expect(group.recipes).toEqual([]);
		});
	});

	// =========================================================================
	// buildDependencyGraph
	// =========================================================================
	describe("buildDependencyGraph", () => {
		let executor: GroupExecutor;

		beforeEach(() => {
			executor = new GroupExecutor({} as any);
		});

		it("creates empty dep sets when no provides and no dependencies", () => {
			const entries = [makeEntry("alpha"), makeEntry("beta")];

			const { depGraph, providesMap, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			expect(depGraph.get("alpha")!.size).toBe(0);
			expect(depGraph.get("beta")!.size).toBe(0);
			expect(providesMap.size).toBe(0);
		});

		it("creates dependency when recipe A provides x and recipe B requires x", () => {
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", undefined, {
					x: { type: "string", required: true },
				}),
			];

			const { depGraph, providesMap, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			expect(providesMap.get("x")).toBe("recipe-a");
			// recipe-b depends on recipe-a
			expect(depGraph.get("recipe-b")!.has("recipe-a")).toBe(true);
			// recipe-a has no dependencies
			expect(depGraph.get("recipe-a")!.size).toBe(0);
		});

		it("does NOT create dependency when recipe B has x with a default value", () => {
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", undefined, {
					x: { type: "string", required: true, default: "fallback" },
				}),
			];

			const { depGraph, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			// No dependency because recipe-b has a default for x
			expect(depGraph.get("recipe-b")!.size).toBe(0);
		});

		it("reports error when two recipes provide the same variable", () => {
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", [{ name: "x" }]),
			];

			const { errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("provided by both");
			expect(errors[0]).toContain("recipe-a");
			expect(errors[0]).toContain("recipe-b");
		});

		it("builds a three-recipe chain: A provides x, B requires x & provides y, C requires y", () => {
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", [{ name: "y" }], {
					x: { type: "string", required: true },
				}),
				makeEntry("recipe-c", undefined, {
					y: { type: "string", required: true },
				}),
			];

			const { depGraph, providesMap, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			expect(providesMap.get("x")).toBe("recipe-a");
			expect(providesMap.get("y")).toBe("recipe-b");

			// A has no deps
			expect(depGraph.get("recipe-a")!.size).toBe(0);
			// B depends on A
			expect(depGraph.get("recipe-b")!.has("recipe-a")).toBe(true);
			expect(depGraph.get("recipe-b")!.size).toBe(1);
			// C depends on B
			expect(depGraph.get("recipe-c")!.has("recipe-b")).toBe(true);
			expect(depGraph.get("recipe-c")!.size).toBe(1);
		});

		it("does not create self-dependency when a recipe provides and requires the same variable", () => {
			// recipe-a provides 'x' and also declares variable 'x' as required with no default.
			// The code should NOT add recipe-a as a dependency of itself because provider !== entry.name check.
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }], {
					x: { type: "string", required: true },
				}),
			];

			const { depGraph, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			expect(depGraph.get("recipe-a")!.size).toBe(0);
		});
	});

	// =========================================================================
	// topologicalSort
	// =========================================================================
	describe("topologicalSort", () => {
		let executor: GroupExecutor;

		beforeEach(() => {
			executor = new GroupExecutor({} as any);
		});

		it("returns a single batch with all recipes when there are no dependencies", () => {
			const depGraph = new Map<string, Set<string>>([
				["charlie", new Set()],
				["alpha", new Set()],
				["bravo", new Set()],
			]);

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(1);
			// All in one batch, sorted alphabetically
			expect(batches[0]).toEqual(["alpha", "bravo", "charlie"]);
		});

		it("returns linear batches for a chain: A -> B -> C", () => {
			const depGraph = new Map<string, Set<string>>([
				["A", new Set()],
				["B", new Set(["A"])],
				["C", new Set(["B"])],
			]);

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(3);
			expect(batches[0]).toEqual(["A"]);
			expect(batches[1]).toEqual(["B"]);
			expect(batches[2]).toEqual(["C"]);
		});

		it("groups independent recipes and separates dependents: A,B independent, C depends on both", () => {
			const depGraph = new Map<string, Set<string>>([
				["A", new Set()],
				["B", new Set()],
				["C", new Set(["A", "B"])],
			]);

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(2);
			expect(batches[0]).toEqual(["A", "B"]);
			expect(batches[1]).toEqual(["C"]);
		});

		it("returns empty batches for an empty graph", () => {
			const depGraph = new Map<string, Set<string>>();

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(0);
		});

		it("sorts recipes within each batch alphabetically", () => {
			const depGraph = new Map<string, Set<string>>([
				["zulu", new Set()],
				["mike", new Set()],
				["alpha", new Set()],
				["delta", new Set(["alpha"])],
				["echo", new Set(["alpha"])],
			]);

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(2);
			expect(batches[0]).toEqual(["alpha", "mike", "zulu"]);
			expect(batches[1]).toEqual(["delta", "echo"]);
		});
	});

	// =========================================================================
	// Circular dependency detection (via buildDependencyGraph)
	// =========================================================================
	describe("circular dependency detection", () => {
		let executor: GroupExecutor;

		beforeEach(() => {
			executor = new GroupExecutor({} as any);
		});

		it("detects simple A <-> B circular dependency", () => {
			// A provides 'x', B provides 'y'
			// A requires 'y' (from B), B requires 'x' (from A)
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }], {
					y: { type: "string", required: true },
				}),
				makeEntry("recipe-b", [{ name: "y" }], {
					x: { type: "string", required: true },
				}),
			];

			const { errors } = executor.buildDependencyGraph(entries);

			expect(errors.length).toBeGreaterThanOrEqual(1);
			const circularError = errors.find((e) => e.includes("Circular dependency"));
			expect(circularError).toBeDefined();
		});

		it("detects A -> B -> C -> A circular dependency", () => {
			// A provides 'a', B provides 'b', C provides 'c'
			// A requires 'c' (from C), B requires 'a' (from A), C requires 'b' (from B)
			const entries = [
				makeEntry("recipe-a", [{ name: "a" }], {
					c: { type: "string", required: true },
				}),
				makeEntry("recipe-b", [{ name: "b" }], {
					a: { type: "string", required: true },
				}),
				makeEntry("recipe-c", [{ name: "c" }], {
					b: { type: "string", required: true },
				}),
			];

			const { errors } = executor.buildDependencyGraph(entries);

			expect(errors.length).toBeGreaterThanOrEqual(1);
			const circularError = errors.find((e) => e.includes("Circular dependency"));
			expect(circularError).toBeDefined();
		});
	});

	// =========================================================================
	// executeGroup
	// =========================================================================
	describe("executeGroup", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = makeTempDir();
		});

		afterEach(() => {
			cleanupTempDir(tempDir);
		});

		it("executes a group with no dependencies — all succeed", async () => {
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a"),
				makeEntry("recipe-b"),
				makeEntry("recipe-c"),
			];

			const executionOrder: string[] = [];

			const mockEngine = createMockRecipeEngine(entries, async (source, options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";
				executionOrder.push(name);
				return makeSuccessResult(name, options?.variables || {});
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.recipeResults).toHaveLength(3);
			// All three executed
			expect(executionOrder).toHaveLength(3);
			// With no dependencies, all should be in one batch, sorted alphabetically
			expect(executionOrder.sort()).toEqual(["recipe-a", "recipe-b", "recipe-c"]);
		});

		it("executes recipes in correct dependency order", async () => {
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", [{ name: "y" }], {
					x: { type: "string", required: true },
				}),
				makeEntry("recipe-c", undefined, {
					y: { type: "string", required: true },
				}),
			];

			const executionOrder: string[] = [];

			const mockEngine = createMockRecipeEngine(entries, async (source, options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";
				executionOrder.push(name);

				const providedValues: Record<string, any> = {};
				if (name === "recipe-a") providedValues["x"] = "value-x";
				if (name === "recipe-b") providedValues["y"] = "value-y";

				return makeSuccessResult(name, options?.variables || {}, providedValues);
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);

			// recipe-a must execute before recipe-b, recipe-b before recipe-c
			const idxA = executionOrder.indexOf("recipe-a");
			const idxB = executionOrder.indexOf("recipe-b");
			const idxC = executionOrder.indexOf("recipe-c");

			expect(idxA).toBeLessThan(idxB);
			expect(idxB).toBeLessThan(idxC);

			// Check that result order reflects execution order
			expect(result.recipeResults.map((r) => r.name)).toEqual(executionOrder);
		});

		it("stops execution on failure when continueOnError is false (default)", async () => {
			// Two independent recipes (batch 1), then a dependent (batch 2).
			// First recipe fails => dependent should never execute.
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a"),
				makeEntry("recipe-b"),
				makeEntry("recipe-c", undefined, {
					x: { type: "string", required: true },
				}),
			];
			// We need recipe-a to provide 'x' so recipe-c depends on it
			entries[0] = makeEntry("recipe-a", [{ name: "x" }]);

			const executionOrder: string[] = [];

			const mockEngine = createMockRecipeEngine(entries, async (source, _options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";
				executionOrder.push(name);

				if (name === "recipe-a") {
					return makeFailResult(name, "Intentional failure");
				}
				return makeSuccessResult(name);
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.success).toBe(false);
			// recipe-a and recipe-b are in batch 1 (both independent of each other at batch level)
			// recipe-c is in batch 2 (depends on recipe-a)
			// Since recipe-a fails and continueOnError is false, batch 2 should not execute
			expect(executionOrder).not.toContain("recipe-c");
		});

		it("reports externalParams for required variables not provided by siblings", async () => {
			// recipe-a provides 'x'
			// recipe-b requires 'x' (provided by sibling) AND 'externalVar' (not provided by anyone)
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", undefined, {
					x: { type: "string", required: true },
					externalVar: { type: "string", required: true },
				}),
			];

			const mockEngine = createMockRecipeEngine(entries);
			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.externalParams).toContain("externalVar");
			// 'x' is provided by recipe-a, so it should NOT be in externalParams
			expect(result.externalParams).not.toContain("x");
		});

		it("returns early with errors when dependency graph has errors", async () => {
			// Two recipes provide the same variable => graph error
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", [{ name: "x" }]),
			];

			const executionOrder: string[] = [];
			const mockEngine = createMockRecipeEngine(entries, async (source, _options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";
				executionOrder.push(name);
				return makeSuccessResult(name);
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.success).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toContain("provided by both");
			// No recipes should have been executed
			expect(executionOrder).toHaveLength(0);
			expect(result.recipeResults).toHaveLength(0);
		});

		it("accumulates providedValues across batches", async () => {
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", [{ name: "y" }], {
					x: { type: "string", required: true },
				}),
			];

			const mockEngine = createMockRecipeEngine(entries, async (source, _options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";

				if (name === "recipe-a") {
					return makeSuccessResult(name, {}, { x: "from-a" });
				}
				if (name === "recipe-b") {
					return makeSuccessResult(name, {}, { y: "from-b" });
				}
				return makeSuccessResult(name);
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {
				baseKey: "baseValue",
			});

			expect(result.success).toBe(true);
			// providedValues accumulates base vars + all provided values
			expect(result.providedValues).toMatchObject({
				baseKey: "baseValue",
				x: "from-a",
				y: "from-b",
			});
		});

		it("passes accumulated variables to subsequent recipe executions", async () => {
			const entries: GroupRecipeEntry[] = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", undefined, {
					x: { type: "string", required: true },
				}),
			];

			const receivedVariables: Record<string, Record<string, any>> = {};

			const mockEngine = createMockRecipeEngine(entries, async (source, options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";
				receivedVariables[name] = { ...(options?.variables || {}) };

				if (name === "recipe-a") {
					return makeSuccessResult(name, {}, { x: "provided-by-a" });
				}
				return makeSuccessResult(name, options?.variables || {});
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			await executor.executeGroup(group, { initial: "yes" });

			// recipe-b should have received the 'x' variable provided by recipe-a
			expect(receivedVariables["recipe-b"]).toBeDefined();
			expect(receivedVariables["recipe-b"]["x"]).toBe("provided-by-a");
			expect(receivedVariables["recipe-b"]["initial"]).toBe("yes");
		});

		it("handles recipe execution throwing an exception", async () => {
			const entries: GroupRecipeEntry[] = [makeEntry("recipe-a"), makeEntry("recipe-b")];

			const mockEngine = createMockRecipeEngine(entries, async (source, _options) => {
				const src = source as { type: string; path: string };
				const name = entries.find((e) => e.recipeYmlPath === src.path)?.name ?? "unknown";

				if (name === "recipe-a") {
					throw new Error("Unexpected crash in recipe-a");
				}
				return makeSuccessResult(name);
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.success).toBe(false);
			expect(result.errors.some((e) => e.includes("Unexpected crash in recipe-a"))).toBe(true);
			// Even though recipe-a throws, we should still get a result entry for it
			const recipeAResult = result.recipeResults.find((r) => r.name === "recipe-a");
			expect(recipeAResult).toBeDefined();
			expect(recipeAResult!.result.success).toBe(false);
		});

		it("records duration in the result", async () => {
			const entries: GroupRecipeEntry[] = [makeEntry("recipe-a")];

			const mockEngine = createMockRecipeEngine(entries, async () => {
				// Simulate some execution time
				await new Promise((resolve) => setTimeout(resolve, 15));
				return makeSuccessResult("recipe-a");
			});

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: tempDir, recipes: entries };

			const result = await executor.executeGroup(group, {});

			expect(result.duration).toBeGreaterThanOrEqual(0);
			expect(typeof result.duration).toBe("number");
		});
	});

	// =========================================================================
	// loadGroupConfigs
	// =========================================================================
	describe("loadGroupConfigs", () => {
		it("loads configs for entries that do not already have one", async () => {
			const entries: GroupRecipeEntry[] = [
				{ name: "recipe-a", recipeYmlPath: "/fake/recipe-a/recipe.yml" },
				{
					name: "recipe-b",
					recipeYmlPath: "/fake/recipe-b/recipe.yml",
					config: {
						name: "already-loaded",
						steps: [],
						variables: {},
					} as RecipeConfig,
				},
			];

			const loadCalls: string[] = [];

			const mockEngine = {
				loadRecipe: async (source: any) => {
					loadCalls.push(source.path);
					return {
						recipe: {
							name: path.basename(path.dirname(source.path)),
							steps: [],
							variables: {},
						} as RecipeConfig,
					};
				},
			} as any;

			const executor = new GroupExecutor(mockEngine);
			const group: RecipeGroup = { dirPath: "/fake", recipes: entries };

			await executor.loadGroupConfigs(group);

			// Only recipe-a should have been loaded (recipe-b already had config)
			expect(loadCalls).toEqual(["/fake/recipe-a/recipe.yml"]);
			expect(entries[0].config).toBeDefined();
			expect(entries[0].config!.name).toBe("recipe-a");
			// recipe-b config should be unchanged
			expect(entries[1].config!.name).toBe("already-loaded");
		});
	});

	// =========================================================================
	// Edge cases and integration scenarios
	// =========================================================================
	describe("edge cases", () => {
		let executor: GroupExecutor;

		beforeEach(() => {
			executor = new GroupExecutor({} as any);
		});

		it("handles recipes with no config gracefully in buildDependencyGraph", () => {
			const entries: GroupRecipeEntry[] = [
				{ name: "recipe-a", recipeYmlPath: "/fake/recipe-a/recipe.yml" },
				{ name: "recipe-b", recipeYmlPath: "/fake/recipe-b/recipe.yml" },
			];
			// No config set on either entry

			const { depGraph, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			expect(depGraph.get("recipe-a")!.size).toBe(0);
			expect(depGraph.get("recipe-b")!.size).toBe(0);
		});

		it("handles a recipe with variables but none are required", () => {
			const entries = [
				makeEntry("recipe-a", [{ name: "x" }]),
				makeEntry("recipe-b", undefined, {
					x: { type: "string", required: false },
					y: { type: "string" },
				}),
			];

			const { depGraph, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			// No dependency because none of recipe-b's variables are required without defaults
			expect(depGraph.get("recipe-b")!.size).toBe(0);
		});

		it("handles a required variable not provided by any sibling (no dependency, just external)", () => {
			const entries = [
				makeEntry("recipe-a"),
				makeEntry("recipe-b", undefined, {
					orphanVar: { type: "string", required: true },
				}),
			];

			const { depGraph, errors } = executor.buildDependencyGraph(entries);

			expect(errors).toHaveLength(0);
			// No dependency — orphanVar is not provided by anyone
			expect(depGraph.get("recipe-b")!.size).toBe(0);
		});

		it("topologicalSort breaks out of loop on unresolvable deps (avoids infinite loop)", () => {
			// Manually create a graph with a cycle that buildDependencyGraph would normally catch.
			// topologicalSort handles this by breaking when no progress is made.
			const depGraph = new Map<string, Set<string>>([
				["A", new Set(["B"])],
				["B", new Set(["A"])],
			]);

			const batches = executor.topologicalSort(depGraph);

			// Neither A nor B can be resolved, so we get empty batches
			expect(batches).toHaveLength(0);
		});

		it("handles diamond dependency: A->B, A->C, B->D, C->D", () => {
			const depGraph = new Map<string, Set<string>>([
				["D", new Set()],
				["B", new Set(["D"])],
				["C", new Set(["D"])],
				["A", new Set(["B", "C"])],
			]);

			const batches = executor.topologicalSort(depGraph);

			expect(batches).toHaveLength(3);
			expect(batches[0]).toEqual(["D"]);
			expect(batches[1]).toEqual(["B", "C"]);
			expect(batches[2]).toEqual(["A"]);
		});
	});
});
