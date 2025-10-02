package ui

import (
	"context"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/components"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/panels"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui/providers"
)

// Model represents the main application model using the new component architecture
type Model struct {
	appShell         *components.AppShell
	taskMasterClient *taskmaster.Client
	context          context.Context
}

// InitialModel creates a new model with the new component architecture
func InitialModel(epicDir string) Model {
	// Create context
	ctx := context.Background()

	// Initialize TaskMaster client
	tmClient := taskmaster.NewClient(taskmaster.ClientConfig{
		Command:    "task-master",
		WorkingDir: epicDir,
	})

	// Initialize EpicProvider
	epicProvider, _ := providers.NewEpicProvider(providers.EpicProviderConfig{
		TaskMasterClient: tmClient,
		EpicDirectory:    epicDir,
	})

	// Initialize the new AppShell component
	appShell := components.NewAppShell(epicDir, epicProvider, tmClient)

	// Set up all panel factories
	appShell.SetOverviewPanelFactory(func(provider *providers.EpicProvider, epicDir string) tea.Model {
		return panels.NewOverviewPanel(provider, epicDir)
	})

	appShell.SetTasksPanelFactory(func(client *taskmaster.Client) tea.Model {
		return panels.NewTasksPanel(client)
	})

	appShell.SetAgentsPanelFactory(func(client *taskmaster.Client) tea.Model {
		return panels.NewAgentsPanel(client)
	})

	appShell.SetDocsPanelFactory(func(epicDir string) (tea.Model, error) {
		return panels.NewDocsPanel(epicDir)
	})

	appShell.SetLogsPanelFactory(func() tea.Model {
		return panels.NewLogsPanel()
	})

	appShell.SetPerformancePanelFactory(func() tea.Model {
		return panels.NewPerformancePanel()
	})

	appShell.SetHelpPanelFactory(func(width, height int) tea.Model {
		return panels.NewHelpPanel(width, height)
	})

	return Model{
		appShell:         appShell,
		taskMasterClient: tmClient,
		context:          ctx,
	}
}

// Init implements tea.Model
func (m Model) Init() tea.Cmd {
	return m.appShell.Init()
}

// Update implements tea.Model
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	shellModel, cmd := m.appShell.Update(msg)
	m.appShell = shellModel.(*components.AppShell)
	return m, cmd
}

// View implements tea.Model
func (m Model) View() string {
	return m.appShell.View()
}
