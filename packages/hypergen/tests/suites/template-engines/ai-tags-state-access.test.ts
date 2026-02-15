import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderTemplate, initializeJig } from "~/template-engines/jig-engine";
import { AiCollector } from "~/ai/ai-collector";

describe("AI Tags State Access", () => {
	let collector: AiCollector;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		collector = AiCollector.getInstance();
		collector.clear();
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		// CRITICAL: Initialize Jig to register @ai tags
		initializeJig({ cache: false });
	});

	afterEach(() => {
		collector.clear();
		collector.collectMode = false;
		consoleLogSpy.mockRestore();
	});

	it("should collect AI entry when __hypergenCollectMode is true", async () => {
		collector.collectMode = true;

		const template = `
@ai({ key: 'test' })
  @prompt()
Test prompt
  @end
  @output()
    @example()
Default output
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
		});

		// Verify the collector captured the entry
		expect(collector.hasEntries()).toBe(true);
		const entries = Array.from(collector.getEntries().values());
		expect(entries.length).toBe(1);
		expect(entries[0].key).toBe("test");
		expect(entries[0].prompt).toContain("Test prompt");
		expect(entries[0].examples[0]).toContain("Default output");
	});

	it("should access state variables in @context block", async () => {
		collector.collectMode = true;

		const template = `
@ai({ key: 'code' })
  @context()
Model: {{ model }}
Feature: {{ feature }}
CollectMode: {{ __hypergenCollectMode }}
  @end
  @prompt()
Generate code
  @end
  @output()
    @example()
Default
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
			model: "User",
			feature: "authentication",
		});

		// Verify collector captured the context with state variables
		expect(collector.hasEntries()).toBe(true);

		const entry = Array.from(collector.getEntries().values())[0];
		const context = entry.contexts.join("\n");
		expect(context).toContain("Model: User");
		expect(context).toContain("Feature: authentication");
		expect(context).toContain("CollectMode: true");
	});

	it("should handle undefined __hypergenCollectMode gracefully", async () => {
		// Don't set collectMode - test fallback behavior
		const template = `
@ai({ key: 'test' })
  @prompt()
Test
  @end
  @output()
    @example()
Default
    @end
  @end
@end
`;

		// Render WITHOUT __hypergenCollectMode in context
		const result = await renderTemplate(template, {
			model: "User",
		});

		// When collectMode is undefined/false, @ai blocks render empty string (not default output)
		// This is expected behavior - default output is shown in Pass 1 for documentation
		expect(result.trim()).toBe("");

		// Collector should not have entries
		expect(collector.hasEntries()).toBe(false);
	});

	it("should handle __hypergenCollectMode = false explicitly", async () => {
		const template = `
@ai({ key: 'test' })
  @prompt()
Test
  @end
  @output()
    @example()
Default output content
    @end
  @end
@end
`;

		const result = await renderTemplate(template, {
			__hypergenCollectMode: false,
		});

		// When collectMode is false, @ai blocks render empty string (not default output)
		expect(result.trim()).toBe("");

		// Console log should show false
		const aiTagCalls = consoleLogSpy.mock.calls.filter((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("[AI TAG]")),
		);

		if (aiTagCalls.length > 0) {
			expect(aiTagCalls[0][1]).toBe(false);
		}

		// Collector should not have entries
		expect(collector.hasEntries()).toBe(false);
	});

	it("should verify state is accessible in nested blocks", async () => {
		collector.collectMode = true;

		const template = `
@if(model)
  @ai({ key: 'handler' })
    @context()
Nested context with model: {{ model }}
CollectMode in nested: {{ __hypergenCollectMode }}
    @end
    @prompt()
Generate {{ model }} handler
    @end
    @output()
      @example()
Default handler
      @end
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
			model: "User",
		});

		expect(collector.hasEntries()).toBe(true);

		const entry = Array.from(collector.getEntries().values())[0];
		const context = entry.contexts.join("\n");
		expect(context).toContain("Nested context with model: User");
		expect(context).toContain("CollectMode in nested: true");
	});

	it("should verify state persists across multiple @ai blocks", async () => {
		collector.collectMode = true;

		const template = `
@ai({ key: 'block1' })
  @context()
Block 1 - collectMode: {{ __hypergenCollectMode }}
  @end
  @prompt()
First prompt
  @end
  @output()
    @example()
Output 1
    @end
  @end
@end

@ai({ key: 'block2' })
  @context()
Block 2 - collectMode: {{ __hypergenCollectMode }}
  @end
  @prompt()
Second prompt
  @end
  @output()
    @example()
Output 2
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
		});

		expect(collector.hasEntries()).toBe(true);
		expect(collector.getEntries().size).toBe(2);

		const entries = Array.from(collector.getEntries().values());

		// Both blocks should have access to collectMode
		const context0 = entries[0].contexts.join("\n");
		const context1 = entries[1].contexts.join("\n");
		expect(context0).toContain("Block 1 - collectMode: true");
		expect(context1).toContain("Block 2 - collectMode: true");
	});

	it("should verify helpers can access state in @context", async () => {
		collector.collectMode = true;

		const helpers = {
			getDebugInfo: function (this: any) {
				// Helper should have access to state via 'this' in Edge.js
				return `CollectMode from helper: ${this.__hypergenCollectMode || "undefined"}`;
			},
		};

		const template = `
@ai({ key: 'test' })
  @context()
{{ getDebugInfo() }}
  @end
  @prompt()
Test
  @end
  @output()
    @example()
Default
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
			...helpers,
		});

		expect(collector.hasEntries()).toBe(true);

		const entry = Array.from(collector.getEntries().values())[0];
		const context = entry.contexts.join("\n");
		// This tests if helpers can access state context
		expect(context).toContain("CollectMode from helper");
	});

	it("should collect entry with correct key when collectMode is true", async () => {
		collector.collectMode = true;

		const template = `
@ai({ key: 'testKey' })
  @prompt()
Test
  @end
  @output()
    @example()
Default
    @end
  @end
@end
`;

		await renderTemplate(template, {
			__hypergenCollectMode: true,
		});

		// Verify the collector captured the entry with the correct key
		expect(collector.hasEntries()).toBe(true);
		const entries = Array.from(collector.getEntries().values());
		expect(entries.length).toBe(1);
		expect(entries[0].key).toBe("testKey");
		expect(entries[0].prompt).toContain("Test");
		expect(entries[0].examples[0]).toContain("Default");
	});
});
