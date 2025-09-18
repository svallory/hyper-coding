package models

import (
	"testing"
	"time"
)

func TestParseLogEntry(t *testing.T) {
	testCases := []struct {
		line      string
		epicName  string
		expected  *LogEntry
		shouldErr bool
	}{
		{
			line:     "[2025-01-16T14:30:00Z] [info] Epic workflow started",
			epicName: "test-epic",
			expected: &LogEntry{
				Level:    LogLevelInfo,
				Message:  "Epic workflow started",
				EpicName: "test-epic",
			},
			shouldErr: false,
		},
		{
			line:     "[2025-01-16T14:32:15Z] [success] Document validation completed",
			epicName: "test-epic",
			expected: &LogEntry{
				Level:    LogLevelSuccess,
				Message:  "Document validation completed",
				EpicName: "test-epic",
			},
			shouldErr: false,
		},
		{
			line:     "[2025-01-16T14:35:20Z] [warning] PRD generation retry attempt 2/3",
			epicName: "test-epic",
			expected: &LogEntry{
				Level:    LogLevelWarning,
				Message:  "PRD generation retry attempt 2/3",
				EpicName: "test-epic",
			},
			shouldErr: false,
		},
		{
			line:     "[2025-01-16T14:40:45Z] [agent] Deployed task-executor agent for task 3.2",
			epicName: "test-epic",
			expected: &LogEntry{
				Level:    LogLevelAgent,
				Message:  "Deployed task-executor agent for task 3.2",
				EpicName: "test-epic",
			},
			shouldErr: false,
		},
		{
			line:     "[2025-01-16T14:45:00Z] [error] Task 5.1 failed - dependency conflict detected",
			epicName: "test-epic",
			expected: &LogEntry{
				Level:    LogLevelError,
				Message:  "Task 5.1 failed - dependency conflict detected",
				EpicName: "test-epic",
			},
			shouldErr: false,
		},
		{
			line:      "Invalid log format without brackets",
			epicName:  "test-epic",
			expected:  nil,
			shouldErr: true,
		},
		{
			line:      "[invalid-timestamp] [info] Message",
			epicName:  "test-epic",
			expected:  nil,
			shouldErr: true,
		},
	}

	for i, tc := range testCases {
		entry, err := ParseLogEntry(tc.line, tc.epicName)

		if tc.shouldErr {
			if err == nil {
				t.Errorf("Test case %d: expected error but got none", i)
			}
			continue
		}

		if err != nil {
			t.Errorf("Test case %d: unexpected error: %v", i, err)
			continue
		}

		if entry.Level != tc.expected.Level {
			t.Errorf("Test case %d: expected level %s, got %s", i, tc.expected.Level, entry.Level)
		}

		if entry.Message != tc.expected.Message {
			t.Errorf("Test case %d: expected message '%s', got '%s'", i, tc.expected.Message, entry.Message)
		}

		if entry.EpicName != tc.expected.EpicName {
			t.Errorf("Test case %d: expected epic name '%s', got '%s'", i, tc.expected.EpicName, entry.EpicName)
		}

		if entry.Raw != tc.line {
			t.Errorf("Test case %d: expected raw '%s', got '%s'", i, tc.line, entry.Raw)
		}

		// Verify timestamp was parsed correctly
		if entry.Timestamp.IsZero() {
			t.Errorf("Test case %d: timestamp was not parsed", i)
		}
	}
}

func TestLogLevelMethods(t *testing.T) {
	testCases := []struct {
		level        LogLevel
		expectedIcon string
		expectedColor string
	}{
		{LogLevelInfo, "ℹ️", "blue"},
		{LogLevelSuccess, "✅", "green"},
		{LogLevelWarning, "⚠️", "yellow"},
		{LogLevelError, "❌", "red"},
		{LogLevelAgent, "🤖", "purple"},
	}

	for _, tc := range testCases {
		icon := tc.level.GetLevelIcon()
		if icon != tc.expectedIcon {
			t.Errorf("For level %s, expected icon '%s', got '%s'", tc.level, tc.expectedIcon, icon)
		}

		color := tc.level.GetLevelColor()
		if color != tc.expectedColor {
			t.Errorf("For level %s, expected color '%s', got '%s'", tc.level, tc.expectedColor, color)
		}
	}
}

func TestLogEntryFormatForDisplay(t *testing.T) {
	timestamp, _ := time.Parse(time.RFC3339, "2025-01-16T14:30:00Z")
	entry := &LogEntry{
		Timestamp: timestamp,
		Level:     LogLevelInfo,
		Message:   "Test message",
		EpicName:  "test-epic",
		Raw:       "[2025-01-16T14:30:00Z] [info] Test message",
	}

	formatted := entry.FormatForDisplay()
	expected := "14:30:00 ℹ️ [test-epic] Test message"

	if formatted != expected {
		t.Errorf("Expected formatted output '%s', got '%s'", expected, formatted)
	}
}

func TestLogEntryMatches(t *testing.T) {
	timestamp, _ := time.Parse(time.RFC3339, "2025-01-16T14:30:00Z")
	entry := &LogEntry{
		Timestamp: timestamp,
		Level:     LogLevelInfo,
		Message:   "Epic workflow started for user authentication",
		EpicName:  "user-auth-epic",
	}

	testCases := []struct {
		filter   LogFilter
		expected bool
		name     string
	}{
		{
			filter:   LogFilter{},
			expected: true,
			name:     "empty filter",
		},
		{
			filter:   LogFilter{Level: func() *LogLevel { l := LogLevelInfo; return &l }()},
			expected: true,
			name:     "matching level",
		},
		{
			filter:   LogFilter{Level: func() *LogLevel { l := LogLevelError; return &l }()},
			expected: false,
			name:     "non-matching level",
		},
		{
			filter:   LogFilter{EpicName: "user-auth"},
			expected: true,
			name:     "matching epic name substring",
		},
		{
			filter:   LogFilter{EpicName: "different-epic"},
			expected: false,
			name:     "non-matching epic name",
		},
		{
			filter:   LogFilter{Message: "workflow"},
			expected: true,
			name:     "matching message substring",
		},
		{
			filter:   LogFilter{Message: "nonexistent"},
			expected: false,
			name:     "non-matching message",
		},
	}

	for _, tc := range testCases {
		result := entry.Matches(tc.filter)
		if result != tc.expected {
			t.Errorf("Test '%s': expected %v, got %v", tc.name, tc.expected, result)
		}
	}
}

func TestLogCollection(t *testing.T) {
	collection := NewLogCollection()

	// Add some test entries
	timestamp := time.Now()
	entries := []LogEntry{
		{Level: LogLevelInfo, Message: "Info message", Timestamp: timestamp},
		{Level: LogLevelError, Message: "Error message", Timestamp: timestamp.Add(time.Minute)},
		{Level: LogLevelSuccess, Message: "Success message", Timestamp: timestamp.Add(2 * time.Minute)},
	}

	for _, entry := range entries {
		collection.Add(entry)
	}

	// Test count
	if collection.Count() != 3 {
		t.Errorf("Expected count 3, got %d", collection.Count())
	}

	// Test filtering by level
	errorLevel := LogLevelError
	collection.SetFilter(LogFilter{Level: &errorLevel})
	filtered := collection.GetFiltered()

	if len(filtered) != 1 {
		t.Errorf("Expected 1 filtered entry, got %d", len(filtered))
	}

	if filtered[0].Level != LogLevelError {
		t.Errorf("Expected error level entry, got %s", filtered[0].Level)
	}

	// Test count by level
	counts := collection.GetCountByLevel()
	if counts[LogLevelInfo] != 1 {
		t.Errorf("Expected 1 info entry, got %d", counts[LogLevelInfo])
	}
	if counts[LogLevelError] != 1 {
		t.Errorf("Expected 1 error entry, got %d", counts[LogLevelError])
	}
	if counts[LogLevelSuccess] != 1 {
		t.Errorf("Expected 1 success entry, got %d", counts[LogLevelSuccess])
	}

	// Test clear
	collection.Clear()
	if collection.Count() != 0 {
		t.Errorf("Expected count 0 after clear, got %d", collection.Count())
	}
}