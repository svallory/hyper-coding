/**
 * E2E Test: Full Workflow with @ai Tags and Next.js Kit
 *
 * Exercises the complete generation pipeline:
 * 1. Recipe loading and variable resolution
 * 2. Template rendering with Jig engine
 * 3. @ai 2-pass system (Pass 1 collect, Pass 2 resolve from fixture answers)
 * 4. File generation and content validation
 *
 * Scenario: Multi-tenant Todo App with Organization, Member, Todo models
 * Uses pre-computed fixture answers for deterministic, CI-friendly testing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import { AiCollector } from "#/ai/ai-collector";
import { RecipeEngine } from "#/recipe-engine/recipe-engine";
import { initializeJig, getJig } from "#/template-engines/jig-engine";
import { getToolRegistry, ToolRegistry } from "#/recipe-engine/tools/registry";
import { templateToolFactory } from "#/recipe-engine/tools/template-tool";
import { shellToolFactory } from "#/recipe-engine/tools/shell-tool";
import { recipeToolFactory } from "#/recipe-engine/tools/recipe-tool";
import fixtureAnswers from "./fixtures/answers.json";

// ─── Constants ──────────────────────────────────────────────────────

const KIT_PATH = path.resolve(__dirname, "../../../../kit/nextjs");

// ─── Helpers ────────────────────────────────────────────────────────

let tempDir: string;

async function createProjectStructure(): Promise<string> {
  tempDir = fs.mkdtempSync(path.join(tmpdir(), "hypergen-e2e-workflow-"));

  // Create directories that recipes expect
  await fs.mkdirp(path.join(tempDir, "app"));
  await fs.mkdirp(path.join(tempDir, "lib/schemas"));
  await fs.mkdirp(path.join(tempDir, "components"));
  await fs.mkdirp(path.join(tempDir, "db/schema"));

  // Create a minimal package.json so the shell steps don't fail
  await fs.writeJSON(path.join(tempDir, "package.json"), {
    name: "test-multi-tenant-todo",
    version: "0.1.0",
    private: true,
    dependencies: {
      "drizzle-orm": "^0.30.0",
      zod: "^3.22.0",
      "react-hook-form": "^7.50.0",
      "@hookform/resolvers": "^3.3.0",
    },
  });

  return tempDir;
}

/**
 * Execute the crud/resource recipe for a given model.
 *
 * Since the full crud/resource recipe calls sub-recipes (list-page, detail-page,
 * create-page, edit-page) which also run shell commands that try to install deps,
 * we run only the template steps from the resource recipe directly for cleaner testing.
 */
async function executeResourceTemplates(
  engine: RecipeEngine,
  dir: string,
  name: string,
  fields: string,
  answers?: Record<string, string>,
): Promise<void> {
  // Set up the AiCollector
  const collector = AiCollector.getInstance();
  if (!answers) {
    collector.collectMode = true;
  }

  // Run the resource recipe's templates directly via temp recipe files
  const templatesDir = path.join(KIT_PATH, "cookbooks/crud/resource/templates");
  const templates = [
    "schema.ts.jig",
    "actions.ts.jig",
    "form-component.tsx.jig",
  ];

  for (const template of templates) {
    const templatePath = path.join(templatesDir, template);
    if (await fs.pathExists(templatePath)) {
      // Create a minimal recipe YAML that runs just this template
      const recipeObj = {
        name: `${name}-${template.replace(/\./g, "-")}`,
        version: "1.0.0",
        steps: [
          {
            name: `Generate ${template}`,
            tool: "template",
            template: templatePath,
          },
        ],
      };

      const recipePath = path.join(
        dir,
        `_mini_${name}_${template.replace(/\./g, "_")}.yml`,
      );
      await fs.writeFile(recipePath, yaml.dump(recipeObj));

      await engine.executeRecipe(
        { type: "file", path: recipePath },
        {
          variables: {
            name,
            fields,
            model: name.charAt(0).toUpperCase() + name.slice(1),
            database: "sqlite",
            // Kit helpers — needed for @set() and @{ } blocks in templates
            ...mockHelpers,
          },
          workingDir: dir,
          skipPrompts: true,
          answers,
        },
      );
    }
  }
}

/**
 * Execute the page/add recipe's template.
 */
async function executePageTemplate(
  engine: RecipeEngine,
  dir: string,
  pagePath: string,
  pageDescription: string,
): Promise<void> {
  const templatePath = path.join(
    KIT_PATH,
    "cookbooks/page/add/templates/page.tsx.jig",
  );

  // Ensure the directory exists
  await fs.mkdirp(path.join(dir, "app", pagePath));

  const recipeObj = {
    name: `page-${pagePath.replace(/\//g, "-")}`,
    version: "1.0.0",
    steps: [
      {
        name: `Generate ${pagePath} page`,
        tool: "template",
        template: templatePath,
      },
    ],
  };

  const recipePath = path.join(
    dir,
    `_page_${pagePath.replace(/\//g, "_")}.yml`,
  );
  await fs.writeFile(recipePath, yaml.dump(recipeObj));

  await engine.executeRecipe(
    { type: "file", path: recipePath },
    {
      variables: { pagePath, pageDescription },
      workingDir: dir,
      skipPrompts: true,
    },
  );
}

// ─── Mock helpers for template rendering ────────────────────────────

/**
 * Mock helpers that the kit templates use.
 * These are passed as variables to the recipe engine so they're
 * available in @let() assignments and {{ }} interpolation.
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
 * Parse a comma-separated fields string into an array of field objects.
 * e.g. "name:string,email:email,isActive:boolean" =>
 *   [{ name: 'name', type: 'string', isRequired: true }, ...]
 */
const parseFieldsString = (fieldsStr: string) => {
  return fieldsStr.split(",").map((f: string) => {
    const [fieldName, type] = f.trim().split(":");
    return { name: fieldName, type: type || "string", isRequired: true };
  });
};

/**
 * Build a multi-line field description string for AI context blocks.
 * Format: "fieldName: type (required/optional)"
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
        `${f.name}: ${f.type}${f.isRequired ? " (required)" : " (optional)"}${f.documentation ? " — " + f.documentation : ""}`,
    )
    .join("\n");
};

/**
 * Build a single-line comma-separated field description string.
 * Format: "fieldName: type, fieldName: type"
 */
const buildFieldDescriptionsInline = (
  modelFields: Array<{ name: string; type: string }>,
) => {
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
  // Register as globals so they're available in @let() expressions and {{ }} interpolation
  for (const [name, fn] of Object.entries(mockHelpers)) {
    jig.global(name, fn);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Full Workflow: Multi-tenant Todo App E2E", () => {
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
    registry.register("shell", "default", shellToolFactory, {
      description: "Shell tool",
      category: "core",
    });
    registry.register("recipe", "default", recipeToolFactory, {
      description: "Recipe tool",
      category: "core",
    });

    await createProjectStructure();
    engine = new RecipeEngine({ workingDir: tempDir });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.remove(tempDir);
    }
    ToolRegistry.reset();
    AiCollector.reset();
  });

  // ─── Pass 1: Collection Tests ───────────────────────────────────

  describe("Pass 1: AI Block Collection", () => {
    it("should collect @ai blocks from schema template for organization", async () => {
      const collector = AiCollector.getInstance();
      collector.collectMode = true;

      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
      );

      expect(collector.hasEntries()).toBe(true);

      const entries = collector.getEntries();
      expect(entries.has("zodSchema")).toBe(true);

      const zodEntry = entries.get("zodSchema")!;
      expect(zodEntry.key).toBe("zodSchema");
      expect(zodEntry.prompt).toContain("Zod validation schema");
      expect(zodEntry.prompt).toContain("Organization");
      expect(zodEntry.contexts.length).toBeGreaterThan(0);
      expect(zodEntry.contexts[0]).toContain("name: string");
      expect(zodEntry.examples.length).toBeGreaterThan(0);
      expect(zodEntry.examples[0]).toContain("z.object");
    });

    it("should collect @ai blocks from actions template for drizzle ORM", async () => {
      const collector = AiCollector.getInstance();
      collector.collectMode = true;

      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
      );

      const entries = collector.getEntries();

      // Drizzle-specific blocks
      expect(entries.has("drizzleListQuery")).toBe(true);
      expect(entries.has("drizzleMutations")).toBe(true);

      const listEntry = entries.get("drizzleListQuery")!;
      expect(listEntry.prompt).toContain("Drizzle ORM");
      expect(listEntry.prompt).toContain("Organization");
      expect(listEntry.typeHint).toBe("typescript-code");

      const mutationsEntry = entries.get("drizzleMutations")!;
      expect(mutationsEntry.typeHint).toBe("json");
      expect(mutationsEntry.prompt).toContain("GET_BY_ID");
      expect(mutationsEntry.prompt).toContain("CREATE");
    });

    it("should collect @ai blocks from form-component template", async () => {
      const collector = AiCollector.getInstance();
      collector.collectMode = true;

      await executeResourceTemplates(
        engine,
        tempDir,
        "member",
        "email:string,role:string,orgId:string,joinedAt:date",
      );

      const entries = collector.getEntries();
      expect(entries.has("formFields")).toBe(true);

      const formEntry = entries.get("formFields")!;
      expect(formEntry.prompt).toContain("JSX form fields");
      expect(formEntry.prompt).toContain("Member");
      expect(formEntry.typeHint).toBe("jsx-fragment");
    });

    it("should not create files during Pass 1", async () => {
      const collector = AiCollector.getInstance();
      collector.collectMode = true;

      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
      );

      // Verify no schema or action files created
      expect(
        await fs.pathExists(
          path.join(tempDir, "lib/schemas/organization-schema.ts"),
        ),
      ).toBe(false);
      expect(
        await fs.pathExists(path.join(tempDir, "app/actions/organization.ts")),
      ).toBe(false);
    });
  });

  // ─── Pass 2: File Generation Tests ──────────────────────────────

  describe("Pass 2: File Generation with Fixture Answers", () => {
    it("should generate organization schema with Zod validation", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      const schemaPath = path.join(
        tempDir,
        "lib/schemas/organization-schema.ts",
      );
      expect(await fs.pathExists(schemaPath)).toBe(true);

      const content = await fs.readFile(schemaPath, "utf-8");

      // Import
      expect(content).toContain("import { z } from 'zod'");

      // Zod schema from AI
      expect(content).toContain("z.object");
      expect(content).toContain("z.string().min(1");
      expect(content).toContain("organizationSchema");

      // Type exports
      expect(content).toContain("export type Organization");
      expect(content).toContain("createOrganizationSchema");
      expect(content).toContain("updateOrganizationSchema");
      expect(content).toContain(".partial()");

      // No placeholder text
      expect(content).not.toContain("TODO");
      expect(content).not.toContain("undefined");
    });

    it("should generate organization actions with Drizzle queries", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      const actionsPath = path.join(tempDir, "app/actions/organization.ts");
      expect(await fs.pathExists(actionsPath)).toBe(true);

      const content = await fs.readFile(actionsPath, "utf-8");

      // Server action directive
      expect(content).toContain("'use server'");

      // Drizzle imports
      expect(content).toContain("drizzle-orm");
      expect(content).toContain("from '@/lib/db'");

      // AI-generated list query
      expect(content).toContain("db");
      expect(content).toContain(".select()");
      expect(content).toContain(".from(organizations)");

      // CRUD functions exist
      expect(content).toContain("async function getOrganizations");
      expect(content).toContain("async function getOrganization");
      expect(content).toContain("async function createOrganization");
      expect(content).toContain("async function updateOrganization");
      expect(content).toContain("async function deleteOrganization");

      // No TODOs (Drizzle queries filled by AI)
      expect(content).not.toContain("TODO");
      expect(content).not.toContain("Not implemented");
    });

    it("should generate organization form with AI-generated fields", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      const formPath = path.join(tempDir, "components/OrganizationForm.tsx");
      expect(await fs.pathExists(formPath)).toBe(true);

      const content = await fs.readFile(formPath, "utf-8");

      // Client component
      expect(content).toContain("'use client'");

      // Form infrastructure
      expect(content).toContain("useForm");
      expect(content).toContain("zodResolver");
      expect(content).toContain("organizationSchema");

      // AI-generated form fields
      expect(content).toContain("FormField");
      expect(content).toContain("FormControl");
      expect(content).toContain('name="name"');
      expect(content).toContain('name="slug"');

      // Submit buttons
      expect(content).toContain('type="submit"');
      expect(content).toContain("Cancel");
    });

    it("should generate all three models without conflicts", async () => {
      // Generate organization
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      // Generate member (collector must be cleared between runs)
      AiCollector.getInstance().clear();
      await executeResourceTemplates(
        engine,
        tempDir,
        "member",
        "email:string,role:string,orgId:string,joinedAt:date",
        fixtureAnswers.member,
      );

      // Generate todo
      AiCollector.getInstance().clear();
      await executeResourceTemplates(
        engine,
        tempDir,
        "todo",
        "title:string,description:text,status:string,orgId:string,assigneeId:string,dueDate:date",
        fixtureAnswers.todo,
      );

      // All schemas exist
      expect(
        await fs.pathExists(
          path.join(tempDir, "lib/schemas/organization-schema.ts"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "lib/schemas/member-schema.ts")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "lib/schemas/todo-schema.ts")),
      ).toBe(true);

      // All actions exist
      expect(
        await fs.pathExists(path.join(tempDir, "app/actions/organization.ts")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "app/actions/member.ts")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "app/actions/todo.ts")),
      ).toBe(true);

      // All forms exist
      expect(
        await fs.pathExists(
          path.join(tempDir, "components/OrganizationForm.tsx"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "components/MemberForm.tsx")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "components/TodoForm.tsx")),
      ).toBe(true);
    });

    it("should generate member form with role select field", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "member",
        "email:string,role:string,orgId:string,joinedAt:date",
        fixtureAnswers.member,
      );

      const formPath = path.join(tempDir, "components/MemberForm.tsx");
      const content = await fs.readFile(formPath, "utf-8");

      // Email field
      expect(content).toContain('type="email"');
      expect(content).toContain("member@example.com");

      // Role select with options
      expect(content).toContain("Select");
      expect(content).toContain("Admin");
      expect(content).toContain("Member");
      expect(content).toContain("Viewer");
    });

    it("should generate todo schema with enum for status", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "todo",
        "title:string,description:text,status:string,orgId:string,assigneeId:string,dueDate:date",
        fixtureAnswers.todo,
      );

      const schemaPath = path.join(tempDir, "lib/schemas/todo-schema.ts");
      const content = await fs.readFile(schemaPath, "utf-8");

      // Enum for status
      expect(content).toContain("z.enum");
      expect(content).toContain("pending");
      expect(content).toContain("in_progress");
      expect(content).toContain("done");

      // Optional fields
      expect(content).toContain(".optional()");
    });
  });

  // ─── Page Generation Tests ──────────────────────────────────────

  describe("Page Generation", () => {
    it("should generate static pages (login, signup, dashboard)", async () => {
      await executePageTemplate(
        engine,
        tempDir,
        "login",
        "Login to your account",
      );
      await executePageTemplate(
        engine,
        tempDir,
        "signup",
        "Create a new account",
      );
      await executePageTemplate(
        engine,
        tempDir,
        "dashboard",
        "Your dashboard overview",
      );

      // All pages exist
      expect(
        await fs.pathExists(path.join(tempDir, "app/login/page.tsx")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "app/signup/page.tsx")),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "app/dashboard/page.tsx")),
      ).toBe(true);

      // Login page content
      const loginContent = await fs.readFile(
        path.join(tempDir, "app/login/page.tsx"),
        "utf-8",
      );
      expect(loginContent).toContain("Login to your account");
      expect(loginContent).toContain("export default");
      expect(loginContent).toContain("import type { Metadata }");

      // Dashboard page content
      const dashboardContent = await fs.readFile(
        path.join(tempDir, "app/dashboard/page.tsx"),
        "utf-8",
      );
      expect(dashboardContent).toContain("Your dashboard overview");
    });

    it("should generate dynamic pages with params", async () => {
      await executePageTemplate(
        engine,
        tempDir,
        "admin/orgs/[id]/edit",
        "Edit organization details",
      );

      const pagePath = path.join(tempDir, "app/admin/orgs/[id]/edit/page.tsx");
      expect(await fs.pathExists(pagePath)).toBe(true);

      const content = await fs.readFile(pagePath, "utf-8");

      // Should have params type for dynamic segment
      expect(content).toContain("Params");
      expect(content).toContain("id: string");
      expect(content).toContain("params");
      expect(content).toContain("Edit organization details");
    });
  });

  // ─── Content Quality Checks ─────────────────────────────────────

  describe("Content Quality", () => {
    it("should not have unrendered template variables in any generated file", async () => {
      // Generate all models
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      AiCollector.getInstance().clear();
      await executeResourceTemplates(
        engine,
        tempDir,
        "member",
        "email:string,role:string,orgId:string,joinedAt:date",
        fixtureAnswers.member,
      );

      // Check all generated files
      const filesToCheck = [
        "lib/schemas/organization-schema.ts",
        "lib/schemas/member-schema.ts",
        "app/actions/organization.ts",
        "app/actions/member.ts",
        "components/OrganizationForm.tsx",
        "components/MemberForm.tsx",
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
          // Note: allow 'undefined' in code constructs like typeof checks
          const lines = content.split("\n");
          for (const line of lines) {
            if (
              line.includes("undefined") &&
              !line.includes("typeof") &&
              !line.includes("// ")
            ) {
              // Allow it in valid code contexts
              const trimmed = line.trim();
              if (trimmed === "undefined" || trimmed.startsWith("undefined")) {
                throw new Error(
                  `Found unrendered "undefined" in ${file}:\n  ${line}`,
                );
              }
            }
          }
        }
      }
    });

    it("should produce valid TypeScript imports", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      // Schema should import zod
      const schema = await fs.readFile(
        path.join(tempDir, "lib/schemas/organization-schema.ts"),
        "utf-8",
      );
      expect(schema).toMatch(/^import\s+\{.*z.*\}\s+from\s+['"]zod['"]/m);

      // Actions should import from schema
      const actions = await fs.readFile(
        path.join(tempDir, "app/actions/organization.ts"),
        "utf-8",
      );
      expect(actions).toContain("from '@/lib/schemas/organization-schema'");
      expect(actions).toContain("from 'next/cache'");

      // Form should import from actions and schema
      const form = await fs.readFile(
        path.join(tempDir, "components/OrganizationForm.tsx"),
        "utf-8",
      );
      expect(form).toContain("from '@/app/actions/organization'");
      expect(form).toContain("from '@/lib/schemas/organization-schema'");
    });

    it("should maintain cross-file consistency", async () => {
      await executeResourceTemplates(
        engine,
        tempDir,
        "todo",
        "title:string,description:text,status:string,orgId:string,assigneeId:string,dueDate:date",
        fixtureAnswers.todo,
      );

      const schema = await fs.readFile(
        path.join(tempDir, "lib/schemas/todo-schema.ts"),
        "utf-8",
      );
      const actions = await fs.readFile(
        path.join(tempDir, "app/actions/todo.ts"),
        "utf-8",
      );
      const form = await fs.readFile(
        path.join(tempDir, "components/TodoForm.tsx"),
        "utf-8",
      );

      // Schema exports what actions import
      expect(schema).toContain("export const todoSchema");
      expect(schema).toContain("export const createTodoSchema");
      expect(schema).toContain("export const updateTodoSchema");
      expect(schema).toContain("export type Todo");
      expect(schema).toContain("export type CreateTodoInput");
      expect(schema).toContain("export type UpdateTodoInput");

      // Actions import from schema
      expect(actions).toContain("createTodoSchema");
      expect(actions).toContain("updateTodoSchema");
      expect(actions).toContain("CreateTodoInput");
      expect(actions).toContain("UpdateTodoInput");

      // Form uses schema for validation
      expect(form).toContain("todoSchema");
      expect(form).toContain("type Todo");
    });
  });

  // ─── Two-Pass Roundtrip ─────────────────────────────────────────

  describe("Two-Pass Roundtrip", () => {
    it("should collect in Pass 1 and generate in Pass 2 for same model", async () => {
      const collector = AiCollector.getInstance();

      // Pass 1: Collect
      collector.collectMode = true;
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
      );

      // Verify collection
      expect(collector.hasEntries()).toBe(true);
      const entries = collector.getEntries();
      const keys = Array.from(entries.keys());
      expect(keys).toContain("zodSchema");

      // Verify no files written
      expect(
        await fs.pathExists(
          path.join(tempDir, "lib/schemas/organization-schema.ts"),
        ),
      ).toBe(false);

      // Pass 2: Generate with fixture answers
      collector.clear();
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
        fixtureAnswers.organization,
      );

      // Verify files created
      expect(
        await fs.pathExists(
          path.join(tempDir, "lib/schemas/organization-schema.ts"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(tempDir, "app/actions/organization.ts")),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(tempDir, "components/OrganizationForm.tsx"),
        ),
      ).toBe(true);

      // Verify content quality
      const schema = await fs.readFile(
        path.join(tempDir, "lib/schemas/organization-schema.ts"),
        "utf-8",
      );
      expect(schema).toContain("z.object");
      expect(schema).not.toContain("TODO");
    });

    it("should handle multiple models in sequence without state leaks", async () => {
      const collector = AiCollector.getInstance();

      // Pass 1 for organization
      collector.collectMode = true;
      await executeResourceTemplates(
        engine,
        tempDir,
        "organization",
        "name:string,slug:string,createdAt:date",
      );
      const orgEntries = new Map(collector.getEntries());

      // Clear and Pass 1 for member
      collector.clear();
      collector.collectMode = true;
      await executeResourceTemplates(
        engine,
        tempDir,
        "member",
        "email:string,role:string,orgId:string,joinedAt:date",
      );
      const memberEntries = new Map(collector.getEntries());

      // Entries should be independent (no org entries in member)
      const orgZod = orgEntries.get("zodSchema")!;
      const memberZod = memberEntries.get("zodSchema")!;

      expect(orgZod.prompt).toContain("Organization");
      expect(orgZod.prompt).not.toContain("Member");
      expect(memberZod.prompt).toContain("Member");
      expect(memberZod.prompt).not.toContain("Organization");

      // Context should reference different fields
      expect(orgZod.contexts[0]).toContain("name: string");
      expect(orgZod.contexts[0]).toContain("slug: string");
      expect(memberZod.contexts[0]).toContain("email: string");
      expect(memberZod.contexts[0]).toContain("role: string");
    });
  });
});
