import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "./src"),
			"#/tests": path.resolve(__dirname, "./tests"),
			"#/fixtures": path.resolve(__dirname, "./tests/fixtures"),
			"#/helpers": path.resolve(__dirname, "./tests/helpers"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/**", "dist/**", "**/*.d.ts", "**/*.config.*", "**/tests/**"],
		},
		testTimeout: 10000,
	},
});
