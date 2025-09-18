package performance

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestNewBenchmark(t *testing.T) {
	operation := func() error { return nil }
	benchmark := NewBenchmark("test_benchmark", operation)
	
	if benchmark.name != "test_benchmark" {
		t.Errorf("Expected name 'test_benchmark', got %s", benchmark.name)
	}
	
	if benchmark.iterations != 100 {
		t.Errorf("Expected default iterations 100, got %d", benchmark.iterations)
	}
	
	if benchmark.warmupRuns != 10 {
		t.Errorf("Expected default warmup runs 10, got %d", benchmark.warmupRuns)
	}
}

func TestBenchmarkConfiguration(t *testing.T) {
	operation := func() error { return nil }
	benchmark := NewBenchmark("test", operation).
		WithIterations(50).
		WithWarmup(5).
		WithTimeout(10 * time.Second)
	
	if benchmark.iterations != 50 {
		t.Errorf("Expected iterations 50, got %d", benchmark.iterations)
	}
	
	if benchmark.warmupRuns != 5 {
		t.Errorf("Expected warmup runs 5, got %d", benchmark.warmupRuns)
	}
	
	if benchmark.timeout != 10*time.Second {
		t.Errorf("Expected timeout 10s, got %v", benchmark.timeout)
	}
}

func TestBenchmarkRun(t *testing.T) {
	callCount := 0
	operation := func() error {
		callCount++
		time.Sleep(1 * time.Millisecond) // Simulate some work
		return nil
	}
	
	benchmark := NewBenchmark("test_operation", operation).
		WithIterations(10).
		WithWarmup(2)
	
	result := benchmark.Run()
	
	if !result.Success {
		t.Errorf("Expected successful benchmark, got error: %s", result.Error)
	}
	
	if result.Name != "test_operation" {
		t.Errorf("Expected name 'test_operation', got %s", result.Name)
	}
	
	if result.Iterations != 10 {
		t.Errorf("Expected 10 iterations, got %d", result.Iterations)
	}
	
	// Should have called warmup + iterations
	expectedCalls := 2 + 10
	if callCount != expectedCalls {
		t.Errorf("Expected %d total calls, got %d", expectedCalls, callCount)
	}
	
	if result.Duration == 0 {
		t.Error("Duration should be greater than 0")
	}
	
	if result.AverageDuration == 0 {
		t.Error("Average duration should be greater than 0")
	}
	
	if result.MinDuration == 0 {
		t.Error("Min duration should be greater than 0")
	}
	
	if result.MaxDuration == 0 {
		t.Error("Max duration should be greater than 0")
	}
	
	if result.Timestamp.IsZero() {
		t.Error("Timestamp should be set")
	}
}

func TestBenchmarkFailure(t *testing.T) {
	operation := func() error {
		return errors.New("operation failed")
	}
	
	benchmark := NewBenchmark("failing_operation", operation).
		WithIterations(5)
	
	result := benchmark.Run()
	
	if result.Success {
		t.Error("Expected benchmark to fail")
	}
	
	if result.Error == "" {
		t.Error("Expected error message")
	}
	
	// Should fail on first iteration
	if result.Iterations != 0 {
		t.Errorf("Expected 0 completed iterations, got %d", result.Iterations)
	}
}

func TestBenchmarkTimeout(t *testing.T) {
	operation := func() error {
		time.Sleep(100 * time.Millisecond)
		return nil
	}
	
	benchmark := NewBenchmark("slow_operation", operation).
		WithIterations(100).
		WithTimeout(50 * time.Millisecond) // Very short timeout
	
	result := benchmark.Run()
	
	if result.Success {
		t.Error("Expected benchmark to timeout")
	}
	
	if result.Error != "benchmark timeout during warmup" && result.Error != "benchmark timeout" {
		t.Errorf("Expected timeout error, got: %s", result.Error)
	}
}

func TestNewBenchmarkSuite(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	if suite.benchmarks == nil {
		t.Error("Benchmarks map should be initialized")
	}
	
	if suite.results == nil {
		t.Error("Results slice should be initialized")
	}
}

func TestBenchmarkSuiteAddBenchmark(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	operation := func() error { return nil }
	benchmark := NewBenchmark("test_benchmark", operation)
	
	suite.AddBenchmark(benchmark)
	
	if len(suite.benchmarks) != 1 {
		t.Errorf("Expected 1 benchmark, got %d", len(suite.benchmarks))
	}
	
	if suite.benchmarks["test_benchmark"] != benchmark {
		t.Error("Benchmark not stored correctly")
	}
}

func TestBenchmarkSuiteRunAll(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	// Add multiple benchmarks
	operation1 := func() error { return nil }
	operation2 := func() error { return nil }
	
	benchmark1 := NewBenchmark("bench1", operation1).WithIterations(5)
	benchmark2 := NewBenchmark("bench2", operation2).WithIterations(5)
	
	suite.AddBenchmark(benchmark1)
	suite.AddBenchmark(benchmark2)
	
	results := suite.RunAll()
	
	if len(results) != 2 {
		t.Errorf("Expected 2 results, got %d", len(results))
	}
	
	// Check that both benchmarks ran successfully
	for _, result := range results {
		if !result.Success {
			t.Errorf("Benchmark %s failed: %s", result.Name, result.Error)
		}
		if result.Iterations != 5 {
			t.Errorf("Expected 5 iterations for %s, got %d", result.Name, result.Iterations)
		}
	}
	
	// Check that results are stored
	allResults := suite.GetResults()
	if len(allResults) != 2 {
		t.Errorf("Expected 2 stored results, got %d", len(allResults))
	}
}

func TestBenchmarkSuiteRunBenchmark(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	operation := func() error { return nil }
	benchmark := NewBenchmark("specific_bench", operation).WithIterations(3)
	
	suite.AddBenchmark(benchmark)
	
	result, err := suite.RunBenchmark("specific_bench")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	
	if !result.Success {
		t.Errorf("Benchmark failed: %s", result.Error)
	}
	
	if result.Iterations != 3 {
		t.Errorf("Expected 3 iterations, got %d", result.Iterations)
	}
	
	// Test running non-existent benchmark
	_, err = suite.RunBenchmark("nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent benchmark")
	}
}

func TestBenchmarkSuiteGetResult(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	operation := func() error { return nil }
	benchmark := NewBenchmark("test_bench", operation).WithIterations(1)
	
	suite.AddBenchmark(benchmark)
	suite.RunBenchmark("test_bench")
	
	result, found := suite.GetResult("test_bench")
	if !found {
		t.Error("Expected to find result")
	}
	
	if result.Name != "test_bench" {
		t.Errorf("Expected name 'test_bench', got %s", result.Name)
	}
	
	// Test getting non-existent result
	_, found = suite.GetResult("nonexistent")
	if found {
		t.Error("Should not find non-existent result")
	}
}

func TestBenchmarkSuiteClearResults(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	operation := func() error { return nil }
	benchmark := NewBenchmark("test_bench", operation)
	
	suite.AddBenchmark(benchmark)
	suite.RunBenchmark("test_bench")
	
	// Should have one result
	if len(suite.GetResults()) != 1 {
		t.Error("Expected 1 result before clearing")
	}
	
	suite.ClearResults()
	
	// Should have no results after clearing
	if len(suite.GetResults()) != 0 {
		t.Error("Expected 0 results after clearing")
	}
}

func TestBenchmarkSuiteGetSummary(t *testing.T) {
	suite := NewBenchmarkSuite()
	
	// Test empty suite
	summary := suite.GetSummary()
	if summary["total_benchmarks"] != 0 {
		t.Error("Expected 0 total benchmarks for empty suite")
	}
	
	// Add successful benchmark
	operation1 := func() error { return nil }
	benchmark1 := NewBenchmark("success_bench", operation1).WithIterations(2)
	suite.AddBenchmark(benchmark1)
	suite.RunBenchmark("success_bench")
	
	// Add failing benchmark
	operation2 := func() error { return errors.New("fail") }
	benchmark2 := NewBenchmark("fail_bench", operation2).WithIterations(2)
	suite.AddBenchmark(benchmark2)
	suite.RunBenchmark("fail_bench")
	
	summary = suite.GetSummary()
	
	if summary["total_benchmarks"] != 2 {
		t.Errorf("Expected 2 total benchmarks, got %v", summary["total_benchmarks"])
	}
	
	if summary["successful"] != 1 {
		t.Errorf("Expected 1 successful benchmark, got %v", summary["successful"])
	}
	
	if summary["failed"] != 1 {
		t.Errorf("Expected 1 failed benchmark, got %v", summary["failed"])
	}
	
	if summary["total_iterations"] != 2 { // Only successful benchmark iterations
		t.Errorf("Expected 2 total iterations, got %v", summary["total_iterations"])
	}
}

func TestNewPerformanceOptimizer(t *testing.T) {
	optimizer := NewPerformanceOptimizer()
	
	if optimizer.logger == nil {
		t.Error("Logger should be initialized")
	}
	
	if optimizer.monitor == nil {
		t.Error("Monitor should be initialized")
	}
}

func TestPerformanceOptimizerOptimizeGC(t *testing.T) {
	optimizer := NewPerformanceOptimizer()
	
	// Force a garbage collection to start fresh
	runtime.GC()
	
	optimizer.OptimizeGC()
	
	// Note: We can't easily test that SetGCPercent was called with specific value
	// since debug.SetGCPercent doesn't have a getter, but we can test that
	// the function runs without error
}

func TestPerformanceOptimizerTuneMemory(t *testing.T) {
	optimizer := NewPerformanceOptimizer()
	
	// Get initial memory stats
	var initialStats runtime.MemStats
	runtime.ReadMemStats(&initialStats)
	
	optimizer.TuneMemory()
	
	// Memory tuning should not crash
	// Specific effects are hard to test reliably
}

func TestPerformanceOptimizerSetGOMAXPROCS(t *testing.T) {
	optimizer := NewPerformanceOptimizer()
	
	originalMaxProcs := runtime.GOMAXPROCS(0) // Get current value
	defer runtime.GOMAXPROCS(originalMaxProcs) // Restore after test
	
	newMaxProcs := originalMaxProcs + 1
	optimizer.SetGOMAXPROCS(newMaxProcs)
	
	currentMaxProcs := runtime.GOMAXPROCS(0)
	if currentMaxProcs != newMaxProcs {
		t.Errorf("Expected GOMAXPROCS %d, got %d", newMaxProcs, currentMaxProcs)
	}
}

func TestGlobalBenchmarkSuite(t *testing.T) {
	// Reset global state for test
	globalBenchmarkSuite = nil
	benchmarkOnce = sync.Once{}
	
	suite1 := GetBenchmarkSuite()
	suite2 := GetBenchmarkSuite()
	
	if suite1 != suite2 {
		t.Error("Should return same global instance")
	}
}

func TestPackageLevelFunctions(t *testing.T) {
	// Reset global state for test
	globalBenchmarkSuite = nil
	benchmarkOnce = sync.Once{}
	
	// Test RunBenchmark
	operation := func() error { return nil }
	result := RunBenchmark("package_test", operation)
	
	if !result.Success {
		t.Errorf("Package-level benchmark failed: %s", result.Error)
	}
	
	// Test AddBenchmark
	AddBenchmark("added_benchmark", operation)
	
	suite := GetBenchmarkSuite()
	if len(suite.benchmarks) != 1 {
		t.Errorf("Expected 1 benchmark in global suite, got %d", len(suite.benchmarks))
	}
}

func TestBenchmarkMemoryTracking(t *testing.T) {
	// Test that benchmark tracks memory allocations
	operation := func() error {
		// Allocate some memory
		data := make([]byte, 1024)
		_ = data
		return nil
	}
	
	benchmark := NewBenchmark("memory_test", operation).
		WithIterations(5).
		WithWarmup(0) // No warmup to make memory tracking more predictable
	
	result := benchmark.Run()
	
	if !result.Success {
		t.Errorf("Benchmark failed: %s", result.Error)
	}
	
	// Memory tracking should be present
	if result.MemoryBefore == 0 && result.MemoryAfter == 0 {
		t.Error("Memory tracking should record non-zero values")
	}
	
	if result.Allocations == 0 {
		t.Error("Should record allocations > 0")
	}
}

// Benchmark tests for performance measurement
func BenchmarkNewBenchmark(b *testing.B) {
	operation := func() error { return nil }
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		_ = NewBenchmark("bench", operation)
	}
}

func BenchmarkBenchmarkRun(b *testing.B) {
	operation := func() error { return nil }
	benchmark := NewBenchmark("bench", operation).WithIterations(1).WithWarmup(0)
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		_ = benchmark.Run()
	}
}

func BenchmarkBenchmarkSuiteRunAll(b *testing.B) {
	suite := NewBenchmarkSuite()
	operation := func() error { return nil }
	
	// Add some benchmarks
	for i := 0; i < 5; i++ {
		name := fmt.Sprintf("bench_%d", i)
		benchmark := NewBenchmark(name, operation).WithIterations(1).WithWarmup(0)
		suite.AddBenchmark(benchmark)
	}
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		suite.ClearResults()
		_ = suite.RunAll()
	}
}