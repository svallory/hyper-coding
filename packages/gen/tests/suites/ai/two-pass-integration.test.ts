import { describe, it, expect, beforeEach } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import { PromptAssembler } from "#/ai/prompt-assembler";
import { initializeJig, renderTemplate } from "#/template-engines/jig-engine";

describe("2-Pass AI Integration", () => {
	beforeEach(() => {
		AiCollector.reset();
		initializeJig({ cache: false });
	});

	it("full flow: Pass 1 collects, assembles prompt, Pass 2 resolves", async () => {
		const template = `// Generated
@context()
  TypeScript project, strict mode
@end

@ai({ key: 'listFields' })
  @context()
    Model: User with id, name, email
  @end
  @prompt()
    Which fields should appear on the list view?
  @end
  @output()
    @example()
    ["field1", "field2"]
    @end
  @end
@end

@ai({ key: 'serviceCode' })
  @prompt()
    Write a service class for User
  @end
  @output()
    @example()
    class UserService { ... }
    @end
  @end
@end`;

		// --- Pass 1: Collect ---
		const collector = AiCollector.getInstance();
		collector.collectMode = true;

		const pass1Result = await renderTemplate(template, {
			__hypergenCollectMode: true,
			answers: undefined,
		});

		// Pass 1 should produce only the non-AI parts
		expect(pass1Result).toContain("// Generated");
		// @ai blocks should produce no output
		expect(pass1Result).not.toContain("listFields");
		expect(pass1Result).not.toContain("serviceCode");

		// Collector should have entries
		expect(collector.hasEntries()).toBe(true);
		const entries = collector.getEntries();
		expect(entries.size).toBe(2);
		expect(entries.has("listFields")).toBe(true);
		expect(entries.has("serviceCode")).toBe(true);

		// Global context should be captured
		const globalContexts = collector.getGlobalContexts();
		expect(globalContexts.length).toBe(1);
		expect(globalContexts[0]).toContain("TypeScript project");

		// Block context should be captured
		const listEntry = entries.get("listFields")!;
		expect(listEntry.contexts.length).toBe(1);
		expect(listEntry.contexts[0]).toContain("Model: User");

		// --- Assemble prompt ---
		const assembler = new PromptAssembler();
		const prompt = assembler.assemble(collector, {
			originalCommand: "hypergen run ./test --name=User",
			answersPath: "./answers.json",
		});

		expect(prompt).toContain("# Hypergen AI Generation Request");
		expect(prompt).toContain("### `listFields`");
		expect(prompt).toContain("### `serviceCode`");
		expect(prompt).toContain("TypeScript project");
		expect(prompt).toContain("Model: User");
		expect(prompt).toContain('"listFields"');
		expect(prompt).toContain('"serviceCode"');
		expect(prompt).toContain("--answers ./answers.json");

		// --- Pass 2: Resolve ---
		collector.clear();

		const answers = {
			listFields: '["id", "name", "email"]',
			serviceCode: "class UserService {\n  findAll() { return []; }\n}",
		};

		const pass2Result = await renderTemplate(template, {
			__hypergenCollectMode: false,
			answers,
		});

		expect(pass2Result).toContain("// Generated");
		expect(pass2Result).toContain('["id", "name", "email"]');
		expect(pass2Result).toContain("class UserService {");
		expect(pass2Result).toContain("findAll() { return []; }");
	});

	it("template without @ai renders identically in both modes", async () => {
		const template = `export const {{ name }} = '{{ name }}'`;

		const collector = AiCollector.getInstance();
		collector.collectMode = true;

		const pass1 = await renderTemplate(template, {
			__hypergenCollectMode: true,
			name: "hello",
		});

		collector.clear();

		const pass2 = await renderTemplate(template, {
			__hypergenCollectMode: false,
			name: "hello",
		});

		expect(pass1).toBe(pass2);
		expect(pass1).toBe("export const hello = 'hello'");
	});

	it("multiple global @context blocks accumulate", async () => {
		const template = `@context()
  Context A
@end
@context()
  Context B
@end
@ai({ key: 'k' })
  @prompt()
    test
  @end
  @output()
  @end
@end`;

		const collector = AiCollector.getInstance();
		collector.collectMode = true;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
		});

		const globalContexts = collector.getGlobalContexts();
		expect(globalContexts.length).toBe(2);
		expect(globalContexts[0]).toContain("Context A");
		expect(globalContexts[1]).toContain("Context B");
	});
});
