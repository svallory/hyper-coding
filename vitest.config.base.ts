import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, UserConfig } from "vite";
import { defineConfig } from "vitest/config";

// Custom plugin to resolve # imports in this package and its dependencies.
// enforce: "pre" ensures this runs before Vite's internal vite:resolve plugin,
// so all # imports are redirected to src/ regardless of the package.json
// "imports" field (which maps to dist/).
function hashImportsPlugin(baseDir: string): Plugin {
	return {
		name: "hash-imports",
		enforce: "pre",
		resolveId(id, importer) {
			if (!id.startsWith("#")) return null;

			let pkgDir = baseDir;

			if (importer?.includes("/packages/")) {
				const match = importer.match(/\/packages\/([^\/]+)/);
				if (match) {
					pkgDir = path.resolve(baseDir, "..", match[1]);
				}
			}

			const withoutHash = id.slice(1);
			// Add .ts extension if no extension present, so vitest mock
			// registration and import loading resolve to the same path.
			const addExt = (p: string) => (path.extname(p) ? p : `${p}.ts`);

			if (withoutHash.startsWith("tests/")) {
				return addExt(path.resolve(pkgDir, withoutHash));
			}
			if (withoutHash.startsWith("fixtures/")) {
				return addExt(path.resolve(pkgDir, "tests", withoutHash));
			}
			return addExt(path.resolve(pkgDir, "src", withoutHash));
		},
	};
}

/**
 * Create a base vitest config with shared settings and hash imports plugin.
 * @param importMetaUrl - Pass import.meta.url from the package's vitest.config.ts
 */
export function createVitestConfig(importMetaUrl: string): UserConfig {
	const __dirname = path.dirname(fileURLToPath(importMetaUrl));

	return defineConfig({
		plugins: [hashImportsPlugin(__dirname)],
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
