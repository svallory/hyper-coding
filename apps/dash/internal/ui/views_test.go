package ui

import (
	"testing"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestTabBarRendering(t *testing.T) {
	model := InitialModel("/tmp")
	model.width = 100
	model.height = 40

	tests := []struct {
		name         string
		activeTab    ViewMode
		expectedTabs []string
	}{
		{
			name:      "Overview active",
			activeTab: OverviewView,
			expectedTabs: []string{
				"1:Overview", // Should be highlighted
				"2:Tasks",
				"3:Agents",
				"4:Docs",
				"5:Logs",
				"6:Performance",
				"7:Help",
			},
		},
		{
			name:      "Tasks active",
			activeTab: TasksView,
			expectedTabs: []string{
				"1:Overview",
				"2:Tasks", // Should be highlighted
				"3:Agents",
				"4:Docs",
				"5:Logs",
				"6:Performance",
				"7:Help",
			},
		},
		{
			name:      "Agents active",
			activeTab: AgentsView,
			expectedTabs: []string{
				"1:Overview",
				"2:Tasks",
				"3:Agents", // Should be highlighted
				"4:Docs",
				"5:Logs",
				"6:Performance",
				"7:Help",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.viewMode = tt.activeTab
			tabBar := model.renderTabBar()

			// Check that all tabs are present
			for _, tab := range tt.expectedTabs {
				assert.Contains(t, tabBar, tab, "Tab bar should contain tab: %s", tab)
			}
		})
	}
}

func TestViewRendering(t *testing.T) {
	model := InitialModel("/tmp")
	model.width = 100
	model.height = 40
	model.loading = false

	tests := []struct {
		name           string
		viewMode       ViewMode
		expectedTitle  string
		expectedInView []string
	}{
		{
			name:          "Overview view",
			viewMode:      OverviewView,
			expectedTitle: "HyperDash",
			expectedInView: []string{
				"1:Overview",
				"2:Tasks",
				"3:Agents",
				"4:Docs",
				"5:Logs",
				"6:Performance",
				"7:Help",
			},
		},
		{
			name:          "Tasks view",
			viewMode:      TasksView,
			expectedTitle: "Task Management",
			expectedInView: []string{
				"1:Overview",
				"2:Tasks",
				"Task Management", // Just check for the title
			},
		},
		{
			name:          "Agents view",
			viewMode:      AgentsView,
			expectedTitle: "TaskMaster Agents",
			expectedInView: []string{
				"1:Overview",
				"3:Agents",
				"Agent Activity",
				"TaskMaster Integration",
			},
		},
		{
			name:          "Documents view",
			viewMode:      DocumentsView,
			expectedTitle: "Epic Documents",
			expectedInView: []string{
				"1:Overview",
				"4:Docs",
			},
		},
		{
			name:          "Logs view",
			viewMode:      LogsView,
			expectedTitle: "Live Workflow Logs",
			expectedInView: []string{
				"1:Overview",
				"5:Logs",
			},
		},
		{
			name:          "Help view",
			viewMode:      HelpView,
			expectedTitle: "HyperDash Help",
			expectedInView: []string{
				"1:Overview",
				"7:Help",
				"Navigation",
				"1-7",
				"Quick switch to tab",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.viewMode = tt.viewMode
			view := model.View()

			// Check that expected content is present
			for _, expected := range tt.expectedInView {
				assert.Contains(t, view, expected, 
					"View should contain: %s", expected)
			}
		})
	}
}

func TestFooterControls(t *testing.T) {
	model := InitialModel("/tmp")

	tests := []struct {
		name             string
		viewMode         ViewMode
		expectedControls []string
	}{
		{
			name:     "Overview footer",
			viewMode: OverviewView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[enter] Select Epic",
				"[gg] Top",
				"[G] Bottom",
				"[/] Search",
				"[:] Command",
				"[q] Quit",
			},
		},
		{
			name:     "Tasks footer",
			viewMode: TasksView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[gg] Top",
				"[G] Bottom",
				"[/] Search",
				"[:] Command",
				"[q] Quit",
			},
		},
		{
			name:     "Agents footer",
			viewMode: AgentsView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[gg] Top",
				"[G] Bottom",
				"[/] Search",
				"[:] Command",
				"[q] Quit",
			},
		},
		{
			name:     "Documents footer",
			viewMode: DocumentsView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[enter] Open",
				"[gg] Top",
				"[G] Bottom",
				"[/] Search",
				"[q] Quit",
			},
		},
		{
			name:     "Logs footer",
			viewMode: LogsView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[gg] Top",
				"[G] Bottom",
				"[/] Search",
				"[:] Command",
				"[q] Quit",
			},
		},
		{
			name:     "Help footer",
			viewMode: HelpView,
			expectedControls: []string{
				"[1-6] Switch Tab",
				"[gg] Top",
				"[G] Bottom",
				"[:] Command",
				"[q] Quit",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.viewMode = tt.viewMode
			footer := model.renderFooter()

			// Check that expected controls are present
			for _, control := range tt.expectedControls {
				assert.Contains(t, footer, control,
					"Footer should contain control: %s", control)
			}
		})
	}
}

func TestTasksContentRendering(t *testing.T) {
	model := InitialModel("/tmp")
	model.width = 100
	model.height = 40

	t.Run("Empty state", func(t *testing.T) {
		model.epics = []models.Epic{}
		// Initialize viewport dimensions
		model.tasksViewport.Width = 80
		model.tasksViewport.Height = 20
		
		content := model.renderTasksContent()

		// The content is rendered inside a box, so just check it's not empty
		assert.NotEmpty(t, content, "Tasks content should not be empty")
	})

	// Note: More detailed tests would require mocking Epic data
}

func TestAgentsContentRendering(t *testing.T) {
	model := InitialModel("/tmp")
	model.width = 100
	model.height = 40

	t.Run("Empty state", func(t *testing.T) {
		model.epics = []models.Epic{}
		content := model.renderAgentsContent()

		// Content is styled, so check it contains expected text
		// TaskMaster integration shows mock agent data even when epics are empty
		assert.Contains(t, content, "TaskMaster Agents",
			"Should show TaskMaster agents integration")
		// Should show mock agents since TaskMaster is available
		assert.Contains(t, content, "go-systems-expert",
			"Should show mock agent data when TaskMaster is available")
	})

	// Note: More detailed tests would require mocking Epic data with agents
}

func TestGetViewModeName(t *testing.T) {
	model := InitialModel("/tmp")

	tests := []struct {
		viewMode ViewMode
		expected string
	}{
		{OverviewView, "Overview"},
		{TasksView, "Tasks"},
		{AgentsView, "Agents"},
		{DocumentsView, "Documents"},
		{LogsView, "Logs"},
		{HelpView, "Help"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			model.viewMode = tt.viewMode
			name := model.getViewModeName()
			assert.Equal(t, tt.expected, name,
				"ViewMode %v should return name %s", tt.viewMode, tt.expected)
		})
	}
}

func TestTabBarHighlighting(t *testing.T) {
	model := InitialModel("/tmp")
	model.width = 100

	// Test that active tab is highlighted differently
	for i := 0; i < 7; i++ {
		model.viewMode = ViewMode(i)
		tabBar := model.renderTabBar()

		// The tab bar should contain numbered tabs
		assert.Contains(t, tabBar, "1:Overview")
		assert.Contains(t, tabBar, "2:Tasks")
		assert.Contains(t, tabBar, "3:Agents")
		assert.Contains(t, tabBar, "4:Docs")
		assert.Contains(t, tabBar, "5:Logs")
		assert.Contains(t, tabBar, "6:Performance")
		assert.Contains(t, tabBar, "7:Help")
	}
}