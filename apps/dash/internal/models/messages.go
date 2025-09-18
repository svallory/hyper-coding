package models

import "time"

// EpicUpdateMsg is sent when an epic's workflow state changes
type EpicUpdateMsg struct {
	Epic Epic
}

// LogUpdateMsg is sent when a new log entry is added
type LogUpdateMsg struct {
	Entry LogEntry
}

// ErrorMsg is sent when an error occurs
type ErrorMsg string

// FileWatcherStartedMsg is sent when the file watcher is successfully started
type FileWatcherStartedMsg struct {
	WatchedPaths []string
}

// EpicDiscoveredMsg is sent when a new epic directory is discovered
type EpicDiscoveredMsg struct {
	EpicPath string
}

// EpicRemovedMsg is sent when an epic directory is removed
type EpicRemovedMsg struct {
	EpicPath string
}

// InitialDataLoadedMsg is sent when initial data loading is complete
type InitialDataLoadedMsg struct {
	Epics []Epic
	Logs  []LogEntry
}

// RefreshMsg is sent to trigger a refresh of all data
type RefreshMsg struct {
	Timestamp time.Time
}

// StatusUpdateMsg provides general status updates
type StatusUpdateMsg struct {
	Message   string
	Timestamp time.Time
	Level     LogLevel
}

// AgentActivityMsg is sent when agent activity is detected
type AgentActivityMsg struct {
	EpicName    string
	AgentID     string
	Action      string // "started", "completed", "failed"
	TaskID      string
	Timestamp   time.Time
}

// TaskProgressMsg is sent when task progress changes
type TaskProgressMsg struct {
	EpicName       string
	TaskID         string
	Status         string // "started", "completed", "failed"
	Timestamp      time.Time
	CompletedTasks int
	TotalTasks     int
}

// ConnectionStatusMsg indicates the connection status to monitored directories
type ConnectionStatusMsg struct {
	Connected bool
	Message   string
	Timestamp time.Time
}