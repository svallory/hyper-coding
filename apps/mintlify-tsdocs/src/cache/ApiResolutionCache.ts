/**
 * Caching layer for API model resolution operations
 */

import type { ApiItem, IResolveDeclarationReferenceResult } from '@microsoft/api-extractor-model';

/**
 * Configuration options for API resolution cache
 */
export interface ApiResolutionCacheOptions {
  /**
   * Maximum number of cached resolutions
   * @default 500
   */
  maxSize?: number;

  /**
   * Whether to enable caching
   * @default true
   */
  enabled?: boolean;
}

/**
 * Simple LRU cache for API resolution results
 */
export class ApiResolutionCache {
  private readonly _cache: Map<string, IResolveDeclarationReferenceResult>;
  private readonly _maxSize: number;
  private readonly _enabled: boolean;
  private _hitCount: number = 0;
  private _missCount: number = 0;

  constructor(options: ApiResolutionCacheOptions = {}) {
    this._maxSize = options.maxSize ?? 500;
    this._enabled = options.enabled ?? true;
    this._cache = new Map<string, IResolveDeclarationReferenceResult>();
  }

  /**
   * Get cached resolution result
   */
  public get(
    declarationReference: any,
    contextApiItem?: ApiItem
  ): IResolveDeclarationReferenceResult | undefined {
    if (!this._enabled) {
      return undefined;
    }

    const cacheKey = this._createCacheKey(declarationReference, contextApiItem);
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
   * Set resolution result in cache
   */
  public set(
    declarationReference: any,
    contextApiItem: ApiItem | undefined,
    result: IResolveDeclarationReferenceResult
  ): void {
    if (!this._enabled) {
      return;
    }

    const cacheKey = this._createCacheKey(declarationReference, contextApiItem);

    // If cache is full, remove oldest item (first in map)
    if (this._cache.size >= this._maxSize && !this._cache.has(cacheKey)) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey) {
        this._cache.delete(firstKey);
      }
    }

    this._cache.set(cacheKey, result);
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
   * Create cache key from declaration reference and context
   */
  private _createCacheKey(
    declarationReference: any,
    contextApiItem?: ApiItem
  ): string {
    // Use JSON.stringify for the declaration reference since it may not have a consistent toString method
    const refString = JSON.stringify(declarationReference);
    const contextString = contextApiItem?.canonicalReference?.toString() || '';
    return `${refString}|${contextString}`;
  }

  /**
   * Create a cached wrapper for API model resolution
   */
  public createCachedResolver(
    resolveFn: (
      declarationReference: any,
      contextApiItem?: ApiItem
    ) => IResolveDeclarationReferenceResult
  ): (
    declarationReference: any,
    contextApiItem?: ApiItem
  ) => IResolveDeclarationReferenceResult {
    return (
      declarationReference: any,
      contextApiItem?: ApiItem
    ): IResolveDeclarationReferenceResult => {
      // Try to get from cache
      const cached = this.get(declarationReference, contextApiItem);
      if (cached) {
        return cached;
      }

      // Compute result and cache it
      const result = resolveFn(declarationReference, contextApiItem);
      this.set(declarationReference, contextApiItem, result);
      return result;
    };
  }
}