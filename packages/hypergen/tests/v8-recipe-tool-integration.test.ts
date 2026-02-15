/**
 * Recipe Tool Integration Tests
 *
 * Tests the RecipeTool implementation for recipe composition in the Recipe Step System.
 * Validates recipe discovery, variable inheritance, sub-recipe execution, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs-extra";
import { tmpdir } from "os";
import {
	RecipeTool,
	RecipeToolFactory,
	recipeToolFactory,
} from "#/recipe-engine/tools/recipe-tool";
import { Tool } from "#/recipe-engine/tools/base";
import { getToolRegistry } from "#/recipe-engine/tools/registry";
import type {
	RecipeStep,
	StepContext,
	RecipeConfig,
	StepResult,
	StepExecutionOptions,
	TemplateStep,
} from "#/recipe-engine/types";

/**
 * Mock template tool for testing recipe execution without needing actual template processing
 */
class MockTemplateTool extends Tool<TemplateStep> {
	constructor(name: string = "mock-template-tool", options: Record<string, any> = {}) {
		super("template", name, options);
	}

	protected async onInitialize(): Promise<void> {
		// No-op for mock
	}

	protected async onValidate(step: TemplateStep, context: StepContext) {
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}

	protected async onExecute(
		step: TemplateStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		const endTime = new Date();

		return {
			status: "completed",
			stepName: step.name,
			toolType: "template",
			startTime,
			endTime,
			duration: endTime.getTime() - startTime.getTime(),
			retryCount: 0,
			dependenciesSatisfied: true,
			filesCreated: ["test-file.txt"],
			filesModified: [],
			filesDeleted: [],
		};
	}

	protected async onCleanup(): Promise<void> {
		// No-op for mock
	}
}

describe("RecipeTool Integration Tests", () => {
	let tempDir: string;
	let recipeTool: RecipeTool;
	let mockContext: StepContext;

	beforeEach(async () => {
		// Create temporary directory for test files
		tempDir = await fs.mkdtemp(path.join(tmpdir(), "hypergen-recipe-tool-test-"));

		// Register mock template tool in the tool registry
		const toolRegistry = getToolRegistry();
		toolRegistry.register("template", "default", {
			create: (name: string, options?: Record<string, any>) => {
				return new MockTemplateTool(name, options);
			},
			getToolType: () => "template" as const,
			validateConfig: (config: Record<string, any>) => ({
				isValid: true,
				errors: [],
				warnings: [],
				suggestions: [],
			}),
		});

		// Create recipe tool instance
		recipeTool = recipeToolFactory.create("test-recipe-tool", {
			cacheEnabled: false, // Disable cache for testing
			timeout: 5000,
		});

		await recipeTool.initialize();

		// Create mock context
		mockContext = {
			step: {} as any, // Will be overridden in individual tests
			variables: {
				projectName: "test-project",
				framework: "react",
				typescript: true,
			},
			projectRoot: tempDir,
			recipeVariables: {},
			stepResults: new Map(),
			recipe: {
				id: "test-recipe",
				name: "Test Recipe",
				startTime: new Date(),
			},
			stepData: {},
			evaluateCondition: (expression: string, context: Record<string, any>) => {
				// Simple evaluation for testing
				try {
					return Function(`with(this) { return ${expression}; }`).call(context);
				} catch {
					return false;
				}
			},
			dryRun: false,
			force: false,
		};
	});

	afterEach(async () => {
		// Cleanup
		await recipeTool.cleanup();
		await fs.remove(tempDir);

		// Unregister mock template tool
		const toolRegistry = getToolRegistry();
		toolRegistry.unregister("template", "default");
	});

	describe("Tool Initialization", () => {
		it("should create RecipeTool instance successfully", () => {
			expect(recipeTool).toBeInstanceOf(RecipeTool);
			expect(recipeTool.getToolType()).toBe("recipe");
			expect(recipeTool.getName()).toBe("test-recipe-tool");
		});

		it("should initialize with correct configuration", () => {
			expect(recipeTool.isInitialized()).toBe(true);
		});
	});

	describe("Tool Factory", () => {
		it("should create tools with factory", () => {
			const factory = new RecipeToolFactory();
			const tool = factory.create("factory-test-tool");

			expect(tool).toBeInstanceOf(RecipeTool);
			expect(tool.getName()).toBe("factory-test-tool");
			expect(factory.getToolType()).toBe("recipe");
		});

		it("should validate configuration properly", () => {
			const factory = new RecipeToolFactory();

			// Valid configuration
			const validResult = factory.validateConfig({
				cacheEnabled: true,
				timeout: 30000,
				cacheDirectory: "/tmp",
			});

			expect(validResult.isValid).toBe(true);
			expect(validResult.errors).toHaveLength(0);

			// Invalid configuration
			const invalidResult = factory.validateConfig({
				timeout: -1, // Invalid timeout
				cacheEnabled: "yes", // Invalid type
			});

			expect(invalidResult.isValid).toBe(false);
			expect(invalidResult.errors.length).toBeGreaterThan(0);
		});
	});

	describe("Step Validation", () => {
		it("should validate valid recipe step", async () => {
			const step: RecipeStep = {
				name: "test-step",
				tool: "recipe",
				recipe: "basic-component",
				inheritVariables: true,
				variableOverrides: {
					name: "TestComponent",
				},
			};

			// Create a basic recipe file
			const recipeContent = {
				name: "Basic Component",
				description: "Creates a basic component",
				version: "1.0.0",
				variables: {
					name: {
						type: "string",
						required: true,
						description: "Component name",
					},
				},
				steps: [
					{
						name: "create-component",
						tool: "template",
						template: "component.tsx",
						variables: {
							name: "{{ name }}",
						},
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "basic-component.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			mockContext.step = step;

			const validation = await recipeTool.validate(step, mockContext);

			expect(validation.isValid).toBe(true);
			expect(validation.errors).toHaveLength(0);
			expect(validation.estimatedExecutionTime).toBeGreaterThan(0);
		});

		it("should detect invalid recipe step", async () => {
			const step = {
				name: "invalid-step",
				tool: "template", // Wrong tool type
				recipe: "nonexistent-recipe",
			} as any;

			const validation = await recipeTool.validate(step, mockContext);

			expect(validation.isValid).toBe(false);
			expect(validation.errors).toContain("Step is not a valid RecipeStep");
		});

		it("should detect missing recipe", async () => {
			const step: RecipeStep = {
				name: "missing-recipe-step",
				tool: "recipe",
				recipe: "nonexistent-recipe",
			};

			const validation = await recipeTool.validate(step, mockContext);

			expect(validation.isValid).toBe(false);
			expect(
				validation.errors.some(
					(e) => e.includes("Recipe resolution failed") || e.includes("not found"),
				),
			).toBe(true);
		});
	});

	describe("Recipe Resolution", () => {
		it("should resolve local recipe file", async () => {
			const recipeContent = {
				name: "Local Recipe",
				description: "A local test recipe",
				version: "1.0.0",
				variables: {},
				steps: [
					{
						name: "test-step",
						tool: "template",
						template: "test.txt",
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "local-recipe.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-local-recipe",
				tool: "recipe",
				recipe: "local-recipe.yml",
			};

			mockContext.step = step;

			// Test validation (which internally tests resolution)
			const validation = await recipeTool.validate(step, mockContext);
			expect(validation.isValid).toBe(true);
		});

		it("should resolve recipe with different extensions", async () => {
			const recipeContent = {
				name: "Extension Test Recipe",
				version: "1.0.0",
				variables: {},
				steps: [
					{
						name: "test-step",
						tool: "template",
						template: "test.txt",
					},
				],
			};

			// Test .yml extension resolution
			await fs.writeFile(
				path.join(tempDir, "extension-test.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-extension",
				tool: "recipe",
				recipe: "extension-test", // No extension
			};

			const validation = await recipeTool.validate(step, mockContext);
			expect(validation.isValid).toBe(true);
		});
	});

	describe("Variable Inheritance", () => {
		it("should inherit parent variables by default", async () => {
			const recipeContent = {
				name: "Variable Test Recipe",
				variables: {
					inheritedVar: { type: "string" },
				},
				steps: [
					{
						name: "test-inheritance",
						tool: "template",
						template: "test.txt",
						variables: {
							inheritedVar: "{{ inheritedVar }}",
						},
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "variable-test.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-variable-inheritance",
				tool: "recipe",
				recipe: "variable-test.yml",
				inheritVariables: true,
			};

			// Set a variable that should be inherited
			mockContext.variables.inheritedVar = "inherited-value";
			mockContext.step = step;

			const validation = await recipeTool.validate(step, mockContext);
			expect(validation.isValid).toBe(true);
		});

		it("should apply variable overrides correctly", async () => {
			const recipeContent = {
				name: "Override Test Recipe",
				variables: {
					testVar: { type: "string" },
				},
				steps: [
					{
						name: "test-override",
						tool: "template",
						template: "test.txt",
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "override-test.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-variable-override",
				tool: "recipe",
				recipe: "override-test.yml",
				inheritVariables: true,
				variableOverrides: {
					testVar: "overridden-value",
				},
			};

			mockContext.step = step;

			const validation = await recipeTool.validate(step, mockContext);
			expect(validation.isValid).toBe(true);
		});
	});

	describe("Execution Flow", () => {
		it("should execute simple recipe successfully", async () => {
			const recipeContent = {
				name: "Simple Execution Recipe",
				description: "A simple recipe for testing execution",
				variables: {},
				steps: [
					{
						name: "simple-step",
						tool: "template",
						template: "simple.txt",
						variables: {
							message: "Hello from sub-recipe!",
						},
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "simple-execution.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-execution",
				tool: "recipe",
				recipe: "simple-execution.yml",
			};

			mockContext.step = step;

			const result = await recipeTool.execute(step, mockContext);

			expect(result.status).toBe("completed");
			expect(result.toolType).toBe("recipe");
			expect(result.filesCreated).toEqual(["test-file.txt"]);

			// Verify tool result contains sub-recipe information
			const toolResult = result.toolResult as any;
			expect(toolResult.recipeName).toBe("Simple Execution Recipe");
			expect(toolResult.subSteps).toHaveLength(1);
			expect(toolResult.subSteps[0].stepName).toBe("simple-step");
		});

		it("should handle recipe execution failure", async () => {
			// Create a failing mock template tool that will replace the default
			class FailingMockTemplateTool extends Tool<TemplateStep> {
				constructor(
					name: string = "failing-mock-template-tool",
					options: Record<string, any> = {},
				) {
					super("template", name, options);
				}

				protected async onInitialize(): Promise<void> {
					// No-op for mock
				}

				protected async onValidate(step: TemplateStep, context: StepContext) {
					return {
						isValid: true,
						errors: [],
						warnings: [],
						suggestions: [],
					};
				}

				protected async onExecute(
					step: TemplateStep,
					context: StepContext,
					options?: StepExecutionOptions,
				): Promise<StepResult> {
					// Tools should throw errors to indicate failure, not return failed results
					throw new Error("Template not found");
				}

				protected async onCleanup(): Promise<void> {
					// No-op for mock
				}
			}

			// Temporarily replace the default template tool with a failing one
			const toolRegistry = getToolRegistry();

			// Save the original factory
			const originalFactory = toolRegistry["registrations"].get("template:default");

			// Clear the cached instance of the default template tool
			toolRegistry["removeCachedInstances"]("template", "default");

			// Register the failing mock tool as 'default'
			toolRegistry.register("template", "default", {
				create: (name: string, options?: Record<string, any>) => {
					return new FailingMockTemplateTool(name, options);
				},
				getToolType: () => "template" as const,
				validateConfig: (config: Record<string, any>) => ({
					isValid: true,
					errors: [],
					warnings: [],
					suggestions: [],
				}),
			});

			const recipeContent = {
				name: "Failing Recipe",
				steps: [
					{
						name: "failing-step",
						tool: "template",
						template: "nonexistent.txt",
					},
				],
			};

			await fs.writeFile(
				path.join(tempDir, "failing-recipe.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-failure",
				tool: "recipe",
				recipe: "failing-recipe.yml",
			};

			mockContext.step = step;

			// Pass retries: 0 to avoid the StepExecutor's default 3 retries with
			// exponential backoff (1s + 2s + 4s = 7s) which would exceed the test timeout
			const result = await recipeTool.execute(step, mockContext, {
				retries: 0,
			});

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.message).toContain("failed");

			// Restore the original factory and clear the cache
			toolRegistry["removeCachedInstances"]("template", "default");
			if (originalFactory) {
				toolRegistry["registrations"].set("template:default", originalFactory);
			}
		});
	});

	describe("Error Handling", () => {
		it("should handle nonexistent recipe gracefully", async () => {
			const step: RecipeStep = {
				name: "test-nonexistent",
				tool: "recipe",
				recipe: "definitely-does-not-exist.yml",
			};

			mockContext.step = step;

			const result = await recipeTool.execute(step, mockContext);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.message).toContain("not found");
		});

		it("should handle malformed recipe file", async () => {
			// Create malformed YAML
			await fs.writeFile(path.join(tempDir, "malformed.yml"), "invalid: yaml: content: [unclosed");

			const step: RecipeStep = {
				name: "test-malformed",
				tool: "recipe",
				recipe: "malformed.yml",
			};

			mockContext.step = step;

			const result = await recipeTool.execute(step, mockContext);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
		});
	});

	describe("Performance and Caching", () => {
		it("should cache recipe resolutions", async () => {
			const recipeContent = {
				name: "Cached Recipe",
				variables: {},
				steps: [],
			};

			await fs.writeFile(
				path.join(tempDir, "cached-recipe.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			// Enable caching for this test
			const cachedTool = new RecipeTool("cached-test-tool", {
				cacheEnabled: true,
			});
			await cachedTool.initialize();

			try {
				const step: RecipeStep = {
					name: "test-caching",
					tool: "recipe",
					recipe: "cached-recipe.yml",
				};

				// First validation should cache the recipe
				await cachedTool.validate(step, mockContext);

				// Second validation should use cache
				const start = Date.now();
				await cachedTool.validate(step, mockContext);
				const duration = Date.now() - start;

				// Cached resolution should be faster (though this is not always guaranteed in tests)
				expect(duration).toBeLessThan(100); // Should be very fast with caching
			} finally {
				await cachedTool.cleanup();
			}
		});
	});

	describe("Lifecycle Management", () => {
		it("should track lifecycle metrics", async () => {
			const recipeContent = {
				name: "Metrics Recipe",
				steps: [],
			};

			await fs.writeFile(
				path.join(tempDir, "metrics-recipe.yml"),
				JSON.stringify(recipeContent, null, 2),
			);

			const step: RecipeStep = {
				name: "test-metrics",
				tool: "recipe",
				recipe: "metrics-recipe.yml",
			};

			mockContext.step = step;

			const metrics = recipeTool.getMetrics();
			expect(metrics.startTime).toBeInstanceOf(Date);
			expect(metrics.retryAttempts).toBe(0);
			expect(metrics.events).toBeDefined();
			expect(Array.isArray(metrics.events)).toBe(true);
		});

		it("should cleanup resources properly", async () => {
			const tool = new RecipeTool("cleanup-test-tool");
			await tool.initialize();

			expect(tool.isInitialized()).toBe(true);
			expect(tool.isCleanedUp()).toBe(false);

			await tool.cleanup();

			expect(tool.isCleanedUp()).toBe(true);
		});
	});
});
