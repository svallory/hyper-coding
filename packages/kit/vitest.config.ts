import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const srcDir = path.resolve(__dirname, "./src");
const testsDir = path.resolve(__dirname, "./tests");

export default defineConfig({
	plugins: [
		tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] }),
	],
	resolve: {
		alias: {
			"#": srcDir,
			"#/": `${srcDir}/`,
			"#/tests": testsDir,
			"#/tests/": `${testsDir}/`,
			"#/fixtures": path.resolve(testsDir, "fixtures"),
			"#/fixtures/": path.resolve(testsDir, "fixtures/"),
			"#/helpers": path.resolve(testsDir, "helpers"),
			"#/helpers/": path.resolve(testsDir, "helpers/"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"**/*.d.ts",
				"**/*.config.*",
				"**/tests/**",
			],
		},
		testTimeout: 10000,
	},
});
