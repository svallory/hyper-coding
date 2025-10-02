package taskmaster

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Client wraps TaskMaster CLI interactions
type Client struct {
	command      string
	workingDir   string
	timeout      time.Duration
	cache        *Cache
	mu           sync.RWMutex
	lastSync     time.Time
	syncInterval time.Duration
	available    bool
	version      string
	currentTag   string
	errors       []string
}

// Cache stores frequently accessed data
type Cache struct {
	tasks      []Task
	agents     []Agent
	projects   []Project
	status     SystemStatus
	lastUpdate time.Time
	ttl        time.Duration
	mu         sync.RWMutex
}

// ClientConfig configures the TaskMaster client
type ClientConfig struct {
	Command      string        // TaskMaster CLI command (default: "task-master")
	WorkingDir   string        // Working directory for commands
	Timeout      time.Duration // Command timeout (default: 30s)
	CacheTTL     time.Duration // Cache time-to-live (default: 10s)
	SyncInterval time.Duration // Sync interval (default: 5s)
}

// NewClient creates a new TaskMaster client
func NewClient(config ClientConfig) *Client {
	if config.Command == "" {
		config.Command = "task-master"
	}
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.CacheTTL == 0 {
		config.CacheTTL = 10 * time.Second
	}
	if config.SyncInterval == 0 {
		config.SyncInterval = 5 * time.Second
	}
	
	client := &Client{
		command:      config.Command,
		workingDir:   config.WorkingDir,
		timeout:      config.Timeout,
		syncInterval: config.SyncInterval,
		cache: &Cache{
			ttl: config.CacheTTL,
		},
		errors: make([]string, 0),
	}
	
	// Test availability on initialization
	client.checkAvailability()
	
	return client
}

// checkAvailability tests if TaskMaster CLI is available
// SECURITY: This function uses exec.CommandContext and is vulnerable to command injection if not properly sandboxed.
// Future implementations should include robust input sanitization, privilege dropping, and resource limiting.
func (c *Client) checkAvailability() {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "--version")
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	output, err := cmd.Output()
	if err != nil {
		c.available = false
		c.errors = append(c.errors, fmt.Sprintf("TaskMaster CLI not available: %v", err))
		return
	}
	
	c.available = true
	c.version = strings.TrimSpace(string(output))
	
	// Get current tag if available
	c.getCurrentTag()
}

// getCurrentTag retrieves the current TaskMaster tag
func (c *Client) getCurrentTag() {
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "current-tag")
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	output, err := cmd.Output()
	if err == nil {
		c.currentTag = strings.TrimSpace(string(output))
	}
}

// IsAvailable returns true if TaskMaster CLI is available
func (c *Client) IsAvailable() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.available
}

// GetSystemStatus returns the current system status
func (c *Client) GetSystemStatus() SystemStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	status := SystemStatus{
		Available:    c.available,
		Version:      c.version,
		CurrentTag:   c.currentTag,
		LastSync:     c.lastSync,
		SyncInterval: c.syncInterval,
		Errors:       c.errors,
	}
	
	if c.available {
		tasks, _ := c.GetTasks()
		agents, _ := c.GetAgents()
		
		status.Tasks = c.calculateTaskSummary(tasks)
		status.Agents = c.calculateAgentSummary(agents)
	}
	
	return status
}

// GetTasks retrieves all tasks from TaskMaster
func (c *Client) GetTasks() ([]Task, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("TaskMaster CLI not available")
	}
	
	// Check cache first
	c.cache.mu.RLock()
	if time.Since(c.cache.lastUpdate) < c.cache.ttl {
		tasks := c.cache.tasks
		c.cache.mu.RUnlock()
		return tasks, nil
	}
	c.cache.mu.RUnlock()
	
	// Fetch from CLI
	tasks, err := c.fetchTasks()
	if err != nil {
		return nil, err
	}
	
	// Update cache
	c.cache.mu.Lock()
	c.cache.tasks = tasks
	c.cache.lastUpdate = time.Now()
	c.cache.mu.Unlock()
	
	return tasks, nil
}

// fetchTasks executes the TaskMaster CLI to get tasks
func (c *Client) fetchTasks() ([]Task, error) {
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "list", "--format=json")
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to execute task-master list: %v", err)
	}
	
	var response TaskListResponse
	if err := json.Unmarshal(output, &response); err != nil {
		// Fallback: try to parse as task array directly
		var tasks []Task
		if jsonErr := json.Unmarshal(output, &tasks); jsonErr != nil {
			return nil, fmt.Errorf("failed to parse TaskMaster output: %v (original: %v)", jsonErr, err)
		}
		return tasks, nil
	}
	
	return response.Tasks, nil
}

// GetTask retrieves a specific task by ID
func (c *Client) GetTask(id int) (*Task, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("TaskMaster CLI not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "show", strconv.Itoa(id), "--format=json")
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get task %d: %v", id, err)
	}
	
	var task Task
	if err := json.Unmarshal(output, &task); err != nil {
		return nil, fmt.Errorf("failed to parse task data: %v", err)
	}
	
	return &task, nil
}

// GetAgents retrieves all agents from TaskMaster
func (c *Client) GetAgents() ([]Agent, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("TaskMaster CLI not available")
	}
	
	// Check cache first
	c.cache.mu.RLock()
	if time.Since(c.cache.lastUpdate) < c.cache.ttl && len(c.cache.agents) > 0 {
		agents := c.cache.agents
		c.cache.mu.RUnlock()
		return agents, nil
	}
	c.cache.mu.RUnlock()
	
	// For now, return mock agents since task-master might not have agent commands yet
	agents := c.getMockAgents()
	
	// Update cache
	c.cache.mu.Lock()
	c.cache.agents = agents
	c.cache.lastUpdate = time.Now()
	c.cache.mu.Unlock()
	
	return agents, nil
}

// getMockAgents returns mock agent data for demonstration
func (c *Client) getMockAgents() []Agent {
	return []Agent{
		{
			ID:           "agent-001",
			Name:         "go-systems-expert",
			Type:         "specialized",
			Status:       AgentStatusIdle,
			Capabilities: []string{"go", "systems", "concurrency", "performance"},
			CreatedAt:    time.Now().Add(-24 * time.Hour),
			LastActive:   time.Now().Add(-5 * time.Minute),
			Performance: AgentPerformance{
				TasksCompleted: 15,
				TasksFailed:    1,
				AverageTime:    2.5,
				SuccessRate:    0.93,
			},
		},
		{
			ID:           "agent-002",
			Name:         "api-architect",
			Type:         "specialized",
			Status:       AgentStatusActive,
			CurrentTask:  intPtr(3),
			Capabilities: []string{"rest", "graphql", "documentation", "security"},
			CreatedAt:    time.Now().Add(-18 * time.Hour),
			LastActive:   time.Now().Add(-30 * time.Second),
			Performance: AgentPerformance{
				TasksCompleted: 8,
				TasksFailed:    0,
				AverageTime:    3.2,
				SuccessRate:    1.0,
			},
		},
		{
			ID:           "agent-003",
			Name:         "ux-design-specialist",
			Type:         "specialized",
			Status:       AgentStatusBusy,
			CurrentTask:  intPtr(5),
			Capabilities: []string{"design", "user-experience", "wireframes", "accessibility"},
			CreatedAt:    time.Now().Add(-12 * time.Hour),
			LastActive:   time.Now().Add(-2 * time.Minute),
			Performance: AgentPerformance{
				TasksCompleted: 6,
				TasksFailed:    1,
				AverageTime:    4.1,
				SuccessRate:    0.86,
			},
		},
	}
}

// SetTaskStatus updates a task's status
func (c *Client) SetTaskStatus(id int, status TaskStatus) error {
	if !c.IsAvailable() {
		return fmt.Errorf("TaskMaster CLI not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "set-status", 
		fmt.Sprintf("--id=%d", id), 
		fmt.Sprintf("--status=%s", status))
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to set task %d status to %s: %v", id, status, err)
	}
	
	// Invalidate cache
	c.cache.mu.Lock()
	c.cache.lastUpdate = time.Time{}
	c.cache.mu.Unlock()
	
	return nil
}

// CreateTask creates a new task
func (c *Client) CreateTask(task Task) (*Task, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("TaskMaster CLI not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	// Create task using TaskMaster CLI
	args := []string{"create", task.Title}
	if task.Description != "" {
		args = append(args, "--description", task.Description)
	}
	if task.Priority != "" {
		args = append(args, "--priority", string(task.Priority))
	}
	
	cmd := exec.CommandContext(ctx, c.command, args...)
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %v", err)
	}
	
	// Parse task ID from output
	var createdTask Task
	if err := json.Unmarshal(output, &createdTask); err != nil {
		// Fallback: assume output contains task ID
		taskIDStr := strings.TrimSpace(string(output))
		if taskID, parseErr := strconv.Atoi(taskIDStr); parseErr == nil {
			return c.GetTask(taskID)
		}
		return nil, fmt.Errorf("failed to parse created task: %v", err)
	}
	
	// Invalidate cache
	c.cache.mu.Lock()
	c.cache.lastUpdate = time.Time{}
	c.cache.mu.Unlock()
	
	return &createdTask, nil
}

// GetProjects retrieves all projects/tags
func (c *Client) GetProjects() ([]Project, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("TaskMaster CLI not available")
	}
	
	// Check cache first
	c.cache.mu.RLock()
	if time.Since(c.cache.lastUpdate) < c.cache.ttl && len(c.cache.projects) > 0 {
		projects := c.cache.projects
		c.cache.mu.RUnlock()
		return projects, nil
	}
	c.cache.mu.RUnlock()
	
	// Mock projects for now
	projects := []Project{
		{
			Name:         "hyper-dash",
			Description:  "HyperDash terminal UI development",
			Status:       "active",
			CreatedAt:    time.Now().Add(-7 * 24 * time.Hour),
			TaskCount:    8,
			Progress:     25.0,
			LastActivity: time.Now().Add(-5 * time.Minute),
		},
	}
	
	// Update cache
	c.cache.mu.Lock()
	c.cache.projects = projects
	c.cache.lastUpdate = time.Now()
	c.cache.mu.Unlock()
	
	return projects, nil
}

// SwitchTag switches to a different TaskMaster tag
func (c *Client) SwitchTag(tagName string) error {
	if !c.IsAvailable() {
		return fmt.Errorf("TaskMaster CLI not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, c.command, "use-tag", tagName)
	if c.workingDir != "" {
		cmd.Dir = c.workingDir
	}
	
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to switch to tag %s: %v", tagName, err)
	}
	
	c.mu.Lock()
	c.currentTag = tagName
	c.mu.Unlock()
	
	// Invalidate cache
	c.cache.mu.Lock()
	c.cache.lastUpdate = time.Time{}
	c.cache.mu.Unlock()
	
	return nil
}

// Sync performs a manual sync with TaskMaster
func (c *Client) Sync() error {
	c.checkAvailability()
	
	if !c.IsAvailable() {
		return fmt.Errorf("TaskMaster CLI not available")
	}
	
	// Force cache refresh
	c.cache.mu.Lock()
	c.cache.lastUpdate = time.Time{}
	c.cache.mu.Unlock()
	
	// Fetch fresh data
	_, err := c.GetTasks()
	if err != nil {
		return err
	}
	
	_, err = c.GetAgents()
	if err != nil {
		return err
	}
	
	c.mu.Lock()
	c.lastSync = time.Now()
	c.mu.Unlock()
	
	return nil
}

// StartAutoSync starts automatic synchronization with TaskMaster
func (c *Client) StartAutoSync(ctx context.Context) {
	ticker := time.NewTicker(c.syncInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.Sync(); err != nil {
				c.mu.Lock()
				c.errors = append(c.errors, fmt.Sprintf("Sync error: %v", err))
				// Keep only last 10 errors
				if len(c.errors) > 10 {
					c.errors = c.errors[len(c.errors)-10:]
				}
				c.mu.Unlock()
			}
		}
	}
}

// calculateTaskSummary calculates task statistics
func (c *Client) calculateTaskSummary(tasks []Task) TaskSummary {
	summary := TaskSummary{
		Total:      len(tasks),
		ByStatus:   make(map[TaskStatus]int),
		ByPriority: make(map[TaskPriority]int),
	}
	
	for _, task := range tasks {
		summary.ByStatus[task.Status]++
		summary.ByPriority[task.Priority]++
		
		switch task.Status {
		case StatusDone:
			summary.Completed++
		case StatusInProgress:
			summary.InProgress++
		case StatusPending:
			summary.Pending++
		case StatusBlocked:
			summary.Blocked++
		}
	}
	
	return summary
}

// calculateAgentSummary calculates agent statistics
func (c *Client) calculateAgentSummary(agents []Agent) AgentSummary {
	summary := AgentSummary{
		Total:    len(agents),
		ByStatus: make(map[AgentStatus]int),
	}
	
	for _, agent := range agents {
		summary.ByStatus[agent.Status]++
		
		switch agent.Status {
		case AgentStatusActive:
			summary.Active++
		case AgentStatusIdle:
			summary.Idle++
		case AgentStatusBusy:
			summary.Busy++
		case AgentStatusOffline:
			summary.Offline++
		}
	}
	
	return summary
}

// GetTasksInDirectory looks for .taskmaster directory in given path
func (c *Client) GetTasksInDirectory(dir string) ([]Task, error) {
	taskMasterDir := filepath.Join(dir, ".taskmaster")
	if _, err := os.Stat(taskMasterDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("no .taskmaster directory found in %s", dir)
	}
	
	// Save current working dir and switch
	oldDir := c.workingDir
	c.workingDir = dir
	defer func() { c.workingDir = oldDir }()
	
	return c.GetTasks()
}

// Helper function to create int pointer
func intPtr(i int) *int {
	return &i
}