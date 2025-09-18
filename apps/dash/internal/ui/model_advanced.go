package ui

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/table"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
)

// TabID represents different tab views
type TabID int

const (
	OverviewTab TabID = iota
	EpicsTab
	DocumentsTab
	LogsTab
	HelpTab
)

// AdvancedModel represents the main application model using advanced Bubbles components
type AdvancedModel struct {
	// Core state
	epicDir   string
	width     int
	height    int
	
	// Tab system
	tabs         []string
	activeTab    TabID
	tabHighlight lipgloss.Style
	
	// Data
	epics        []models.Epic
	selectedEpic *models.Epic
	logs         []models.LogEntry
	documents    []DocumentItem
	selectedDoc  *DocumentItem
	
	// Advanced Bubbles components
	epicTable    table.Model
	docTable     table.Model
	logViewport  viewport.Model
	docViewport  viewport.Model
	spinner      spinner.Model
	progress     progress.Model
	
	// State
	loading      bool
	error        string
	lastUpdate   time.Time
	
	// Key bindings
	keys         keyMap
}

// NewAdvancedModel creates a new model with advanced Bubbles components
func NewAdvancedModel(epicDir string) AdvancedModel {
	// Initialize spinner
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#00D4AA"))

	// Initialize progress bar
	prog := progress.New(progress.WithDefaultGradient())

	// Initialize epic table with beautiful styling
	epicColumns := []table.Column{
		{Title: "Epic", Width: 20},
		{Title: "Status", Width: 12},
		{Title: "Progress", Width: 20},
		{Title: "Agents", Width: 8},
		{Title: "Tasks", Width: 12},
		{Title: "Updated", Width: 15},
	}
	
	epicTable := table.New(
		table.WithColumns(epicColumns),
		table.WithFocused(true),
		table.WithHeight(15),
	)
	
	epicTableStyle := table.DefaultStyles()
	epicTableStyle.Header = epicTableStyle.Header.
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("#00D4AA")).
		BorderBottom(true).
		Bold(false)
	epicTableStyle.Selected = epicTableStyle.Selected.
		Foreground(lipgloss.Color("#00D4AA")).
		Background(lipgloss.Color("#1a1a1a")).
		Bold(true)
	epicTable.SetStyles(epicTableStyle)

	// Initialize document table
	docColumns := []table.Column{
		{Title: "Document", Width: 25},
		{Title: "Epic", Width: 15},
		{Title: "Type", Width: 8},
		{Title: "Size", Width: 10},
		{Title: "Modified", Width: 20},
	}
	
	docTable := table.New(
		table.WithColumns(docColumns),
		table.WithFocused(true),
		table.WithHeight(15),
	)
	docTable.SetStyles(epicTableStyle)

	// Initialize viewports
	logVp := viewport.New(0, 0)
	logVp.Style = styles.LogViewerStyle

	docVp := viewport.New(0, 0)
	docVp.Style = styles.LogViewerStyle

	// Tab styling
	tabHighlight := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#00D4AA")).
		Background(lipgloss.Color("#1a1a1a")).
		Padding(0, 2).
		Bold(true)

	return AdvancedModel{
		epicDir:      epicDir,
		tabs:         []string{"📊 Overview", "🚀 Epics", "📚 Documents", "📝 Logs", "❓ Help"},
		activeTab:    OverviewTab,
		tabHighlight: tabHighlight,
		epicTable:    epicTable,
		docTable:     docTable,
		logViewport:  logVp,
		docViewport:  docVp,
		spinner:      s,
		progress:     prog,
		loading:      true,
		lastUpdate:   time.Now(),
		keys:         newKeyMap(),
	}
}

// Init implements tea.Model
func (m AdvancedModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		m.loadInitialData(),
	)
}

// Update implements tea.Model
func (m AdvancedModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.updateComponentSizes()

	case tea.KeyMsg:
		switch {
		case key.Matches(msg, m.keys.Quit):
			return m, tea.Quit
			
		case key.Matches(msg, m.keys.Tab):
			m.nextTab()
			
		case key.Matches(msg, key.NewBinding(key.WithKeys("shift+tab"))):
			m.previousTab()
			
		case key.Matches(msg, m.keys.Enter):
			if m.activeTab == EpicsTab && m.selectedEpic == nil {
				m.selectCurrentEpic()
			} else if m.activeTab == DocumentsTab && m.selectedDoc == nil {
				m.selectCurrentDocument()
			}
			
		case key.Matches(msg, m.keys.Back):
			if m.selectedEpic != nil {
				m.selectedEpic = nil
			} else if m.selectedDoc != nil {
				m.selectedDoc = nil
			}
			
		case key.Matches(msg, m.keys.Refresh):
			cmds = append(cmds, m.loadInitialData())
			
		case key.Matches(msg, key.NewBinding(key.WithKeys("1"))):
			m.activeTab = OverviewTab
		case key.Matches(msg, key.NewBinding(key.WithKeys("2"))):
			m.activeTab = EpicsTab
		case key.Matches(msg, key.NewBinding(key.WithKeys("3"))):
			m.activeTab = DocumentsTab
		case key.Matches(msg, key.NewBinding(key.WithKeys("4"))):
			m.activeTab = LogsTab
		case key.Matches(msg, key.NewBinding(key.WithKeys("5"))):
			m.activeTab = HelpTab
		}

	case models.InitialDataLoadedMsg:
		m.loading = false
		m.epics = msg.Epics
		m.logs = msg.Logs
		m.updateEpicTable()
		m.updateDocumentTable()
		m.updateLogContent()

	case models.EpicUpdateMsg:
		m.handleEpicUpdate(msg)

	case models.LogUpdateMsg:
		m.handleLogUpdate(msg)

	case models.ErrorMsg:
		m.error = string(msg)
		m.loading = false
	}

	// Update focused component based on active tab and state
	switch m.activeTab {
	case EpicsTab:
		if m.selectedEpic == nil {
			m.epicTable, cmd = m.epicTable.Update(msg)
			cmds = append(cmds, cmd)
		}
	case DocumentsTab:
		if m.selectedDoc == nil {
			m.docTable, cmd = m.docTable.Update(msg)
			cmds = append(cmds, cmd)
		} else {
			m.docViewport, cmd = m.docViewport.Update(msg)
			cmds = append(cmds, cmd)
		}
	case LogsTab:
		m.logViewport, cmd = m.logViewport.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Update spinner
	if m.loading {
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

// View implements tea.Model
func (m AdvancedModel) View() string {
	if m.loading {
		return m.loadingView()
	}

	// Render tabs
	tabs := m.renderTabs()
	
	// Render content based on active tab
	var content string
	switch m.activeTab {
	case OverviewTab:
		content = m.overviewView()
	case EpicsTab:
		if m.selectedEpic != nil {
			content = m.epicDetailView()
		} else {
			content = m.epicsTableView()
		}
	case DocumentsTab:
		if m.selectedDoc != nil {
			content = m.documentReaderView()
		} else {
			content = m.documentsTableView()
		}
	case LogsTab:
		content = m.logsView()
	case HelpTab:
		content = m.helpView()
	default:
		content = m.overviewView()
	}

	// Combine tabs and content
	return lipgloss.JoinVertical(
		lipgloss.Left,
		tabs,
		"",
		content,
	)
}

// Tab navigation methods
func (m *AdvancedModel) nextTab() {
	m.activeTab = TabID((int(m.activeTab) + 1) % len(m.tabs))
}

func (m *AdvancedModel) previousTab() {
	m.activeTab = TabID((int(m.activeTab) - 1 + len(m.tabs)) % len(m.tabs))
}

// Component size updates
func (m *AdvancedModel) updateComponentSizes() {
	headerHeight := 4
	tabHeight := 3
	footerHeight := 3
	contentHeight := m.height - headerHeight - tabHeight - footerHeight

	m.epicTable.SetWidth(m.width - 4)
	m.epicTable.SetHeight(contentHeight - 5)

	m.docTable.SetWidth(m.width - 4)
	m.docTable.SetHeight(contentHeight - 5)

	m.logViewport.Width = m.width - 4
	m.logViewport.Height = contentHeight

	m.docViewport.Width = m.width - 4
	m.docViewport.Height = contentHeight
}

// Data update methods
func (m *AdvancedModel) updateEpicTable() {
	var rows []table.Row
	
	for _, epic := range m.epics {
		// Status with emoji
		status := "⏸️ Pending"
		switch epic.Status {
		case "completed":
			status = "✅ Completed"
		case "running", "executing":
			status = "🔄 Running"
		case "failed", "error":
			status = "❌ Failed"
		}

		// Progress bar
		progressBar := epic.GetProgressBar(15)
		progressText := fmt.Sprintf("%.0f%%", epic.Progress)
		progress := progressBar + " " + progressText

		// Agent count
		agents := fmt.Sprintf("%d active", epic.Execution.ParallelAgentsActive)

		// Task summary
		tasks := fmt.Sprintf("%d/%d", 
			len(epic.Execution.TasksCompleted), 
			len(epic.Execution.TasksCompleted)+len(epic.Execution.TasksInProgress))

		// Time since last update
		timeSince := epic.TimeSinceLastUpdate()
		var timeStr string
		if timeSince < time.Minute {
			timeStr = "just now"
		} else if timeSince < time.Hour {
			timeStr = fmt.Sprintf("%dm ago", int(timeSince.Minutes()))
		} else {
			timeStr = epic.LastUpdated.Format("15:04")
		}

		rows = append(rows, table.Row{
			epic.Name,
			status,
			progress,
			agents,
			tasks,
			timeStr,
		})
	}
	
	m.epicTable.SetRows(rows)
}

func (m *AdvancedModel) updateDocumentTable() {
	documents := discoverDocuments(m.epicDir)
	m.documents = documents
	
	var rows []table.Row
	
	for _, doc := range documents {
		// Document type icon
		docType := "📄 Text"
		if doc.IsMarkdown {
			docType = "📝 Markdown"
		}

		// File size
		size := formatFileSize(doc.Size)

		// Modified time
		modified := doc.ModTime.Format("Jan 2 15:04")

		rows = append(rows, table.Row{
			doc.Name,
			doc.EpicName,
			docType,
			size,
			modified,
		})
	}
	
	m.docTable.SetRows(rows)
}

func (m *AdvancedModel) updateLogContent() {
	var content strings.Builder
	
	// Show recent logs (last 50 entries)
	start := 0
	if len(m.logs) > 50 {
		start = len(m.logs) - 50
	}
	
	for i := start; i < len(m.logs); i++ {
		entry := m.logs[i]
		content.WriteString(entry.FormatForDisplay())
		content.WriteString("\n")
	}
	
	m.logViewport.SetContent(content.String())
	m.logViewport.GotoBottom()
}

// Selection methods
func (m *AdvancedModel) selectCurrentEpic() {
	if len(m.epics) > 0 {
		selectedRow := m.epicTable.Cursor()
		if selectedRow < len(m.epics) {
			m.selectedEpic = &m.epics[selectedRow]
		}
	}
}

func (m *AdvancedModel) selectCurrentDocument() {
	if len(m.documents) > 0 {
		selectedRow := m.docTable.Cursor()
		if selectedRow < len(m.documents) {
			m.selectedDoc = &m.documents[selectedRow]
			m.loadDocument(m.selectedDoc)
		}
	}
}

func (m *AdvancedModel) loadDocument(doc *DocumentItem) {
	if !doc.IsMarkdown {
		// For non-markdown files, just show basic info
		content := fmt.Sprintf("📄 %s\n\nFile Type: %s\nSize: %s\nModified: %s\n\nThis file cannot be previewed in the dashboard.",
			doc.Name,
			strings.ToUpper(filepath.Ext(doc.Name)[1:]),
			formatFileSize(doc.Size),
			doc.ModTime.Format("January 2, 2006 at 15:04"))
		m.docViewport.SetContent(content)
		return
	}

	// Read the markdown content
	content, err := os.ReadFile(doc.Path)
	if err != nil {
		errorContent := fmt.Sprintf("❌ Error reading file: %v", err)
		m.docViewport.SetContent(errorContent)
		return
	}

	// Render markdown using Glamour
	renderer, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(m.width-8),
	)
	if err != nil {
		// Fallback to plain text
		m.docViewport.SetContent(string(content))
		return
	}

	rendered, err := renderer.Render(string(content))
	if err != nil {
		// Fallback to plain text
		m.docViewport.SetContent(string(content))
		return
	}

	m.docViewport.SetContent(rendered)
	m.docViewport.GotoTop()
}

// Event handlers
func (m *AdvancedModel) handleEpicUpdate(msg models.EpicUpdateMsg) {
	for i, epic := range m.epics {
		if epic.Name == msg.Epic.Name {
			m.epics[i] = msg.Epic
			break
		}
	}
	
	// If it's a new epic, add it
	found := false
	for _, epic := range m.epics {
		if epic.Name == msg.Epic.Name {
			found = true
			break
		}
	}
	if !found {
		m.epics = append(m.epics, msg.Epic)
	}
	
	m.updateEpicTable()
	m.lastUpdate = time.Now()
}

func (m *AdvancedModel) handleLogUpdate(msg models.LogUpdateMsg) {
	m.logs = append(m.logs, msg.Entry)
	m.updateLogContent()
}

func (m AdvancedModel) loadInitialData() tea.Cmd {
	return tea.Cmd(func() tea.Msg {
		epics, logs := loadExistingData(m.epicDir)
		return models.InitialDataLoadedMsg{
			Epics: epics,
			Logs:  logs,
		}
	})
}