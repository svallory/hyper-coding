import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"commands/kit/install": "src/commands/kit/install.ts",
		"commands/kit/update": "src/commands/kit/update.ts",
		"commands/kit/list": "src/commands/kit/list.ts",
		"commands/kit/info": "src/commands/kit/info.ts",
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
