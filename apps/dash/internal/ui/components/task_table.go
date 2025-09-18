package components

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
)

// TaskTableModel extends TableModel for TaskMaster tasks
type TaskTableModel struct {
	*TableModel
	tasks []taskmaster.Task
}

// NewTaskTable creates a new task table with predefined columns
func NewTaskTable(tasks []taskmaster.Task) *TaskTableModel {
	columns := []TableColumn{
		{
			Key:        "id",
			Title:      "ID",
			Width:      6,
			Sortable:   true,
			DataType:   DataTypeNumber,
			Comparator: compareTaskIDs,
		},
		{
			Key:      "priority_icon",
			Title:    "P",
			Width:    3,
			Sortable: false,
			DataType: DataTypeCustom,
			Formatter: func(v interface{}) string {
				if task, ok := v.(taskmaster.Task); ok {
					return task.GetPrioritySymbol()
				}
				return ""
			},
		},
		{
			Key:        "title",
			Title:      "Title",
			Width:      40,
			Sortable:   true,
			DataType:   DataTypeString,
		},
		{
			Key:        "status",
			Title:      "Status",
			Width:      12,
			Sortable:   true,
			DataType:   DataTypeStatus,
			Formatter:  formatTaskStatus,
			Comparator: compareTaskStatus,
		},
		{
			Key:        "priority",
			Title:      "Priority",
			Width:      10,
			Sortable:   true,
			DataType:   DataTypePriority,
			Formatter:  formatTaskPriority,
			Comparator: compareTaskPriority,
		},
		{
			Key:        "complexity",
			Title:      "Complexity",
			Width:      12,
			Sortable:   true,
			DataType:   DataTypeNumber,
			Formatter:  formatComplexity,
		},
		{
			Key:        "assignee",
			Title:      "Assignee",
			Width:      15,
			Sortable:   true,
			DataType:   DataTypeString,
		},
		{
			Key:        "estimated_hours",
			Title:      "Est. Hours",
			Width:      10,
			Sortable:   true,
			DataType:   DataTypeNumber,
			Formatter:  formatHours,
		},
		{
			Key:        "dependencies",
			Title:      "Deps",
			Width:      8,
			Sortable:   true,
			DataType:   DataTypeCustom,
			Formatter:  formatDependencies,
			Comparator: compareDependencies,
		},
		{
			Key:        "updated_at",
			Title:      "Updated",
			Width:      16,
			Sortable:   true,
			DataType:   DataTypeDate,
			Formatter:  formatDate,
		},
	}

	// Convert tasks to table rows
	rows := tasksToRows(tasks)

	// Create base table
	table := NewTable(columns, rows)

	// Customize styles for tasks
	table.styles.StatusColors = map[string]lipgloss.Style{
		"done":        lipgloss.NewStyle().Foreground(lipgloss.Color("#00FF00")).Bold(true),
		"in_progress": lipgloss.NewStyle().Foreground(lipgloss.Color("#FFA500")),
		"pending":     lipgloss.NewStyle().Foreground(lipgloss.Color("#808080")),
		"blocked":     lipgloss.NewStyle().Foreground(lipgloss.Color("#FF0000")).Bold(true),
		"deferred":    lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFF00")),
		"cancelled":   lipgloss.NewStyle().Foreground(lipgloss.Color("#666666")).Strikethrough(true),
	}

	table.styles.PriorityColors = map[string]lipgloss.Style{
		"critical": lipgloss.NewStyle().Foreground(lipgloss.Color("#FF0000")).Bold(true).Blink(true),
		"high":     lipgloss.NewStyle().Foreground(lipgloss.Color("#FF6600")).Bold(true),
		"medium":   lipgloss.NewStyle().Foreground(lipgloss.Color("#FFAA00")),
		"low":      lipgloss.NewStyle().Foreground(lipgloss.Color("#808080")),
	}

	return &TaskTableModel{
		TableModel: table,
		tasks:      tasks,
	}
}

// UpdateTasks updates the task list and refreshes the table
func (tt *TaskTableModel) UpdateTasks(tasks []taskmaster.Task) {
	tt.tasks = tasks
	rows := tasksToRows(tasks)
	tt.SetRows(rows)
}

// GetSelectedTask returns the currently selected task
func (tt *TaskTableModel) GetSelectedTask() (*taskmaster.Task, bool) {
	row, ok := tt.GetSelectedRow()
	if !ok {
		return nil, false
	}

	// Find the task by ID
	if id, ok := row["id"].(int); ok {
		for i, task := range tt.tasks {
			if task.ID == id {
				return &tt.tasks[i], true
			}
		}
	}

	return nil, false
}

// ApplyTaskFilters applies common task filtering patterns
func (tt *TaskTableModel) ApplyTaskFilters(filters TaskFilters) {
	tt.SetFilter(func(row TableRow) bool {
		// Status filter
		if len(filters.Statuses) > 0 {
			status, _ := row["status"].(string)
			found := false
			for _, s := range filters.Statuses {
				if status == string(s) {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}

		// Priority filter
		if len(filters.Priorities) > 0 {
			priority, _ := row["priority"].(string)
			found := false
			for _, p := range filters.Priorities {
				if priority == string(p) {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}

		// Assignee filter
		if filters.Assignee != "" {
			assignee, _ := row["assignee"].(string)
			if assignee != filters.Assignee {
				return false
			}
		}

		// Blocked tasks filter
		if filters.BlockedOnly {
			status, _ := row["status"].(string)
			if status != "blocked" {
				return false
			}
		}

		// Overdue filter
		if filters.OverdueOnly {
			// Check if task has estimated completion and is overdue
			if estimatedDate, ok := row["estimated_completion"].(time.Time); ok {
				if !estimatedDate.IsZero() && time.Now().After(estimatedDate) {
					status, _ := row["status"].(string)
					if status != "done" && status != "cancelled" {
						return true
					}
				}
			}
			return false
		}

		// Complexity filter
		if filters.MinComplexity > 0 {
			complexity, _ := row["complexity"].(int)
			if complexity < filters.MinComplexity {
				return false
			}
		}

		if filters.MaxComplexity > 0 {
			complexity, _ := row["complexity"].(int)
			if complexity > filters.MaxComplexity {
				return false
			}
		}

		// Tag filter
		if len(filters.Tags) > 0 {
			tags, _ := row["tags"].([]string)
			found := false
			for _, filterTag := range filters.Tags {
				for _, taskTag := range tags {
					if strings.EqualFold(taskTag, filterTag) {
						found = true
						break
					}
				}
				if found {
					break
				}
			}
			if !found {
				return false
			}
		}

		return true
	})
}

// TaskFilters represents filtering options for tasks
type TaskFilters struct {
	Statuses      []taskmaster.TaskStatus
	Priorities    []taskmaster.TaskPriority
	Assignee      string
	BlockedOnly   bool
	OverdueOnly   bool
	MinComplexity int
	MaxComplexity int
	Tags          []string
}

// Helper functions for task table

func tasksToRows(tasks []taskmaster.Task) []TableRow {
	rows := make([]TableRow, len(tasks))
	for i, task := range tasks {
		rows[i] = taskToRow(task)
	}
	return rows
}

func taskToRow(task taskmaster.Task) TableRow {
	row := make(TableRow)
	
	row["id"] = task.ID
	row["title"] = task.Title
	row["description"] = task.Description
	row["status"] = string(task.Status)
	row["priority"] = string(task.Priority)
	row["complexity"] = task.Complexity
	row["dependencies"] = task.Dependencies
	row["created_at"] = task.CreatedAt
	row["updated_at"] = task.UpdatedAt
	row["tags"] = task.Tags
	row["assignee"] = task.Assignee
	row["estimated_hours"] = task.EstimatedHours
	row["actual_hours"] = task.ActualHours
	
	// Store the full task for custom formatters
	row["_task"] = task
	
	if task.CompletedAt != nil {
		row["completed_at"] = *task.CompletedAt
	}
	
	// Calculate estimated completion based on creation + estimated hours
	if task.EstimatedHours > 0 {
		estimatedCompletion := task.CreatedAt.Add(time.Duration(task.EstimatedHours) * time.Hour)
		row["estimated_completion"] = estimatedCompletion
	}
	
	return row
}

// Formatter functions

func formatTaskStatus(v interface{}) string {
	status, ok := v.(string)
	if !ok {
		return ""
	}

	icons := map[string]string{
		"done":        "✅ Done",
		"in_progress": "🔄 In Progress",
		"pending":     "⏳ Pending",
		"blocked":     "🚫 Blocked",
		"deferred":    "⏸️  Deferred",
		"cancelled":   "❌ Cancelled",
	}

	if icon, ok := icons[status]; ok {
		return icon
	}
	return status
}

func formatTaskPriority(v interface{}) string {
	priority, ok := v.(string)
	if !ok {
		return ""
	}

	labels := map[string]string{
		"critical": "🔥 Critical",
		"high":     "⚡ High",
		"medium":   "📋 Medium",
		"low":      "📝 Low",
	}

	if label, ok := labels[priority]; ok {
		return label
	}
	return priority
}

func formatComplexity(v interface{}) string {
	complexity, ok := v.(int)
	if !ok {
		return ""
	}

	// Visual complexity indicator
	bars := ""
	for i := 0; i < complexity && i < 10; i++ {
		bars += "█"
	}
	for i := complexity; i < 10; i++ {
		bars += "░"
	}

	level := ""
	switch {
	case complexity <= 2:
		level = "Simple"
	case complexity <= 4:
		level = "Easy"
	case complexity <= 6:
		level = "Medium"
	case complexity <= 8:
		level = "Hard"
	default:
		level = "Expert"
	}

	return fmt.Sprintf("%s %s", bars, level)
}

func formatDependencies(v interface{}) string {
	deps, ok := v.([]int)
	if !ok {
		return "0"
	}

	count := len(deps)
	if count == 0 {
		return "None"
	}

	return fmt.Sprintf("%d deps", count)
}

func formatHours(v interface{}) string {
	hours, ok := v.(float64)
	if !ok || hours == 0 {
		return "-"
	}

	if hours < 1 {
		return fmt.Sprintf("%dm", int(hours*60))
	}

	return fmt.Sprintf("%.1fh", hours)
}

func formatDate(v interface{}) string {
	t, ok := v.(time.Time)
	if !ok || t.IsZero() {
		return ""
	}

	// Show relative time for recent dates
	now := time.Now()
	diff := now.Sub(t)

	if diff < time.Minute {
		return "just now"
	} else if diff < time.Hour {
		return fmt.Sprintf("%dm ago", int(diff.Minutes()))
	} else if diff < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(diff.Hours()))
	} else if diff < 7*24*time.Hour {
		return fmt.Sprintf("%dd ago", int(diff.Hours()/24))
	}

	return t.Format("Jan 2, 15:04")
}

// Comparator functions

func compareTaskIDs(a, b interface{}) int {
	aID, aOk := a.(int)
	bID, bOk := b.(int)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	if aID < bID {
		return -1
	} else if aID > bID {
		return 1
	}
	return 0
}

func compareTaskStatus(a, b interface{}) int {
	// Define status order priority
	statusOrder := map[string]int{
		"blocked":     0,
		"in_progress": 1,
		"pending":     2,
		"deferred":    3,
		"done":        4,
		"cancelled":   5,
	}

	aStatus, aOk := a.(string)
	bStatus, bOk := b.(string)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	aOrder, aExists := statusOrder[aStatus]
	bOrder, bExists := statusOrder[bStatus]

	if !aExists {
		aOrder = 99
	}
	if !bExists {
		bOrder = 99
	}

	if aOrder < bOrder {
		return -1
	} else if aOrder > bOrder {
		return 1
	}
	return 0
}

func compareTaskPriority(a, b interface{}) int {
	// Define priority order (higher priority first)
	priorityOrder := map[string]int{
		"critical": 0,
		"high":     1,
		"medium":   2,
		"low":      3,
	}

	aPriority, aOk := a.(string)
	bPriority, bOk := b.(string)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	aOrder, aExists := priorityOrder[aPriority]
	bOrder, bExists := priorityOrder[bPriority]

	if !aExists {
		aOrder = 99
	}
	if !bExists {
		bOrder = 99
	}

	if aOrder < bOrder {
		return -1
	} else if aOrder > bOrder {
		return 1
	}
	return 0
}

func compareDependencies(a, b interface{}) int {
	aDeps, aOk := a.([]int)
	bDeps, bOk := b.([]int)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	aCount := len(aDeps)
	bCount := len(bDeps)

	if aCount < bCount {
		return -1
	} else if aCount > bCount {
		return 1
	}
	return 0
}