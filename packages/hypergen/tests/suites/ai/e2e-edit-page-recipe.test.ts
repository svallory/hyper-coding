import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import { PromptAssembler } from "#/ai/prompt-assembler";
import { RecipeEngine } from "#/recipe-engine/recipe-engine";
import { ToolRegistry, getToolRegistry } from "#/recipe-engine/tools/registry";
import { templateToolFactory } from "#/recipe-engine/tools/template-tool";
import { getJig, initializeJig } from "#/template-engines/jig-engine";

// ─── Fixtures ────────────────────────────────────────────────────────

const RECIPE_YML = `
name: edit-page
description: Generate a CRUD edit page (handler + templ + route)
version: 1.0.0

variables:
  model:
    type: string
    required: true
    description: "Model name (PascalCase, e.g. Organization)"

steps:
  - name: Generate edit handler
    tool: template
    template: templates/handler.go.jig

  - name: Generate edit page template
    tool: template
    template: templates/edit_page.templ.jig

  - name: Inject routes
    tool: template
    template: templates/routes_inject.go.jig
`;

const HANDLER_TEMPLATE = `---
to: "internal/handler/{{ snakeCase(model) }}_edit.go"
---
package handler

import (
\t"net/http"
\t"log/slog"

\t"github.com/hlibco/gostart/internal/ctxkeys"
\t"github.com/hlibco/gostart/internal/model"
\t"github.com/hlibco/gostart/internal/service"
\t"github.com/hlibco/gostart/internal/ui"
\t"github.com/hlibco/gostart/internal/ui/pages"
)

@context()
Go web application. Architecture: Handler → Service → Repository.
Tech: net/http router, templ templates, HTMX, TailwindCSS.
Pattern: handlers receive services via DI, use ctxkeys for request context.
@end

type {{ model }}EditHandler struct {
@ai({ key: 'handlerDeps' })
  @context()
Model: {{ model }}
Fields: {{ listModelFields(model) }}
Relations: {{ listModelRelations(model) }}
  @end
  @prompt()
Given the {{ model }} fields and relations, list the service dependencies
this handler needs (one per line, as Go struct fields).
Only include services for the model itself and its direct relations.
  @end
  @output()
    @example()
\tsvc *service.{{ model }}Service
    @end
  @end
@end
}

func (h *{{ model }}EditHandler) EditPage(w http.ResponseWriter, r *http.Request) {
@ai({ key: 'editPageHandler' })
  @context()
Model: {{ model }}
Fields: {{ listModelFields(model) }}
Relations: {{ listModelRelations(model) }}
  @end
  @prompt()
Write the GET handler body for the {{ model }} edit page.
Load the entity by ID from URL path, load related data needed for the edit form,
then render the templ page. Use slog for errors. Follow the existing handler pattern.
Return only the function body (no signature).
  @end
  @output()
    @example()
\t// Load entity, render pages.{{ model }}EditPage(entity)
    @end
  @end
@end
}

func (h *{{ model }}EditHandler) Update(w http.ResponseWriter, r *http.Request) {
@ai({ key: 'updateHandler' })
  @context()
Model: {{ model }}
Fields: {{ listModelFields(model) }}
  @end
  @prompt()
Write the POST handler body to update a {{ model }}.
Parse the form, validate inputs, call the service to update, then redirect.
Only update user-editable fields (skip ID, timestamps, computed fields).
Return only the function body (no signature).
  @end
  @output()
    @example()
\t// Parse form, validate, update, redirect
    @end
  @end
@end
}
`;

const EDIT_PAGE_TEMPLATE = `---
to: "internal/ui/pages/app_{{ snakeCase(model) }}_edit.templ"
---
package pages

import (
\t"github.com/hlibco/gostart/internal/model"
\t"github.com/hlibco/gostart/internal/ui/components/button"
\t"github.com/hlibco/gostart/internal/ui/components/csrf"
\t"github.com/hlibco/gostart/internal/ui/components/input"
\t"github.com/hlibco/gostart/internal/ui/components/label"
\t"github.com/hlibco/gostart/internal/ui/components/page"
\t"github.com/hlibco/gostart/internal/ui/layouts"
)

@ai({ key: 'editableFields' })
  @context()
Model: {{ model }}
Fields: {{ listModelFields(model) }}
Relations: {{ listModelRelations(model) }}
Templ uses Go template syntax: { variable } for expressions, @component() for components.
Existing pattern: settingslist.ClickableTextRow for display, dialog for edit forms.
  @end
  @prompt()
Which fields from {{ model }} should appear on the edit form?
Exclude: ID, timestamps (created_at, updated_at), computed/internal fields.
Include: user-facing text fields, enums (as selects), optional fields.
Return as a JSON array of field names.
  @end
  @output()
    @example()
["name"]
    @end
  @end
@end

templ App{{ model }}Edit(entity *model.{{ model }}) {
\t@layouts.Settings("Edit {{ model }}") {
\t\t@page.Container(page.ContainerProps{Size: page.ContainerSizeNarrow}) {
\t\t\t@page.Header(page.HeaderProps{Title: "Edit {{ model }}"})
\t\t\t@page.Content() {
\t\t\t\t<form
\t\t\t\t\tmethod="POST"
\t\t\t\t\thx-post={ "/app/{{ snakeCase(model) }}/" + entity.ID + "/edit" }
\t\t\t\t\thx-swap="none"
\t\t\t\t\tclass="space-y-6"
\t\t\t\t>
\t\t\t\t\t@csrf.Token()
@ai({ key: 'formBody' })
  @context()
Model: {{ model }}
Fields: {{ listModelFields(model) }}
Existing components: input.Input (Props: ID, Name, Type, Value, Placeholder),
label.Label (Props: For), button.Button (Props: Type, Variant, Size).
  @end
  @prompt()
Generate the templ form body for editing a {{ model }}.
Use the existing UI components (input.Input, label.Label).
Each editable field should have a label + input pair wrapped in a div.space-y-2.
Use proper input types (text, email, url, number, etc.) based on field types.
For enum fields, use a select element.
Return only the templ markup (no package/import/function wrapper).
  @end
  @output()
    @example()
\t\t\t\t\t<div class="space-y-2">
\t\t\t\t\t\t@label.Label(label.Props{For: "name"}) { Name }
\t\t\t\t\t\t@input.Input(input.Props{ID: "name", Name: "name", Type: input.TypeText, Value: entity.Name})
\t\t\t\t\t</div>
    @end
  @end
@end
\t\t\t\t\t<div class="flex justify-end gap-2 pt-4">
\t\t\t\t\t\t@button.Button(button.Props{Type: "button", Variant: button.VariantGhost}) {
\t\t\t\t\t\t\tCancel
\t\t\t\t\t\t}
\t\t\t\t\t\t@button.Button(button.Props{Type: "submit"}) {
\t\t\t\t\t\t\tSave changes
\t\t\t\t\t\t}
\t\t\t\t\t</div>
\t\t\t\t</form>
\t\t\t}
\t\t}
\t}
}
`;

const ROUTES_INJECT_TEMPLATE = `---
to: "internal/routes/routes.go"
inject: true
after: "// CRUD routes"
---
\tmux.HandleFunc("GET /app/{{ snakeCase(model) }}/{id}/edit", {{ camelCase(model) }}EditHandler.EditPage)
\tmux.HandleFunc("POST /app/{{ snakeCase(model) }}/{id}/edit", {{ camelCase(model) }}EditHandler.Update)
`;

const SEED_ROUTES_GO = `package routes

func SetupRoutes(mux *http.ServeMux) {
\t// CRUD routes
}
`;

// ─── Helpers ─────────────────────────────────────────────────────────

// Absolute path to the Go model directory used by the parser
const SANDBOX_DIR = path.resolve(__dirname, "../../../sandbox/go");
const MODEL_DIR = path.join(SANDBOX_DIR, "internal/model");
const PARSER_PATH = path.resolve(SANDBOX_DIR, ".hypergen/helpers/parse_model.go");

// Cache parsed model results to avoid re-running `go run` for each template
const modelCache = new Map<string, { fields: any[]; relations: any[] }>();

function getParsedModel(modelName: string) {
	if (modelCache.has(modelName)) return modelCache.get(modelName)!;
	const result = execSync(`go run "${PARSER_PATH}" "${modelName}" "${MODEL_DIR}"`, {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	const parsed = JSON.parse(result);
	modelCache.set(modelName, parsed);
	return parsed;
}

function listModelFields(modelName: string): string {
	return JSON.stringify(getParsedModel(modelName).fields);
}

function listModelRelations(modelName: string): string {
	return JSON.stringify(getParsedModel(modelName).relations);
}

// ─── Variables ───────────────────────────────────────────────────────

const VARIABLES = {
	model: "Organization",
};

// ─── Pre-crafted AI answers ──────────────────────────────────────────

const ANSWERS: Record<string, string> = {
	handlerDeps: "\tsvc *service.OrganizationService\n\tmemberSvc *service.MemberService",
	editPageHandler:
		'\tid := r.PathValue("id")\n' +
		"\tentity, err := h.svc.GetByID(r.Context(), id)\n" +
		"\tif err != nil {\n" +
		'\t\tslog.Error("failed to load organization", "error", err)\n' +
		'\t\thttp.Error(w, "Not found", http.StatusNotFound)\n' +
		"\t\treturn\n" +
		"\t}\n" +
		"\tui.Render(r.Context(), w, pages.AppOrganizationEdit(entity))",
	updateHandler:
		'\tid := r.PathValue("id")\n' +
		"\tr.ParseForm()\n" +
		'\tname := r.FormValue("name")\n' +
		'\tif name == "" {\n' +
		'\t\thttp.Error(w, "Name is required", http.StatusBadRequest)\n' +
		"\t\treturn\n" +
		"\t}\n" +
		"\tentity, err := h.svc.GetByID(r.Context(), id)\n" +
		"\tif err != nil {\n" +
		'\t\thttp.Error(w, "Not found", http.StatusNotFound)\n' +
		"\t\treturn\n" +
		"\t}\n" +
		"\tentity.Name = name\n" +
		"\tif err := h.svc.Update(r.Context(), entity); err != nil {\n" +
		"\t\thttp.Error(w, err.Error(), http.StatusInternalServerError)\n" +
		"\t\treturn\n" +
		"\t}\n" +
		'\thttp.Redirect(w, r, "/app/organization", http.StatusSeeOther)',
	editableFields: '["Name"]',
	formBody:
		'\t\t\t\t\t<div class="space-y-2">\n' +
		'\t\t\t\t\t\t@label.Label(label.Props{For: "name"}) {\n' +
		"\t\t\t\t\t\t\tOrganization name\n" +
		"\t\t\t\t\t\t}\n" +
		"\t\t\t\t\t\t@input.Input(input.Props{\n" +
		'\t\t\t\t\t\t\tID: "name",\n' +
		'\t\t\t\t\t\t\tName: "name",\n' +
		"\t\t\t\t\t\t\tType: input.TypeText,\n" +
		"\t\t\t\t\t\t\tValue: entity.Name,\n" +
		"\t\t\t\t\t\t})\n" +
		"\t\t\t\t\t</div>",
};

// ─── Test helpers ────────────────────────────────────────────────────

let tempDir: string;

async function createTempStructure(): Promise<string> {
	tempDir = fs.mkdtempSync(path.join(tmpdir(), "e2e-edit-page-"));

	// Write recipe.yml at the root of tempDir
	await fs.writeFile(path.join(tempDir, "recipe.yml"), RECIPE_YML);

	// Write templates
	const templatesDir = path.join(tempDir, "templates");
	await fs.mkdirp(templatesDir);
	await fs.writeFile(path.join(templatesDir, "handler.go.jig"), HANDLER_TEMPLATE);
	await fs.writeFile(path.join(templatesDir, "edit_page.templ.jig"), EDIT_PAGE_TEMPLATE);
	await fs.writeFile(path.join(templatesDir, "routes_inject.go.jig"), ROUTES_INJECT_TEMPLATE);

	// Seed file for injection
	const routesDir = path.join(tempDir, "internal", "routes");
	await fs.mkdirp(routesDir);
	await fs.writeFile(path.join(routesDir, "routes.go"), SEED_ROUTES_GO);

	return tempDir;
}

async function executePass1(engine: RecipeEngine, dir: string) {
	const collector = AiCollector.getInstance();
	collector.collectMode = true;

	return engine.executeRecipe(
		{ type: "file", path: path.join(dir, "recipe.yml") },
		{
			variables: VARIABLES,
			workingDir: dir,
			skipPrompts: true,
		},
	);
}

async function executePass2(engine: RecipeEngine, dir: string) {
	return engine.executeRecipe(
		{ type: "file", path: path.join(dir, "recipe.yml") },
		{
			variables: VARIABLES,
			workingDir: dir,
			skipPrompts: true,
			answers: ANSWERS,
		},
	);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("E2E: edit-page recipe with 2-pass AI generation", () => {
	beforeEach(async () => {
		AiCollector.reset();
		modelCache.clear();
		initializeJig({ cache: false });

		// Register model helpers as Jig globals so templates can call
		// {{ listModelFields(model) }} and {{ listModelRelations(model) }}.
		// These survive because TemplateTool uses getJig() (reuses singleton)
		// instead of initializeJig() (which would wipe globals).
		const jig = getJig();
		jig.global("listModelFields", listModelFields);
		jig.global("listModelRelations", listModelRelations);

		// Reset and configure the tool registry — register the template tool
		// with 'default' as the name (all template steps resolve to 'default')
		ToolRegistry.reset();
		const registry = getToolRegistry();
		registry.register("template", "default", templateToolFactory, {
			description: "Default template tool",
			category: "core",
		});

		await createTempStructure();
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.remove(tempDir);
		}
		ToolRegistry.reset();
	});

	// ── Pass 1: Collect Mode ──────────────────────────────────────────

	describe("Pass 1: Collect Mode", () => {
		it("should collect all @ai block entries from all templates", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			expect(collector.hasEntries()).toBe(true);

			const entries = collector.getEntries();
			expect(entries.size).toBe(5);

			const keys = [...entries.keys()];
			expect(keys).toContain("handlerDeps");
			expect(keys).toContain("editPageHandler");
			expect(keys).toContain("updateHandler");
			expect(keys).toContain("editableFields");
			expect(keys).toContain("formBody");
		});

		it("should verify collector.addEntry is called during template rendering", async () => {
			const collector = AiCollector.getInstance();
			const addEntrySpy = vi.spyOn(collector, "addEntry");

			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			// Verify addEntry was called for each @ai block
			expect(addEntrySpy).toHaveBeenCalledTimes(5);

			// Verify it was called with correct keys (first argument is the entry object)
			const calls = addEntrySpy.mock.calls;
			const callKeys = calls.map((call) => call[0].key); // call[0] is the entry object, .key is the key
			expect(callKeys).toContain("handlerDeps");
			expect(callKeys).toContain("editPageHandler");
			expect(callKeys).toContain("updateHandler");
			expect(callKeys).toContain("editableFields");
			expect(callKeys).toContain("formBody");
		});

		it("should collect entries with helper function outputs in context", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const entries = collector.getEntries();

			// Verify handlerDeps has helper outputs in context
			const handlerDeps = entries.get("handlerDeps")!;
			const allContext = handlerDeps.contexts.join(" ");

			// Should contain the JSON output from listModelFields helper
			expect(allContext).toContain("Fields:");
			expect(allContext).toContain("Relations:");

			// Should be parseable JSON from helper
			expect(() => {
				// Extract JSON from context
				const fieldsMatch = allContext.match(/Fields:\s*(\[.*?\])/s);
				if (fieldsMatch) JSON.parse(fieldsMatch[1]);
			}).not.toThrow();
		});

		it("should collect global context with project stack info", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const globalContexts = collector.getGlobalContexts();

			expect(globalContexts.length).toBeGreaterThanOrEqual(1);
			expect(globalContexts.some((c) => c.includes("Handler"))).toBe(true);
			expect(globalContexts.some((c) => c.includes("Service"))).toBe(true);
			expect(globalContexts.some((c) => c.includes("Repository"))).toBe(true);
		});

		it("should collect per-block context with model metadata", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const entries = collector.getEntries();

			// handlerDeps should have model, fields, and relations in context
			const handlerDeps = entries.get("handlerDeps")!;
			expect(handlerDeps.contexts.length).toBeGreaterThanOrEqual(1);
			expect(handlerDeps.contexts.some((c) => c.includes("Organization"))).toBe(true);

			// editableFields should have model, fields, relations context
			const editableFields = entries.get("editableFields")!;
			expect(editableFields.contexts.length).toBeGreaterThanOrEqual(1);
			expect(editableFields.contexts.some((c) => c.includes("Organization"))).toBe(true);
		});

		it("should capture prompt text describing what AI should decide", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const entries = collector.getEntries();

			expect(entries.get("handlerDeps")?.prompt).toContain("service dependencies");
			expect(entries.get("editPageHandler")?.prompt).toContain("GET handler body");
			expect(entries.get("updateHandler")?.prompt).toContain("POST handler body");
			expect(entries.get("editableFields")?.prompt).toContain("edit form");
			expect(entries.get("formBody")?.prompt).toContain("templ form body");
		});

		it("should NOT create any output files", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			// No handler file should exist
			expect(await fs.pathExists(path.join(tempDir, "internal/handler/organization_edit.go"))).toBe(
				false,
			);
			// No templ page should exist
			expect(
				await fs.pathExists(path.join(tempDir, "internal/ui/pages/app_organization_edit.templ")),
			).toBe(false);
			// Routes file should still be the seed — no injection
			const routes = await fs.readFile(path.join(tempDir, "internal/routes/routes.go"), "utf8");
			expect(routes).not.toContain("organizationEditHandler");
		});

		it("should FAIL when collectMode is not enabled (negative test)", async () => {
			const collector = AiCollector.getInstance();

			// Explicitly disable collectMode
			collector.collectMode = false;

			const engine = new RecipeEngine({ workingDir: tempDir });
			await engine.executeRecipe(
				{ type: "file", path: path.join(tempDir, "recipe.yml") },
				{
					variables: VARIABLES,
					workingDir: tempDir,
					skipPrompts: true,
				},
			);

			// Should NOT collect entries when collectMode is false
			expect(collector.hasEntries()).toBe(false);
			expect(collector.getEntries().size).toBe(0);
		});

		it("should collect entries successfully when helpers ARE registered (positive test)", async () => {
			// This test verifies the opposite case - helpers are properly registered
			// This validates that the previous tests work because helpers were registered in beforeEach
			const engine = new RecipeEngine({ workingDir: tempDir });
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			// Execute recipe - should succeed with helpers registered
			await engine.executeRecipe(
				{ type: "file", path: path.join(tempDir, "recipe.yml") },
				{
					variables: VARIABLES,
					workingDir: tempDir,
					skipPrompts: true,
				},
			);

			// Verify that helpers returned valid data by checking collected context
			const entries = collector.getEntries();
			expect(entries.size).toBe(5);

			const handlerDeps = entries.get("handlerDeps");
			expect(handlerDeps).toBeDefined();

			const allContext = handlerDeps?.contexts.join(" ");

			// Should contain valid JSON arrays (which come from helpers)
			expect(allContext).toMatch(/\[\{.*"name".*"type".*\}\]/);

			// Should NOT contain the string "undefined" where helper output would be
			expect(allContext).not.toContain("Fields: undefined");
			expect(allContext).not.toContain("Relations: undefined");
		});
	});

	// ── Prompt Assembly ───────────────────────────────────────────────

	describe("Prompt Assembly", () => {
		it("should produce markdown with all 5 prompt keys", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page --model=Organization",
				answersPath: "./ai-answers.json",
			});

			expect(prompt).toContain("# Hypergen AI Generation Request");
			expect(prompt).toContain("### `handlerDeps`");
			expect(prompt).toContain("### `editPageHandler`");
			expect(prompt).toContain("### `updateHandler`");
			expect(prompt).toContain("### `editableFields`");
			expect(prompt).toContain("### `formBody`");
		});

		it("should include JSON response format with all keys", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page",
			});

			expect(prompt).toContain("## Response Format");
			expect(prompt).toContain('"handlerDeps"');
			expect(prompt).toContain('"editPageHandler"');
			expect(prompt).toContain('"updateHandler"');
			expect(prompt).toContain('"editableFields"');
			expect(prompt).toContain('"formBody"');
		});

		it("should include callback command with --answers flag", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page --model=Organization",
				answersPath: "./ai-answers.json",
			});

			expect(prompt).toContain("--answers ./ai-answers.json");
		});

		it("should include global context (Go web app stack)", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page",
			});

			expect(prompt).toContain("### Global Context");
			expect(prompt).toContain("Handler");
			expect(prompt).toContain("Service");
			expect(prompt).toContain("Repository");
		});

		it("should include Organization model fields in context", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass1(engine, tempDir);

			const collector = AiCollector.getInstance();
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page",
			});

			expect(prompt).toContain("Organization");
		});
	});

	// ── Pass 2: Resolve with Answers ──────────────────────────────────

	describe("Pass 2: Resolve with Answers", () => {
		it("should create handler file with AI-provided deps and handler bodies", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass2(engine, tempDir);

			const handlerPath = path.join(tempDir, "internal/handler/organization_edit.go");
			expect(await fs.pathExists(handlerPath)).toBe(true);

			const content = await fs.readFile(handlerPath, "utf8");

			// Package and imports
			expect(content).toContain("package handler");
			expect(content).toContain('"net/http"');

			// Struct with AI-provided deps
			expect(content).toContain("type OrganizationEditHandler struct");
			expect(content).toContain("svc *service.OrganizationService");
			expect(content).toContain("memberSvc *service.MemberService");

			// EditPage handler body
			expect(content).toContain("func (h *OrganizationEditHandler) EditPage");
			expect(content).toContain('r.PathValue("id")');
			expect(content).toContain("h.svc.GetByID");
			expect(content).toContain("pages.AppOrganizationEdit(entity)");

			// Update handler body
			expect(content).toContain("func (h *OrganizationEditHandler) Update");
			expect(content).toContain("r.ParseForm()");
			expect(content).toContain('r.FormValue("name")');
			expect(content).toContain("h.svc.Update");
		});

		it("should create templ page with AI-selected fields and form body", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass2(engine, tempDir);

			const templPath = path.join(tempDir, "internal/ui/pages/app_organization_edit.templ");
			expect(await fs.pathExists(templPath)).toBe(true);

			const content = await fs.readFile(templPath, "utf8");

			// Package and imports
			expect(content).toContain("package pages");
			expect(content).toContain('"github.com/hlibco/gostart/internal/model"');

			// AI-selected editable fields
			expect(content).toContain('["Name"]');

			// Function signature
			expect(content).toContain("templ AppOrganizationEdit(entity *model.Organization)");

			// AI-generated form body
			expect(content).toContain("Organization name");
			expect(content).toContain("input.Props");

			// Static form elements preserved
			expect(content).toContain("csrf.Token()");
			expect(content).toContain("Save changes");
			expect(content).toContain("Cancel");
		});

		it("should inject routes into existing routes.go", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass2(engine, tempDir);

			const routesPath = path.join(tempDir, "internal/routes/routes.go");
			const content = await fs.readFile(routesPath, "utf8");

			expect(content).toContain("// CRUD routes");
			expect(content).toContain("GET /app/organization/{id}/edit");
			expect(content).toContain("POST /app/organization/{id}/edit");
			expect(content).toContain("organizationEditHandler.EditPage");
			expect(content).toContain("organizationEditHandler.Update");
		});

		it("should preserve non-AI static template content", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });
			await executePass2(engine, tempDir);

			const handlerPath = path.join(tempDir, "internal/handler/organization_edit.go");
			const handler = await fs.readFile(handlerPath, "utf8");

			// Static imports
			expect(handler).toContain('"log/slog"');
			expect(handler).toContain('"github.com/hlibco/gostart/internal/service"');

			// Static function signatures
			expect(handler).toContain(
				"func (h *OrganizationEditHandler) EditPage(w http.ResponseWriter, r *http.Request)",
			);
			expect(handler).toContain(
				"func (h *OrganizationEditHandler) Update(w http.ResponseWriter, r *http.Request)",
			);

			const templPath = path.join(tempDir, "internal/ui/pages/app_organization_edit.templ");
			const templ = await fs.readFile(templPath, "utf8");

			// Static page structure
			expect(templ).toContain('@layouts.Settings("Edit Organization")');
			expect(templ).toContain("page.ContainerSizeNarrow");
			expect(templ).toContain("hx-post");
			expect(templ).toContain("button.VariantGhost");
		});
	});

	// ── Full Round-Trip ───────────────────────────────────────────────

	describe("Full Round-Trip", () => {
		it("should complete Pass 1 → Assemble → Pass 2 end-to-end", async () => {
			const engine = new RecipeEngine({ workingDir: tempDir });

			// ─── Pass 1: Collect ─────────────────────────────────────────
			const pass1Result = await executePass1(engine, tempDir);
			expect(pass1Result.success).toBe(true);
			expect(pass1Result.stepResults.length).toBe(3);

			// Verify collector state
			const collector = AiCollector.getInstance();
			expect(collector.hasEntries()).toBe(true);
			expect(collector.getEntries().size).toBe(5);

			// Verify no files created during Pass 1
			expect(await fs.pathExists(path.join(tempDir, "internal/handler/organization_edit.go"))).toBe(
				false,
			);
			expect(
				await fs.pathExists(path.join(tempDir, "internal/ui/pages/app_organization_edit.templ")),
			).toBe(false);

			// ─── Assemble prompt ─────────────────────────────────────────
			const assembler = new PromptAssembler();
			const prompt = assembler.assemble(collector, {
				originalCommand: "hypergen run crud/edit-page --model=Organization",
				answersPath: "./ai-answers.json",
			});

			expect(prompt).toContain("# Hypergen AI Generation Request");
			expect(prompt).toContain("### `handlerDeps`");
			expect(prompt).toContain("### `formBody`");
			expect(prompt).toContain('"handlerDeps"');
			expect(prompt).toContain("--answers ./ai-answers.json");

			// ─── Pass 2: Resolve ─────────────────────────────────────────
			collector.clear();

			const pass2Result = await executePass2(engine, tempDir);
			expect(pass2Result.success).toBe(true);
			expect(pass2Result.stepResults.length).toBe(3);

			// Verify all 3 files exist
			expect(await fs.pathExists(path.join(tempDir, "internal/handler/organization_edit.go"))).toBe(
				true,
			);
			expect(
				await fs.pathExists(path.join(tempDir, "internal/ui/pages/app_organization_edit.templ")),
			).toBe(true);

			// Verify handler content
			const handler = await fs.readFile(
				path.join(tempDir, "internal/handler/organization_edit.go"),
				"utf8",
			);
			expect(handler).toContain("OrganizationEditHandler");
			expect(handler).toContain("service.OrganizationService");
			expect(handler).toContain('r.PathValue("id")');

			// Verify templ content
			const templ = await fs.readFile(
				path.join(tempDir, "internal/ui/pages/app_organization_edit.templ"),
				"utf8",
			);
			expect(templ).toContain("AppOrganizationEdit");
			expect(templ).toContain("Organization name");
			expect(templ).toContain("Save changes");

			// Verify routes injection
			const routes = await fs.readFile(path.join(tempDir, "internal/routes/routes.go"), "utf8");
			expect(routes).toContain("GET /app/organization/{id}/edit");
			expect(routes).toContain("POST /app/organization/{id}/edit");
		});
	});
});
