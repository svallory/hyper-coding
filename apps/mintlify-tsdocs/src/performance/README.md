# Performance Module

**Performance monitoring and profiling for documentation generation**

## Overview

The performance module provides utilities for measuring operation execution times, collecting metrics, and analyzing performance characteristics of the documentation generation process. It's designed to be lightweight with minimal overhead when disabled.

## Architecture

Single-file module with:
- **PerformanceMonitor** - Core measurement class
- **Global Instance** - Singleton for application-wide monitoring
- **Metrics Collection** - Simple in-memory storage with statistics

## Files

### `PerformanceMonitor.ts`

Performance measurement utility with sync/async support.

**Key Features:**
- ✅ Measure synchronous and asynchronous operations
- ✅ Collect timing metrics with metadata
- ✅ Calculate statistics (count, total, avg, min, max)
- ✅ Enable/disable monitoring with zero overhead when disabled
- ✅ Print formatted performance summaries
- ✅ Capture errors with timing information

**Usage Example:**

```typescript
import { PerformanceMonitor } from '../performance/PerformanceMonitor';

const monitor = new PerformanceMonitor(true);

// Measure synchronous operation
const result = monitor.measure(
  'generateMarkdown',
  () => {
    return generateMarkdownForItem(apiItem);
  },
  { itemType: apiItem.kind }
);

// Measure asynchronous operation
const output = await monitor.measureAsync(
  'writeFile',
  async () => {
    return await FileSystem.writeFile(path, content);
  },
  { fileSize: content.length }
);

// Get statistics
const stats = monitor.getOperationStats('generateMarkdown');
console.log(`Average: ${stats.averageDuration}ms`);

// Print summary
monitor.printSummary();
// Output:
// 📊 Performance Summary:
//    generateMarkdown:
//      Count: 15
//      Total: 1234.56ms
//      Average: 82.30ms
//      Range: 45.12ms - 156.78ms
```

**API:**

| Method | Description |
|--------|-------------|
| `measure<T>(operation, fn, metadata?)` | Measure sync function |
| `measureAsync<T>(operation, fn, metadata?)` | Measure async function |
| `getMetrics()` | Get all metrics |
| `getMetricsForOperation(operation)` | Get metrics for specific operation |
| `getOperationStats(operation)` | Get summary statistics |
| `printSummary()` | Print formatted summary to console |
| `clear()` | Clear all metrics |
| `isEnabled()` | Check if monitoring is enabled |

**Global Instance:**

```typescript
import { getGlobalPerformanceMonitor, resetGlobalPerformanceMonitor } from '../performance/PerformanceMonitor';

// Get singleton (creates if needed)
const monitor = getGlobalPerformanceMonitor(true);

// Use it anywhere in the codebase
monitor.measure('operation', () => { ... });

// Reset (for testing)
resetGlobalPerformanceMonitor();
```

**Code Quality:** ⭐⭐⭐⭐ (see issues below)

## Usage for Contributors

### Basic Measurement

```typescript
const monitor = new PerformanceMonitor();

// Sync
const result = monitor.measure('parseTemplate', () => {
  return parseTemplateFile(path);
});

// Async
const result = await monitor.measureAsync('fetchData', async () => {
  return await fetchApiData();
});
```

### With Metadata

```typescript
monitor.measure(
  'processApiItem',
  () => processItem(apiItem),
  {
    itemKind: apiItem.kind,
    itemName: apiItem.displayName,
    complexity: calculateComplexity(apiItem)
  }
);
```

### Error Handling

```typescript
try {
  monitor.measure('riskyOperation', () => {
    throw new Error('Something went wrong');
  });
} catch (error) {
  // Error is recorded with timing information in metadata
  const metrics = monitor.getMetricsForOperation('riskyOperation');
  console.log(metrics[0].metadata?.error); // 'Something went wrong'
}
```

### Statistics Analysis

```typescript
// After running operations
const stats = monitor.getOperationStats('renderTemplate');

console.log(`Rendered ${stats.count} templates`);
console.log(`Total time: ${stats.totalDuration}ms`);
console.log(`Average: ${stats.averageDuration}ms`);
console.log(`Fastest: ${stats.minDuration}ms`);
console.log(`Slowest: ${stats.maxDuration}ms`);

// Find slow operations
const allOps = new Set(monitor.getMetrics().map(m => m.operation));
for (const op of allOps) {
  const stats = monitor.getOperationStats(op);
  if (stats.averageDuration > 100) {
    console.warn(`⚠️ Slow operation: ${op} (${stats.averageDuration}ms)`);
  }
}
```

### Disable for Production

```typescript
// Disable monitoring in production
const monitor = new PerformanceMonitor(
  process.env.NODE_ENV === 'development'
);

// Zero overhead when disabled
monitor.measure('operation', () => expensiveOperation());
```

### Testing with Performance Monitor

```typescript
describe('DocumentGenerator', () => {
  it('should generate docs within performance budget', () => {
    const monitor = new PerformanceMonitor(true);

    monitor.measure('generateDocs', () => {
      generator.generateAll();
    });

    const stats = monitor.getOperationStats('generateDocs');
    expect(stats.averageDuration).toBeLessThan(5000); // 5s budget
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **Unbounded Memory Growth** (PerformanceMonitor.ts:31)
   - **Issue**: Metrics array grows without limit
   - **Impact**: Memory leak in long-running processes
   - **Fix**: Add max size or time-based cleanup:
   ```typescript
   private readonly _maxMetrics: number;

   constructor(enabled: boolean = true, maxMetrics: number = 1000) {
     this._maxMetrics = maxMetrics;
   }

   private _addMetric(metric: PerformanceMetrics): void {
     this._metrics.push(metric);
     if (this._metrics.length > this._maxMetrics) {
       this._metrics.shift(); // Remove oldest
     }
   }
   ```

2. **No Percentile Calculations** (PerformanceMonitor.ts:139-170)
   - **Issue**: Only has average, min, max (no p50, p95, p99)
   - **Impact**: Can't identify outliers or tail latencies
   - **Enhancement**: Add percentile calculation:
   ```typescript
   public getPercentile(operation: string, percentile: number): number {
     const metrics = this.getMetricsForOperation(operation);
     const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
     const index = Math.ceil((percentile / 100) * durations.length) - 1;
     return durations[index] || 0;
   }
   ```

3. **Code Duplication** (PerformanceMonitor.ts:41-120)
   - **Issue**: measure() and measureAsync() have duplicated logic
   - **Impact**: Maintenance burden, potential bugs
   - **Fix**: Extract common logic:
   ```typescript
   private _recordMetric(
     operation: string,
     duration: number,
     metadata?: Record<string, unknown>
   ): void {
     this._metrics.push({
       operation,
       duration,
       timestamp: new Date(),
       metadata
     });
   }
   ```

4. **Global Singleton** (PerformanceMonitor.ts:215-225)
   - **Issue**: Global state makes testing difficult
   - **Impact**: Tests can interfere with each other
   - **Fix**: Use dependency injection instead

### 🟢 Minor

5. **No Metric Export** (PerformanceMonitor.ts)
   - **Issue**: Can't export to monitoring systems (Prometheus, DataDog)
   - **Enhancement**: Add export methods:
   ```typescript
   public exportPrometheus(): string {
     // Format metrics as Prometheus exposition format
   }

   public exportJSON(): string {
     return JSON.stringify(this._metrics, null, 2);
   }
   ```

6. **Console.log in Library Code** (PerformanceMonitor.ts:180-194)
   - **Issue**: printSummary() writes directly to console
   - **Impact**: Can't control output in library consumers
   - **Fix**: Accept logger parameter or return string:
   ```typescript
   public getSummary(): string {
     // Return formatted string instead of console.log
   }
   ```

7. **Metadata Not Validated** (PerformanceMonitor.ts:24)
   - **Issue**: Could contain large objects or circular references
   - **Impact**: Memory issues, JSON.stringify failures
   - **Fix**: Validate or serialize metadata:
   ```typescript
   private _sanitizeMetadata(metadata: any): Record<string, unknown> {
     try {
       JSON.stringify(metadata);
       return metadata;
     } catch {
       return { error: 'Metadata could not be serialized' };
     }
   }
   ```

8. **No Time-based Filtering** (PerformanceMonitor.ts:132-134)
   - **Issue**: Can't filter metrics by time range
   - **Enhancement**: Add time-based queries:
   ```typescript
   public getMetricsSince(date: Date): PerformanceMetrics[] {
     return this._metrics.filter(m => m.timestamp >= date);
   }
   ```

## Performance Characteristics

### Overhead

| Scenario | Overhead | Notes |
|----------|----------|-------|
| Disabled | ~0ns | Early return, zero overhead |
| Enabled (sync) | ~0.1-1ms | performance.now() + array push |
| Enabled (async) | ~0.1-1ms | Same as sync |
| printSummary() | O(n × m) | n = metrics, m = unique operations |

### Memory Usage

- **Per metric**: ~200 bytes (operation name + metadata)
- **1000 metrics**: ~200 KB
- **No limit**: Memory leak risk

### Best Practices

- ✅ Disable in production unless debugging
- ✅ Call clear() periodically for long-running processes
- ✅ Avoid measuring very hot loops (overhead adds up)
- ✅ Use metadata sparingly (small objects only)

## Related Modules

- **`cache/CacheManager`** - Has its own statistics tracking
- **`documenters/MarkdownDocumenter`** - Could use performance monitoring

## References

- [Node.js performance.now()](https://nodejs.org/api/perf_hooks.html#performancenow)
- [Web Performance Monitoring](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

---

## Quick Reference

```typescript
// Create monitor
const monitor = new PerformanceMonitor(true);

// Measure operations
monitor.measure('operation', () => doWork());
await monitor.measureAsync('asyncOp', async () => doAsyncWork());

// Get statistics
const stats = monitor.getOperationStats('operation');
console.log(`Avg: ${stats.averageDuration}ms`);

// Print summary
monitor.printSummary();

// Clear metrics
monitor.clear();
```
