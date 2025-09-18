package models

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// LogLevel represents the severity level of a log entry
type LogLevel string

const (
	LogLevelInfo    LogLevel = "info"
	LogLevelSuccess LogLevel = "success"
	LogLevelWarning LogLevel = "warning"
	LogLevelError   LogLevel = "error"
	LogLevelAgent   LogLevel = "agent"
)

// LogEntry represents a single log entry from workflow.log
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Message   string    `json:"message"`
	EpicName  string    `json:"epic_name"`
	Raw       string    `json:"raw"`
}

// LogFilter represents filtering criteria for log entries
type LogFilter struct {
	Level    *LogLevel `json:"level,omitempty"`
	EpicName string    `json:"epic_name,omitempty"`
	Message  string    `json:"message,omitempty"`
	Since    *time.Time `json:"since,omitempty"`
}

// ParseLogEntry parses a log line in the format: [timestamp] [level] message
func ParseLogEntry(line, epicName string) (*LogEntry, error) {
	// Regular expression to match: [2025-01-16T14:30:00Z] [info] message
	re := regexp.MustCompile(`^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$`)
	matches := re.FindStringSubmatch(strings.TrimSpace(line))
	
	if len(matches) != 4 {
		return nil, fmt.Errorf("invalid log format: %s", line)
	}
	
	// Parse timestamp
	timestamp, err := time.Parse(time.RFC3339, matches[1])
	if err != nil {
		// Try alternative formats if RFC3339 fails
		timestamp, err = time.Parse("2006-01-02T15:04:05Z", matches[1])
		if err != nil {
			return nil, fmt.Errorf("failed to parse timestamp: %v", err)
		}
	}
	
	// Parse level
	level := LogLevel(strings.ToLower(matches[2]))
	
	// Extract message
	message := matches[3]
	
	return &LogEntry{
		Timestamp: timestamp,
		Level:     level,
		Message:   message,
		EpicName:  epicName,
		Raw:       line,
	}, nil
}

// GetLevelColor returns a color code for the log level
func (l LogLevel) GetLevelColor() string {
	switch l {
	case LogLevelInfo:
		return "blue"
	case LogLevelSuccess:
		return "green"
	case LogLevelWarning:
		return "yellow"
	case LogLevelError:
		return "red"
	case LogLevelAgent:
		return "purple"
	default:
		return "gray"
	}
}

// GetLevelIcon returns an icon for the log level
func (l LogLevel) GetLevelIcon() string {
	switch l {
	case LogLevelInfo:
		return "ℹ️"
	case LogLevelSuccess:
		return "✅"
	case LogLevelWarning:
		return "⚠️"
	case LogLevelError:
		return "❌"
	case LogLevelAgent:
		return "🤖"
	default:
		return "📝"
	}
}

// Matches checks if the log entry matches the given filter
func (e *LogEntry) Matches(filter LogFilter) bool {
	if filter.Level != nil && e.Level != *filter.Level {
		return false
	}
	
	if filter.EpicName != "" && !strings.Contains(e.EpicName, filter.EpicName) {
		return false
	}
	
	if filter.Message != "" && !strings.Contains(strings.ToLower(e.Message), strings.ToLower(filter.Message)) {
		return false
	}
	
	if filter.Since != nil && e.Timestamp.Before(*filter.Since) {
		return false
	}
	
	return true
}

// FormatForDisplay returns a formatted string for display in the TUI
func (e *LogEntry) FormatForDisplay() string {
	timeStr := e.Timestamp.Format("15:04:05")
	icon := e.Level.GetLevelIcon()
	
	return fmt.Sprintf("%s %s [%s] %s", timeStr, icon, e.EpicName, e.Message)
}

// IsRecent returns true if the log entry is from the last minute
func (e *LogEntry) IsRecent() bool {
	return time.Since(e.Timestamp) < time.Minute
}

// LogCollection represents a collection of log entries with filtering capabilities
type LogCollection struct {
	entries []LogEntry
	filter  LogFilter
}

// NewLogCollection creates a new log collection
func NewLogCollection() *LogCollection {
	return &LogCollection{
		entries: make([]LogEntry, 0),
	}
}

// Add adds a log entry to the collection
func (lc *LogCollection) Add(entry LogEntry) {
	lc.entries = append(lc.entries, entry)
}

// SetFilter sets the current filter
func (lc *LogCollection) SetFilter(filter LogFilter) {
	lc.filter = filter
}

// GetFiltered returns filtered log entries
func (lc *LogCollection) GetFiltered() []LogEntry {
	filtered := make([]LogEntry, 0)
	
	for _, entry := range lc.entries {
		if entry.Matches(lc.filter) {
			filtered = append(filtered, entry)
		}
	}
	
	return filtered
}

// GetRecent returns log entries from the last n minutes
func (lc *LogCollection) GetRecent(minutes int) []LogEntry {
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)
	filter := LogFilter{Since: &since}
	
	filtered := make([]LogEntry, 0)
	for _, entry := range lc.entries {
		if entry.Matches(filter) {
			filtered = append(filtered, entry)
		}
	}
	
	return filtered
}

// Clear removes all log entries
func (lc *LogCollection) Clear() {
	lc.entries = make([]LogEntry, 0)
}

// Count returns the total number of entries
func (lc *LogCollection) Count() int {
	return len(lc.entries)
}

// GetCountByLevel returns count of entries for each level
func (lc *LogCollection) GetCountByLevel() map[LogLevel]int {
	counts := make(map[LogLevel]int)
	
	for _, entry := range lc.entries {
		counts[entry.Level]++
	}
	
	return counts
}