package styles

import (
	"github.com/charmbracelet/lipgloss"
)

// Color palette
var (
	primaryColor   = lipgloss.Color("#00D4AA")
	secondaryColor = lipgloss.Color("#7B68EE")
	accentColor    = lipgloss.Color("#FF6B6B")
	successColor   = lipgloss.Color("#51CF66")
	warningColor   = lipgloss.Color("#FFD43B")
	errorColor     = lipgloss.Color("#FF6B6B")
	infoColor      = lipgloss.Color("#74C0FC")
	agentColor     = lipgloss.Color("#9775FA")
	
	textColor      = lipgloss.Color("#FFFFFF")
	subtleColor    = lipgloss.Color("#A0A0A0")
	borderColor    = lipgloss.Color("#444444")
	backgroundColor = lipgloss.Color("#1A1A1A")
)

// Title and header styles
var (
	TitleStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true).
		Padding(1, 2).
		Background(backgroundColor).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(primaryColor)

	SubtitleStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Italic(true).
		Padding(0, 2)

	SectionHeaderStyle = lipgloss.NewStyle().
		Foreground(secondaryColor).
		Bold(true).
		Padding(0, 1).
		MarginTop(1)
)

// Tab styles
var (
	ActiveTabStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Background(primaryColor).
		Padding(0, 2).
		Bold(true)

	InactiveTabStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Background(backgroundColor).
		Padding(0, 2).
		Border(lipgloss.Border{Bottom: "─"}).
		BorderForeground(borderColor)
)

// Table styles
var (
	TableStyle = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(1).
		MarginTop(1)

	TableHeaderStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true).
		Padding(0, 1)

	TableRowStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Padding(0, 1)

	TableSelectedRowStyle = lipgloss.NewStyle().
		Foreground(backgroundColor).
		Background(primaryColor).
		Padding(0, 1).
		Bold(true)
)

// Status indicator styles
var (
	SuccessStatusStyle = lipgloss.NewStyle().
		Foreground(successColor).
		Bold(true)

	WarningStatusStyle = lipgloss.NewStyle().
		Foreground(warningColor).
		Bold(true)

	ErrorStatusStyle = lipgloss.NewStyle().
		Foreground(errorColor).
		Bold(true)

	InfoStatusStyle = lipgloss.NewStyle().
		Foreground(infoColor).
		Bold(true)

	AgentStatusStyle = lipgloss.NewStyle().
		Foreground(agentColor).
		Bold(true)
)

// Progress bar styles
var (
	ProgressBarStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Background(backgroundColor).
		Padding(0, 1).
		MarginTop(1)

	ProgressBarCompletedStyle = lipgloss.NewStyle().
		Foreground(backgroundColor).
		Background(successColor)

	ProgressBarRemainingStyle = lipgloss.NewStyle().
		Foreground(borderColor).
		Background(backgroundColor)
)

// Log viewer styles
var (
	LogViewerStyle = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(1).
		Height(20)

	LogEntryStyle = lipgloss.NewStyle().
		Foreground(textColor).
		MarginRight(1)

	LogTimestampStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Width(8)

	LogLevelInfoStyle = lipgloss.NewStyle().
		Foreground(infoColor).
		Width(10)

	LogLevelSuccessStyle = lipgloss.NewStyle().
		Foreground(successColor).
		Width(10)

	LogLevelWarningStyle = lipgloss.NewStyle().
		Foreground(warningColor).
		Width(10)

	LogLevelErrorStyle = lipgloss.NewStyle().
		Foreground(errorColor).
		Width(10)

	LogLevelAgentStyle = lipgloss.NewStyle().
		Foreground(agentColor).
		Width(10)

	LogControlsStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Background(backgroundColor).
		Padding(0, 1).
		Border(lipgloss.Border{Bottom: "─"}).
		BorderForeground(borderColor)
)

// Stats and metrics styles
var (
	StatStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Background(backgroundColor).
		Padding(0, 2).
		Margin(0, 1).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor)

	MetricValueStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true)

	MetricLabelStyle = lipgloss.NewStyle().
		Foreground(subtleColor)
)

// State and status styles
var (
	LoadingStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Background(backgroundColor).
		Padding(2, 4).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(primaryColor).
		Bold(true)

	EmptyStateStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Background(backgroundColor).
		Padding(4, 8).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Italic(true)

	ErrorStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Background(errorColor).
		Padding(1, 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(errorColor).
		Bold(true)

	WarningStyle = lipgloss.NewStyle().
		Foreground(backgroundColor).
		Background(warningColor).
		Padding(1, 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(warningColor).
		Bold(true)
)

// Help and info styles
var (
	HelpStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Background(backgroundColor).
		Padding(2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		MarginTop(1)

	KeybindingStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true)

	DescriptionStyle = lipgloss.NewStyle().
		Foreground(subtleColor)
)

// Footer and navigation styles
var (
	FooterStyle = lipgloss.NewStyle().
		Foreground(subtleColor).
		Background(backgroundColor).
		Padding(1, 2).
		Border(lipgloss.Border{Top: "─"}).
		BorderForeground(borderColor).
		MarginTop(1)

	NavigationStyle = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true)

	StatusBarStyle = lipgloss.NewStyle().
		Foreground(textColor).
		Background(primaryColor).
		Padding(0, 2).
		Bold(true)
)

// Utility functions for dynamic styling
func GetLevelStyle(level string) lipgloss.Style {
	switch level {
	case "info":
		return LogLevelInfoStyle
	case "success":
		return LogLevelSuccessStyle
	case "warning":
		return LogLevelWarningStyle
	case "error":
		return LogLevelErrorStyle
	case "agent":
		return LogLevelAgentStyle
	default:
		return LogEntryStyle
	}
}

func GetStatusStyle(status string) lipgloss.Style {
	switch status {
	case "completed", "success":
		return SuccessStatusStyle
	case "failed", "error":
		return ErrorStatusStyle
	case "warning", "retry":
		return WarningStatusStyle
	case "running", "in_progress":
		return InfoStatusStyle
	case "agent":
		return AgentStatusStyle
	default:
		return lipgloss.NewStyle().Foreground(subtleColor)
	}
}

func GetProgressColor(percentage float64) lipgloss.Color {
	if percentage >= 100 {
		return successColor
	} else if percentage >= 75 {
		return primaryColor
	} else if percentage >= 50 {
		return warningColor
	} else if percentage >= 25 {
		return accentColor
	}
	return subtleColor
}