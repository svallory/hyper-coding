import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		// Every test in this package's suite shells out (`node dist/index.js`,
		// `npm pack`). Those spawns take 2-9s depending on the machine, which
		// overruns vitest's 5s default on slower CI runners.
		testTimeout: 60_000,
	},
});
