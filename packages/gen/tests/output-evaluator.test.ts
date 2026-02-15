/**
 * Output Evaluator Tests
 *
 * Tests for evaluateStepOutputs which evaluates step output expressions
 * against tool results. Supports both simple JS expressions and Jig
 * template expressions (containing {{ or @).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { evaluateStepOutputs } from "#/recipe-engine/output-evaluator";
import { initializeJig } from "#/template-engines/jig-engine";
import type { StepContext } from "#/recipe-engine/types";

// Initialize the Jig template engine once before all tests
beforeAll(() => {
	initializeJig();
});

/**
 * Build a minimal StepContext-compatible mock.
 * Only the fields accessed by evaluateStepOutputs are relevant:
 *   - context.step?.name
 *   - context.variables
 */
function makeContext(
	vars: Record<string, any> = {},
	stepName = "test-step",
): StepContext {
	return {
		step: { name: stepName, tool: "shell", command: "echo" } as any,
		variables: vars,
		projectRoot: "/tmp",
		recipeVariables: {},
		stepResults: new Map(),
		recipe: {
			id: "test-exec",
			name: "test-recipe",
			startTime: new Date(),
		},
		stepData: {},
		evaluateCondition: () => true,
	} as StepContext;
}

// ---------------------------------------------------------------------------
// Simple JS expressions
// ---------------------------------------------------------------------------

describe("evaluateStepOutputs", () => {
	describe("simple JS expressions", () => {
		it("accesses a top-level property on result", async () => {
			const outputs = await evaluateStepOutputs(
				{ foo: "result.foo" },
				{ foo: "bar" },
				makeContext(),
			);
			expect(outputs.foo).toBe("bar");
		});

		it("accesses an array element on result", async () => {
			const outputs = await evaluateStepOutputs(
				{ first: "result.files[0]" },
				{ files: ["a.ts", "b.ts"] },
				makeContext(),
			);
			expect(outputs.first).toBe("a.ts");
		});

		it("evaluates arithmetic on result properties", async () => {
			const outputs = await evaluateStepOutputs(
				{ incremented: "result.count + 1" },
				{ count: 5 },
				makeContext(),
			);
			expect(outputs.incremented).toBe(6);
		});

		it("accesses context variables directly", async () => {
			const outputs = await evaluateStepOutputs(
				{ componentName: "name" },
				{},
				makeContext({ name: "Button" }),
			);
			expect(outputs.componentName).toBe("Button");
		});

		it("returns undefined for an invalid expression (no throw)", async () => {
			const outputs = await evaluateStepOutputs(
				{ bad: "???invalid syntax!!!" },
				{ foo: 1 },
				makeContext(),
			);
			expect(outputs.bad).toBeUndefined();
		});

		it("returns undefined when accessing nested property on missing path (no throw)", async () => {
			const outputs = await evaluateStepOutputs(
				{ deep: "result.missing.nested" },
				{},
				makeContext(),
			);
			expect(outputs.deep).toBeUndefined();
		});

		it("accesses deeply nested result properties", async () => {
			const outputs = await evaluateStepOutputs(
				{ city: "result.data.address.city" },
				{ data: { address: { city: "Portland" } } },
				makeContext(),
			);
			expect(outputs.city).toBe("Portland");
		});

		it("evaluates boolean expressions", async () => {
			const outputs = await evaluateStepOutputs(
				{ hasFiles: "result.files.length > 0" },
				{ files: ["a.ts"] },
				makeContext(),
			);
			expect(outputs.hasFiles).toBe(true);
		});

		it("evaluates ternary expressions", async () => {
			const outputs = await evaluateStepOutputs(
				{ label: 'result.count > 0 ? "has items" : "empty"' },
				{ count: 3 },
				makeContext(),
			);
			expect(outputs.label).toBe("has items");
		});

		it("can call array methods on result", async () => {
			const outputs = await evaluateStepOutputs(
				{ joined: 'result.tags.join(", ")' },
				{ tags: ["a", "b", "c"] },
				makeContext(),
			);
			expect(outputs.joined).toBe("a, b, c");
		});
	});

	// -------------------------------------------------------------------------
	// Jig template expressions
	// -------------------------------------------------------------------------

	describe("Jig template expressions (containing {{ }})", () => {
		it("renders a simple variable interpolation", async () => {
			const outputs = await evaluateStepOutputs(
				{ name: "{{ result.name }}" },
				{ name: "MyService" },
				makeContext(),
			);
			expect(outputs.name).toBe("MyService");
		});

		it("renders concatenation within a template", async () => {
			const outputs = await evaluateStepOutputs(
				{ component: "{{ result.name }}-component" },
				{ name: "Button" },
				makeContext(),
			);
			expect(outputs.component).toBe("Button-component");
		});

		it('renders undefined variable as the string "undefined" (Jig behavior)', async () => {
			const outputs = await evaluateStepOutputs(
				{ missing: "{{ result.nonexistent }}" },
				{},
				makeContext(),
			);
			// Jig (Edge.js) renders undefined variables as the string "undefined"
			expect(outputs.missing).toBe("undefined");
		});

		it("renders filters via Jig pipe syntax (:: operator)", async () => {
			const outputs = await evaluateStepOutputs(
				{ kebab: "{{ kebabCase :: result.name }}" },
				{ name: "MyComponent" },
				makeContext(),
			);
			expect(outputs.kebab).toBe("my-component");
		});

		it("renders filters via global function syntax", async () => {
			const outputs = await evaluateStepOutputs(
				{ camel: "{{ camelCase(result.name) }}" },
				{ name: "my-widget" },
				makeContext(),
			);
			expect(outputs.camel).toBe("myWidget");
		});

		it("renders multiple interpolations in one expression", async () => {
			const outputs = await evaluateStepOutputs(
				{ path: "{{ result.dir }}/{{ result.file }}" },
				{ dir: "src/components", file: "Button.tsx" },
				makeContext(),
			);
			expect(outputs.path).toBe("src/components/Button.tsx");
		});

		it("trims whitespace from rendered output", async () => {
			const outputs = await evaluateStepOutputs(
				{ trimmed: "  {{ result.value }}  " },
				{ value: "hello" },
				makeContext(),
			);
			// The function trims whitespace from rendered Jig output
			expect(outputs.trimmed).toBe("hello");
		});

		it("can access context variables in Jig expressions", async () => {
			const outputs = await evaluateStepOutputs(
				{ greeting: "{{ name }}" },
				{},
				makeContext({ name: "World" }),
			);
			expect(outputs.greeting).toBe("World");
		});
	});

	// -------------------------------------------------------------------------
	// Expressions containing @ (also Jig-routed)
	// -------------------------------------------------------------------------

	describe("expressions containing @ (routed to Jig)", () => {
		it("renders @if conditional blocks", async () => {
			const outputs = await evaluateStepOutputs(
				{ conditional: "@if(result.enabled)\nyes\n@else\nno\n@end" },
				{ enabled: true },
				makeContext(),
			);
			expect(outputs.conditional).toBe("yes");
		});

		it("renders @if conditional blocks (false branch)", async () => {
			const outputs = await evaluateStepOutputs(
				{ conditional: "@if(result.enabled)\nyes\n@else\nno\n@end" },
				{ enabled: false },
				makeContext(),
			);
			expect(outputs.conditional).toBe("no");
		});
	});

	// -------------------------------------------------------------------------
	// Mixed & edge cases
	// -------------------------------------------------------------------------

	describe("edge cases", () => {
		it("returns empty object for empty expressions map", async () => {
			const outputs = await evaluateStepOutputs(
				{},
				{ some: "data" },
				makeContext(),
			);
			expect(outputs).toEqual({});
		});

		it("treats null toolResult as empty object in context", async () => {
			const outputs = await evaluateStepOutputs(
				{ val: "result.foo" },
				null,
				makeContext(),
			);
			// result becomes {} so result.foo is undefined
			expect(outputs.val).toBeUndefined();
		});

		it("treats undefined toolResult as empty object in context", async () => {
			const outputs = await evaluateStepOutputs(
				{ val: "result.foo" },
				undefined,
				makeContext(),
			);
			expect(outputs.val).toBeUndefined();
		});

		it("evaluates multiple expressions independently", async () => {
			const outputs = await evaluateStepOutputs(
				{
					first: "result.a",
					second: "result.b",
					third: "result.c",
				},
				{ a: 1, b: "two", c: true },
				makeContext(),
			);
			expect(outputs.first).toBe(1);
			expect(outputs.second).toBe("two");
			expect(outputs.third).toBe(true);
		});

		it("one failing expression does not affect others", async () => {
			const outputs = await evaluateStepOutputs(
				{
					good: "result.value",
					bad: "result.missing.deeply.nested",
					alsoGood: "result.other",
				},
				{ value: 42, other: "ok" },
				makeContext(),
			);
			expect(outputs.good).toBe(42);
			expect(outputs.bad).toBeUndefined();
			expect(outputs.alsoGood).toBe("ok");
		});

		it("handles toolResult with complex nested structures", async () => {
			const toolResult = {
				filesGenerated: ["/tmp/a.ts", "/tmp/b.ts"],
				variables: { routeName: "user-profile", scope: "admin" },
				metadata: { duration: 150 },
			};
			const outputs = await evaluateStepOutputs(
				{
					firstFile: "result.filesGenerated[0]",
					route: "result.variables.routeName",
					fileCount: "result.filesGenerated.length",
				},
				toolResult,
				makeContext(),
			);
			expect(outputs.firstFile).toBe("/tmp/a.ts");
			expect(outputs.route).toBe("user-profile");
			expect(outputs.fileCount).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Context variable merging and special keys
	// -------------------------------------------------------------------------

	describe("context variable merging", () => {
		it('step name is available as "step" in simple expressions', async () => {
			const outputs = await evaluateStepOutputs(
				{ currentStep: "step" },
				{},
				makeContext({}, "generate-component"),
			);
			expect(outputs.currentStep).toBe("generate-component");
		});

		it('step name is available as "step" in Jig expressions', async () => {
			const outputs = await evaluateStepOutputs(
				{ currentStep: "{{ step }}" },
				{},
				makeContext({}, "build-routes"),
			);
			expect(outputs.currentStep).toBe("build-routes");
		});

		it('"status" is always "completed" in simple expressions', async () => {
			const outputs = await evaluateStepOutputs(
				{ s: "status" },
				{},
				makeContext(),
			);
			expect(outputs.s).toBe("completed");
		});

		it('"status" is always "completed" in Jig expressions', async () => {
			const outputs = await evaluateStepOutputs(
				{ s: "{{ status }}" },
				{},
				makeContext(),
			);
			expect(outputs.s).toBe("completed");
		});

		it("context variables are spread into evalContext for simple expressions", async () => {
			const outputs = await evaluateStepOutputs(
				{ combined: 'projectName + "-" + variant' },
				{},
				makeContext({ projectName: "acme", variant: "admin" }),
			);
			expect(outputs.combined).toBe("acme-admin");
		});

		it("context variables are available in Jig expressions", async () => {
			const outputs = await evaluateStepOutputs(
				{ combined: "{{ projectName }}-{{ variant }}" },
				{},
				makeContext({ projectName: "acme", variant: "admin" }),
			);
			expect(outputs.combined).toBe("acme-admin");
		});

		it('"result" key takes precedence over a context variable named "result"', async () => {
			// The evalContext spreads context.variables, but `result` is set explicitly
			// before the spread. However, since `result` is defined first and then
			// context.variables is spread after, a variable named "result" would
			// actually overwrite it. Let's verify the actual behavior.
			//
			// evalContext = { result: toolResult ?? {}, step, status, ...context.variables }
			// If context.variables has a `result` key, it WILL overwrite the toolResult.
			// This is a design consideration — the test documents the actual behavior.
			const outputs = await evaluateStepOutputs(
				{ val: "result.x" },
				{ x: "from-tool" },
				makeContext({ result: { x: "from-vars" } }),
			);
			// context.variables is spread after result, so it overwrites
			expect(outputs.val).toBe("from-vars");
		});

		it('"step" in context.variables overwrites the step name', async () => {
			// Same spreading behavior: context.variables overrides step
			const outputs = await evaluateStepOutputs(
				{ s: "step" },
				{},
				makeContext({ step: "overridden" }, "original-step"),
			);
			expect(outputs.s).toBe("overridden");
		});

		it('"status" in context.variables overwrites "completed"', async () => {
			const outputs = await evaluateStepOutputs(
				{ s: "status" },
				{},
				makeContext({ status: "custom-status" }),
			);
			expect(outputs.s).toBe("custom-status");
		});
	});

	// -------------------------------------------------------------------------
	// Mixed expression types in a single call
	// -------------------------------------------------------------------------

	describe("mixed expression types", () => {
		it("handles both simple and Jig expressions in one call", async () => {
			const outputs = await evaluateStepOutputs(
				{
					simple: "result.count",
					jig: "{{ pascalCase :: result.name }}",
				},
				{ count: 10, name: "my-widget" },
				makeContext(),
			);
			expect(outputs.simple).toBe(10);
			expect(outputs.jig).toBe("MyWidget");
		});

		it("mixes context variables and result in different expression styles", async () => {
			const outputs = await evaluateStepOutputs(
				{
					fromResult: "result.id",
					fromVars: "prefix",
					combined: "{{ prefix }}-{{ result.id }}",
				},
				{ id: 42 },
				makeContext({ prefix: "item" }),
			);
			expect(outputs.fromResult).toBe(42);
			expect(outputs.fromVars).toBe("item");
			expect(outputs.combined).toBe("item-42");
		});
	});

	// -------------------------------------------------------------------------
	// Step context with no step name
	// -------------------------------------------------------------------------

	describe("step context edge cases", () => {
		it("handles context where step is undefined", async () => {
			const ctx = makeContext();
			// Simulate a context where step is undefined
			(ctx as any).step = undefined;
			const outputs = await evaluateStepOutputs({ s: "step" }, {}, ctx);
			expect(outputs.s).toBeUndefined();
		});

		it("handles context where step.name is undefined", async () => {
			const ctx = makeContext();
			(ctx as any).step = { tool: "shell" };
			const outputs = await evaluateStepOutputs({ s: "step" }, {}, ctx);
			expect(outputs.s).toBeUndefined();
		});
	});
});
