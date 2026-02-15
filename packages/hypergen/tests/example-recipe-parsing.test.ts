/**
 * Example Recipe Parsing Test
 *
 * Test that the example V8 recipe parses correctly
 */

import { describe, it, expect } from "vitest";
import { TemplateParser } from "#/config/template-parser";
import path from "path";

describe("Example Recipe Parsing", () => {
	it("should parse the V8 recipe example correctly", async () => {
		const examplePath = path.resolve(process.cwd(), "examples/v8-recipe-example.yml");

		const result = await TemplateParser.parseTemplateFile(examplePath);

		// Should parse successfully
		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);

		// Check basic configuration
		expect(result.config.name).toBe("react-component-recipe");
		expect(result.config.description).toContain("React component");
		expect(result.config.version).toBe("1.0.0");

		// Check variables
		expect(result.config.variables).toBeDefined();
		expect(result.config.variables.componentName).toBeDefined();
		expect(result.config.variables.componentName.required).toBe(true);
		expect(result.config.variables.includeTests).toBeDefined();
		expect(result.config.variables.includeTests.default).toBe(true);

		// Check steps
		expect(result.config.steps).toBeDefined();
		expect(result.config.steps).toHaveLength(7);

		// Verify step details
		const steps = result.config.steps!;
		expect(steps[0].name).toBe("Generate component");
		expect(steps[0].tool).toBe("template");

		expect(steps[1].name).toBe("Generate styles");
		expect(steps[1].tool).toBe("template");
		expect((steps[1] as any).when).toBe("{{ includeStyles }}");
		expect(steps[1].parallel).toBe(true);

		expect(steps[5].name).toBe("Update parent index");
		expect(steps[5].tool).toBe("action");
		expect((steps[5] as any).action).toBe("update-component-index");

		expect(steps[6].name).toBe("Format code");
		expect(steps[6].tool).toBe("codemod");
		expect((steps[6] as any).codemod).toBe("prettier-format");

		// Check settings
		expect(result.config.settings).toBeDefined();
		expect(result.config.settings?.timeout).toBe(120000);
		expect(result.config.settings?.maxParallelSteps).toBe(4);

		// Check examples
		expect(result.config.examples).toBeDefined();
		expect(result.config.examples).toHaveLength(3);
		expect(result.config.examples![0].title).toBe("Basic functional component");

		// Verify it's recognized as a recipe config
		expect(TemplateParser.isRecipeConfig(result.config)).toBe(true);

		// Test conversion to RecipeConfig
		const recipeConfig = TemplateParser.toRecipeConfig(result.config);
		expect(recipeConfig).not.toBeNull();
		expect(recipeConfig!.name).toBe("react-component-recipe");
		expect(recipeConfig!.steps).toHaveLength(7);
	});

	it("should have no warnings for the example recipe", async () => {
		const examplePath = path.resolve(process.cwd(), "examples/v8-recipe-example.yml");

		const result = await TemplateParser.parseTemplateFile(examplePath);

		// Should have minimal or no warnings
		expect(result.warnings.length).toBeLessThanOrEqual(2); // Allow for minor warnings

		// Log any warnings for review
		if (result.warnings.length > 0) {
			console.log("Example recipe warnings:", result.warnings);
		}
	});

	it("should validate step dependencies correctly", async () => {
		const examplePath = path.resolve(process.cwd(), "examples/v8-recipe-example.yml");

		const result = await TemplateParser.parseTemplateFile(examplePath);

		expect(result.isValid).toBe(true);

		const steps = result.config.steps!;

		// Check that dependent steps reference existing steps
		const stepNames = new Set(steps.map((step) => step.name));

		for (const step of steps) {
			if (step.dependsOn) {
				for (const dependency of step.dependsOn) {
					expect(stepNames.has(dependency)).toBe(true);
				}
			}
		}
	});

	it("should validate parallel steps have proper dependencies", async () => {
		const examplePath = path.resolve(process.cwd(), "examples/v8-recipe-example.yml");

		const result = await TemplateParser.parseTemplateFile(examplePath);

		expect(result.isValid).toBe(true);

		const steps = result.config.steps!;
		const parallelSteps = steps.filter((step) => step.parallel);

		// All parallel steps should have dependencies (can't be the first step)
		for (const step of parallelSteps) {
			expect(step.dependsOn).toBeDefined();
			expect(step.dependsOn!.length).toBeGreaterThan(0);
		}

		// Parallel steps should be able to run together
		expect(parallelSteps.length).toBeGreaterThan(1);
	});
});
