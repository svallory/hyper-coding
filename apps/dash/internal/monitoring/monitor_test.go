package monitoring

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestNewMonitor(t *testing.T) {
	monitor := NewMonitor()
	
	if monitor == nil {
		t.Fatal("Monitor should not be nil")
	}
	
	if monitor.metrics == nil {
		t.Error("Metrics map should be initialized")
	}
	
	if monitor.healthChecks == nil {
		t.Error("Health checks map should be initialized")
	}
	
	if monitor.errorTracker == nil {
		t.Error("Error tracker should be initialized")
	}
	
	if monitor.pid == 0 {
		t.Error("PID should be set")
	}
}

func TestRecordMetric(t *testing.T) {
	monitor := NewMonitor()
	
	labels := map[string]string{"env": "test"}
	monitor.RecordMetric("test_metric", CounterMetric, 42.0, labels)
	
	metrics := monitor.GetMetrics()
	metric, exists := metrics["test_metric"]
	
	if !exists {
		t.Fatal("Metric should exist")
	}
	
	if metric.Name != "test_metric" {
		t.Errorf("Expected name 'test_metric', got %s", metric.Name)
	}
	
	if metric.Type != CounterMetric {
		t.Errorf("Expected type CounterMetric, got %s", metric.Type)
	}
	
	if metric.Value != 42.0 {
		t.Errorf("Expected value 42.0, got %f", metric.Value)
	}
	
	if metric.Labels["env"] != "test" {
		t.Errorf("Expected label env=test, got %s", metric.Labels["env"])
	}
}

func TestIncrementCounter(t *testing.T) {
	monitor := NewMonitor()
	
	labels := map[string]string{"type": "request"}
	
	// First increment
	monitor.IncrementCounter("requests", labels)
	
	metrics := monitor.GetMetrics()
	metric := metrics["requests"]
	
	if metric.Value != 1.0 {
		t.Errorf("Expected value 1.0, got %f", metric.Value)
	}
	
	// Second increment
	monitor.IncrementCounter("requests", labels)
	
	metrics = monitor.GetMetrics()
	metric = metrics["requests"]
	
	if metric.Value != 2.0 {
		t.Errorf("Expected value 2.0, got %f", metric.Value)
	}
}

func TestSetGauge(t *testing.T) {
	monitor := NewMonitor()
	
	monitor.SetGauge("temperature", 23.5, map[string]string{"unit": "celsius"})
	
	metrics := monitor.GetMetrics()
	metric := metrics["temperature"]
	
	if metric.Type != GaugeMetric {
		t.Errorf("Expected type GaugeMetric, got %s", metric.Type)
	}
	
	if metric.Value != 23.5 {
		t.Errorf("Expected value 23.5, got %f", metric.Value)
	}
}

func TestRecordTimer(t *testing.T) {
	monitor := NewMonitor()
	
	duration := 500 * time.Millisecond
	monitor.RecordTimer("operation_duration", duration, nil)
	
	metrics := monitor.GetMetrics()
	metric := metrics["operation_duration"]
	
	if metric.Type != TimerMetric {
		t.Errorf("Expected type TimerMetric, got %s", metric.Type)
	}
	
	// Value should be in milliseconds
	if metric.Value != 500.0 {
		t.Errorf("Expected value 500.0, got %f", metric.Value)
	}
}

func TestHealthChecks(t *testing.T) {
	monitor := NewMonitor()
	
	// Register a health check
	monitor.RegisterHealthCheck("test_service", func() HealthCheck {
		return HealthCheck{
			Name:    "test_service",
			Status:  HealthStatusHealthy,
			Message: "Service is running",
		}
	})
	
	// Run health checks
	results := monitor.RunHealthChecks()
	
	result, exists := results["test_service"]
	if !exists {
		t.Fatal("Health check result should exist")
	}
	
	if result.Status != HealthStatusHealthy {
		t.Errorf("Expected status healthy, got %s", result.Status)
	}
	
	if result.Message != "Service is running" {
		t.Errorf("Expected message 'Service is running', got %s", result.Message)
	}
	
	if result.Duration == 0 {
		t.Error("Duration should be set")
	}
	
	if result.Timestamp.IsZero() {
		t.Error("Timestamp should be set")
	}
}

func TestErrorTracking(t *testing.T) {
	monitor := NewMonitor()
	
	err := errors.New("test error")
	metadata := map[string]interface{}{"user_id": 123}
	
	monitor.RecordError(err, "user_service", metadata)
	
	errors := monitor.GetErrors(10)
	
	if len(errors) != 1 {
		t.Fatalf("Expected 1 error, got %d", len(errors))
	}
	
	errorRecord := errors[0]
	
	if errorRecord.Error != "test error" {
		t.Errorf("Expected error 'test error', got %s", errorRecord.Error)
	}
	
	if errorRecord.Context != "user_service" {
		t.Errorf("Expected context 'user_service', got %s", errorRecord.Context)
	}
	
	if errorRecord.Metadata["user_id"] != 123 {
		t.Errorf("Expected user_id 123, got %v", errorRecord.Metadata["user_id"])
	}
	
	// Check that error counter was incremented
	metrics := monitor.GetMetrics()
	errorMetric := metrics["errors_total"]
	
	if errorMetric == nil {
		t.Fatal("Error counter metric should exist")
	}
	
	if errorMetric.Value != 1.0 {
		t.Errorf("Expected error count 1.0, got %f", errorMetric.Value)
	}
}

func TestErrorTrackingLimit(t *testing.T) {
	monitor := NewMonitor()
	// Set a small limit for testing
	monitor.errorTracker.maxSize = 3
	
	// Record more errors than the limit
	for i := 0; i < 5; i++ {
		err := errors.New("test error")
		monitor.RecordError(err, "test", nil)
	}
	
	errors := monitor.GetErrors(10)
	
	// Should only keep the last 3 errors
	if len(errors) != 3 {
		t.Errorf("Expected 3 errors (limit), got %d", len(errors))
	}
}

func TestSystemMetrics(t *testing.T) {
	monitor := NewMonitor()
	
	metrics := monitor.GetSystemMetrics()
	
	if metrics.Memory.Alloc == 0 {
		t.Error("Memory allocation should be > 0")
	}
	
	if metrics.Runtime.Goroutines == 0 {
		t.Error("Goroutine count should be > 0")
	}
	
	if metrics.System.PID == 0 {
		t.Error("PID should be > 0")
	}
	
	if metrics.System.Uptime == 0 {
		t.Error("Uptime should be > 0")
	}
	
	if metrics.Timestamp.IsZero() {
		t.Error("Timestamp should be set")
	}
}

func TestTimerWrapper(t *testing.T) {
	monitor := NewMonitor()
	
	timer := monitor.NewTimer("test_operation", map[string]string{"type": "test"})
	
	// Simulate some work
	time.Sleep(10 * time.Millisecond)
	
	timer.Stop()
	
	metrics := monitor.GetMetrics()
	metric := metrics["test_operation"]
	
	if metric == nil {
		t.Fatal("Timer metric should exist")
	}
	
	if metric.Type != TimerMetric {
		t.Errorf("Expected type TimerMetric, got %s", metric.Type)
	}
	
	// Should have recorded some duration (at least 10ms)
	if metric.Value < 10.0 {
		t.Errorf("Expected duration >= 10ms, got %f", metric.Value)
	}
}

func TestPeriodicCollection(t *testing.T) {
	monitor := NewMonitor()
	
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	
	// Start periodic collection with short interval
	monitor.StartPeriodicCollection(ctx, 50*time.Millisecond)
	
	// Wait for a few cycles
	time.Sleep(150 * time.Millisecond)
	
	// Cancel and check metrics were collected
	cancel()
	
	metrics := monitor.GetMetrics()
	
	// Should have system metrics
	if _, exists := metrics["memory_alloc_bytes"]; !exists {
		t.Error("Should have collected memory metrics")
	}
	
	if _, exists := metrics["runtime_goroutines"]; !exists {
		t.Error("Should have collected runtime metrics")
	}
	
	if _, exists := metrics["uptime_seconds"]; !exists {
		t.Error("Should have collected uptime metrics")
	}
}

func TestExportMetrics(t *testing.T) {
	monitor := NewMonitor()
	
	// Add some test data
	monitor.SetGauge("test_gauge", 42.0, nil)
	monitor.RecordError(errors.New("test error"), "test", nil)
	
	// Register a health check
	monitor.RegisterHealthCheck("test", func() HealthCheck {
		return HealthCheck{
			Name:   "test",
			Status: HealthStatusHealthy,
		}
	})
	
	data, err := monitor.ExportMetrics()
	if err != nil {
		t.Fatalf("Failed to export metrics: %v", err)
	}
	
	if len(data) == 0 {
		t.Error("Exported data should not be empty")
	}
	
	// Should be valid JSON (basic check)
	if !isValidJSON(string(data)) {
		t.Error("Exported data should be valid JSON")
	}
}

func TestGlobalMonitor(t *testing.T) {
	// Reset global monitor for test
	globalMonitor = nil
	monitorOnce = sync.Once{}
	
	monitor1 := GetMonitor()
	monitor2 := GetMonitor()
	
	if monitor1 != monitor2 {
		t.Error("Should return same global instance")
	}
	
	// Test package-level functions
	RecordMetric("test", CounterMetric, 1.0, nil)
	IncrementCounter("counter", nil)
	RecordError(errors.New("test"), "test", nil)
	
	timer := NewTimer("timer", nil)
	timer.Stop()
	
	metrics := monitor1.GetMetrics()
	
	if len(metrics) == 0 {
		t.Error("Should have recorded metrics")
	}
}

func TestHealthStatusString(t *testing.T) {
	tests := []struct {
		status   HealthStatus
		expected string
	}{
		{HealthStatusHealthy, "healthy"},
		{HealthStatusDegraded, "degraded"},
		{HealthStatusUnhealthy, "unhealthy"},
		{HealthStatusUnknown, "unknown"},
	}
	
	for _, tt := range tests {
		if string(tt.status) != tt.expected {
			t.Errorf("Expected %s, got %s", tt.expected, string(tt.status))
		}
	}
}

func TestMetricTypeString(t *testing.T) {
	tests := []struct {
		metricType MetricType
		expected   string
	}{
		{CounterMetric, "counter"},
		{GaugeMetric, "gauge"},
		{HistogramMetric, "histogram"},
		{TimerMetric, "timer"},
	}
	
	for _, tt := range tests {
		if string(tt.metricType) != tt.expected {
			t.Errorf("Expected %s, got %s", tt.expected, string(tt.metricType))
		}
	}
}

// Helper functions
func isValidJSON(s string) bool {
	// Basic JSON validation - should start with { and end with }
	// More sophisticated validation would parse the JSON
	return len(s) > 2 && s[0] == '{' && s[len(s)-1] == '}'
}

// Benchmark tests
func BenchmarkRecordMetric(b *testing.B) {
	monitor := NewMonitor()
	labels := map[string]string{"env": "test"}
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		monitor.RecordMetric("benchmark_metric", GaugeMetric, float64(i), labels)
	}
}

func BenchmarkIncrementCounter(b *testing.B) {
	monitor := NewMonitor()
	labels := map[string]string{"type": "request"}
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		monitor.IncrementCounter("requests", labels)
	}
}

func BenchmarkTimer(b *testing.B) {
	monitor := NewMonitor()
	labels := map[string]string{"operation": "benchmark"}
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		timer := monitor.NewTimer("operation_duration", labels)
		timer.Stop()
	}
}