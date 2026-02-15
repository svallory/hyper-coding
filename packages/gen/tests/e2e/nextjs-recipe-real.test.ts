/**
 * E2E Test: Real Next.js Recipe with Recursive Normalization
 *
 * This test verifies that the actual Next.js project create recipe works
 * with the recursive step normalization fix.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecipeEngine } from "#/recipe-engine/recipe-engine";
import { ensureDirsToolFactory } from "#/recipe-engine/tools/ensure-dirs-tool";
import { getToolRegistry } from "#/recipe-engine/tools/registry";
import { sequenceToolFactory } from "#/recipe-engine/tools/sequence-tool";
import { templateToolFactory } from "#/recipe-engine/tools/template-tool";

describe("E2E: Real Next.js Recipe", () => {
	let tempDir: string;
	let recipeEngine: RecipeEngine;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypergen-nextjs-test-"));

		// Reset singleton to get clean state (avoids stale tool instances from other test files)
		const { ToolRegistry } = await import("../../src/recipe-engine/tools/registry");
		ToolRegistry.reset();

		// Register required tools fresh
		const registry = getToolRegistry();
		registry.register("template", "default", templateToolFactory, {
			description: "Template tool",
			category: "core",
		});
		registry.register("sequence", "default", sequenceToolFactory, {
			description: "Sequence tool",
			category: "core",
		});
		registry.register("ensure-dirs", "default", ensureDirsToolFactory, {
			description: "Ensure dirs tool",
			category: "core",
		});

		recipeEngine = new RecipeEngine();
	});

	afterEach(async () => {
		// Comment out cleanup to verify files are actually created
		// await fs.remove(tempDir)
		console.log("\n🗂️  Test output directory:", tempDir);
	});

	// TODO: Fix test isolation — passes alone but fails in full suite due to ToolRegistry
	// singleton state leakage. Run standalone: bun test tests/e2e/nextjs-recipe-real.test.ts
	it.skip("should execute nextjs project create recipe with nested sequences", async () => {
		const recipePath = path.resolve(
			__dirname,
			"../../../../kit/nextjs/cookbooks/project/create/recipe.yml",
		);

		const result = await recipeEngine.executeRecipe(
			{ type: "file", path: recipePath },
			{
				variables: {
					name: "my-app",
					description: "Test Next.js application",
					useSrcDir: false,
					linter: "eslint",
				},
				workingDir: tempDir,
				dryRun: false,
				force: true,
			},
		);

		// Verify execution succeeded
		expect(result.success).toBe(true);
		expect(result.errors).toHaveLength(0);

		// The recipe has:
		// - ensure-dirs (useSrcDir=true): skipped
		// - ensure-dirs (useSrcDir=false): completed
		// - Sequence with nested sequences:
		//   - Sequence 1: 10 templates (8 base + ESLint or Biome conditional)
		//   - Sequence 2: 3 app files
		//   - Sequence 3: 5 static assets
		// Total: 20 steps, with linter=eslint: 17 complete + 3 skipped (useSrcDir + Biome + ensure-dirs when dir exists)
		expect(result.success).toBe(true);
		expect(result.metadata.completedSteps).toBeGreaterThanOrEqual(17);
		expect(result.metadata.completedSteps).toBeLessThanOrEqual(18);
		expect(result.metadata.totalSteps).toBe(20);

		// Verify files were created on disk (filesCreated tracking may be empty due to
		// tool registry state when running in full suite - the filesystem checks below are authoritative)

		// Files are created in name/ subdirectory
		const projectDir = path.join(tempDir, "my-app");

		// Check some key files exist
		expect(await fs.pathExists(path.join(projectDir, "package.json"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "tsconfig.json"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "next.config.ts"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "app", "layout.tsx"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "app", "page.tsx"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "public", "next.svg"))).toBe(true);
		expect(await fs.pathExists(path.join(projectDir, "eslint.config.mjs"))).toBe(true);
	});
});
