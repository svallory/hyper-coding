package performance

import (
	"context"
	"fmt"
	"runtime"
	"runtime/debug"
	"sync"
	"time"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/logging"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/monitoring"
)

// BenchmarkResult represents the result of a performance benchmark
type BenchmarkResult struct {
	Name            string                 `json:"name"`
	Duration        time.Duration          `json:"duration"`
	Iterations      int                    `json:"iterations"`
	AverageDuration time.Duration          `json:"average_duration"`
	MinDuration     time.Duration          `json:"min_duration"`
	MaxDuration     time.Duration          `json:"max_duration"`
	MemoryBefore    uint64                 `json:"memory_before"`
	MemoryAfter     uint64                 `json:"memory_after"`
	MemoryDelta     int64                  `json:"memory_delta"`
	Allocations     uint64                 `json:"allocations"`
	Success         bool                   `json:"success"`
	Error           string                 `json:"error,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	Timestamp       time.Time              `json:"timestamp"`
}

// Benchmark represents a performance benchmark
type Benchmark struct {
	name        string
	operation   func() error
	iterations  int
	warmupRuns  int
	timeout     time.Duration
	logger      *logging.Logger
	monitor     *monitoring.Monitor
}

// BenchmarkSuite manages a collection of benchmarks
type BenchmarkSuite struct {
	benchmarks map[string]*Benchmark
	results    []BenchmarkResult
	mutex      sync.RWMutex
	logger     *logging.Logger
}

// NewBenchmark creates a new benchmark
func NewBenchmark(name string, operation func() error) *Benchmark {
	return &Benchmark{
		name:       name,
		operation:  operation,
		iterations: 100,
		warmupRuns: 10,
		timeout:    30 * time.Second,
		logger:     logging.GetDefaultLogger().WithFields(logging.Fields{"component": "benchmark"}),
		monitor:    monitoring.GetMonitor(),
	}
}

// WithIterations sets the number of iterations for the benchmark
func (b *Benchmark) WithIterations(iterations int) *Benchmark {
	b.iterations = iterations
	return b
}

// WithWarmup sets the number of warmup runs
func (b *Benchmark) WithWarmup(warmupRuns int) *Benchmark {
	b.warmupRuns = warmupRuns
	return b
}

// WithTimeout sets the timeout for the benchmark
func (b *Benchmark) WithTimeout(timeout time.Duration) *Benchmark {
	b.timeout = timeout
	return b
}

// Run executes the benchmark and returns the result
func (b *Benchmark) Run() BenchmarkResult {
	result := BenchmarkResult{
		Name:      b.name,
		Timestamp: time.Now(),
		Success:   true,
	}

	b.logger.Infof("Starting benchmark: %s", b.name)
	timer := b.monitor.NewTimer("benchmark_total_duration", map[string]string{"name": b.name})
	defer timer.Stop()

	// Context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), b.timeout)
	defer cancel()

	// Force garbage collection before starting
	runtime.GC()
	debug.FreeOSMemory()

	// Get initial memory stats
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)
	result.MemoryBefore = memBefore.Alloc

	// Warmup runs
	if b.warmupRuns > 0 {
		b.logger.Debugf("Running %d warmup iterations", b.warmupRuns)
		for i := 0; i < b.warmupRuns; i++ {
			if ctx.Err() != nil {
				result.Success = false
				result.Error = "benchmark timeout during warmup"
				return result
			}
			if err := b.operation(); err != nil {
				b.logger.Warnf("Warmup iteration %d failed: %v", i, err)
			}
		}
	}

	// Actual benchmark runs
	durations := make([]time.Duration, 0, b.iterations)
	start := time.Now()
	
	for i := 0; i < b.iterations; i++ {
		select {
		case <-ctx.Done():
			result.Success = false
			result.Error = "benchmark timeout"
			result.Iterations = i
			return result
		default:
		}

		iterStart := time.Now()
		if err := b.operation(); err != nil {
			result.Success = false
			result.Error = fmt.Sprintf("iteration %d failed: %v", i, err)
			result.Iterations = i
			return result
		}
		iterDuration := time.Since(iterStart)
		durations = append(durations, iterDuration)
	}

	result.Duration = time.Since(start)
	result.Iterations = b.iterations

	// Calculate statistics
	if len(durations) > 0 {
		var total time.Duration
		result.MinDuration = durations[0]
		result.MaxDuration = durations[0]

		for _, d := range durations {
			total += d
			if d < result.MinDuration {
				result.MinDuration = d
			}
			if d > result.MaxDuration {
				result.MaxDuration = d
			}
		}

		result.AverageDuration = total / time.Duration(len(durations))
	}

	// Get final memory stats
	runtime.GC()
	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)
	result.MemoryAfter = memAfter.Alloc
	result.MemoryDelta = int64(memAfter.Alloc) - int64(memBefore.Alloc)
	result.Allocations = memAfter.Mallocs - memBefore.Mallocs

	b.logger.Infof("Benchmark completed: %s (%d iterations, avg: %v, memory delta: %d bytes)",
		b.name, result.Iterations, result.AverageDuration, result.MemoryDelta)

	// Record metrics
	b.monitor.RecordTimer("benchmark_average_duration", result.AverageDuration, 
		map[string]string{"name": b.name})
	b.monitor.SetGauge("benchmark_memory_delta", float64(result.MemoryDelta), 
		map[string]string{"name": b.name})
	b.monitor.IncrementCounter("benchmarks_completed", 
		map[string]string{"name": b.name, "success": fmt.Sprintf("%t", result.Success)})

	return result
}

// NewBenchmarkSuite creates a new benchmark suite
func NewBenchmarkSuite() *BenchmarkSuite {
	return &BenchmarkSuite{
		benchmarks: make(map[string]*Benchmark),
		results:    make([]BenchmarkResult, 0),
		logger:     logging.GetDefaultLogger().WithFields(logging.Fields{"component": "benchmark_suite"}),
	}
}

// AddBenchmark adds a benchmark to the suite
func (bs *BenchmarkSuite) AddBenchmark(benchmark *Benchmark) {
	bs.mutex.Lock()
	defer bs.mutex.Unlock()
	
	bs.benchmarks[benchmark.name] = benchmark
	bs.logger.Infof("Added benchmark to suite: %s", benchmark.name)
}

// RunAll runs all benchmarks in the suite
func (bs *BenchmarkSuite) RunAll() []BenchmarkResult {
	bs.mutex.Lock()
	benchmarks := make(map[string]*Benchmark)
	for name, benchmark := range bs.benchmarks {
		benchmarks[name] = benchmark
	}
	bs.mutex.Unlock()

	results := make([]BenchmarkResult, 0, len(benchmarks))
	
	bs.logger.Infof("Running benchmark suite with %d benchmarks", len(benchmarks))
	
	for name, benchmark := range benchmarks {
		bs.logger.Infof("Running benchmark: %s", name)
		result := benchmark.Run()
		results = append(results, result)
		
		if !result.Success {
			bs.logger.Errorf("Benchmark failed: %s - %s", name, result.Error)
		}
	}

	bs.mutex.Lock()
	bs.results = append(bs.results, results...)
	bs.mutex.Unlock()

	bs.logger.Infof("Benchmark suite completed: %d benchmarks", len(results))
	return results
}

// RunBenchmark runs a specific benchmark by name
func (bs *BenchmarkSuite) RunBenchmark(name string) (BenchmarkResult, error) {
	bs.mutex.RLock()
	benchmark, exists := bs.benchmarks[name]
	bs.mutex.RUnlock()

	if !exists {
		return BenchmarkResult{}, fmt.Errorf("benchmark not found: %s", name)
	}

	result := benchmark.Run()
	
	bs.mutex.Lock()
	bs.results = append(bs.results, result)
	bs.mutex.Unlock()

	return result, nil
}

// GetResults returns all benchmark results
func (bs *BenchmarkSuite) GetResults() []BenchmarkResult {
	bs.mutex.RLock()
	defer bs.mutex.RUnlock()
	
	// Return a copy to prevent concurrent access issues
	results := make([]BenchmarkResult, len(bs.results))
	copy(results, bs.results)
	return results
}

// GetResult returns a specific benchmark result by name
func (bs *BenchmarkSuite) GetResult(name string) (BenchmarkResult, bool) {
	bs.mutex.RLock()
	defer bs.mutex.RUnlock()
	
	// Find the most recent result for the given benchmark name
	for i := len(bs.results) - 1; i >= 0; i-- {
		if bs.results[i].Name == name {
			return bs.results[i], true
		}
	}
	
	return BenchmarkResult{}, false
}

// ClearResults clears all benchmark results
func (bs *BenchmarkSuite) ClearResults() {
	bs.mutex.Lock()
	defer bs.mutex.Unlock()
	
	bs.results = make([]BenchmarkResult, 0)
	bs.logger.Info("Cleared all benchmark results")
}

// GetSummary returns a summary of all benchmark results
func (bs *BenchmarkSuite) GetSummary() map[string]interface{} {
	bs.mutex.RLock()
	defer bs.mutex.RUnlock()

	if len(bs.results) == 0 {
		return map[string]interface{}{
			"total_benchmarks": 0,
			"successful":       0,
			"failed":           0,
		}
	}

	summary := map[string]interface{}{
		"total_benchmarks": len(bs.results),
		"successful":       0,
		"failed":           0,
		"total_duration":   time.Duration(0),
		"total_iterations": 0,
		"total_allocations": uint64(0),
	}

	var totalDuration time.Duration
	var totalIterations int
	var totalAllocations uint64
	successful := 0
	failed := 0

	for _, result := range bs.results {
		if result.Success {
			successful++
		} else {
			failed++
		}
		
		totalDuration += result.Duration
		totalIterations += result.Iterations
		totalAllocations += result.Allocations
	}

	summary["successful"] = successful
	summary["failed"] = failed
	summary["total_duration"] = totalDuration
	summary["total_iterations"] = totalIterations
	summary["total_allocations"] = totalAllocations

	if totalIterations > 0 {
		summary["average_iteration_duration"] = totalDuration / time.Duration(totalIterations)
	}

	return summary
}

// PerformanceOptimizer provides performance optimization utilities
type PerformanceOptimizer struct {
	logger  *logging.Logger
	monitor *monitoring.Monitor
}

// NewPerformanceOptimizer creates a new performance optimizer
func NewPerformanceOptimizer() *PerformanceOptimizer {
	return &PerformanceOptimizer{
		logger:  logging.GetDefaultLogger().WithFields(logging.Fields{"component": "performance_optimizer"}),
		monitor: monitoring.GetMonitor(),
	}
}

// OptimizeGC configures garbage collection for better performance
func (po *PerformanceOptimizer) OptimizeGC() {
	po.logger.Info("Optimizing garbage collection settings")
	
	// Set GC target percentage (default is 100)
	// Lower values mean more frequent GC but less memory usage
	debug.SetGCPercent(50)
	
	// Record current GC stats
	var stats debug.GCStats
	debug.ReadGCStats(&stats)
	
	po.monitor.SetGauge("gc_pause_total", float64(stats.PauseTotal), nil)
	po.monitor.SetGauge("gc_num_gc", float64(stats.NumGC), nil)
	
	po.logger.Infof("GC optimization applied: target=%d%%, total_pauses=%v, num_gc=%d", 
		50, stats.PauseTotal, stats.NumGC)
}

// TuneMemory applies memory optimization settings
func (po *PerformanceOptimizer) TuneMemory() {
	po.logger.Info("Applying memory optimizations")
	
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	
	// Record current memory stats
	po.monitor.SetGauge("memory_heap_alloc", float64(memStats.HeapAlloc), nil)
	po.monitor.SetGauge("memory_heap_sys", float64(memStats.HeapSys), nil)
	po.monitor.SetGauge("memory_heap_objects", float64(memStats.HeapObjects), nil)
	
	// Force garbage collection and memory return to OS
	runtime.GC()
	debug.FreeOSMemory()
	
	// Read stats again after optimization
	runtime.ReadMemStats(&memStats)
	
	po.monitor.SetGauge("memory_heap_alloc_optimized", float64(memStats.HeapAlloc), nil)
	
	po.logger.Infof("Memory optimization completed: heap_alloc=%d bytes, heap_objects=%d", 
		memStats.HeapAlloc, memStats.HeapObjects)
}

// SetGOMAXPROCS optimizes the number of OS threads
func (po *PerformanceOptimizer) SetGOMAXPROCS(maxProcs int) {
	po.logger.Infof("Setting GOMAXPROCS to %d", maxProcs)
	
	oldMaxProcs := runtime.GOMAXPROCS(maxProcs)
	
	po.monitor.SetGauge("gomaxprocs", float64(maxProcs), nil)
	
	po.logger.Infof("GOMAXPROCS changed from %d to %d", oldMaxProcs, maxProcs)
}

// Global benchmark suite for the application
var globalBenchmarkSuite *BenchmarkSuite
var benchmarkOnce sync.Once

// GetBenchmarkSuite returns the global benchmark suite
func GetBenchmarkSuite() *BenchmarkSuite {
	benchmarkOnce.Do(func() {
		globalBenchmarkSuite = NewBenchmarkSuite()
	})
	return globalBenchmarkSuite
}

// Package-level convenience functions

// RunBenchmark runs a benchmark with the given name and operation
func RunBenchmark(name string, operation func() error) BenchmarkResult {
	benchmark := NewBenchmark(name, operation)
	return benchmark.Run()
}

// AddBenchmark adds a benchmark to the global suite
func AddBenchmark(name string, operation func() error) {
	benchmark := NewBenchmark(name, operation)
	GetBenchmarkSuite().AddBenchmark(benchmark)
}