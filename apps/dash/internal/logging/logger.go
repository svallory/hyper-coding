package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// LogLevel represents the severity level of a log message
type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
	FATAL
)

// String returns the string representation of the log level
func (l LogLevel) String() string {
	switch l {
	case DEBUG:
		return "DEBUG"
	case INFO:
		return "INFO"
	case WARN:
		return "WARN"
	case ERROR:
		return "ERROR"
	case FATAL:
		return "FATAL"
	default:
		return "UNKNOWN"
	}
}

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Message   string    `json:"message"`
	Fields    Fields    `json:"fields,omitempty"`
	Caller    string    `json:"caller,omitempty"`
	Error     string    `json:"error,omitempty"`
}

// Fields represents structured log fields
type Fields map[string]interface{}

// Logger represents the main logger instance
type Logger struct {
	level      LogLevel
	writer     io.Writer
	fields     Fields
	callerSkip int
	mutex      sync.Mutex
	logFile    *os.File
}

// Config contains configuration for the logger
type Config struct {
	Level      LogLevel
	Output     io.Writer
	LogFile    string
	EnableCaller bool
	Fields     Fields
}

var (
	defaultLogger *Logger
	once         sync.Once
)

// NewLogger creates a new logger instance
func NewLogger(config Config) *Logger {
	logger := &Logger{
		level:      config.Level,
		writer:     config.Output,
		fields:     config.Fields,
		callerSkip: 2,
	}

	if config.Output == nil {
		logger.writer = os.Stdout
	}

	// Open log file if specified
	if config.LogFile != "" {
		if err := logger.openLogFile(config.LogFile); err != nil {
			fmt.Printf("Failed to open log file %s: %v\n", config.LogFile, err)
		}
	}

	return logger
}

// GetDefaultLogger returns the default logger instance
func GetDefaultLogger() *Logger {
	once.Do(func() {
		// Create logs directory
		logDir := filepath.Join(".", "logs")
		os.MkdirAll(logDir, 0755)
		
		logFile := filepath.Join(logDir, fmt.Sprintf("hyperdash-%s.log", 
			time.Now().Format("2006-01-02")))
		
		config := Config{
			Level:   INFO,
			LogFile: logFile,
			Fields: Fields{
				"app":     "hyperdash",
				"version": "1.0.0-beta.1",
			},
		}
		defaultLogger = NewLogger(config)
	})
	return defaultLogger
}

// openLogFile opens and configures the log file
func (l *Logger) openLogFile(filename string) error {
	// Create directory if it doesn't exist
	dir := filepath.Dir(filename)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	file, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}

	l.logFile = file
	
	// Create multi-writer to write to both stdout and file
	if l.writer == os.Stdout {
		l.writer = io.MultiWriter(os.Stdout, file)
	} else {
		l.writer = io.MultiWriter(l.writer, file)
	}

	return nil
}

// WithFields creates a new logger with additional fields
func (l *Logger) WithFields(fields Fields) *Logger {
	newFields := make(Fields)
	
	// Copy existing fields
	for k, v := range l.fields {
		newFields[k] = v
	}
	
	// Add new fields
	for k, v := range fields {
		newFields[k] = v
	}

	return &Logger{
		level:      l.level,
		writer:     l.writer,
		fields:     newFields,
		callerSkip: l.callerSkip,
		logFile:    l.logFile,
	}
}

// WithError creates a new logger with an error field
func (l *Logger) WithError(err error) *Logger {
	return l.WithFields(Fields{"error": err.Error()})
}

// log writes a log entry
func (l *Logger) log(level LogLevel, message string, fields Fields) {
	if level < l.level {
		return
	}

	l.mutex.Lock()
	defer l.mutex.Unlock()

	entry := LogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Message:   message,
		Fields:    make(Fields),
	}

	// Copy logger fields
	for k, v := range l.fields {
		entry.Fields[k] = v
	}

	// Add method fields
	for k, v := range fields {
		entry.Fields[k] = v
	}

	// Add caller information for ERROR and FATAL levels
	if level >= ERROR {
		if _, file, line, ok := runtime.Caller(l.callerSkip); ok {
			entry.Caller = fmt.Sprintf("%s:%d", filepath.Base(file), line)
		}
	}

	// Format and write the log entry
	formatted := l.formatEntry(entry)
	fmt.Fprintln(l.writer, formatted)
}

// formatEntry formats a log entry for output
func (l *Logger) formatEntry(entry LogEntry) string {
	timestamp := entry.Timestamp.Format("2006-01-02 15:04:05.000")
	
	// Base format: timestamp [LEVEL] message
	formatted := fmt.Sprintf("%s [%s] %s", timestamp, entry.Level, entry.Message)
	
	// Add fields if present
	if len(entry.Fields) > 0 {
		formatted += " |"
		for k, v := range entry.Fields {
			formatted += fmt.Sprintf(" %s=%v", k, v)
		}
	}
	
	// Add caller information if present
	if entry.Caller != "" {
		formatted += fmt.Sprintf(" (%s)", entry.Caller)
	}
	
	return formatted
}

// Debug logs a debug message
func (l *Logger) Debug(message string) {
	l.log(DEBUG, message, nil)
}

// Debugf logs a formatted debug message
func (l *Logger) Debugf(format string, args ...interface{}) {
	l.log(DEBUG, fmt.Sprintf(format, args...), nil)
}

// Info logs an info message
func (l *Logger) Info(message string) {
	l.log(INFO, message, nil)
}

// Infof logs a formatted info message
func (l *Logger) Infof(format string, args ...interface{}) {
	l.log(INFO, fmt.Sprintf(format, args...), nil)
}

// Warn logs a warning message
func (l *Logger) Warn(message string) {
	l.log(WARN, message, nil)
}

// Warnf logs a formatted warning message
func (l *Logger) Warnf(format string, args ...interface{}) {
	l.log(WARN, fmt.Sprintf(format, args...), nil)
}

// Error logs an error message
func (l *Logger) Error(message string) {
	l.log(ERROR, message, nil)
}

// Errorf logs a formatted error message
func (l *Logger) Errorf(format string, args ...interface{}) {
	l.log(ERROR, fmt.Sprintf(format, args...), nil)
}

// Fatal logs a fatal message and exits
func (l *Logger) Fatal(message string) {
	l.log(FATAL, message, nil)
	if l.logFile != nil {
		l.logFile.Close()
	}
	os.Exit(1)
}

// Fatalf logs a formatted fatal message and exits
func (l *Logger) Fatalf(format string, args ...interface{}) {
	l.log(FATAL, fmt.Sprintf(format, args...), nil)
	if l.logFile != nil {
		l.logFile.Close()
	}
	os.Exit(1)
}

// Close closes the logger and any open files
func (l *Logger) Close() error {
	if l.logFile != nil {
		return l.logFile.Close()
	}
	return nil
}

// SetLevel sets the logging level
func (l *Logger) SetLevel(level LogLevel) {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	l.level = level
}

// GetLevel returns the current logging level
func (l *Logger) GetLevel() LogLevel {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	return l.level
}

// Package-level convenience functions using the default logger

// Debug logs a debug message using the default logger
func Debug(message string) {
	GetDefaultLogger().Debug(message)
}

// Debugf logs a formatted debug message using the default logger
func Debugf(format string, args ...interface{}) {
	GetDefaultLogger().Debugf(format, args...)
}

// Info logs an info message using the default logger
func Info(message string) {
	GetDefaultLogger().Info(message)
}

// Infof logs a formatted info message using the default logger
func Infof(format string, args ...interface{}) {
	GetDefaultLogger().Infof(format, args...)
}

// Warn logs a warning message using the default logger
func Warn(message string) {
	GetDefaultLogger().Warn(message)
}

// Warnf logs a formatted warning message using the default logger
func Warnf(format string, args ...interface{}) {
	GetDefaultLogger().Warnf(format, args...)
}

// Error logs an error message using the default logger
func Error(message string) {
	GetDefaultLogger().Error(message)
}

// Errorf logs a formatted error message using the default logger
func Errorf(format string, args ...interface{}) {
	GetDefaultLogger().Errorf(format, args...)
}

// Fatal logs a fatal message using the default logger and exits
func Fatal(message string) {
	GetDefaultLogger().Fatal(message)
}

// Fatalf logs a formatted fatal message using the default logger and exits
func Fatalf(format string, args ...interface{}) {
	GetDefaultLogger().Fatalf(format, args...)
}

// WithFields creates a logger with additional fields using the default logger
func WithFields(fields Fields) *Logger {
	return GetDefaultLogger().WithFields(fields)
}

// WithError creates a logger with an error field using the default logger
func WithError(err error) *Logger {
	return GetDefaultLogger().WithError(err)
}