import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import type { AIExecutionResult } from "#/ai/ai-config";
import { AiService } from "#/ai/ai-service";
import { ApiTransport } from "#/ai/transports/api-transport";
import { resolveTransport } from "#/ai/transports/resolve-transport";
import { StdoutTransport } from "#/ai/transports/stdout-transport";

describe("Transport Integration", () => {
	const savedEnv = { ...process.env };

	beforeEach(() => {
		AiCollector.reset();
		AiService.reset();
		process.env.ANTHROPIC_API_KEY = "test-key";
	});

	afterEach(() => {
		AiService.reset();
		process.env = { ...savedEnv };
	});

	function seedCollector(): AiCollector {
		const collector = AiCollector.getInstance();
		collector.collectMode = true;
		collector.addGlobalContext("This is a React + TypeScript project");
		collector.addEntry({
			key: "componentBody",
			contexts: ["Component is named Button"],
			prompt: "Generate the component body for a Button component",
			outputDescription: "React JSX code",
			typeHint: "jsx-fragment",
			examples: ["<button onClick={onClick}>{label}</button>"],
			sourceFile: "button.jig",
		});
		collector.addEntry({
			key: "testBody",
			contexts: [],
			prompt: "Generate a test for the Button component",
			outputDescription: "Vitest test code",
			typeHint: "typescript",
			examples: [],
			sourceFile: "button.test.jig",
		});
		return collector;
	}

	it("full cycle: collect → stdout transport → deferred", async () => {
		const collector = seedCollector();
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		const transport = resolveTransport({ mode: "stdout" });
		expect(transport).toBeInstanceOf(StdoutTransport);

		const result = await transport.resolve({
			collector,
			config: { mode: "stdout" },
			originalCommand: "hypergen recipe run button.yml",
			answersPath: "./ai-answers.json",
			projectRoot: "/tmp/project",
		});

		expect(result.status).toBe("deferred");
		if (result.status === "deferred") {
			expect(result.exitCode).toBe(2);
		}

		// Stdout should have been called with the prompt
		expect(writeSpy).toHaveBeenCalled();
		const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(output).toContain("componentBody");
		expect(output).toContain("testBody");
		expect(output).toContain("React");

		writeSpy.mockRestore();
	});

	it("full cycle: collect → api transport → resolved answers", async () => {
		const collector = seedCollector();

		const mockAnswers = {
			componentBody: '<button className="btn" onClick={onClick}>{children}</button>',
			testBody:
				'it("renders", () => { render(<Button />); expect(screen.getByRole("button")).toBeDefined(); })',
		};

		const mockResult: AIExecutionResult = {
			output: JSON.stringify(mockAnswers),
			usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
			costUsd: 0.005,
			model: "claude-sonnet-4-5",
			provider: "anthropic",
			retryAttempts: 0,
			durationMs: 1200,
		};

		vi.spyOn(AiService, "getInstance").mockReturnValue({
			generate: vi.fn().mockResolvedValue(mockResult),
			getCostSummary: vi.fn(),
			getCostReport: vi.fn(),
		} as any);

		const transport = resolveTransport({
			mode: "api",
			provider: "anthropic",
			apiKeyEnvVar: "ANTHROPIC_API_KEY",
		});
		expect(transport).toBeInstanceOf(ApiTransport);

		const result = await transport.resolve({
			collector,
			config: {
				mode: "api",
				provider: "anthropic",
				apiKeyEnvVar: "ANTHROPIC_API_KEY",
			},
			originalCommand: "hypergen recipe run button.yml",
			answersPath: "./ai-answers.json",
			projectRoot: "/tmp/project",
		});

		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.answers.componentBody).toContain("btn");
			expect(result.answers.testBody).toContain("renders");
			expect(Object.keys(result.answers)).toHaveLength(2);
		}
	});

	it("full cycle: collect → command transport → resolved answers", async () => {
		const collector = seedCollector();
		const answers = {
			componentBody: "<button>Click</button>",
			testBody: 'test("works", () => {})',
		};

		const transport = resolveTransport({
			mode: "command",
			command: `printf '%s' '${JSON.stringify(answers)}'`,
		});

		const result = await transport.resolve({
			collector,
			config: {
				mode: "command",
				command: `printf '%s' '${JSON.stringify(answers)}'`,
			},
			originalCommand: "hypergen recipe run button.yml",
			answersPath: "./ai-answers.json",
			projectRoot: "/tmp/project",
		});

		expect(result.status).toBe("resolved");
		if (result.status === "resolved") {
			expect(result.answers.componentBody).toBe("<button>Click</button>");
			expect(result.answers.testBody).toBe('test("works", () => {})');
		}
	});

	it("auto detection falls back to stdout when nothing configured", async () => {
		const savedEnv = { ...process.env };
		process.env.ANTHROPIC_API_KEY = undefined;
		process.env.OPENAI_API_KEY = undefined;
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = undefined;

		const transport = resolveTransport({});
		expect(transport).toBeInstanceOf(StdoutTransport);

		process.env = savedEnv;
	});
});
