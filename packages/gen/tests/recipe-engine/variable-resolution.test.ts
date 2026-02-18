/**
 * Variable Resolution Pipeline Tests
 *
 * Integration tests for the --ask / --no-defaults resolution matrix.
 * Uses the RecipeEngine directly with mocked prompts and AI transport.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TemplateVariable } from "@hypercli/core";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocking
// ---------------------------------------------------------------------------

// Use vi.hoisted to ensure these mocks are available during module hoisting
const { mockPrompt, mockResolveBatch } = vi.hoisted(() => {
	return {
		mockPrompt: vi.fn((prompts: any[]) =>
			Promise.resolve(Object.fromEntries(prompts.map((p: any) => [p.name, `prompted-${p.name}`]))),
		),
		mockResolveBatch: vi.fn(() => Promise.resolve({})),
	};
});

// Mock performInteractivePrompting to avoid actual terminal prompts
vi.mock("#prompts/interactive-prompts", () => ({
	performInteractivePrompting: mockPrompt,
}));

// Mock AiVariableResolver - use vi.hoisted to ensure proper hoisting
// Note: vitest v4 requires 'function' or 'class' syntax (not arrow functions)
// for mocks that will be used as constructors with 'new'.
const { MockAiVariableResolver } = vi.hoisted(() => ({
	MockAiVariableResolver: vi.fn(() => ({ resolveBatch: mockResolveBatch })),
}));

vi.mock("#ai/ai-variable-resolver", () => ({
	AiVariableResolver: MockAiVariableResolver,
}));

import { RecipeEngine } from "#recipe-engine/recipe-engine";
import { registerDefaultTools } from "#recipe-engine/tools/index";

// No mock for resolveTransport — we set ANTHROPIC_API_KEY so the real
// resolveTransport returns ApiTransport for mode: 'api' tests, and
// use mode: 'stdout' config for the fallback-to-interactive test.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let engine: RecipeEngine;

function writeRecipe(
	name: string,
	variables: Record<string, TemplateVariable>,
	steps: any[] = [{ name: "noop", tool: "shell", command: "echo ok" }],
): string {
	const content = yaml.dump({
		name,
		variables,
		steps,
	});
	const filePath = path.join(tempDir, `${name}.yml`);
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

async function runRecipe(
	recipePath: string,
	variables: Record<string, any> = {},
	opts: {
		askMode?: "me" | "ai" | "nobody";
		noDefaults?: boolean;
		aiConfig?: any;
	} = {},
) {
	return engine.executeRecipe(
		{ type: "file", path: recipePath },
		{
			variables,
			workingDir: tempDir,
			askMode: opts.askMode,
			noDefaults: opts.noDefaults,
			aiConfig: opts.aiConfig,
		},
	);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let savedAnthropicKey: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hypergen-varres-test-"));
	engine = new RecipeEngine({ workingDir: tempDir });
	registerDefaultTools();

	// Reset call history but restore default implementations
	mockPrompt.mockReset();
	mockResolveBatch.mockReset();

	// Set a fake API key so resolveTransport returns ApiTransport for mode:'api'
	savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
	process.env.ANTHROPIC_API_KEY = "test-fake-key-for-variable-resolution";

	// Default mock implementation for performInteractivePrompting
	mockPrompt.mockImplementation((prompts: any[]) =>
		Promise.resolve(Object.fromEntries(prompts.map((p: any) => [p.name, `prompted-${p.name}`]))),
	);
});

afterEach(() => {
	if (tempDir && fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
	// Restore original API key
	if (savedAnthropicKey !== undefined) {
		process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
	} else {
		process.env.ANTHROPIC_API_KEY = undefined;
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Variable Resolution Pipeline", () => {
	describe("default behavior (no flags, askMode=me)", () => {
		it("should use default values for variables that have them", async () => {
			const recipePath = writeRecipe("use-defaults", {
				name: { type: "string", required: true },
				color: { type: "string", default: "blue" },
			});

			const result = await runRecipe(recipePath, { name: "MyApp" }, { askMode: "me" });

			expect(result.variables.name).toBe("MyApp");
			expect(result.variables.color).toBe("blue");
			// Should not have prompted for color since it has a default
			expect(mockPrompt).not.toHaveBeenCalled();
		});

		it("should prompt for missing required variables", async () => {
			const recipePath = writeRecipe("prompt-required", {
				name: { type: "string", required: true, description: "App name" },
			});

			const result = await runRecipe(recipePath, {}, { askMode: "me" });

			expect(mockPrompt).toHaveBeenCalledTimes(1);
			expect(result.variables.name).toBe("prompted-name");
		});

		it("should show suggestion as default value in prompt", async () => {
			const recipePath = writeRecipe("suggestion-prompt", {
				port: { type: "number", required: true, suggestion: 3000 },
			});

			mockPrompt.mockImplementationOnce((prompts: any[]) => {
				// Verify the prompt received the suggestion as its default
				expect(prompts[0].default).toBe(3000);
				return Promise.resolve({ port: 3000 });
			});

			const result = await runRecipe(recipePath, {}, { askMode: "me" });
			expect(result.variables.port).toBe(3000);
		});
	});

	describe("--ask=nobody", () => {
		it("should use defaults and error on missing required", async () => {
			const recipePath = writeRecipe("nobody-missing", {
				name: { type: "string", required: true },
				color: { type: "string", default: "red" },
			});

			await expect(runRecipe(recipePath, {}, { askMode: "nobody" })).rejects.toThrow(
				/Missing required variables.*name/,
			);
		});

		it("should succeed when all required vars are provided", async () => {
			const recipePath = writeRecipe("nobody-ok", {
				name: { type: "string", required: true },
				color: { type: "string", default: "red" },
			});

			const result = await runRecipe(recipePath, { name: "Test" }, { askMode: "nobody" });
			expect(result.variables.name).toBe("Test");
			expect(result.variables.color).toBe("red");
		});
	});

	describe("--ask=ai", () => {
		it("should batch unresolved vars to AI resolver", async () => {
			mockResolveBatch.mockResolvedValueOnce({ name: "AiApp" });

			const recipePath = writeRecipe("ai-resolve", {
				name: { type: "string", required: true, description: "App name" },
				color: { type: "string", default: "green" },
			});

			const result = await runRecipe(
				recipePath,
				{},
				{ askMode: "ai", aiConfig: { provider: "anthropic", mode: "api" } },
			);

			expect(mockResolveBatch).toHaveBeenCalledTimes(1);
			expect(result.variables.name).toBe("AiApp");
			expect(result.variables.color).toBe("green"); // default still used
		});

		it("should fall back to interactive when transport is stdout", async () => {
			const recipePath = writeRecipe("ai-fallback", {
				name: { type: "string", required: true },
			});

			// Use mode:'stdout' so the real resolveTransport returns StdoutTransport
			const result = await runRecipe(
				recipePath,
				{},
				{ askMode: "ai", aiConfig: { mode: "stdout" } },
			);

			// Should have fallen back to interactive prompts
			expect(mockPrompt).toHaveBeenCalled();
			expect(result.variables.name).toBe("prompted-name");
			expect(mockResolveBatch).not.toHaveBeenCalled();
		});

		it("should error on missing required when AI returns no value", async () => {
			mockResolveBatch.mockResolvedValueOnce({}); // AI returned nothing

			const recipePath = writeRecipe("ai-missing", {
				name: { type: "string", required: true },
			});

			await expect(
				runRecipe(
					recipePath,
					{},
					{ askMode: "ai", aiConfig: { provider: "anthropic", mode: "api" } },
				),
			).rejects.toThrow(/Missing required variables.*name/);
		});
	});

	describe("--no-defaults", () => {
		it("should ignore defaults and prompt for all vars (with me)", async () => {
			const recipePath = writeRecipe("no-defaults-me", {
				name: { type: "string", required: true },
				color: { type: "string", default: "blue" },
			});

			mockPrompt.mockImplementation((prompts: any[]) => {
				return Promise.resolve(
					Object.fromEntries(prompts.map((p: any) => [p.name, `override-${p.name}`])),
				);
			});

			const result = await runRecipe(
				recipePath,
				{ name: "Given" },
				{ askMode: "me", noDefaults: true },
			);

			// name was provided explicitly so not prompted
			expect(result.variables.name).toBe("Given");
			// color had a default but --no-defaults means it should be prompted
			expect(mockPrompt).toHaveBeenCalled();
			expect(result.variables.color).toBe("override-color");
		});

		it("should pass default as hint to prompt when --no-defaults", async () => {
			const recipePath = writeRecipe("no-defaults-hint", {
				color: { type: "string", default: "blue", required: true },
			});

			mockPrompt.mockImplementationOnce((prompts: any[]) => {
				// The default should be passed as the hint/default for the prompt
				expect(prompts[0].default).toBe("blue");
				return Promise.resolve({ color: "red" });
			});

			const result = await runRecipe(recipePath, {}, { askMode: "me", noDefaults: true });

			expect(result.variables.color).toBe("red");
		});
	});

	describe("--no-defaults --ask=ai", () => {
		it("should send all vars (including those with defaults) to AI", async () => {
			mockResolveBatch.mockResolvedValueOnce({
				name: "AiName",
				color: "purple",
			});

			const recipePath = writeRecipe("no-defaults-ai", {
				name: { type: "string", required: true },
				color: { type: "string", default: "blue" },
			});

			const result = await runRecipe(
				recipePath,
				{},
				{
					askMode: "ai",
					noDefaults: true,
					aiConfig: { provider: "anthropic", mode: "api" },
				},
			);

			expect(mockResolveBatch).toHaveBeenCalledTimes(1);
			// Both vars should have been sent to AI
			const callArgs = mockResolveBatch.mock.calls[0];
			const unresolvedVars = callArgs[0] as any[];
			expect(unresolvedVars.length).toBe(2);
			expect(unresolvedVars.map((v: any) => v.name).sort()).toEqual(["color", "name"]);

			expect(result.variables.name).toBe("AiName");
			expect(result.variables.color).toBe("purple");
		});
	});

	describe("--no-defaults --ask=nobody", () => {
		it("should error on variables with defaults that become unresolved", async () => {
			const recipePath = writeRecipe("no-defaults-nobody", {
				name: { type: "string", required: true },
				color: { type: "string", default: "blue" },
			});

			// name is required and not provided, color has default but --no-defaults
			await expect(
				runRecipe(recipePath, {}, { askMode: "nobody", noDefaults: true }),
			).rejects.toThrow(/Missing required variables/);
		});
	});

	describe("suggestion field", () => {
		it("should not auto-apply suggestion values", async () => {
			const recipePath = writeRecipe("suggestion-no-auto", {
				color: { type: "string", suggestion: "MySuggestion" },
			});

			const result = await runRecipe(recipePath, {}, { askMode: "nobody" });

			// suggestion should NOT be auto-applied (unlike default)
			expect(result.variables.color).toBeUndefined();
		});

		it("should pass suggestion to AI resolver", async () => {
			mockResolveBatch.mockResolvedValueOnce({ port: 3000 });

			const recipePath = writeRecipe("suggestion-ai", {
				port: { type: "number", required: true, suggestion: 3000 },
			});

			const result = await runRecipe(
				recipePath,
				{},
				{ askMode: "ai", aiConfig: { provider: "anthropic", mode: "api" } },
			);

			expect(mockResolveBatch).toHaveBeenCalled();
			expect(result.variables.port).toBe(3000);
		});
	});

	describe("provided variables passthrough", () => {
		it("should pass through extra variables not defined in recipe", async () => {
			const recipePath = writeRecipe("passthrough", {
				name: { type: "string", required: true },
			});

			const result = await runRecipe(
				recipePath,
				{ name: "Test", extraVar: "bonus" },
				{ askMode: "nobody" },
			);

			expect(result.variables.name).toBe("Test");
			expect(result.variables.extraVar).toBe("bonus");
		});

		it("should not prompt for explicitly provided variables", async () => {
			const recipePath = writeRecipe("no-extra-prompt", {
				name: { type: "string", required: true },
				port: { type: "number", required: true },
			});

			const result = await runRecipe(recipePath, { name: "App", port: 8080 }, { askMode: "me" });

			expect(mockPrompt).not.toHaveBeenCalled();
			expect(result.variables.name).toBe("App");
			expect(result.variables.port).toBe(8080);
		});
	});

	describe("validation", () => {
		it("should validate provided values against variable config", async () => {
			const recipePath = writeRecipe("validate-enum", {
				framework: {
					type: "enum",
					required: true,
					values: ["react", "vue", "angular"],
				},
			});

			await expect(
				runRecipe(recipePath, { framework: "svelte" }, { askMode: "nobody" }),
			).rejects.toThrow(/must be one of/);
		});
	});
});
