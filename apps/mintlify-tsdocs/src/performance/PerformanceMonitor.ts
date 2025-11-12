/**
 * Performance monitoring utilities for measuring documentation generation performance
 */

export interface PerformanceMetrics {
  /**
   * Operation name
   */
  operation: string;

  /**
   * Duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp
   */
  timestamp: Date;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Simple performance monitor for measuring operation execution times
 */
export class PerformanceMonitor {
  private readonly _metrics: PerformanceMetrics[] = [];
  private readonly _enabled: boolean;

  constructor(enabled: boolean = true) {
    this._enabled = enabled;
  }

  /**
   * Measure the execution time of a function
   */
  public measure<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    if (!this._enabled) {
      return fn();
    }

    const startTime = performance.now();

    try {
      const result = fn();
      const endTime = performance.now();
      const duration = endTime - startTime;

      this._metrics.push({
        operation,
        duration,
        timestamp: new Date(),
        metadata
      });

      return result;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this._metrics.push({
        operation,
        duration,
        timestamp: new Date(),
        metadata: { ...metadata, error: error instanceof Error ? error.message : String(error) }
      });

      throw error;
    }
  }

  /**
   * Measure the execution time of an async function
   */
  public async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    if (!this._enabled) {
      return await fn();
    }

    const startTime = performance.now();

    try {
      const result = await fn();
      const endTime = performance.now();
      const duration = endTime - startTime;

      this._metrics.push({
        operation,
        duration,
        timestamp: new Date(),
        metadata
      });

      return result;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this._metrics.push({
        operation,
        duration,
        timestamp: new Date(),
        metadata: { ...metadata, error: error instanceof Error ? error.message : String(error) }
      });

      throw error;
    }
  }

  /**
   * Get all performance metrics
   */
  public getMetrics(): PerformanceMetrics[] {
    return [...this._metrics];
  }

  /**
   * Get metrics for a specific operation
   */
  public getMetricsForOperation(operation: string): PerformanceMetrics[] {
    return this._metrics.filter(metric => metric.operation === operation);
  }

  /**
   * Get summary statistics for an operation
   */
  public getOperationStats(operation: string): {
    count: number;
    totalDuration: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
  } {
    const metrics = this.getMetricsForOperation(operation);

    if (metrics.length === 0) {
      return {
        count: 0,
        totalDuration: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0
      };
    }

    const durations = metrics.map(m => m.duration);
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    return {
      count: metrics.length,
      totalDuration,
      averageDuration: totalDuration / metrics.length,
      minDuration,
      maxDuration
    };
  }

  /**
   * Print performance summary
   */
  public printSummary(): void {
    if (!this._enabled || this._metrics.length === 0) {
      return;
    }

    console.log('\n📊 Performance Summary:');

    // Group by operation
    const operations = new Set(this._metrics.map(m => m.operation));

    for (const operation of operations) {
      const stats = this.getOperationStats(operation);
      console.log(`   ${operation}:`);
      console.log(`     Count: ${stats.count}`);
      console.log(`     Total: ${stats.totalDuration.toFixed(2)}ms`);
      console.log(`     Average: ${stats.averageDuration.toFixed(2)}ms`);
      if (stats.count > 1) {
        console.log(`     Range: ${stats.minDuration.toFixed(2)}ms - ${stats.maxDuration.toFixed(2)}ms`);
      }
    }
  }

  /**
   * Clear all metrics
   */
  public clear(): void {
    this._metrics.length = 0;
  }

  /**
   * Check if performance monitoring is enabled
   */
  public isEnabled(): boolean {
    return this._enabled;
  }
}

/**
 * Global performance monitor instance
 */
let globalPerformanceMonitor: PerformanceMonitor | null = null;

/**
 * Get the global performance monitor instance
 */
export function getGlobalPerformanceMonitor(enabled: boolean = true): PerformanceMonitor {
  if (!globalPerformanceMonitor) {
    globalPerformanceMonitor = new PerformanceMonitor(enabled);
  }
  return globalPerformanceMonitor;
}

/**
 * Reset the global performance monitor
 */
export function resetGlobalPerformanceMonitor(): void {
  globalPerformanceMonitor = null;
}