package performance

import (
	"context"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

// TestMemoryUsageValidation performs comprehensive memory usage validation
func TestMemoryUsageValidation(t *testing.T) {
	// Force garbage collection to start with clean state
	runtime.GC()
	debug.FreeOSMemory()
	
	var initialStats runtime.MemStats
	runtime.ReadMemStats(&initialStats)
	
	// Create a benchmark suite and run some operations
	suite := NewBenchmarkSuite()
	
	// Add memory-intensive benchmark
	suite.AddBenchmark(
		NewBenchmark("memory_allocation", func() error {
			// Allocate and immediately discard memory
			data := make([]byte, 10*1024) // 10KB
			_ = data
			return nil
		}).WithIterations(100).WithWarmup(10),
	)
	
	// Run benchmarks
	results := suite.RunAll()
	
	// Force garbage collection after benchmarks
	runtime.GC()
	debug.FreeOSMemory()
	
	var finalStats runtime.MemStats
	runtime.ReadMemStats(&finalStats)
	
	// Validate benchmark results
	if len(results) != 1 {
		t.Fatalf("Expected 1 benchmark result, got %d", len(results))
	}
	
	result := results[0]
	if !result.Success {
		t.Fatalf("Memory allocation benchmark failed: %s", result.Error)
	}
	
	// Check memory growth is reasonable
	memoryGrowth := finalStats.Alloc - initialStats.Alloc
	t.Logf("Memory growth: %d bytes", memoryGrowth)
	t.Logf("Initial heap: %d bytes", initialStats.Alloc)
	t.Logf("Final heap: %d bytes", finalStats.Alloc)
	t.Logf("Benchmark memory delta: %d bytes", result.MemoryDelta)
	
	// Memory growth should be minimal after GC
	if memoryGrowth > 100*1024 { // 100KB threshold
		t.Errorf("Excessive memory growth: %d bytes (threshold: 100KB)", memoryGrowth)
	}
	
	// Check that allocations were tracked
	if result.Allocations == 0 {
		t.Error("Expected allocations to be tracked")
	}
	
	// Validate GC stats
	if finalStats.NumGC <= initialStats.NumGC {
		t.Error("Expected garbage collection to occur")
	}
	
	t.Logf("GC runs: %d -> %d", initialStats.NumGC, finalStats.NumGC)
	t.Logf("Total allocations: %d", result.Allocations)
}

// TestMemoryLeakDetection tests for potential memory leaks
func TestMemoryLeakDetection(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping memory leak test in short mode")
	}
	
	// Create optimizer for memory management
	optimizer := NewPerformanceOptimizer()
	
	// Initial memory state
	runtime.GC()
	debug.FreeOSMemory()
	
	var baseline runtime.MemStats
	runtime.ReadMemStats(&baseline)
	
	// Simulate sustained operations
	iterations := 1000
	for i := 0; i < iterations; i++ {
		// Create and run benchmark
		benchmark := NewBenchmark("leak_test", func() error {
			// Allocate some memory
			data := make([]byte, 1024)
			_ = data
			return nil
		}).WithIterations(1).WithWarmup(0)
		
		result := benchmark.Run()
		if !result.Success {
			t.Fatalf("Benchmark iteration %d failed: %s", i, result.Error)
		}
		
		// Occasionally force GC
		if i%100 == 0 {
			optimizer.TuneMemory()
		}
	}
	
	// Final cleanup
	optimizer.TuneMemory()
	runtime.GC()
	debug.FreeOSMemory()
	
	var final runtime.MemStats
	runtime.ReadMemStats(&final)
	
	// Check for excessive memory growth
	memoryGrowth := final.Alloc - baseline.Alloc
	growthPercentage := float64(memoryGrowth) / float64(baseline.Alloc) * 100
	
	t.Logf("Memory growth after %d iterations: %d bytes (%.2f%%)", 
		iterations, memoryGrowth, growthPercentage)
	t.Logf("Baseline heap: %d bytes", baseline.Alloc)
	t.Logf("Final heap: %d bytes", final.Alloc)
	
	// Memory growth should be reasonable
	maxGrowthPercentage := 50.0 // 50% growth threshold
	if growthPercentage > maxGrowthPercentage {
		t.Errorf("Potential memory leak detected: %.2f%% growth (threshold: %.1f%%)", 
			growthPercentage, maxGrowthPercentage)
	}
}

// TestConcurrentMemoryUsage tests memory usage under concurrent load
func TestConcurrentMemoryUsage(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping concurrent memory test in short mode")
	}
	
	runtime.GC()
	debug.FreeOSMemory()
	
	var baseline runtime.MemStats
	runtime.ReadMemStats(&baseline)
	
	// Create context for controlling goroutines
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	// Start multiple concurrent benchmark operations
	numWorkers := 10
	done := make(chan bool, numWorkers)
	
	for i := 0; i < numWorkers; i++ {
		go func(workerID int) {
			defer func() { done <- true }()
			
			for {
				select {
				case <-ctx.Done():
					return
				default:
				}
				
				// Run benchmark
				benchmark := NewBenchmark("concurrent_test", func() error {
					data := make([]byte, 512)
					_ = data
					return nil
				}).WithIterations(10).WithWarmup(1)
				
				result := benchmark.Run()
				if !result.Success {
					t.Errorf("Worker %d benchmark failed: %s", workerID, result.Error)
					return
				}
				
				// Brief pause
				time.Sleep(10 * time.Millisecond)
			}
		}(i)
	}
	
	// Wait for all workers to complete
	for i := 0; i < numWorkers; i++ {
		<-done
	}
	
	// Cleanup
	runtime.GC()
	debug.FreeOSMemory()
	
	var final runtime.MemStats
	runtime.ReadMemStats(&final)
	
	// Check concurrent memory usage
	memoryGrowth := final.Alloc - baseline.Alloc
	t.Logf("Concurrent memory growth: %d bytes", memoryGrowth)
	t.Logf("Goroutines: %d", runtime.NumGoroutine())
	
	// Memory growth should be reasonable even under concurrent load
	if memoryGrowth > 1024*1024 { // 1MB threshold
		t.Errorf("Excessive concurrent memory growth: %d bytes", memoryGrowth)
	}
}

// TestGarbageCollectionEfficiency tests GC effectiveness
func TestGarbageCollectionEfficiency(t *testing.T) {
	runtime.GC()
	debug.FreeOSMemory()
	
	var beforeGC runtime.MemStats
	runtime.ReadMemStats(&beforeGC)
	
	// Allocate significant memory
	bigData := make([][]byte, 1000)
	for i := range bigData {
		bigData[i] = make([]byte, 10*1024) // 10KB each
	}
	
	var afterAlloc runtime.MemStats
	runtime.ReadMemStats(&afterAlloc)
	
	allocated := afterAlloc.Alloc - beforeGC.Alloc
	t.Logf("Allocated memory: %d bytes", allocated)
	
	// Clear references
	bigData = nil
	
	// Force garbage collection
	runtime.GC()
	debug.FreeOSMemory()
	
	var afterGC runtime.MemStats
	runtime.ReadMemStats(&afterGC)
	
	recovered := afterAlloc.Alloc - afterGC.Alloc
	recoveryPercentage := float64(recovered) / float64(allocated) * 100
	
	t.Logf("Memory recovered by GC: %d bytes (%.1f%%)", recovered, recoveryPercentage)
	t.Logf("GC efficiency: %.1f%%", recoveryPercentage)
	
	// GC should recover most of the allocated memory
	minRecoveryPercentage := 80.0
	if recoveryPercentage < minRecoveryPercentage {
		t.Errorf("Poor GC efficiency: %.1f%% recovered (expected >%.1f%%)", 
			recoveryPercentage, minRecoveryPercentage)
	}
}

// TestMemoryOptimizationEffectiveness tests the performance optimizer
func TestMemoryOptimizationEffectiveness(t *testing.T) {
	optimizer := NewPerformanceOptimizer()
	
	// Get initial memory state
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	
	// Allocate memory to fragment heap
	var data [][]byte
	for i := 0; i < 100; i++ {
		chunk := make([]byte, 1024*i)
		data = append(data, chunk)
	}
	
	var afterAlloc runtime.MemStats
	runtime.ReadMemStats(&afterAlloc)
	
	// Apply memory optimization
	optimizer.TuneMemory()
	
	var afterOptim runtime.MemStats
	runtime.ReadMemStats(&afterOptim)
	
	// Check optimization effectiveness
	heapReduction := afterAlloc.HeapInuse - afterOptim.HeapInuse
	t.Logf("Heap in use before optimization: %d bytes", afterAlloc.HeapInuse)
	t.Logf("Heap in use after optimization: %d bytes", afterOptim.HeapInuse)
	t.Logf("Heap reduction: %d bytes", heapReduction)
	
	// Memory optimization should reduce heap usage
	if heapReduction <= 0 {
		t.Error("Memory optimization should reduce heap usage")
	}
}

// TestSystemMemoryLimits validates that the application respects memory limits
func TestSystemMemoryLimits(t *testing.T) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	
	// Check that we're not using excessive memory
	maxExpectedMemory := uint64(100 * 1024 * 1024) // 100MB
	
	t.Logf("Current heap allocation: %d bytes (%.1f MB)", 
		stats.Alloc, float64(stats.Alloc)/(1024*1024))
	t.Logf("Total system memory obtained: %d bytes (%.1f MB)", 
		stats.Sys, float64(stats.Sys)/(1024*1024))
	
	if stats.Sys > maxExpectedMemory {
		t.Errorf("Application using excessive system memory: %d bytes (limit: %d bytes)", 
			stats.Sys, maxExpectedMemory)
	}
	
	// Check heap objects count
	maxObjects := uint64(100000) // 100k objects
	if stats.HeapObjects > maxObjects {
		t.Errorf("Too many heap objects: %d (limit: %d)", stats.HeapObjects, maxObjects)
	}
	
	t.Logf("Heap objects: %d", stats.HeapObjects)
	t.Logf("Stack in use: %d bytes", stats.StackInuse)
	t.Logf("GC CPU fraction: %.4f", stats.GCCPUFraction)
}

// BenchmarkMemoryEfficiency benchmarks memory efficiency
func BenchmarkMemoryEfficiency(b *testing.B) {
	// Test different allocation patterns
	patterns := []struct {
		name string
		fn   func()
	}{
		{
			name: "SmallAllocations",
			fn: func() {
				data := make([]byte, 64)
				_ = data
			},
		},
		{
			name: "MediumAllocations", 
			fn: func() {
				data := make([]byte, 4096)
				_ = data
			},
		},
		{
			name: "LargeAllocations",
			fn: func() {
				data := make([]byte, 65536)
				_ = data
			},
		},
	}
	
	for _, pattern := range patterns {
		b.Run(pattern.name, func(b *testing.B) {
			runtime.GC()
			
			var before runtime.MemStats
			runtime.ReadMemStats(&before)
			
			b.ResetTimer()
			
			for i := 0; i < b.N; i++ {
				pattern.fn()
			}
			
			b.StopTimer()
			
			var after runtime.MemStats
			runtime.ReadMemStats(&after)
			
			allocsPerOp := float64(after.Mallocs-before.Mallocs) / float64(b.N)
			bytesPerOp := float64(after.TotalAlloc-before.TotalAlloc) / float64(b.N)
			
			b.ReportMetric(allocsPerOp, "allocs/op")
			b.ReportMetric(bytesPerOp, "bytes/op")
		})
	}
}