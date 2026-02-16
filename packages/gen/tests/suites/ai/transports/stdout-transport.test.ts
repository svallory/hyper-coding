import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCollector } from "#ai/ai-collector";
import { StdoutTransport } from "#ai/transports/stdout-transport";
import type { TransportContext } from "#ai/transports/types";

describe("StdoutTransport", () => {
	beforeEach(() => {
		AiCollector.reset();
	});

	function makeContext(overrides: Partial<TransportContext> = {}): TransportContext {
		const collector = AiCollector.getInstance();
		collector.collectMode = true;
		collector.addEntry({
			key: "testKey",
			contexts: ["some context"],
			prompt: "Generate something",
			outputDescription: "A string",
			typeHint: "text",
			examples: ["example output"],
			sourceFile: "test.jig",
		});

		return {
			collector,
			config: {},
			originalCommand: "hypergen recipe run test.yml",
			answersPath: "./ai-answers.json",
			projectRoot: "/tmp/test",
			...overrides,
		};
	}

	it('has name "stdout"', () => {
		const transport = new StdoutTransport();
		expect(transport.name).toBe("stdout");
	});

	it("returns deferred with exit code 2", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		const transport = new StdoutTransport();
		const result = await transport.resolve(makeContext());

		expect(result).toEqual({ status: "deferred", exitCode: 2 });
		writeSpy.mockRestore();
	});

	it("writes assembled prompt to stdout", async () => {
		const writtenChunks: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
			writtenChunks.push(String(chunk));
			return true;
		});

		const transport = new StdoutTransport();
		await transport.resolve(makeContext());

		const output = writtenChunks.join("");
		// Should contain the prompt and response schema
		expect(output).toContain("testKey");
		expect(output).toContain("Generate something");
		expect(output).toContain("json");

		writeSpy.mockRestore();
	});

	it("uses custom prompt template when provided", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		const transport = new StdoutTransport();

		// Using a non-existent custom template should throw
		await expect(
			transport.resolve(makeContext({ promptTemplate: "/nonexistent/template.jig" })),
		).rejects.toThrow(/Custom prompt template not found/);

		writeSpy.mockRestore();
	});
});
