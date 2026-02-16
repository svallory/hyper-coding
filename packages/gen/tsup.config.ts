import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"commands/gen": "src/commands/gen.ts",
		"commands/recipe/list": "src/commands/recipe/list.ts",
		"commands/recipe/run": "src/commands/recipe/run.ts",
		"commands/recipe/info": "src/commands/recipe/info.ts",
		"commands/recipe/validate": "src/commands/recipe/validate.ts",
		"commands/cookbook/list": "src/commands/cookbook/list.ts",
		"commands/cookbook/info": "src/commands/cookbook/info.ts",
		"hooks/command-not-found": "src/hooks/command-not-found.ts",
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
