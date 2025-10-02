package components

import (
	"fmt"
	"strings"
	"time"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/taskmaster"
)

// AgentTableModel extends DataTableModel for TaskMaster agents
type AgentTableModel struct {
	*DataTableModel
	agents []taskmaster.Agent
}

// NewAgentTable creates a new agent table with predefined columns
func NewAgentTable(agents []taskmaster.Agent) *AgentTableModel {
	columns := []DataTableColumn{
		{
			Key:      "status_icon",
			Title:    "●",
			Width:    3,
			Sortable: false,
			DataType: DataTypeCustom,
			Formatter: func(v interface{}) string {
				if agent, ok := v.(*taskmaster.Agent); ok {
					return agent.GetAgentStatusSymbol()
				}
				return ""
			},
		},
		{
			Key:        "id",
			Title:      "ID",
			Width:      20,
			Sortable:   true,
			DataType:   DataTypeString,
		},
		{
			Key:        "name",
			Title:      "Name",
			Width:      25,
			Sortable:   true,
			DataType:   DataTypeString,
		},
		{
			Key:        "type",
			Title:      "Type",
			Width:      15,
			Sortable:   true,
			DataType:   DataTypeString,
			Formatter:  formatAgentType,
		},
		{
			Key:        "status",
			Title:      "Status",
			Width:      12,
			Sortable:   true,
			DataType:   DataTypeStatus,
			Formatter:  formatAgentStatus,
			Comparator: compareAgentStatus,
		},
		{
			Key:        "current_task",
			Title:      "Current Task",
			Width:      10,
			Sortable:   true,
			DataType:   DataTypeCustom,
			Formatter:  formatCurrentTask,
			Comparator: compareCurrentTask,
		},
		{
			Key:        "tasks_completed",
			Title:      "Completed",
			Width:      12,
			Sortable:   true,
			DataType:   DataTypeNumber,
			Formatter:  formatTaskCount,
		},
		{
			Key:        "success_rate",
			Title:      "Success",
			Width:      10,
			Sortable:   true,
			DataType:   DataTypePercentage,
			Formatter:  formatSuccessRate,
			Comparator: compareSuccessRate,
		},
		{
			Key:        "efficiency",
			Title:      "Efficiency",
			Width:      12,
			Sortable:   true,
			DataType:   DataTypeCustom,
			Formatter:  formatEfficiency,
			Comparator: compareEfficiency,
		},
		{
			Key:        "last_active",
			Title:      "Last Active",
			Width:      15,
			Sortable:   true,
			DataType:   DataTypeDate,
			Formatter:  formatLastActive,
		},
		{
			Key:        "capabilities",
			Title:      "Capabilities",
			Width:      25,
			Sortable:   false,
			DataType:   DataTypeCustom,
			Formatter:  formatCapabilities,
		},
	}

	// Convert agents to table rows
	rows := agentsToRows(agents)

	// Create base table with default config
	config := DataTableConfig{
		Type:              DataTableTypeAgents,
		Title:             "Agents",
		ShowHeader:        true,
		ShowFooter:        true,
		ShowBorder:        true,
		ShowRowNumbers:    false,
		ShowStatusBar:     true,
		EnableSorting:     true,
		EnableFiltering:   true,
		EnableSearch:      true,
		EnableMultiSelect: false,
		PageSize:          20,
	}
	table := NewDataTable(config)
	table.SetColumns(columns)
	table.SetRows(rows)

	// Note: Custom styling removed for now as DataTableModel doesn't expose styles

	return &AgentTableModel{
		DataTableModel: table,
		agents:         agents,
	}
}

// UpdateAgents updates the agent list and refreshes the table
func (at *AgentTableModel) UpdateAgents(agents []taskmaster.Agent) {
	at.agents = agents
	rows := agentsToRows(agents)
	at.SetRows(rows)
}

// GetSelectedAgent returns the currently selected agent
func (at *AgentTableModel) GetSelectedAgent() (*taskmaster.Agent, bool) {
	row, ok := at.GetSelectedRow()
	if !ok {
		return nil, false
	}

	// Find the agent by ID
	if id, ok := row["id"].(string); ok {
		for i, agent := range at.agents {
			if agent.ID == id {
				return &at.agents[i], true
			}
		}
	}

	return nil, false
}

// ApplyAgentFilters applies common agent filtering patterns
func (at *AgentTableModel) ApplyAgentFilters(filters AgentFilters) {
	at.SetFilter(func(row TableRow) bool {
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

		// Type filter
		if filters.Type != "" {
			agentType, _ := row["type"].(string)
			if !strings.Contains(strings.ToLower(agentType), strings.ToLower(filters.Type)) {
				return false
			}
		}

		// Active only filter
		if filters.ActiveOnly {
			status, _ := row["status"].(string)
			if status != "active" && status != "busy" {
				return false
			}
		}

		// Error only filter
		if filters.ErrorOnly {
			status, _ := row["status"].(string)
			if status != "error" {
				return false
			}
		}

		// Minimum success rate filter
		if filters.MinSuccessRate > 0 {
			successRate, _ := row["success_rate"].(float64)
			if successRate < filters.MinSuccessRate {
				return false
			}
		}

		// Capability filter
		if len(filters.RequiredCapabilities) > 0 {
			capabilities, _ := row["capabilities"].([]string)
			for _, required := range filters.RequiredCapabilities {
				found := false
				for _, cap := range capabilities {
					if strings.EqualFold(cap, required) {
						found = true
						break
					}
				}
				if !found {
					return false
				}
			}
		}

		// Idle time filter
		if filters.MaxIdleTime > 0 {
			lastActive, _ := row["last_active"].(time.Time)
			if !lastActive.IsZero() {
				idleTime := time.Since(lastActive)
				if idleTime > filters.MaxIdleTime {
					return false
				}
			}
		}

		return true
	})
}

// AgentFilters represents filtering options for agents
type AgentFilters struct {
	Statuses             []taskmaster.AgentStatus
	Type                 string
	ActiveOnly           bool
	ErrorOnly            bool
	MinSuccessRate       float64
	RequiredCapabilities []string
	MaxIdleTime          time.Duration
}

// GetAgentMetrics calculates aggregate metrics for filtered agents
func (at *AgentTableModel) GetAgentMetrics() AgentMetrics {
	metrics := AgentMetrics{}

	for _, row := range at.filteredRows {
		// Count by status
		if status, ok := row["status"].(string); ok {
			switch status {
			case "active":
				metrics.ActiveCount++
			case "busy":
				metrics.BusyCount++
			case "idle":
				metrics.IdleCount++
			case "error":
				metrics.ErrorCount++
			case "offline":
				metrics.OfflineCount++
			}
			metrics.TotalCount++
		}

		// Aggregate performance metrics
		if completed, ok := row["tasks_completed"].(int); ok {
			metrics.TotalTasksCompleted += completed
		}

		if failed, ok := row["tasks_failed"].(int); ok {
			metrics.TotalTasksFailed += failed
		}

		if successRate, ok := row["success_rate"].(float64); ok {
			metrics.TotalSuccessRate += successRate
		}

		if avgTime, ok := row["average_time"].(float64); ok {
			metrics.TotalAverageTime += avgTime
		}
	}

	// Calculate averages
	if metrics.TotalCount > 0 {
		metrics.AverageSuccessRate = metrics.TotalSuccessRate / float64(metrics.TotalCount)
		metrics.AverageTaskTime = metrics.TotalAverageTime / float64(metrics.TotalCount)
	}

	return metrics
}

// AgentMetrics represents aggregate metrics for agents
type AgentMetrics struct {
	TotalCount          int
	ActiveCount         int
	BusyCount           int
	IdleCount           int
	ErrorCount          int
	OfflineCount        int
	TotalTasksCompleted int
	TotalTasksFailed    int
	AverageSuccessRate  float64
	AverageTaskTime     float64
	TotalSuccessRate    float64
	TotalAverageTime    float64
}

// Helper functions for agent table

func agentsToRows(agents []taskmaster.Agent) []TableRow {
	rows := make([]TableRow, len(agents))
	for i, agent := range agents {
		rows[i] = agentToRow(agent)
	}
	return rows
}

func agentToRow(agent taskmaster.Agent) TableRow {
	row := make(TableRow)

	row["id"] = agent.ID
	row["name"] = agent.Name
	row["type"] = agent.Type
	row["status"] = string(agent.Status)
	row["current_task"] = agent.CurrentTask
	row["capabilities"] = agent.Capabilities
	row["created_at"] = agent.CreatedAt
	row["last_active"] = agent.LastActive
	
	// Performance metrics
	row["tasks_completed"] = agent.Performance.TasksCompleted
	row["tasks_failed"] = agent.Performance.TasksFailed
	row["success_rate"] = agent.Performance.SuccessRate * 100 // Convert to percentage
	row["average_time"] = agent.Performance.AverageTime
	row["last_task_time"] = agent.Performance.LastTaskTime
	
	// Store the full agent for custom formatters
	row["_agent"] = &agent
	
	// Calculate efficiency rating
	row["efficiency"] = agent.GetEfficiencyRating()
	
	return row
}

// Formatter functions

func formatAgentType(v interface{}) string {
	agentType, ok := v.(string)
	if !ok {
		return ""
	}

	// Add icons for common agent types
	icons := map[string]string{
		"analyzer":     "🔍",
		"builder":      "🔨",
		"tester":       "🧪",
		"deployer":     "🚀",
		"monitor":      "📊",
		"orchestrator": "🎭",
	}

	typeLabel := agentType
	for key, icon := range icons {
		if strings.Contains(strings.ToLower(agentType), key) {
			typeLabel = fmt.Sprintf("%s %s", icon, agentType)
			break
		}
	}

	return typeLabel
}

func formatAgentStatus(v interface{}) string {
	status, ok := v.(string)
	if !ok {
		return ""
	}

	labels := map[string]string{
		"active":  "🟢 Active",
		"busy":    "🔄 Busy",
		"idle":    "🟡 Idle",
		"error":   "🔴 Error",
		"offline": "⚫ Offline",
	}

	if label, ok := labels[status]; ok {
		return label
	}
	return status
}

func formatCurrentTask(v interface{}) string {
	taskID, ok := v.(*int)
	if !ok || taskID == nil {
		return "None"
	}

	return fmt.Sprintf("Task #%d", *taskID)
}

func formatTaskCount(v interface{}) string {
	count, ok := v.(int)
	if !ok {
		return "0"
	}

	return fmt.Sprintf("%d tasks", count)
}

func formatSuccessRate(v interface{}) string {
	rate, ok := v.(float64)
	if !ok {
		return "0%"
	}

	// Visual indicator based on success rate
	var indicator string
	switch {
	case rate >= 95:
		indicator = "🌟"
	case rate >= 85:
		indicator = "✨"
	case rate >= 70:
		indicator = "⭐"
	case rate >= 50:
		indicator = "💫"
	default:
		indicator = "⚠️"
	}

	return fmt.Sprintf("%s %.1f%%", indicator, rate)
}

func formatEfficiency(v interface{}) string {
	rating, ok := v.(string)
	if !ok {
		return ""
	}

	// Visual efficiency meter
	meters := map[string]string{
		"Excellent":      "████████████",
		"Good":           "█████████░░░",
		"Average":        "██████░░░░░░",
		"Below Average":  "███░░░░░░░░░",
		"Poor":           "█░░░░░░░░░░░",
	}

	if meter, ok := meters[rating]; ok {
		return fmt.Sprintf("%s %s", meter, rating)
	}

	return rating
}

func formatLastActive(v interface{}) string {
	t, ok := v.(time.Time)
	if !ok || t.IsZero() {
		return "Never"
	}

	// Show relative time
	now := time.Now()
	diff := now.Sub(t)

	if diff < time.Minute {
		return "Active now"
	} else if diff < time.Hour {
		return fmt.Sprintf("%dm ago", int(diff.Minutes()))
	} else if diff < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(diff.Hours()))
	} else if diff < 7*24*time.Hour {
		return fmt.Sprintf("%dd ago", int(diff.Hours()/24))
	}

	return t.Format("Jan 2, 15:04")
}

func formatCapabilities(v interface{}) string {
	caps, ok := v.([]string)
	if !ok || len(caps) == 0 {
		return "None"
	}

	// Truncate if too many capabilities
	if len(caps) > 3 {
		return fmt.Sprintf("%s... +%d", strings.Join(caps[:3], ", "), len(caps)-3)
	}

	return strings.Join(caps, ", ")
}

// Comparator functions

func compareAgentStatus(a, b interface{}) int {
	// Define status order priority (active/busy agents first)
	statusOrder := map[string]int{
		"error":   0, // Errors need immediate attention
		"busy":    1,
		"active":  2,
		"idle":    3,
		"offline": 4,
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

func compareCurrentTask(a, b interface{}) int {
	aTask, aOk := a.(*int)
	bTask, bOk := b.(*int)

	// Agents with tasks come first
	if aOk && aTask != nil && (!bOk || bTask == nil) {
		return -1
	}
	if bOk && bTask != nil && (!aOk || aTask == nil) {
		return 1
	}

	if !aOk || aTask == nil || !bOk || bTask == nil {
		return 0
	}

	if *aTask < *bTask {
		return -1
	} else if *aTask > *bTask {
		return 1
	}
	return 0
}

func compareSuccessRate(a, b interface{}) int {
	aRate, aOk := a.(float64)
	bRate, bOk := b.(float64)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	// Higher success rate is better
	if aRate > bRate {
		return -1
	} else if aRate < bRate {
		return 1
	}
	return 0
}

func compareEfficiency(a, b interface{}) int {
	// Define efficiency order (better efficiency first)
	efficiencyOrder := map[string]int{
		"Excellent":      0,
		"Good":           1,
		"Average":        2,
		"Below Average":  3,
		"Poor":           4,
	}

	aEff, aOk := a.(string)
	bEff, bOk := b.(string)

	if !aOk && !bOk {
		return 0
	}
	if !aOk {
		return 1
	}
	if !bOk {
		return -1
	}

	aOrder, aExists := efficiencyOrder[aEff]
	bOrder, bExists := efficiencyOrder[bEff]

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