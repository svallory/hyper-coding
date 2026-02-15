/**
 * TypeDoc Plugin for Mintlify - Generates MDX documentation compatible with Mintlify
 *
 * @module core
 */
import { DeclarationOption, Options, OptionsReader, Application } from "typedoc";
import {
	MarkdownApplication,
	MarkdownPageEvent,
	MarkdownRendererEvent,
} from "typedoc-plugin-markdown";
import * as options from "./options/declarations.js";
import { presets } from "./options/presets.js";
import { transformToMintlify } from "./transformers/mintlify-transformer.js";
import { DocsJsonUpdater } from "./integrations/docs-json-updater.js";

export function load(app: Application) {
	// Add Mintlify-specific options
	Object.entries(options).forEach(([name, option]) => {
		app.options.addDeclaration({
			name,
			...option,
		} as DeclarationOption);
	});

	// Add options reader with Mintlify presets
	app.options.addReader(
		new (class implements OptionsReader {
			name = "mintlify-options";
			readonly order = 0;
			readonly supportsPackages = false;
			read(container: Options) {
				Object.entries(presets).forEach(([key, value]) => {
					container.setValue(key, value);
				});
			}
		})(),
	);

	// Transform markdown content to Mintlify-compatible MDX after it's rendered
	const markdownApp = app as MarkdownApplication;
	markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
		if (!page.contents) return;

		// Transform content to Mintlify components and add frontmatter
		page.contents = transformToMintlify(page as any);

		// Change file extension to .mdx
		if (page.url.endsWith(".md")) {
			page.url = page.url.replace(".md", ".mdx");
			page.filename = page.filename.replace(".md", ".mdx");
		}
	});

	// Update docs.json after all documentation is generated
	markdownApp.renderer.on(MarkdownRendererEvent.END, (event) => {
		const docsJsonPath = app.options.getValue("mintlifyDocsJsonPath") as string;
		const tabName = app.options.getValue("mintlifyTabName") as string;
		const navigationStrategy = app.options.getValue("mintlifyNavigation") as string[];
		const sidebarIcons = app.options.getValue("mintlifySidebarIcons") as
			| Array<"folder" | "file" | "kind">
			| "all"
			| "none";

		if (docsJsonPath) {
			try {
				const outputDirectory = event.outputDirectory;
				const projectName = (app.options.getValue("name") as string) || "API";

				const updater = new DocsJsonUpdater({
					docsJsonPath,
					tabName,
					outputDirectory,
					projectName,
					navigationStrategy,
					sidebarIcons,
				});

				updater.updateNavigation(markdownApp, event);
			} catch (error) {
				console.warn("Failed to update docs.json:", error);
			}
		}
	});
}
