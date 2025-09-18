package watcher

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
)

// EpicWatcher monitors epic directories for changes and sends updates via channels
type EpicWatcher struct {
	watcher         *fsnotify.Watcher
	program         *tea.Program
	epicDir         string
	watchedEpics    map[string]*EpicState
	mu              sync.RWMutex
	logPositions    map[string]int64 // Track file positions for log tailing
	stopped         bool
	stopCh          chan struct{}
}

// EpicState tracks the state of a single epic
type EpicState struct {
	Path           string
	WorkflowFile   string
	LogFile        string
	LastModified   time.Time
	LogPosition    int64
}

// NewEpicWatcher creates a new epic watcher
func NewEpicWatcher(epicDir string, program *tea.Program) (*EpicWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create file watcher: %w", err)
	}

	ew := &EpicWatcher{
		watcher:      watcher,
		program:      program,
		epicDir:      epicDir,
		watchedEpics: make(map[string]*EpicState),
		logPositions: make(map[string]int64),
		stopCh:       make(chan struct{}),
	}

	return ew, nil
}

// Start begins watching for file changes
func (ew *EpicWatcher) Start() error {
	// Discover existing epics
	if err := ew.discoverEpics(); err != nil {
		return fmt.Errorf("failed to discover epics: %w", err)
	}

	// Start the event loop
	go ew.eventLoop()

	// Send initial load message
	ew.sendInitialData()

	return nil
}

// Stop stops the watcher
func (ew *EpicWatcher) Stop() {
	ew.mu.Lock()
	defer ew.mu.Unlock()
	
	if ew.stopped {
		return
	}
	
	ew.stopped = true
	close(ew.stopCh)
	ew.watcher.Close()
}

// discoverEpics scans the epic directory for existing epics
func (ew *EpicWatcher) discoverEpics() error {
	if _, err := os.Stat(ew.epicDir); os.IsNotExist(err) {
		// Epic directory doesn't exist yet, just add a watch for when it's created
		parentDir := filepath.Dir(ew.epicDir)
		if err := ew.watcher.Add(parentDir); err != nil {
			return fmt.Errorf("failed to watch parent directory %s: %w", parentDir, err)
		}
		return nil
	}

	// Walk the epic directory
	err := filepath.WalkDir(ew.epicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Look for epic directories (containing workflow-state.json)
		if d.IsDir() && path != ew.epicDir {
			workflowFile := filepath.Join(path, "workflow-state.json")
			logFile := filepath.Join(path, "workflow.log")
			
			if _, err := os.Stat(workflowFile); err == nil {
				epicName := filepath.Base(path)
				ew.addEpicWatch(epicName, path, workflowFile, logFile)
			}
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to walk epic directory: %w", err)
	}

	// Watch the main epic directory for new epics
	if err := ew.watcher.Add(ew.epicDir); err != nil {
		return fmt.Errorf("failed to watch epic directory %s: %w", ew.epicDir, err)
	}

	return nil
}

// addEpicWatch adds a watch for a specific epic
func (ew *EpicWatcher) addEpicWatch(epicName, epicPath, workflowFile, logFile string) {
	ew.mu.Lock()
	defer ew.mu.Unlock()

	// Add to watched epics
	ew.watchedEpics[epicName] = &EpicState{
		Path:         epicPath,
		WorkflowFile: workflowFile,
		LogFile:      logFile,
		LastModified: time.Now(),
	}

	// Watch the epic directory
	ew.watcher.Add(epicPath)

	// Initialize log position for tailing
	if stat, err := os.Stat(logFile); err == nil {
		ew.logPositions[logFile] = stat.Size()
	}

	// Send discovery message
	ew.program.Send(models.EpicDiscoveredMsg{EpicPath: epicPath})
}

// removeEpicWatch removes a watch for a specific epic
func (ew *EpicWatcher) removeEpicWatch(epicName string) {
	ew.mu.Lock()
	defer ew.mu.Unlock()

	if state, exists := ew.watchedEpics[epicName]; exists {
		ew.watcher.Remove(state.Path)
		delete(ew.watchedEpics, epicName)
		delete(ew.logPositions, state.LogFile)
		
		ew.program.Send(models.EpicRemovedMsg{EpicPath: state.Path})
	}
}

// eventLoop processes file system events
func (ew *EpicWatcher) eventLoop() {
	for {
		select {
		case <-ew.stopCh:
			return

		case event, ok := <-ew.watcher.Events:
			if !ok {
				return
			}
			ew.handleEvent(event)

		case err, ok := <-ew.watcher.Errors:
			if !ok {
				return
			}
			ew.program.Send(models.ErrorMsg(fmt.Sprintf("Watcher error: %v", err)))
		}
	}
}

// handleEvent processes a single file system event
func (ew *EpicWatcher) handleEvent(event fsnotify.Event) {
	// Check if it's a new epic directory
	if event.Op&fsnotify.Create != 0 && filepath.Dir(event.Name) == ew.epicDir {
		if stat, err := os.Stat(event.Name); err == nil && stat.IsDir() {
			// Check if it has a workflow-state.json file
			workflowFile := filepath.Join(event.Name, "workflow-state.json")
			if _, err := os.Stat(workflowFile); err == nil {
				epicName := filepath.Base(event.Name)
				logFile := filepath.Join(event.Name, "workflow.log")
				ew.addEpicWatch(epicName, event.Name, workflowFile, logFile)
			}
		}
		return
	}

	// Check if it's a workflow-state.json file change
	if strings.HasSuffix(event.Name, "workflow-state.json") {
		if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
			ew.handleWorkflowStateChange(event.Name)
		}
		return
	}

	// Check if it's a workflow.log file change
	if strings.HasSuffix(event.Name, "workflow.log") {
		if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
			ew.handleLogFileChange(event.Name)
		}
		return
	}

	// Check if an epic directory was removed
	if event.Op&fsnotify.Remove != 0 {
		for epicName, state := range ew.watchedEpics {
			if state.Path == event.Name {
				ew.removeEpicWatch(epicName)
				break
			}
		}
	}
}

// handleWorkflowStateChange processes changes to workflow-state.json files
func (ew *EpicWatcher) handleWorkflowStateChange(filePath string) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		ew.program.Send(models.ErrorMsg(fmt.Sprintf("Failed to read workflow state: %v", err)))
		return
	}

	epicPath := filepath.Dir(filePath)
	epic, err := models.LoadEpic(data, epicPath)
	if err != nil {
		ew.program.Send(models.ErrorMsg(fmt.Sprintf("Failed to parse workflow state: %v", err)))
		return
	}

	// Update last modified time
	ew.mu.Lock()
	epicName := filepath.Base(epicPath)
	if state, exists := ew.watchedEpics[epicName]; exists {
		state.LastModified = time.Now()
	}
	ew.mu.Unlock()

	// Send update message
	ew.program.Send(models.EpicUpdateMsg{Epic: *epic})
}

// handleLogFileChange processes changes to workflow.log files
func (ew *EpicWatcher) handleLogFileChange(filePath string) {
	// Get current file size
	stat, err := os.Stat(filePath)
	if err != nil {
		return
	}

	// Get last known position
	ew.mu.RLock()
	lastPos, exists := ew.logPositions[filePath]
	ew.mu.RUnlock()

	if !exists {
		lastPos = 0
	}

	// If file was truncated, start from beginning
	if stat.Size() < lastPos {
		lastPos = 0
	}

	// Read new content
	file, err := os.Open(filePath)
	if err != nil {
		return
	}
	defer file.Close()

	// Seek to last position
	if _, err := file.Seek(lastPos, 0); err != nil {
		return
	}

	// Read new lines
	scanner := bufio.NewScanner(file)
	epicName := filepath.Base(filepath.Dir(filePath))

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Parse log entry
		if entry, err := models.ParseLogEntry(line, epicName); err == nil {
			ew.program.Send(models.LogUpdateMsg{Entry: *entry})
		}
	}

	// Update position
	ew.mu.Lock()
	ew.logPositions[filePath] = stat.Size()
	ew.mu.Unlock()
}

// sendInitialData loads and sends initial data for all discovered epics
func (ew *EpicWatcher) sendInitialData() {
	ew.mu.RLock()
	defer ew.mu.RUnlock()

	var epics []models.Epic
	var logs []models.LogEntry

	for epicName, state := range ew.watchedEpics {
		// Load workflow state
		if data, err := os.ReadFile(state.WorkflowFile); err == nil {
			if epic, err := models.LoadEpic(data, state.Path); err == nil {
				epics = append(epics, *epic)
			}
		}

		// Load recent logs (last 100 lines)
		if entries := ew.loadRecentLogs(state.LogFile, epicName, 100); len(entries) > 0 {
			logs = append(logs, entries...)
		}
	}

	ew.program.Send(models.InitialDataLoadedMsg{
		Epics: epics,
		Logs:  logs,
	})
}

// loadRecentLogs loads the most recent log entries from a file
func (ew *EpicWatcher) loadRecentLogs(logFile, epicName string, maxLines int) []models.LogEntry {
	file, err := os.Open(logFile)
	if err != nil {
		return nil
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	// Keep only the last maxLines
	start := 0
	if len(lines) > maxLines {
		start = len(lines) - maxLines
	}

	var entries []models.LogEntry
	for i := start; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		if entry, err := models.ParseLogEntry(line, epicName); err == nil {
			entries = append(entries, *entry)
		}
	}

	return entries
}

// GetWatchedEpics returns a list of currently watched epic names
func (ew *EpicWatcher) GetWatchedEpics() []string {
	ew.mu.RLock()
	defer ew.mu.RUnlock()

	var names []string
	for name := range ew.watchedEpics {
		names = append(names, name)
	}
	return names
}

// IsWatching returns true if the watcher is currently active
func (ew *EpicWatcher) IsWatching() bool {
	ew.mu.RLock()
	defer ew.mu.RUnlock()
	return !ew.stopped
}