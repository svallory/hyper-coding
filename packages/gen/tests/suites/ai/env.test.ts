import { describe, it, expect, afterEach } from "vitest";
import {
	resolveApiKey,
	hasApiKeyAvailable,
	getExpectedEnvVar,
	PROVIDER_API_KEY_ENV_VARS,
} from "#/ai/env";

describe("AI env utilities", () => {
	const savedEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...savedEnv };
	});

	describe("PROVIDER_API_KEY_ENV_VARS", () => {
		it("maps anthropic to ANTHROPIC_API_KEY", () => {
			expect(PROVIDER_API_KEY_ENV_VARS.anthropic).toBe("ANTHROPIC_API_KEY");
		});

		it("maps openai to OPENAI_API_KEY", () => {
			expect(PROVIDER_API_KEY_ENV_VARS.openai).toBe("OPENAI_API_KEY");
		});

		it("maps google to GOOGLE_GENERATIVE_AI_API_KEY", () => {
			expect(PROVIDER_API_KEY_ENV_VARS.google).toBe(
				"GOOGLE_GENERATIVE_AI_API_KEY",
			);
		});

		it("maps mistral to MISTRAL_API_KEY", () => {
			expect(PROVIDER_API_KEY_ENV_VARS.mistral).toBe("MISTRAL_API_KEY");
		});

		it("maps groq to GROQ_API_KEY", () => {
			expect(PROVIDER_API_KEY_ENV_VARS.groq).toBe("GROQ_API_KEY");
		});
	});

	describe("resolveApiKey", () => {
		it("resolves from explicit env var name", () => {
			process.env.MY_KEY = "secret-123";
			expect(resolveApiKey("MY_KEY", "anthropic")).toBe("secret-123");
		});

		it("returns undefined when explicit env var is not set", () => {
			delete process.env.NONEXISTENT_VAR;
			expect(resolveApiKey("NONEXISTENT_VAR", "anthropic")).toBeUndefined();
		});

		it("falls back to well-known env var when no explicit name given", () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-123";
			expect(resolveApiKey(undefined, "anthropic")).toBe("sk-ant-123");
		});

		it("returns undefined for unknown provider with no explicit name", () => {
			expect(resolveApiKey(undefined, "unknown-provider")).toBeUndefined();
		});

		it("prefers explicit env var over well-known default", () => {
			process.env.ANTHROPIC_API_KEY = "default-key";
			process.env.CUSTOM_KEY = "custom-key";
			expect(resolveApiKey("CUSTOM_KEY", "anthropic")).toBe("custom-key");
		});
	});

	describe("hasApiKeyAvailable", () => {
		it("returns false when no provider given", () => {
			expect(hasApiKeyAvailable(undefined, undefined)).toBe(false);
		});

		it("returns true when well-known env var is set", () => {
			process.env.OPENAI_API_KEY = "sk-test";
			expect(hasApiKeyAvailable(undefined, "openai")).toBe(true);
		});

		it("returns true when custom env var is set", () => {
			process.env.MY_KEY = "test";
			expect(hasApiKeyAvailable("MY_KEY", "anthropic")).toBe(true);
		});

		it("returns false when env var is not set", () => {
			delete process.env.ANTHROPIC_API_KEY;
			expect(hasApiKeyAvailable(undefined, "anthropic")).toBe(false);
		});
	});

	describe("getExpectedEnvVar", () => {
		it("returns explicit name when provided", () => {
			expect(getExpectedEnvVar("MY_KEY", "anthropic")).toBe("MY_KEY");
		});

		it("returns well-known name for known provider", () => {
			expect(getExpectedEnvVar(undefined, "anthropic")).toBe(
				"ANTHROPIC_API_KEY",
			);
		});

		it("generates uppercase name for unknown provider", () => {
			expect(getExpectedEnvVar(undefined, "foo")).toBe("FOO_API_KEY");
		});
	});
});
