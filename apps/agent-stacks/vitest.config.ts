import marko from "@marko/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// The Marko compiler, so a test can import a `.marko` tag and render it to a string.
	plugins: [marko({ linked: false })],
	test: {
		environment: "node",
		// Tests read stylesheets as text (`?raw`), so `vitest related` can select them.
		css: { include: /\.css\?raw$/ },
		include: ["tests/**/*.test.ts"],
	},
});
