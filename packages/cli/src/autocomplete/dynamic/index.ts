/**
 * Dynamic completion module
 *
 * Provides cache management and completion resolution for
 * kit/cookbook/recipe/variable tab completions.
 */

export { DynamicCacheManager } from "./cache.js";
export { CompletionResolver } from "./resolver.js";
export type { CompletionContext, DynamicCache, VariableCompletion } from "./types.js";
