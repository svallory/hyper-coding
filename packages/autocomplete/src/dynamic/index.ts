/**
 * Dynamic completion module
 *
 * Provides cache management and completion resolution for
 * kit/cookbook/recipe/variable tab completions.
 */

export type { DynamicCache, VariableCompletion, CompletionContext } from "./types.js";
export { DynamicCacheManager } from "./cache.js";
export { CompletionResolver } from "./resolver.js";
