/**
 * Caching exports for performance optimization
 */

export { CacheManager, getGlobalCacheManager, resetGlobalCacheManager } from './CacheManager';
export type { CacheManagerOptions } from './CacheManager';

export { TypeAnalysisCache } from './TypeAnalysisCache';
export type { TypeAnalysisCacheOptions } from './TypeAnalysisCache';

export { ApiResolutionCache } from './ApiResolutionCache';
export type { ApiResolutionCacheOptions } from './ApiResolutionCache';