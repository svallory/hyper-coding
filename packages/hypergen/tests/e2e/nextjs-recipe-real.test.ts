/**
 * E2E Test: Real Next.js Recipe with Recursive Normalization
 *
 * This test verifies that the actual Next.js project create recipe works
 * with the recursive step normalization fix.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import * as os from "node:os";
import { RecipeEngine } from "~/recipe-engine/recipe-engine";
import { getToolRegistry } from "~/recipe-engine/tools/registry";
import { templateToolFactory } from "~/recipe-engine/tools/template-tool";
import { sequenceToolFactory } from "~/recipe-engine/tools/sequence-tool";
import { ensureDirsToolFactory } from "~/recipe-engine/tools/ensure-dirs-tool";

describe("E2E: Real Next.js Recipe", () => {
	let tempDir: string;
	let recipeEngine: RecipeEngine;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypergen-nextjs-test-"));

		// Register required tools
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

	it("should execute nextjs project create recipe with nested sequences", async () => {
		const recipePath = path.resolve(
			__dirname,
			"../../kits/nextjs/cookbooks/project/create/recipe.yml",
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
		// Total: 20 steps, with linter=eslint: 18 complete + 2 skipped (useSrcDir + Biome)
		expect(result.success).toBe(true);
		expect(result.metadata.completedSteps).toBe(18);
		expect(result.metadata.totalSteps).toBe(20);

		// Verify files were created
		expect(result.filesCreated.length).toBeGreaterThanOrEqual(16);

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
