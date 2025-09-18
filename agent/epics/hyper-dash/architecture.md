# HyperDash Architecture Design Document

## Overview

This document outlines the comprehensive architecture for the new HyperDash implementation using native Go with the Charmbracelet ecosystem (Bubbletea, Bubbles, Lipgloss). The design is based on extensive analysis of Charmbracelet examples and the existing Node.js/Ink prototype, ensuring professional TUI patterns and exceptional user experience.

## Architecture Philosophy

### Core Principles
1. **Follow Proven Patterns**: Leverage established Charmbracelet design patterns from official examples
2. **Elm Architecture**: Strict adherence to Init/Update/View pattern for predictable state management
3. **Component Composition**: Build complex interfaces from simple, focused Bubbles components
4. **Progressive Enhancement**: Support multiple interaction modes from simple to advanced
5. **Responsive Design**: Adaptive layouts that work across terminal sizes and capabilities

### Design Goals
- **Professional Quality**: Match or exceed the visual quality of modern CLI tools
- **Intuitive Navigation**: Support both mouse-like (arrow keys) and Vi-mode keyboard navigation
- **Epic-Centric Workflow**: Seamless context switching between multiple epic workflows
- **Performance**: <100ms startup time with efficient real-time updates
- **Cross-Platform**: Native performance on macOS, Linux, and Windows

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Entry Point                        │
│  (Cobra CLI with --epic, --test, status commands)          │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                 Main Application                            │
│  • Program initialization                                   │
│  • Epic discovery and context management                    │
│  • Mode detection (interactive vs headless)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                  Core Model                                 │
│  • Central state management (Elm Architecture)             │
│  • Tab system with focus management                        │
│  • Epic context switching                                  │
│  • Real-time file monitoring                               │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                View Components                              │
│  • Tab Navigation (Overview, Tasks, Docs, Logs, Help)      │
│  • Advanced Tables (Epic progress, TaskMaster integration)  │
│  • Markdown Viewer (Glamour with viewport)                 │
│  • Help System (Context-aware shortcuts)                   │
│  • Status Indicators (Real-time updates)                   │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. Main Application Layer

#### Entry Point (`cmd/hyperdash/main.go`)
```go
type Config struct {
    EpicDir    string
    TestMode   bool
    StatusOnly bool
    JSONOutput bool
}

func main() {
    config := parseFlags()
    
    if config.StatusOnly {
        printStatusAndExit(config)
    }
    
    if config.TestMode {
        runHeadlessMode(config)
    } else {
        runInteractiveMode(config)
    }
}
```

**Key Features:**
- Cobra CLI integration with beautiful help output
- Multiple operation modes (interactive, status, headless)
- Epic discovery and validation
- Cross-platform binary support

#### Program Initialization
```go
func runInteractiveMode(config Config) error {
    model := ui.NewMainModel(config)
    
    opts := []tea.ProgramOption{
        tea.WithAltScreen(),
        tea.WithMouseCellMotion(),
    }
    
    program := tea.NewProgram(model, opts...)
    return program.Run()
}
```

### 2. Core Model Layer

#### Main Model (`internal/ui/model.go`)
```go
type MainModel struct {
    // Core State
    config        Config
    epicCtx       *epic.Context
    currentTab    TabID
    windowSize    tea.WindowSizeMsg
    
    // Component Models
    epicTable     table.Model
    taskTable     table.Model
    docViewer     viewport.Model
    logViewer     viewport.Model
    helpModel     help.Model
    
    // Focus and Navigation
    focusedComponent ComponentID
    tabFocused       bool
    keyMap          KeyMap
    
    // Data State
    workflowState    *models.WorkflowState
    recentLogs       []models.LogEntry
    epicList         []models.Epic
    taskMasterTasks  []models.Task
    
    // UI State
    showHelp         bool
    showEpicSelector bool
    viMode           bool
    
    // Update Management
    fileWatcher      *fsnotify.Watcher
    lastUpdate       time.Time
    updateInterval   time.Duration
}
```

**State Management Pattern:**
- Single source of truth for all application state
- Immutable state updates following Elm Architecture
- Clear separation between UI state and data state
- Efficient update batching for real-time changes

#### Tab System (`internal/ui/tabs.go`)
```go
type TabID int

const (
    OverviewTab TabID = iota
    TasksTab
    DocsTab
    LogsTab
    HelpTab
)

type TabModel struct {
    tabs        []Tab
    activeTab   TabID
    tabStyle    lipgloss.Style
    activeStyle lipgloss.Style
    width       int
}

func (m TabModel) renderTabs() string {
    var tabs []string
    for i, tab := range m.tabs {
        style := m.tabStyle
        if TabID(i) == m.activeTab {
            style = m.activeStyle
        }
        tabs = append(tabs, style.Render(tab.Title))
    }
    return lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
}
```

**Professional Tab Features:**
- Visual focus indicators with border changes
- Keyboard navigation (Tab/Shift+Tab, numbers, Vi-mode)
- Responsive tab sizing based on terminal width
- Context-aware tab availability

### 3. Component Layer

#### Advanced Tables (`internal/ui/tables.go`)
```go
type EpicTable struct {
    table.Model
    columns []table.Column
    focused bool
}

func NewEpicTable() EpicTable {
    columns := []table.Column{
        {Title: "Status", Width: 8},
        {Title: "Step", Width: 6},
        {Title: "Progress", Width: 12},
        {Title: "Epic", Width: 30},
        {Title: "Last Update", Width: 16},
    }
    
    t := table.New(
        table.WithColumns(columns),
        table.WithFocused(true),
        table.WithHeight(7),
    )
    
    s := table.DefaultStyles()
    s.Header = s.Header.
        BorderStyle(lipgloss.NormalBorder()).
        BorderForeground(lipgloss.Color("240")).
        BorderBottom(true).
        Bold(false)
    s.Selected = s.Selected.
        Foreground(lipgloss.Color("229")).
        Background(lipgloss.Color("57")).
        Bold(false)
    t.SetStyles(s)
    
    return EpicTable{Model: t, columns: columns}
}
```

**Advanced Table Features:**
- Dynamic column sizing based on terminal width
- Professional styling with borders and highlighting
- Keyboard navigation with selection state
- Real-time data updates with efficient rendering
- Sorting and filtering capabilities

#### Markdown Viewer (`internal/ui/docs.go`)
```go
type DocViewer struct {
    viewport    viewport.Model
    content     string
    renderer    *glamour.TermRenderer
    epicDocs    []string
    currentDoc  int
    style       lipgloss.Style
}

func NewDocViewer(width, height int) (*DocViewer, error) {
    vp := viewport.New(width-4, height-6)
    vp.Style = lipgloss.NewStyle().
        BorderStyle(lipgloss.RoundedBorder()).
        BorderForeground(lipgloss.Color("62")).
        PaddingRight(2)
    
    renderer, err := glamour.NewTermRenderer(
        glamour.WithAutoStyle(),
        glamour.WithWordWrap(width-8),
    )
    if err != nil {
        return nil, err
    }
    
    return &DocViewer{
        viewport: vp,
        renderer: renderer,
        style:    lipgloss.NewStyle().Margin(1, 2),
    }, nil
}
```

**Document Viewing Features:**
- Glamour-powered markdown rendering with syntax highlighting
- Viewport integration for scrolling and navigation
- Epic document discovery and listing
- Real-time document updates
- Search and navigation within documents

#### Help System (`internal/ui/help.go`)
```go
type HelpModel struct {
    help.Model
    keyMap      KeyMap
    currentMode string
    visible     bool
    
    // Context-aware help sections
    sections map[string][]key.Binding
}

func (h HelpModel) getContextualHelp(tab TabID, viMode bool) []key.Binding {
    base := []key.Binding{h.keyMap.Quit, h.keyMap.Help}
    
    switch tab {
    case OverviewTab:
        return append(base, h.keyMap.Refresh, h.keyMap.SwitchEpic)
    case TasksTab:
        return append(base, h.keyMap.TaskDetail, h.keyMap.TaskNext)
    case DocsTab:
        return append(base, h.keyMap.DocNav, h.keyMap.DocSearch)
    default:
        return base
    }
}
```

**Help System Features:**
- Context-aware shortcuts based on current tab and mode
- Vi-mode specific help when enabled
- Progressive disclosure (short help vs full help)
- Overlay mode that doesn't disrupt workflow

### 4. Epic Management Layer

#### Epic Discovery (`internal/epic/discovery.go`)
```go
type DiscoveryService struct {
    rootPath     string
    epicCache    map[string]*Epic
    lastScan     time.Time
    scanInterval time.Duration
}

type Epic struct {
    Name         string
    Path         string
    Status       EpicStatus
    LastActivity time.Time
    
    // File presence indicators
    HasWorkflowState bool
    HasManifest      bool
    HasLogs          bool
    
    // Computed properties
    DisplayName string
    IsValid     bool
}

func (d *DiscoveryService) DiscoverEpics() ([]Epic, error) {
    // Intelligent epic discovery with caching
    // Scan common epic locations (.claude/epic/, agent/epics/, etc.)
    // Validate epic structure and compute status
    // Return sorted list by recent activity
}
```

**Epic Discovery Features:**
- Intelligent scanning of common epic locations
- Validation of epic structure and required files
- Caching with efficient updates
- Status computation based on workflow state

#### Context Management (`internal/epic/context.go`)
```go
type Context struct {
    CurrentEpic   *Epic
    WorkflowState *models.WorkflowState
    RecentLogs    []models.LogEntry
    Documents     []string
    
    // File watchers
    stateWatcher *fsnotify.Watcher
    logWatcher   *fsnotify.Watcher
    
    // Update channels
    StateUpdates chan *models.WorkflowState
    LogUpdates   chan []models.LogEntry
}

func (c *Context) SwitchToEpic(epic *Epic) error {
    // Clean up current watchers
    c.cleanupWatchers()
    
    // Load new epic data
    c.CurrentEpic = epic
    c.loadWorkflowState()
    c.loadRecentLogs()
    c.discoverDocuments()
    
    // Set up file watchers
    c.setupFileWatchers()
    
    return nil
}
```

**Context Management Features:**
- Seamless epic switching with state preservation
- Real-time file monitoring with fsnotify
- Efficient data loading and caching
- Background updates without blocking UI

### 5. Data Models Layer

#### Workflow State (`internal/models/workflow.go`)
```go
type WorkflowState struct {
    EpicName       string    `json:"epic_name"`
    CurrentStep    int       `json:"current_step"`
    CompletedSteps []int     `json:"completed_steps"`
    Timestamp      time.Time `json:"timestamp"`
    
    WorkflowConfig WorkflowConfig `json:"workflow_config"`
    Agents         AgentStatus    `json:"agents"`
    Artifacts      Artifacts      `json:"artifacts"`
    TagName        string         `json:"tag_name"`
}

type WorkflowConfig struct {
    NoStop        bool `json:"no_stop"`
    MaxSubagents  int  `json:"max_subagents"`
    UseResearch   bool `json:"use_research"`
}

type AgentStatus struct {
    Required  []string `json:"required"`
    Created   []string `json:"created"`
    Available []string `json:"available"`
}
```

#### Log Entries (`internal/models/logs.go`)
```go
type LogEntry struct {
    Timestamp time.Time `json:"timestamp"`
    Level     LogLevel  `json:"level"`
    Message   string    `json:"message"`
    Source    string    `json:"source,omitempty"`
}

type LogLevel string

const (
    LogLevelInfo    LogLevel = "info"
    LogLevelSuccess LogLevel = "success"
    LogLevelWarning LogLevel = "warning"
    LogLevelError   LogLevel = "error"
)
```

### 6. Keyboard Navigation System

#### Key Mapping (`internal/ui/keymap.go`)
```go
type KeyMap struct {
    // Global navigation
    Quit        key.Binding
    Help        key.Binding
    Refresh     key.Binding
    ToggleViMode key.Binding
    
    // Tab navigation
    NextTab     key.Binding
    PrevTab     key.Binding
    TabDirect   []key.Binding // 1-5 for direct tab access
    
    // Epic management
    SwitchEpic  key.Binding
    EpicNext    key.Binding
    EpicPrev    key.Binding
    
    // Component navigation
    Up          key.Binding
    Down        key.Binding
    Left        key.Binding
    Right       key.Binding
    
    // Vi-mode keys
    ViUp        key.Binding
    ViDown      key.Binding
    ViLeft      key.Binding
    ViRight     key.Binding
    
    // Action keys
    Enter       key.Binding
    Space       key.Binding
    Escape      key.Binding
}

func NewKeyMap() KeyMap {
    return KeyMap{
        Quit: key.NewBinding(
            key.WithKeys("q", "ctrl+c"),
            key.WithHelp("q", "quit"),
        ),
        Help: key.NewBinding(
            key.WithKeys("?", "h"),
            key.WithHelp("?", "toggle help"),
        ),
        // ... additional bindings
    }
}
```

**Navigation Features:**
- Dual mode support (arrow keys + Vi-mode)
- Context-aware key bindings
- Progressive disclosure of shortcuts
- Consistent navigation patterns across components

### 7. Responsive Layout System

#### Breakpoint Management (`internal/ui/layout.go`)
```go
type LayoutBreakpoints struct {
    XS int // 60 - Minimum supported
    SM int // 80 - Compact layout  
    MD int // 100 - Standard layout
    LG int // 120 - Comfortable layout
    XL int // 140 - Spacious layout
}

type LayoutDimensions struct {
    Width           int
    Height          int
    Breakpoint      string
    IsCompact       bool
    CanShowSidebar  bool
    MaxLogLines     int
}

func CalculateLayout(width, height int) LayoutDimensions {
    breakpoints := LayoutBreakpoints{60, 80, 100, 120, 140}
    
    var breakpoint string
    switch {
    case width >= breakpoints.XL:
        breakpoint = "xl"
    case width >= breakpoints.LG:
        breakpoint = "lg"
    case width >= breakpoints.MD:
        breakpoint = "md"
    case width >= breakpoints.SM:
        breakpoint = "sm"
    default:
        breakpoint = "xs"
    }
    
    return LayoutDimensions{
        Width:           width,
        Height:          height,
        Breakpoint:      breakpoint,
        IsCompact:       width < breakpoints.MD,
        CanShowSidebar:  width >= breakpoints.LG && height >= 30,
        MaxLogLines:     calculateLogLines(height),
    }
}
```

**Responsive Features:**
- Adaptive layouts based on terminal size
- Progressive disclosure of features
- Efficient space utilization
- Graceful degradation for small terminals

## Implementation Guidelines

### 1. Code Organization

```
apps/hyperdash/
├── cmd/hyperdash/
│   └── main.go              # CLI entry point with Cobra
├── internal/
│   ├── ui/
│   │   ├── model.go         # Main Elm Architecture model
│   │   ├── tabs.go          # Tab system implementation
│   │   ├── tables.go        # Advanced Bubbles tables
│   │   ├── docs.go          # Glamour document viewer
│   │   ├── help.go          # Context-aware help system
│   │   ├── keymap.go        # Keyboard navigation
│   │   └── layout.go        # Responsive layout system
│   ├── epic/
│   │   ├── discovery.go     # Epic discovery service
│   │   ├── context.go       # Epic context management
│   │   └── watcher.go       # File monitoring
│   ├── models/
│   │   ├── workflow.go      # Workflow state models
│   │   ├── logs.go          # Log entry models
│   │   └── epic.go          # Epic metadata models
│   └── testutil/
│       ├── simulation.go    # Test data generation
│       └── headless.go      # Headless mode testing
├── go.mod
├── go.sum
└── README.md
```

### 2. Development Workflow

#### Phase 1: Foundation
1. **Set up main model with Elm Architecture**
   - Initialize core state structure with HyperDash branding
   - Implement basic Update/View cycle
   - Add window size handling

2. **Create tab system**
   - Implement TabModel with professional styling
   - Add keyboard navigation
   - Create tab content routing

3. **Build epic discovery**
   - Implement epic scanning and validation
   - Add epic context switching
   - Create epic selector interface

#### Phase 2: Core Components
1. **Integrate advanced Bubbles Tables**
   - Epic overview table with progress display
   - TaskMaster integration table
   - Professional styling and selection

2. **Add Glamour document viewer**
   - Markdown rendering with syntax highlighting
   - Viewport integration for scrolling
   - Document discovery and navigation

3. **Implement file monitoring**
   - Real-time workflow state updates
   - Log streaming with efficient parsing
   - Update batching and UI synchronization

#### Phase 3: Advanced Features
1. **Build comprehensive help system**
   - Context-aware keyboard shortcuts
   - Vi-mode specific help
   - Progressive disclosure design

2. **Add responsive layouts**
   - Breakpoint-based layout decisions
   - Adaptive component sizing
   - Graceful degradation

3. **Implement focus management**
   - Professional focus indicators
   - Keyboard navigation between components
   - Vi-mode support throughout

#### Phase 4: Testing and Distribution
1. **Create simulation modes**
   - Headless operation for CI/CD
   - Test data generation
   - Automated testing scripts

2. **Set up cross-platform builds**
   - GitHub Actions for automated builds
   - Platform-specific binary generation
   - npm package wrapper

### 3. Key Implementation Patterns

#### Elm Architecture Pattern
```go
func (m MainModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    var cmd tea.Cmd
    var cmds []tea.Cmd
    
    switch msg := msg.(type) {
    case tea.WindowSizeMsg:
        m.windowSize = msg
        m.layout = calculateLayout(msg.Width, msg.Height)
        // Update all child components with new size
        cmds = append(cmds, m.updateComponentSizes()...)
        
    case tea.KeyMsg:
        if m.showHelp {
            return m.updateHelpMode(msg)
        }
        
        switch {
        case key.Matches(msg, m.keyMap.Quit):
            return m, tea.Quit
        case key.Matches(msg, m.keyMap.NextTab):
            m.currentTab = m.nextTab()
            cmd = m.tabChanged()
        case key.Matches(msg, m.keyMap.SwitchEpic):
            m.showEpicSelector = !m.showEpicSelector
        }
        
    case FileUpdateMsg:
        m.lastUpdate = time.Now()
        cmd = m.handleFileUpdate(msg)
        
    case EpicSwitchedMsg:
        cmd = m.handleEpicSwitch(msg)
    }
    
    // Update child components
    m.epicTable, cmd = m.epicTable.Update(msg)
    cmds = append(cmds, cmd)
    
    return m, tea.Batch(cmds...)
}
```

#### Component Focus Management
```go
type FocusManager struct {
    focusableComponents []ComponentID
    currentFocus        int
    focusStack         []ComponentID
}

func (f *FocusManager) NextFocus() ComponentID {
    f.currentFocus = (f.currentFocus + 1) % len(f.focusableComponents)
    return f.focusableComponents[f.currentFocus]
}

func (f *FocusManager) PushFocus(component ComponentID) {
    f.focusStack = append(f.focusStack, f.getCurrentFocus())
    f.setFocus(component)
}

func (f *FocusManager) PopFocus() ComponentID {
    if len(f.focusStack) == 0 {
        return f.getCurrentFocus()
    }
    
    previous := f.focusStack[len(f.focusStack)-1]
    f.focusStack = f.focusStack[:len(f.focusStack)-1]
    f.setFocus(previous)
    return previous
}
```

## Performance Considerations

### 1. Efficient Updates
- **Batch file updates** to prevent excessive re-renders
- **Selective component updates** based on changed data
- **Viewport optimization** for large document rendering
- **Debounced file watching** to handle rapid file changes

### 2. Memory Management
- **Epic context caching** with LRU eviction
- **Log entry rotation** to prevent memory leaks
- **Document content streaming** for large files
- **Efficient string building** for table rendering

### 3. Startup Performance
- **Lazy epic discovery** - scan on demand
- **Parallel component initialization**
- **Cached configuration loading**
- **Minimal initial rendering**

## Testing Strategy

### 1. Unit Testing
- **Component isolation** - test individual Bubbles components
- **State transitions** - verify Elm Architecture update logic
- **Epic discovery** - test file system scanning and validation
- **Keyboard handling** - verify navigation and shortcuts

### 2. Integration Testing
- **Full workflow simulation** - test complete epic workflow
- **File monitoring** - verify real-time updates work correctly
- **Epic switching** - test context management and cleanup
- **Cross-platform compatibility** - test on major platforms

### 3. Simulation Testing
```go
func TestHeadlessMode(t *testing.T) {
    config := Config{
        EpicDir:  "testdata/sample-epic",
        TestMode: true,
    }
    
    model := ui.NewMainModel(config)
    
    // Simulate key presses and verify state changes
    msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}
    result, cmd := model.Update(msg)
    
    assert.Equal(t, tea.Quit, cmd)
}
```

## Success Metrics

### 1. User Experience
- **Startup time**: <100ms from command to first render
- **Response time**: <50ms for keyboard navigation
- **Visual quality**: Professional appearance matching modern CLI tools
- **Learning curve**: Intuitive navigation discoverable within 5 minutes

### 2. Technical Performance
- **Memory usage**: <50MB for typical epic with 1000 log entries
- **CPU usage**: <5% during idle monitoring
- **File watch efficiency**: Updates within 500ms of file changes
- **Cross-platform compatibility**: Identical behavior on major platforms

### 3. Adoption Metrics
- **Installation success**: Single npm install works for 95% of developers
- **Feature usage**: 80% of users discover tab navigation within first session
- **Epic switching**: Context switching works seamlessly for multiple epics
- **Vi-mode adoption**: 30% of users enable and use Vi-mode regularly

## Conclusion

This architecture provides a solid foundation for building a professional, performant HyperDash that leverages the full power of the Charmbracelet ecosystem. By following proven patterns from the official examples and implementing proper Elm Architecture, HyperDash will deliver exceptional user experience while maintaining code quality and maintainability.

The progressive implementation phases ensure steady development progress while allowing for early user feedback and iteration. The comprehensive testing strategy, including simulation modes, ensures reliability across platforms and use cases.