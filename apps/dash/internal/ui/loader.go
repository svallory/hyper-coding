package ui

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
)

// loadExistingData loads epic data from the file system
func loadExistingData(epicDir string) ([]models.Epic, []models.LogEntry) {
	var epics []models.Epic
	var logs []models.LogEntry

	// Check if epic directory exists
	if _, err := os.Stat(epicDir); os.IsNotExist(err) {
		return epics, logs
	}

	// Walk the epic directory to find all epics
	err := filepath.WalkDir(epicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Look for epic directories (containing workflow-state.json)
		if d.IsDir() && path != epicDir {
			workflowFile := filepath.Join(path, "workflow-state.json")
			logFile := filepath.Join(path, "workflow.log")

			// Try to load the epic
			if epic := loadEpicFromFile(workflowFile, path); epic != nil {
				epics = append(epics, *epic)
			}

			// Try to load logs
			if epicLogs := loadLogsFromFile(logFile, filepath.Base(path)); len(epicLogs) > 0 {
				logs = append(logs, epicLogs...)
			}
		}

		return nil
	})

	if err != nil {
		fmt.Printf("Error walking epic directory: %v\n", err)
	}

	return epics, logs
}

// loadEpicFromFile loads a single epic from a workflow-state.json file
func loadEpicFromFile(filePath, epicPath string) *models.Epic {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Printf("Error reading epic file %s: %v\n", filePath, err)
		return nil
	}

	epic, err := models.LoadEpic(data, epicPath)
	if err != nil {
		fmt.Printf("Error parsing epic file %s: %v\n", filePath, err)
		return nil
	}

	return epic
}

// loadLogsFromFile loads recent log entries from a workflow.log file
func loadLogsFromFile(filePath, epicName string) []models.LogEntry {
	var entries []models.LogEntry

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return entries
	}

	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("Error opening log file %s: %v\n", filePath, err)
		return entries
	}
	defer file.Close()

	// Read all lines
	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}

	// Keep only the last 50 lines to avoid memory issues
	start := 0
	if len(lines) > 50 {
		start = len(lines) - 50
	}

	// Parse log entries
	for i := start; i < len(lines); i++ {
		if entry, err := models.ParseLogEntry(lines[i], epicName); err == nil {
			entries = append(entries, *entry)
		}
	}

	return entries
}

// LoadExistingDataForTest exports the loadExistingData function for testing
func LoadExistingDataForTest(epicDir string) ([]models.Epic, []models.LogEntry) {
	return loadExistingData(epicDir)
}