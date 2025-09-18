package components

import (
	"testing"
	"time"
)

// TestNewTable tests table creation
func TestNewTable(t *testing.T) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
		{Key: "date", Title: "Date", Width: 15, Sortable: true, DataType: DataTypeDate},
	}

	rows := []TableRow{
		{"id": 1, "name": "Task A", "date": time.Now()},
		{"id": 2, "name": "Task B", "date": time.Now().Add(-time.Hour)},
		{"id": 3, "name": "Task C", "date": time.Now().Add(-2 * time.Hour)},
	}

	table := NewTable(columns, rows)

	if table == nil {
		t.Fatal("Expected table to be created")
	}

	if len(table.columns) != len(columns) {
		t.Errorf("Expected %d columns, got %d", len(columns), len(table.columns))
	}

	if len(table.rows) != len(rows) {
		t.Errorf("Expected %d rows, got %d", len(rows), len(table.rows))
	}
}

// TestTableSorting tests single column sorting
func TestTableSorting(t *testing.T) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
		{Key: "priority", Title: "Priority", Width: 10, Sortable: true, DataType: DataTypeNumber},
	}

	rows := []TableRow{
		{"id": 3, "name": "Charlie", "priority": 1},
		{"id": 1, "name": "Alice", "priority": 3},
		{"id": 2, "name": "Bob", "priority": 2},
	}

	table := NewTable(columns, rows)

	// Test sorting by ID (ascending)
	table.Sort("id", SortAsc)

	if row, ok := table.GetSelectedRow(); ok {
		if id, ok := row["id"].(int); !ok || id != 1 {
			t.Errorf("Expected first row to have id=1 after ascending sort, got %v", id)
		}
	}

	// Test sorting by ID (descending)
	table.Sort("id", SortDesc)
	table.SetSelectedRow(0)

	if row, ok := table.GetSelectedRow(); ok {
		if id, ok := row["id"].(int); !ok || id != 3 {
			t.Errorf("Expected first row to have id=3 after descending sort, got %v", id)
		}
	}

	// Test sorting by name
	table.Sort("name", SortAsc)
	table.SetSelectedRow(0)

	if row, ok := table.GetSelectedRow(); ok {
		if name, ok := row["name"].(string); !ok || name != "Alice" {
			t.Errorf("Expected first row to have name=Alice after ascending sort, got %v", name)
		}
	}
}

// TestMultiColumnSorting tests multi-column sorting
func TestMultiColumnSorting(t *testing.T) {
	columns := []TableColumn{
		{Key: "status", Title: "Status", Width: 10, Sortable: true, DataType: DataTypeString},
		{Key: "priority", Title: "Priority", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
	}

	rows := []TableRow{
		{"status": "pending", "priority": 1, "name": "Task A"},
		{"status": "done", "priority": 2, "name": "Task B"},
		{"status": "pending", "priority": 2, "name": "Task C"},
		{"status": "done", "priority": 1, "name": "Task D"},
		{"status": "pending", "priority": 1, "name": "Task E"},
	}

	table := NewTable(columns, rows)
	table.multiSort = true

	// Sort by status first
	table.Sort("status", SortAsc)

	// Then sort by priority (should maintain status grouping)
	table.Sort("priority", SortAsc)

	// Verify the sorting is correct
	// With multi-column sort: priority first (newest), then status (older)
	// So it sorts by priority, then by status within each priority group
	// Priority 1: Task A (pending), Task D (done), Task E (pending) - sorted by status
	// Priority 2: Task B (done), Task C (pending) - sorted by status
	expectedOrder := []string{"Task D", "Task A", "Task E", "Task B", "Task C"}

	for i, expected := range expectedOrder {
		table.SetSelectedRow(i)
		if row, ok := table.GetSelectedRow(); ok {
			if name, ok := row["name"].(string); !ok || name != expected {
				t.Errorf("Row %d: expected %s, got %s", i, expected, name)
			}
		}
	}
}

// TestTableFiltering tests table filtering functionality
func TestTableFiltering(t *testing.T) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "status", Title: "Status", Width: 15, Sortable: true, DataType: DataTypeString},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
	}

	rows := []TableRow{
		{"id": 1, "status": "done", "name": "Completed Task"},
		{"id": 2, "status": "pending", "name": "Waiting Task"},
		{"id": 3, "status": "in_progress", "name": "Active Task"},
		{"id": 4, "status": "done", "name": "Finished Task"},
		{"id": 5, "status": "blocked", "name": "Blocked Task"},
	}

	table := NewTable(columns, rows)

	// Test custom filter function
	table.SetFilter(func(row TableRow) bool {
		status, ok := row["status"].(string)
		return ok && status == "done"
	})

	if len(table.filteredRows) != 2 {
		t.Errorf("Expected 2 filtered rows for status=done, got %d", len(table.filteredRows))
	}

	// Test search query filtering
	table.ClearFilter()
	table.SetSearchQuery("task", "")

	if len(table.filteredRows) != 5 {
		t.Errorf("Expected 5 filtered rows for 'task' search, got %d", len(table.filteredRows))
	}

	// Test column-specific search
	table.SetSearchQuery("active", "name")

	if len(table.filteredRows) != 1 {
		t.Errorf("Expected 1 filtered row for 'active' in name column, got %d", len(table.filteredRows))
	}
}

// TestDataTypeComparison tests comparison for different data types
func TestDataTypeComparison(t *testing.T) {
	columns := []TableColumn{
		{Key: "date", Title: "Date", Width: 20, Sortable: true, DataType: DataTypeDate},
		{Key: "number", Title: "Number", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "bool", Title: "Bool", Width: 10, Sortable: true, DataType: DataTypeBoolean},
		{Key: "percent", Title: "Percent", Width: 10, Sortable: true, DataType: DataTypePercentage},
	}

	now := time.Now()
	rows := []TableRow{
		{"date": now.Add(-time.Hour), "number": 10, "bool": true, "percent": 75.5},
		{"date": now, "number": 5, "bool": false, "percent": 50.0},
		{"date": now.Add(time.Hour), "number": 15, "bool": true, "percent": 100.0},
	}

	table := NewTable(columns, rows)

	// Test date sorting
	table.Sort("date", SortAsc)
	table.SetSelectedRow(0)

	if row, ok := table.GetSelectedRow(); ok {
		if num, ok := row["number"].(int); !ok || num != 10 {
			t.Errorf("Expected first row after date sort to have number=10, got %v", num)
		}
	}

	// Test number sorting
	table.Sort("number", SortDesc)
	table.SetSelectedRow(0)

	if row, ok := table.GetSelectedRow(); ok {
		if num, ok := row["number"].(int); !ok || num != 15 {
			t.Errorf("Expected first row after number sort to have number=15, got %v", num)
		}
	}

	// Test boolean sorting (false < true)
	table.Sort("bool", SortAsc)
	table.SetSelectedRow(0)

	if row, ok := table.GetSelectedRow(); ok {
		if b, ok := row["bool"].(bool); !ok || b != false {
			t.Errorf("Expected first row after bool sort to be false, got %v", b)
		}
	}
}

// TestCustomComparator tests custom comparator functions
func TestCustomComparator(t *testing.T) {
	// Custom comparator that sorts by string length
	lengthComparator := func(a, b interface{}) int {
		aStr, aOk := a.(string)
		bStr, bOk := b.(string)

		if !aOk && !bOk {
			return 0
		}
		if !aOk {
			return 1
		}
		if !bOk {
			return -1
		}

		if len(aStr) < len(bStr) {
			return -1
		} else if len(aStr) > len(bStr) {
			return 1
		}
		return 0
	}

	columns := []TableColumn{
		{
			Key:        "name",
			Title:      "Name",
			Width:      20,
			Sortable:   true,
			DataType:   DataTypeCustom,
			Comparator: lengthComparator,
		},
	}

	rows := []TableRow{
		{"name": "Short"},
		{"name": "Very Long Name"},
		{"name": "Medium"},
	}

	table := NewTable(columns, rows)
	table.Sort("name", SortAsc)

	// Should be sorted by length: "Short" (5), "Medium" (6), "Very Long Name" (14)
	expectedOrder := []string{"Short", "Medium", "Very Long Name"}

	for i, expected := range expectedOrder {
		table.SetSelectedRow(i)
		if row, ok := table.GetSelectedRow(); ok {
			if name, ok := row["name"].(string); !ok || name != expected {
				t.Errorf("Row %d: expected %s, got %s", i, expected, name)
			}
		}
	}
}

// TestCustomFormatter tests custom formatter functions
func TestCustomFormatter(t *testing.T) {
	// Custom formatter that adds prefix
	prefixFormatter := func(v interface{}) string {
		if str, ok := v.(string); ok {
			return ">> " + str
		}
		return ""
	}

	columns := []TableColumn{
		{
			Key:       "name",
			Title:     "Name",
			Width:     20,
			Sortable:  true,
			DataType:  DataTypeCustom,
			Formatter: prefixFormatter,
		},
	}

	rows := []TableRow{
		{"name": "Test"},
	}

	table := NewTable(columns, rows)

	// The formatter should be used when rendering
	// This would be tested more thoroughly with integration tests
	if table.columns[0].Formatter == nil {
		t.Error("Expected formatter to be set")
	}

	formatted := table.columns[0].Formatter("Test")
	if formatted != ">> Test" {
		t.Errorf("Expected formatter to add prefix, got %s", formatted)
	}
}

// TestTableNavigation tests keyboard navigation
func TestTableNavigation(t *testing.T) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
	}

	rows := make([]TableRow, 100)
	for i := 0; i < 100; i++ {
		rows[i] = TableRow{"id": i}
	}

	table := NewTable(columns, rows)
	table.height = 20 // Set viewport height

	// Test selection bounds
	table.SetSelectedRow(-1)
	if table.selectedRow != 0 {
		t.Error("Selected row should be clamped to 0")
	}

	table.SetSelectedRow(200)
	if table.selectedRow != 99 {
		t.Error("Selected row should be clamped to last row")
	}

	// Test scroll offset adjustment
	table.SetSelectedRow(50)
	table.ensureRowVisible(50)

	if table.scrollOffset <= 0 {
		t.Error("Scroll offset should adjust to make row 50 visible")
	}
}

// TestPerformanceWithLargeDataset tests performance with many rows
func TestPerformanceWithLargeDataset(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
		{Key: "value", Title: "Value", Width: 10, Sortable: true, DataType: DataTypeNumber},
	}

	// Create 10,000 rows
	rows := make([]TableRow, 10000)
	for i := 0; i < 10000; i++ {
		rows[i] = TableRow{
			"id":    i,
			"name":  "Item " + string(rune('A'+i%26)),
			"value": i * 10,
		}
	}

	table := NewTable(columns, rows)

	// Measure sort performance
	start := time.Now()
	table.Sort("value", SortDesc)
	sortDuration := time.Since(start)

	if sortDuration > 100*time.Millisecond {
		t.Errorf("Sorting 10,000 rows took too long: %v", sortDuration)
	}

	// Measure filter performance
	start = time.Now()
	table.SetSearchQuery("Item A", "")
	filterDuration := time.Since(start)

	if filterDuration > 50*time.Millisecond {
		t.Errorf("Filtering 10,000 rows took too long: %v", filterDuration)
	}

	// Verify filtered results
	expectedCount := 0
	for _, row := range rows {
		if name, ok := row["name"].(string); ok && name == "Item A" {
			expectedCount++
		}
	}

	if len(table.filteredRows) != expectedCount {
		t.Errorf("Expected %d filtered rows, got %d", expectedCount, len(table.filteredRows))
	}
}

// Benchmark tests

func BenchmarkTableSort(b *testing.B) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
	}

	rows := make([]TableRow, 1000)
	for i := 0; i < 1000; i++ {
		rows[i] = TableRow{
			"id":   1000 - i,
			"name": "Item " + string(rune('A'+i%26)),
		}
	}

	table := NewTable(columns, rows)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		table.Sort("id", SortAsc)
	}
}

func BenchmarkTableFilter(b *testing.B) {
	columns := []TableColumn{
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
	}

	rows := make([]TableRow, 1000)
	for i := 0; i < 1000; i++ {
		rows[i] = TableRow{
			"name": "Item " + string(rune('A'+i%26)),
		}
	}

	table := NewTable(columns, rows)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		table.SetSearchQuery("Item A", "")
		table.ClearFilter()
	}
}

func BenchmarkTableRender(b *testing.B) {
	columns := []TableColumn{
		{Key: "id", Title: "ID", Width: 10, Sortable: true, DataType: DataTypeNumber},
		{Key: "name", Title: "Name", Width: 20, Sortable: true, DataType: DataTypeString},
		{Key: "status", Title: "Status", Width: 15, Sortable: true, DataType: DataTypeString},
	}

	rows := make([]TableRow, 100)
	for i := 0; i < 100; i++ {
		rows[i] = TableRow{
			"id":     i,
			"name":   "Item " + string(rune('A'+i%26)),
			"status": "active",
		}
	}

	table := NewTable(columns, rows)
	table.width = 80
	table.height = 20

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = table.View()
	}
}