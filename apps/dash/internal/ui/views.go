package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
)

// loadingView renders the loading screen with spinner
func (m Model) loadingView() string {
	content := lipgloss.JoinVertical(
		lipgloss.Center,
		m.spinner.View(),
		"",
		"Loading epic data...",
		"",
		styles.SubtitleStyle.Render(fmt.Sprintf("Monitoring: %s", m.epicDir)),
	)

	return lipgloss.Place(
		m.width, m.height,
		lipgloss.Center, lipgloss.Center,
		styles.LoadingStyle.Render(content),
	)
}

// overviewView renders the main overview dashboard
func (m Model) overviewView() string {
	var sections []string

	// Tab bar
	tabs := m.renderTabBar()
	sections = append(sections, tabs)

	// Header with stats
	header := m.renderHeader()
	sections = append(sections, header)

	// Epic list (this is the main content)
	listView := m.epicList.View()
	sections = append(sections, listView)

	// Footer with controls
	footer := m.renderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// tasksView renders the tasks management view
func (m Model) tasksView() string {
	var sections []string

	// Header with tab bar
	header := m.renderTabBar()
	sections = append(sections, header)

	// Tasks title
	title := styles.TitleStyle.Render("📋 Task Management")
	sections = append(sections, title)

	// Tasks content
	content := m.renderTasksContent()
	sections = append(sections, content)

	// Footer
	footer := m.renderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// agentsView renders the agents dashboard
func (m Model) agentsView() string {
	var sections []string

	// Header with tab bar
	header := m.renderTabBar()
	sections = append(sections, header)

	// Agents title
	title := styles.TitleStyle.Render("🤖 TaskMaster Agents")
	sections = append(sections, title)

	// Agents dashboard content
	content := m.renderAgentsContent()
	sections = append(sections, content)

	// Footer
	footer := m.renderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// documentsView renders the document browser and viewer
func (m Model) documentsView() string {
	if m.selectedDoc != nil {
		// Show document content
		return m.documentReaderView()
	}

	// Show document list
	var sections []string

	// Tab bar
	tabs := m.renderTabBar()
	sections = append(sections, tabs)

	// Header
	header := m.renderDocumentHeader()
	sections = append(sections, header)

	// Document list
	listView := m.docList.View()
	sections = append(sections, listView)

	// Footer with controls
	footer := m.renderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// documentReaderView renders the selected document content
func (m Model) documentReaderView() string {
	if m.selectedDoc == nil {
		return m.renderError("No document selected")
	}

	var sections []string

	// Header
	header := m.renderDocumentReaderHeader()
	sections = append(sections, header)

	// Document content
	content := styles.LogViewerStyle.Render(m.docViewport.View())
	sections = append(sections, content)

	// Footer with controls
	footer := m.renderDocumentReaderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// logsView renders the log viewer with viewport
func (m Model) logsView() string {
	var sections []string

	// Tab bar
	tabs := m.renderTabBar()
	sections = append(sections, tabs)

	// Header
	header := m.renderLogHeader()
	sections = append(sections, header)

	// Log controls
	controls := m.renderLogControls()
	sections = append(sections, controls)

	// Log viewport
	logs := styles.LogViewerStyle.Render(m.logViewport.View())
	sections = append(sections, logs)

	// Footer with scroll info
	footer := m.renderLogFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// helpView renders the help screen
func (m Model) helpView() string {
	var sections []string

	// Tab bar
	tabs := m.renderTabBar()
	sections = append(sections, tabs)

	// Header
	header := styles.TitleStyle.Render("🚀 HyperDash Help")
	sections = append(sections, header)

	// Key bindings help
	help := m.renderHelpContent()
	sections = append(sections, help)

	// Footer
	footer := m.renderFooter()
	sections = append(sections, footer)

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// Header components
func (m Model) renderHeader() string {
	title := styles.TitleStyle.Render("🚀 HyperDash - Epic Workflow Monitor")
	
	// Stats summary
	stats := m.renderStatsBar()
	
	// Status line
	status := m.renderStatusLine()

	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		stats,
		status,
		"",
	)
}

func (m Model) renderDetailHeader() string {
	epic := m.selectedEpic
	title := styles.TitleStyle.Render(fmt.Sprintf("📋 Epic: %s", epic.Name))
	
	breadcrumb := styles.SubtitleStyle.Render("Overview > Epic Detail")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		breadcrumb,
		"",
	)
}

func (m Model) renderLogHeader() string {
	title := styles.TitleStyle.Render("📝 Live Workflow Logs")
	
	breadcrumb := styles.SubtitleStyle.Render("Overview > Logs")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		breadcrumb,
		"",
	)
}

func (m Model) renderDocumentHeader() string {
	title := styles.TitleStyle.Render("📚 Epic Documents")
	
	breadcrumb := styles.SubtitleStyle.Render("Overview > Documents")
	
	// Document stats
	totalDocs := len(m.documents)
	markdownCount := 0
	for _, doc := range m.documents {
		if doc.IsMarkdown {
			markdownCount++
		}
	}
	
	stats := styles.SubtitleStyle.Render(fmt.Sprintf("%d documents (%d markdown)", totalDocs, markdownCount))
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		breadcrumb,
		stats,
		"",
	)
}

func (m Model) renderDocumentReaderHeader() string {
	doc := m.selectedDoc
	title := styles.TitleStyle.Render(fmt.Sprintf("📖 %s", doc.Name))
	
	breadcrumb := styles.SubtitleStyle.Render("Overview > Documents > " + doc.Name)
	
	// Document info
	info := []string{
		fmt.Sprintf("Size: %s", formatFileSize(doc.Size)),
		fmt.Sprintf("Modified: %s", doc.ModTime.Format("January 2, 2006 at 15:04")),
	}
	if doc.EpicName != "" {
		info = append(info, fmt.Sprintf("Epic: %s", doc.EpicName))
	}
	
	docInfo := styles.SubtitleStyle.Render(strings.Join(info, " • "))
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		breadcrumb,
		docInfo,
		"",
	)
}

func (m Model) renderStatsBar() string {
	totalEpics := len(m.epics)
	activeAgents := 0
	completedTasks := 0
	runningEpics := 0

	for _, epic := range m.epics {
		activeAgents += epic.Execution.ParallelAgentsActive
		completedTasks += len(epic.Execution.TasksCompleted)
		if epic.IsActive() {
			runningEpics++
		}
	}

	stats := []string{
		styles.StatStyle.Render(fmt.Sprintf("📊 %d Epics", totalEpics)),
		styles.StatStyle.Render(fmt.Sprintf("🔄 %d Running", runningEpics)),
		styles.StatStyle.Render(fmt.Sprintf("🤖 %d Agents", activeAgents)),
		styles.StatStyle.Render(fmt.Sprintf("✅ %d Tasks", completedTasks)),
	}

	return lipgloss.JoinHorizontal(lipgloss.Top, stats...)
}

func (m Model) renderStatusLine() string {
	var status string
	if m.error != "" {
		status = styles.ErrorStyle.Render(fmt.Sprintf("Error: %s", m.error))
	} else {
		status = styles.InfoStatusStyle.Render(fmt.Sprintf("Last update: %s", m.lastUpdate.Format("15:04:05")))
	}
	
	viewMode := m.getViewModeName()
	mode := styles.InfoStatusStyle.Render(fmt.Sprintf("View: %s", viewMode))
	
	return lipgloss.JoinHorizontal(
		lipgloss.Left,
		status,
		"  •  ",
		mode,
	)
}

func (m Model) renderEpicDetails() string {
	epic := m.selectedEpic

	// Left column - Basic info
	leftCol := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.SectionHeaderStyle.Render("📋 Epic Information"),
		fmt.Sprintf("Status: %s", m.formatStatus(epic.Status)),
		fmt.Sprintf("Current Step: %d", epic.CurrentStep),
		fmt.Sprintf("Completed Steps: %v", epic.CompletedSteps),
		fmt.Sprintf("Created: %s", epic.Timestamp.Format("2006-01-02 15:04:05")),
		fmt.Sprintf("Updated: %s", epic.LastUpdated.Format("2006-01-02 15:04:05")),
		"",
		styles.SectionHeaderStyle.Render("🏷️ Configuration"),
		fmt.Sprintf("Tag: %s", m.stringOrEmpty(epic.TagName)),
		fmt.Sprintf("Max Agents: %d", epic.WorkflowConfig.MaxSubagents),
		fmt.Sprintf("No Stop: %t", epic.WorkflowConfig.NoStop),
	)

	// Right column - Artifacts
	rightCol := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.SectionHeaderStyle.Render("📁 Artifacts"),
		fmt.Sprintf("Original Doc: %s", m.stringOrEmpty(epic.Artifacts.OriginalDoc)),
		fmt.Sprintf("PRD: %s", m.stringOrEmpty(epic.Artifacts.PRD)),
		fmt.Sprintf("Tasks File: %s", m.stringOrEmpty(epic.Artifacts.TasksFile)),
		fmt.Sprintf("Complexity Report: %s", m.stringOrEmpty(epic.Artifacts.ComplexityReport)),
		"",
		styles.SectionHeaderStyle.Render("🤖 Agents"),
		fmt.Sprintf("Required: %s", strings.Join(epic.Agents.Required, ", ")),
		fmt.Sprintf("Created: %s", strings.Join(epic.Agents.Created, ", ")),
		fmt.Sprintf("Available: %s", strings.Join(epic.Agents.Available, ", ")),
	)

	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		leftCol,
		"    ",
		rightCol,
	)
}

func (m Model) renderProgressSection() string {
	epic := m.selectedEpic
	
	// Progress bar using Bubbles progress component
	progressPercent := epic.Progress / 100
	progressBar := m.progress.ViewAs(progressPercent)
	
	progressInfo := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.SectionHeaderStyle.Render("📈 Progress"),
		fmt.Sprintf("Overall: %.1f%% complete", epic.Progress),
		progressBar,
		fmt.Sprintf("Steps: %d/%d completed", len(epic.CompletedSteps), epic.CurrentStep),
	)

	return progressInfo
}

func (m Model) renderStatusSection() string {
	epic := m.selectedEpic

	// Task status
	taskStatus := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.SectionHeaderStyle.Render("⚡ Task Execution"),
		fmt.Sprintf("In Progress: %d", len(epic.Execution.TasksInProgress)),
		fmt.Sprintf("Completed: %d", len(epic.Execution.TasksCompleted)),
		fmt.Sprintf("Active Agents: %d", epic.Execution.ParallelAgentsActive),
	)

	if epic.Execution.LastTaskCompletion != nil {
		taskStatus = lipgloss.JoinVertical(
			lipgloss.Left,
			taskStatus,
			fmt.Sprintf("Last Completion: %s", epic.Execution.LastTaskCompletion.Format("15:04:05")),
		)
	}

	// Show in-progress tasks
	if len(epic.Execution.TasksInProgress) > 0 {
		taskList := "Current Tasks: " + strings.Join(
			m.interfaceSliceToStrings(epic.Execution.TasksInProgress), ", ",
		)
		taskStatus = lipgloss.JoinVertical(lipgloss.Left, taskStatus, taskList)
	}

	return taskStatus
}

func (m Model) renderLogControls() string {
	controls := []string{
		"[↑/↓] Scroll",
		"[tab] Switch View",
		"[esc] Back",
		"[r] Refresh",
		"[q] Quit",
	}

	return styles.LogControlsStyle.Render(strings.Join(controls, " • "))
}

func (m Model) renderLogFooter() string {
	scrollInfo := fmt.Sprintf("%.0f%%", m.logViewport.ScrollPercent()*100)
	lineInfo := fmt.Sprintf("%d lines", len(m.logs))
	
	return styles.FooterStyle.Render(
		fmt.Sprintf("Scroll: %s • %s", scrollInfo, lineInfo),
	)
}

func (m Model) renderDocumentReaderFooter() string {
	scrollInfo := fmt.Sprintf("%.0f%%", m.docViewport.ScrollPercent()*100)
	
	return styles.FooterStyle.Render(
		fmt.Sprintf("Scroll: %s • [esc] Back to list • [tab] Switch view • [q] Quit", scrollInfo),
	)
}

func (m Model) renderHelpContent() string {
	help := `
🎯 Navigation:
  1-6         Quick switch to tab (Overview/Tasks/Agents/Docs/Logs/Help)
  ↑/k, ↓/j    Move up/down in lists
  ←/h, →/l    Move left/right  
  enter       Select epic or item
  esc         Go back to previous view
  tab         Cycle through tabs
  r           Refresh data
🎮 Vi-mode Navigation:
  gg          Goto top of current list/viewport
  G           Goto bottom of current list/viewport
  /           Search in current view (press enter to search, esc to cancel)
  :           Command mode (q/quit, help, overview, tasks, agents, docs, logs)

📋 Views:
  1:Overview  Dashboard showing all epics with status and progress
  2:Tasks     Task management and tracking across all epics
  3:Agents    TaskMaster agent monitoring and analytics
  4:Docs      Browse and read markdown files in epic directory
  5:Logs      Real-time log viewer with auto-scroll
  6:Help      This help screen with keyboard shortcuts

🎨 Features:
  • Real-time monitoring of epic progress
  • Live agent activity tracking  
  • Task completion status
  • Workflow state visualization
  • Structured log viewing with color coding
  • Keyboard-driven navigation

🚀 Tips:
  • Use filter (/) in epic list to find specific epics
  • Logs auto-scroll to show latest entries
  • Press r to refresh if data seems stale
  • All views are responsive and adapt to terminal size
`

	return styles.HelpStyle.Render(help)
}

func (m Model) renderFooter() string {
	var controls []string
	
	// Show search/command mode status
	if m.searchMode {
		return styles.StatusBarStyle.Render(fmt.Sprintf("Search: /%s_", m.searchQuery))
	}
	if m.commandMode {
		return styles.StatusBarStyle.Render(fmt.Sprintf("Command: :%s_", m.commandInput))
	}
	
	switch m.viewMode {
	case OverviewView:
		controls = []string{"[1-6] Switch Tab", "[enter] Select Epic", "[gg] Top", "[G] Bottom", "[/] Search", "[:] Command", "[q] Quit"}
	case TasksView:
		controls = []string{"[1-6] Switch Tab", "[gg] Top", "[G] Bottom", "[/] Search", "[:] Command", "[q] Quit"}
	case AgentsView:
		controls = []string{"[1-6] Switch Tab", "[gg] Top", "[G] Bottom", "[/] Search", "[:] Command", "[q] Quit"}
	case DocumentsView:
		if m.selectedDoc != nil {
			controls = []string{"[esc] Back", "[gg] Top", "[G] Bottom", "[/] Search", "[:] Command", "[q] Quit"}
		} else {
			controls = []string{"[1-6] Switch Tab", "[enter] Open", "[gg] Top", "[G] Bottom", "[/] Search", "[q] Quit"}
		}
	case LogsView:
		controls = []string{"[1-6] Switch Tab", "[gg] Top", "[G] Bottom", "[/] Search", "[:] Command", "[q] Quit"}
	case HelpView:
		controls = []string{"[1-6] Switch Tab", "[gg] Top", "[G] Bottom", "[:] Command", "[q] Quit"}
	}

	return styles.FooterStyle.Render(strings.Join(controls, " • "))
}

func (m Model) renderError(msg string) string {
	return lipgloss.Place(
		m.width, m.height,
		lipgloss.Center, lipgloss.Center,
		styles.ErrorStyle.Render(msg),
	)
}

// Helper functions
func (m Model) getViewModeName() string {
	switch m.viewMode {
	case OverviewView:
		return "Overview"
	case TasksView:
		return "Tasks"
	case AgentsView:
		return "Agents"
	case DocumentsView:
		if m.selectedDoc != nil {
			return "Document Reader"
		}
		return "Documents"
	case LogsView:
		return "Logs"
	case HelpView:
		return "Help"
	default:
		return "Unknown"
	}
}

func (m Model) formatStatus(status string) string {
	switch status {
	case "completed":
		return styles.SuccessStatusStyle.Render("✅ Completed")
	case "running", "executing":
		return styles.InfoStatusStyle.Render("🔄 Running")
	case "failed", "error":
		return styles.ErrorStatusStyle.Render("❌ Failed")
	default:
		return styles.WarningStatusStyle.Render("⏸️ Pending")
	}
}

func (m Model) stringOrEmpty(ptr *string) string {
	if ptr == nil {
		return "None"
	}
	if *ptr == "" {
		return "None"
	}
	return *ptr
}

func (m Model) interfaceSliceToStrings(slice []interface{}) []string {
	result := make([]string, len(slice))
	for i, v := range slice {
		result[i] = fmt.Sprintf("%v", v)
	}
	return result
}

// renderTabBar renders the 6-tab navigation bar with numbered shortcuts
func (m Model) renderTabBar() string {
	tabs := []string{
		"1:Overview",
		"2:Tasks",
		"3:Agents",
		"4:Docs",
		"5:Logs",
		"6:Help",
	}

	var renderedTabs []string
	for i, tab := range tabs {
		viewMode := ViewMode(i)
		if viewMode == m.viewMode {
			renderedTabs = append(renderedTabs, styles.ActiveTabStyle.Render(tab))
		} else {
			renderedTabs = append(renderedTabs, styles.InactiveTabStyle.Render(tab))
		}
	}

	tabBar := lipgloss.JoinHorizontal(lipgloss.Top, renderedTabs...)
	
	// Add a border below the tab bar
	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.Border{Bottom: "═"}).
		BorderForeground(lipgloss.Color("#9775FA")).
		Width(m.width)
	
	return borderStyle.Render(tabBar)
}

// renderTasksContent renders the tasks management content
func (m Model) renderTasksContent() string {
	var content strings.Builder
	
	if m.taskmaster != nil && m.taskmaster.IsAvailable() {
		// Use TaskMaster data if available
		formatted, err := m.taskmaster.GetTasksFormatted()
		if err != nil {
			content.WriteString(styles.ErrorStyle.Render(fmt.Sprintf("TaskMaster Error: %v", err)))
		} else {
			content.WriteString(formatted)
		}
		
		// Add system status
		status := m.taskmaster.GetSystemStatus()
		if status.Available {
			content.WriteString("\n")
			content.WriteString(styles.SectionHeaderStyle.Render("🔧 TaskMaster Status\n"))
			content.WriteString(fmt.Sprintf("Version: %s\n", status.Version))
			content.WriteString(fmt.Sprintf("Current Tag: %s\n", status.CurrentTag))
			content.WriteString(fmt.Sprintf("Last Sync: %s\n", status.LastSync.Format("15:04:05")))
			
			if len(status.Errors) > 0 {
				content.WriteString("\nErrors:\n")
				for _, errMsg := range status.Errors {
					content.WriteString(fmt.Sprintf("  • %s\n", errMsg))
				}
			}
		}
	} else {
		// Fallback to epic-based task content
		content.WriteString(styles.SectionHeaderStyle.Render("📋 Active Tasks\n\n"))
		
		totalTasks := 0
		completedTasks := 0
		inProgressTasks := 0
		
		for _, epic := range m.epics {
			if epic.IsActive() {
				completedTasks += len(epic.Execution.TasksCompleted)
				inProgressTasks += len(epic.Execution.TasksInProgress)
				
				if len(epic.Execution.TasksInProgress) > 0 {
					content.WriteString(fmt.Sprintf("\n%s Epic: %s\n", 
						m.formatStatus(epic.Status), epic.Name))
					content.WriteString("  In Progress:\n")
					for _, task := range epic.Execution.TasksInProgress {
						content.WriteString(fmt.Sprintf("    • %v\n", task))
					}
				}
			}
		}
		
		totalTasks = completedTasks + inProgressTasks
		
		// Add summary statistics
		summary := fmt.Sprintf("\n📊 Task Summary:\n")
		summary += fmt.Sprintf("  Total: %d\n", totalTasks)
		summary += fmt.Sprintf("  ✅ Completed: %d\n", completedTasks)
		summary += fmt.Sprintf("  🔄 In Progress: %d\n", inProgressTasks)
		
		content.WriteString(styles.StatStyle.Render(summary))
		
		// If no tasks, show empty state
		if totalTasks == 0 {
			content.Reset()
			content.WriteString(styles.EmptyStateStyle.Render(
				"No active tasks\n\nTasks will appear here when epics are running."))
		}
		
		// Add TaskMaster availability notice
		content.WriteString("\n")
		content.WriteString(styles.WarningStyle.Render(
			"💡 TaskMaster Integration\n\nTaskMaster CLI not available. Install and configure TaskMaster for enhanced task management."))
	}
	
	m.tasksViewport.SetContent(content.String())
	return styles.LogViewerStyle.Render(m.tasksViewport.View())
}

// renderAgentsContent renders the TaskMaster agents dashboard
func (m Model) renderAgentsContent() string {
	var content strings.Builder
	
	if m.taskmaster != nil && m.taskmaster.IsAvailable() {
		// Use TaskMaster data if available
		formatted, err := m.taskmaster.GetAgentsFormatted()
		if err != nil {
			content.WriteString(styles.ErrorStyle.Render(fmt.Sprintf("TaskMaster Error: %v", err)))
		} else {
			content.WriteString(formatted)
		}
		
		// Add system status
		status := m.taskmaster.GetSystemStatus()
		if status.Available {
			content.WriteString("\n")
			content.WriteString(styles.SectionHeaderStyle.Render("🔧 System Performance\n"))
			content.WriteString(fmt.Sprintf("Sync Interval: %v\n", status.SyncInterval))
			content.WriteString(fmt.Sprintf("Last Health Check: %s\n", status.LastSync.Format("15:04:05")))
			
			// Health check
			if err := m.taskmaster.HealthCheck(); err != nil {
				content.WriteString(styles.ErrorStyle.Render(fmt.Sprintf("⚠️  Health: %v", err)))
			} else {
				content.WriteString(styles.SuccessStatusStyle.Render("✅ Health: OK"))
			}
		}
	} else {
		// Fallback to epic-based agent content
		content.WriteString(styles.SectionHeaderStyle.Render("🤖 Agent Activity\n\n"))
		
		// Count active agents across all epics
		totalAgents := 0
		agentDetails := make(map[string][]string)
		
		for _, epic := range m.epics {
			if epic.Execution.ParallelAgentsActive > 0 {
				totalAgents += epic.Execution.ParallelAgentsActive
				
				// Group agents by epic
				for _, agent := range epic.Agents.Created {
					agentDetails[epic.Name] = append(agentDetails[epic.Name], agent)
				}
			}
		}
		
		// Display agent information
		if totalAgents > 0 {
			content.WriteString(fmt.Sprintf("Active Agents: %d\n\n", totalAgents))
			
			for epicName, agents := range agentDetails {
				content.WriteString(fmt.Sprintf("%s %s\n", 
					styles.InfoStatusStyle.Render("Epic:"), epicName))
				for _, agent := range agents {
					content.WriteString(fmt.Sprintf("  • %s\n", agent))
				}
				content.WriteString("\n")
			}
		} else {
			content.WriteString(styles.EmptyStateStyle.Render(
				"No active agents\n\nAgents will appear here when TaskMaster workflows are running."))
		}
		
		// Add TaskMaster availability notice
		content.WriteString("\n")
		content.WriteString(styles.WarningStyle.Render(
			"💡 TaskMaster Integration\n\nTaskMaster CLI not available. Install and configure TaskMaster for:\n" +
			"• Real-time agent monitoring\n" +
			"• Agent performance metrics\n" +
			"• Task assignment visualization\n" +
			"• Agent communication logs"))
	}
	
	return styles.HelpStyle.Render(content.String())
}