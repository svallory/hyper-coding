import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
	},
	format: ["esm"],
	dts: true, // Type declarations enabled
	sourcemap: true,
	clean: true,
	target: "node20",
	splitting: false,
});
