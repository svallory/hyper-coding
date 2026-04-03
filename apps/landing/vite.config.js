import netlifyAdapter from "@marko/run-adapter-netlify";
import marko from "@marko/run/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		marko({
			adapter: netlifyAdapter({ edge: true }),
		}),
	],
});
