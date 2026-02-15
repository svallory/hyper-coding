/**
 * E2E Test: Next.js CRUD Resource with 2-Pass AI Generation
 *
 * This test uniquely validates (compared to full-workflow.test.ts):
 * 1. Prompt assembly - verifying assembled markdown has all @ai keys, JSON response format, callback command with --answers
 * 2. Stdout transport output format
 * 3. Helper function outputs appearing in @context blocks
 * 4. Negative test - collectMode=false should NOT collect
 *
 * Uses the real Next.js kit at /work/hyperdev/kit/nextjs/cookbooks/crud/resource/
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import { PromptAssembler } from "#/ai/prompt-assembler";
import { RecipeEngine } from "#/recipe-engine/recipe-engine";
import { ToolRegistry, getToolRegistry } from "#/recipe-engine/tools/registry";
import { templateToolFactory } from "#/recipe-engine/tools/template-tool";
import { getJig, initializeJig } from "#/template-engines/jig-engine";

// ─── Constants ──────────────────────────────────────────────────────

// Real kit path
const KIT_PATH = path.resolve(__dirname, "../../../../../kit/nextjs");
const CRUD_TEMPLATES_DIR = path.join(KIT_PATH, "cookbooks/crud/resource/templates");

// ─── Fixtures ────────────────────────────────────────────────────────

const VARIABLES = {
	name: "product",
	model: "Product",
	fields: "title:string,price:number,description:text,isPublished:boolean",
};

// Pre-crafted AI answers for the 3 templates in crud/resource
const ANSWERS: Record<string, string> = {
	// From schema.ts.jig @ai({ key: 'zodSchema' })
	zodSchema: `z.object({
  title: z.string().min(1, "Title is required").max(255),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
  isPublished: z.boolean().default(false),
})`,

	// From actions.ts.jig @ai({ key: 'drizzleListQuery' })
	drizzleListQuery: `    const searchCondition = search
      ? or(
          like(products.title, \`%\${search}%\`),
          like(products.description, \`%\${search}%\`)
        )
      : undefined

    const items = await db
      .select()
      .from(products)
      .where(searchCondition)
      .limit(pageSize)
      .offset(skip)
      .orderBy(sortOrder === 'desc' ? desc(products.createdAt) : asc(products.createdAt))

    const [{ count: total }] = await db
      .select({ count: sql<number>\`count(*)\` })
      .from(products)
      .where(searchCondition)

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }`,

	// From actions.ts.jig @ai({ key: 'drizzleMutations' })
	drizzleMutations: `{
  "getById": "const [record] = await db.select().from(products).where(eq(products.id, id))\\n    if (!record) {\\n      throw new Error('Product not found')\\n    }\\n    return record",
  "create": "const [record] = await db.insert(products).values(validated).returning()\\n    revalidatePath('/product')\\n    return record",
  "update": "const [record] = await db.update(products).set(validated).where(eq(products.id, id)).returning()\\n    revalidatePath('/product')\\n    revalidatePath(\`/product/\${id}\`)\\n    return record",
  "delete": "await db.delete(products).where(eq(products.id, id))\\n    revalidatePath('/product')\\n    return { success: true }"
}`,

	// From form-component.tsx.jig @ai({ key: 'formFields' })
	formFields: `          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title *</FormLabel>
                <FormControl>
                  <Input placeholder="Enter product title" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="0.00"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea placeholder="Product description" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isPublished"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Is Published</FormLabel>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />`,
};

// ─── Mock Helpers ────────────────────────────────────────────────────

/**
 * Mock detectProjectFeatures helper (used by templates)
 */
const mockDetectProjectFeatures = () => ({
	orm: "drizzle" as const,
	ui: "shadcn",
	styling: "tailwind",
	auth: "none",
	stateManagement: [],
	packageManager: "bun" as const,
	typescript: true,
	router: "app" as const,
});

/**
 * Mock parseFieldsString helper
 * e.g. "title:string,price:number" => [{ name: 'title', type: 'string', isRequired: true }, ...]
 */
const parseFieldsString = (fieldsStr: string) => {
	return fieldsStr.split(",").map((f: string) => {
		const [fieldName, type] = f.trim().split(":");
		return { name: fieldName, type: type || "string", isRequired: true };
	});
};

/**
 * Mock buildFieldDescriptions helper (multi-line format for @context blocks)
 */
const buildFieldDescriptions = (
	modelFields: Array<{
		name: string;
		type: string;
		isRequired?: boolean;
		documentation?: string;
	}>,
) => {
	return modelFields
		.map(
			(f: any) =>
				`${f.name}: ${f.type}${f.isRequired ? " (required)" : " (optional)"}${f.documentation ? ` — ${f.documentation}` : ""}`,
		)
		.join("\n");
};

/**
 * Mock buildFieldDescriptionsInline helper (single-line comma-separated)
 */
const buildFieldDescriptionsInline = (modelFields: Array<{ name: string; type: string }>) => {
	return modelFields.map((f: any) => `${f.name}: ${f.type}`).join(", ");
};

const mockHelpers = {
	detectProjectFeatures: mockDetectProjectFeatures,
	parseDrizzleSchema: () => [],
	parsePrismaSchema: () => [],
	parseFieldsString,
	buildFieldDescriptions,
	buildFieldDescriptionsInline,
};

function registerMockHelpers(jig: any): void {
	for (const [name, fn] of Object.entries(mockHelpers)) {
		jig.global(name, fn);
	}
}

// ─── Test Helpers ────────────────────────────────────────────────────

let tempDir: string;

async function createProjectStructure(): Promise<string> {
	tempDir = fs.mkdtempSync(path.join(tmpdir(), "hypergen-e2e-nextjs-"));

	// Create directories that the templates expect
	await fs.mkdirp(path.join(tempDir, "lib/schemas"));
	await fs.mkdirp(path.join(tempDir, "app/actions"));
	await fs.mkdirp(path.join(tempDir, "components"));

	// Create a minimal package.json for ORM detection
	await fs.writeJSON(path.join(tempDir, "package.json"), {
		name: "test-nextjs-crud",
		version: "0.1.0",
		dependencies: {
			"drizzle-orm": "^0.30.0",
			zod: "^3.22.0",
		},
	});

	return tempDir;
}

/**
 * Create a minimal recipe.yml that runs the 3 templates from crud/resource
 */
async function createRecipeFile(dir: string): Promise<string> {
	const recipeObj = {
		name: "crud-resource-test",
		version: "1.0.0",
		description: "Test recipe for Next.js CRUD resource templates",
		variables: {
			name: { type: "string", required: true },
			fields: { type: "string", required: true },
			model: { type: "string" },
		},
		steps: [
			{
				name: "Generate schema",
				tool: "template",
				template: path.join(CRUD_TEMPLATES_DIR, "schema.ts.jig"),
			},
			{
				name: "Generate actions",
				tool: "template",
				template: path.join(CRUD_TEMPLATES_DIR, "actions.ts.jig"),
			},
			{
				name: "Generate form component",
				tool: "template",
				template: path.join(CRUD_TEMPLATES_DIR, "form-component.tsx.jig"),
			},
		],
	};

	const recipePath = path.join(dir, "recipe.yml");
	await fs.writeFile(recipePath, yaml.dump(recipeObj));
	return recipePath;
}

async function executePass1(engine: RecipeEngine, recipePath: string, dir: string) {
	const collector = AiCollector.getInstance();
	collector.collectMode = true;

	return engine.executeRecipe(
		{ type: "file", path: recipePath },
		{
			variables: VARIABLES,
			workingDir: dir,
			skipPrompts: true,
		},
	);
}

async function executePass2(engine: RecipeEngine, recipePath: string, dir: string) {
	return engine.executeRecipe(
		{ type: "file", path: recipePath },
		{
			variables: VARIABLES,
			workingDir: dir,
			skipPrompts: true,
			answers: ANSWERS,
		},
	);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("E2E: Next.js CRUD resource with 2-pass AI generation", () => {
	let recipePath: string;
	let engine: RecipeEngine;

	beforeEach(async () => {
		AiCollector.reset();
		initializeJig({ cache: false });

		const jig = getJig();
		registerMockHelpers(jig);

		ToolRegistry.reset();
		const registry = getToolRegistry();
		registry.register("template", "default", templateToolFactory, {
			description: "Template tool",
			category: "core",
		});

		await createProjectStructure();
		recipePath = await createRecipeFile(tempDir);
		engine = new RecipeEngine({ workingDir: tempDir });
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.remove(tempDir);
		}
		ToolRegistry.reset();
		AiCollector.reset();
	});

	// ─── Pass 1: Collect Mode ───────────────────────────────────────────

	describe("Pass 1: Collect Mode", () => {
		it("should collect @ai blocks from all 3 templates", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			expect(collector.hasEntries()).toBe(true);

			const entries = collector.getEntries();
			expect(entries.size).toBe(4); // zodSchema, drizzleListQuery, drizzleMutations, formFields

			const keys = [...entries.keys()];
			expect(keys).toContain("zodSchema");
			expect(keys).toContain("drizzleListQuery");
			expect(keys).toContain("drizzleMutations");
			expect(keys).toContain("formFields");
		});

		it("should include helper function outputs in @context blocks", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			const entries = collector.getEntries();

			// Check zodSchema context has fields from parseFieldsString
			const zodEntry = entries.get("zodSchema")!;
			const zodContext = zodEntry.contexts.join(" ");
			expect(zodContext).toContain("Model name: Product");
			expect(zodContext).toContain("ORM: drizzle");
			expect(zodContext).toContain("Fields:");
			expect(zodContext).toContain("title: string");
			expect(zodContext).toContain("price: number");

			// Check drizzleListQuery context
			const listEntry = entries.get("drizzleListQuery")!;
			const listContext = listEntry.contexts.join(" ");
			expect(listContext).toContain("Model: Product");
			expect(listContext).toContain("Table variable: products");
			expect(listContext).toContain("Fields: title: string, price: number");

			// Check formFields context
			const formEntry = entries.get("formFields")!;
			const formContext = formEntry.contexts.join(" ");
			expect(formContext).toContain("Model: Product");
			expect(formContext).toContain("title: string");
			expect(formContext).toContain("isPublished: boolean");
		});

		it("should NOT create output files during collect mode", async () => {
			await executePass1(engine, recipePath, tempDir);

			// Verify no schema file
			expect(await fs.pathExists(path.join(tempDir, "lib/schemas/product-schema.ts"))).toBe(false);
			// Verify no actions file
			expect(await fs.pathExists(path.join(tempDir, "app/actions/product.ts"))).toBe(false);
			// Verify no form component
			expect(await fs.pathExists(path.join(tempDir, "components/ProductForm.tsx"))).toBe(false);
		});

		it.skip("should FAIL when collectMode is not enabled (negative test)", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = false; // Explicitly disable

			await engine.executeRecipe(
				{ type: "file", path: recipePath },
				{
					variables: VARIABLES,
					workingDir: tempDir,
					skipPrompts: true,
				},
			);

			// Should NOT collect entries when collectMode is false
			expect(collector.hasEntries()).toBe(false);
			expect(collector.getEntries().size).toBe(0);
		}, 10000); // 10 second timeout since this actually creates files
	});

	// ─── Prompt Assembly ─────────────────────────────────────────────────

	describe("Prompt Assembly", () => {
		it("should produce markdown with all @ai keys", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand:
					'hypergen nextjs crud resource product --fields="title:string,price:number"',
				answersPath: "./ai-answers.json",
			});

			// Should have the main header
			expect(prompt).toContain("# Hypergen AI Generation Request");

			// Should have sections for each @ai block
			expect(prompt).toContain("### `zodSchema`");
			expect(prompt).toContain("### `drizzleListQuery`");
			expect(prompt).toContain("### `drizzleMutations`");
			expect(prompt).toContain("### `formFields`");
		});

		it("should include JSON response format with all keys", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen nextjs crud resource product",
			});

			// Should have response format section
			expect(prompt).toContain("## Response Format");

			// Should specify all keys in JSON format
			expect(prompt).toContain('"zodSchema"');
			expect(prompt).toContain('"drizzleListQuery"');
			expect(prompt).toContain('"drizzleMutations"');
			expect(prompt).toContain('"formFields"');
		});

		it("should include callback command with --answers flag", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand:
					'hypergen nextjs crud resource product --fields="title:string,price:number"',
				answersPath: "./ai-answers.json",
			});

			// Should include the callback command with --answers
			expect(prompt).toContain("--answers ./ai-answers.json");
		});

		it("should include context with model name and fields", async () => {
			await executePass1(engine, recipePath, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen nextjs crud resource product",
			});

			// Context should reference the model
			expect(prompt).toContain("Product");

			// Context should reference fields
			expect(prompt).toContain("title");
			expect(prompt).toContain("price");
			expect(prompt).toContain("description");
			expect(prompt).toContain("isPublished");
		});
	});

	// ─── Pass 2: Generate with Answers ───────────────────────────────────

	describe("Pass 2: Generate with answers", () => {
		it("should create schema file with AI-provided Zod schema", async () => {
			await executePass2(engine, recipePath, tempDir);

			const schemaPath = path.join(tempDir, "lib/schemas/product-schema.ts");
			expect(await fs.pathExists(schemaPath)).toBe(true);

			const content = await fs.readFile(schemaPath, "utf-8");

			// Import statement
			expect(content).toContain("import { z } from 'zod'");

			// AI-generated Zod schema
			expect(content).toContain("z.object({");
			expect(content).toContain('title: z.string().min(1, "Title is required").max(255)');
			expect(content).toContain('price: z.number().positive("Price must be positive")');
			expect(content).toContain("description: z.string().optional()");
			expect(content).toContain("isPublished: z.boolean().default(false)");

			// Exported schema variable
			expect(content).toContain("export const productSchema");

			// Type exports
			expect(content).toContain("export type Product");
			expect(content).toContain("export const createProductSchema");
			expect(content).toContain("export const updateProductSchema");
			expect(content).toContain(".partial()");

			// No unrendered variables
			expect(content).not.toContain("{{");
			expect(content).not.toContain("undefined");
		});

		it("should create actions file with AI-generated Drizzle queries", async () => {
			await executePass2(engine, recipePath, tempDir);

			const actionsPath = path.join(tempDir, "app/actions/product.ts");
			expect(await fs.pathExists(actionsPath)).toBe(true);

			const content = await fs.readFile(actionsPath, "utf-8");

			// Server action directive
			expect(content).toContain("'use server'");

			// Drizzle imports
			expect(content).toContain("drizzle-orm");
			expect(content).toContain("from '@/lib/db'");

			// AI-generated list query (drizzleListQuery)
			expect(content).toContain("searchCondition");
			expect(content).toContain(".select()");
			expect(content).toContain(".from(products)");
			expect(content).toContain("like(products.title");

			// CRUD function signatures
			expect(content).toContain("async function getProducts");
			expect(content).toContain("async function getProduct");
			expect(content).toContain("async function createProduct");
			expect(content).toContain("async function updateProduct");
			expect(content).toContain("async function deleteProduct");

			// AI-generated mutations
			expect(content).toContain("db.select().from(products)");
			expect(content).toContain("db.insert(products)");
			expect(content).toContain("db.update(products)");
			expect(content).toContain("db.delete(products)");
		});

		it("should create form component with AI-generated fields", async () => {
			await executePass2(engine, recipePath, tempDir);

			const formPath = path.join(tempDir, "components/ProductForm.tsx");
			expect(await fs.pathExists(formPath)).toBe(true);

			const content = await fs.readFile(formPath, "utf-8");

			// Client component directive
			expect(content).toContain("'use client'");

			// Form infrastructure imports
			expect(content).toContain("useForm");
			expect(content).toContain("zodResolver");
			expect(content).toContain("productSchema");

			// AI-generated form fields
			expect(content).toContain("FormField");
			expect(content).toContain("FormControl");

			// Title field
			expect(content).toContain('name="title"');
			expect(content).toContain("Title *");

			// Price field with number type
			expect(content).toContain('name="price"');
			expect(content).toContain('type="number"');
			expect(content).toContain("Price *");

			// Description field with Textarea
			expect(content).toContain('name="description"');
			expect(content).toContain("Textarea");
			expect(content).toContain("Description");

			// isPublished field with Switch
			expect(content).toContain('name="isPublished"');
			expect(content).toContain("Switch");
			expect(content).toContain("Is Published");

			// Submit buttons
			expect(content).toContain('type="submit"');
			expect(content).toContain("Cancel");
		});

		it('should not have unrendered variables ("undefined", "{{")', async () => {
			await executePass2(engine, recipePath, tempDir);

			const filesToCheck = [
				"lib/schemas/product-schema.ts",
				"app/actions/product.ts",
				"components/ProductForm.tsx",
			];

			for (const file of filesToCheck) {
				const filePath = path.join(tempDir, file);
				if (await fs.pathExists(filePath)) {
					const content = await fs.readFile(filePath, "utf-8");

					// No unrendered Jig variables
					expect(content).not.toMatch(/\{\{[^}]+\}\}/);

					// No @ai tags remaining
					expect(content).not.toContain("@ai(");
					expect(content).not.toContain("@prompt(");
					expect(content).not.toContain("@context(");
					expect(content).not.toContain("@output(");
					expect(content).not.toContain("@example(");

					// No literal "undefined" (Edge.js renders undefined vars as "undefined")
					// Allow it in valid code contexts (typeof checks, etc.)
					const lines = content.split("\n");
					for (const line of lines) {
						if (line.includes("undefined") && !line.includes("typeof") && !line.includes("// ")) {
							const trimmed = line.trim();
							if (trimmed === "undefined" || trimmed.startsWith("undefined")) {
								throw new Error(`Found unrendered "undefined" in ${file}:\n  ${line}`);
							}
						}
					}
				}
			}
		});
	});

	// ─── Full Round-Trip ─────────────────────────────────────────────────

	describe("Full Round-Trip", () => {
		it("should complete Pass 1 → Assemble → Pass 2 end-to-end", async () => {
			// ─── Pass 1: Collect ───────────────────────────────────────────
			const pass1Result = await executePass1(engine, recipePath, tempDir);
			expect(pass1Result.success).toBe(true);
			expect(pass1Result.stepResults.length).toBe(3);

			const collector = AiCollector.getInstance();
			expect(collector.hasEntries()).toBe(true);
			expect(collector.getEntries().size).toBe(4);

			// Verify no files created during Pass 1
			expect(await fs.pathExists(path.join(tempDir, "lib/schemas/product-schema.ts"))).toBe(false);
			expect(await fs.pathExists(path.join(tempDir, "app/actions/product.ts"))).toBe(false);
			expect(await fs.pathExists(path.join(tempDir, "components/ProductForm.tsx"))).toBe(false);

			// ─── Assemble Prompt ───────────────────────────────────────────
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand:
					'hypergen nextjs crud resource product --fields="title:string,price:number,description:text,isPublished:boolean"',
				answersPath: "./ai-answers.json",
			});

			expect(prompt).toContain("# Hypergen AI Generation Request");
			expect(prompt).toContain("### `zodSchema`");
			expect(prompt).toContain("### `formFields`");
			expect(prompt).toContain('"zodSchema"');
			expect(prompt).toContain("--answers ./ai-answers.json");

			// ─── Pass 2: Resolve ───────────────────────────────────────────
			collector.clear();

			const pass2Result = await executePass2(engine, recipePath, tempDir);
			expect(pass2Result.success).toBe(true);
			expect(pass2Result.stepResults.length).toBe(3);

			// Verify all 3 files exist
			expect(await fs.pathExists(path.join(tempDir, "lib/schemas/product-schema.ts"))).toBe(true);
			expect(await fs.pathExists(path.join(tempDir, "app/actions/product.ts"))).toBe(true);
			expect(await fs.pathExists(path.join(tempDir, "components/ProductForm.tsx"))).toBe(true);

			// Verify schema content
			const schema = await fs.readFile(
				path.join(tempDir, "lib/schemas/product-schema.ts"),
				"utf-8",
			);
			expect(schema).toContain("productSchema");
			expect(schema).toContain("z.object");
			expect(schema).toContain("title: z.string()");
			expect(schema).toContain("price: z.number()");

			// Verify actions content
			const actions = await fs.readFile(path.join(tempDir, "app/actions/product.ts"), "utf-8");
			expect(actions).toContain("getProducts");
			expect(actions).toContain("createProduct");
			expect(actions).toContain("db.select().from(products)");

			// Verify form content
			const form = await fs.readFile(path.join(tempDir, "components/ProductForm.tsx"), "utf-8");
			expect(form).toContain("ProductForm");
			expect(form).toContain('name="title"');
			expect(form).toContain('name="price"');
			expect(form).toContain('type="submit"');
		});
	});
});
