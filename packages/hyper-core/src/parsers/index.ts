/**
 * Parser exports
 *
 * Kit, Cookbook, Template, and Path parsing utilities
 */

// Kit Parser
export {
  parseKitFile,
  discoverKits,
  getDefaultKitSearchDirs,
  deriveShortName,
  resolveKitCookbooks,
  type ParsedKit,
} from '#//kit-parser.js'

// Cookbook Parser
export {
  parseCookbookFile,
  discoverCookbooksInKit,
  discoverRecipesInCookbook,
  type ParsedCookbook,
} from '#//cookbook-parser.js'

// Template Parser
// Note: Template types (TemplateConfig, TemplateVariable, etc.) are exported from ../types
// We only export the parser class here to avoid duplication
export { TemplateParser } from '#//template-parser.js'

// Path Resolver
export {
  PathResolver,
  type ResolvedPath,
} from '#//path-resolver.js'
