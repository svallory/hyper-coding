package ui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/components"
)

// EnhancedViews contains methods for rendering views with advanced table components
type EnhancedViews struct {
	model *Model
}

// NewEnhancedViews creates a new enhanced views renderer
func NewEnhancedViews(model *Model) *EnhancedViews {
	return &EnhancedViews{model: model}
}

// RenderTasksView renders the tasks view with the enhanced table component
func (ev *EnhancedViews) RenderTasksView() string {
	var sections []string

	// Header with tab bar
	header := ev.model.renderTabBar()
	sections = append(sections, header)

	// Tasks title with metrics
	title := ev.renderTasksHeader()
	sections = append(sections, title)

	// Check if we have TaskMaster integration
	if ev.model.taskmaster != nil && ev.model.taskmaster.IsAvailable() {
		// Render TaskMaster tasks with enhanced table
		content := ev.renderTaskMasterTasks()
		sections = append(sections, content)
	} else {
		// Fallback to epic-based tasks
		content := ev.renderEpicTasks()
		sections = append(sections, content)
	}

	// Footer with controls
	footer := ev.renderTasksFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// RenderAgentsView renders the agents view with the enhanced table component
func (ev *EnhancedViews) RenderAgentsView() string {
	var sections []string

	// Header with tab bar
	header := ev.model.renderTabBar()
	sections = append(sections, header)

	// Agents title with metrics
	title := ev.renderAgentsHeader()
	sections = append(sections, title)

	// Check if we have TaskMaster integration
	if ev.model.taskmaster != nil && ev.model.taskmaster.IsAvailable() {
		// Render TaskMaster agents with enhanced table
		content := ev.renderTaskMasterAgents()
		sections = append(sections, content)
	} else {
		// Fallback to epic-based agents
		content := ev.renderEpicAgents()
		sections = append(sections, content)
	}

	// Footer with controls
	footer := ev.renderAgentsFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// Private helper methods

func (ev *EnhancedViews) renderTasksHeader() string {
	title := styles.TitleStyle.Render("📋 Task Management")
	
	// Calculate task metrics
	var totalTasks, completedTasks, inProgressTasks, blockedTasks int
	
	if ev.model.taskmaster != nil && len(ev.model.taskmasterTasks) > 0 {
		for _, task := range ev.model.taskmasterTasks {
			totalTasks++
			switch task.Status {
			case taskmaster.StatusDone:
				completedTasks++
			case taskmaster.StatusInProgress:
				inProgressTasks++
			case taskmaster.StatusBlocked:
				blockedTasks++
			}
		}
	} else {
		// Count from epics
		for _, epic := range ev.model.epics {
			completedTasks += len(epic.Execution.TasksCompleted)
			inProgressTasks += len(epic.Execution.TasksInProgress)
		}
		totalTasks = completedTasks + inProgressTasks
	}

	// Create metrics bar
	metrics := []string{
		fmt.Sprintf("📊 Total: %d", totalTasks),
		fmt.Sprintf("✅ Completed: %d", completedTasks),
		fmt.Sprintf("🔄 In Progress: %d", inProgressTasks),
	}
	
	if blockedTasks > 0 {
		metrics = append(metrics, fmt.Sprintf("🚫 Blocked: %d", blockedTasks))
	}

	metricsBar := lipgloss.JoinHorizontal(
		lipgloss.Top,
		strings.Join(metrics, "  "),
	)

	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		styles.SubtitleStyle.Render(metricsBar),
		"",
	)
}

func (ev *EnhancedViews) renderTaskMasterTasks() string {
	// Create task table
	taskTable := components.NewTaskTable(ev.model.taskmasterTasks)
	
	// Apply any active filters based on search
	if ev.model.searchQuery != "" {
		taskTable.SetSearchQuery(ev.model.searchQuery, "")
	}
	
	// Set default sorting by priority and status
	taskTable.Sort("priority", components.SortAsc)
	taskTable.Sort("status", components.SortAsc)
	
	// Handle task selection
	if selectedTask, ok := taskTable.GetSelectedTask(); ok {
		// Could display additional task details here
		_ = selectedTask
	}
	
	return taskTable.View()
}

func (ev *EnhancedViews) renderEpicTasks() string {
	// Create a simple table for epic tasks
	columns := []components.TableColumn{
		{
			Key:      "epic",
			Title:    "Epic",
			Width:    20,
			Sortable: true,
			DataType: components.DataTypeString,
		},
		{
			Key:      "task",
			Title:    "Task",
			Width:    40,
			Sortable: false,
			DataType: components.DataTypeString,
		},
		{
			Key:      "status",
			Title:    "Status",
			Width:    15,
			Sortable: true,
			DataType: components.DataTypeStatus,
		},
	}
	
	var rows []components.TableRow
	
	for _, epic := range ev.model.epics {
		// Add completed tasks
		for _, task := range epic.Execution.TasksCompleted {
			rows = append(rows, components.TableRow{
				"epic":   epic.Name,
				"task":   fmt.Sprintf("%v", task),
				"status": "done",
			})
		}
		
		// Add in-progress tasks
		for _, task := range epic.Execution.TasksInProgress {
			rows = append(rows, components.TableRow{
				"epic":   epic.Name,
				"task":   fmt.Sprintf("%v", task),
				"status": "in_progress",
			})
		}
	}
	
	if len(rows) == 0 {
		return styles.EmptyStateStyle.Render(
			"No active tasks\n\nTasks will appear here when epics are running.")
	}
	
	table := components.NewTable(columns, rows)
	
	// Apply search if active
	if ev.model.searchQuery != "" {
		table.SetSearchQuery(ev.model.searchQuery, "")
	}
	
	return table.View()
}

func (ev *EnhancedViews) renderTasksFooter() string {
	controls := []string{
		"[s] Sort column",
		"[S] Add sort column",
		"[/] Filter",
		"[ctrl+f] Clear filter",
		"[tab] Switch view",
		"[q] Quit",
	}
	
	footer := styles.FooterStyle.Render(strings.Join(controls, " • "))
	
	// Add search/filter status
	if ev.model.searchMode {
		return styles.StatusBarStyle.Render(fmt.Sprintf("Search: /%s_", ev.model.searchQuery))
	}
	
	return footer
}

func (ev *EnhancedViews) renderAgentsHeader() string {
	title := styles.TitleStyle.Render("🤖 TaskMaster Agents")
	
	// Calculate agent metrics
	var totalAgents, activeAgents, busyAgents, idleAgents, errorAgents int
	
	if ev.model.taskmaster != nil && len(ev.model.taskmasterAgents) > 0 {
		for _, agent := range ev.model.taskmasterAgents {
			totalAgents++
			switch agent.Status {
			case taskmaster.AgentStatusActive:
				activeAgents++
			case taskmaster.AgentStatusBusy:
				busyAgents++
			case taskmaster.AgentStatusIdle:
				idleAgents++
			case taskmaster.AgentStatusError:
				errorAgents++
			}
		}
	} else {
		// Count from epics
		for _, epic := range ev.model.epics {
			activeAgents += epic.Execution.ParallelAgentsActive
		}
		totalAgents = activeAgents
	}

	// Create metrics bar
	metrics := []string{
		fmt.Sprintf("📊 Total: %d", totalAgents),
		fmt.Sprintf("🟢 Active: %d", activeAgents),
		fmt.Sprintf("🔄 Busy: %d", busyAgents),
		fmt.Sprintf("🟡 Idle: %d", idleAgents),
	}
	
	if errorAgents > 0 {
		metrics = append(metrics, fmt.Sprintf("🔴 Error: %d", errorAgents))
	}

	metricsBar := lipgloss.JoinHorizontal(
		lipgloss.Top,
		strings.Join(metrics, "  "),
	)

	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		styles.SubtitleStyle.Render(metricsBar),
		"",
	)
}

func (ev *EnhancedViews) renderTaskMasterAgents() string {
	// Create agent table
	agentTable := components.NewAgentTable(ev.model.taskmasterAgents)
	
	// Apply any active filters based on search
	if ev.model.searchQuery != "" {
		agentTable.SetSearchQuery(ev.model.searchQuery, "")
	}
	
	// Set default sorting by status and efficiency
	agentTable.Sort("status", components.SortAsc)
	
	// Get agent metrics for display
	metrics := agentTable.GetAgentMetrics()
	
	// Add performance summary
	var perfSummary string
	if metrics.TotalCount > 0 {
		perfSummary = fmt.Sprintf(
			"\n📈 Performance: %.1f%% success rate • %.1fh avg task time • %d total tasks completed",
			metrics.AverageSuccessRate,
			metrics.AverageTaskTime,
			metrics.TotalTasksCompleted,
		)
	}
	
	tableView := agentTable.View()
	
	if perfSummary != "" {
		return lipgloss.JoinVertical(
			lipgloss.Left,
			tableView,
			styles.InfoStatusStyle.Render(perfSummary),
		)
	}
	
	return tableView
}

func (ev *EnhancedViews) renderEpicAgents() string {
	// Create a simple table for epic agents
	columns := []components.TableColumn{
		{
			Key:      "epic",
			Title:    "Epic",
			Width:    20,
			Sortable: true,
			DataType: components.DataTypeString,
		},
		{
			Key:      "agent",
			Title:    "Agent",
			Width:    25,
			Sortable: true,
			DataType: components.DataTypeString,
		},
		{
			Key:      "status",
			Title:    "Status",
			Width:    15,
			Sortable: true,
			DataType: components.DataTypeStatus,
		},
		{
			Key:      "type",
			Title:    "Type",
			Width:    20,
			Sortable: true,
			DataType: components.DataTypeString,
		},
	}
	
	var rows []components.TableRow
	
	for _, epic := range ev.model.epics {
		// Add created agents
		for _, agent := range epic.Agents.Created {
			status := "idle"
			if epic.Execution.ParallelAgentsActive > 0 {
				status = "active"
			}
			
			rows = append(rows, components.TableRow{
				"epic":   epic.Name,
				"agent":  agent,
				"status": status,
				"type":   "Created",
			})
		}
		
		// Add available agents
		for _, agent := range epic.Agents.Available {
			rows = append(rows, components.TableRow{
				"epic":   epic.Name,
				"agent":  agent,
				"status": "available",
				"type":   "Available",
			})
		}
	}
	
	if len(rows) == 0 {
		return styles.EmptyStateStyle.Render(
			"No active agents\n\nAgents will appear here when TaskMaster workflows are running.")
	}
	
	table := components.NewTable(columns, rows)
	
	// Apply search if active
	if ev.model.searchQuery != "" {
		table.SetSearchQuery(ev.model.searchQuery, "")
	}
	
	return table.View()
}

func (ev *EnhancedViews) renderAgentsFooter() string {
	controls := []string{
		"[s] Sort column",
		"[/] Filter",
		"[ctrl+f] Clear filter",
		"[tab] Switch view",
		"[q] Quit",
	}
	
	footer := styles.FooterStyle.Render(strings.Join(controls, " • "))
	
	// Add search/filter status
	if ev.model.searchMode {
		return styles.StatusBarStyle.Render(fmt.Sprintf("Search: /%s_", ev.model.searchQuery))
	}
	
	return footer
}

// HandleTableMessage handles messages for table components
func (ev *EnhancedViews) HandleTableMessage(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Handle table-specific keys
		switch msg.String() {
		case "s": // Sort current column
			// Implementation would depend on which table is active
			return nil
		case "S": // Add multi-column sort
			// Implementation would depend on which table is active
			return nil
		case "ctrl+s": // Clear sorting
			// Implementation would depend on which table is active
			return nil
		case "ctrl+f": // Clear filter
			ev.model.searchQuery = ""
			ev.model.searchMode = false
			return nil
		}
	}
	
	return nil
}