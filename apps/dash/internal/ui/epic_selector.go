package ui

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/components"
)

// EpicItem represents an epic in the list
type EpicItem struct {
	name        string
	path        string
	description string
}

func (i EpicItem) Title() string       { return i.name }
func (i EpicItem) Description() string { return i.description }
func (i EpicItem) FilterValue() string { return i.name }

// EpicSelectorModel handles epic selection modal
type EpicSelectorModel struct {
	epicsDir       string
	list           list.Model
	epics          []EpicItem
	width, height  int
	showEmptyState bool
	selectedEpic   string
	cancelled      bool
}

// EpicSelectedMsg is sent when an epic is selected
type EpicSelectedMsg struct {
	Path string
	Name string
}

// DirChangeRequestedMsg is sent when user wants to change directory
type DirChangeRequestedMsg struct{}

// RefreshRequestedMsg is sent when user wants to refresh
type RefreshRequestedMsg struct{}

// Layout constants
const (
	modalWidthPercent  = 0.7  // 70% of screen width
	modalHeightPercent = 0.8  // 80% of screen height
	statusBarHeight    = 3    // Height reserved for statusbar and padding
	labelWidth         = 15   // Width of "Epics folder:" label
	buttonWidth        = 12   // Width of Change button
	modalHorizontalPadding      = 1    // Extra margin for safety
)

// NewEpicSelector creates a new epic selector modal
func NewEpicSelector(epicsDir string, width, height int) *EpicSelectorModel {
	modalWidth := int(float64(width) * modalWidthPercent)
	listHeight := int(float64(height)*modalHeightPercent) - statusBarHeight
	
	// Create and configure list model
	l := list.New([]list.Item{}, list.NewDefaultDelegate(), modalWidth-4, listHeight)
	l.Title = "Select Epic"
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(true)
	l.SetShowFilter(true)
	l.SetShowStatusBar(true)
	l.SetShowTitle(true)
	
	// Clean up list styling
	l.Styles.PaginationStyle = lipgloss.NewStyle()
	l.Styles.HelpStyle = lipgloss.NewStyle().
		Align(lipgloss.Right).
		Padding(0, 0)
	
	m := &EpicSelectorModel{
		epicsDir: epicsDir,
		list:     l,
		width:    width,
		height:   height,
	}
	
	m.loadEpics()
	return m
}

// loadEpics scans the epics directory for available epics
func (m *EpicSelectorModel) loadEpics() {
	m.epics = []EpicItem{}
	
	if _, err := os.Stat(m.epicsDir); os.IsNotExist(err) {
		m.showEmptyState = true
		return
	}
	
	err := filepath.WalkDir(m.epicsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		
		if !d.IsDir() {
			return nil
		}
		
		// Skip the root epics directory itself
		if path == m.epicsDir {
			return nil
		}
		
		// Only check direct subdirectories of epicsDir
		rel, err := filepath.Rel(m.epicsDir, path)
		if err != nil {
			return nil
		}
		
		// Skip nested directories
		if strings.Contains(rel, string(filepath.Separator)) {
			return filepath.SkipDir
		}
		
		// Check if this looks like an epic (has workflow-state.json or PRD.md)
		workflowState := filepath.Join(path, "workflow-state.json")
		prdFile := filepath.Join(path, "PRD.md")
		
		if _, err := os.Stat(workflowState); err == nil {
			description := "Epic with workflow state"
			if _, err := os.Stat(prdFile); err == nil {
				description = "Epic with PRD and workflow state"
			}
			
			m.epics = append(m.epics, EpicItem{
				name:        filepath.Base(path),
				path:        path,
				description: description,
			})
		} else if _, err := os.Stat(prdFile); err == nil {
			m.epics = append(m.epics, EpicItem{
				name:        filepath.Base(path),
				path:        path,
				description: "Epic with PRD",
			})
		}
		
		return filepath.SkipDir // Don't go deeper into epic directories
	})
	
	if err != nil {
		m.showEmptyState = true
		return
	}
	
	if len(m.epics) == 0 {
		m.showEmptyState = true
		return
	}
	
	// Convert to list items
	items := make([]list.Item, len(m.epics))
	for i, epic := range m.epics {
		items[i] = epic
	}
	
	m.list.SetItems(items)
	m.showEmptyState = false
}

// Init implements tea.Model
func (m *EpicSelectorModel) Init() tea.Cmd {
	return nil
}

// Update implements tea.Model
func (m *EpicSelectorModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		modalWidth := int(float64(msg.Width) * modalWidthPercent)
		listHeight := int(float64(msg.Height)*modalHeightPercent) - statusBarHeight
		m.list.SetSize(modalWidth-4, listHeight)
		
	case tea.KeyMsg:
		if m.showEmptyState {
			switch msg.String() {
			case "1":
				return m, func() tea.Msg { return DirChangeRequestedMsg{} }
			case "2":
				m.loadEpics()
				return m, func() tea.Msg { return RefreshRequestedMsg{} }
			case "q":
				m.cancelled = true
				return m, tea.Quit
			}
		} else {
			switch msg.String() {
			case "enter":
				if selected := m.list.SelectedItem(); selected != nil {
					if epic, ok := selected.(EpicItem); ok {
						m.selectedEpic = epic.path
						return m, tea.Quit
					}
				}
			case "q":
				m.cancelled = true
				return m, tea.Quit
			case "c":
				return m, func() tea.Msg { return DirChangeRequestedMsg{} }
			default:
				// Let list handle other keys
				var cmd tea.Cmd
				m.list, cmd = m.list.Update(msg)
				return m, cmd
			}
		}
	}
	
	return m, nil
}

// truncatePath truncates a path to fit within the available width
func (m *EpicSelectorModel) truncatePath(path string, maxWidth int) string {
	if len(path) <= maxWidth {
		return path
	}
	return "..." + path[len(path)-maxWidth+3:]
}

// getModalWidth returns the calculated modal width
func (m *EpicSelectorModel) getModalWidth() int {
	return int(float64(m.width) * modalWidthPercent)
}

// View implements tea.Model
func (m *EpicSelectorModel) View() string {
	if m.showEmptyState {
		return m.renderEmptyState()
	}
	
	modalWidth := m.getModalWidth()
	modalStyle := lipgloss.NewStyle().
		Width(modalWidth).
		Height(int(float64(m.height) * modalHeightPercent)).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("62")).
		Padding(1, modalHorizontalPadding, 0)
	
	// Create bottom bar components
	changeButton := components.NewButton("Change", components.Primary)
	availablePathWidth := modalWidth - labelWidth - buttonWidth - modalHorizontalPadding*2
	truncatedPath := m.truncatePath(m.epicsDir, availablePathWidth)
	
	// Create status bar section with label and path
	statusBarSection := lipgloss.NewStyle().
		Background(lipgloss.Color("#9966CC")).
		Foreground(lipgloss.Color("#FFF")).
		Padding(0, 1).
		Render("Epics folder:") + 
		lipgloss.NewStyle().
		Background(lipgloss.Color("#D9DCCF")).
		Foreground(lipgloss.Color("#343433")).
		Padding(0,1).
		Width(availablePathWidth).
		Render(truncatedPath)
	
	// Combine status bar and button
	bottomBar := lipgloss.NewStyle().
		Width(modalWidth - 1).
		Padding(0).
		Margin(0).
		Render(
			lipgloss.JoinHorizontal(
				lipgloss.Left,
				statusBarSection,
				changeButton.View(),
			),
		)
	
	listContent := lipgloss.JoinVertical(
		lipgloss.Left,
		m.list.View(),
		bottomBar,
	)
	
	modal := modalStyle.Render(listContent)
	
	// Center the modal 
	centeredModal := lipgloss.Place(
		m.width,
		m.height-1, // Leave exactly 1 line for help text
		lipgloss.Center,
		lipgloss.Center,
		modal,
	)
	
	// Help text at bottom - positioned at very bottom of screen
	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Width(m.width).
		Align(lipgloss.Center)
	
	helpText := helpStyle.Render("Enter to select • C to change folder • Q to cancel")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		centeredModal,
		helpText,
	)
}

func (m *EpicSelectorModel) renderEmptyState() string {
	modalWidth := m.getModalWidth()
	modalStyle := lipgloss.NewStyle().
		Width(modalWidth).
		Height(int(float64(m.height) * modalHeightPercent)).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("62")).
		Padding(1).
		Align(lipgloss.Center, lipgloss.Center)
	
	content := fmt.Sprintf(`Select Epic

No epics found in directory:
%s

Actions:
1) Change epics folder
2) Refresh`, m.epicsDir)
	
	modal := modalStyle.Render(content)
	
	// Center the modal and add help text at bottom
	centeredModal := lipgloss.Place(
		m.width,
		m.height-2,
		lipgloss.Center,
		lipgloss.Center,
		modal,
	)
	
	// Help text at bottom
	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Width(m.width).
		Align(lipgloss.Center)
	
	helpText := helpStyle.Render("1/2 to act • Q to cancel")
	
	return lipgloss.JoinVertical(
		lipgloss.Left,
		centeredModal,
		helpText,
	)
}

// GetSelectedEpic returns the path of the selected epic
func (m *EpicSelectorModel) GetSelectedEpic() string {
	return m.selectedEpic
}

// IsCancelled returns whether the user cancelled the selection
func (m *EpicSelectorModel) IsCancelled() bool {
	return m.cancelled
}