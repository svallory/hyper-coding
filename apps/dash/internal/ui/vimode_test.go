package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbles/key"
)

func TestViModeGotoTop(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Add some test epics to work with
	model.updateEpicList()
	
	// Test goto top in overview mode
	model.viewMode = OverviewView
	if len(model.epicList.Items()) > 0 {
		model.epicList.Select(len(model.epicList.Items()) - 1) // Go to bottom first
		model.gotoTop()
		if model.epicList.Index() != 0 {
			t.Errorf("Expected epic list to be at index 0, got %d", model.epicList.Index())
		}
	}
	
	// Test goto top in tasks view
	model.viewMode = TasksView
	model.tasksViewport.GotoBottom()
	model.gotoTop()
	if model.tasksViewport.YOffset != 0 {
		t.Errorf("Expected tasks viewport to be at top (YOffset=0), got %d", model.tasksViewport.YOffset)
	}
	
	// Test goto top in logs view
	model.viewMode = LogsView
	model.logViewport.GotoBottom()
	model.gotoTop()
	if model.logViewport.YOffset != 0 {
		t.Errorf("Expected log viewport to be at top (YOffset=0), got %d", model.logViewport.YOffset)
	}
}

func TestViModeGotoBottom(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Test goto bottom in overview mode
	model.viewMode = OverviewView
	if len(model.epicList.Items()) > 0 {
		model.epicList.Select(0) // Go to top first
		model.gotoBottom()
		expected := len(model.epicList.Items()) - 1
		if model.epicList.Index() != expected {
			t.Errorf("Expected epic list to be at index %d, got %d", expected, model.epicList.Index())
		}
	}
	
	// Test goto bottom in tasks view
	model.viewMode = TasksView
	model.tasksViewport.GotoTop()
	model.gotoBottom()
	// The exact behavior depends on content, but it should have moved
}

func TestViModeGGSequence(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	model.viewMode = OverviewView
	
	// First 'g' press - should start sequence
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	updatedModel, _ := model.Update(msg)
	model = updatedModel.(Model)
	
	if !model.lastGPressed {
		t.Error("Expected lastGPressed to be true after first 'g'")
	}
	
	// Second 'g' press within timeout - should goto top
	msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	updatedModel, _ = model.Update(msg)
	model = updatedModel.(Model)
	
	if model.lastGPressed {
		t.Error("Expected lastGPressed to be false after gg sequence")
	}
}

func TestViModeGGSequenceTimeout(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	model.viewMode = OverviewView
	
	// First 'g' press
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	updatedModel, _ := model.Update(msg)
	model = updatedModel.(Model)
	
	// Simulate timeout by setting old time
	model.lastGPressTime = time.Now().Add(-1 * time.Second)
	
	// Second 'g' press after timeout - should start new sequence
	msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	updatedModel, _ = model.Update(msg)
	model = updatedModel.(Model)
	
	if !model.lastGPressed {
		t.Error("Expected lastGPressed to be true after timeout (new sequence)")
	}
}

func TestViModeSearchMode(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Enter search mode
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}}
	updatedModel, _ := model.Update(msg)
	model = updatedModel.(Model)
	
	if !model.searchMode {
		t.Error("Expected searchMode to be true after '/' key")
	}
	if model.commandMode {
		t.Error("Expected commandMode to be false in search mode")
	}
	if model.searchQuery != "" {
		t.Error("Expected searchQuery to be empty initially")
	}
	
	// Type search query
	searchText := "test"
	for _, char := range searchText {
		msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{char}}
		model.handleSearchCommandInput(msg)
	}
	
	if model.searchQuery != searchText {
		t.Errorf("Expected searchQuery to be '%s', got '%s'", searchText, model.searchQuery)
	}
	
	// Test backspace
	msg = tea.KeyMsg{Type: tea.KeyBackspace}
	model.handleSearchCommandInput(msg)
	
	expected := searchText[:len(searchText)-1]
	if model.searchQuery != expected {
		t.Errorf("Expected searchQuery to be '%s' after backspace, got '%s'", expected, model.searchQuery)
	}
	
	// Exit search mode with Escape
	msg = tea.KeyMsg{Type: tea.KeyEsc}
	model.handleSearchCommandInput(msg)
	
	if model.searchMode {
		t.Error("Expected searchMode to be false after Escape")
	}
	if model.searchQuery != "" {
		t.Error("Expected searchQuery to be cleared after Escape")
	}
}

func TestViModeCommandMode(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Enter command mode
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{':'}}
	updatedModel, _ := model.Update(msg)
	model = updatedModel.(Model)
	
	if !model.commandMode {
		t.Error("Expected commandMode to be true after ':' key")
	}
	if model.searchMode {
		t.Error("Expected searchMode to be false in command mode")
	}
	if model.commandInput != "" {
		t.Error("Expected commandInput to be empty initially")
	}
	
	// Type command
	command := "help"
	for _, char := range command {
		msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{char}}
		model.handleSearchCommandInput(msg)
	}
	
	if model.commandInput != command {
		t.Errorf("Expected commandInput to be '%s', got '%s'", command, model.commandInput)
	}
	
	// Execute command
	msg = tea.KeyMsg{Type: tea.KeyEnter}
	model.handleSearchCommandInput(msg)
	
	if model.commandMode {
		t.Error("Expected commandMode to be false after Enter")
	}
	if model.viewMode != HelpView {
		t.Error("Expected viewMode to be HelpView after 'help' command")
	}
}

func TestViModeCommandExecution(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	testCases := []struct {
		command      string
		expectedView ViewMode
	}{
		{"help", HelpView},
		{"h", HelpView},
		{"overview", OverviewView},
		{"o", OverviewView},
		{"tasks", TasksView},
		{"t", TasksView},
		{"agents", AgentsView},
		{"a", AgentsView},
		{"docs", DocumentsView},
		{"d", DocumentsView},
		{"logs", LogsView},
		{"l", LogsView},
	}
	
	for _, tc := range testCases {
		t.Run(tc.command, func(t *testing.T) {
			model.commandInput = tc.command
			model.executeCommand()
			
			if model.viewMode != tc.expectedView {
				t.Errorf("Command '%s': expected viewMode %v, got %v", 
					tc.command, tc.expectedView, model.viewMode)
			}
		})
	}
}

func TestViModeKeySequenceReset(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Start gg sequence
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	updatedModel, _ := model.Update(msg)
	model = updatedModel.(Model)
	
	if !model.lastGPressed {
		t.Error("Expected lastGPressed to be true after first 'g'")
	}
	
	// Press another key - should reset sequence
	msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updatedModel, _ = model.Update(msg)
	model = updatedModel.(Model)
	
	if model.lastGPressed {
		t.Error("Expected lastGPressed to be false after other key")
	}
}

func TestViModeSearchInEpicList(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	model.viewMode = OverviewView
	
	// Mock epic list with test data
	// This would require setting up test epics, which depends on the model structure
	// For now, test the search method doesn't crash
	model.searchQuery = "test"
	model.searchInEpicList("test")
	
	// The test should not crash - actual functionality depends on having test data
}

func TestViModeFooterInSearchMode(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	// Test normal footer
	footer := model.renderFooter()
	if !strings.Contains(footer, "[/] Search") {
		t.Error("Expected footer to contain search shortcut")
	}
	
	// Test search mode footer
	model.searchMode = true
	model.searchQuery = "test"
	footer = model.renderFooter()
	if !strings.Contains(footer, "Search: /test_") {
		t.Error("Expected footer to show search prompt in search mode")
	}
	
	// Test command mode footer
	model.searchMode = false
	model.commandMode = true
	model.commandInput = "help"
	footer = model.renderFooter()
	if !strings.Contains(footer, "Command: :help_") {
		t.Error("Expected footer to show command prompt in command mode")
	}
}

func TestViModeKeyBindings(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	keys := model.keys
	
	// Test vi-mode key bindings exist
	if !key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}, keys.GotoTop) {
		t.Error("Expected 'g' to match GotoTop binding")
	}
	
	if !key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'G'}}, keys.GotoBottom) {
		t.Error("Expected 'G' to match GotoBottom binding")
	}
	
	if !key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}}, keys.Search) {
		t.Error("Expected '/' to match Search binding")
	}
	
	if !key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{':'}}, keys.Command) {
		t.Error("Expected ':' to match Command binding")
	}
}

func TestViModeHelpContent(t *testing.T) {
	model := InitialModel("/test/epic/dir")
	model.loading = false
	
	helpContent := model.renderHelpContent()
	
	// Check that vi-mode shortcuts are documented
	viModeShortcuts := []string{
		"gg",
		"G",
		"/",
		":",
		"Vi-mode Navigation",
	}
	
	for _, shortcut := range viModeShortcuts {
		if !strings.Contains(helpContent, shortcut) {
			t.Errorf("Expected help content to contain '%s'", shortcut)
		}
	}
}