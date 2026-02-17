import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		env: {
			FORCE_COLOR: "true",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"**/*.d.ts",
				"**/*.config.*",
				"**/tests/**",
				"**/.archive/**",
				"**/test-output/**",
			],
		},
		testTimeout: 30000,
		include: [],
	},
	projects: ["packages/*/vitest.config.ts", "hyper-kits/*/vitest.config.ts"],
});
