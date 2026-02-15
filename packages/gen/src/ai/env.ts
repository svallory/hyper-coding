/**
 * AI Environment Variable Resolution
 *
 * Centralizes API key resolution from environment variables.
 * Loads .env files via dotenvx on first use.
 */

import fs from "node:fs";
import createDebug from "debug";

const debug = createDebug("hypergen:ai:env");

/**
 * Well-known environment variable names for each AI provider's API key.
 * These match the defaults used by the Vercel AI SDK provider packages.
 */
export const PROVIDER_API_KEY_ENV_VARS: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	google: "GOOGLE_GENERATIVE_AI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	groq: "GROQ_API_KEY",
	cohere: "COHERE_API_KEY",
	xai: "XAI_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	perplexity: "PERPLEXITY_API_KEY",
	together: "TOGETHER_AI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
};

/** All well-known env var names (for auto-detection scans) */
export const ALL_KNOWN_API_KEY_VARS = Object.values(PROVIDER_API_KEY_ENV_VARS);

let dotenvLoaded = false;

/**
 * Ensure .env files are loaded into process.env.
 * Called lazily on first API key resolution.
 */
export function loadDotenv(): void {
	if (dotenvLoaded) return;
	dotenvLoaded = true;

	// Only attempt to load if a .env file actually exists — dotenvx is noisy
	// about missing files and there's no reliable way to silence it.
	if (!fs.existsSync(".env")) {
		debug("No .env file found, skipping dotenvx");
		return;
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const dotenvx = require("@dotenvx/dotenvx");
		dotenvx.config({ quiet: true });
		debug("Loaded .env file via dotenvx");
	} catch {
		debug("dotenvx not available");
	}
}

/**
 * Resolve an API key from the environment.
 *
 * @param envVarName Explicit env var name from config (e.g. 'ANTHROPIC_API_KEY')
 * @param provider   Provider name, used to infer default env var when envVarName is omitted
 * @returns The API key string, or undefined if not found
 */
export function resolveApiKey(
	envVarName: string | undefined,
	provider: string,
): string | undefined {
	loadDotenv();

	// If an explicit env var name is given, use it
	if (envVarName) {
		const value = process.env[envVarName];
		if (value) {
			debug("Resolved API key from explicit env var: %s", envVarName);
			return value;
		}
		debug("Explicit env var %s is not set", envVarName);
		return undefined;
	}

	// Fall back to well-known env var for this provider
	const defaultVar = PROVIDER_API_KEY_ENV_VARS[provider];
	if (defaultVar) {
		const value = process.env[defaultVar];
		if (value) {
			debug("Resolved API key from provider default env var: %s", defaultVar);
			return value;
		}
	}

	return undefined;
}

/**
 * Get the env var name that would be used for a provider (for error messages).
 */
export function getExpectedEnvVar(
	envVarName: string | undefined,
	provider: string,
): string {
	return (
		envVarName ||
		PROVIDER_API_KEY_ENV_VARS[provider] ||
		`${provider.toUpperCase()}_API_KEY`
	);
}

/**
 * Check if any API key is available for the given config, without loading it.
 * Used by auto-detection in resolveTransport.
 */
export function hasApiKeyAvailable(
	envVarName: string | undefined,
	provider: string | undefined,
): boolean {
	if (!provider) return false;
	loadDotenv();
	return !!resolveApiKey(envVarName, provider);
}
