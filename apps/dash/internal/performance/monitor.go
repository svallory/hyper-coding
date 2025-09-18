// Package performance provides system performance monitoring and profiling
package performance

import (
	"context"
	"fmt"
	"net/http"
	_ "net/http/pprof" // Import pprof handlers
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/process"
)

// Metrics holds system performance metrics
type Metrics struct {
	// Memory metrics
	MemoryUsed      uint64    `json:"memory_used"`
	MemoryTotal     uint64    `json:"memory_total"`
	MemoryPercent   float32   `json:"memory_percent"`
	HeapAlloc       uint64    `json:"heap_alloc"`
	HeapSys         uint64    `json:"heap_sys"`
	HeapInuse       uint64    `json:"heap_inuse"`
	HeapReleased    uint64    `json:"heap_released"`
	
	// CPU metrics
	CPUPercent      float64   `json:"cpu_percent"`
	CPUCores        int       `json:"cpu_cores"`
	
	// Goroutine metrics
	NumGoroutines   int       `json:"goroutines"`
	
	// GC metrics
	NumGC           uint32    `json:"num_gc"`
	LastGC          time.Time `json:"last_gc"`
	PauseTotalNs    uint64    `json:"pause_total_ns"`
	PauseNs         uint64    `json:"pause_ns"` // Last pause
	GCCPUPercent    float64   `json:"gc_cpu_percent"`
	
	// Application metrics
	Uptime          time.Duration `json:"uptime"`
	RequestsTotal   uint64    `json:"requests_total"`
	RequestsPerSec  float64   `json:"requests_per_sec"`
	ErrorsTotal     uint64    `json:"errors_total"`
	
	// Cache metrics
	CacheHits       uint64    `json:"cache_hits"`
	CacheMisses     uint64    `json:"cache_misses"`
	CacheHitRatio   float64   `json:"cache_hit_ratio"`
	CacheSize       int       `json:"cache_size"`
	CacheEvictions  uint64    `json:"cache_evictions"`
	
	// File operations
	FileOpsTotal    uint64    `json:"file_ops_total"`
	FileOpsPerSec   float64   `json:"file_ops_per_sec"`
	
	// TaskMaster metrics
	TaskMasterCalls uint64    `json:"taskmaster_calls"`
	TaskMasterErrors uint64   `json:"taskmaster_errors"`
	TaskMasterLatency time.Duration `json:"taskmaster_latency"`
	
	// Timestamp
	Timestamp       time.Time `json:"timestamp"`
}

// Monitor tracks and reports system performance metrics
type Monitor struct {
	mu              sync.RWMutex
	startTime       time.Time
	
	// Counters
	requestsTotal   uint64
	errorsTotal     uint64
	fileOpsTotal    uint64
	cacheHits       uint64
	cacheMisses     uint64
	cacheEvictions  uint64
	tmCalls         uint64
	tmErrors        uint64
	
	// Rolling averages
	requestRate     *RateTracker
	fileOpsRate     *RateTracker
	tmLatency       *LatencyTracker
	
	// Current process
	process         *process.Process
	
	// Metrics history
	history         []Metrics
	maxHistory      int
	
	// Pprof server
	pprofServer     *http.Server
	pprofEnabled    bool
	
	// Update control
	stopUpdate      chan struct{}
	updateDone      chan struct{}
}

// RateTracker tracks operation rates
type RateTracker struct {
	mu          sync.Mutex
	window      []uint64
	windowSize  int
	currentIdx  int
	lastUpdate  time.Time
}

// LatencyTracker tracks operation latencies
type LatencyTracker struct {
	mu          sync.Mutex
	sum         time.Duration
	count       uint64
	max         time.Duration
	min         time.Duration
}

// MonitorOptions configures the monitor
type MonitorOptions struct {
	UpdateInterval  time.Duration
	MaxHistory      int
	EnablePprof     bool
	PprofPort       int
}

// DefaultMonitorOptions returns sensible defaults
func DefaultMonitorOptions() MonitorOptions {
	return MonitorOptions{
		UpdateInterval: 1 * time.Second,
		MaxHistory:     300, // 5 minutes at 1 second intervals
		EnablePprof:    true,
		PprofPort:      6060,
	}
}

// NewMonitor creates a new performance monitor
func NewMonitor(opts MonitorOptions) (*Monitor, error) {
	pid := os.Getpid()
	proc, err := process.NewProcess(int32(pid))
	if err != nil {
		// Try current process
		proc, err = process.NewProcess(int32(0))
		if err != nil {
			proc = nil // Continue without process metrics
		}
	}
	
	m := &Monitor{
		startTime:    time.Now(),
		requestRate:  NewRateTracker(10),
		fileOpsRate:  NewRateTracker(10),
		tmLatency:    NewLatencyTracker(),
		process:      proc,
		history:      make([]Metrics, 0, opts.MaxHistory),
		maxHistory:   opts.MaxHistory,
		pprofEnabled: opts.EnablePprof,
		stopUpdate:   make(chan struct{}),
		updateDone:   make(chan struct{}),
	}
	
	// Start pprof server if enabled
	if opts.EnablePprof {
		m.startPprofServer(opts.PprofPort)
	}
	
	// Start metrics collection
	go m.updateLoop(opts.UpdateInterval)
	
	return m, nil
}

// Collect gathers current metrics
func (m *Monitor) Collect() Metrics {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	metrics := Metrics{
		Timestamp:       time.Now(),
		Uptime:          time.Since(m.startTime),
		RequestsTotal:   atomic.LoadUint64(&m.requestsTotal),
		ErrorsTotal:     atomic.LoadUint64(&m.errorsTotal),
		FileOpsTotal:    atomic.LoadUint64(&m.fileOpsTotal),
		CacheHits:       atomic.LoadUint64(&m.cacheHits),
		CacheMisses:     atomic.LoadUint64(&m.cacheMisses),
		CacheEvictions:  atomic.LoadUint64(&m.cacheEvictions),
		TaskMasterCalls: atomic.LoadUint64(&m.tmCalls),
		TaskMasterErrors: atomic.LoadUint64(&m.tmErrors),
	}
	
	// Calculate rates
	metrics.RequestsPerSec = m.requestRate.Rate()
	metrics.FileOpsPerSec = m.fileOpsRate.Rate()
	metrics.TaskMasterLatency = m.tmLatency.Average()
	
	// Cache hit ratio
	totalCacheOps := metrics.CacheHits + metrics.CacheMisses
	if totalCacheOps > 0 {
		metrics.CacheHitRatio = float64(metrics.CacheHits) / float64(totalCacheOps)
	}
	
	// Memory metrics
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	metrics.HeapAlloc = memStats.HeapAlloc
	metrics.HeapSys = memStats.HeapSys
	metrics.HeapInuse = memStats.HeapInuse
	metrics.HeapReleased = memStats.HeapReleased
	metrics.NumGC = memStats.NumGC
	metrics.PauseTotalNs = memStats.PauseTotalNs
	if memStats.NumGC > 0 {
		metrics.PauseNs = memStats.PauseNs[(memStats.NumGC+255)%256]
		metrics.LastGC = time.Unix(0, int64(memStats.LastGC))
	}
	metrics.GCCPUPercent = memStats.GCCPUFraction * 100
	
	// System memory
	if vmem, err := mem.VirtualMemory(); err == nil {
		metrics.MemoryUsed = vmem.Used
		metrics.MemoryTotal = vmem.Total
		metrics.MemoryPercent = float32(vmem.UsedPercent)
	}
	
	// CPU metrics
	if cpuPercent, err := cpu.Percent(0, false); err == nil && len(cpuPercent) > 0 {
		metrics.CPUPercent = cpuPercent[0]
	}
	metrics.CPUCores = runtime.NumCPU()
	
	// Goroutines
	metrics.NumGoroutines = runtime.NumGoroutine()
	
	// Process-specific metrics if available
	if m.process != nil {
		if cpuP, err := m.process.CPUPercent(); err == nil {
			metrics.CPUPercent = cpuP
		}
		if memInfo, err := m.process.MemoryInfo(); err == nil {
			metrics.MemoryUsed = memInfo.RSS
		}
	}
	
	return metrics
}

// GetCurrent returns the most recent metrics
func (m *Monitor) GetCurrent() Metrics {
	return m.Collect()
}

// GetHistory returns historical metrics
func (m *Monitor) GetHistory(count int) []Metrics {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	if count <= 0 || count > len(m.history) {
		count = len(m.history)
	}
	
	start := len(m.history) - count
	if start < 0 {
		start = 0
	}
	
	result := make([]Metrics, count)
	copy(result, m.history[start:])
	return result
}

// RecordRequest records an application request
func (m *Monitor) RecordRequest() {
	atomic.AddUint64(&m.requestsTotal, 1)
	m.requestRate.Record(1)
}

// RecordError records an application error
func (m *Monitor) RecordError() {
	atomic.AddUint64(&m.errorsTotal, 1)
}

// RecordFileOp records a file operation
func (m *Monitor) RecordFileOp() {
	atomic.AddUint64(&m.fileOpsTotal, 1)
	m.fileOpsRate.Record(1)
}

// RecordCacheHit records a cache hit
func (m *Monitor) RecordCacheHit() {
	atomic.AddUint64(&m.cacheHits, 1)
}

// RecordCacheMiss records a cache miss
func (m *Monitor) RecordCacheMiss() {
	atomic.AddUint64(&m.cacheMisses, 1)
}

// RecordCacheEviction records a cache eviction
func (m *Monitor) RecordCacheEviction() {
	atomic.AddUint64(&m.cacheEvictions, 1)
}

// RecordTaskMasterCall records a TaskMaster API call
func (m *Monitor) RecordTaskMasterCall(duration time.Duration, err error) {
	atomic.AddUint64(&m.tmCalls, 1)
	if err != nil {
		atomic.AddUint64(&m.tmErrors, 1)
	}
	m.tmLatency.Record(duration)
}

// Close stops the monitor and cleans up
func (m *Monitor) Close() {
	close(m.stopUpdate)
	<-m.updateDone
	
	if m.pprofServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		m.pprofServer.Shutdown(ctx)
	}
}

// startPprofServer starts the pprof HTTP server
func (m *Monitor) startPprofServer(port int) {
	m.pprofServer = &http.Server{
		Addr:    fmt.Sprintf("localhost:%d", port),
		Handler: http.DefaultServeMux,
	}
	
	go func() {
		if err := m.pprofServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// Log error but don't fail
			fmt.Printf("Pprof server error: %v\n", err)
		}
	}()
}

// updateLoop continuously updates metrics
func (m *Monitor) updateLoop(interval time.Duration) {
	defer close(m.updateDone)
	
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			m.updateHistory()
		case <-m.stopUpdate:
			return
		}
	}
}

// updateHistory adds current metrics to history
func (m *Monitor) updateHistory() {
	metrics := m.Collect()
	
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.history = append(m.history, metrics)
	if len(m.history) > m.maxHistory {
		m.history = m.history[1:]
	}
}

// NewRateTracker creates a rate tracker
func NewRateTracker(windowSize int) *RateTracker {
	return &RateTracker{
		window:     make([]uint64, windowSize),
		windowSize: windowSize,
		lastUpdate: time.Now(),
	}
}

// Record adds a value to the rate tracker
func (rt *RateTracker) Record(value uint64) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	
	now := time.Now()
	elapsed := now.Sub(rt.lastUpdate).Seconds()
	if elapsed >= 1.0 {
		rt.currentIdx = (rt.currentIdx + 1) % rt.windowSize
		rt.window[rt.currentIdx] = value
		rt.lastUpdate = now
	} else {
		rt.window[rt.currentIdx] += value
	}
}

// Rate returns the average rate per second
func (rt *RateTracker) Rate() float64 {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	
	var sum uint64
	for _, v := range rt.window {
		sum += v
	}
	return float64(sum) / float64(rt.windowSize)
}

// NewLatencyTracker creates a latency tracker
func NewLatencyTracker() *LatencyTracker {
	return &LatencyTracker{
		min: time.Duration(1<<63 - 1),
	}
}

// Record adds a latency measurement
func (lt *LatencyTracker) Record(duration time.Duration) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	
	lt.sum += duration
	lt.count++
	
	if duration < lt.min {
		lt.min = duration
	}
	if duration > lt.max {
		lt.max = duration
	}
}

// Average returns the average latency
func (lt *LatencyTracker) Average() time.Duration {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	
	if lt.count == 0 {
		return 0
	}
	return lt.sum / time.Duration(lt.count)
}

// GetStats returns latency statistics
func (lt *LatencyTracker) GetStats() (avg, min, max time.Duration) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	
	if lt.count == 0 {
		return 0, 0, 0
	}
	
	avg = lt.sum / time.Duration(lt.count)
	min = lt.min
	max = lt.max
	return
}