import marko from "@marko/run/vite";
import staticAdapter from "@marko/run-adapter-static";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		marko({
			adapter: staticAdapter(),
			trailingSlashes: "RedirectWith",
		}),
	],
});
