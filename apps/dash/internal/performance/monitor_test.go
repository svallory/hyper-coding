package performance

import (
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonitorCreation(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false // Disable pprof for tests
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	require.NotNil(t, monitor)
	defer monitor.Close()
	
	// Check initial state
	assert.NotZero(t, monitor.startTime)
	assert.NotNil(t, monitor.requestRate)
	assert.NotNil(t, monitor.fileOpsRate)
	assert.NotNil(t, monitor.tmLatency)
}

func TestMetricsCollection(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	opts.UpdateInterval = 100 * time.Millisecond
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Record some operations
	monitor.RecordRequest()
	monitor.RecordRequest()
	monitor.RecordError()
	monitor.RecordFileOp()
	monitor.RecordCacheHit()
	monitor.RecordCacheMiss()
	monitor.RecordTaskMasterCall(50*time.Millisecond, nil)
	
	// Collect metrics
	metrics := monitor.GetCurrent()
	
	// Verify counters
	assert.EqualValues(t, 2, metrics.RequestsTotal)
	assert.EqualValues(t, 1, metrics.ErrorsTotal)
	assert.EqualValues(t, 1, metrics.FileOpsTotal)
	assert.EqualValues(t, 1, metrics.CacheHits)
	assert.EqualValues(t, 1, metrics.CacheMisses)
	assert.EqualValues(t, 1, metrics.TaskMasterCalls)
	
	// Verify system metrics
	assert.NotZero(t, metrics.HeapAlloc)
	assert.NotZero(t, metrics.NumGoroutines)
	assert.NotZero(t, metrics.CPUCores)
	assert.False(t, metrics.Timestamp.IsZero())
}

func TestRateTracking(t *testing.T) {
	rt := NewRateTracker(5)
	
	// Record some values
	rt.Record(10)
	time.Sleep(1100 * time.Millisecond) // Wait for next window
	rt.Record(20)
	time.Sleep(1100 * time.Millisecond)
	rt.Record(30)
	
	// Check rate calculation
	rate := rt.Rate()
	assert.Greater(t, rate, float64(0))
}

func TestLatencyTracking(t *testing.T) {
	lt := NewLatencyTracker()
	
	// Record latencies
	lt.Record(10 * time.Millisecond)
	lt.Record(20 * time.Millisecond)
	lt.Record(30 * time.Millisecond)
	
	// Check statistics
	avg, min, max := lt.GetStats()
	assert.Equal(t, 20*time.Millisecond, avg)
	assert.Equal(t, 10*time.Millisecond, min)
	assert.Equal(t, 30*time.Millisecond, max)
}

func TestConcurrentMetricsCollection(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Concurrent operations
	var wg sync.WaitGroup
	numGoroutines := 10
	opsPerGoroutine := 100
	
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			
			for j := 0; j < opsPerGoroutine; j++ {
				monitor.RecordRequest()
				monitor.RecordFileOp()
				if j%3 == 0 {
					monitor.RecordError()
				}
				if j%2 == 0 {
					monitor.RecordCacheHit()
				} else {
					monitor.RecordCacheMiss()
				}
			}
		}()
	}
	
	wg.Wait()
	
	// Verify totals
	metrics := monitor.GetCurrent()
	assert.EqualValues(t, numGoroutines*opsPerGoroutine, metrics.RequestsTotal)
	assert.EqualValues(t, numGoroutines*opsPerGoroutine, metrics.FileOpsTotal)
	assert.Greater(t, metrics.ErrorsTotal, uint64(0))
	assert.Equal(t, numGoroutines*opsPerGoroutine, int(metrics.CacheHits+metrics.CacheMisses))
}

func TestHistoryTracking(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	opts.UpdateInterval = 50 * time.Millisecond
	opts.MaxHistory = 5
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Wait for some history to accumulate
	time.Sleep(300 * time.Millisecond)
	
	// Get history
	history := monitor.GetHistory(10)
	assert.LessOrEqual(t, len(history), opts.MaxHistory)
	assert.Greater(t, len(history), 0)
	
	// Verify history is ordered
	for i := 1; i < len(history); i++ {
		assert.True(t, history[i].Timestamp.After(history[i-1].Timestamp) || 
			history[i].Timestamp.Equal(history[i-1].Timestamp))
	}
}

func TestMemoryMetrics(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Allocate some memory
	data := make([]byte, 10*1024*1024) // 10MB
	_ = data
	
	// Trigger GC
	runtime.GC()
	runtime.Gosched()
	
	// Collect metrics
	metrics := monitor.GetCurrent()
	
	// Verify memory metrics
	assert.NotZero(t, metrics.HeapAlloc)
	assert.NotZero(t, metrics.HeapSys)
	assert.NotZero(t, metrics.NumGC)
	assert.NotZero(t, metrics.GCCPUPercent)
}

func TestCacheHitRatio(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Record cache operations
	monitor.RecordCacheHit()
	monitor.RecordCacheHit()
	monitor.RecordCacheHit()
	monitor.RecordCacheMiss()
	
	// Check cache hit ratio
	metrics := monitor.GetCurrent()
	assert.Equal(t, 0.75, metrics.CacheHitRatio)
}

func TestTaskMasterMetrics(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	defer monitor.Close()
	
	// Record TaskMaster calls
	monitor.RecordTaskMasterCall(100*time.Millisecond, nil)
	monitor.RecordTaskMasterCall(200*time.Millisecond, nil)
	monitor.RecordTaskMasterCall(150*time.Millisecond, assert.AnError)
	
	// Check metrics
	metrics := monitor.GetCurrent()
	assert.EqualValues(t, 3, metrics.TaskMasterCalls)
	assert.EqualValues(t, 1, metrics.TaskMasterErrors)
	assert.Equal(t, 150*time.Millisecond, metrics.TaskMasterLatency)
}

func TestCleanShutdown(t *testing.T) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	opts.UpdateInterval = 50 * time.Millisecond
	
	monitor, err := NewMonitor(opts)
	require.NoError(t, err)
	
	// Record some operations
	for i := 0; i < 10; i++ {
		monitor.RecordRequest()
		time.Sleep(10 * time.Millisecond)
	}
	
	// Close and verify clean shutdown
	monitor.Close()
	
	// Try to collect metrics after close (should not panic)
	metrics := monitor.GetCurrent()
	assert.NotNil(t, metrics)
}

func BenchmarkMetricsCollection(b *testing.B) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, _ := NewMonitor(opts)
	defer monitor.Close()
	
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			monitor.Collect()
		}
	})
}

func BenchmarkConcurrentRecording(b *testing.B) {
	opts := DefaultMonitorOptions()
	opts.EnablePprof = false
	
	monitor, _ := NewMonitor(opts)
	defer monitor.Close()
	
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			monitor.RecordRequest()
			monitor.RecordFileOp()
			monitor.RecordCacheHit()
		}
	})
}