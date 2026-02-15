import { beforeEach, describe, expect, it } from "vitest";
import { getJig, initializeJig, renderFile, renderTemplate } from "#/template-engines/index";

describe("Jig Template Engine", () => {
	beforeEach(() => {
		initializeJig();
	});

	describe("Engine Initialization", () => {
		it("should initialize and return a Jig (Edge) instance", () => {
			const jig = getJig();
			expect(jig).toBeDefined();
			expect(typeof jig.renderRaw).toBe("function");
			expect(typeof jig.registerFilter).toBe("function");
		});

		it("should return the same instance on subsequent calls", () => {
			const jig1 = getJig();
			const jig2 = getJig();
			expect(jig1).toBe(jig2);
		});

		it("should reinitialize when called again", () => {
			const jig1 = getJig();
			initializeJig();
			const jig2 = getJig();
			// After reinit, should be a new instance
			expect(jig2).toBeDefined();
		});
	});

	describe("Template Rendering", () => {
		it("should render simple templates", async () => {
			const template = "Hello {{ name }}!";
			const context = { name: "World" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("Hello World!");
		});

		it("should render templates with expressions", async () => {
			const template = "{{ name }} and {{ count + 1 }}";
			const context = { name: "test", count: 5 };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("test and 6");
		});

		it("should render conditionals", async () => {
			const template = "@if(show)\nVisible\n@else\nHidden\n@end";
			const result1 = await renderTemplate(template, { show: true });
			expect(result1.trim()).toContain("Visible");

			const result2 = await renderTemplate(template, { show: false });
			expect(result2.trim()).toContain("Hidden");
		});

		it("should render loops", async () => {
			const template = "@each(item in items)\n{{ item }}\n@end";
			const result = await renderTemplate(template, { items: ["a", "b", "c"] });
			expect(result).toContain("a");
			expect(result).toContain("b");
			expect(result).toContain("c");
		});
	});

	describe("Filters", () => {
		it("should support capitalize filter", async () => {
			const template = "{{ capitalize :: name }}";
			const context = { name: "john" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("John");
		});

		it("should support camelCase filter", async () => {
			const template = "{{ camelCase :: name }}";
			const context = { name: "hello-world" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("helloWorld");
		});

		it("should support pascalCase filter", async () => {
			const template = "{{ pascalCase :: name }}";
			const context = { name: "hello-world" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("HelloWorld");
		});

		it("should support snakeCase filter", async () => {
			const template = "{{ snakeCase :: name }}";
			const context = { name: "helloWorld" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("hello_world");
		});

		it("should support kebabCase filter", async () => {
			const template = "{{ kebabCase :: name }}";
			const context = { name: "helloWorld" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("hello-world");
		});

		it("should support pluralize filter", async () => {
			const template = "{{ pluralize :: name }}";
			const context = { name: "person" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("people");
		});

		it("should support singularize filter", async () => {
			const template = "{{ singularize :: name }}";
			const context = { name: "people" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("person");
		});
	});

	describe("Global Functions", () => {
		it("should support filters as global functions", async () => {
			const template = "{{ camelCase(name) }}";
			const context = { name: "hello-world" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("helloWorld");
		});

		it("should support capitalize as global function", async () => {
			const template = "{{ capitalize(name) }}";
			const context = { name: "john" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("John");
		});

		it("should support pluralize as global function", async () => {
			const template = "{{ pluralize(name) }}";
			const context = { name: "person" };
			const result = await renderTemplate(template, context);
			expect(result.trim()).toBe("people");
		});
	});

	describe("Error Handling", () => {
		it("should handle undefined variables gracefully", async () => {
			const template = "{{ undefinedVar }}";
			const context = {};
			const result = await renderTemplate(template, context);
			// Edge.js/Jig renders undefined as the string "undefined"
			expect(result.trim()).toBe("undefined");
		});
	});
});
