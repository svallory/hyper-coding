import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"commands/init": "src/commands/init.ts",
		"commands/config/show": "src/commands/config/show.ts",
		"help/custom-help": "src/help/custom-help.ts",
	},
	format: ["esm"],
	dts: false,
	sourcemap: true,
	clean: true,
	target: "node20",
	splitting: false,
	banner: {
		js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
	},
});
