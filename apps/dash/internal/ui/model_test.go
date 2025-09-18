package ui

import (
	"testing"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/stretchr/testify/assert"
)

func TestViewModeTransitions(t *testing.T) {
	tests := []struct {
		name         string
		startMode    ViewMode
		expectedNext ViewMode
		expectedPrev ViewMode
	}{
		{
			name:         "Overview transitions",
			startMode:    OverviewView,
			expectedNext: TasksView,
			expectedPrev: HelpView,
		},
		{
			name:         "Tasks transitions",
			startMode:    TasksView,
			expectedNext: AgentsView,
			expectedPrev: OverviewView,
		},
		{
			name:         "Agents transitions",
			startMode:    AgentsView,
			expectedNext: DocumentsView,
			expectedPrev: TasksView,
		},
		{
			name:         "Documents transitions",
			startMode:    DocumentsView,
			expectedNext: LogsView,
			expectedPrev: AgentsView,
		},
		{
			name:         "Logs transitions",
			startMode:    LogsView,
			expectedNext: HelpView,
			expectedPrev: DocumentsView,
		},
		{
			name:         "Help transitions",
			startMode:    HelpView,
			expectedNext: OverviewView,
			expectedPrev: LogsView,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := InitialModel("/tmp")
			model.viewMode = tt.startMode

			// Test next view
			model.nextView()
			assert.Equal(t, tt.expectedNext, model.viewMode, "nextView() should transition correctly")

			// Reset and test previous view
			model.viewMode = tt.startMode
			model.previousView()
			assert.Equal(t, tt.expectedPrev, model.viewMode, "previousView() should transition correctly")
		})
	}
}

func TestNumberKeyboardShortcuts(t *testing.T) {
	tests := []struct {
		name        string
		key         tea.KeyMsg
		expectedTab ViewMode
	}{
		{
			name:        "Press 1 for Overview",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'1'}},
			expectedTab: OverviewView,
		},
		{
			name:        "Press 2 for Tasks",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'2'}},
			expectedTab: TasksView,
		},
		{
			name:        "Press 3 for Agents",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'3'}},
			expectedTab: AgentsView,
		},
		{
			name:        "Press 4 for Documents",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'4'}},
			expectedTab: DocumentsView,
		},
		{
			name:        "Press 5 for Logs",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'5'}},
			expectedTab: LogsView,
		},
		{
			name:        "Press 6 for Help",
			key:         tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'6'}},
			expectedTab: HelpView,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := InitialModel("/tmp")
			model.viewMode = OverviewView // Start from Overview

			// Update model with the key press
			updatedModel, _ := model.Update(tt.key)
			m := updatedModel.(Model)

			assert.Equal(t, tt.expectedTab, m.viewMode, "Number key should switch to correct tab")
		})
	}
}

func TestTabKeyNavigation(t *testing.T) {
	model := InitialModel("/tmp")
	model.viewMode = OverviewView

	// Test tab key cycling through all views
	expectedSequence := []ViewMode{
		TasksView,
		AgentsView,
		DocumentsView,
		LogsView,
		HelpView,
		OverviewView, // Should cycle back
	}

	tabKey := tea.KeyMsg{Type: tea.KeyTab}

	for i, expectedMode := range expectedSequence {
		// Update model with tab key press
		updatedModel, _ := model.Update(tabKey)
		model = updatedModel.(Model)

		assert.Equal(t, expectedMode, model.viewMode, 
			"Tab key press %d should navigate to correct view", i+1)
	}
}

func TestViewModeEnumValues(t *testing.T) {
	// Ensure enum values are correct
	assert.Equal(t, ViewMode(0), OverviewView, "OverviewView should be 0")
	assert.Equal(t, ViewMode(1), TasksView, "TasksView should be 1")
	assert.Equal(t, ViewMode(2), AgentsView, "AgentsView should be 2")
	assert.Equal(t, ViewMode(3), DocumentsView, "DocumentsView should be 3")
	assert.Equal(t, ViewMode(4), LogsView, "LogsView should be 4")
	assert.Equal(t, ViewMode(5), HelpView, "HelpView should be 5")
}

func TestKeyBindings(t *testing.T) {
	keys := newKeyMap()

	// Test that all number key bindings are properly configured
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'1'}}, keys.One),
		"Key 1 should match One binding")
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'2'}}, keys.Two),
		"Key 2 should match Two binding")
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'3'}}, keys.Three),
		"Key 3 should match Three binding")
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'4'}}, keys.Four),
		"Key 4 should match Four binding")
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'5'}}, keys.Five),
		"Key 5 should match Five binding")
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'6'}}, keys.Six),
		"Key 6 should match Six binding")

	// Test tab key binding
	assert.True(t, key.Matches(tea.KeyMsg{Type: tea.KeyTab}, keys.Tab),
		"Tab key should match Tab binding")
}

func TestDocumentSelectionReset(t *testing.T) {
	model := InitialModel("/tmp")
	
	// Simulate document selection
	model.selectedDoc = &DocumentItem{
		Name: "test.md",
		Path: "/tmp/test.md",
	}
	model.viewMode = DocumentsView

	// Switch to another tab using number key
	fourKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'4'}}
	updatedModel, _ := model.Update(fourKey)
	m := updatedModel.(Model)

	assert.Nil(t, m.selectedDoc, "Document selection should be reset when switching tabs")
}