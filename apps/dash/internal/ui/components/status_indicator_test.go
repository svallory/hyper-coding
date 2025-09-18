package components

import (
	"strings"
	"testing"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
)

func TestStatusIndicator_TaskStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   taskmaster.TaskStatus
		expected string
	}{
		{
			name:     "Done status",
			status:   taskmaster.StatusDone,
			expected: CharSuccess,
		},
		{
			name:     "In Progress status",
			status:   taskmaster.StatusInProgress,
			expected: CharActive,
		},
		{
			name:     "Pending status",
			status:   taskmaster.StatusPending,
			expected: CharPending,
		},
		{
			name:     "Blocked status",
			status:   taskmaster.StatusBlocked,
			expected: CharBlocked,
		},
		{
			name:     "Deferred status",
			status:   taskmaster.StatusDeferred,
			expected: CharIdle,
		},
		{
			name:     "Cancelled status",
			status:   taskmaster.StatusCancelled,
			expected: CharError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			indicator := NewStatusIndicator(StatusIndicatorConfig{
				Type:  StatusTypeTask,
				Value: string(tt.status),
			})
			
			view := indicator.View()
			if !strings.Contains(view, tt.expected) {
				t.Errorf("Expected view to contain %s, got %s", tt.expected, view)
			}
		})
	}
}

func TestStatusIndicator_AgentStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   taskmaster.AgentStatus
		expected string
	}{
		{
			name:     "Active status",
			status:   taskmaster.AgentStatusActive,
			expected: CharActive,
		},
		{
			name:     "Busy status",
			status:   taskmaster.AgentStatusBusy,
			expected: CharProgress,
		},
		{
			name:     "Idle status",
			status:   taskmaster.AgentStatusIdle,
			expected: CharIdle,
		},
		{
			name:     "Error status",
			status:   taskmaster.AgentStatusError,
			expected: CharError,
		},
		{
			name:     "Offline status",
			status:   taskmaster.AgentStatusOffline,
			expected: CharEmpty,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			indicator := NewStatusIndicator(StatusIndicatorConfig{
				Type:  StatusTypeAgent,
				Value: string(tt.status),
			})
			
			view := indicator.View()
			if !strings.Contains(view, tt.expected) {
				t.Errorf("Expected view to contain %s, got %s", tt.expected, view)
			}
		})
	}
}

func TestStatusIndicator_Priority(t *testing.T) {
	tests := []struct {
		name     string
		priority taskmaster.TaskPriority
		expected string
	}{
		{
			name:     "Critical priority",
			priority: taskmaster.PriorityCritical,
			expected: CharPriority,
		},
		{
			name:     "High priority",
			priority: taskmaster.PriorityHigh,
			expected: CharWarning,
		},
		{
			name:     "Medium priority",
			priority: taskmaster.PriorityMedium,
			expected: CharActive,
		},
		{
			name:     "Low priority",
			priority: taskmaster.PriorityLow,
			expected: CharEmpty,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			indicator := NewStatusIndicator(StatusIndicatorConfig{
				Type:  StatusTypePriority,
				Value: string(tt.priority),
			})
			
			view := indicator.View()
			if !strings.Contains(view, tt.expected) {
				t.Errorf("Expected view to contain %s, got %s", tt.expected, view)
			}
		})
	}
}

func TestStatusIndicator_SystemStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   string
		expected string
	}{
		{
			name:     "Online status",
			status:   "online",
			expected: CharSuccess,
		},
		{
			name:     "Connected status",
			status:   "connected",
			expected: CharSuccess,
		},
		{
			name:     "Offline status",
			status:   "offline",
			expected: CharEmpty,
		},
		{
			name:     "Error status",
			status:   "error",
			expected: CharError,
		},
		{
			name:     "Warning status",
			status:   "warning",
			expected: CharWarning,
		},
		{
			name:     "Processing status",
			status:   "processing",
			expected: CharProgress,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			indicator := NewStatusIndicator(StatusIndicatorConfig{
				Type:  StatusTypeSystem,
				Value: tt.status,
			})
			
			view := indicator.View()
			if !strings.Contains(view, tt.expected) {
				t.Errorf("Expected view to contain %s, got %s", tt.expected, view)
			}
		})
	}
}

func TestStatusIndicator_WithLabel(t *testing.T) {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:      StatusTypeTask,
		Value:     string(taskmaster.StatusDone),
		Label:     "Completed",
		ShowLabel: true,
	})
	
	view := indicator.View()
	
	// Check for both the character and the label
	if !strings.Contains(view, CharSuccess) {
		t.Errorf("Expected view to contain success character %s", CharSuccess)
	}
	
	if !strings.Contains(view, "Completed") {
		t.Error("Expected view to contain label 'Completed'")
	}
}

func TestStatusIndicator_Width(t *testing.T) {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:  StatusTypeTask,
		Value: string(taskmaster.StatusDone),
		Width: 20,
	})
	
	view := indicator.View()
	
	// The view should contain the character
	if !strings.Contains(view, CharSuccess) {
		t.Errorf("Expected view to contain success character %s", CharSuccess)
	}
}

func TestStatusIndicator_GenericStatus(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected string
	}{
		{
			name:     "Success generic",
			value:    "success",
			expected: CharSuccess,
		},
		{
			name:     "Complete generic",
			value:    "complete",
			expected: CharSuccess,
		},
		{
			name:     "Pending generic",
			value:    "pending",
			expected: CharPending,
		},
		{
			name:     "Loading generic",
			value:    "loading",
			expected: CharPending,
		},
		{
			name:     "Error generic",
			value:    "error",
			expected: CharError,
		},
		{
			name:     "Failed generic",
			value:    "failed",
			expected: CharError,
		},
		{
			name:     "Warning generic",
			value:    "warning",
			expected: CharWarning,
		},
		{
			name:     "Active generic",
			value:    "active",
			expected: CharActive,
		},
		{
			name:     "Running generic",
			value:    "running",
			expected: CharActive,
		},
		{
			name:     "Blocked generic",
			value:    "blocked",
			expected: CharBlocked,
		},
		{
			name:     "Idle generic",
			value:    "idle",
			expected: CharIdle,
		},
		{
			name:     "Empty generic",
			value:    "empty",
			expected: CharEmpty,
		},
		{
			name:     "Unknown generic",
			value:    "unknown",
			expected: CharEmpty,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			indicator := NewStatusIndicator(StatusIndicatorConfig{
				Type:  StatusTypeGeneric,
				Value: tt.value,
			})
			
			view := indicator.View()
			if !strings.Contains(view, tt.expected) {
				t.Errorf("Expected view to contain %s, got %s", tt.expected, view)
			}
		})
	}
}

func TestRenderHelpers(t *testing.T) {
	t.Run("RenderTaskStatus", func(t *testing.T) {
		result := RenderTaskStatus(taskmaster.StatusDone)
		if !strings.Contains(result, CharSuccess) {
			t.Errorf("Expected result to contain %s", CharSuccess)
		}
	})

	t.Run("RenderAgentStatus", func(t *testing.T) {
		result := RenderAgentStatus(taskmaster.AgentStatusActive)
		if !strings.Contains(result, CharActive) {
			t.Errorf("Expected result to contain %s", CharActive)
		}
	})

	t.Run("RenderPriority", func(t *testing.T) {
		result := RenderPriority(taskmaster.PriorityCritical)
		if !strings.Contains(result, CharPriority) {
			t.Errorf("Expected result to contain %s", CharPriority)
		}
	})

	t.Run("RenderGenericStatus", func(t *testing.T) {
		result := RenderGenericStatus("success", "Test")
		if !strings.Contains(result, CharSuccess) {
			t.Errorf("Expected result to contain %s", CharSuccess)
		}
		if !strings.Contains(result, "Test") {
			t.Error("Expected result to contain label 'Test'")
		}
	})

	t.Run("RenderStatusWithLabel", func(t *testing.T) {
		result := RenderStatusWithLabel(StatusTypeTask, string(taskmaster.StatusInProgress), "Working")
		if !strings.Contains(result, CharActive) {
			t.Errorf("Expected result to contain %s", CharActive)
		}
		if !strings.Contains(result, "Working") {
			t.Error("Expected result to contain label 'Working'")
		}
	})
}

func TestStatusRow(t *testing.T) {
	indicators := []*StatusIndicator{
		NewStatusIndicator(StatusIndicatorConfig{
			Type:  StatusTypeTask,
			Value: string(taskmaster.StatusDone),
		}),
		NewStatusIndicator(StatusIndicatorConfig{
			Type:  StatusTypeTask,
			Value: string(taskmaster.StatusInProgress),
		}),
		NewStatusIndicator(StatusIndicatorConfig{
			Type:  StatusTypeTask,
			Value: string(taskmaster.StatusPending),
		}),
	}

	row := NewStatusRow(indicators...)
	view := row.View()

	// Check that all expected characters are present
	if !strings.Contains(view, CharSuccess) {
		t.Errorf("Expected view to contain %s", CharSuccess)
	}
	if !strings.Contains(view, CharActive) {
		t.Errorf("Expected view to contain %s", CharActive)
	}
	if !strings.Contains(view, CharPending) {
		t.Errorf("Expected view to contain %s", CharPending)
	}

	// Test custom separator
	row.SetSeparator(" | ")
	view = row.View()
	if !strings.Contains(view, " | ") {
		t.Error("Expected view to contain custom separator ' | '")
	}
}

func TestStatusGrid(t *testing.T) {
	grid := NewStatusGrid(50)

	row1 := NewStatusRow(
		NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusDone),
			Label:     "5",
			ShowLabel: true,
		}),
		NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusInProgress),
			Label:     "3",
			ShowLabel: true,
		}),
	)

	row2 := NewStatusRow(
		NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusActive),
			Label:     "2",
			ShowLabel: true,
		}),
		NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusIdle),
			Label:     "1",
			ShowLabel: true,
		}),
	)

	grid.AddRow(row1).AddRow(row2)
	view := grid.View()

	// Check that the view contains multiple lines
	lines := strings.Split(view, "\n")
	if len(lines) != 2 {
		t.Errorf("Expected 2 lines in grid view, got %d", len(lines))
	}

	// Check that expected characters are present
	if !strings.Contains(view, CharSuccess) {
		t.Errorf("Expected view to contain %s", CharSuccess)
	}
	if !strings.Contains(view, CharActive) {
		t.Errorf("Expected view to contain %s for both task and agent", CharActive)
	}
}

func TestCreateTaskSummaryRow(t *testing.T) {
	tasks := []taskmaster.Task{
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusInProgress},
		{Status: taskmaster.StatusInProgress},
		{Status: taskmaster.StatusPending},
		{Status: taskmaster.StatusBlocked},
	}

	row := CreateTaskSummaryRow(tasks)
	view := row.View()

	// Check for status characters and counts
	if !strings.Contains(view, CharSuccess) {
		t.Errorf("Expected view to contain %s", CharSuccess)
	}
	if !strings.Contains(view, "3") { // 3 done tasks
		t.Error("Expected view to contain count '3' for done tasks")
	}
	if !strings.Contains(view, CharActive) {
		t.Errorf("Expected view to contain %s", CharActive)
	}
	if !strings.Contains(view, "2") { // 2 in progress tasks
		t.Error("Expected view to contain count '2' for in progress tasks")
	}
}

func TestCreateAgentSummaryRow(t *testing.T) {
	agents := []taskmaster.Agent{
		{Status: taskmaster.AgentStatusActive},
		{Status: taskmaster.AgentStatusActive},
		{Status: taskmaster.AgentStatusIdle},
		{Status: taskmaster.AgentStatusBusy},
		{Status: taskmaster.AgentStatusOffline},
	}

	row := CreateAgentSummaryRow(agents)
	view := row.View()

	// Check for status characters and counts
	if !strings.Contains(view, CharActive) {
		t.Errorf("Expected view to contain %s", CharActive)
	}
	if !strings.Contains(view, "2") { // 2 active agents
		t.Error("Expected view to contain count '2' for active agents")
	}
	if !strings.Contains(view, CharIdle) {
		t.Errorf("Expected view to contain %s", CharIdle)
	}
	if !strings.Contains(view, CharProgress) {
		t.Errorf("Expected view to contain %s for busy agent", CharProgress)
	}
	if !strings.Contains(view, CharEmpty) {
		t.Errorf("Expected view to contain %s for offline agent", CharEmpty)
	}
}