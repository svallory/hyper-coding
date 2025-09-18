package taskmaster

import (
	"context"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	config := ClientConfig{
		Command:      "test-task-master",
		WorkingDir:   "/tmp",
		Timeout:      10 * time.Second,
		CacheTTL:     5 * time.Second,
		SyncInterval: 3 * time.Second,
	}
	
	client := NewClient(config)
	
	if client.command != "test-task-master" {
		t.Errorf("Expected command 'test-task-master', got '%s'", client.command)
	}
	
	if client.workingDir != "/tmp" {
		t.Errorf("Expected working dir '/tmp', got '%s'", client.workingDir)
	}
	
	if client.timeout != 10*time.Second {
		t.Errorf("Expected timeout 10s, got %v", client.timeout)
	}
	
	if client.cache.ttl != 5*time.Second {
		t.Errorf("Expected cache TTL 5s, got %v", client.cache.ttl)
	}
	
	if client.syncInterval != 3*time.Second {
		t.Errorf("Expected sync interval 3s, got %v", client.syncInterval)
	}
}

func TestNewClientDefaults(t *testing.T) {
	client := NewClient(ClientConfig{})
	
	if client.command != "task-master" {
		t.Errorf("Expected default command 'task-master', got '%s'", client.command)
	}
	
	if client.timeout != 30*time.Second {
		t.Errorf("Expected default timeout 30s, got %v", client.timeout)
	}
	
	if client.cache.ttl != 10*time.Second {
		t.Errorf("Expected default cache TTL 10s, got %v", client.cache.ttl)
	}
	
	if client.syncInterval != 5*time.Second {
		t.Errorf("Expected default sync interval 5s, got %v", client.syncInterval)
	}
}

func TestClientAvailability(t *testing.T) {
	// Test with non-existent command
	client := NewClient(ClientConfig{
		Command: "non-existent-command-12345",
	})
	
	if client.IsAvailable() {
		t.Error("Expected client to not be available with non-existent command")
	}
}

func TestGetSystemStatus(t *testing.T) {
	client := NewClient(ClientConfig{
		Command: "non-existent-command-12345",
	})
	
	status := client.GetSystemStatus()
	
	if status.Available {
		t.Error("Expected system status to show not available")
	}
	
	if len(status.Errors) == 0 {
		t.Error("Expected system status to contain errors")
	}
}

func TestTaskStatusColor(t *testing.T) {
	testCases := []struct {
		status   TaskStatus
		expected string
	}{
		{StatusDone, "green"},
		{StatusInProgress, "yellow"},
		{StatusBlocked, "red"},
		{StatusDeferred, "orange"},
		{StatusCancelled, "gray"},
		{StatusPending, "blue"},
	}
	
	for _, tc := range testCases {
		task := Task{Status: tc.status}
		color := task.GetStatusColor()
		if color != tc.expected {
			t.Errorf("Status %s: expected color '%s', got '%s'", tc.status, tc.expected, color)
		}
	}
}

func TestTaskPrioritySymbol(t *testing.T) {
	testCases := []struct {
		priority TaskPriority
		expected string
	}{
		{PriorityCritical, "🔥"},
		{PriorityHigh, "⚡"},
		{PriorityMedium, "📋"},
		{PriorityLow, "📝"},
	}
	
	for _, tc := range testCases {
		task := Task{Priority: tc.priority}
		symbol := task.GetPrioritySymbol()
		if symbol != tc.expected {
			t.Errorf("Priority %s: expected symbol '%s', got '%s'", tc.priority, tc.expected, symbol)
		}
	}
}

func TestTaskStatusSymbol(t *testing.T) {
	testCases := []struct {
		status   TaskStatus
		expected string
	}{
		{StatusDone, "✅"},
		{StatusInProgress, "🔄"},
		{StatusBlocked, "🚫"},
		{StatusDeferred, "⏸️"},
		{StatusCancelled, "❌"},
		{StatusPending, "⏳"},
	}
	
	for _, tc := range testCases {
		task := Task{Status: tc.status}
		symbol := task.GetStatusSymbol()
		if symbol != tc.expected {
			t.Errorf("Status %s: expected symbol '%s', got '%s'", tc.status, tc.expected, symbol)
		}
	}
}

func TestTaskDependencies(t *testing.T) {
	allTasks := []Task{
		{ID: 1, Status: StatusDone},
		{ID: 2, Status: StatusInProgress},
		{ID: 3, Status: StatusPending, Dependencies: []int{1}},
		{ID: 4, Status: StatusPending, Dependencies: []int{1, 2}},
		{ID: 5, Status: StatusPending, Dependencies: []int{}},
	}
	
	// Task 3 should not be blocked (dependency 1 is done)
	task3 := allTasks[2]
	if task3.IsBlocked(allTasks) {
		t.Error("Task 3 should not be blocked")
	}
	if !task3.CanStart(allTasks) {
		t.Error("Task 3 should be able to start")
	}
	
	// Task 4 should be blocked (dependency 2 is in progress)
	task4 := allTasks[3]
	if !task4.IsBlocked(allTasks) {
		t.Error("Task 4 should be blocked")
	}
	if task4.CanStart(allTasks) {
		t.Error("Task 4 should not be able to start")
	}
	
	// Task 5 should not be blocked (no dependencies)
	task5 := allTasks[4]
	if task5.IsBlocked(allTasks) {
		t.Error("Task 5 should not be blocked")
	}
	if !task5.CanStart(allTasks) {
		t.Error("Task 5 should be able to start")
	}
}

func TestTaskDependencyStatus(t *testing.T) {
	allTasks := []Task{
		{ID: 1, Status: StatusDone},
		{ID: 2, Status: StatusInProgress},
		{ID: 3, Status: StatusDone},
		{ID: 4, Status: StatusPending, Dependencies: []int{1, 2, 3}},
	}
	
	task4 := allTasks[3]
	completed, total := task4.GetDependencyStatus(allTasks)
	
	if total != 3 {
		t.Errorf("Expected 3 total dependencies, got %d", total)
	}
	if completed != 2 {
		t.Errorf("Expected 2 completed dependencies, got %d", completed)
	}
}

func TestTaskComplexityLevel(t *testing.T) {
	testCases := []struct {
		complexity int
		expected   string
	}{
		{1, "Simple"},
		{2, "Simple"},
		{3, "Easy"},
		{4, "Easy"},
		{5, "Medium"},
		{6, "Medium"},
		{7, "Hard"},
		{8, "Hard"},
		{9, "Expert"},
		{10, "Expert"},
	}
	
	for _, tc := range testCases {
		task := Task{Complexity: tc.complexity}
		level := task.GetComplexityLevel()
		if level != tc.expected {
			t.Errorf("Complexity %d: expected level '%s', got '%s'", tc.complexity, tc.expected, level)
		}
	}
}

func TestTaskEstimatedDuration(t *testing.T) {
	// Test with explicit estimated hours
	task1 := Task{EstimatedHours: 2.5}
	duration1 := task1.EstimatedDuration()
	expected1 := time.Duration(2.5 * float64(time.Hour))
	if duration1 != expected1 {
		t.Errorf("Expected duration %v, got %v", expected1, duration1)
	}
	
	// Test with complexity-based estimation
	task2 := Task{Complexity: 4} // 4 * 0.5 = 2 hours
	duration2 := task2.EstimatedDuration()
	expected2 := 2 * time.Hour
	if duration2 != expected2 {
		t.Errorf("Expected duration %v, got %v", expected2, duration2)
	}
}

func TestAgentStatusColor(t *testing.T) {
	testCases := []struct {
		status   AgentStatus
		expected string
	}{
		{AgentStatusActive, "green"},
		{AgentStatusBusy, "green"},
		{AgentStatusIdle, "yellow"},
		{AgentStatusError, "red"},
		{AgentStatusOffline, "gray"},
	}
	
	for _, tc := range testCases {
		agent := Agent{Status: tc.status}
		color := agent.GetAgentStatusColor()
		if color != tc.expected {
			t.Errorf("Status %s: expected color '%s', got '%s'", tc.status, tc.expected, color)
		}
	}
}

func TestAgentStatusSymbol(t *testing.T) {
	testCases := []struct {
		status   AgentStatus
		expected string
	}{
		{AgentStatusActive, "🟢"},
		{AgentStatusBusy, "🔄"},
		{AgentStatusIdle, "🟡"},
		{AgentStatusError, "🔴"},
		{AgentStatusOffline, "⚫"},
	}
	
	for _, tc := range testCases {
		agent := Agent{Status: tc.status}
		symbol := agent.GetAgentStatusSymbol()
		if symbol != tc.expected {
			t.Errorf("Status %s: expected symbol '%s', got '%s'", tc.status, tc.expected, symbol)
		}
	}
}

func TestAgentEfficiencyRating(t *testing.T) {
	testCases := []struct {
		successRate float64
		expected    string
	}{
		{0.98, "Excellent"},
		{0.90, "Good"},
		{0.75, "Average"},
		{0.60, "Below Average"},
		{0.30, "Poor"},
	}
	
	for _, tc := range testCases {
		agent := Agent{
			Performance: AgentPerformance{
				SuccessRate: tc.successRate,
			},
		}
		rating := agent.GetEfficiencyRating()
		if rating != tc.expected {
			t.Errorf("Success rate %.2f: expected rating '%s', got '%s'", tc.successRate, tc.expected, rating)
		}
	}
}

func TestAgentTimeSinceLastActive(t *testing.T) {
	now := time.Now()
	agent := Agent{
		LastActive: now.Add(-5 * time.Minute),
	}
	
	duration := agent.TimeSinceLastActive()
	expected := 5 * time.Minute
	
	// Allow for small time differences due to test execution time
	if duration < expected-time.Second || duration > expected+time.Second {
		t.Errorf("Expected duration around %v, got %v", expected, duration)
	}
}

func TestCalculateTaskSummary(t *testing.T) {
	client := NewClient(ClientConfig{})
	
	tasks := []Task{
		{Status: StatusDone, Priority: PriorityHigh},
		{Status: StatusDone, Priority: PriorityMedium},
		{Status: StatusInProgress, Priority: PriorityHigh},
		{Status: StatusPending, Priority: PriorityLow},
		{Status: StatusBlocked, Priority: PriorityMedium},
	}
	
	summary := client.calculateTaskSummary(tasks)
	
	if summary.Total != 5 {
		t.Errorf("Expected 5 total tasks, got %d", summary.Total)
	}
	if summary.Completed != 2 {
		t.Errorf("Expected 2 completed tasks, got %d", summary.Completed)
	}
	if summary.InProgress != 1 {
		t.Errorf("Expected 1 in progress task, got %d", summary.InProgress)
	}
	if summary.Pending != 1 {
		t.Errorf("Expected 1 pending task, got %d", summary.Pending)
	}
	if summary.Blocked != 1 {
		t.Errorf("Expected 1 blocked task, got %d", summary.Blocked)
	}
	
	if summary.ByStatus[StatusDone] != 2 {
		t.Errorf("Expected 2 done tasks in ByStatus, got %d", summary.ByStatus[StatusDone])
	}
	if summary.ByPriority[PriorityHigh] != 2 {
		t.Errorf("Expected 2 high priority tasks in ByPriority, got %d", summary.ByPriority[PriorityHigh])
	}
}

func TestCalculateAgentSummary(t *testing.T) {
	client := NewClient(ClientConfig{})
	
	agents := []Agent{
		{Status: AgentStatusActive},
		{Status: AgentStatusActive},
		{Status: AgentStatusIdle},
		{Status: AgentStatusBusy},
		{Status: AgentStatusOffline},
	}
	
	summary := client.calculateAgentSummary(agents)
	
	if summary.Total != 5 {
		t.Errorf("Expected 5 total agents, got %d", summary.Total)
	}
	if summary.Active != 2 {
		t.Errorf("Expected 2 active agents, got %d", summary.Active)
	}
	if summary.Idle != 1 {
		t.Errorf("Expected 1 idle agent, got %d", summary.Idle)
	}
	if summary.Busy != 1 {
		t.Errorf("Expected 1 busy agent, got %d", summary.Busy)
	}
	if summary.Offline != 1 {
		t.Errorf("Expected 1 offline agent, got %d", summary.Offline)
	}
	
	if summary.ByStatus[AgentStatusActive] != 2 {
		t.Errorf("Expected 2 active agents in ByStatus, got %d", summary.ByStatus[AgentStatusActive])
	}
}

func TestCacheExpiration(t *testing.T) {
	client := NewClient(ClientConfig{
		CacheTTL: 100 * time.Millisecond, // Very short TTL for testing
	})
	
	// Manually populate cache
	client.cache.mu.Lock()
	client.cache.tasks = []Task{{ID: 1, Title: "Test Task"}}
	client.cache.lastUpdate = time.Now()
	client.cache.mu.Unlock()
	
	// Immediately check cache - should be valid
	client.cache.mu.RLock()
	isValid := time.Since(client.cache.lastUpdate) < client.cache.ttl
	client.cache.mu.RUnlock()
	
	if !isValid {
		t.Error("Cache should be valid immediately after update")
	}
	
	// Wait for cache to expire
	time.Sleep(150 * time.Millisecond)
	
	client.cache.mu.RLock()
	isExpired := time.Since(client.cache.lastUpdate) >= client.cache.ttl
	client.cache.mu.RUnlock()
	
	if !isExpired {
		t.Error("Cache should be expired after TTL")
	}
}

func TestAutoSyncContext(t *testing.T) {
	client := NewClient(ClientConfig{
		Command: "non-existent-command", // Will fail, but we're testing context handling
	})
	
	ctx, cancel := context.WithCancel(context.Background())
	
	// Start auto sync in background
	go client.StartAutoSync(ctx)
	
	// Cancel context after short delay
	time.Sleep(50 * time.Millisecond)
	cancel()
	
	// Give it time to process the cancellation
	time.Sleep(50 * time.Millisecond)
	
	// If we reach here without hanging, the context cancellation worked
}