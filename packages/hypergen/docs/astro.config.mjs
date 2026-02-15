// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import markdoc from "@astrojs/markdoc";

// https://astro.build/config
export default defineConfig({
	site: "https://svallory.github.io",
	base: "/hypergen",
	integrations: [
		markdoc(),
		starlight({
			title: "Hypergen",
			description:
				"Advanced template composition and workflow orchestration for modern development.",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/svallory/hypergen",
				},
			],
			sidebar: [
				{
					label: "Quick Start",
					items: [
						{ label: "Overview", slug: "" },
						{ label: "Getting Started", slug: "getting-started" },
					],
				},
				{
					label: "Core Concepts",
					items: [{ label: "Taxonomy & Mental Model", slug: "concepts/taxonomy" }],
				},
				{
					label: "Using Cookbooks",
					items: [
						{ label: "Finding Cookbooks", slug: "tutorials/finding-cookbooks" },
						{ label: "Running Recipes", slug: "tutorials/running-recipes" },
					],
				},
				{
					label: "Creating Content",
					items: [
						{
							label: "Creating Templates",
							slug: "tutorials/creating-templates",
						},
						{ label: "Advanced Composition", slug: "advanced-composition" },
						{
							label: "Automatic Template Processing",
							slug: "guides/automatic-template-processing",
						},
					],
				},
				{
					label: "AI Integration",
					items: [
						{ label: "Overview", slug: "guides/ai-integration/overview" },
						{
							label: "Jig Tags Reference",
							slug: "guides/ai-integration/jig-tags",
						},
						{
							label: "Prompt Document",
							slug: "guides/ai-integration/prompt-assembly",
						},
						{
							label: "Complete Example",
							slug: "guides/ai-integration/example",
						},
					],
				},
				{
					label: "Reference",
					items: [
						{ label: "Complete Feature List", slug: "features" },
						{
							label: "CLI Commands",
							link: "/hypergen/features#cli-commands-reference",
						},
						{
							label: "Template Syntax",
							link: "/hypergen/advanced-composition#liquidjs-templates",
						},
					],
				},
				{
					label: "API Reference",
					autogenerate: { directory: "api" },
				},
				{
					label: "Development",
					items: [{ label: "Roadmap", slug: "roadmap" }],
				},
			],
		}),
	],
});
