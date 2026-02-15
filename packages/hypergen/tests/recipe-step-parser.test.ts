/**
 * Recipe Step System Parser Tests
 *
 * Tests for the updated template parser supporting V8 Recipe Step System
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TemplateParser } from "#/config/template-parser";
import type { RecipeStepUnion } from "#/recipe-engine/types";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { tmpdir } from "os";

describe("Recipe Step System Parser", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "hypergen-test-"));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("Legacy Template Support", () => {
		it("should parse legacy template.yml without steps", async () => {
			const templateYml = {
				name: "legacy-template",
				description: "A legacy template without steps",
				version: "1.0.0",
				variables: {
					name: {
						type: "string",
						required: true,
						description: "Component name",
					},
				},
			};

			const filePath = path.join(tempDir, "template.yml");
			fs.writeFileSync(filePath, yaml.dump(templateYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.config.name).toBe("legacy-template");
			expect(result.config.steps).toBeUndefined();
			expect(TemplateParser.isRecipeConfig(result.config)).toBe(false);
		});
	});

	describe("Recipe Step System Support", () => {
		it("should parse recipe.yml with steps", async () => {
			const recipeYml = {
				name: "my-recipe",
				description: "Recipe with steps",
				version: "1.0.0",
				variables: {
					name: {
						type: "string",
						required: true,
					},
					enabled: {
						type: "boolean",
						default: true,
					},
				},
				steps: [
					{
						name: "Generate template",
						tool: "template",
						template: "component.jig",
						when: "{{ enabled }}",
					},
					{
						name: "Run setup",
						tool: "action",
						action: "setup-component",
						dependsOn: ["Generate template"],
					},
					{
						name: "Add imports",
						tool: "codemod",
						codemod: "add-import",
						files: ["src/**/*.ts"],
						dependsOn: ["Run setup"],
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.config.name).toBe("my-recipe");
			expect(result.config.steps).toHaveLength(3);
			expect(TemplateParser.isRecipeConfig(result.config)).toBe(true);

			// Check step details
			const steps = result.config.steps!;
			expect(steps[0].name).toBe("Generate template");
			expect(steps[0].tool).toBe("template");
			expect((steps[0] as any).template).toBe("component.jig");
			expect((steps[0] as any).when).toBe("{{ enabled }}");

			expect(steps[1].name).toBe("Run setup");
			expect(steps[1].tool).toBe("action");
			expect((steps[1] as any).action).toBe("setup-component");
			expect(steps[1].dependsOn).toEqual(["Generate template"]);

			expect(steps[2].name).toBe("Add imports");
			expect(steps[2].tool).toBe("codemod");
			expect((steps[2] as any).codemod).toBe("add-import");
			expect((steps[2] as any).files).toEqual(["src/**/*.ts"]);
		});

		it("should validate step configurations", async () => {
			const recipeYml = {
				name: "invalid-recipe",
				variables: {
					name: { type: "string", required: true },
				},
				steps: [
					{
						name: "Missing tool type",
						// Missing tool field
					},
					{
						name: "Invalid tool",
						tool: "invalid-tool",
					},
					{
						name: "Template without template",
						tool: "template",
						// Missing template field
					},
					{
						name: "CodeMod without files",
						tool: "codemod",
						codemod: "test-codemod",
						// Missing files field
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);

			// Check specific error messages
			const errorMessages = result.errors.join(" ");
			expect(errorMessages).toContain("must have a valid tool type");
			expect(errorMessages).toContain("must have a template");
			expect(errorMessages).toContain("must have a files array");
		});

		it("should detect circular dependencies", async () => {
			const recipeYml = {
				name: "circular-deps",
				variables: {
					name: { type: "string", required: true },
				},
				steps: [
					{
						name: "step-a",
						tool: "action",
						action: "action-a",
						dependsOn: ["step-c"],
					},
					{
						name: "step-b",
						tool: "action",
						action: "action-b",
						dependsOn: ["step-a"],
					},
					{
						name: "step-c",
						tool: "action",
						action: "action-c",
						dependsOn: ["step-b"],
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((error) => error.includes("Circular dependency"))).toBe(true);
		});

		it("should validate duplicate step names", async () => {
			const recipeYml = {
				name: "duplicate-steps",
				variables: {
					name: { type: "string", required: true },
				},
				steps: [
					{
						name: "duplicate-name",
						tool: "action",
						action: "action-1",
					},
					{
						name: "duplicate-name",
						tool: "action",
						action: "action-2",
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((error) => error.includes("Duplicate step name"))).toBe(true);
		});
	});

	describe("Recipe Config Conversion", () => {
		it("should convert TemplateConfig to RecipeConfig", async () => {
			const templateYml = {
				name: "convertible-recipe",
				description: "Recipe for conversion",
				version: "1.0.0",
				author: "Test Author",
				category: "test",
				tags: ["test", "conversion"],
				variables: {
					name: {
						type: "string",
						required: true,
					},
				},
				steps: [
					{
						name: "Generate files",
						tool: "template",
						template: "component.jig",
					},
				],
				examples: [
					{
						title: "Basic example",
						variables: { name: "TestComponent" },
					},
				],
				dependencies: ["some-package"],
				outputs: ["src/components/"],
				engines: {
					hypergen: "^8.0.0",
					node: "^18.0.0",
				},
				settings: {
					timeout: 30000,
					retries: 2,
					continueOnError: false,
				},
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(templateYml));

			const result = await TemplateParser.parseTemplateFile(filePath);
			expect(result.isValid).toBe(true);

			const recipeConfig = TemplateParser.toRecipeConfig(result.config);
			expect(recipeConfig).not.toBeNull();
			expect(recipeConfig!.name).toBe("convertible-recipe");
			expect(recipeConfig!.description).toBe("Recipe for conversion");
			expect(recipeConfig!.steps).toHaveLength(1);
			expect(recipeConfig!.examples).toHaveLength(1);
			expect(recipeConfig!.dependencies).toHaveLength(1);
			expect(recipeConfig!.settings?.timeout).toBe(30000);
		});

		it("should return null for non-recipe configs", async () => {
			const templateYml = {
				name: "legacy-template",
				variables: {
					name: { type: "string", required: true },
				},
				// No steps
			};

			const filePath = path.join(tempDir, "template.yml");
			fs.writeFileSync(filePath, yaml.dump(templateYml));

			const result = await TemplateParser.parseTemplateFile(filePath);
			const recipeConfig = TemplateParser.toRecipeConfig(result.config);

			expect(recipeConfig).toBeNull();
		});
	});

	describe("Tool-specific Step Validation", () => {
		it("should validate template step configuration", async () => {
			const recipeYml = {
				name: "template-step-test",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "Template step",
						tool: "template",
						template: "component.jig",
						outputDir: "src/components",
						overwrite: true,
						exclude: ["*.test.ts"],
						templateConfig: {
							variables: {
								className: { type: "string" },
							},
						},
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			const templateStep = result.config.steps![0] as any;
			expect(templateStep.template).toBe("component.jig");
			expect(templateStep.outputDir).toBe("src/components");
			expect(templateStep.overwrite).toBe(true);
			expect(templateStep.exclude).toEqual(["*.test.ts"]);
			expect(templateStep.templateConfig).toBeDefined();
		});

		it("should validate action step configuration", async () => {
			const recipeYml = {
				name: "action-step-test",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "Action step",
						tool: "action",
						action: "setup-project",
						parameters: { projectType: "library" },
						dryRun: false,
						force: true,
						actionConfig: {
							communication: {
								actionId: "setup-1",
								subscribeTo: ["project-created"],
							},
						},
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			const actionStep = result.config.steps![0] as any;
			expect(actionStep.action).toBe("setup-project");
			expect(actionStep.parameters).toEqual({ projectType: "library" });
			expect(actionStep.dryRun).toBe(false);
			expect(actionStep.force).toBe(true);
			expect(actionStep.actionConfig).toBeDefined();
		});

		it("should validate codemod step configuration", async () => {
			const recipeYml = {
				name: "codemod-step-test",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "CodeMod step",
						tool: "codemod",
						codemod: "add-import",
						files: ["src/**/*.ts", "src/**/*.tsx"],
						backup: true,
						parser: "typescript",
						parameters: { importPath: "./utils" },
						force: false,
						codemodConfig: {
							transform: {
								preserveFormatting: true,
								includeComments: true,
							},
							validation: {
								validateSyntax: true,
								validateTypes: true,
							},
						},
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			const codemodStep = result.config.steps![0] as any;
			expect(codemodStep.codemod).toBe("add-import");
			expect(codemodStep.files).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
			expect(codemodStep.backup).toBe(true);
			expect(codemodStep.parser).toBe("typescript");
			expect(codemodStep.parameters).toEqual({ importPath: "./utils" });
			expect(codemodStep.codemodConfig).toBeDefined();
		});

		it("should validate recipe step configuration", async () => {
			const recipeYml = {
				name: "recipe-step-test",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "Sub-recipe step",
						tool: "recipe",
						recipe: "setup-base-project",
						version: "^1.0.0",
						inheritVariables: true,
						variableOverrides: { projectType: "library" },
						recipeConfig: {
							execution: {
								isolated: true,
								workingDir: "./sub-project",
								timeout: 60000,
							},
							variableMapping: {
								name: "projectName",
							},
						},
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			const recipeStep = result.config.steps![0] as any;
			expect(recipeStep.recipe).toBe("setup-base-project");
			expect(recipeStep.version).toBe("^1.0.0");
			expect(recipeStep.inheritVariables).toBe(true);
			expect(recipeStep.variableOverrides).toEqual({ projectType: "library" });
			expect(recipeStep.recipeConfig).toBeDefined();
		});
	});

	describe("Advanced Features", () => {
		it("should validate step conditions", async () => {
			const recipeYml = {
				name: "conditional-steps",
				variables: {
					name: { type: "string", required: true },
					skipTests: { type: "boolean", default: false },
				},
				steps: [
					{
						name: "Generate component",
						tool: "template",
						template: "component.jig",
					},
					{
						name: "Generate tests",
						tool: "template",
						template: "test.jig",
						when: "!{{ skipTests }}",
						dependsOn: ["Generate component"],
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			const conditionalStep = result.config.steps![1] as any;
			expect(conditionalStep.when).toBe("!{{ skipTests }}");
		});

		it("should validate step parallel execution", async () => {
			const recipeYml = {
				name: "parallel-steps",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "Generate component",
						tool: "template",
						template: "component.jig",
					},
					{
						name: "Generate styles",
						tool: "template",
						template: "styles.jig",
						parallel: true,
						dependsOn: ["Generate component"],
					},
					{
						name: "Generate tests",
						tool: "template",
						template: "test.jig",
						parallel: true,
						dependsOn: ["Generate component"],
					},
				],
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			expect(result.config.steps![1].parallel).toBe(true);
			expect(result.config.steps![2].parallel).toBe(true);
		});

		it("should validate recipe settings", async () => {
			const recipeYml = {
				name: "settings-test",
				variables: { name: { type: "string", required: true } },
				steps: [
					{
						name: "Generate files",
						tool: "template",
						template: "component.jig",
					},
				],
				settings: {
					timeout: 30000,
					retries: 3,
					continueOnError: true,
					maxParallelSteps: 5,
					workingDir: "./output",
				},
			};

			const filePath = path.join(tempDir, "recipe.yml");
			fs.writeFileSync(filePath, yaml.dump(recipeYml));

			const result = await TemplateParser.parseTemplateFile(filePath);

			expect(result.isValid).toBe(true);
			expect(result.config.settings?.timeout).toBe(30000);
			expect(result.config.settings?.retries).toBe(3);
			expect(result.config.settings?.continueOnError).toBe(true);
			expect(result.config.settings?.maxParallelSteps).toBe(5);
			expect(result.config.settings?.workingDir).toBe("./output");
		});
	});
});
