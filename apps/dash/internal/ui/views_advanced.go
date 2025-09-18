package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
)

// Tab rendering
func (m AdvancedModel) renderTabs() string {
	var renderedTabs []string
	
	for i, tab := range m.tabs {
		if TabID(i) == m.activeTab {
			renderedTabs = append(renderedTabs, m.tabHighlight.Render(tab))
		} else {
			inactiveStyle := lipgloss.NewStyle().
				Foreground(lipgloss.Color("#666666")).
				Background(lipgloss.Color("#000000")).
				Padding(0, 2)
			renderedTabs = append(renderedTabs, inactiveStyle.Render(tab))
		}
	}
	
	// Join tabs horizontally with spacing
	tabsRow := lipgloss.JoinHorizontal(lipgloss.Top, renderedTabs...)
	
	// Add border underneath
	borderStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#333333")).
		Width(m.width)
	border := borderStyle.Render(strings.Repeat("─", m.width))
	
	return lipgloss.JoinVertical(lipgloss.Left, tabsRow, border)
}

// Loading view
func (m AdvancedModel) loadingView() string {
	content := lipgloss.JoinVertical(
		lipgloss.Center,
		m.spinner.View(),
		"",
		"🚀 Loading HyperDash...",
		"",
		styles.SubtitleStyle.Render(fmt.Sprintf("Monitoring: %s", m.epicDir)),
	)

	return lipgloss.Place(
		m.width, m.height,
		lipgloss.Center, lipgloss.Center,
		styles.LoadingStyle.Render(content),
	)
}

// Overview view with dashboard cards
func (m AdvancedModel) overviewView() string {
	// Stats cards
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

	// Create dashboard cards
	epicCard := m.createDashboardCard("📊 Total Epics", fmt.Sprintf("%d", totalEpics), "#FF6B6B")
	runningCard := m.createDashboardCard("🔄 Running", fmt.Sprintf("%d", runningEpics), "#4ECDC4")
	agentCard := m.createDashboardCard("🤖 Active Agents", fmt.Sprintf("%d", activeAgents), "#45B7D1")
	taskCard := m.createDashboardCard("✅ Tasks Done", fmt.Sprintf("%d", completedTasks), "#96CEB4")

	// Layout cards in a grid
	topRow := lipgloss.JoinHorizontal(lipgloss.Top, epicCard, "  ", runningCard)
	bottomRow := lipgloss.JoinHorizontal(lipgloss.Top, agentCard, "  ", taskCard)
	
	cards := lipgloss.JoinVertical(lipgloss.Left, topRow, "", bottomRow)

	// Recent activity
	activityTitle := styles.SectionHeaderStyle.Render("📈 Recent Activity")
	
	var recentLogs []string
	if len(m.logs) > 0 {
		start := 0
		if len(m.logs) > 5 {
			start = len(m.logs) - 5
		}
		for i := start; i < len(m.logs); i++ {
			entry := m.logs[i]
			icon := entry.Level.GetLevelIcon()
			recentLogs = append(recentLogs, fmt.Sprintf("  %s [%s] %s", icon, entry.EpicName, entry.Message))
		}
	} else {
		recentLogs = append(recentLogs, "  No recent activity")
	}

	activity := lipgloss.JoinVertical(lipgloss.Left, recentLogs...)
	activitySection := lipgloss.JoinVertical(lipgloss.Left, activityTitle, "", activity)

	// System status
	statusTitle := styles.SectionHeaderStyle.Render("🔍 System Status")
	statusItems := []string{
		fmt.Sprintf("  Epic Directory: %s", m.epicDir),
		fmt.Sprintf("  Last Update: %s", m.lastUpdate.Format("15:04:05")),
		fmt.Sprintf("  Documents: %d found", len(m.documents)),
		fmt.Sprintf("  Log Entries: %d", len(m.logs)),
	}
	if m.error != "" {
		statusItems = append(statusItems, fmt.Sprintf("  ❌ Error: %s", m.error))
	} else {
		statusItems = append(statusItems, "  ✅ System operational")
	}

	status := lipgloss.JoinVertical(lipgloss.Left, statusItems...)
	statusSection := lipgloss.JoinVertical(lipgloss.Left, statusTitle, "", status)

	// Combine all sections
	return lipgloss.JoinVertical(
		lipgloss.Left,
		cards,
		"",
		activitySection,
		"",
		statusSection,
		"",
		m.renderNavigationHelp(),
	)
}

// Epic table view
func (m AdvancedModel) epicsTableView() string {
	header := styles.TitleStyle.Render("🚀 Epic Workflows")
	
	// Epic statistics
	stats := fmt.Sprintf("Total: %d epics", len(m.epics))
	statsLine := styles.SubtitleStyle.Render(stats)
	
	// Table
	tableView := m.epicTable.View()
	
	// Footer help
	help := m.renderTableHelp("Enter to select epic, Tab to switch view")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		statsLine,
		"",
		tableView,
		"",
		help,
	)
}

// Epic detail view
func (m AdvancedModel) epicDetailView() string {
	if m.selectedEpic == nil {
		return m.renderError("No epic selected")
	}

	epic := m.selectedEpic
	header := styles.TitleStyle.Render(fmt.Sprintf("📋 Epic: %s", epic.Name))
	
	// Epic info cards
	statusCard := m.createInfoCard("Status", m.formatStatus(epic.Status))
	progressCard := m.createInfoCard("Progress", fmt.Sprintf("%.1f%% complete", epic.Progress))
	agentsCard := m.createInfoCard("Agents", fmt.Sprintf("%d active", epic.Execution.ParallelAgentsActive))
	tasksCard := m.createInfoCard("Tasks", fmt.Sprintf("%d completed", len(epic.Execution.TasksCompleted)))

	infoRow := lipgloss.JoinHorizontal(lipgloss.Top, statusCard, "  ", progressCard, "  ", agentsCard, "  ", tasksCard)

	// Progress bar
	progressPercent := epic.Progress / 100
	progressBar := m.progress.ViewAs(progressPercent)
	progressSection := lipgloss.JoinVertical(
		lipgloss.Left,
		styles.SectionHeaderStyle.Render("📈 Progress"),
		progressBar,
	)

	// Configuration details
	configSection := m.renderEpicConfiguration(epic)

	// Agent details
	agentSection := m.renderAgentDetails(epic)

	// Footer help
	help := m.renderTableHelp("Esc to go back, Tab to switch view")

	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		"",
		infoRow,
		"",
		progressSection,
		"",
		configSection,
		"",
		agentSection,
		"",
		help,
	)
}

// Documents table view
func (m AdvancedModel) documentsTableView() string {
	header := styles.TitleStyle.Render("📚 Epic Documents")
	
	// Document statistics
	totalDocs := len(m.documents)
	markdownCount := 0
	for _, doc := range m.documents {
		if doc.IsMarkdown {
			markdownCount++
		}
	}
	
	stats := fmt.Sprintf("Total: %d documents (%d markdown)", totalDocs, markdownCount)
	statsLine := styles.SubtitleStyle.Render(stats)
	
	// Table
	tableView := m.docTable.View()
	
	// Footer help
	help := m.renderTableHelp("Enter to open document, Tab to switch view")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		statsLine,
		"",
		tableView,
		"",
		help,
	)
}

// Document reader view
func (m AdvancedModel) documentReaderView() string {
	if m.selectedDoc == nil {
		return m.renderError("No document selected")
	}

	doc := m.selectedDoc
	header := styles.TitleStyle.Render(fmt.Sprintf("📖 %s", doc.Name))
	
	// Document info
	info := []string{
		fmt.Sprintf("Size: %s", formatFileSize(doc.Size)),
		fmt.Sprintf("Modified: %s", doc.ModTime.Format("January 2, 2006 at 15:04")),
	}
	if doc.EpicName != "" {
		info = append(info, fmt.Sprintf("Epic: %s", doc.EpicName))
	}
	
	docInfo := styles.SubtitleStyle.Render(strings.Join(info, " • "))
	
	// Document content
	content := styles.LogViewerStyle.Render(m.docViewport.View())
	
	// Footer with scroll info
	scrollInfo := fmt.Sprintf("%.0f%%", m.docViewport.ScrollPercent()*100)
	footer := styles.FooterStyle.Render(
		fmt.Sprintf("Scroll: %s • Esc to go back • Tab to switch view", scrollInfo),
	)
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		docInfo,
		"",
		content,
		"",
		footer,
	)
}

// Logs view
func (m AdvancedModel) logsView() string {
	header := styles.TitleStyle.Render("📝 Live Workflow Logs")
	
	// Log statistics
	stats := fmt.Sprintf("Total: %d log entries", len(m.logs))
	statsLine := styles.SubtitleStyle.Render(stats)
	
	// Log content
	logs := styles.LogViewerStyle.Render(m.logViewport.View())
	
	// Footer with scroll info
	scrollInfo := fmt.Sprintf("%.0f%%", m.logViewport.ScrollPercent()*100)
	footer := styles.FooterStyle.Render(
		fmt.Sprintf("Scroll: %s • Tab to switch view", scrollInfo),
	)
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		statsLine,
		"",
		logs,
		"",
		footer,
	)
}

// Help view
func (m AdvancedModel) helpView() string {
	header := styles.TitleStyle.Render("❓ HyperDash Help")
	
	help := `
🎯 Navigation:
  1-5           Jump to specific tab
  Tab/Shift+Tab Switch between tabs
  ↑/↓, j/k      Navigate lists and tables
  Enter         Select item
  Esc           Go back
  r             Refresh data
  q             Quit

📋 Tabs:
  📊 Overview   Dashboard with key metrics and recent activity
  🚀 Epics      Epic workflow table with detailed status
  📚 Documents  Browse and read markdown files in epics
  📝 Logs       Real-time log viewer with auto-scroll
  ❓ Help       This help screen

🎨 Features:
  • Beautiful table views with sorting and selection
  • Real-time monitoring of epic progress
  • Live agent activity tracking
  • Task completion status with progress bars
  • Markdown document viewing with syntax highlighting
  • Structured log viewing with color coding
  • Responsive layout that adapts to terminal size

🚀 Tips:
  • Use number keys (1-5) for quick tab switching
  • Tables support vim-style navigation (j/k)
  • Documents auto-detect markdown vs plain text
  • Logs auto-scroll to show latest entries
  • Press r to refresh if data seems stale
  • All components are keyboard-accessible
`

	return lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		"",
		styles.HelpStyle.Render(help),
		"",
		m.renderNavigationHelp(),
	)
}

// Helper rendering methods
func (m AdvancedModel) createDashboardCard(title, value, color string) string {
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(color)).
		Padding(1, 2).
		Width(20).
		Height(4)

	titleStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#CCCCCC")).
		Bold(false)

	valueStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color(color)).
		Bold(true).
		Align(lipgloss.Center)

	content := lipgloss.JoinVertical(
		lipgloss.Center,
		titleStyle.Render(title),
		valueStyle.Render(value),
	)

	return cardStyle.Render(content)
}

func (m AdvancedModel) createInfoCard(title, value string) string {
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#666666")).
		Padding(0, 1).
		Width(15)

	titleStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#999999"))

	valueStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FFFFFF")).
		Bold(true)

	content := lipgloss.JoinVertical(
		lipgloss.Left,
		titleStyle.Render(title),
		valueStyle.Render(value),
	)

	return cardStyle.Render(content)
}

func (m AdvancedModel) renderEpicConfiguration(epic *models.Epic) string {
	configTitle := styles.SectionHeaderStyle.Render("🏷️ Configuration")
	
	items := []string{
		fmt.Sprintf("  Tag: %s", m.stringOrEmpty(epic.TagName)),
		fmt.Sprintf("  Max Agents: %d", epic.WorkflowConfig.MaxSubagents),
		fmt.Sprintf("  No Stop: %t", epic.WorkflowConfig.NoStop),
		fmt.Sprintf("  Current Step: %d", epic.CurrentStep),
		fmt.Sprintf("  Completed Steps: %v", epic.CompletedSteps),
	}
	
	config := lipgloss.JoinVertical(lipgloss.Left, items...)
	return lipgloss.JoinVertical(lipgloss.Left, configTitle, config)
}

func (m AdvancedModel) renderAgentDetails(epic *models.Epic) string {
	agentTitle := styles.SectionHeaderStyle.Render("🤖 Agent Details")
	
	items := []string{
		fmt.Sprintf("  Required: %s", strings.Join(epic.Agents.Required, ", ")),
		fmt.Sprintf("  Created: %s", strings.Join(epic.Agents.Created, ", ")),
		fmt.Sprintf("  Available: %s", strings.Join(epic.Agents.Available, ", ")),
		fmt.Sprintf("  Active: %d", epic.Execution.ParallelAgentsActive),
	}
	
	if epic.Execution.LastTaskCompletion != nil {
		items = append(items, fmt.Sprintf("  Last Completion: %s", 
			epic.Execution.LastTaskCompletion.Format("15:04:05")))
	}
	
	agents := lipgloss.JoinVertical(lipgloss.Left, items...)
	return lipgloss.JoinVertical(lipgloss.Left, agentTitle, agents)
}

func (m AdvancedModel) renderTableHelp(message string) string {
	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#666666")).
		Italic(true)
	
	return helpStyle.Render(message)
}

func (m AdvancedModel) renderNavigationHelp() string {
	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#666666")).
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#333333")).
		Padding(0, 1)
	
	help := "Navigation: 1-5 for tabs, Tab/Shift+Tab to cycle, q to quit"
	return helpStyle.Render(help)
}

func (m AdvancedModel) renderError(msg string) string {
	return lipgloss.Place(
		m.width, m.height,
		lipgloss.Center, lipgloss.Center,
		styles.ErrorStyle.Render(msg),
	)
}

func (m AdvancedModel) formatStatus(status string) string {
	switch status {
	case "completed":
		return "✅ Completed"
	case "running", "executing":
		return "🔄 Running"
	case "failed", "error":
		return "❌ Failed"
	default:
		return "⏸️ Pending"
	}
}

func (m AdvancedModel) stringOrEmpty(ptr *string) string {
	if ptr == nil {
		return "None"
	}
	if *ptr == "" {
		return "None"
	}
	return *ptr
}