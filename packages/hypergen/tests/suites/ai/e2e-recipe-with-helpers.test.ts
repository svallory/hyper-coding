import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiCollector } from "~/ai/ai-collector";
import { RecipeEngine } from "~/recipe-engine/recipe-engine";
import { ToolRegistry, getToolRegistry } from "~/recipe-engine/tools/registry";
import { templateToolFactory } from "~/recipe-engine/tools/template-tool";
import type { Recipe } from "~/recipe-engine/types";
import { getJig, initializeJig } from "~/template-engines/jig-engine";

describe("AI Collection E2E with Helpers", () => {
	let testDir: string;
	let collector: AiCollector;

	beforeEach(() => {
		// Create temporary test directory
		testDir = mkdtempSync(join(tmpdir(), "hypergen-test-"));

		// Get collector instance and reset state
		collector = AiCollector.getInstance();
		collector.clear();

		// CRITICAL: Initialize Jig to register @ai tags
		initializeJig({ cache: false });

		// Register template tool with 'default' name
		ToolRegistry.reset();
		const registry = getToolRegistry();
		registry.register("template", "default", templateToolFactory, {
			description: "Default template tool",
			category: "core",
		});
	});

	afterEach(() => {
		// Cleanup
		rmSync(testDir, { recursive: true, force: true });
		collector.clear();
		collector.collectMode = false;
		ToolRegistry.reset();
	});

	it("should collect AI entries when template uses helper functions", async () => {
		// 1. Setup helpers that templates will use
		const helpers = {
			getFields: (model: string) => {
				return JSON.stringify([
					{ name: "id", type: "string" },
					{ name: "name", type: "string" },
					{ name: "email", type: "string" },
				]);
			},
			listModelFields: (model: string) => {
				const fields = [
					{ name: "id", type: "string" },
					{ name: "name", type: "string" },
				];
				return fields.map((f) => `- ${f.name}: ${f.type}`).join("\n");
			},
		};

		// Register helpers as Jig globals
		const jig = getJig();
		jig.global("getFields", helpers.getFields);
		jig.global("listModelFields", helpers.listModelFields);

		// 2. Create recipe YAML content
		const recipeYaml = yaml.dump({
			name: "test-recipe-with-helpers",
			description: "Test recipe with AI tags and helper functions",
			steps: [
				{
					name: "generate-handler",
					tool: "template",
					template: "handler.jig",
					variables: {
						model: "User",
					},
				},
			],
		});

		// 3. Write recipe file
		const recipeFile = join(testDir, "recipe.yml");
		writeFileSync(recipeFile, recipeYaml);

		// 4. Write template file
		const templateContent = `---
to: "src/handlers/{{ kebabCase(model) }}-handler.ts"
---
@ai({ key: 'handler' })
  @context()
    Model: {{ model }}
    Fields from helper: {{ getFields(model) }}

    Formatted fields:
    {{ listModelFields(model) }}
  @end

  @prompt()
    Generate a TypeScript handler for the {{ model }} model.
    Include CRUD operations for these fields.
  @end

  @output()
    @example()
    // Default handler implementation
    export class {{ pascalCase(model) }}Handler {
      // TODO: Implement CRUD operations
    }
    @end
  @end
@end`;

		writeFileSync(join(testDir, "handler.jig"), templateContent);

		// 5. Create recipe engine (helpers are already registered as Jig globals above)
		const recipeEngine = new RecipeEngine({
			workingDir: testDir,
		});

		// 6. Execute Pass 1 (collect mode)
		collector.collectMode = true;

		const result = await recipeEngine.executeRecipe(
			{ type: "file", path: recipeFile },
			{
				variables: { model: "User" },
				skipPrompts: true,
			},
		);

		// 5. CRITICAL ASSERTIONS - These should FAIL with current bug
		expect(collector.hasEntries()).toBe(true);
		expect(collector.getEntries().size).toBeGreaterThan(0);

		// 6. Verify the collected entry has the correct structure
		const entries = Array.from(collector.getEntries().values());
		expect(entries).toHaveLength(1);

		const entry = entries[0];
		expect(entry.key).toBe("handler");

		// Check contexts array (contains all @context blocks)
		const allContexts = entry.contexts.join(" ");
		expect(allContexts).toContain("Model: User");
		expect(allContexts).toContain("Fields from helper:");
		expect(allContexts).toContain('"name":"id"');

		// Check prompt
		expect(entry.prompt).toContain("Generate a TypeScript handler");
		expect(entry.prompt).toContain("User model");

		// Check examples array (the default/example output)
		expect(entry.examples).toHaveLength(1);
		expect(entry.examples[0]).toContain("export class UserHandler");

		// 7. Verify no files were created in Pass 1
		expect(result.filesCreated).toHaveLength(0);
		expect(result.filesModified).toHaveLength(0);
	});

	it("should collect multiple AI entries from templates with nested helper calls", async () => {
		const helpers = {
			getRelations: (model: string) => {
				return model === "User" ? ["posts", "comments"] : [];
			},
			formatList: (items: string[]) => {
				return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
			},
		};

		// Register helpers as Jig globals
		const jig = getJig();
		jig.global("getRelations", helpers.getRelations);
		jig.global("formatList", helpers.formatList);

		const recipeYaml = yaml.dump({
			name: "test-multiple-ai-entries",
			description: "Test multiple AI blocks with helpers",
			steps: [
				{
					name: "generate-model",
					tool: "template",
					template: "model.jig",
					variables: {
						model: "User",
					},
				},
			],
		});

		const recipeFile = join(testDir, "recipe-multi.yml");
		writeFileSync(recipeFile, recipeYaml);

		const templateContent = `---
to: "src/models/{{ kebabCase(model) }}.ts"
---
@ai({ key: 'model' })
  @context()
    Relations for {{ model }}:
    {{ formatList(getRelations(model)) }}
  @end
  @prompt()
Generate model with relations
  @end
  @output()
    @example()
export interface {{ pascalCase(model) }} {}
    @end
  @end
@end

@ai({ key: 'tests' })
  @context()
Tests for {{ model }}
  @end
  @prompt()
Generate tests
  @end
  @output()
    @example()
// Tests
    @end
  @end
@end`;

		writeFileSync(join(testDir, "model.jig"), templateContent);

		const recipeEngine = new RecipeEngine({
			workingDir: testDir,
		});

		collector.collectMode = true;

		const result = await recipeEngine.executeRecipe(
			{ type: "file", path: recipeFile },
			{
				variables: { model: "User" },
				skipPrompts: true,
			},
		);

		// Verify recipe executed successfully
		expect(result.success).toBe(true);

		// Should collect 2 AI entries
		expect(collector.hasEntries()).toBe(true);
		expect(collector.getEntries().size).toBe(2);

		const entries = Array.from(collector.getEntries().values());
		expect(entries.find((e) => e.key === "model")).toBeDefined();
		expect(entries.find((e) => e.key === "tests")).toBeDefined();
	});

	it("should fail test when collectMode is not properly passed through", async () => {
		// This is a NEGATIVE test - it verifies the test framework itself
		// If collectMode is false, collector should NOT collect entries

		const recipeYaml = yaml.dump({
			name: "test-no-collect",
			description: "Should not collect when collectMode is false",
			steps: [
				{
					name: "generate",
					tool: "template",
					template: "simple.jig",
				},
			],
		});

		const recipeFile = join(testDir, "recipe-negative.yml");
		writeFileSync(recipeFile, recipeYaml);

		const templateContent = `---
to: "test.ts"
---
@ai({ key: 'test' })
  @prompt()
    Test prompt
  @end
  @output()
    @example()
    Default output
    @end
  @end
@end`;

		writeFileSync(join(testDir, "simple.jig"), templateContent);

		const recipeEngine = new RecipeEngine({
			workingDir: testDir,
		});

		// Explicitly set collectMode to false
		collector.collectMode = false;

		await recipeEngine.executeRecipe(
			{ type: "file", path: recipeFile },
			{
				skipPrompts: true,
				workingDir: testDir,
			},
		);

		// Should NOT collect entries when collectMode is false
		expect(collector.hasEntries()).toBe(false);
		expect(collector.getEntries().size).toBe(0);
	}, 15000);
});
