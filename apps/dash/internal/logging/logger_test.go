package logging

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewLogger(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  INFO,
		Output: &buf,
		Fields: Fields{"test": "value"},
	}
	
	logger := NewLogger(config)
	
	if logger.level != INFO {
		t.Errorf("Expected level INFO, got %v", logger.level)
	}
	
	if logger.writer != &buf {
		t.Error("Writer not set correctly")
	}
	
	if logger.fields["test"] != "value" {
		t.Error("Fields not set correctly")
	}
}

func TestLogLevels(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  WARN,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	// Should not log DEBUG and INFO
	logger.Debug("debug message")
	logger.Info("info message")
	
	if buf.Len() > 0 {
		t.Error("Should not log below configured level")
	}
	
	// Should log WARN, ERROR, FATAL
	logger.Warn("warn message")
	
	output := buf.String()
	if !strings.Contains(output, "warn message") {
		t.Error("Should log at configured level and above")
	}
	
	if !strings.Contains(output, "[WARN]") {
		t.Error("Should include log level in output")
	}
}

func TestLoggerWithFields(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  DEBUG,
		Output: &buf,
		Fields: Fields{"component": "test"},
	}
	
	logger := NewLogger(config)
	fieldsLogger := logger.WithFields(Fields{"request_id": "123"})
	
	fieldsLogger.Info("test message")
	
	output := buf.String()
	if !strings.Contains(output, "component=test") {
		t.Error("Should include original fields")
	}
	
	if !strings.Contains(output, "request_id=123") {
		t.Error("Should include additional fields")
	}
}

func TestLoggerWithError(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  DEBUG,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	err := &testError{"test error"}
	errorLogger := logger.WithError(err)
	
	errorLogger.Error("error occurred")
	
	output := buf.String()
	if !strings.Contains(output, "error=test error") {
		t.Error("Should include error in fields")
	}
}

func TestLogFormatting(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  DEBUG,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	logger.Info("test message")
	
	output := buf.String()
	
	// Check timestamp format (YYYY-MM-DD HH:MM:SS.mmm)
	if !strings.Contains(output, time.Now().Format("2006-01-02")) {
		t.Error("Should include timestamp")
	}
	
	// Check log level
	if !strings.Contains(output, "[INFO]") {
		t.Error("Should include log level")
	}
	
	// Check message
	if !strings.Contains(output, "test message") {
		t.Error("Should include log message")
	}
}

func TestLogFile(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()
	logFile := filepath.Join(tmpDir, "test.log")
	
	config := Config{
		Level:   INFO,
		LogFile: logFile,
	}
	
	logger := NewLogger(config)
	logger.Info("test message")
	logger.Close()
	
	// Check if log file was created and contains message
	content, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}
	
	if !strings.Contains(string(content), "test message") {
		t.Error("Log file should contain log message")
	}
}

func TestDefaultLogger(t *testing.T) {
	// Reset default logger for test
	defaultLogger = nil
	once = sync.Once{}
	
	logger1 := GetDefaultLogger()
	logger2 := GetDefaultLogger()
	
	if logger1 != logger2 {
		t.Error("Should return same instance")
	}
}

func TestPackageLevelFunctions(t *testing.T) {
	// Reset default logger for test
	defaultLogger = nil
	once = sync.Once{}
	
	// Test that package-level functions don't panic
	Debug("debug message")
	Info("info message")
	Warn("warn message")
	Error("error message")
	
	// Test formatted versions
	Debugf("debug %s", "formatted")
	Infof("info %s", "formatted")
	Warnf("warn %s", "formatted")
	Errorf("error %s", "formatted")
	
	// Test with fields
	WithFields(Fields{"test": "value"}).Info("test message")
	
	// Test with error
	err := &testError{"test error"}
	WithError(err).Error("error with context")
}

func TestSetAndGetLevel(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  INFO,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	// Initial level
	if logger.GetLevel() != INFO {
		t.Errorf("Expected level INFO, got %v", logger.GetLevel())
	}
	
	// Change level
	logger.SetLevel(ERROR)
	
	if logger.GetLevel() != ERROR {
		t.Errorf("Expected level ERROR, got %v", logger.GetLevel())
	}
	
	// Should not log WARN anymore
	logger.Warn("warn message")
	
	if buf.Len() > 0 {
		t.Error("Should not log below new level")
	}
}

func TestCallerInformation(t *testing.T) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  DEBUG,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	// ERROR level should include caller information
	logger.Error("error with caller")
	
	output := buf.String()
	if !strings.Contains(output, "logger_test.go:") {
		t.Error("ERROR logs should include caller information")
	}
}

func TestLogLevelString(t *testing.T) {
	tests := []struct {
		level    LogLevel
		expected string
	}{
		{DEBUG, "DEBUG"},
		{INFO, "INFO"},
		{WARN, "WARN"},
		{ERROR, "ERROR"},
		{FATAL, "FATAL"},
		{LogLevel(999), "UNKNOWN"},
	}
	
	for _, tt := range tests {
		if tt.level.String() != tt.expected {
			t.Errorf("Expected %s, got %s", tt.expected, tt.level.String())
		}
	}
}

// Helper types for testing
type testError struct {
	message string
}

func (e *testError) Error() string {
	return e.message
}

// Benchmark tests
func BenchmarkLogger(b *testing.B) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  INFO,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		logger.Info("benchmark message")
	}
}

func BenchmarkLoggerWithFields(b *testing.B) {
	var buf bytes.Buffer
	
	config := Config{
		Level:  INFO,
		Output: &buf,
	}
	
	logger := NewLogger(config)
	fields := Fields{"test": "value", "count": 123}
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		logger.WithFields(fields).Info("benchmark message")
	}
}