package models

import (
	"testing"
	"time"
)

func TestLoadEpic(t *testing.T) {
	// Sample workflow state JSON
	jsonData := `{
		"epic_name": "test-epic",
		"current_step": 3,
		"completed_steps": [1, 2],
		"workflow_config": {
			"no_stop": false,
			"max_subagents": 5,
			"use_research": null
		},
		"tag_name": null,
		"artifacts": {
			"original_doc": "spec.md",
			"prd": "prd.md"
		},
		"agents": {
			"required": ["task-executor", "reviewer"],
			"created": ["task-executor"],
			"available": []
		},
		"execution": {
			"tasks_in_progress": ["task-3.1", "task-3.2"],
			"tasks_completed": ["task-1.1", "task-2.1", "task-2.2"],
			"parallel_agents_active": 2,
			"last_task_completion": "2025-01-16T14:45:30Z"
		},
		"timestamp": "2025-01-16T14:30:00Z",
		"last_updated": "2025-01-16T14:46:00Z",
		"status": "running"
	}`

	epic, err := LoadEpic([]byte(jsonData), "/test/path")
	if err != nil {
		t.Fatalf("Failed to load epic: %v", err)
	}

	// Test basic fields
	if epic.Name != "test-epic" {
		t.Errorf("Expected name 'test-epic', got '%s'", epic.Name)
	}

	if epic.CurrentStep != 3 {
		t.Errorf("Expected current step 3, got %d", epic.CurrentStep)
	}

	if len(epic.CompletedSteps) != 2 {
		t.Errorf("Expected 2 completed steps, got %d", len(epic.CompletedSteps))
	}

	if epic.Path != "/test/path" {
		t.Errorf("Expected path '/test/path', got '%s'", epic.Path)
	}

	// Test progress calculation
	if epic.Progress != 20.0 { // 2 completed out of 10 default steps = 20%
		t.Errorf("Expected progress 20.0, got %f", epic.Progress)
	}

	// Test agent and task counts
	if epic.Execution.ParallelAgentsActive != 2 {
		t.Errorf("Expected 2 active agents, got %d", epic.Execution.ParallelAgentsActive)
	}

	if len(epic.Execution.TasksCompleted) != 3 {
		t.Errorf("Expected 3 completed tasks, got %d", len(epic.Execution.TasksCompleted))
	}

	if len(epic.Execution.TasksInProgress) != 2 {
		t.Errorf("Expected 2 in-progress tasks, got %d", len(epic.Execution.TasksInProgress))
	}
}

func TestEpicHelperMethods(t *testing.T) {
	epic := &Epic{
		Name:           "test-epic",
		Status:         "running",
		CompletedSteps: []int{1, 2},
		Execution: Execution{
			ParallelAgentsActive: 3,
			TasksCompleted:       []interface{}{"task-1", "task-2"},
			TasksInProgress:      []interface{}{"task-3", "task-4"},
		},
		LastUpdated: time.Now().Add(-5 * time.Minute),
	}

	epic.calculateProgress()

	// Test IsActive
	if !epic.IsActive() {
		t.Error("Epic should be active with 3 parallel agents")
	}

	// Test GetTotalTasks
	totalTasks := epic.GetTotalTasks()
	if totalTasks != 4 {
		t.Errorf("Expected 4 total tasks, got %d", totalTasks)
	}

	// Test GetAgentSummary
	summary := epic.GetAgentSummary()
	if summary != "3 active" {
		t.Errorf("Expected '3 active', got '%s'", summary)
	}

	// Test GetProgressBar
	progressBar := epic.GetProgressBar(10)
	runes := []rune(progressBar)
	if len(runes) != 10 {
		t.Errorf("Expected progress bar rune length 10, got %d. Content: '%s'", len(runes), progressBar)
	}
	
	// Verify it contains only progress characters
	for _, char := range runes {
		if char != '█' && char != '░' {
			t.Errorf("Progress bar contains unexpected character: %c", char)
		}
	}

	// Test TimeSinceLastUpdate
	duration := epic.TimeSinceLastUpdate()
	if duration < 4*time.Minute || duration > 6*time.Minute {
		t.Errorf("Expected duration around 5 minutes, got %v", duration)
	}
}

func TestEpicStatusColor(t *testing.T) {
	testCases := []struct {
		status   string
		expected string
	}{
		{"completed", "green"},
		{"failed", "red"},
		{"error", "red"},
		{"running", "yellow"},
		{"in_progress", "yellow"},
		{"pending", "blue"},
		{"unknown", "gray"},
	}

	for _, tc := range testCases {
		epic := &Epic{Status: tc.status}
		color := epic.GetStatusColor()
		if color != tc.expected {
			t.Errorf("For status '%s', expected color '%s', got '%s'", tc.status, tc.expected, color)
		}
	}
}