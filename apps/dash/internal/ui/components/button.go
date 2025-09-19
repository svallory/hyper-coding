package components

import (
	"github.com/charmbracelet/lipgloss"
)

// ButtonStyle represents the style variant for buttons
type ButtonStyle int

const (
	Primary ButtonStyle = iota
	Secondary
)

// Button component with reusable styling
type Button struct {
	Text  string
	Style ButtonStyle
	width int
}

// NewButton creates a new button with the specified text and style
func NewButton(text string, style ButtonStyle) *Button {
	return &Button{
		Text:  text,
		Style: style,
		width: len(text) + 6, // padding + text
	}
}

// SetWidth sets a custom width for the button
func (b *Button) SetWidth(width int) *Button {
	b.width = width
	return b
}

// View renders the button component
func (b *Button) View() string {
	var style lipgloss.Style
	
	switch b.Style {
	case Primary:
		// "Yes" button style - bright and prominent
		style = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FFF7DB")).
			Background(lipgloss.Color("#F25D94")).
			Padding(0, 3).
			Bold(true).
			Underline(true)
	case Secondary:
		// "Maybe" button style - muted and subtle
		style = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FFF7DB")).
			Background(lipgloss.Color("#888B7E")).
			Padding(0, 3)
	}
	
	if b.width > 0 {
		style = style.Width(b.width).Align(lipgloss.Center)
	}
	
	return style.Render(b.Text)
}

// Render is an alias for View() for consistency
func (b *Button) Render() string {
	return b.View()
}