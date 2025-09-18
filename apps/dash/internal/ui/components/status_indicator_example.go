// +build ignore

// Example usage of the StatusIndicator component
// Run with: go run status_indicator_example.go
package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/components"
)

// ExampleModel demonstrates the StatusIndicator component
type ExampleModel struct {
	width  int
	height int
}

func (m ExampleModel) Init() tea.Cmd {
	return nil
}

func (m ExampleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m ExampleModel) View() string {
	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#00D4AA")).
		MarginBottom(1)
	
	sectionStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#7B68EE")).
		MarginTop(1).
		MarginBottom(1)
	
	var output string
	
	// Title
	output += titleStyle.Render("StatusIndicator Component Examples") + "\n\n"
	
	// Task Status Examples
	output += sectionStyle.Render("Task Status Indicators:") + "\n"
	output += fmt.Sprintf("  Done:         %s\n", components.RenderTaskStatus(taskmaster.StatusDone))
	output += fmt.Sprintf("  In Progress:  %s\n", components.RenderTaskStatus(taskmaster.StatusInProgress))
	output += fmt.Sprintf("  Pending:      %s\n", components.RenderTaskStatus(taskmaster.StatusPending))
	output += fmt.Sprintf("  Blocked:      %s\n", components.RenderTaskStatus(taskmaster.StatusBlocked))
	output += fmt.Sprintf("  Deferred:     %s\n", components.RenderTaskStatus(taskmaster.StatusDeferred))
	output += fmt.Sprintf("  Cancelled:    %s\n", components.RenderTaskStatus(taskmaster.StatusCancelled))
	output += "\n"
	
	// Agent Status Examples
	output += sectionStyle.Render("Agent Status Indicators:") + "\n"
	output += fmt.Sprintf("  Active:       %s\n", components.RenderAgentStatus(taskmaster.AgentStatusActive))
	output += fmt.Sprintf("  Busy:         %s\n", components.RenderAgentStatus(taskmaster.AgentStatusBusy))
	output += fmt.Sprintf("  Idle:         %s\n", components.RenderAgentStatus(taskmaster.AgentStatusIdle))
	output += fmt.Sprintf("  Error:        %s\n", components.RenderAgentStatus(taskmaster.AgentStatusError))
	output += fmt.Sprintf("  Offline:      %s\n", components.RenderAgentStatus(taskmaster.AgentStatusOffline))
	output += "\n"
	
	// Priority Examples
	output += sectionStyle.Render("Priority Indicators:") + "\n"
	output += fmt.Sprintf("  Critical:     %s\n", components.RenderPriority(taskmaster.PriorityCritical))
	output += fmt.Sprintf("  High:         %s\n", components.RenderPriority(taskmaster.PriorityHigh))
	output += fmt.Sprintf("  Medium:       %s\n", components.RenderPriority(taskmaster.PriorityMedium))
	output += fmt.Sprintf("  Low:          %s\n", components.RenderPriority(taskmaster.PriorityLow))
	output += "\n"
	
	// Status with Labels
	output += sectionStyle.Render("Status Indicators with Labels:") + "\n"
	output += fmt.Sprintf("  Tasks:        %s\n", 
		components.RenderStatusWithLabel(
			components.StatusTypeTask, 
			string(taskmaster.StatusInProgress), 
			"Building",
		))
	output += fmt.Sprintf("  Agents:       %s\n", 
		components.RenderStatusWithLabel(
			components.StatusTypeAgent, 
			string(taskmaster.AgentStatusActive), 
			"2 Active",
		))
	output += fmt.Sprintf("  System:       %s\n", 
		components.RenderGenericStatus("online", "Connected"))
	output += "\n"
	
	// Task Summary Row
	output += sectionStyle.Render("Task Summary Row:") + "\n"
	tasks := []taskmaster.Task{
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusDone},
		{Status: taskmaster.StatusInProgress},
		{Status: taskmaster.StatusInProgress},
		{Status: taskmaster.StatusPending},
		{Status: taskmaster.StatusPending},
		{Status: taskmaster.StatusPending},
		{Status: taskmaster.StatusPending},
		{Status: taskmaster.StatusBlocked},
	}
	summaryRow := components.CreateTaskSummaryRow(tasks)
	output += "  " + summaryRow.View() + "\n\n"
	
	// Agent Summary Row
	output += sectionStyle.Render("Agent Summary Row:") + "\n"
	agents := []taskmaster.Agent{
		{Status: taskmaster.AgentStatusActive},
		{Status: taskmaster.AgentStatusActive},
		{Status: taskmaster.AgentStatusBusy},
		{Status: taskmaster.AgentStatusIdle},
		{Status: taskmaster.AgentStatusOffline},
	}
	agentRow := components.CreateAgentSummaryRow(agents)
	output += "  " + agentRow.View() + "\n\n"
	
	// Status Grid Example
	output += sectionStyle.Render("Status Grid Example:") + "\n"
	grid := components.NewStatusGrid(50)
	
	// Add task row
	taskIndicators := []*components.StatusIndicator{
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeGeneric,
			Value:     "success",
			Label:     "Build",
			ShowLabel: true,
		}),
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeGeneric,
			Value:     "running",
			Label:     "Tests",
			ShowLabel: true,
		}),
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeGeneric,
			Value:     "pending",
			Label:     "Deploy",
			ShowLabel: true,
		}),
	}
	grid.AddRow(components.NewStatusRow(taskIndicators...))
	
	// Add system row
	systemIndicators := []*components.StatusIndicator{
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeSystem,
			Value:     "online",
			Label:     "API",
			ShowLabel: true,
		}),
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeSystem,
			Value:     "warning",
			Label:     "Database",
			ShowLabel: true,
		}),
		components.NewStatusIndicator(components.StatusIndicatorConfig{
			Type:      components.StatusTypeSystem,
			Value:     "processing",
			Label:     "Queue",
			ShowLabel: true,
		}),
	}
	grid.AddRow(components.NewStatusRow(systemIndicators...))
	
	gridView := grid.View()
	for _, line := range lipgloss.NewStyle().MarginLeft(2).Render(gridView) {
		output += string(line)
	}
	output += "\n\n"
	
	// Character Reference
	output += sectionStyle.Render("Character Reference:") + "\n"
	output += fmt.Sprintf("  Success:      %s (✔︎)\n", components.CharSuccess)
	output += fmt.Sprintf("  Pending:      %s (⏳︎)\n", components.CharPending)
	output += fmt.Sprintf("  Empty:        %s (○)\n", components.CharEmpty)
	output += fmt.Sprintf("  Error:        %s (⨯)\n", components.CharError)
	output += fmt.Sprintf("  Warning:      %s (⚠︎)\n", components.CharWarning)
	output += fmt.Sprintf("  Active:       %s (◉)\n", components.CharActive)
	output += fmt.Sprintf("  Blocked:      %s (⏺︎)\n", components.CharBlocked)
	output += fmt.Sprintf("  Idle:         %s (◌)\n", components.CharIdle)
	output += fmt.Sprintf("  Progress:     %s (▤)\n", components.CharProgress)
	output += fmt.Sprintf("  Priority:     %s (✳︎)\n", components.CharPriority)
	output += "\n"
	
	// Footer
	footerStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#A0A0A0")).
		MarginTop(1)
	output += footerStyle.Render("Press 'q' to quit")
	
	return output
}

func main() {
	p := tea.NewProgram(ExampleModel{})
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}