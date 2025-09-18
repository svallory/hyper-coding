// Package components provides advanced UI components for HyperDash
package components

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// TableColumn represents a table column with sorting capabilities
type TableColumn struct {
	Key        string
	Title      string
	Width      int
	Sortable   bool
	DataType   DataType
	Formatter  CellFormatter
	Comparator CellComparator
}

// DataType represents the type of data in a column
type DataType int

const (
	DataTypeString DataType = iota
	DataTypeNumber
	DataTypeDate
	DataTypeBoolean
	DataTypeStatus
	DataTypePriority
	DataTypePercentage
	DataTypeCustom
)

// SortDirection represents the direction of sorting
type SortDirection int

const (
	SortNone SortDirection = iota
	SortAsc
	SortDesc
)

// CellFormatter is a function type for custom cell formatting
type CellFormatter func(value interface{}) string

// CellComparator is a function type for custom cell comparison
type CellComparator func(a, b interface{}) int

// TableRow represents a single row of data
type TableRow map[string]interface{}

// SortState tracks the sorting state of the table
type SortState struct {
	Column    string
	Direction SortDirection
	Secondary *SortState // For multi-column sorting
}

// FilterFunc is a function type for filtering rows
type FilterFunc func(row TableRow) bool

// TableModel represents an advanced sortable, filterable table
type TableModel struct {
	// Core properties
	columns      []TableColumn
	rows         []TableRow
	filteredRows []TableRow
	width        int
	height       int

	// Sorting state
	sortState    *SortState
	multiSort    bool
	sortHistory  []string // Track sort order for multi-column

	// Filtering state
	filter       FilterFunc
	searchQuery  string
	searchColumn string // Empty for all columns

	// Visual state
	selectedRow  int
	scrollOffset int
	viewport     viewport.Model
	focused      bool

	// Styling
	styles TableStyles

	// Key bindings
	keys TableKeyMap

	// Performance optimization
	renderCache  []string
	cacheValid   bool
}

// TableStyles contains all style definitions for the table
type TableStyles struct {
	Header          lipgloss.Style
	Cell            lipgloss.Style
	SelectedRow     lipgloss.Style
	SortIndicator   lipgloss.Style
	FilterIndicator lipgloss.Style
	Border          lipgloss.Style
	StatusColors    map[string]lipgloss.Style
	PriorityColors  map[string]lipgloss.Style
}

// TableKeyMap defines key bindings for table navigation
type TableKeyMap struct {
	Up         key.Binding
	Down       key.Binding
	PageUp     key.Binding
	PageDown   key.Binding
	Home       key.Binding
	End        key.Binding
	Sort       key.Binding
	SortNext   key.Binding
	ClearSort  key.Binding
	Filter     key.Binding
	ClearFilter key.Binding
}

// DefaultTableKeyMap returns default key bindings
func DefaultTableKeyMap() TableKeyMap {
	return TableKeyMap{
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "down"),
		),
		PageUp: key.NewBinding(
			key.WithKeys("pgup", "b"),
			key.WithHelp("pgup/b", "page up"),
		),
		PageDown: key.NewBinding(
			key.WithKeys("pgdown", "f"),
			key.WithHelp("pgdn/f", "page down"),
		),
		Home: key.NewBinding(
			key.WithKeys("home", "g"),
			key.WithHelp("home/g", "go to start"),
		),
		End: key.NewBinding(
			key.WithKeys("end", "G"),
			key.WithHelp("end/G", "go to end"),
		),
		Sort: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "sort column"),
		),
		SortNext: key.NewBinding(
			key.WithKeys("S"),
			key.WithHelp("S", "add sort column"),
		),
		ClearSort: key.NewBinding(
			key.WithKeys("ctrl+s"),
			key.WithHelp("ctrl+s", "clear sorting"),
		),
		Filter: key.NewBinding(
			key.WithKeys("/"),
			key.WithHelp("/", "filter"),
		),
		ClearFilter: key.NewBinding(
			key.WithKeys("ctrl+f"),
			key.WithHelp("ctrl+f", "clear filter"),
		),
	}
}

// DefaultTableStyles returns default styling
func DefaultTableStyles() TableStyles {
	return TableStyles{
		Header: lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#00D4AA")).
			BorderBottom(true).
			BorderStyle(lipgloss.NormalBorder()),
		Cell: lipgloss.NewStyle().
			Padding(0, 1),
		SelectedRow: lipgloss.NewStyle().
			Background(lipgloss.Color("#3C3C3C")).
			Foreground(lipgloss.Color("#FFFFFF")),
		SortIndicator: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#00D4AA")),
		FilterIndicator: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FFA500")),
		Border: lipgloss.NewStyle().
			Border(lipgloss.NormalBorder()).
			BorderForeground(lipgloss.Color("#9775FA")),
		StatusColors: map[string]lipgloss.Style{
			"done":        lipgloss.NewStyle().Foreground(lipgloss.Color("#00FF00")),
			"in_progress": lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFF00")),
			"pending":     lipgloss.NewStyle().Foreground(lipgloss.Color("#808080")),
			"blocked":     lipgloss.NewStyle().Foreground(lipgloss.Color("#FF0000")),
		},
		PriorityColors: map[string]lipgloss.Style{
			"critical": lipgloss.NewStyle().Foreground(lipgloss.Color("#FF0000")).Bold(true),
			"high":     lipgloss.NewStyle().Foreground(lipgloss.Color("#FFA500")),
			"medium":   lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFF00")),
			"low":      lipgloss.NewStyle().Foreground(lipgloss.Color("#808080")),
		},
	}
}

// NewTable creates a new table model
func NewTable(columns []TableColumn, rows []TableRow) *TableModel {
	vp := viewport.New(80, 20)
	vp.Style = lipgloss.NewStyle()

	t := &TableModel{
		columns:      columns,
		rows:         rows,
		filteredRows: rows,
		viewport:     vp,
		styles:       DefaultTableStyles(),
		keys:         DefaultTableKeyMap(),
		multiSort:    true,
		sortHistory:  make([]string, 0),
		renderCache:  make([]string, 0),
	}

	t.updateViewport()
	return t
}

// Init initializes the table
func (t *TableModel) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (t *TableModel) Update(msg tea.Msg) (*TableModel, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		t.width = msg.Width
		t.height = msg.Height
		t.updateViewport()

	case tea.KeyMsg:
		if t.handleKeyPress(msg) {
			t.invalidateCache()
		}
	}

	// Update viewport
	t.viewport, cmd = t.viewport.Update(msg)
	return t, cmd
}

// View renders the table
func (t *TableModel) View() string {
	if !t.cacheValid {
		t.rebuildCache()
	}

	// Render header
	header := t.renderHeader()

	// Render rows
	var visibleRows []string
	start := t.scrollOffset
	end := start + t.viewport.Height - 3 // Account for header and borders

	if end > len(t.filteredRows) {
		end = len(t.filteredRows)
	}

	for i := start; i < end; i++ {
		row := t.renderRow(i)
		visibleRows = append(visibleRows, row)
	}

	// Join everything
	content := lipgloss.JoinVertical(
		lipgloss.Left,
		header,
		strings.Join(visibleRows, "\n"),
	)

	// Add status bar
	statusBar := t.renderStatusBar()

	return lipgloss.JoinVertical(
		lipgloss.Left,
		content,
		statusBar,
	)
}

// SetColumns updates the table columns
func (t *TableModel) SetColumns(columns []TableColumn) {
	t.columns = columns
	t.invalidateCache()
}

// SetRows updates the table rows
func (t *TableModel) SetRows(rows []TableRow) {
	t.rows = rows
	t.applyFilter()
	t.applySort()
	t.invalidateCache()
}

// AddRow adds a new row to the table
func (t *TableModel) AddRow(row TableRow) {
	t.rows = append(t.rows, row)
	t.applyFilter()
	t.applySort()
	t.invalidateCache()
}

// UpdateRow updates an existing row
func (t *TableModel) UpdateRow(index int, row TableRow) {
	if index >= 0 && index < len(t.rows) {
		t.rows[index] = row
		t.applyFilter()
		t.applySort()
		t.invalidateCache()
	}
}

// RemoveRow removes a row from the table
func (t *TableModel) RemoveRow(index int) {
	if index >= 0 && index < len(t.rows) {
		t.rows = append(t.rows[:index], t.rows[index+1:]...)
		t.applyFilter()
		t.applySort()
		t.invalidateCache()
	}
}

// Sort sorts the table by a specific column
func (t *TableModel) Sort(columnKey string, direction SortDirection) {
	column := t.getColumn(columnKey)
	if column == nil || !column.Sortable {
		return
	}

	if t.multiSort && t.sortState != nil && t.sortState.Column != columnKey {
		// Add to multi-column sort
		t.sortState = &SortState{
			Column:    columnKey,
			Direction: direction,
			Secondary: t.sortState,
		}
	} else {
		// Single column sort or replace existing
		t.sortState = &SortState{
			Column:    columnKey,
			Direction: direction,
		}
	}

	t.applySort()
	t.invalidateCache()
}

// ClearSort clears all sorting
func (t *TableModel) ClearSort() {
	t.sortState = nil
	t.sortHistory = make([]string, 0)
	t.filteredRows = append([]TableRow{}, t.rows...) // Reset to original order
	t.invalidateCache()
}

// SetFilter sets a filter function
func (t *TableModel) SetFilter(filter FilterFunc) {
	t.filter = filter
	t.applyFilter()
	t.invalidateCache()
}

// SetSearchQuery sets a search query for filtering
func (t *TableModel) SetSearchQuery(query string, column string) {
	t.searchQuery = strings.ToLower(query)
	t.searchColumn = column
	t.applyFilter()
	t.invalidateCache()
}

// ClearFilter clears all filtering
func (t *TableModel) ClearFilter() {
	t.filter = nil
	t.searchQuery = ""
	t.searchColumn = ""
	t.applyFilter()
	t.invalidateCache()
}

// GetSelectedRow returns the currently selected row
func (t *TableModel) GetSelectedRow() (TableRow, bool) {
	if t.selectedRow >= 0 && t.selectedRow < len(t.filteredRows) {
		return t.filteredRows[t.selectedRow], true
	}
	return nil, false
}

// SetSelectedRow sets the selected row index
func (t *TableModel) SetSelectedRow(index int) {
	// Clamp to valid range
	if index < 0 {
		index = 0
	}
	if index >= len(t.filteredRows) && len(t.filteredRows) > 0 {
		index = len(t.filteredRows) - 1
	}
	
	t.selectedRow = index
	t.ensureRowVisible(index)
	t.invalidateCache()
}

// Focus sets the table focus state
func (t *TableModel) Focus() {
	t.focused = true
}

// Blur removes focus from the table
func (t *TableModel) Blur() {
	t.focused = false
}

// IsFocused returns the focus state
func (t *TableModel) IsFocused() bool {
	return t.focused
}

// Private helper methods

func (t *TableModel) handleKeyPress(msg tea.KeyMsg) bool {
	switch {
	case key.Matches(msg, t.keys.Up):
		if t.selectedRow > 0 {
			t.selectedRow--
			t.ensureRowVisible(t.selectedRow)
			return true
		}
	case key.Matches(msg, t.keys.Down):
		if t.selectedRow < len(t.filteredRows)-1 {
			t.selectedRow++
			t.ensureRowVisible(t.selectedRow)
			return true
		}
	case key.Matches(msg, t.keys.PageUp):
		t.selectedRow -= t.viewport.Height
		if t.selectedRow < 0 {
			t.selectedRow = 0
		}
		t.ensureRowVisible(t.selectedRow)
		return true
	case key.Matches(msg, t.keys.PageDown):
		t.selectedRow += t.viewport.Height
		if t.selectedRow >= len(t.filteredRows) {
			t.selectedRow = len(t.filteredRows) - 1
		}
		t.ensureRowVisible(t.selectedRow)
		return true
	case key.Matches(msg, t.keys.Home):
		t.selectedRow = 0
		t.scrollOffset = 0
		return true
	case key.Matches(msg, t.keys.End):
		t.selectedRow = len(t.filteredRows) - 1
		t.ensureRowVisible(t.selectedRow)
		return true
	}
	return false
}

func (t *TableModel) getColumn(key string) *TableColumn {
	for i := range t.columns {
		if t.columns[i].Key == key {
			return &t.columns[i]
		}
	}
	return nil
}

func (t *TableModel) applyFilter() {
	t.filteredRows = make([]TableRow, 0)

	for _, row := range t.rows {
		// Apply custom filter if set
		if t.filter != nil && !t.filter(row) {
			continue
		}

		// Apply search query if set
		if t.searchQuery != "" {
			if !t.matchesSearch(row) {
				continue
			}
		}

		t.filteredRows = append(t.filteredRows, row)
	}

	// Adjust selected row if necessary
	if t.selectedRow >= len(t.filteredRows) {
		t.selectedRow = len(t.filteredRows) - 1
		if t.selectedRow < 0 {
			t.selectedRow = 0
		}
	}
}

func (t *TableModel) matchesSearch(row TableRow) bool {
	if t.searchQuery == "" {
		return true
	}

	// Search specific column or all columns
	if t.searchColumn != "" {
		value, ok := row[t.searchColumn]
		if !ok {
			return false
		}
		return strings.Contains(strings.ToLower(fmt.Sprintf("%v", value)), t.searchQuery)
	}

	// Search all columns
	for _, col := range t.columns {
		value, ok := row[col.Key]
		if ok && strings.Contains(strings.ToLower(fmt.Sprintf("%v", value)), t.searchQuery) {
			return true
		}
	}

	return false
}

func (t *TableModel) applySort() {
	if t.sortState == nil {
		return
	}

	sort.SliceStable(t.filteredRows, func(i, j int) bool {
		return t.compareRows(t.filteredRows[i], t.filteredRows[j], t.sortState) < 0
	})
}

func (t *TableModel) compareRows(a, b TableRow, state *SortState) int {
	if state == nil {
		return 0
	}

	column := t.getColumn(state.Column)
	if column == nil {
		return 0
	}

	aVal, aOk := a[state.Column]
	bVal, bOk := b[state.Column]

	// Handle nil values
	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	var result int

	// Use custom comparator if available
	if column.Comparator != nil {
		result = column.Comparator(aVal, bVal)
	} else {
		// Default comparison based on data type
		result = t.defaultCompare(aVal, bVal, column.DataType)
	}

	// Apply sort direction
	if state.Direction == SortDesc {
		result = -result
	}

	// If equal and we have secondary sort, use it
	if result == 0 && state.Secondary != nil {
		return t.compareRows(a, b, state.Secondary)
	}

	return result
}

func (t *TableModel) defaultCompare(a, b interface{}, dataType DataType) int {
	switch dataType {
	case DataTypeNumber:
		aNum := toFloat64(a)
		bNum := toFloat64(b)
		if aNum < bNum {
			return -1
		} else if aNum > bNum {
			return 1
		}
		return 0

	case DataTypeDate:
		aTime := toTime(a)
		bTime := toTime(b)
		if aTime.Before(bTime) {
			return -1
		} else if aTime.After(bTime) {
			return 1
		}
		return 0

	case DataTypeBoolean:
		aBool := toBool(a)
		bBool := toBool(b)
		if !aBool && bBool {
			return -1
		} else if aBool && !bBool {
			return 1
		}
		return 0

	default: // String comparison
		aStr := fmt.Sprintf("%v", a)
		bStr := fmt.Sprintf("%v", b)
		return strings.Compare(aStr, bStr)
	}
}

func (t *TableModel) renderHeader() string {
	var headers []string
	for _, col := range t.columns {
		header := col.Title
		
		// Add sort indicator
		if t.sortState != nil && t.sortState.Column == col.Key {
			if t.sortState.Direction == SortAsc {
				header += " ↑"
			} else if t.sortState.Direction == SortDesc {
				header += " ↓"
			}
		}

		// Apply width
		if col.Width > 0 {
			header = truncateString(header, col.Width)
			header = lipgloss.NewStyle().Width(col.Width).Render(header)
		}

		headers = append(headers, t.styles.Header.Render(header))
	}

	return strings.Join(headers, " ")
}

func (t *TableModel) renderRow(index int) string {
	if index >= len(t.filteredRows) {
		return ""
	}

	row := t.filteredRows[index]
	var cells []string

	for _, col := range t.columns {
		value, ok := row[col.Key]
		if !ok {
			value = ""
		}

		// Format cell
		var cell string
		if col.Formatter != nil {
			cell = col.Formatter(value)
		} else {
			cell = t.defaultFormatter(value, col.DataType)
		}

		// Apply width
		if col.Width > 0 {
			cell = truncateString(cell, col.Width)
			cell = lipgloss.NewStyle().Width(col.Width).Render(cell)
		}

		// Apply cell style
		cellStyle := t.styles.Cell
		
		// Apply special styles for status/priority
		if col.DataType == DataTypeStatus {
			if style, ok := t.styles.StatusColors[fmt.Sprintf("%v", value)]; ok {
				cellStyle = cellStyle.Copy().Inherit(style)
			}
		} else if col.DataType == DataTypePriority {
			if style, ok := t.styles.PriorityColors[fmt.Sprintf("%v", value)]; ok {
				cellStyle = cellStyle.Copy().Inherit(style)
			}
		}

		// Apply selection style
		if index == t.selectedRow {
			cellStyle = t.styles.SelectedRow
		}

		cells = append(cells, cellStyle.Render(cell))
	}

	return strings.Join(cells, " ")
}

func (t *TableModel) defaultFormatter(value interface{}, dataType DataType) string {
	if value == nil {
		return ""
	}

	switch dataType {
	case DataTypePercentage:
		return fmt.Sprintf("%.1f%%", toFloat64(value))
	case DataTypeDate:
		tm := toTime(value)
		if !tm.IsZero() {
			return tm.Format("Jan 2 15:04")
		}
		return ""
	case DataTypeBoolean:
		if toBool(value) {
			return "✓"
		}
		return "✗"
	default:
		return fmt.Sprintf("%v", value)
	}
}

func (t *TableModel) renderStatusBar() string {
	total := len(t.rows)
	filtered := len(t.filteredRows)
	selected := t.selectedRow + 1

	status := fmt.Sprintf("Row %d/%d", selected, filtered)
	if filtered < total {
		status += fmt.Sprintf(" (%d filtered)", total-filtered)
	}

	if t.sortState != nil {
		status += fmt.Sprintf(" • Sorted by %s", t.sortState.Column)
	}

	if t.searchQuery != "" {
		status += fmt.Sprintf(" • Search: %s", t.searchQuery)
	}

	return t.styles.FilterIndicator.Render(status)
}

func (t *TableModel) updateViewport() {
	t.viewport.Width = t.width
	t.viewport.Height = t.height - 4 // Account for header and status bar
}

func (t *TableModel) ensureRowVisible(row int) {
	viewHeight := t.viewport.Height - 3

	if row < t.scrollOffset {
		t.scrollOffset = row
	} else if row >= t.scrollOffset+viewHeight {
		t.scrollOffset = row - viewHeight + 1
	}

	if t.scrollOffset < 0 {
		t.scrollOffset = 0
	}
}

func (t *TableModel) invalidateCache() {
	t.cacheValid = false
}

func (t *TableModel) rebuildCache() {
	t.renderCache = make([]string, len(t.filteredRows))
	for i := range t.filteredRows {
		t.renderCache[i] = t.renderRow(i)
	}
	t.cacheValid = true
}

// Helper functions

func truncateString(s string, width int) string {
	if len(s) <= width {
		return s
	}
	if width <= 3 {
		return s[:width]
	}
	return s[:width-3] + "..."
}

func toFloat64(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case int32:
		return float64(val)
	case string:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	default:
		return 0
	}
}

func toTime(v interface{}) time.Time {
	switch val := v.(type) {
	case time.Time:
		return val
	case *time.Time:
		if val != nil {
			return *val
		}
		return time.Time{}
	case string:
		t, _ := time.Parse(time.RFC3339, val)
		return t
	default:
		return time.Time{}
	}
}

func toBool(v interface{}) bool {
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return strings.ToLower(val) == "true" || val == "1"
	case int:
		return val != 0
	default:
		return false
	}
}