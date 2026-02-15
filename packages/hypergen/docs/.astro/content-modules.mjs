export default new Map([
	[
		"src/content/docs/index.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Findex.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/roadmap.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Froadmap.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/features.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Ffeatures.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/advanced-composition.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fadvanced-composition.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/getting-started.mdx",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fgetting-started.mdx&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/migrating-to-direct-recipes.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fmigrating-to-direct-recipes.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/automatic-template-processing.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fautomatic-template-processing.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/tutorials/creating-templates.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Ftutorials%2Fcreating-templates.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/tutorials/finding-cookbooks.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Ftutorials%2Ffinding-cookbooks.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/ai-integration/example.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fai-integration%2Fexample.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/tutorials/running-recipes.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Ftutorials%2Frunning-recipes.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/ai-integration/jig-tags.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fai-integration%2Fjig-tags.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/ai-integration/overview.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fai-integration%2Foverview.mdoc&astroContentModuleFlag=true"
			),
	],
	[
		"src/content/docs/guides/ai-integration/prompt-assembly.mdoc",
		() =>
			import(
				"astro:content-layer-deferred-module?astro%3Acontent-layer-deferred-module=&fileName=src%2Fcontent%2Fdocs%2Fguides%2Fai-integration%2Fprompt-assembly.mdoc&astroContentModuleFlag=true"
			),
	],
]);
