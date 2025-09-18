package monitoring

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/logging"
)

// MetricType represents the type of metric
type MetricType string

const (
	CounterMetric   MetricType = "counter"
	GaugeMetric     MetricType = "gauge"
	HistogramMetric MetricType = "histogram"
	TimerMetric     MetricType = "timer"
)

// Metric represents a single metric
type Metric struct {
	Name      string                 `json:"name"`
	Type      MetricType            `json:"type"`
	Value     float64               `json:"value"`
	Labels    map[string]string     `json:"labels,omitempty"`
	Timestamp time.Time             `json:"timestamp"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// HealthStatus represents the health status of a component
type HealthStatus string

const (
	HealthStatusHealthy   HealthStatus = "healthy"
	HealthStatusDegraded  HealthStatus = "degraded"
	HealthStatusUnhealthy HealthStatus = "unhealthy"
	HealthStatusUnknown   HealthStatus = "unknown"
)

// HealthCheck represents a health check result
type HealthCheck struct {
	Name        string                 `json:"name"`
	Status      HealthStatus          `json:"status"`
	Message     string                `json:"message"`
	Duration    time.Duration         `json:"duration"`
	Timestamp   time.Time             `json:"timestamp"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Error       string                `json:"error,omitempty"`
}

// SystemMetrics represents system-level metrics
type SystemMetrics struct {
	Memory    MemoryMetrics  `json:"memory"`
	Runtime   RuntimeMetrics `json:"runtime"`
	System    OSMetrics      `json:"system"`
	Timestamp time.Time      `json:"timestamp"`
}

// MemoryMetrics represents memory usage metrics
type MemoryMetrics struct {
	Alloc        uint64 `json:"alloc"`
	TotalAlloc   uint64 `json:"total_alloc"`
	Sys          uint64 `json:"sys"`
	Lookups      uint64 `json:"lookups"`
	Mallocs      uint64 `json:"mallocs"`
	Frees        uint64 `json:"frees"`
	HeapAlloc    uint64 `json:"heap_alloc"`
	HeapSys      uint64 `json:"heap_sys"`
	HeapIdle     uint64 `json:"heap_idle"`
	HeapInuse    uint64 `json:"heap_inuse"`
	HeapReleased uint64 `json:"heap_released"`
	HeapObjects  uint64 `json:"heap_objects"`
}

// RuntimeMetrics represents Go runtime metrics
type RuntimeMetrics struct {
	Goroutines   int           `json:"goroutines"`
	CGOCalls     int64         `json:"cgo_calls"`
	GCCount      uint32        `json:"gc_count"`
	GCTotalPause time.Duration `json:"gc_total_pause"`
	NextGC       uint64        `json:"next_gc"`
}

// OSMetrics represents operating system metrics
type OSMetrics struct {
	PID       int    `json:"pid"`
	PPID      int    `json:"ppid"`
	StartTime time.Time `json:"start_time"`
	Uptime    time.Duration `json:"uptime"`
}

// ErrorTracker tracks application errors
type ErrorTracker struct {
	errors   []ErrorRecord `json:"errors"`
	maxSize  int
	mutex    sync.RWMutex
}

// ErrorRecord represents a recorded error
type ErrorRecord struct {
	Error     string                 `json:"error"`
	Context   string                 `json:"context"`
	Timestamp time.Time             `json:"timestamp"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Stack     string                `json:"stack,omitempty"`
}

// Monitor provides application monitoring capabilities
type Monitor struct {
	metrics      map[string]*Metric
	healthChecks map[string]func() HealthCheck
	errorTracker *ErrorTracker
	logger       *logging.Logger
	startTime    time.Time
	mutex        sync.RWMutex
	pid          int
}

// NewMonitor creates a new monitor instance
func NewMonitor() *Monitor {
	return &Monitor{
		metrics:      make(map[string]*Metric),
		healthChecks: make(map[string]func() HealthCheck),
		errorTracker: &ErrorTracker{
			errors:  make([]ErrorRecord, 0),
			maxSize: 1000, // Keep last 1000 errors
		},
		logger:    logging.GetDefaultLogger().WithFields(logging.Fields{"component": "monitor"}),
		startTime: time.Now(),
		pid:       os.Getpid(),
	}
}

// RecordMetric records a metric
func (m *Monitor) RecordMetric(name string, metricType MetricType, value float64, labels map[string]string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	metric := &Metric{
		Name:      name,
		Type:      metricType,
		Value:     value,
		Labels:    labels,
		Timestamp: time.Now(),
	}

	m.metrics[name] = metric
	
	m.logger.Debugf("Recorded metric: %s=%f type=%s", name, value, metricType)
}

// IncrementCounter increments a counter metric
func (m *Monitor) IncrementCounter(name string, labels map[string]string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if metric, exists := m.metrics[name]; exists && metric.Type == CounterMetric {
		metric.Value++
		metric.Timestamp = time.Now()
		metric.Labels = labels
	} else {
		m.metrics[name] = &Metric{
			Name:      name,
			Type:      CounterMetric,
			Value:     1,
			Labels:    labels,
			Timestamp: time.Now(),
		}
	}
}

// SetGauge sets a gauge metric
func (m *Monitor) SetGauge(name string, value float64, labels map[string]string) {
	m.RecordMetric(name, GaugeMetric, value, labels)
}

// RecordTimer records a timer metric
func (m *Monitor) RecordTimer(name string, duration time.Duration, labels map[string]string) {
	m.RecordMetric(name, TimerMetric, float64(duration.Milliseconds()), labels)
}

// RegisterHealthCheck registers a health check function
func (m *Monitor) RegisterHealthCheck(name string, check func() HealthCheck) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	
	m.healthChecks[name] = check
	m.logger.Infof("Registered health check: %s", name)
}

// RunHealthChecks executes all registered health checks
func (m *Monitor) RunHealthChecks() map[string]HealthCheck {
	m.mutex.RLock()
	checks := make(map[string]func() HealthCheck)
	for name, check := range m.healthChecks {
		checks[name] = check
	}
	m.mutex.RUnlock()

	results := make(map[string]HealthCheck)
	
	for name, check := range checks {
		start := time.Now()
		result := check()
		result.Duration = time.Since(start)
		result.Timestamp = time.Now()
		results[name] = result
		
		if result.Status != HealthStatusHealthy {
			m.logger.Warnf("Health check failed: %s status=%s message=%s", 
				name, result.Status, result.Message)
		}
	}
	
	return results
}

// RecordError records an application error
func (m *Monitor) RecordError(err error, context string, metadata map[string]interface{}) {
	m.errorTracker.mutex.Lock()
	defer m.errorTracker.mutex.Unlock()

	record := ErrorRecord{
		Error:     err.Error(),
		Context:   context,
		Timestamp: time.Now(),
		Metadata:  metadata,
	}

	// Add to the beginning of the slice
	m.errorTracker.errors = append([]ErrorRecord{record}, m.errorTracker.errors...)
	
	// Trim if exceeds max size
	if len(m.errorTracker.errors) > m.errorTracker.maxSize {
		m.errorTracker.errors = m.errorTracker.errors[:m.errorTracker.maxSize]
	}

	m.logger.WithError(err).WithFields(logging.Fields{
		"context": context,
		"metadata": metadata,
	}).Error("Application error recorded")

	// Increment error counter
	m.IncrementCounter("errors_total", map[string]string{
		"context": context,
	})
}

// GetErrors returns recent errors
func (m *Monitor) GetErrors(limit int) []ErrorRecord {
	m.errorTracker.mutex.RLock()
	defer m.errorTracker.mutex.RUnlock()

	if limit <= 0 || limit > len(m.errorTracker.errors) {
		limit = len(m.errorTracker.errors)
	}

	return m.errorTracker.errors[:limit]
}

// GetMetrics returns all current metrics
func (m *Monitor) GetMetrics() map[string]*Metric {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	metrics := make(map[string]*Metric)
	for name, metric := range m.metrics {
		// Create a copy to avoid concurrent access issues
		metrics[name] = &Metric{
			Name:      metric.Name,
			Type:      metric.Type,
			Value:     metric.Value,
			Labels:    metric.Labels,
			Timestamp: metric.Timestamp,
			Metadata:  metric.Metadata,
		}
	}
	
	return metrics
}

// GetSystemMetrics returns current system metrics
func (m *Monitor) GetSystemMetrics() SystemMetrics {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	return SystemMetrics{
		Memory: MemoryMetrics{
			Alloc:        memStats.Alloc,
			TotalAlloc:   memStats.TotalAlloc,
			Sys:          memStats.Sys,
			Lookups:      memStats.Lookups,
			Mallocs:      memStats.Mallocs,
			Frees:        memStats.Frees,
			HeapAlloc:    memStats.HeapAlloc,
			HeapSys:      memStats.HeapSys,
			HeapIdle:     memStats.HeapIdle,
			HeapInuse:    memStats.HeapInuse,
			HeapReleased: memStats.HeapReleased,
			HeapObjects:  memStats.HeapObjects,
		},
		Runtime: RuntimeMetrics{
			Goroutines:   runtime.NumGoroutine(),
			CGOCalls:     runtime.NumCgoCall(),
			GCCount:      memStats.NumGC,
			GCTotalPause: time.Duration(memStats.PauseTotalNs),
			NextGC:       memStats.NextGC,
		},
		System: OSMetrics{
			PID:       m.pid,
			PPID:      os.Getppid(),
			StartTime: m.startTime,
			Uptime:    time.Since(m.startTime),
		},
		Timestamp: time.Now(),
	}
}

// StartPeriodicCollection starts periodic metric collection
func (m *Monitor) StartPeriodicCollection(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	
	go func() {
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				m.logger.Info("Stopping periodic metric collection")
				return
			case <-ticker.C:
				m.collectSystemMetrics()
			}
		}
	}()
	
	m.logger.Infof("Started periodic metric collection with interval %s", interval)
}

// collectSystemMetrics collects and records system metrics
func (m *Monitor) collectSystemMetrics() {
	metrics := m.GetSystemMetrics()
	
	// Record memory metrics
	m.SetGauge("memory_alloc_bytes", float64(metrics.Memory.Alloc), nil)
	m.SetGauge("memory_heap_alloc_bytes", float64(metrics.Memory.HeapAlloc), nil)
	m.SetGauge("memory_heap_objects", float64(metrics.Memory.HeapObjects), nil)
	
	// Record runtime metrics
	m.SetGauge("runtime_goroutines", float64(metrics.Runtime.Goroutines), nil)
	m.SetGauge("runtime_gc_count", float64(metrics.Runtime.GCCount), nil)
	
	// Record uptime
	m.SetGauge("uptime_seconds", metrics.System.Uptime.Seconds(), nil)
}

// ExportMetrics exports metrics to JSON format
func (m *Monitor) ExportMetrics() ([]byte, error) {
	export := struct {
		Metrics       map[string]*Metric `json:"metrics"`
		SystemMetrics SystemMetrics      `json:"system_metrics"`
		HealthChecks  map[string]HealthCheck `json:"health_checks"`
		Errors        []ErrorRecord      `json:"recent_errors"`
		Timestamp     time.Time          `json:"timestamp"`
	}{
		Metrics:       m.GetMetrics(),
		SystemMetrics: m.GetSystemMetrics(),
		HealthChecks:  m.RunHealthChecks(),
		Errors:        m.GetErrors(10), // Last 10 errors
		Timestamp:     time.Now(),
	}
	
	return json.MarshalIndent(export, "", "  ")
}

// TimerWrapper provides a convenient way to time operations
type TimerWrapper struct {
	monitor *Monitor
	name    string
	labels  map[string]string
	start   time.Time
}

// NewTimer creates a new timer
func (m *Monitor) NewTimer(name string, labels map[string]string) *TimerWrapper {
	return &TimerWrapper{
		monitor: m,
		name:    name,
		labels:  labels,
		start:   time.Now(),
	}
}

// Stop stops the timer and records the duration
func (tw *TimerWrapper) Stop() {
	duration := time.Since(tw.start)
	tw.monitor.RecordTimer(tw.name, duration, tw.labels)
}

// Global monitor instance
var globalMonitor *Monitor
var monitorOnce sync.Once

// GetMonitor returns the global monitor instance
func GetMonitor() *Monitor {
	monitorOnce.Do(func() {
		globalMonitor = NewMonitor()
		
		// Register basic health checks
		globalMonitor.RegisterHealthCheck("memory", func() HealthCheck {
			metrics := globalMonitor.GetSystemMetrics()
			status := HealthStatusHealthy
			message := "Memory usage normal"
			
			// Check if memory usage is high (>80% of allocated heap)
			if metrics.Memory.HeapInuse > metrics.Memory.HeapSys*8/10 {
				status = HealthStatusDegraded
				message = "High memory usage detected"
			}
			
			return HealthCheck{
				Name:    "memory",
				Status:  status,
				Message: message,
				Metadata: map[string]interface{}{
					"heap_inuse": metrics.Memory.HeapInuse,
					"heap_sys":   metrics.Memory.HeapSys,
				},
			}
		})
		
		globalMonitor.RegisterHealthCheck("goroutines", func() HealthCheck {
			count := runtime.NumGoroutine()
			status := HealthStatusHealthy
			message := fmt.Sprintf("Goroutine count: %d", count)
			
			// Alert if too many goroutines (potential leak)
			if count > 1000 {
				status = HealthStatusDegraded
				message = fmt.Sprintf("High goroutine count: %d", count)
			}
			
			return HealthCheck{
				Name:    "goroutines",
				Status:  status,
				Message: message,
				Metadata: map[string]interface{}{
					"count": count,
				},
			}
		})
	})
	
	return globalMonitor
}

// Package-level convenience functions

// RecordMetric records a metric using the global monitor
func RecordMetric(name string, metricType MetricType, value float64, labels map[string]string) {
	GetMonitor().RecordMetric(name, metricType, value, labels)
}

// IncrementCounter increments a counter using the global monitor
func IncrementCounter(name string, labels map[string]string) {
	GetMonitor().IncrementCounter(name, labels)
}

// RecordError records an error using the global monitor
func RecordError(err error, context string, metadata map[string]interface{}) {
	GetMonitor().RecordError(err, context, metadata)
}

// NewTimer creates a new timer using the global monitor
func NewTimer(name string, labels map[string]string) *TimerWrapper {
	return GetMonitor().NewTimer(name, labels)
}