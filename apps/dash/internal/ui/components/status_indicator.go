// Package components provides advanced UI components for HyperDash
package components

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
)

// StatusType represents different types of statuses that can be displayed
type StatusType int

const (
	StatusTypeTask StatusType = iota
	StatusTypeAgent
	StatusTypeSystem
	StatusTypePriority
	StatusTypeProgress
	StatusTypeGeneric
)

// StatusIndicatorConfig holds configuration for a status indicator
type StatusIndicatorConfig struct {
	Type      StatusType
	Value     string
	Label     string
	ShowLabel bool
	Width     int
	Compact   bool
}

// StatusIndicator represents a status indicator component
type StatusIndicator struct {
	config StatusIndicatorConfig
	style  lipgloss.Style
}

// Status character mappings using the predefined set
const (
	// Core status characters
	CharSuccess   = "✔︎"  // Success/Complete
	CharPending   = "⏳︎" // Pending/Waiting
	CharEmpty     = "○"   // Empty/Not started
	CharError     = "⨯"   // Error/Failed
	CharWarning   = "⚠︎"  // Warning/Caution
	CharActive    = "◉"   // Active/Running
	CharBlocked   = "⏺︎"  // Blocked/Stopped
	CharIdle      = "◌"   // Idle/Inactive
	CharProgress  = "▤"   // Progress indicator
	CharPriority  = "✳︎"  // Priority/Important
)

// NewStatusIndicator creates a new status indicator component
func NewStatusIndicator(config StatusIndicatorConfig) *StatusIndicator {
	return &StatusIndicator{
		config: config,
	}
}

// Init initializes the status indicator (implements tea.Model)
func (s *StatusIndicator) Init() tea.Cmd {
	return nil
}

// Update handles messages (implements tea.Model)
func (s *StatusIndicator) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Status indicators are typically static, but could handle updates
	switch msg := msg.(type) {
	case StatusIndicatorConfig:
		s.config = msg
	}
	return s, nil
}

// View renders the status indicator (implements tea.Model)
func (s *StatusIndicator) View() string {
	char := s.getStatusChar()
	style := s.getStatusStyle()
	
	// Build the indicator string
	var parts []string
	
	// Add the status character
	statusStr := style.Render(char)
	parts = append(parts, statusStr)
	
	// Add label if configured
	if s.config.ShowLabel && s.config.Label != "" {
		labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A0A0A0"))
		labelStr := labelStyle.Render(s.config.Label)
		parts = append(parts, labelStr)
	}
	
	result := strings.Join(parts, " ")
	
	// Apply width if specified
	if s.config.Width > 0 {
		if s.config.Compact {
			result = lipgloss.NewStyle().Width(s.config.Width).Render(result)
		} else {
			result = lipgloss.NewStyle().Width(s.config.Width).Align(lipgloss.Left).Render(result)
		}
	}
	
	return result
}

// getStatusChar returns the appropriate character for the current status
func (s *StatusIndicator) getStatusChar() string {
	switch s.config.Type {
	case StatusTypeTask:
		return s.getTaskStatusChar()
	case StatusTypeAgent:
		return s.getAgentStatusChar()
	case StatusTypeSystem:
		return s.getSystemStatusChar()
	case StatusTypePriority:
		return s.getPriorityChar()
	case StatusTypeProgress:
		return s.getProgressChar()
	default:
		return s.getGenericStatusChar()
	}
}

// getTaskStatusChar returns the character for task status
func (s *StatusIndicator) getTaskStatusChar() string {
	switch taskmaster.TaskStatus(s.config.Value) {
	case taskmaster.StatusDone:
		return CharSuccess
	case taskmaster.StatusInProgress:
		return CharActive
	case taskmaster.StatusPending:
		return CharPending
	case taskmaster.StatusBlocked:
		return CharBlocked
	case taskmaster.StatusDeferred:
		return CharIdle
	case taskmaster.StatusCancelled:
		return CharError
	default:
		return CharEmpty
	}
}

// getAgentStatusChar returns the character for agent status
func (s *StatusIndicator) getAgentStatusChar() string {
	switch taskmaster.AgentStatus(s.config.Value) {
	case taskmaster.AgentStatusActive:
		return CharActive
	case taskmaster.AgentStatusBusy:
		return CharProgress
	case taskmaster.AgentStatusIdle:
		return CharIdle
	case taskmaster.AgentStatusError:
		return CharError
	case taskmaster.AgentStatusOffline:
		return CharEmpty
	default:
		return CharEmpty
	}
}

// getSystemStatusChar returns the character for system status
func (s *StatusIndicator) getSystemStatusChar() string {
	switch s.config.Value {
	case "online", "connected", "ready":
		return CharSuccess
	case "offline", "disconnected":
		return CharEmpty
	case "error", "failed":
		return CharError
	case "warning", "degraded":
		return CharWarning
	case "busy", "processing":
		return CharProgress
	default:
		return CharEmpty
	}
}

// getPriorityChar returns the character for priority levels
func (s *StatusIndicator) getPriorityChar() string {
	switch taskmaster.TaskPriority(s.config.Value) {
	case taskmaster.PriorityCritical:
		return CharPriority
	case taskmaster.PriorityHigh:
		return CharWarning
	case taskmaster.PriorityMedium:
		return CharActive
	case taskmaster.PriorityLow:
		return CharEmpty
	default:
		return CharEmpty
	}
}

// getProgressChar returns the character for progress indicators
func (s *StatusIndicator) getProgressChar() string {
	// For progress, we can use different characters based on percentage
	// This is a simplified version - could be expanded with more granular steps
	switch s.config.Value {
	case "0", "none":
		return CharEmpty
	case "25", "started":
		return CharProgress
	case "50", "halfway":
		return CharActive
	case "75", "almost":
		return CharPending
	case "100", "complete":
		return CharSuccess
	default:
		return CharProgress
	}
}

// getGenericStatusChar returns the character for generic status values
func (s *StatusIndicator) getGenericStatusChar() string {
	switch s.config.Value {
	case "success", "complete", "done", "ok":
		return CharSuccess
	case "pending", "waiting", "loading":
		return CharPending
	case "error", "failed", "failure":
		return CharError
	case "warning", "caution", "attention":
		return CharWarning
	case "active", "running", "processing":
		return CharActive
	case "blocked", "stopped", "paused":
		return CharBlocked
	case "idle", "inactive":
		return CharIdle
	case "empty", "none", "null":
		return CharEmpty
	default:
		return CharEmpty
	}
}

// getStatusStyle returns the appropriate style for the current status
func (s *StatusIndicator) getStatusStyle() lipgloss.Style {
	// Use the styles package for consistent styling
	return styles.GetStatusStyle(s.config.Value)
}

// Static helper functions for quick status rendering

// RenderTaskStatus renders a task status indicator
func RenderTaskStatus(status taskmaster.TaskStatus) string {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:  StatusTypeTask,
		Value: string(status),
	})
	return indicator.View()
}

// RenderAgentStatus renders an agent status indicator
func RenderAgentStatus(status taskmaster.AgentStatus) string {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:  StatusTypeAgent,
		Value: string(status),
	})
	return indicator.View()
}

// RenderPriority renders a priority indicator
func RenderPriority(priority taskmaster.TaskPriority) string {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:  StatusTypePriority,
		Value: string(priority),
	})
	return indicator.View()
}

// RenderGenericStatus renders a generic status indicator
func RenderGenericStatus(status string, label string) string {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:      StatusTypeGeneric,
		Value:     status,
		Label:     label,
		ShowLabel: label != "",
	})
	return indicator.View()
}

// RenderStatusWithLabel renders a status with an optional label
func RenderStatusWithLabel(statusType StatusType, value string, label string) string {
	indicator := NewStatusIndicator(StatusIndicatorConfig{
		Type:      statusType,
		Value:     value,
		Label:     label,
		ShowLabel: true,
	})
	return indicator.View()
}

// StatusRow represents a row of multiple status indicators
type StatusRow struct {
	indicators []*StatusIndicator
	separator  string
}

// NewStatusRow creates a new row of status indicators
func NewStatusRow(indicators ...*StatusIndicator) *StatusRow {
	return &StatusRow{
		indicators: indicators,
		separator:  " • ",
	}
}

// SetSeparator sets the separator between status indicators
func (r *StatusRow) SetSeparator(sep string) *StatusRow {
	r.separator = sep
	return r
}

// View renders the status row
func (r *StatusRow) View() string {
	var parts []string
	for _, indicator := range r.indicators {
		parts = append(parts, indicator.View())
	}
	return strings.Join(parts, r.separator)
}

// StatusGrid represents a grid of status indicators
type StatusGrid struct {
	rows      []*StatusRow
	width     int
	alignment lipgloss.Position
}

// NewStatusGrid creates a new status grid
func NewStatusGrid(width int) *StatusGrid {
	return &StatusGrid{
		width:     width,
		alignment: lipgloss.Left,
	}
}

// AddRow adds a row to the grid
func (g *StatusGrid) AddRow(row *StatusRow) *StatusGrid {
	g.rows = append(g.rows, row)
	return g
}

// SetAlignment sets the alignment of the grid
func (g *StatusGrid) SetAlignment(align lipgloss.Position) *StatusGrid {
	g.alignment = align
	return g
}

// View renders the status grid
func (g *StatusGrid) View() string {
	var lines []string
	style := lipgloss.NewStyle().Width(g.width).Align(g.alignment)
	
	for _, row := range g.rows {
		lines = append(lines, style.Render(row.View()))
	}
	
	return strings.Join(lines, "\n")
}

// Helper function for creating a task summary row
func CreateTaskSummaryRow(tasks []taskmaster.Task) *StatusRow {
	// Count tasks by status
	statusCounts := make(map[taskmaster.TaskStatus]int)
	for _, task := range tasks {
		statusCounts[task.Status]++
	}
	
	// Create indicators for each status with count
	var indicators []*StatusIndicator
	
	if count := statusCounts[taskmaster.StatusDone]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusDone),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.StatusInProgress]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusInProgress),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.StatusPending]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusPending),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.StatusBlocked]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeTask,
			Value:     string(taskmaster.StatusBlocked),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	return NewStatusRow(indicators...)
}

// Helper function for creating an agent summary row
func CreateAgentSummaryRow(agents []taskmaster.Agent) *StatusRow {
	// Count agents by status
	statusCounts := make(map[taskmaster.AgentStatus]int)
	for _, agent := range agents {
		statusCounts[agent.Status]++
	}
	
	// Create indicators for each status with count
	var indicators []*StatusIndicator
	
	if count := statusCounts[taskmaster.AgentStatusActive]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusActive),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.AgentStatusBusy]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusBusy),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.AgentStatusIdle]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusIdle),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.AgentStatusError]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusError),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	if count := statusCounts[taskmaster.AgentStatusOffline]; count > 0 {
		indicators = append(indicators, NewStatusIndicator(StatusIndicatorConfig{
			Type:      StatusTypeAgent,
			Value:     string(taskmaster.AgentStatusOffline),
			Label:     fmt.Sprintf("%d", count),
			ShowLabel: true,
		}))
	}
	
	return NewStatusRow(indicators...)
}