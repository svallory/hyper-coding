import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [tsconfigPaths({ root: __dirname })],
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "./src/index.ts"),
			"#tests": path.resolve(__dirname, "./tests"),
			"#fixtures": path.resolve(__dirname, "./tests/fixtures"),
			"#helpers": path.resolve(__dirname, "./tests/helpers"),
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
