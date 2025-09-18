package taskmaster

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Integration manages TaskMaster integration with HyperDash
type Integration struct {
	client       *Client
	epicDir      string
	ctx          context.Context
	cancel       context.CancelFunc
	mu           sync.RWMutex
	lastError    string
	isRunning    bool
	subscribers  []chan TaskUpdate
	
	// Real-time update settings
	updateInterval time.Duration
	maxRetries     int
	retryDelay     time.Duration
}

// TaskUpdate represents a real-time task update
type TaskUpdate struct {
	Type      UpdateType  `json:"type"`
	Task      *Task       `json:"task,omitempty"`
	Agent     *Agent      `json:"agent,omitempty"`
	Status    SystemStatus `json:"status,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// UpdateType represents the type of update
type UpdateType string

const (
	UpdateTypeTaskCreated   UpdateType = "task_created"
	UpdateTypeTaskUpdated   UpdateType = "task_updated"
	UpdateTypeTaskCompleted UpdateType = "task_completed"
	UpdateTypeAgentStatusChanged UpdateType = "agent_status_changed"
	UpdateTypeSystemStatus  UpdateType = "system_status"
	UpdateTypeError         UpdateType = "error"
)

// IntegrationConfig configures the TaskMaster integration
type IntegrationConfig struct {
	EpicDir        string        // Root directory for epic scanning
	UpdateInterval time.Duration // How often to check for updates
	MaxRetries     int           // Maximum retries for failed operations
	RetryDelay     time.Duration // Delay between retries
	ClientConfig   ClientConfig  // TaskMaster client configuration
}

// NewIntegration creates a new TaskMaster integration
func NewIntegration(config IntegrationConfig) *Integration {
	if config.UpdateInterval == 0 {
		config.UpdateInterval = 5 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.RetryDelay == 0 {
		config.RetryDelay = 2 * time.Second
	}
	
	// Set working directory for client
	if config.ClientConfig.WorkingDir == "" {
		config.ClientConfig.WorkingDir = config.EpicDir
	}
	
	client := NewClient(config.ClientConfig)
	ctx, cancel := context.WithCancel(context.Background())
	
	integration := &Integration{
		client:         client,
		epicDir:        config.EpicDir,
		ctx:            ctx,
		cancel:         cancel,
		updateInterval: config.UpdateInterval,
		maxRetries:     config.MaxRetries,
		retryDelay:     config.RetryDelay,
		subscribers:    make([]chan TaskUpdate, 0),
	}
	
	return integration
}

// Start begins the TaskMaster integration
func (i *Integration) Start() error {
	i.mu.Lock()
	defer i.mu.Unlock()
	
	if i.isRunning {
		return fmt.Errorf("integration already running")
	}
	
	if !i.client.IsAvailable() {
		return fmt.Errorf("TaskMaster CLI not available")
	}
	
	i.isRunning = true
	
	// Start background sync
	go i.client.StartAutoSync(i.ctx)
	
	// Start real-time monitoring
	go i.startRealTimeMonitoring()
	
	return nil
}

// Stop stops the TaskMaster integration
func (i *Integration) Stop() {
	i.mu.Lock()
	defer i.mu.Unlock()
	
	if !i.isRunning {
		return
	}
	
	i.cancel()
	i.isRunning = false
	
	// Close all subscriber channels
	for _, ch := range i.subscribers {
		close(ch)
	}
	i.subscribers = nil
}

// IsAvailable returns true if TaskMaster is available
func (i *Integration) IsAvailable() bool {
	return i.client.IsAvailable()
}

// GetSystemStatus returns the current system status
func (i *Integration) GetSystemStatus() SystemStatus {
	return i.client.GetSystemStatus()
}

// GetTasks retrieves all tasks from the current epic
func (i *Integration) GetTasks() ([]Task, error) {
	return i.client.GetTasks()
}

// GetTasksForEpic retrieves tasks for a specific epic directory
func (i *Integration) GetTasksForEpic(epicName string) ([]Task, error) {
	epicPath := filepath.Join(i.epicDir, epicName)
	return i.client.GetTasksInDirectory(epicPath)
}

// GetTask retrieves a specific task by ID
func (i *Integration) GetTask(id int) (*Task, error) {
	return i.client.GetTask(id)
}

// GetAgents retrieves all agents
func (i *Integration) GetAgents() ([]Agent, error) {
	return i.client.GetAgents()
}

// GetProjects retrieves all projects/tags
func (i *Integration) GetProjects() ([]Project, error) {
	return i.client.GetProjects()
}

// SetTaskStatus updates a task's status
func (i *Integration) SetTaskStatus(id int, status TaskStatus) error {
	err := i.client.SetTaskStatus(id, status)
	if err != nil {
		return err
	}
	
	// Notify subscribers of task update
	i.notifySubscribers(TaskUpdate{
		Type:      UpdateTypeTaskUpdated,
		Timestamp: time.Now(),
	})
	
	return nil
}

// CreateTask creates a new task
func (i *Integration) CreateTask(task Task) (*Task, error) {
	createdTask, err := i.client.CreateTask(task)
	if err != nil {
		return nil, err
	}
	
	// Notify subscribers of task creation
	i.notifySubscribers(TaskUpdate{
		Type:      UpdateTypeTaskCreated,
		Task:      createdTask,
		Timestamp: time.Now(),
	})
	
	return createdTask, nil
}

// SwitchTag switches to a different TaskMaster tag
func (i *Integration) SwitchTag(tagName string) error {
	err := i.client.SwitchTag(tagName)
	if err != nil {
		return err
	}
	
	// Notify subscribers of system status change
	i.notifySubscribers(TaskUpdate{
		Type:      UpdateTypeSystemStatus,
		Status:    i.client.GetSystemStatus(),
		Timestamp: time.Now(),
	})
	
	return nil
}

// Sync performs manual synchronization
func (i *Integration) Sync() error {
	return i.client.Sync()
}

// Subscribe returns a channel for receiving real-time updates
func (i *Integration) Subscribe() <-chan TaskUpdate {
	i.mu.Lock()
	defer i.mu.Unlock()
	
	ch := make(chan TaskUpdate, 100) // Buffered channel
	i.subscribers = append(i.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscriber channel
func (i *Integration) Unsubscribe(ch <-chan TaskUpdate) {
	i.mu.Lock()
	defer i.mu.Unlock()
	
	for idx, subscriber := range i.subscribers {
		if subscriber == ch {
			// Remove from slice
			i.subscribers = append(i.subscribers[:idx], i.subscribers[idx+1:]...)
			close(subscriber)
			break
		}
	}
}

// GetTasksFormatted returns tasks formatted for display
func (i *Integration) GetTasksFormatted() (string, error) {
	tasks, err := i.GetTasks()
	if err != nil {
		return "", err
	}
	
	if len(tasks) == 0 {
		return "No tasks found in current epic.", nil
	}
	
	var builder strings.Builder
	builder.WriteString("📋 TaskMaster Tasks\n\n")
	
	// Group tasks by status
	pending := make([]Task, 0)
	inProgress := make([]Task, 0)
	completed := make([]Task, 0)
	blocked := make([]Task, 0)
	
	for _, task := range tasks {
		switch task.Status {
		case StatusPending:
			pending = append(pending, task)
		case StatusInProgress:
			inProgress = append(inProgress, task)
		case StatusDone:
			completed = append(completed, task)
		case StatusBlocked:
			blocked = append(blocked, task)
		}
	}
	
	// Format each group
	if len(inProgress) > 0 {
		builder.WriteString("🔄 In Progress:\n")
		for _, task := range inProgress {
			builder.WriteString(fmt.Sprintf("  %s #%d %s %s\n", 
				task.GetStatusSymbol(), task.ID, task.GetPrioritySymbol(), task.Title))
		}
		builder.WriteString("\n")
	}
	
	if len(pending) > 0 {
		builder.WriteString("⏳ Pending:\n")
		for _, task := range pending {
			deps := ""
			if len(task.Dependencies) > 0 {
				deps = fmt.Sprintf(" (deps: %v)", task.Dependencies)
			}
			builder.WriteString(fmt.Sprintf("  %s #%d %s %s%s\n", 
				task.GetStatusSymbol(), task.ID, task.GetPrioritySymbol(), task.Title, deps))
		}
		builder.WriteString("\n")
	}
	
	if len(blocked) > 0 {
		builder.WriteString("🚫 Blocked:\n")
		for _, task := range blocked {
			builder.WriteString(fmt.Sprintf("  %s #%d %s %s\n", 
				task.GetStatusSymbol(), task.ID, task.GetPrioritySymbol(), task.Title))
		}
		builder.WriteString("\n")
	}
	
	if len(completed) > 0 {
		builder.WriteString("✅ Completed:\n")
		for _, task := range completed {
			builder.WriteString(fmt.Sprintf("  %s #%d %s %s\n", 
				task.GetStatusSymbol(), task.ID, task.GetPrioritySymbol(), task.Title))
		}
		builder.WriteString("\n")
	}
	
	// Add summary
	summary := i.client.GetSystemStatus().Tasks
	builder.WriteString(fmt.Sprintf("📊 Summary: %d total, %d completed, %d in progress, %d pending\n",
		summary.Total, summary.Completed, summary.InProgress, summary.Pending))
	
	return builder.String(), nil
}

// GetAgentsFormatted returns agents formatted for display
func (i *Integration) GetAgentsFormatted() (string, error) {
	agents, err := i.GetAgents()
	if err != nil {
		return "", err
	}
	
	if len(agents) == 0 {
		return "No agents available.", nil
	}
	
	var builder strings.Builder
	builder.WriteString("🤖 TaskMaster Agents\n\n")
	
	for _, agent := range agents {
		status := agent.GetAgentStatusSymbol()
		efficiency := agent.GetEfficiencyRating()
		
		builder.WriteString(fmt.Sprintf("%s %s (%s)\n", status, agent.Name, agent.Type))
		builder.WriteString(fmt.Sprintf("  Status: %s | Efficiency: %s\n", agent.Status, efficiency))
		builder.WriteString(fmt.Sprintf("  Tasks: %d completed, %d failed\n", 
			agent.Performance.TasksCompleted, agent.Performance.TasksFailed))
		
		if agent.CurrentTask != nil {
			builder.WriteString(fmt.Sprintf("  Current Task: #%d\n", *agent.CurrentTask))
		}
		
		builder.WriteString(fmt.Sprintf("  Last Active: %s\n", 
			formatDuration(agent.TimeSinceLastActive())))
		builder.WriteString("\n")
	}
	
	// Add summary
	summary := i.client.GetSystemStatus().Agents
	builder.WriteString(fmt.Sprintf("📊 Summary: %d total agents, %d active, %d idle, %d busy\n",
		summary.Total, summary.Active, summary.Idle, summary.Busy))
	
	return builder.String(), nil
}

// startRealTimeMonitoring monitors for changes and notifies subscribers
func (i *Integration) startRealTimeMonitoring() {
	ticker := time.NewTicker(i.updateInterval)
	defer ticker.Stop()
	
	var lastTaskUpdate time.Time
	var lastAgentUpdate time.Time
	
	for {
		select {
		case <-i.ctx.Done():
			return
		case <-ticker.C:
			// Check for task updates
			if tasks, err := i.GetTasks(); err == nil {
				for _, task := range tasks {
					if task.UpdatedAt.After(lastTaskUpdate) {
						i.notifySubscribers(TaskUpdate{
							Type:      UpdateTypeTaskUpdated,
							Task:      &task,
							Timestamp: time.Now(),
						})
						if task.Status == StatusDone && task.UpdatedAt.After(lastTaskUpdate) {
							i.notifySubscribers(TaskUpdate{
								Type:      UpdateTypeTaskCompleted,
								Task:      &task,
								Timestamp: time.Now(),
							})
						}
					}
				}
				lastTaskUpdate = time.Now()
			}
			
			// Check for agent updates
			if agents, err := i.GetAgents(); err == nil {
				for _, agent := range agents {
					if agent.LastActive.After(lastAgentUpdate) {
						i.notifySubscribers(TaskUpdate{
							Type:      UpdateTypeAgentStatusChanged,
							Agent:     &agent,
							Timestamp: time.Now(),
						})
					}
				}
				lastAgentUpdate = time.Now()
			}
			
			// Send system status update
			i.notifySubscribers(TaskUpdate{
				Type:      UpdateTypeSystemStatus,
				Status:    i.GetSystemStatus(),
				Timestamp: time.Now(),
			})
		}
	}
}

// notifySubscribers sends updates to all subscribers
func (i *Integration) notifySubscribers(update TaskUpdate) {
	i.mu.RLock()
	defer i.mu.RUnlock()
	
	for _, ch := range i.subscribers {
		select {
		case ch <- update:
		default:
			// Channel full, skip this update
		}
	}
}

// GetLastError returns the last error that occurred
func (i *Integration) GetLastError() string {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.lastError
}

// setLastError sets the last error
func (i *Integration) setLastError(err string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.lastError = err
}

// formatDuration formats a duration in a human-readable way
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return "just now"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	return fmt.Sprintf("%dd ago", int(d.Hours()/24))
}

// HealthCheck performs a health check on the integration
func (i *Integration) HealthCheck() error {
	if !i.IsAvailable() {
		return fmt.Errorf("TaskMaster CLI not available")
	}
	
	// Try to fetch system status
	status := i.GetSystemStatus()
	if len(status.Errors) > 0 {
		return fmt.Errorf("TaskMaster has errors: %v", status.Errors)
	}
	
	return nil
}

// GetStatistics returns comprehensive statistics
func (i *Integration) GetStatistics() (map[string]interface{}, error) {
	status := i.GetSystemStatus()
	
	stats := map[string]interface{}{
		"system_available":    status.Available,
		"version":            status.Version,
		"current_tag":        status.CurrentTag,
		"last_sync":          status.LastSync,
		"total_tasks":        status.Tasks.Total,
		"completed_tasks":    status.Tasks.Completed,
		"in_progress_tasks":  status.Tasks.InProgress,
		"pending_tasks":      status.Tasks.Pending,
		"blocked_tasks":      status.Tasks.Blocked,
		"total_agents":       status.Agents.Total,
		"active_agents":      status.Agents.Active,
		"idle_agents":        status.Agents.Idle,
		"busy_agents":        status.Agents.Busy,
		"offline_agents":     status.Agents.Offline,
		"error_count":        len(status.Errors),
		"integration_running": i.isRunning,
	}
	
	return stats, nil
}