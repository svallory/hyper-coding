import { describe, it, expect, beforeEach } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import { initializeJig, renderTemplate } from "#/template-engines/jig-engine";

describe("AI Tags (2-Pass)", () => {
	beforeEach(() => {
		AiCollector.reset();
		initializeJig({ cache: false });
	});

	describe("collect mode (Pass 1)", () => {
		it("collects a single @ai block", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'mainFields' })
  @context()
    Model: User
  @end
  @prompt()
    Which fields for the card?
  @end
  @output()
    @example()
    ["field1", "field2"]
    @end
  @end
@end`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			// In collect mode, @ai should produce no output
			expect(result.trim()).toBe("");

			expect(collector.hasEntries()).toBe(true);
			const entries = collector.getEntries();
			expect(entries.size).toBe(1);

			const entry = entries.get("mainFields")!;
			expect(entry.key).toBe("mainFields");
			expect(entry.prompt).toContain("Which fields for the card?");
			expect(entry.contexts.length).toBe(1);
			expect(entry.contexts[0]).toContain("Model: User");
			expect(entry.examples.length).toBe(1);
			expect(entry.examples[0]).toContain('["field1", "field2"]');
		});

		it("collects multiple @ai blocks", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'first' })
  @prompt()
    First prompt
  @end
  @output()
    @example()
    format A
    @end
  @end
@end
separator
@ai({ key: 'second' })
  @prompt()
    Second prompt
  @end
  @output()
    @example()
    format B
    @end
  @end
@end`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			// Only the separator text should remain
			expect(result.trim()).toBe("separator");

			const entries = collector.getEntries();
			expect(entries.size).toBe(2);
			expect(entries.get("first")!.prompt).toContain("First prompt");
			expect(entries.get("second")!.prompt).toContain("Second prompt");
		});

		it("collects global @context outside @ai", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@context()
  TypeScript project
@end
@ai({ key: 'code' })
  @prompt()
    Generate code
  @end
  @output()
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			const globalContexts = collector.getGlobalContexts();
			expect(globalContexts.length).toBe(1);
			expect(globalContexts[0]).toContain("TypeScript project");
		});

		it("renders variables inside @prompt body", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'code' })
  @prompt()
    Generate code for {{ name }}
  @end
  @output()
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
				name: "Customer",
			});

			const entry = collector.getEntries().get("code")!;
			expect(entry.prompt).toContain("Generate code for Customer");
		});
	});

	describe("answers mode (Pass 2)", () => {
		it("resolves answer by key", async () => {
			const template = `before
@ai({ key: 'myCode' })
  @prompt()
    Generate code
  @end
  @output()
  @end
@end
after`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: false,
				answers: { myCode: "const x = 42;" },
			});

			expect(result).toContain("before");
			expect(result).toContain("const x = 42;");
			expect(result).toContain("after");
		});

		it("outputs empty string for missing answer key", async () => {
			const template = `@ai({ key: 'missing' })
  @prompt()
    Generate code
  @end
  @output()
  @end
@end`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: false,
				answers: {},
			});

			expect(result.trim()).toBe("");
		});

		it("handles no answers object gracefully", async () => {
			const template = `@ai({ key: 'test' })
  @prompt()
    Generate code
  @end
  @output()
  @end
@end`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: false,
			});

			expect(result.trim()).toBe("");
		});

		it("does not execute children in Pass 2 (no errors from undefined vars)", async () => {
			const template = `@ai({ key: 'result' })
  @prompt()
    Use {{ undefinedVar }} in the prompt
  @end
  @output()
    {{ anotherUndefined }}
  @end
@end`;

			// Pass 2 should skip children entirely, so referencing undefined
			// variables inside @prompt/@output must NOT cause an error.
			const result = await renderTemplate(template, {
				__hypergenCollectMode: false,
				answers: { result: "resolved-answer" },
			});

			expect(result).toContain("resolved-answer");
			// Ensure the undefined variables did NOT render as the string "undefined"
			expect(result).not.toContain("undefined");
		});
	});

	describe("no @ai tags", () => {
		it("renders normally without @ai", async () => {
			const template = `Hello {{ name }}`;

			const result = await renderTemplate(template, {
				__hypergenCollectMode: false,
				name: "World",
			});

			expect(result).toBe("Hello World");
		});

		it("collector stays empty without @ai blocks", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `{{ name }}`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				name: "Test",
			});

			expect(collector.hasEntries()).toBe(false);
		});
	});

	describe("@output key formats", () => {
		it('accepts key on @ai as { key: "name" } object format', async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'myKey' })
  @prompt()
    test
  @end
  @output()
    @example()
    hint
    @end
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			expect(collector.getEntries().has("myKey")).toBe(true);
		});

		it("accepts string-only key on @ai", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai('directKey')
  @prompt()
    test
  @end
  @output()
    @example()
    hint
    @end
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			expect(collector.getEntries().has("directKey")).toBe(true);
		});

		it("accepts { typeHint } on @output", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'typed' })
  @prompt()
    Generate JSON
  @end
  @output({ typeHint: 'json' })
    @example()
    { "example": true }
    @end
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			const entry = collector.getEntries().get("typed")!;
			expect(entry).toBeDefined();
			expect(entry.typeHint).toBe("json");
			expect(entry.examples.length).toBe(1);
			expect(entry.examples[0]).toContain('{ "example": true }');
		});

		it("collects multiple @example blocks within @output", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'multiExample' })
  @prompt()
    Generate a user object
  @end
  @output()
    A JSON object with the following structure:
    @example()
    { "name": "Alice", "age": 30 }
    @end
    @example()
    { "name": "Bob", "age": 25 }
    @end
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			const entry = collector.getEntries().get("multiExample")!;
			expect(entry).toBeDefined();
			expect(entry.examples.length).toBe(2);
			expect(entry.examples[0]).toContain('"Alice"');
			expect(entry.examples[1]).toContain('"Bob"');
			expect(entry.outputDescription).toContain(
				"A JSON object with the following structure:",
			);
		});

		it("handles @output with description text and example", async () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;

			const template = `@ai({ key: 'withDesc' })
  @prompt()
    Generate code
  @end
  @output()
    Return an array of strings in JSON format.
    @example()
    ["item1", "item2", "item3"]
    @end
  @end
@end`;

			await renderTemplate(template, {
				__hypergenCollectMode: true,
				answers: undefined,
			});

			const entry = collector.getEntries().get("withDesc")!;
			expect(entry).toBeDefined();
			expect(entry.outputDescription).toContain(
				"Return an array of strings in JSON format.",
			);
			expect(entry.examples.length).toBe(1);
			expect(entry.examples[0]).toContain('["item1", "item2", "item3"]');
		});
	});
});
