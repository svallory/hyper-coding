import marko from "@marko/run/vite";
import staticAdapter from "@marko/run-adapter-static";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		marko({
			adapter: staticAdapter(),
			trailingSlashes: "RedirectWith",
		}),
	],
});
