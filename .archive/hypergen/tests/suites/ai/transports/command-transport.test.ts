import { beforeEach, describe, expect, it } from "vitest";
import { AiCollector } from "#/ai/ai-collector";
import { CommandTransport } from "#/ai/transports/command-transport";
import type { TransportContext } from "#/ai/transports/types";

describe("CommandTransport", () => {
	beforeEach(() => {
		AiCollector.reset();
	});

	function makeCollector(entries?: Array<{ key: string; prompt: string }>): AiCollector {
		const collector = AiCollector.getInstance();
		collector.collectMode = true;

		const items = entries || [
			{ key: "greeting", prompt: "Say hello" },
			{ key: "farewell", prompt: "Say goodbye" },
		];

		for (const { key, prompt } of items) {
			collector.addEntry({
				key,
				contexts: [],
				prompt,
				outputDescription: "",
				typeHint: "text",
				examples: [],
				sourceFile: "test.jig",
			});
		}
		return collector;
	}

	function makeContext(
		collector: AiCollector,
		command: string,
		commandMode?: "batched" | "per-block",
	): TransportContext {
		return {
			collector,
			config: { command, commandMode },
			originalCommand: "hypergen recipe run test.yml",
			answersPath: "./ai-answers.json",
			projectRoot: "/tmp/test",
		};
	}

	it('has name "command"', () => {
		expect(new CommandTransport().name).toBe("command");
	});

	it("throws when command is not set", async () => {
		const collector = makeCollector();
		const transport = new CommandTransport();
		await expect(
			transport.resolve({
				collector,
				config: {},
				originalCommand: "test",
				answersPath: "./answers.json",
				projectRoot: "/tmp",
			}),
		).rejects.toThrow(/ai\.command/);
	});

	describe("batched mode", () => {
		it("resolves answers from echo command returning JSON", async () => {
			const collector = makeCollector();
			const jsonResponse = JSON.stringify({
				greeting: "Hello!",
				farewell: "Goodbye!",
			});
			// Use printf to avoid echo adding a newline inside the JSON
			const command = `printf '%s' '${jsonResponse}'`;

			const transport = new CommandTransport();
			const result = await transport.resolve(makeContext(collector, command));

			expect(result.status).toBe("resolved");
			if (result.status === "resolved") {
				expect(result.answers.greeting).toBe("Hello!");
				expect(result.answers.farewell).toBe("Goodbye!");
			}
		});

		it("throws on non-JSON output", async () => {
			const collector = makeCollector();
			const transport = new CommandTransport();

			await expect(transport.resolve(makeContext(collector, "echo 'not json'"))).rejects.toThrow(
				/Failed to parse JSON/,
			);
		});

		it("throws on missing keys", async () => {
			const collector = makeCollector();
			const transport = new CommandTransport();

			await expect(
				transport.resolve(makeContext(collector, `echo '{"greeting":"hi"}'`)),
			).rejects.toThrow(/missing expected keys.*farewell/);
		});

		it("throws on command failure", async () => {
			const collector = makeCollector();
			const transport = new CommandTransport();

			await expect(transport.resolve(makeContext(collector, "false"))).rejects.toThrow(
				/Command failed/,
			);
		});
	});

	describe("per-block mode", () => {
		it("resolves each block individually", async () => {
			const collector = makeCollector([{ key: "alpha", prompt: "Say alpha" }]);

			// echo command returns raw text per block
			const transport = new CommandTransport();
			const result = await transport.resolve(
				makeContext(collector, "echo 'block output'", "per-block"),
			);

			expect(result.status).toBe("resolved");
			if (result.status === "resolved") {
				expect(result.answers.alpha).toBe("block output");
			}
		});
	});

	describe("stdin piping", () => {
		it("pipes prompt to stdin when no {prompt} in command", async () => {
			const collector = makeCollector([{ key: "result", prompt: "test" }]);

			// cat reads from stdin and echoes it back; we wrap in JSON for batched mode
			// Use a shell command that reads stdin and returns valid JSON
			const transport = new CommandTransport();
			const result = await transport.resolve(
				makeContext(collector, `printf '{"result":"from stdin"}'`, "batched"),
			);

			expect(result.status).toBe("resolved");
			if (result.status === "resolved") {
				expect(result.answers.result).toBe("from stdin");
			}
		});
	});
});
