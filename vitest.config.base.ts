import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Create a base vitest config with shared settings and alias resolution for # imports.
 * @param importMetaUrl - Pass import.meta.url from the package's vitest.config.ts
 */
export function createVitestConfig(importMetaUrl: string): UserConfig {
	const __dirname = path.dirname(fileURLToPath(importMetaUrl));

	// Build alias entries for all # imports to resolve from src/ instead of dist/
	const alias: Record<string, string> = {};

	// Add patterns for common import paths
	const aliasPatterns = [
		"ai",
		"actions",
		"commands",
		"discovery",
		"hooks",
		"lib",
		"ops",
		"parsers",
		"prompts",
		"recipe-engine",
		"template-engines",
		"tokens",
		"utils",
		"render",
		"capabilities",
		"test",
		"errors",
		"config",
	];

	for (const pattern of aliasPatterns) {
		// Wildcard import like: import { x } from "#utils/something"
		alias[`#${pattern}/`] = `${path.resolve(__dirname, "src", pattern)}/`;
	}

	// Also handle test and fixture imports
	alias["#tests/"] = `${path.resolve(__dirname, "tests")}/`;
	alias["#fixtures/"] = `${path.resolve(__dirname, "tests", "fixtures")}/`;

	// Fallback for any # import
	alias["#"] = `${path.resolve(__dirname, "src")}/`;

	return defineConfig({
		resolve: {
			alias,
		},
		test: {
			globals: true,
			environment: "node",
			env: {
				FORCE_COLOR: "true",
			},
			coverage: {
				provider: "v8",
				reporter: ["text", "json", "html"],
				exclude: ["node_modules/**", "dist/**", "**/*.d.ts", "**/*.config.*", "**/tests/**"],
			},
			testTimeout: 30000,
		},
	});
}
