import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiServiceConfig } from "#/ai/ai-config";
import { ApiTransport } from "#/ai/transports/api-transport";
import { CommandTransport } from "#/ai/transports/command-transport";
import { resolveTransport } from "#/ai/transports/resolve-transport";
import { StdoutTransport } from "#/ai/transports/stdout-transport";

describe("resolveTransport", () => {
	const savedEnv = { ...process.env };

	afterEach(() => {
		// Restore env vars
		process.env = { ...savedEnv };
	});

	describe("explicit modes", () => {
		it("returns StdoutTransport for mode=stdout", () => {
			const transport = resolveTransport({ mode: "stdout" });
			expect(transport).toBeInstanceOf(StdoutTransport);
			expect(transport.name).toBe("stdout");
		});

		it("returns StdoutTransport for mode=off", () => {
			const transport = resolveTransport({ mode: "off" });
			expect(transport).toBeInstanceOf(StdoutTransport);
			expect(transport.name).toBe("stdout");
		});

		it("returns ApiTransport for mode=api with valid config", () => {
			process.env.ANTHROPIC_API_KEY = "test-key";
			const transport = resolveTransport({
				mode: "api",
				provider: "anthropic",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
			expect(transport.name).toBe("api");
		});

		it("returns ApiTransport for mode=api with custom env var", () => {
			process.env.MY_CLAUDE_KEY = "test-key";
			const transport = resolveTransport({
				mode: "api",
				provider: "anthropic",
				apiKeyEnvVar: "MY_CLAUDE_KEY",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
		});

		it("throws for mode=api without provider", () => {
			expect(() => resolveTransport({ mode: "api" })).toThrow(/ai\.provider/);
		});

		it("throws for mode=api without API key", () => {
			process.env.ANTHROPIC_API_KEY = undefined;
			expect(() =>
				resolveTransport({
					mode: "api",
					provider: "anthropic",
				}),
			).toThrow(/ANTHROPIC_API_KEY/);
		});

		it("returns CommandTransport for mode=command with command set", () => {
			const transport = resolveTransport({
				mode: "command",
				command: "echo test",
			});
			expect(transport).toBeInstanceOf(CommandTransport);
			expect(transport.name).toBe("command");
		});

		it("throws for mode=command without ai.command", () => {
			expect(() => resolveTransport({ mode: "command" })).toThrow(/ai\.command/);
		});
	});

	describe("auto mode", () => {
		it("returns StdoutTransport when no config provided", () => {
			const transport = resolveTransport(undefined);
			expect(transport).toBeInstanceOf(StdoutTransport);
		});

		it("returns StdoutTransport for empty config", () => {
			const transport = resolveTransport({});
			expect(transport).toBeInstanceOf(StdoutTransport);
		});

		it("returns ApiTransport when provider and well-known env var are set", () => {
			process.env.ANTHROPIC_API_KEY = "sk-test";
			const transport = resolveTransport({
				provider: "anthropic",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
		});

		it("returns ApiTransport when provider and custom apiKeyEnvVar are set", () => {
			process.env.MY_KEY = "sk-test";
			const transport = resolveTransport({
				provider: "anthropic",
				apiKeyEnvVar: "MY_KEY",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
		});

		it("returns ApiTransport when well-known env var is set (openai)", () => {
			process.env.OPENAI_API_KEY = "sk-test";
			const transport = resolveTransport({
				provider: "openai",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
		});

		it("does not auto-detect api when env var is missing", () => {
			process.env.ANTHROPIC_API_KEY = undefined;
			const transport = resolveTransport({
				provider: "anthropic",
				apiKeyEnvVar: "ANTHROPIC_API_KEY",
			});
			// Falls through to stdout since the env var doesn't exist
			expect(transport).toBeInstanceOf(StdoutTransport);
		});

		it("returns CommandTransport when command is set (no API key)", () => {
			process.env.ANTHROPIC_API_KEY = undefined;
			process.env.OPENAI_API_KEY = undefined;
			process.env.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
			const transport = resolveTransport({
				command: "llm",
			});
			expect(transport).toBeInstanceOf(CommandTransport);
		});

		it("prefers API over command when both are configured", () => {
			process.env.ANTHROPIC_API_KEY = "sk-test";
			const transport = resolveTransport({
				provider: "anthropic",
				command: "llm",
			});
			expect(transport).toBeInstanceOf(ApiTransport);
		});

		it("auto mode with explicit mode=auto behaves same as unset", () => {
			const transport = resolveTransport({ mode: "auto" });
			expect(transport).toBeInstanceOf(StdoutTransport);
		});
	});
});
