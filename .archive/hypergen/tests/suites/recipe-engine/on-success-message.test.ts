/**
 * Recipe-level onSuccess / onError Message Tests
 *
 * Tests the lifecycle message feature that renders and prints a Jig template
 * after recipe execution completes. The message has access to recipe variables,
 * recipe metadata, and execution result data.
 *
 * Implementation under test:
 *   - RecipeConfig.onSuccess / RecipeConfig.onError fields (types.ts)
 *   - parseRecipeContent() extracting onSuccess/onError from YAML
 *   - renderLifecycleMessage() in RecipeEngine (recipe-engine.ts)
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeEngine } from "~/recipe-engine/recipe-engine";
import { registerDefaultTools } from "~/recipe-engine/tools/index";
import { ToolRegistry } from "~/recipe-engine/tools/registry";
import { initializeJig } from "~/template-engines/jig-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes so we can assert on plain text content. */
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1B\[[0-9;]*m/g, "");
}

let testDir: string;
let engine: RecipeEngine;
let logSpy: ReturnType<typeof vi.spyOn>;

function writeRecipeFile(
	name: string,
	config: {
		variables?: Record<string, any>;
		steps?: any[];
		onSuccess?: string;
		onError?: string;
	},
): string {
	const recipe = {
		name,
		description: `Test recipe: ${name}`,
		variables: config.variables ?? {},
		steps: config.steps ?? [{ name: "noop", tool: "shell", command: "echo ok" }],
		...(config.onSuccess !== undefined ? { onSuccess: config.onSuccess } : {}),
		...(config.onError !== undefined ? { onError: config.onError } : {}),
	};

	const filePath = join(testDir, `${name}.yml`);
	writeFileSync(filePath, yaml.dump(recipe), "utf-8");
	return filePath;
}

function writeTemplate(fileName: string, to: string, body: string): string {
	const content = `---\nto: "${to}"\n---\n${body}`;
	const filePath = join(testDir, fileName);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

async function runRecipe(
	recipePath: string,
	variables: Record<string, any> = {},
	opts: { skipPrompts?: boolean } = {},
) {
	return engine.executeRecipe(
		{ type: "file", path: recipePath },
		{
			variables,
			workingDir: testDir,
			skipPrompts: opts.skipPrompts ?? true,
		},
	);
}

/**
 * Collect all string arguments passed to console.log, stripping ANSI codes.
 * Logger.ok() wraps text in chalk.green() so raw `arg.includes()` won't match.
 */
function getPlainLogLines(): string[] {
	return logSpy.mock.calls
		.map((c) => c[0])
		.filter((arg): arg is string => typeof arg === "string")
		.map(stripAnsi);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	testDir = mkdtempSync(join(tmpdir(), "hypergen-onsuccess-test-"));

	initializeJig({ cache: false });
	ToolRegistry.reset();
	registerDefaultTools();

	// IMPORTANT: Spy on console.log BEFORE creating the engine.
	// RecipeEngine captures `console.log` by reference in its Logger constructor.
	// If we spy after construction, the Logger holds the original (unspied) function.
	logSpy = vi.spyOn(console, "log");

	engine = new RecipeEngine({ workingDir: testDir });
});

afterEach(() => {
	engine.stopCacheCleanup();
	rmSync(testDir, { recursive: true, force: true });
	ToolRegistry.reset();
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Recipe onSuccess / onError messages", () => {
	describe("onSuccess", () => {
		it("should print the onSuccess message after successful execution", async () => {
			const recipePath = writeRecipeFile("simple-success", {
				onSuccess: "All done!",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("All done!"))).toBe(true);
		});

		it("should render Jig variables in the onSuccess message", async () => {
			const recipePath = writeRecipeFile("var-success", {
				variables: {
					name: { type: "string", default: "MyComponent" },
				},
				onSuccess: "Generated {{ name }} successfully!",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath, { name: "UserProfile" });

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("Generated UserProfile successfully!"))).toBe(true);
		});

		it("should render Jig filters and conditionals in onSuccess", async () => {
			const recipePath = writeRecipeFile("filter-success", {
				variables: {
					name: { type: "string", required: true },
				},
				onSuccess: [
					"Component {{ pascalCase(name) }} created.",
					"@if(name)",
					"Name was provided.",
					"@end",
				].join("\n"),
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath, { name: "user-profile" });

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("UserProfile"))).toBe(true);
			expect(lines.some((l) => l.includes("Name was provided."))).toBe(true);
		});

		it("should have access to result metadata in the render context", async () => {
			writeTemplate("hello.jig", "hello.txt", "Hello World");

			const recipePath = writeRecipeFile("result-access", {
				onSuccess: "Success: {{ result.success }}, files: {{ result.filesCreated.length }}",
				steps: [{ name: "gen", tool: "template", template: "hello.jig" }],
			});

			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("Success: true"))).toBe(true);
			expect(lines.some((l) => l.includes("files: 1"))).toBe(true);
		});

		it("should have access to recipe metadata in the render context", async () => {
			const recipePath = writeRecipeFile("recipe-meta-access", {
				onSuccess: 'Recipe "{{ recipe.name }}" completed',
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes('Recipe "recipe-meta-access" completed'))).toBe(true);
		});
	});

	describe("onError", () => {
		it("should NOT print onError when recipe succeeds", async () => {
			const recipePath = writeRecipeFile("no-error-on-success", {
				onSuccess: "Yay!",
				onError: "Something went wrong!",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("Something went wrong!"))).toBe(false);
			expect(lines.some((l) => l.includes("Yay!"))).toBe(true);
		});
	});

	describe("absent onSuccess / onError", () => {
		it("should not crash or print extra output when onSuccess is absent", async () => {
			const recipePath = writeRecipeFile("no-lifecycle-messages", {
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);

			const lines = getPlainLogLines();
			const lifecycleMsg = lines.some(
				(l) => l.includes("All done!") || l.includes("Something went wrong!"),
			);
			expect(lifecycleMsg).toBe(false);
		});

		it("should not crash when a failing recipe has no onError", async () => {
			// When a step fails, the current step executor throws before
			// renderLifecycleMessage is called. Verify the engine throws
			// a proper error and does not crash unexpectedly.
			const recipePath = writeRecipeFile("no-onerror-on-failure", {
				steps: [
					{
						name: "fail-step",
						tool: "shell",
						command: "false",
					},
				],
			});

			await expect(
				engine.executeRecipe(
					{ type: "file", path: recipePath },
					{
						workingDir: testDir,
						skipPrompts: true,
						stepOptions: { retries: 0 },
					},
				),
			).rejects.toThrow();
		});
	});

	describe("rendering error resilience", () => {
		it("should silently handle Jig template syntax errors in onSuccess", async () => {
			const recipePath = writeRecipeFile("bad-template-syntax", {
				// Deliberately broken Jig syntax: unclosed @if tag
				onSuccess: "@if(true)\nHello\n",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			// Should not throw - renderLifecycleMessage catches template errors
			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);
		});

		it("should silently handle undefined variable references in onSuccess", async () => {
			const recipePath = writeRecipeFile("undefined-var-ref", {
				onSuccess: "Value is: {{ nonExistentVariable }}",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			// Should not throw
			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);
		});

		it("should silently handle errors when calling non-existent filter in onSuccess", async () => {
			const recipePath = writeRecipeFile("bad-filter", {
				onSuccess: "{{ nonExistentFilter(name) }}",
				variables: {
					name: { type: "string", default: "test" },
				},
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			// Should not throw - the render error is caught and debug-logged
			const result = await runRecipe(recipePath);

			expect(result.success).toBe(true);
		});
	});

	describe("YAML parsing of onSuccess / onError", () => {
		it("should parse onSuccess from recipe YAML via loadRecipe", async () => {
			const recipePath = writeRecipeFile("parse-check", {
				onSuccess: "Parsed OK!",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const loadResult = await engine.loadRecipe({
				type: "file",
				path: recipePath,
			});

			expect(loadResult.recipe.onSuccess).toBe("Parsed OK!");
			expect(loadResult.recipe.onError).toBeUndefined();
		});

		it("should parse both onSuccess and onError from recipe YAML", async () => {
			const recipePath = writeRecipeFile("parse-both", {
				onSuccess: "Success msg",
				onError: "Error msg",
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const loadResult = await engine.loadRecipe({
				type: "file",
				path: recipePath,
			});

			expect(loadResult.recipe.onSuccess).toBe("Success msg");
			expect(loadResult.recipe.onError).toBe("Error msg");
		});

		it("should parse multiline onSuccess from YAML block scalar", async () => {
			const content = [
				"name: multiline-test",
				"variables: {}",
				"steps:",
				"  - name: noop",
				"    tool: shell",
				"    command: echo ok",
				"onSuccess: |",
				"  Line one.",
				"  Line two.",
				"  Line three.",
			].join("\n");

			const filePath = join(testDir, "multiline-test.yml");
			writeFileSync(filePath, content, "utf-8");

			const loadResult = await engine.loadRecipe({
				type: "file",
				path: filePath,
			});

			expect(loadResult.recipe.onSuccess).toContain("Line one.");
			expect(loadResult.recipe.onSuccess).toContain("Line two.");
			expect(loadResult.recipe.onSuccess).toContain("Line three.");
		});

		it("should leave onSuccess undefined when not present in YAML", async () => {
			const recipePath = writeRecipeFile("no-success-field", {
				steps: [{ name: "noop", tool: "shell", command: "echo ok" }],
			});

			const loadResult = await engine.loadRecipe({
				type: "file",
				path: recipePath,
			});

			expect(loadResult.recipe.onSuccess).toBeUndefined();
			expect(loadResult.recipe.onError).toBeUndefined();
		});
	});

	describe("onSuccess with template steps", () => {
		it("should print onSuccess after template step generates files", async () => {
			writeTemplate("component.jig", "components/greeting.ts", 'export const greeting = "hello"');

			const recipePath = writeRecipeFile("template-success", {
				variables: {
					name: { type: "string", default: "Greeting" },
				},
				onSuccess: "{{ name }} component generated!",
				steps: [{ name: "gen", tool: "template", template: "component.jig" }],
			});

			const result = await runRecipe(recipePath, { name: "Greeting" });

			expect(result.success).toBe(true);
			expect(result.filesCreated.length).toBeGreaterThanOrEqual(1);

			const lines = getPlainLogLines();
			expect(lines.some((l) => l.includes("Greeting component generated!"))).toBe(true);
		});
	});
});
