package ui

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/cache"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/models"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/performance"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/styles"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
)

// ViewMode represents the current view mode
type ViewMode int

const (
	OverviewView ViewMode = iota
	TasksView
	AgentsView
	DocumentsView
	LogsView
	PerformanceView
	HelpView
)

// DocumentItem represents a markdown document in the epic directory
type DocumentItem struct {
	Name        string
	Path        string
	EpicName    string
	Size        int64
	ModTime     time.Time
	IsMarkdown  bool
}

func (d DocumentItem) FilterValue() string { return d.Name }
func (d DocumentItem) Title() string       { return d.Name }
func (d DocumentItem) Description() string {
	size := formatFileSize(d.Size)
	epicInfo := ""
	if d.EpicName != "" {
		epicInfo = fmt.Sprintf(" • Epic: %s", d.EpicName)
	}
	
	icon := "📄"
	if d.IsMarkdown {
		icon = "📝"
	}
	
	return fmt.Sprintf("%s %s • Modified: %s%s", icon, size, d.ModTime.Format("Jan 2 15:04"), epicInfo)
}

// Model represents the main application model using proper Bubbles components
type Model struct {
	// Core state
	epicDir   string
	viewMode  ViewMode
	width     int
	height    int
	
	// Data
	epics        []models.Epic
	selectedEpic *models.Epic
	logs         []models.LogEntry
	documents    []DocumentItem
	selectedDoc  *DocumentItem
	
	// Bubbles components
	epicList     list.Model
	docList      list.Model
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
	
	// Tasks view state
	tasksViewport viewport.Model
	
	// Vi-mode state
	viMode           bool
	searchMode       bool
	commandMode      bool
	searchQuery      string
	commandInput     string
	lastGPressed     bool // Track for gg sequence
	lastGPressTime   time.Time
	
	// TaskMaster integration
	taskmaster       *taskmaster.Integration
	taskmasterTasks  []taskmaster.Task
	taskmasterAgents []taskmaster.Agent
	taskmasterStatus taskmaster.SystemStatus
	
	// Performance monitoring
	perfMonitor      *performance.Monitor
	perfViewport     viewport.Model
	perfMetrics      performance.Metrics
	perfHistory      []performance.Metrics
	cacheSystem      *cache.Cache
	lazyLoader       *cache.LazyLoader
	bgWorker         *performance.BackgroundWorker
}

// EpicItem represents an epic in the list component
type EpicItem struct {
	Epic models.Epic
}

func (i EpicItem) FilterValue() string { return i.Epic.Name }
func (i EpicItem) Title() string       { return i.Epic.Name }
func (i EpicItem) Description() string {
	status := i.Epic.Status
	switch status {
	case "completed":
		status = "✅ Completed"
	case "running", "executing":
		status = "🔄 Running"
	case "failed", "error":
		status = "❌ Failed"
	default:
		status = "⏸️ Pending"
	}
	
	agents := "No agents"
	if i.Epic.Execution.ParallelAgentsActive > 0 {
		agents = fmt.Sprintf("%d active agents", i.Epic.Execution.ParallelAgentsActive)
	}
	
	return fmt.Sprintf("%s • %.0f%% complete • %s", status, i.Epic.Progress, agents)
}

// Key bindings
type keyMap struct {
	Up      key.Binding
	Down    key.Binding
	Left    key.Binding
	Right   key.Binding
	Enter   key.Binding
	Back    key.Binding
	Quit    key.Binding
	Help    key.Binding
	Refresh key.Binding
	Tab     key.Binding
	// Number keys for direct tab navigation
	One     key.Binding
	Two     key.Binding
	Three   key.Binding
	Four    key.Binding
	Five    key.Binding
	Six     key.Binding
	Seven   key.Binding
	// Vi-mode navigation enhancements
	GotoTop    key.Binding // gg - goto top
	GotoBottom key.Binding // G - goto bottom
	Search     key.Binding // / - search
	Command    key.Binding // : - command mode
}

func newKeyMap() keyMap {
	return keyMap{
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "move up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "move down"),
		),
		Left: key.NewBinding(
			key.WithKeys("left", "h"),
			key.WithHelp("←/h", "move left"),
		),
		Right: key.NewBinding(
			key.WithKeys("right", "l"),
			key.WithHelp("→/l", "move right"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "select"),
		),
		Back: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "back"),
		),
		Quit: key.NewBinding(
			key.WithKeys("q", "ctrl+c"),
			key.WithHelp("q", "quit"),
		),
		Help: key.NewBinding(
			key.WithKeys("?"),
			key.WithHelp("?", "toggle help"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("r"),
			key.WithHelp("r", "refresh"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "next view"),
		),
		One: key.NewBinding(
			key.WithKeys("1"),
			key.WithHelp("1", "overview"),
		),
		Two: key.NewBinding(
			key.WithKeys("2"),
			key.WithHelp("2", "tasks"),
		),
		Three: key.NewBinding(
			key.WithKeys("3"),
			key.WithHelp("3", "agents"),
		),
		Four: key.NewBinding(
			key.WithKeys("4"),
			key.WithHelp("4", "docs"),
		),
		Five: key.NewBinding(
			key.WithKeys("5"),
			key.WithHelp("5", "logs"),
		),
		Six: key.NewBinding(
			key.WithKeys("6"),
			key.WithHelp("6", "performance"),
		),
		Seven: key.NewBinding(
			key.WithKeys("7"),
			key.WithHelp("7", "help"),
		),
		// Vi-mode navigation enhancements
		GotoTop: key.NewBinding(
			key.WithKeys("g"),
			key.WithHelp("gg", "goto top"),
		),
		GotoBottom: key.NewBinding(
			key.WithKeys("G"),
			key.WithHelp("G", "goto bottom"),
		),
		Search: key.NewBinding(
			key.WithKeys("/"),
			key.WithHelp("/", "search"),
		),
		Command: key.NewBinding(
			key.WithKeys(":"),
			key.WithHelp(":", "command"),
		),
	}
}

// ShortHelp returns keybindings to be shown in the mini help view
func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Help, k.Quit}
}

// FullHelp returns keybindings for the expanded help view
func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Up, k.Down, k.Left, k.Right},
		{k.Enter, k.Back, k.Tab, k.Refresh},
		{k.Help, k.Quit},
	}
}

// InitialModel creates a new model with proper Bubbles components
func InitialModel(epicDir string) Model {
	// Initialize spinner
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#00D4AA"))

	// Initialize progress bar
	prog := progress.New(progress.WithDefaultGradient())

	// Initialize epic list
	epicList := list.New([]list.Item{}, newEpicDelegate(), 0, 0)
	epicList.Title = "🚀 HyperDash - Epic Workflows"
	epicList.SetShowStatusBar(true)
	epicList.SetFilteringEnabled(true)
	epicList.Styles.Title = styles.TitleStyle
	epicList.Styles.PaginationStyle = styles.SubtitleStyle
	epicList.Styles.HelpStyle = styles.HelpStyle

	// Initialize document list
	docList := list.New([]list.Item{}, newDocumentDelegate(), 0, 0)
	docList.Title = "📚 Epic Documents"
	docList.SetShowStatusBar(true)
	docList.SetFilteringEnabled(true)
	docList.Styles.Title = styles.TitleStyle
	docList.Styles.PaginationStyle = styles.SubtitleStyle
	docList.Styles.HelpStyle = styles.HelpStyle

	// Initialize viewports
	logVp := viewport.New(0, 0)
	logVp.Style = styles.LogViewerStyle

	docVp := viewport.New(0, 0)
	docVp.Style = styles.LogViewerStyle

	// Initialize tasks viewport
	tasksVp := viewport.New(0, 0)
	tasksVp.Style = styles.LogViewerStyle

	// Initialize TaskMaster integration
	tmIntegration := taskmaster.NewIntegration(taskmaster.IntegrationConfig{
		EpicDir:        epicDir,
		UpdateInterval: 5 * time.Second,
		ClientConfig: taskmaster.ClientConfig{
			Command:    "task-master",
			WorkingDir: epicDir,
			Timeout:    30 * time.Second,
		},
	})
	
	// Initialize performance monitoring
	perfMonitor, _ := performance.NewMonitor(performance.DefaultMonitorOptions())
	
	// Initialize cache system
	cacheSystem, _ := cache.New(cache.DefaultOptions())
	
	// Initialize background worker
	bgWorker := performance.NewBackgroundWorker(performance.DefaultWorkerOptions())
	
	// Initialize performance viewport
	perfVp := viewport.New(0, 0)
	perfVp.Style = styles.LogViewerStyle

	return Model{
		epicDir:       epicDir,
		viewMode:      OverviewView,
		epicList:      epicList,
		docList:       docList,
		logViewport:   logVp,
		docViewport:   docVp,
		tasksViewport: tasksVp,
		perfViewport:  perfVp,
		spinner:       s,
		progress:      prog,
		loading:       true,
		lastUpdate:    time.Now(),
		keys:          newKeyMap(),
		taskmaster:    tmIntegration,
		perfMonitor:   perfMonitor,
		cacheSystem:   cacheSystem,
		bgWorker:      bgWorker,
	}
}

// Epic delegate for the list component
type epicDelegate struct{}

func newEpicDelegate() epicDelegate {
	return epicDelegate{}
}

func (d epicDelegate) Height() int                             { return 3 }
func (d epicDelegate) Spacing() int                            { return 1 }
func (d epicDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d epicDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	item, ok := listItem.(EpicItem)
	if !ok {
		return
	}

	epic := item.Epic
	
	// Create status indicator
	var statusStyle lipgloss.Style
	var statusIcon string
	switch epic.Status {
	case "completed":
		statusStyle = styles.SuccessStatusStyle
		statusIcon = "✅"
	case "running", "executing":
		statusStyle = styles.InfoStatusStyle
		statusIcon = "🔄"
	case "failed", "error":
		statusStyle = styles.ErrorStatusStyle
		statusIcon = "❌"
	default:
		statusStyle = styles.WarningStatusStyle
		statusIcon = "⏸️"
	}

	// Create progress bar
	progressBar := epic.GetProgressBar(20)
	progressText := fmt.Sprintf("%.0f%%", epic.Progress)

	// Create agent info
	agentText := fmt.Sprintf("%d active", epic.Execution.ParallelAgentsActive)
	if epic.Execution.ParallelAgentsActive == 0 {
		agentText = "idle"
	}

	// Create time since last update
	timeSince := epic.TimeSinceLastUpdate()
	var timeText string
	if timeSince < time.Minute {
		timeText = "just now"
	} else if timeSince < time.Hour {
		timeText = fmt.Sprintf("%dm ago", int(timeSince.Minutes()))
	} else {
		timeText = epic.LastUpdated.Format("15:04")
	}

	// Format the epic item
	title := statusIcon + " " + epic.Name
	if index == m.Index() {
		title = styles.ActiveTabStyle.Render(title)
	} else {
		title = lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFFFF")).Render(title)
	}

	info := lipgloss.JoinHorizontal(
		lipgloss.Left,
		statusStyle.Render(epic.Status),
		"  ",
		progressBar,
		" ",
		progressText,
		"  ",
		styles.AgentStatusStyle.Render(agentText),
		"  ",
		styles.SubtitleStyle.Render(timeText),
	)

	taskInfo := fmt.Sprintf("Tasks: %d completed, %d in progress", 
		len(epic.Execution.TasksCompleted), 
		len(epic.Execution.TasksInProgress))

	result := lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		info,
		styles.SubtitleStyle.Render(taskInfo),
	)

	fmt.Fprint(w, result)
}

// Document delegate for the list component
type documentDelegate struct{}

func newDocumentDelegate() documentDelegate {
	return documentDelegate{}
}

func (d documentDelegate) Height() int                             { return 2 }
func (d documentDelegate) Spacing() int                            { return 1 }
func (d documentDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d documentDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	item, ok := listItem.(DocumentItem)
	if !ok {
		return
	}

	doc := item
	
	// Create icon based on file type
	icon := "📄"
	if doc.IsMarkdown {
		icon = "📝"
	}

	// Format the document item
	title := icon + " " + doc.Name
	if index == m.Index() {
		title = styles.ActiveTabStyle.Render(title)
	} else {
		title = lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFFFF")).Render(title)
	}

	// Create info line
	size := formatFileSize(doc.Size)
	timeStr := doc.ModTime.Format("Jan 2 15:04")
	epicInfo := ""
	if doc.EpicName != "" {
		epicInfo = " • " + doc.EpicName
	}

	info := styles.SubtitleStyle.Render(fmt.Sprintf("%s • %s%s", size, timeStr, epicInfo))

	result := lipgloss.JoinVertical(
		lipgloss.Left,
		title,
		info,
	)

	fmt.Fprint(w, result)
}

// Init implements tea.Model
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		m.loadInitialData(),
	)
}

// Update implements tea.Model
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
			m.nextView()
			
		case key.Matches(msg, m.keys.Back):
			m.previousView()
			
		// Number key shortcuts for direct tab navigation
		case key.Matches(msg, m.keys.One):
			m.viewMode = OverviewView
			
		case key.Matches(msg, m.keys.Two):
			m.viewMode = TasksView
			
		case key.Matches(msg, m.keys.Three):
			m.viewMode = AgentsView
			
		case key.Matches(msg, m.keys.Four):
			m.viewMode = DocumentsView
			m.selectedDoc = nil // Reset document selection when switching
			
		case key.Matches(msg, m.keys.Five):
			m.viewMode = LogsView
			
		case key.Matches(msg, m.keys.Six):
			m.viewMode = PerformanceView
			
		case key.Matches(msg, m.keys.Seven):
			m.viewMode = HelpView
			
		case key.Matches(msg, m.keys.Enter):
			if m.viewMode == OverviewView {
				if selectedItem, ok := m.epicList.SelectedItem().(EpicItem); ok {
					m.selectedEpic = &selectedItem.Epic
				}
			} else if m.viewMode == DocumentsView {
				if selectedItem, ok := m.docList.SelectedItem().(DocumentItem); ok {
					m.selectedDoc = &selectedItem
					m.loadDocument(&selectedItem)
				}
			}
			
		case key.Matches(msg, m.keys.Refresh):
			cmds = append(cmds, m.loadInitialData())
			
		// Vi-mode navigation enhancements
		case key.Matches(msg, m.keys.GotoTop):
			// Handle gg sequence (goto top)
			if m.lastGPressed && time.Since(m.lastGPressTime) < 500*time.Millisecond {
				// Second g pressed within 500ms - goto top
				m.gotoTop()
				m.lastGPressed = false
			} else {
				// First g pressed - start sequence
				m.lastGPressed = true
				m.lastGPressTime = time.Now()
			}
			
		case key.Matches(msg, m.keys.GotoBottom):
			// G - goto bottom
			m.gotoBottom()
			m.lastGPressed = false // Reset gg sequence
			
		case key.Matches(msg, m.keys.Search):
			// / - start search mode
			m.searchMode = true
			m.commandMode = false
			m.searchQuery = ""
			m.lastGPressed = false
			
		case key.Matches(msg, m.keys.Command):
			// : - start command mode
			m.commandMode = true
			m.searchMode = false
			m.commandInput = ""
			m.lastGPressed = false
			
		default:
			// Handle search/command input
			if m.searchMode || m.commandMode {
				m.handleSearchCommandInput(msg)
			}
			// Reset gg sequence on any other key
			m.lastGPressed = false
		}

	case models.InitialDataLoadedMsg:
		m.loading = false
		m.epics = msg.Epics
		m.logs = msg.Logs
		m.updateEpicList()
		m.updateDocumentList()
		m.updateLogContent()

	case models.EpicUpdateMsg:
		m.handleEpicUpdate(msg)

	case models.LogUpdateMsg:
		m.handleLogUpdate(msg)

	case models.ErrorMsg:
		m.error = string(msg)
		m.loading = false
	}

	// Update focused component
	switch m.viewMode {
	case OverviewView:
		m.epicList, cmd = m.epicList.Update(msg)
		cmds = append(cmds, cmd)
	case TasksView:
		m.tasksViewport, cmd = m.tasksViewport.Update(msg)
		cmds = append(cmds, cmd)
	case AgentsView:
		// Agents view will be handled when implemented
	case DocumentsView:
		if m.selectedDoc == nil {
			m.docList, cmd = m.docList.Update(msg)
			cmds = append(cmds, cmd)
		} else {
			m.docViewport, cmd = m.docViewport.Update(msg)
			cmds = append(cmds, cmd)
		}
	case LogsView:
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
func (m Model) View() string {
	if m.loading {
		return m.loadingView()
	}

	switch m.viewMode {
	case OverviewView:
		return m.overviewView()
	case TasksView:
		return m.tasksView()
	case AgentsView:
		return m.agentsView()
	case DocumentsView:
		return m.documentsView()
	case LogsView:
		return m.logsView()
	case PerformanceView:
		return m.performanceView()
	case HelpView:
		return m.helpView()
	default:
		return m.overviewView()
	}
}

// Helper methods
func (m *Model) updateComponentSizes() {
	headerHeight := 4
	footerHeight := 3
	contentHeight := m.height - headerHeight - footerHeight

	m.epicList.SetWidth(m.width - 4)
	m.epicList.SetHeight(contentHeight)

	m.docList.SetWidth(m.width - 4)
	m.docList.SetHeight(contentHeight)

	m.logViewport.Width = m.width - 4
	m.logViewport.Height = contentHeight

	m.docViewport.Width = m.width - 4
	m.docViewport.Height = contentHeight

	m.tasksViewport.Width = m.width - 4
	m.tasksViewport.Height = contentHeight
}

func (m *Model) nextView() {
	switch m.viewMode {
	case OverviewView:
		m.viewMode = TasksView
	case TasksView:
		m.viewMode = AgentsView
	case AgentsView:
		m.viewMode = DocumentsView
	case DocumentsView:
		m.viewMode = LogsView
	case LogsView:
		m.viewMode = PerformanceView
	case PerformanceView:
		m.viewMode = HelpView
	case HelpView:
		m.viewMode = OverviewView
	}
}

func (m *Model) previousView() {
	switch m.viewMode {
	case OverviewView:
		m.viewMode = HelpView
	case TasksView:
		m.viewMode = OverviewView
	case AgentsView:
		m.viewMode = TasksView
	case DocumentsView:
		if m.selectedDoc != nil {
			m.selectedDoc = nil
		} else {
			m.viewMode = AgentsView
		}
	case LogsView:
		m.viewMode = DocumentsView
	case PerformanceView:
		m.viewMode = LogsView
	case HelpView:
		m.viewMode = PerformanceView
	default:
		m.viewMode = OverviewView
	}
}

func (m *Model) updateEpicList() {
	items := make([]list.Item, len(m.epics))
	for i, epic := range m.epics {
		items[i] = EpicItem{Epic: epic}
	}
	m.epicList.SetItems(items)
}

func (m *Model) handleEpicUpdate(msg models.EpicUpdateMsg) {
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
	
	m.updateEpicList()
	m.lastUpdate = time.Now()
}

func (m *Model) handleLogUpdate(msg models.LogUpdateMsg) {
	m.logs = append(m.logs, msg.Entry)
	m.updateLogContent()
}

func (m *Model) updateLogContent() {
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

func (m *Model) updateDocumentList() {
	documents := discoverDocuments(m.epicDir)
	items := make([]list.Item, len(documents))
	for i, doc := range documents {
		items[i] = doc
	}
	m.documents = documents
	m.docList.SetItems(items)
}

func (m *Model) loadDocument(doc *DocumentItem) {
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

func (m Model) loadInitialData() tea.Cmd {
	return tea.Cmd(func() tea.Msg {
		epics, logs := loadExistingData(m.epicDir)
		return models.InitialDataLoadedMsg{
			Epics: epics,
			Logs:  logs,
		}
	})
}

// discoverDocuments finds all documents (markdown and other files) in the epic directory
func discoverDocuments(epicDir string) []DocumentItem {
	var documents []DocumentItem

	// Check if epic directory exists
	if _, err := os.Stat(epicDir); os.IsNotExist(err) {
		return documents
	}

	// Walk the epic directory to find all documents
	err := filepath.WalkDir(epicDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and hidden files
		if d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			return nil
		}

		// Skip system files
		if strings.HasSuffix(d.Name(), "workflow-state.json") || 
		   strings.HasSuffix(d.Name(), "workflow.log") {
			return nil
		}

		// Get file info
		info, err := d.Info()
		if err != nil {
			return nil
		}

		// Determine epic name from path
		relPath, _ := filepath.Rel(epicDir, path)
		pathParts := strings.Split(relPath, string(os.PathSeparator))
		epicName := ""
		if len(pathParts) > 1 {
			epicName = pathParts[0]
		}

		// Check if it's a markdown file
		ext := strings.ToLower(filepath.Ext(d.Name()))
		isMarkdown := ext == ".md" || ext == ".markdown"

		doc := DocumentItem{
			Name:       d.Name(),
			Path:       path,
			EpicName:   epicName,
			Size:       info.Size(),
			ModTime:    info.ModTime(),
			IsMarkdown: isMarkdown,
		}

		documents = append(documents, doc)
		return nil
	})

	if err != nil {
		fmt.Printf("Error discovering documents: %v\n", err)
	}

	return documents
}

// formatFileSize formats file size in human-readable format
func formatFileSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

// Vi-mode navigation helper methods

// gotoTop moves the current active list or viewport to the top
func (m *Model) gotoTop() {
	switch m.viewMode {
	case OverviewView:
		if len(m.epicList.Items()) > 0 {
			m.epicList.Select(0)
		}
	case TasksView:
		m.tasksViewport.GotoTop()
	case AgentsView:
		// Agents view - will be handled when implemented
	case DocumentsView:
		if m.selectedDoc == nil {
			if len(m.docList.Items()) > 0 {
				m.docList.Select(0)
			}
		} else {
			m.docViewport.GotoTop()
		}
	case LogsView:
		m.logViewport.GotoTop()
	case HelpView:
		// Help view - will be handled when implemented
	}
}

// gotoBottom moves the current active list or viewport to the bottom
func (m *Model) gotoBottom() {
	switch m.viewMode {
	case OverviewView:
		if len(m.epicList.Items()) > 0 {
			m.epicList.Select(len(m.epicList.Items()) - 1)
		}
	case TasksView:
		m.tasksViewport.GotoBottom()
	case AgentsView:
		// Agents view - will be handled when implemented
	case DocumentsView:
		if m.selectedDoc == nil {
			if len(m.docList.Items()) > 0 {
				m.docList.Select(len(m.docList.Items()) - 1)
			}
		} else {
			m.docViewport.GotoBottom()
		}
	case LogsView:
		m.logViewport.GotoBottom()
	case HelpView:
		// Help view - will be handled when implemented
	}
}

// handleSearchCommandInput handles keyboard input during search or command mode
func (m *Model) handleSearchCommandInput(msg tea.KeyMsg) {
	switch msg.String() {
	case "enter":
		if m.searchMode {
			m.performSearch()
		} else if m.commandMode {
			m.executeCommand()
		}
		m.searchMode = false
		m.commandMode = false
	case "esc":
		m.searchMode = false
		m.commandMode = false
		m.searchQuery = ""
		m.commandInput = ""
	case "backspace":
		if m.searchMode && len(m.searchQuery) > 0 {
			m.searchQuery = m.searchQuery[:len(m.searchQuery)-1]
		} else if m.commandMode && len(m.commandInput) > 0 {
			m.commandInput = m.commandInput[:len(m.commandInput)-1]
		}
	default:
		// Add character to search query or command input
		char := msg.String()
		if len(char) == 1 {
			if m.searchMode {
				m.searchQuery += char
			} else if m.commandMode {
				m.commandInput += char
			}
		}
	}
}

// performSearch executes a search in the current view
func (m *Model) performSearch() {
	if m.searchQuery == "" {
		return
	}
	
	query := strings.ToLower(m.searchQuery)
	
	switch m.viewMode {
	case OverviewView:
		m.searchInEpicList(query)
	case DocumentsView:
		if m.selectedDoc == nil {
			m.searchInDocumentList(query)
		} else {
			m.searchInDocumentContent(query)
		}
	case LogsView:
		m.searchInLogs(query)
	case TasksView:
		m.searchInTasks(query)
	}
}

// searchInEpicList searches for epics matching the query
func (m *Model) searchInEpicList(query string) {
	for i, item := range m.epicList.Items() {
		if epicItem, ok := item.(EpicItem); ok {
			if strings.Contains(strings.ToLower(epicItem.Epic.Name), query) {
				m.epicList.Select(i)
				return
			}
		}
	}
}

// searchInDocumentList searches for documents matching the query
func (m *Model) searchInDocumentList(query string) {
	for i, item := range m.docList.Items() {
		if docItem, ok := item.(DocumentItem); ok {
			if strings.Contains(strings.ToLower(docItem.Name), query) {
				m.docList.Select(i)
				return
			}
		}
	}
}

// searchInDocumentContent searches within the document content
func (m *Model) searchInDocumentContent(query string) {
	content := m.docViewport.View()
	lines := strings.Split(content, "\n")
	
	for i, line := range lines {
		if strings.Contains(strings.ToLower(line), query) {
			// Move viewport to show the line with the search result
			targetLine := i
			if targetLine > m.docViewport.Height/2 {
				targetLine -= m.docViewport.Height / 2
			} else {
				targetLine = 0
			}
			m.docViewport.LineUp(m.docViewport.YOffset - targetLine)
			return
		}
	}
}

// searchInLogs searches for log entries matching the query
func (m *Model) searchInLogs(query string) {
	content := m.logViewport.View()
	lines := strings.Split(content, "\n")
	
	for i, line := range lines {
		if strings.Contains(strings.ToLower(line), query) {
			// Move viewport to show the line with the search result
			targetLine := i
			if targetLine > m.logViewport.Height/2 {
				targetLine -= m.logViewport.Height / 2
			} else {
				targetLine = 0
			}
			m.logViewport.LineUp(m.logViewport.YOffset - targetLine)
			return
		}
	}
}

// searchInTasks searches for tasks matching the query
func (m *Model) searchInTasks(query string) {
	content := m.tasksViewport.View()
	lines := strings.Split(content, "\n")
	
	for i, line := range lines {
		if strings.Contains(strings.ToLower(line), query) {
			// Move viewport to show the line with the search result
			targetLine := i
			if targetLine > m.tasksViewport.Height/2 {
				targetLine -= m.tasksViewport.Height / 2
			} else {
				targetLine = 0
			}
			m.tasksViewport.LineUp(m.tasksViewport.YOffset - targetLine)
			return
		}
	}
}

// executeCommand executes a command entered in command mode
func (m *Model) executeCommand() {
	if m.commandInput == "" {
		return
	}
	
	cmd := strings.TrimSpace(strings.ToLower(m.commandInput))
	
	switch cmd {
	case "q", "quit":
		// Quit the application
		// This would need to be handled by returning tea.Quit
	case "help", "h":
		m.viewMode = HelpView
	case "overview", "o":
		m.viewMode = OverviewView
	case "tasks", "t":
		m.viewMode = TasksView
	case "agents", "a":
		m.viewMode = AgentsView
	case "docs", "d":
		m.viewMode = DocumentsView
	case "logs", "l":
		m.viewMode = LogsView
	case "refresh", "r":
		// Trigger refresh - this would need to return a command
	default:
		// Unknown command - could show an error message
	}
}