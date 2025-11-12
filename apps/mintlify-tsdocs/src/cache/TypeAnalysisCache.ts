/**
 * Caching layer for type analysis operations to improve performance
 */

import { TypeAnalysis } from '../utils/ObjectTypeAnalyzer';

/**
 * Configuration options for type analysis cache
 */
export interface TypeAnalysisCacheOptions {
  /**
   * Maximum number of cached type analyses
   * @default 1000
   */
  maxSize?: number;

  /**
   * Whether to enable caching
   * @default true
   */
  enabled?: boolean;
}

/**
 * Simple LRU cache for type analysis results
 */
export class TypeAnalysisCache {
  private readonly _cache: Map<string, TypeAnalysis>;
  private readonly _maxSize: number;
  private readonly _enabled: boolean;
  private _hitCount: number = 0;
  private _missCount: number = 0;

  constructor(options: TypeAnalysisCacheOptions = {}) {
    this._maxSize = options.maxSize ?? 1000;
    this._enabled = options.enabled ?? true;
    this._cache = new Map<string, TypeAnalysis>();
  }

  /**
   * Get cached type analysis for a type string
   */
  public get(type: string): TypeAnalysis | undefined {
    if (!this._enabled) {
      return undefined;
    }

    const cacheKey = this._createCacheKey(type);
    const result = this._cache.get(cacheKey);

    if (result) {
      this._hitCount++;
      // Move to end for LRU behavior
      this._cache.delete(cacheKey);
      this._cache.set(cacheKey, result);
    } else {
      this._missCount++;
    }

    return result;
  }

  /**
   * Set type analysis in cache
   */
  public set(type: string, analysis: TypeAnalysis): void {
    if (!this._enabled) {
      return;
    }

    const cacheKey = this._createCacheKey(type);

    // If cache is full, remove oldest item (first in map)
    if (this._cache.size >= this._maxSize && !this._cache.has(cacheKey)) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey) {
        this._cache.delete(firstKey);
      }
    }

    this._cache.set(cacheKey, analysis);
  }

  /**
   * Clear all cached items
   */
  public clear(): void {
    this._cache.clear();
    this._hitCount = 0;
    this._missCount = 0;
  }

  /**
   * Get cache statistics
   */
  public getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    hitCount: number;
    missCount: number;
    enabled: boolean;
  } {
    const totalRequests = this._hitCount + this._missCount;
    const hitRate = totalRequests > 0 ? this._hitCount / totalRequests : 0;

    return {
      size: this._cache.size,
      maxSize: this._maxSize,
      hitRate,
      hitCount: this._hitCount,
      missCount: this._missCount,
      enabled: this._enabled
    };
  }

  /**
   * Create cache key from type string
   */
  private _createCacheKey(type: string): string {
    return type.trim();
  }

  /**
   * Create a simple cache that wraps a function
   */
  public static createCachedFunction<T extends (...args: any[]) => TypeAnalysis>(
    fn: T,
    options: TypeAnalysisCacheOptions = {}
  ): T {
    const cache = new TypeAnalysisCache(options);

    return ((...args: Parameters<T>): TypeAnalysis => {
      const typeString = args[0] as string;

      // Try to get from cache
      const cached = cache.get(typeString);
      if (cached) {
        return cached;
      }

      // Compute result and cache it
      const result = fn(...args);
      cache.set(typeString, result);
      return result;
    }) as T;
  }
}