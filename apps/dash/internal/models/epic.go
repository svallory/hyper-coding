package models

import (
	"encoding/json"
	"fmt"
	"time"
)

// Epic represents the complete workflow state for an epic
type Epic struct {
	Name           string             `json:"epic_name"`
	CurrentStep    int                `json:"current_step"`
	CompletedSteps []int              `json:"completed_steps"`
	WorkflowConfig WorkflowConfig     `json:"workflow_config"`
	TagName        *string            `json:"tag_name"`
	Artifacts      Artifacts          `json:"artifacts"`
	Agents         Agents             `json:"agents"`
	Execution      Execution          `json:"execution"`
	Timestamp      time.Time          `json:"timestamp"`
	LastUpdated    time.Time          `json:"last_updated"`
	Status         string             `json:"status,omitempty"`
	CompletedAt    *time.Time         `json:"completed_at,omitempty"`
	RetryState     *RetryState        `json:"retry_state,omitempty"`
	
	// Additional fields for dashboard display
	Path           string             `json:"-"` // Path to the epic directory
	Progress       float64            `json:"-"` // Calculated progress percentage
}

// WorkflowConfig represents the workflow configuration
type WorkflowConfig struct {
	NoStop       bool  `json:"no_stop"`
	MaxSubagents int   `json:"max_subagents"`
	UseResearch  *bool `json:"use_research"`
}

// Artifacts represents the artifacts created during the workflow
type Artifacts struct {
	OriginalDoc       *string `json:"original_doc,omitempty"`
	PRD              *string `json:"prd,omitempty"`
	TasksFile        *string `json:"tasks_file,omitempty"`
	ComplexityReport *string `json:"complexity_report,omitempty"`
}

// Agents represents the agent information
type Agents struct {
	Required  []string `json:"required"`
	Created   []string `json:"created"`
	Available []string `json:"available"`
}

// Execution represents the execution state
type Execution struct {
	TasksInProgress       []interface{} `json:"tasks_in_progress"`
	TasksCompleted        []interface{} `json:"tasks_completed"`
	ParallelAgentsActive  int           `json:"parallel_agents_active"`
	LastTaskCompletion    *time.Time    `json:"last_task_completion"`
}

// RetryState represents retry information for failed operations
type RetryState struct {
	Step      int       `json:"step"`
	Attempt   int       `json:"attempt"`
	LastError string    `json:"last_error"`
	Timestamp time.Time `json:"timestamp"`
}

// LoadEpic loads an epic from a workflow-state.json file
func LoadEpic(data []byte, epicPath string) (*Epic, error) {
	var epic Epic
	if err := json.Unmarshal(data, &epic); err != nil {
		return nil, err
	}
	
	epic.Path = epicPath
	epic.calculateProgress()
	
	return &epic, nil
}

// calculateProgress calculates the progress percentage based on completed vs total steps
func (e *Epic) calculateProgress() {
	if e.CurrentStep == 0 {
		e.Progress = 0
		return
	}
	
	// For workflow progress, we consider steps completed out of assumed total workflow steps
	// This could be made configurable based on workflow type
	totalSteps := 10 // Default workflow steps
	if len(e.CompletedSteps) == 0 {
		e.Progress = 0
		return
	}
	
	e.Progress = float64(len(e.CompletedSteps)) / float64(totalSteps) * 100
	if e.Progress > 100 {
		e.Progress = 100
	}
}

// GetStatusColor returns a color code for the epic status
func (e *Epic) GetStatusColor() string {
	switch e.Status {
	case "completed":
		return "green"
	case "failed", "error":
		return "red"
	case "in_progress", "running":
		return "yellow"
	case "pending":
		return "blue"
	default:
		return "gray"
	}
}

// GetProgressBar returns a visual progress bar representation
func (e *Epic) GetProgressBar(width int) string {
	if width <= 0 {
		return ""
	}
	
	filled := int(e.Progress / 100 * float64(width))
	if filled > width {
		filled = width
	}
	
	bar := ""
	for i := 0; i < width; i++ {
		if i < filled {
			bar += "█"
		} else {
			bar += "░"
		}
	}
	
	return bar
}

// IsActive returns true if the epic has active agents or tasks
func (e *Epic) IsActive() bool {
	return e.Execution.ParallelAgentsActive > 0 || len(e.Execution.TasksInProgress) > 0
}

// GetTotalTasks returns the total number of tasks (completed + in progress)
func (e *Epic) GetTotalTasks() int {
	return len(e.Execution.TasksCompleted) + len(e.Execution.TasksInProgress)
}

// GetAgentSummary returns a summary of agent status
func (e *Epic) GetAgentSummary() string {
	if e.Execution.ParallelAgentsActive == 0 {
		return "No active agents"
	}
	return fmt.Sprintf("%d active", e.Execution.ParallelAgentsActive)
}

// TimeSinceLastUpdate returns the duration since the last update
func (e *Epic) TimeSinceLastUpdate() time.Duration {
	return time.Since(e.LastUpdated)
}

