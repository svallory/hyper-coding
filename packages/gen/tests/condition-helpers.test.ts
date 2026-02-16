import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecipeEngine } from "#recipe-engine/recipe-engine";
import type { RecipeExecutionOptions, RecipeSource } from "#recipe-engine/recipe-engine";
import { registerDefaultTools } from "#recipe-engine/tools/index";
import { ToolRegistry } from "#recipe-engine/tools/registry";

describe("Condition Helpers (fileExists, dirExists)", () => {
	let tempDir: string;
	let engine: RecipeEngine;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "condition-helpers-test-"));
		ToolRegistry.reset();
		registerDefaultTools();
		engine = new RecipeEngine({
			workingDir: tempDir,
		});
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Helper: build a RecipeSource of type 'content' from a YAML string.
	 * This avoids needing to write recipe files to disk.
	 */
	function recipeSource(yamlContent: string, name = "test-recipe"): RecipeSource {
		return { type: "content", content: yamlContent, name };
	}

	/**
	 * Helper: default execution options targeting the temp directory.
	 */
	function opts(extra: Partial<RecipeExecutionOptions> = {}): RecipeExecutionOptions {
		return {
			variables: {},
			workingDir: tempDir,
			skipPrompts: true,
			...extra,
		};
	}

	/**
	 * Build minimal recipe YAML with a single shell step guarded by a `when` condition.
	 */
	function recipeWithCondition(condition: string): string {
		return [
			"name: test-recipe",
			"variables: {}",
			"steps:",
			"  - name: conditional-step",
			"    tool: shell",
			`    command: "echo test"`,
			`    when: "${condition}"`,
		].join("\n");
	}

	// ---------------------------------------------------------------------------
	// fileExists
	// ---------------------------------------------------------------------------

	describe("fileExists", () => {
		it("should return true for an existing file", async () => {
			writeFileSync(join(tempDir, "test.txt"), "hello");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('test.txt')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should return false for a missing file", async () => {
			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('nonexistent.txt')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should handle nested file paths", async () => {
			mkdirSync(join(tempDir, "src", "config"), { recursive: true });
			writeFileSync(join(tempDir, "src", "config", "settings.json"), "{}");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('src/config/settings.json')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should return true for a directory (existsSync returns true for dirs)", async () => {
			// fileExists uses fs.existsSync, which returns true for directories too
			mkdirSync(join(tempDir, "somedir"));

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('somedir')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			// existsSync returns true for directories, so the step is NOT skipped
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should work with absolute paths", async () => {
			const absPath = join(tempDir, "absolute-file.txt");
			writeFileSync(absPath, "content");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition(`fileExists('${absPath}')`)),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should handle files with dashes and underscores", async () => {
			writeFileSync(join(tempDir, "file-with-dashes.txt"), "a");
			writeFileSync(join(tempDir, "file_with_underscores.txt"), "b");

			const r1 = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('file-with-dashes.txt')")),
				opts(),
			);
			expect(r1.stepResults[0].status).not.toBe("skipped");

			const r2 = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('file_with_underscores.txt')")),
				opts(),
			);
			expect(r2.stepResults[0].status).not.toBe("skipped");
		});
	});

	// ---------------------------------------------------------------------------
	// dirExists
	// ---------------------------------------------------------------------------

	describe("dirExists", () => {
		it("should return true for an existing directory", async () => {
			mkdirSync(join(tempDir, "src"));

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('src')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should return false for a missing directory", async () => {
			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('missing-dir')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should return false for a file (not a directory)", async () => {
			writeFileSync(join(tempDir, "notadir.txt"), "just a file");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('notadir.txt')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should handle nested directory paths", async () => {
			mkdirSync(join(tempDir, "src", "components", "forms"), {
				recursive: true,
			});

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('src/components/forms')")),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should work with absolute paths", async () => {
			const absDir = join(tempDir, "absolute-dir");
			mkdirSync(absDir);

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition(`dirExists('${absDir}')`)),
				opts(),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should handle directories with dashes and underscores", async () => {
			mkdirSync(join(tempDir, "dir-with-dashes"));
			mkdirSync(join(tempDir, "dir_with_underscores"));

			const r1 = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('dir-with-dashes')")),
				opts(),
			);
			expect(r1.stepResults[0].status).not.toBe("skipped");

			const r2 = await engine.executeRecipe(
				recipeSource(recipeWithCondition("dirExists('dir_with_underscores')")),
				opts(),
			);
			expect(r2.stepResults[0].status).not.toBe("skipped");
		});
	});

	// ---------------------------------------------------------------------------
	// Condition with recipe variables
	// ---------------------------------------------------------------------------

	describe("Condition with variables", () => {
		it("should make recipe variables available in when expressions", async () => {
			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: framework-check",
				"    tool: shell",
				'    command: "echo test"',
				"    when: \"framework === 'next'\"",
			].join("\n");

			const result = await engine.executeRecipe(
				recipeSource(yaml),
				opts({ variables: { framework: "next" } }),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should skip when variable condition is false", async () => {
			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: framework-check",
				"    tool: shell",
				'    command: "echo test"',
				"    when: \"framework === 'next'\"",
			].join("\n");

			const result = await engine.executeRecipe(
				recipeSource(yaml),
				opts({ variables: { framework: "vue" } }),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should pass variables as arguments to fileExists", async () => {
			writeFileSync(join(tempDir, "config.json"), "{}");

			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: check-file",
				"    tool: shell",
				'    command: "echo test"',
				'    when: "fileExists(fileName)"',
			].join("\n");

			const result = await engine.executeRecipe(
				recipeSource(yaml),
				opts({ variables: { fileName: "config.json" } }),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should pass variables as arguments to dirExists", async () => {
			mkdirSync(join(tempDir, "components"));

			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: check-dir",
				"    tool: shell",
				'    command: "echo test"',
				'    when: "dirExists(dirName)"',
			].join("\n");

			const result = await engine.executeRecipe(
				recipeSource(yaml),
				opts({ variables: { dirName: "components" } }),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should support dynamic path construction with variables", async () => {
			mkdirSync(join(tempDir, "src", "components"), { recursive: true });
			writeFileSync(
				join(tempDir, "src", "components", "Button.tsx"),
				"export const Button = () => {}",
			);

			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: check-component",
				"    tool: shell",
				'    command: "echo test"',
				`    when: "fileExists(dir + '/' + component + '.tsx')"`,
			].join("\n");

			const result = await engine.executeRecipe(
				recipeSource(yaml),
				opts({ variables: { dir: "src/components", component: "Button" } }),
			);

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});
	});

	// ---------------------------------------------------------------------------
	// Combined conditions
	// ---------------------------------------------------------------------------

	describe("Combined conditions", () => {
		it("should handle fileExists AND dirExists both true", async () => {
			writeFileSync(join(tempDir, "package.json"), "{}");
			mkdirSync(join(tempDir, "src"));

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('package.json') && dirExists('src')")),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should skip when one side of AND is false", async () => {
			writeFileSync(join(tempDir, "package.json"), "{}");
			// src directory intentionally NOT created

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('package.json') && dirExists('src')")),
				opts(),
			);

			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should handle OR conditions (at least one true)", async () => {
			writeFileSync(join(tempDir, "file1.txt"), "a");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('file1.txt') || fileExists('file2.txt')")),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should skip when both sides of OR are false", async () => {
			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('a.txt') || fileExists('b.txt')")),
				opts(),
			);

			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should handle negation with !", async () => {
			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("!fileExists('nonexistent.txt')")),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should handle complex boolean expressions", async () => {
			mkdirSync(join(tempDir, "src"));
			writeFileSync(join(tempDir, "package.json"), "{}");
			writeFileSync(join(tempDir, "tsconfig.json"), "{}");

			const result = await engine.executeRecipe(
				recipeSource(
					recipeWithCondition(
						"(dirExists('src') && fileExists('package.json')) || fileExists('tsconfig.json')",
					),
				),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});
	});

	// ---------------------------------------------------------------------------
	// Multiple steps with different conditions
	// ---------------------------------------------------------------------------

	describe("Multiple steps with different conditions", () => {
		it("should execute only steps whose conditions are true", async () => {
			writeFileSync(join(tempDir, "file1.txt"), "content");
			mkdirSync(join(tempDir, "dir1"));

			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: step1-should-run",
				"    tool: shell",
				'    command: "echo step1"',
				"    when: \"fileExists('file1.txt')\"",
				"  - name: step2-should-skip",
				"    tool: shell",
				'    command: "echo step2"',
				"    when: \"fileExists('nonexistent.txt')\"",
				"  - name: step3-should-run",
				"    tool: shell",
				'    command: "echo step3"',
				"    when: \"dirExists('dir1')\"",
				"  - name: step4-should-skip",
				"    tool: shell",
				'    command: "echo step4"',
				"    when: \"dirExists('nonexistent-dir')\"",
			].join("\n");

			const result = await engine.executeRecipe(recipeSource(yaml), opts());

			// Step results may arrive in a different order than declared
			// (the executor may batch skipped vs executed steps), so look up by name.
			const byName = Object.fromEntries(result.stepResults.map((r) => [r.stepName, r]));

			expect(result.stepResults).toHaveLength(4);
			expect(byName["step1-should-run"].status).not.toBe("skipped");
			expect(byName["step2-should-skip"].status).toBe("skipped");
			expect(byName["step3-should-run"].status).not.toBe("skipped");
			expect(byName["step4-should-skip"].status).toBe("skipped");
		});
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe("Edge cases", () => {
		it("should handle empty string path (existsSync on empty resolves to cwd)", async () => {
			// fileExists('') resolves to projectRoot via path.resolve(projectRoot, '')
			// which equals projectRoot itself, a directory that exists
			// existsSync returns true for it
			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('')")),
				opts(),
			);

			// The temp dir itself exists, so existsSync returns true
			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should handle current directory reference", async () => {
			writeFileSync(join(tempDir, "file.txt"), "content");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("fileExists('./file.txt')")),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should handle double negation", async () => {
			writeFileSync(join(tempDir, "file.txt"), "content");

			const result = await engine.executeRecipe(
				recipeSource(recipeWithCondition("!!fileExists('file.txt')")),
				opts(),
			);

			expect(result.stepResults[0].status).not.toBe("skipped");
		});

		it("should gracefully handle a condition that throws (evaluates to false)", async () => {
			// An invalid expression should be caught by the try/catch in createConditionEvaluator
			// and return false, causing the step to be skipped
			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: bad-condition",
				"    tool: shell",
				'    command: "echo test"',
				'    when: "this is not valid javascript"',
			].join("\n");

			const result = await engine.executeRecipe(recipeSource(yaml), opts());

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).toBe("skipped");
		});

		it("should handle steps without a when condition (always runs)", async () => {
			const yaml = [
				"name: test-recipe",
				"variables: {}",
				"steps:",
				"  - name: always-run",
				"    tool: shell",
				'    command: "echo test"',
			].join("\n");

			const result = await engine.executeRecipe(recipeSource(yaml), opts());

			expect(result.stepResults).toHaveLength(1);
			expect(result.stepResults[0].status).not.toBe("skipped");
		});
	});
});
