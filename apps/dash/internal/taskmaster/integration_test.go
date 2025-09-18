package taskmaster

import (
	"strings"
	"testing"
	"time"
)

func TestNewIntegration(t *testing.T) {
	config := IntegrationConfig{
		EpicDir:        "/tmp/epics",
		UpdateInterval: 3 * time.Second,
		MaxRetries:     5,
		RetryDelay:     1 * time.Second,
		ClientConfig: ClientConfig{
			Command: "test-task-master",
		},
	}
	
	integration := NewIntegration(config)
	
	if integration.epicDir != "/tmp/epics" {
		t.Errorf("Expected epic dir '/tmp/epics', got '%s'", integration.epicDir)
	}
	
	if integration.updateInterval != 3*time.Second {
		t.Errorf("Expected update interval 3s, got %v", integration.updateInterval)
	}
	
	if integration.maxRetries != 5 {
		t.Errorf("Expected max retries 5, got %d", integration.maxRetries)
	}
	
	if integration.retryDelay != 1*time.Second {
		t.Errorf("Expected retry delay 1s, got %v", integration.retryDelay)
	}
	
	if integration.client.command != "test-task-master" {
		t.Errorf("Expected client command 'test-task-master', got '%s'", integration.client.command)
	}
}

func TestNewIntegrationDefaults(t *testing.T) {
	config := IntegrationConfig{
		EpicDir: "/tmp/epics",
	}
	
	integration := NewIntegration(config)
	
	if integration.updateInterval != 5*time.Second {
		t.Errorf("Expected default update interval 5s, got %v", integration.updateInterval)
	}
	
	if integration.maxRetries != 3 {
		t.Errorf("Expected default max retries 3, got %d", integration.maxRetries)
	}
	
	if integration.retryDelay != 2*time.Second {
		t.Errorf("Expected default retry delay 2s, got %v", integration.retryDelay)
	}
	
	if integration.client.workingDir != "/tmp/epics" {
		t.Errorf("Expected client working dir '/tmp/epics', got '%s'", integration.client.workingDir)
	}
}

func TestIntegrationAvailability(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
		ClientConfig: ClientConfig{
			Command: "non-existent-command-12345",
		},
	})
	
	if integration.IsAvailable() {
		t.Error("Expected integration to not be available with non-existent command")
	}
}

func TestIntegrationStartStop(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
		ClientConfig: ClientConfig{
			Command: "non-existent-command-12345",
		},
	})
	
	// Test start with unavailable client
	err := integration.Start()
	if err == nil {
		t.Error("Expected error when starting with unavailable client")
	}
	
	if integration.isRunning {
		t.Error("Integration should not be running after failed start")
	}
	
	// Test stop when not running
	integration.Stop() // Should not panic
	
	// Test double stop
	integration.Stop() // Should not panic
}

func TestIntegrationStartStopWithMockClient(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
		ClientConfig: ClientConfig{
			Command: "echo", // Use echo as a mock command that exists
		},
	})
	
	// Override availability check for testing
	integration.client.available = true
	
	err := integration.Start()
	if err != nil {
		t.Errorf("Expected no error when starting with available client, got: %v", err)
	}
	
	if !integration.isRunning {
		t.Error("Integration should be running after successful start")
	}
	
	// Test double start
	err = integration.Start()
	if err == nil {
		t.Error("Expected error when starting already running integration")
	}
	
	integration.Stop()
	
	if integration.isRunning {
		t.Error("Integration should not be running after stop")
	}
}

func TestIntegrationSubscription(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Test subscription
	ch1 := integration.Subscribe()
	ch2 := integration.Subscribe()
	
	if len(integration.subscribers) != 2 {
		t.Errorf("Expected 2 subscribers, got %d", len(integration.subscribers))
	}
	
	// Test notification
	update := TaskUpdate{
		Type:      UpdateTypeTaskCreated,
		Timestamp: time.Now(),
	}
	
	integration.notifySubscribers(update)
	
	// Check that both subscribers received the update
	select {
	case received := <-ch1:
		if received.Type != UpdateTypeTaskCreated {
			t.Errorf("Expected UpdateTypeTaskCreated, got %s", received.Type)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("Did not receive update on channel 1")
	}
	
	select {
	case received := <-ch2:
		if received.Type != UpdateTypeTaskCreated {
			t.Errorf("Expected UpdateTypeTaskCreated, got %s", received.Type)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("Did not receive update on channel 2")
	}
	
	// Test unsubscription
	integration.Unsubscribe(ch1)
	
	if len(integration.subscribers) != 1 {
		t.Errorf("Expected 1 subscriber after unsubscribe, got %d", len(integration.subscribers))
	}
	
	// Test that unsubscribed channel doesn't receive updates
	integration.notifySubscribers(update)
	
	select {
	case <-ch1:
		t.Error("Unsubscribed channel should not receive updates")
	case <-time.After(50 * time.Millisecond):
		// Expected - no update received
	}
	
	select {
	case <-ch2:
		// Expected - update received
	case <-time.After(100 * time.Millisecond):
		t.Error("Subscribed channel should receive updates")
	}
}

func TestGetTasksFormatted(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Mock tasks for testing
	integration.client.cache.tasks = []Task{
		{
			ID:       1,
			Title:    "Test Task 1",
			Status:   StatusInProgress,
			Priority: PriorityHigh,
		},
		{
			ID:       2,
			Title:    "Test Task 2",
			Status:   StatusPending,
			Priority: PriorityMedium,
			Dependencies: []int{1},
		},
		{
			ID:       3,
			Title:    "Test Task 3",
			Status:   StatusDone,
			Priority: PriorityLow,
		},
		{
			ID:       4,
			Title:    "Test Task 4",
			Status:   StatusBlocked,
			Priority: PriorityHigh,
		},
	}
	integration.client.cache.lastUpdate = time.Now()
	
	formatted, err := integration.GetTasksFormatted()
	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	
	// Check that formatted output contains expected sections
	expectedSections := []string{
		"📋 TaskMaster Tasks",
		"🔄 In Progress:",
		"⏳ Pending:",
		"✅ Completed:",
		"🚫 Blocked:",
		"📊 Summary:",
	}
	
	for _, section := range expectedSections {
		if !strings.Contains(formatted, section) {
			t.Errorf("Expected formatted output to contain '%s'", section)
		}
	}
	
	// Check that all tasks are mentioned
	for i := 1; i <= 4; i++ {
		taskRef := string(rune('0' + i)) // Convert to string
		if !strings.Contains(formatted, "#"+taskRef) {
			t.Errorf("Expected formatted output to contain task #%d", i)
		}
	}
}

func TestGetTasksFormattedEmpty(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// No tasks in cache
	integration.client.cache.tasks = []Task{}
	integration.client.cache.lastUpdate = time.Now()
	
	formatted, err := integration.GetTasksFormatted()
	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	
	expected := "No tasks found in current epic."
	if formatted != expected {
		t.Errorf("Expected '%s', got '%s'", expected, formatted)
	}
}

func TestGetAgentsFormatted(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Use the mock agents from client
	formatted, err := integration.GetAgentsFormatted()
	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	
	// Check that formatted output contains expected sections
	expectedSections := []string{
		"🤖 TaskMaster Agents",
		"go-systems-expert",
		"api-architect",
		"ux-design-specialist",
		"📊 Summary:",
	}
	
	for _, section := range expectedSections {
		if !strings.Contains(formatted, section) {
			t.Errorf("Expected formatted output to contain '%s'", section)
		}
	}
}

func TestGetStatistics(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	stats, err := integration.GetStatistics()
	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	
	expectedKeys := []string{
		"system_available",
		"version",
		"current_tag",
		"last_sync",
		"total_tasks",
		"completed_tasks",
		"in_progress_tasks",
		"pending_tasks",
		"blocked_tasks",
		"total_agents",
		"active_agents",
		"idle_agents",
		"busy_agents",
		"offline_agents",
		"error_count",
		"integration_running",
	}
	
	for _, key := range expectedKeys {
		if _, exists := stats[key]; !exists {
			t.Errorf("Expected statistics to contain key '%s'", key)
		}
	}
	
	// Check that running status is correct
	if stats["integration_running"].(bool) != integration.isRunning {
		t.Error("Statistics should reflect actual running status")
	}
}

func TestHealthCheck(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
		ClientConfig: ClientConfig{
			Command: "non-existent-command-12345",
		},
	})
	
	err := integration.HealthCheck()
	if err == nil {
		t.Error("Expected health check to fail with unavailable client")
	}
}

func TestHealthCheckWithErrors(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Mock available client but with errors
	integration.client.available = true
	integration.client.errors = []string{"Test error"}
	
	err := integration.HealthCheck()
	if err == nil {
		t.Error("Expected health check to fail with client errors")
	}
}

func TestFormatDuration(t *testing.T) {
	testCases := []struct {
		duration time.Duration
		expected string
	}{
		{30 * time.Second, "just now"},
		{2 * time.Minute, "2m ago"},
		{90 * time.Minute, "1h ago"},
		{25 * time.Hour, "1d ago"},
		{48 * time.Hour, "2d ago"},
	}
	
	for _, tc := range testCases {
		result := formatDuration(tc.duration)
		if result != tc.expected {
			t.Errorf("Duration %v: expected '%s', got '%s'", tc.duration, tc.expected, result)
		}
	}
}

func TestTaskUpdateTypes(t *testing.T) {
	updateTypes := []UpdateType{
		UpdateTypeTaskCreated,
		UpdateTypeTaskUpdated,
		UpdateTypeTaskCompleted,
		UpdateTypeAgentStatusChanged,
		UpdateTypeSystemStatus,
		UpdateTypeError,
	}
	
	// Ensure all update types are string constants
	for _, updateType := range updateTypes {
		if string(updateType) == "" {
			t.Errorf("Update type should not be empty: %v", updateType)
		}
	}
}

func TestIntegrationErrorHandling(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Test initial error state
	if integration.GetLastError() != "" {
		t.Error("Expected no initial error")
	}
	
	// Test setting error
	testError := "Test error message"
	integration.setLastError(testError)
	
	if integration.GetLastError() != testError {
		t.Errorf("Expected error '%s', got '%s'", testError, integration.GetLastError())
	}
}

func TestIntegrationConcurrentAccess(t *testing.T) {
	integration := NewIntegration(IntegrationConfig{
		EpicDir: "/tmp",
	})
	
	// Test concurrent subscription/unsubscription
	done := make(chan bool, 2)
	
	go func() {
		for i := 0; i < 10; i++ {
			ch := integration.Subscribe()
			integration.Unsubscribe(ch)
		}
		done <- true
	}()
	
	go func() {
		for i := 0; i < 10; i++ {
			integration.notifySubscribers(TaskUpdate{
				Type:      UpdateTypeSystemStatus,
				Timestamp: time.Now(),
			})
		}
		done <- true
	}()
	
	// Wait for both goroutines to complete
	<-done
	<-done
	
	// If we reach here without deadlock, the test passes
}

func TestUpdateTypeConstants(t *testing.T) {
	// Verify that update type constants are properly defined
	if UpdateTypeTaskCreated == "" {
		t.Error("UpdateTypeTaskCreated should not be empty")
	}
	if UpdateTypeTaskUpdated == "" {
		t.Error("UpdateTypeTaskUpdated should not be empty")
	}
	if UpdateTypeTaskCompleted == "" {
		t.Error("UpdateTypeTaskCompleted should not be empty")
	}
	if UpdateTypeAgentStatusChanged == "" {
		t.Error("UpdateTypeAgentStatusChanged should not be empty")
	}
	if UpdateTypeSystemStatus == "" {
		t.Error("UpdateTypeSystemStatus should not be empty")
	}
	if UpdateTypeError == "" {
		t.Error("UpdateTypeError should not be empty")
	}
}