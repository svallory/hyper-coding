package taskmaster

import (
	"time"
)

// Task represents a TaskMaster task with all its properties
type Task struct {
	ID           int                `json:"id"`
	Title        string             `json:"title"`
	Description  string             `json:"description"`
	Status       TaskStatus         `json:"status"`
	Priority     TaskPriority       `json:"priority"`
	Complexity   int                `json:"complexity"`
	Dependencies []int              `json:"dependencies"`
	Subtasks     []Task             `json:"subtasks,omitempty"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
	CompletedAt  *time.Time         `json:"completed_at,omitempty"`
	Tags         []string           `json:"tags,omitempty"`
	Assignee     string             `json:"assignee,omitempty"`
	EstimatedHours float64          `json:"estimated_hours,omitempty"`
	ActualHours    float64          `json:"actual_hours,omitempty"`
	
	// Implementation details
	Implementation TaskImplementation `json:"implementation,omitempty"`
	TestStrategy   string             `json:"test_strategy,omitempty"`
	AcceptanceCriteria []string       `json:"acceptance_criteria,omitempty"`
}

// TaskStatus represents the possible states of a task
type TaskStatus string

const (
	StatusPending    TaskStatus = "pending"
	StatusInProgress TaskStatus = "in_progress"
	StatusDone       TaskStatus = "done"
	StatusBlocked    TaskStatus = "blocked"
	StatusDeferred   TaskStatus = "deferred"
	StatusCancelled  TaskStatus = "cancelled"
)

// TaskPriority represents the priority levels for tasks
type TaskPriority string

const (
	PriorityLow    TaskPriority = "low"
	PriorityMedium TaskPriority = "medium"
	PriorityHigh   TaskPriority = "high"
	PriorityCritical TaskPriority = "critical"
)

// TaskImplementation contains implementation-specific details
type TaskImplementation struct {
	Details     string   `json:"details,omitempty"`
	Files       []string `json:"files,omitempty"`
	Commands    []string `json:"commands,omitempty"`
	Environment string   `json:"environment,omitempty"`
}

// Agent represents a TaskMaster agent with its properties
type Agent struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Type         string      `json:"type"`
	Status       AgentStatus `json:"status"`
	CurrentTask  *int        `json:"current_task,omitempty"`
	Capabilities []string    `json:"capabilities"`
	CreatedAt    time.Time   `json:"created_at"`
	LastActive   time.Time   `json:"last_active"`
	Performance  AgentPerformance `json:"performance,omitempty"`
}

// AgentStatus represents the possible states of an agent
type AgentStatus string

const (
	AgentStatusIdle    AgentStatus = "idle"
	AgentStatusActive  AgentStatus = "active"
	AgentStatusBusy    AgentStatus = "busy"
	AgentStatusError   AgentStatus = "error"
	AgentStatusOffline AgentStatus = "offline"
)

// AgentPerformance tracks agent performance metrics
type AgentPerformance struct {
	TasksCompleted   int     `json:"tasks_completed"`
	TasksFailed      int     `json:"tasks_failed"`
	AverageTime      float64 `json:"average_time_hours"`
	SuccessRate      float64 `json:"success_rate"`
	LastTaskTime     float64 `json:"last_task_time_hours,omitempty"`
}

// Project represents a TaskMaster project/tag
type Project struct {
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	TaskCount    int       `json:"task_count"`
	Progress     float64   `json:"progress"`
	LastActivity time.Time `json:"last_activity"`
}

// TaskSummary provides a high-level overview of tasks
type TaskSummary struct {
	Total       int                    `json:"total"`
	ByStatus    map[TaskStatus]int     `json:"by_status"`
	ByPriority  map[TaskPriority]int   `json:"by_priority"`
	Completed   int                    `json:"completed"`
	InProgress  int                    `json:"in_progress"`
	Pending     int                    `json:"pending"`
	Blocked     int                    `json:"blocked"`
}

// AgentSummary provides a high-level overview of agents
type AgentSummary struct {
	Total      int                   `json:"total"`
	ByStatus   map[AgentStatus]int   `json:"by_status"`
	Active     int                   `json:"active"`
	Idle       int                   `json:"idle"`
	Busy       int                   `json:"busy"`
	Offline    int                   `json:"offline"`
}

// SystemStatus represents the overall TaskMaster system status
type SystemStatus struct {
	Available    bool          `json:"available"`
	Version      string        `json:"version,omitempty"`
	CurrentTag   string        `json:"current_tag,omitempty"`
	Tasks        TaskSummary   `json:"tasks"`
	Agents       AgentSummary  `json:"agents"`
	LastSync     time.Time     `json:"last_sync"`
	SyncInterval time.Duration `json:"sync_interval"`
	Errors       []string      `json:"errors,omitempty"`
}

// TaskListResponse represents the response from task-master list command
type TaskListResponse struct {
	Tasks    []Task    `json:"tasks"`
	Summary  TaskSummary `json:"summary"`
	Project  Project   `json:"project"`
}

// GetStatusColor returns a color code for the task status
func (t *Task) GetStatusColor() string {
	switch t.Status {
	case StatusDone:
		return "green"
	case StatusInProgress:
		return "yellow"
	case StatusBlocked:
		return "red"
	case StatusDeferred:
		return "orange"
	case StatusCancelled:
		return "gray"
	case StatusPending:
		return "blue"
	default:
		return "gray"
	}
}

// GetPrioritySymbol returns a symbol representation for task priority
func (t *Task) GetPrioritySymbol() string {
	switch t.Priority {
	case PriorityCritical:
		return "🔥"
	case PriorityHigh:
		return "⚡"
	case PriorityMedium:
		return "📋"
	case PriorityLow:
		return "📝"
	default:
		return "•"
	}
}

// GetStatusSymbol returns a symbol representation for task status
func (t *Task) GetStatusSymbol() string {
	switch t.Status {
	case StatusDone:
		return "✅"
	case StatusInProgress:
		return "🔄"
	case StatusBlocked:
		return "🚫"
	case StatusDeferred:
		return "⏸️"
	case StatusCancelled:
		return "❌"
	case StatusPending:
		return "⏳"
	default:
		return "○"
	}
}

// IsBlocked returns true if the task has unresolved dependencies
func (t *Task) IsBlocked(allTasks []Task) bool {
	if len(t.Dependencies) == 0 {
		return false
	}
	
	for _, depID := range t.Dependencies {
		for _, task := range allTasks {
			if task.ID == depID && task.Status != StatusDone {
				return true
			}
		}
	}
	return false
}

// CanStart returns true if all dependencies are completed
func (t *Task) CanStart(allTasks []Task) bool {
	if t.Status != StatusPending {
		return false
	}
	return !t.IsBlocked(allTasks)
}

// GetDependencyStatus returns a summary of dependency completion
func (t *Task) GetDependencyStatus(allTasks []Task) (completed, total int) {
	total = len(t.Dependencies)
	if total == 0 {
		return 0, 0
	}
	
	for _, depID := range t.Dependencies {
		for _, task := range allTasks {
			if task.ID == depID && task.Status == StatusDone {
				completed++
				break
			}
		}
	}
	return completed, total
}

// GetComplexityLevel returns a human-readable complexity level
func (t *Task) GetComplexityLevel() string {
	switch {
	case t.Complexity <= 2:
		return "Simple"
	case t.Complexity <= 4:
		return "Easy"
	case t.Complexity <= 6:
		return "Medium"
	case t.Complexity <= 8:
		return "Hard"
	default:
		return "Expert"
	}
}

// EstimatedDuration returns estimated time based on complexity
func (t *Task) EstimatedDuration() time.Duration {
	if t.EstimatedHours > 0 {
		return time.Duration(t.EstimatedHours * float64(time.Hour))
	}
	
	// Fallback estimation based on complexity
	hours := float64(t.Complexity) * 0.5 // 30 minutes per complexity point
	return time.Duration(hours * float64(time.Hour))
}

// GetAgentStatusColor returns a color code for the agent status
func (a *Agent) GetAgentStatusColor() string {
	switch a.Status {
	case AgentStatusActive, AgentStatusBusy:
		return "green"
	case AgentStatusIdle:
		return "yellow"
	case AgentStatusError:
		return "red"
	case AgentStatusOffline:
		return "gray"
	default:
		return "blue"
	}
}

// GetAgentStatusSymbol returns a symbol representation for agent status
func (a *Agent) GetAgentStatusSymbol() string {
	switch a.Status {
	case AgentStatusActive:
		return "🟢"
	case AgentStatusBusy:
		return "🔄"
	case AgentStatusIdle:
		return "🟡"
	case AgentStatusError:
		return "🔴"
	case AgentStatusOffline:
		return "⚫"
	default:
		return "🔵"
	}
}

// GetEfficiencyRating returns a qualitative efficiency rating
func (a *Agent) GetEfficiencyRating() string {
	rate := a.Performance.SuccessRate
	switch {
	case rate >= 0.95:
		return "Excellent"
	case rate >= 0.85:
		return "Good"
	case rate >= 0.70:
		return "Average"
	case rate >= 0.50:
		return "Below Average"
	default:
		return "Poor"
	}
}

// TimeSinceLastActive returns duration since agent was last active
func (a *Agent) TimeSinceLastActive() time.Duration {
	return time.Since(a.LastActive)
}