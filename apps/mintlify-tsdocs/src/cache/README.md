# Cache Module

**Performance optimization through intelligent caching**

## Overview

The cache module provides LRU (Least Recently Used) caching for expensive operations during documentation generation. It significantly improves performance by memoizing results from type analysis and API resolution operations.

## Architecture

### Core Components

- **`CacheManager`** - Centralized coordinator for all caching operations
- **`TypeAnalysisCache`** - Caches type structure analysis results
- **`ApiResolutionCache`** - Caches API declaration reference resolutions

### Design Pattern

The module uses:
- **LRU eviction**: Oldest entries removed when cache is full
- **Statistics tracking**: Hit/miss rates for performance monitoring
- **Factory methods**: Predefined configurations for different environments

## Files

### `CacheManager.ts`
Central cache coordinator that manages all cache instances.

**Key Features:**
- Global singleton pattern via `getGlobalCacheManager()`
- Factory methods: `createDefault()`, `createDevelopment()`, `createProduction()`
- Unified statistics across all caches
- Configurable cache enable/disable

**API:**
```typescript
const cacheManager = CacheManager.createProduction({
  enableStats: true
});
cacheManager.typeAnalysis.get(typeString);
cacheManager.printStats();
```

### `TypeAnalysisCache.ts`
Caches results from parsing and analyzing TypeScript type structures.

**Cache Key:** Trimmed type string

**Use Case:** When analyzing complex object types like:
```typescript
{ config: { host: string; port: number } }
```

**Performance Impact:** High - type analysis involves parsing and structural analysis

### `ApiResolutionCache.ts`
Caches API declaration reference resolution results.

**Cache Key:** `JSON.stringify(declarationReference) | contextCanonicalReference`

**Use Case:** Resolving cross-reference links in documentation

**Performance Impact:** Medium - resolution involves tree traversal

## Configuration

### Default Sizes

| Environment | Type Analysis | API Resolution |
|-------------|---------------|----------------|
| Default     | 1000          | 500            |
| Development | 500           | 200            |
| Production  | 2000          | 1000           |

### Options

```typescript
interface CacheManagerOptions {
  enabled?: boolean;               // Global enable/disable
  typeAnalysis?: {
    maxSize?: number;
    enabled?: boolean;
  };
  apiResolution?: {
    maxSize?: number;
    enabled?: boolean;
  };
  enableStats?: boolean;           // Print statistics
}
```

## Usage for Contributors

### Adding Cache Support

To cache a new expensive operation:

1. **Create a cache key function:**
```typescript
private _createCacheKey(input: YourType): string {
  return `${input.id}|${input.context}`;
}
```

2. **Implement get/set pattern:**
```typescript
public cachedOperation(input: YourType): Result {
  const cached = this._cache.get(this._createCacheKey(input));
  if (cached) return cached;

  const result = this._expensiveOperation(input);
  this._cache.set(this._createCacheKey(input), result);
  return result;
}
```

3. **Use the helper methods:**
```typescript
// For API resolution
const resolver = apiResolutionCache.createCachedResolver(resolveFn);

// For type analysis
const cachedFn = TypeAnalysisCache.createCachedFunction(analyzeFn);
```

### Testing Cache Behavior

```typescript
import { CacheManager } from '../cache';

// Disable caching in tests
const cacheManager = new CacheManager({ enabled: false });

// Test cache hit rates
const cacheManager = new CacheManager({ enableStats: true });
// ... perform operations ...
const stats = cacheManager.getStats();
expect(stats.totalHitRate).toBeGreaterThan(0.5);
```

### Performance Debugging

Enable statistics in development:

```typescript
const cacheManager = CacheManager.createDevelopment({
  enableStats: true
});
```

Check output for low hit rates indicating poor cache effectiveness.

## Performance Characteristics

### Time Complexity
- **Get**: O(1) average (hash map lookup)
- **Set**: O(1) average (hash map insertion)
- **LRU eviction**: O(1) (map delete + set)

### Space Complexity
- **Memory**: O(maxSize * averageEntrySize)
- **Overhead**: Minimal - uses native Map

### Cache Key Performance

⚠️ **Potential Bottleneck**: `ApiResolutionCache` uses `JSON.stringify()` for cache keys, which can be slow for large declaration reference objects.

## Debugging

### Common Issues

**1. Low Hit Rates**
- Check if cache is enabled: `stats.enabled`
- Verify cache key consistency
- Ensure maxSize is adequate for workload

**2. Memory Issues**
- Reduce maxSize in configuration
- Clear caches periodically: `cacheManager.clearAll()`

**3. Stale Data**
- Caches don't auto-invalidate
- Clear caches when input data changes

### Debug Logging

Add logging to cache operations:

```typescript
public get(key: string): T | undefined {
  const result = this._cache.get(key);
  console.log(`[Cache] ${result ? 'HIT' : 'MISS'}: ${key}`);
  return result;
}
```

## Future Improvements

### Potential Enhancements

1. **TTL (Time-To-Live)**
   - Add expiration timestamps to cached entries
   - Automatic eviction of stale entries

2. **Better Cache Keys**
   - Replace `JSON.stringify()` with faster hashing
   - Use WeakMap for object-based caching

3. **Persistent Caching**
   - Disk-based caching across runs
   - Invalidation based on file timestamps

4. **Adaptive Sizing**
   - Dynamically adjust maxSize based on memory pressure
   - Per-entry size tracking

5. **Cache Warming**
   - Pre-populate cache with common queries
   - Background cache population

## Related Modules

- **`utils/ObjectTypeAnalyzer`** - Primary consumer of TypeAnalysisCache
- **`documenters/MarkdownDocumenter`** - Uses both caches via CacheManager
- **`performance/PerformanceMonitor`** - Monitors cache impact on performance

## References

- [LRU Cache Wikipedia](https://en.wikipedia.org/wiki/Cache_replacement_policies#Least_recently_used_(LRU))
- [MDN: Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
