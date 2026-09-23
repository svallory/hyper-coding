/**
 * Parser exports
 *
 * Kit, Cookbook, Template, and Path parsing utilities
 */

// Cookbook Parser
export {
	discoverCookbooksInKit,
	discoverRecipesInCookbook,
	type ParsedCookbook,
	parseCookbookFile,
} from "./cookbook-parser.js";
// Kit Parser
export {
	deriveShortName,
	discoverKits,
	getDefaultKitSearchDirs,
	type ParsedKit,
	parseKitFile,
	resolveKitCookbooks,
} from "./kit-parser.js";
// Path Resolver
export { PathResolver, type ResolvedPath } from "./path-resolver.js";
// Template Parser
// Note: Template types (TemplateConfig, TemplateVariable, etc.) are exported from ../types
// We only export the parser class and ParsedTemplateConfig here to avoid duplication
export { type ParsedTemplateConfig, TemplateParser } from "./template-parser.js";
