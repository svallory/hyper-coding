# TaskMaster Integration API Documentation

Complete API reference for HyperDash's TaskMaster CLI integration, providing real-time task and agent monitoring capabilities.

## 📋 Overview

HyperDash integrates seamlessly with TaskMaster CLI to provide:
- Real-time task monitoring and status tracking
- Agent efficiency analytics and performance metrics
- Automatic synchronization with TaskMaster workflows
- Comprehensive project management capabilities

## 🏗️ Architecture

### Integration Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   HyperDash     │    │  TaskMaster      │    │  TaskMaster     │
│   Dashboard     │◄──►│  Integration     │◄──►│  CLI            │
│                 │    │  Layer           │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   UI Components │    │  Client & Cache  │    │  JSON Output    │
│   • Tasks Tab   │    │  • Auto-sync     │    │  • Tasks        │
│   • Agents Tab  │    │  • Error Handle  │    │  • Agents       │
│   • Performance │    │  • Health Check  │    │  • Projects     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔌 Core API Components

### Integration Client

The main interface for TaskMaster communication:

```go
type Integration struct {
    client    *Client
    epicDir   string
    config    IntegrationConfig
    isRunning bool
    subscribers []chan Update
}
```

#### Initialization

```go
// Create new TaskMaster integration
integration := NewIntegration(IntegrationConfig{
    EpicDir:      "/path/to/epic",
    Command:      "task-master",
    Timeout:      30 * time.Second,
    SyncInterval: 5 * time.Second,
    CacheTTL:     10 * time.Second,
})

// Check if TaskMaster CLI is available
if integration.IsAvailable() {
    integration.Start()
}
```

### Configuration Options

```go
type IntegrationConfig struct {
    EpicDir      string        // Epic directory path
    Command      string        // TaskMaster CLI command (default: "task-master")
    Timeout      time.Duration // CLI command timeout (default: 30s)
    SyncInterval time.Duration // Auto-sync interval (default: 5s)
    CacheTTL     time.Duration // Cache time-to-live (default: 10s)
}
```

## 📊 Data Models

### Task Structure

```go
type Task struct {
    ID           int           `json:"id"`
    Title        string        `json:"title"`
    Description  string        `json:"description"`
    Status       TaskStatus    `json:"status"`
    Priority     TaskPriority  `json:"priority"`
    Dependencies []int         `json:"dependencies"`
    Assignee     string        `json:"assignee"`
    CreatedAt    time.Time     `json:"created_at"`
    UpdatedAt    time.Time     `json:"updated_at"`
    DueDate      *time.Time    `json:"due_date,omitempty"`
    Tags         []string      `json:"tags"`
    Complexity   int           `json:"complexity"`
    Estimate     time.Duration `json:"estimate"`
}
```

#### Task Status Types

```go
type TaskStatus string

const (
    StatusPending    TaskStatus = "pending"
    StatusInProgress TaskStatus = "in_progress"
    StatusDone       TaskStatus = "done"
    StatusBlocked    TaskStatus = "blocked"
    StatusCancelled  TaskStatus = "cancelled"
)
```

#### Task Priority Levels

```go
type TaskPriority string

const (
    PriorityLow      TaskPriority = "low"
    PriorityMedium   TaskPriority = "medium"
    PriorityHigh     TaskPriority = "high"
    PriorityCritical TaskPriority = "critical"
)
```

### Agent Structure

```go
type Agent struct {
    ID           string       `json:"id"`
    Name         string       `json:"name"`
    Type         AgentType    `json:"type"`
    Status       AgentStatus  `json:"status"`
    Capabilities []string     `json:"capabilities"`
    CurrentTask  *int         `json:"current_task,omitempty"`
    Efficiency   float64      `json:"efficiency"`
    TasksCompleted int        `json:"tasks_completed"`
    TasksFailed    int        `json:"tasks_failed"`
    LastActive     time.Time  `json:"last_active"`
    Specialization string     `json:"specialization"`
}
```

#### Agent Status Types

```go
type AgentStatus string

const (
    AgentStatusIdle    AgentStatus = "idle"
    AgentStatusActive  AgentStatus = "active"
    AgentStatusBusy    AgentStatus = "busy"
    AgentStatusOffline AgentStatus = "offline"
    AgentStatusError   AgentStatus = "error"
)
```

## 🔄 Core API Methods

### Task Management

#### Get All Tasks
```go
func (i *Integration) GetTasks() ([]Task, error)
```
Returns all tasks from the current epic.

#### Get Tasks for Specific Epic
```go
func (i *Integration) GetTasksForEpic(epicName string) ([]Task, error)
```
Returns tasks for a specific epic directory.

#### Get Single Task
```go
func (i *Integration) GetTask(id int) (*Task, error)
```
Returns detailed information for a specific task.

#### Get Formatted Task List
```go
func (i *Integration) GetTasksFormatted() (string, error)
```
Returns a formatted string representation of all tasks, grouped by status.

### Agent Management

#### Get All Agents
```go
func (i *Integration) GetAgents() ([]Agent, error)
```
Returns all registered TaskMaster agents.

#### Get Agent Details
```go
func (i *Integration) GetAgent(id string) (*Agent, error)
```
Returns detailed information for a specific agent.

#### Get Formatted Agent List
```go
func (i *Integration) GetAgentsFormatted() (string, error)
```
Returns a formatted string representation of all agents with status and metrics.

### System Information

#### Health Check
```go
func (i *Integration) HealthCheck() HealthStatus
```
Returns the current health status of the TaskMaster integration.

#### System Status
```go
func (i *Integration) GetSystemStatus() SystemStatus
```
Returns comprehensive system status including CLI availability and sync status.

#### Statistics
```go
func (i *Integration) GetStatistics() Statistics
```
Returns performance and usage statistics.

## 📈 Real-time Updates

### Update Subscription

Subscribe to real-time TaskMaster updates:

```go
// Subscribe to updates
updateChan := make(chan Update, 100)
integration.Subscribe(updateChan)

// Handle updates
go func() {
    for update := range updateChan {
        switch update.Type {
        case UpdateTypeTaskCreated:
            // Handle new task
        case UpdateTypeTaskUpdated:
            // Handle task status change
        case UpdateTypeAgentStatusChanged:
            // Handle agent status change
        }
    }
}()
```

#### Update Types

```go
type UpdateType string

const (
    UpdateTypeTaskCreated        UpdateType = "task_created"
    UpdateTypeTaskUpdated        UpdateType = "task_updated"
    UpdateTypeTaskCompleted      UpdateType = "task_completed"
    UpdateTypeAgentStatusChanged UpdateType = "agent_status_changed"
    UpdateTypeSystemStatus       UpdateType = "system_status"
)
```

### Update Structure

```go
type Update struct {
    Type      UpdateType    `json:"type"`
    Timestamp time.Time     `json:"timestamp"`
    TaskID    *int          `json:"task_id,omitempty"`
    AgentID   *string       `json:"agent_id,omitempty"`
    Data      interface{}   `json:"data"`
}
```

## 🔧 Configuration & Setup

### Prerequisites

1. **TaskMaster CLI Installation**
   ```bash
   npm install -g @hyperdev/task-master
   # or
   brew install hyperdev-io/tap/task-master
   ```

2. **Epic Directory Structure**
   ```
   your-project/
   ├── agent/
   │   └── epics/
   │       ├── epic-1/
   │       │   ├── workflow-state.json
   │       │   └── tasks.json
   │       └── epic-2/
   │           ├── workflow-state.json
   │           └── tasks.json
   └── .taskmaster/
       ├── config.json
       └── tasks/
           └── tasks.json
   ```

### Environment Variables

```bash
# TaskMaster CLI path (optional)
export TASKMASTER_CLI_PATH="/usr/local/bin/task-master"

# Default epic directory (optional)
export TASKMASTER_EPIC_DIR="./agent/epics"

# Sync interval in seconds (optional)
export TASKMASTER_SYNC_INTERVAL="5"

# Cache TTL in seconds (optional)
export TASKMASTER_CACHE_TTL="10"
```

### Configuration File

Create `.hyperdash.json` in your project root:

```json
{
  "taskmaster": {
    "command": "task-master",
    "epicDir": "./agent/epics",
    "timeout": "30s",
    "syncInterval": "5s",
    "cacheTTL": "10s",
    "autoStart": true
  }
}
```

## 📊 Performance & Caching

### Caching Strategy

The integration implements intelligent caching to minimize CLI calls:

- **Cache TTL**: 10 seconds default (configurable)
- **Automatic Invalidation**: On explicit refresh or detected changes
- **Memory Efficient**: LRU cache with configurable size limits
- **Thread Safe**: Concurrent access protection

### Performance Metrics

Monitor integration performance through:

```go
type Statistics struct {
    CLICalls        int           `json:"cli_calls"`
    CacheHits       int           `json:"cache_hits"`
    CacheMisses     int           `json:"cache_misses"`
    AvgResponseTime time.Duration `json:"avg_response_time"`
    ErrorRate       float64       `json:"error_rate"`
    LastSync        time.Time     `json:"last_sync"`
}
```

## 🛠️ Error Handling

### Error Types

```go
type IntegrationError struct {
    Type    ErrorType `json:"type"`
    Message string    `json:"message"`
    Code    int       `json:"code"`
    Context string    `json:"context"`
}
```

#### Common Error Scenarios

1. **CLI Not Available**: TaskMaster CLI not installed or not in PATH
2. **Epic Directory Not Found**: Specified epic directory doesn't exist
3. **Permission Denied**: Insufficient permissions to read epic data
4. **Timeout**: CLI command execution timeout
5. **Invalid JSON**: Malformed TaskMaster output

### Error Recovery

The integration implements robust error recovery:

- **Graceful Degradation**: Falls back to cached data or static content
- **Automatic Retry**: Retries failed operations with exponential backoff
- **Circuit Breaker**: Prevents cascade failures during extended outages
- **Health Monitoring**: Continuous health checks with automatic recovery

## 🧪 Testing & Development

### Mock Integration

For testing without TaskMaster CLI:

```go
// Create mock integration
mockIntegration := NewMockIntegration()
mockIntegration.SetTasks([]Task{
    {ID: 1, Title: "Test Task", Status: StatusInProgress},
})
mockIntegration.SetAgents([]Agent{
    {ID: "agent-1", Name: "Test Agent", Status: AgentStatusActive},
})
```

### Integration Testing

```bash
# Run integration tests
go test ./internal/taskmaster -tags=integration

# Test with actual TaskMaster CLI
TASKMASTER_TEST_CLI=true go test ./internal/taskmaster
```

## 📝 CLI Command Reference

### Direct CLI Commands

HyperDash executes these TaskMaster CLI commands:

```bash
# Get all tasks (JSON format)
task-master list --format=json

# Get specific task
task-master show <task-id> --format=json

# Get all agents
task-master agents --format=json

# Get agent details
task-master agent show <agent-id> --format=json

# Get system status
task-master status --format=json

# Health check
task-master health --format=json
```

### Output Format

All CLI commands return structured JSON:

```json
{
  "success": true,
  "data": {
    "tasks": [...],
    "agents": [...],
    "status": {...}
  },
  "timestamp": "2025-01-16T12:00:00Z",
  "version": "1.0.0"
}
```

## 🔍 Troubleshooting

### Common Issues

1. **"TaskMaster CLI not available"**
   - Verify TaskMaster CLI installation
   - Check PATH environment variable
   - Test manual CLI execution

2. **"No tasks found"**
   - Verify epic directory exists
   - Check TaskMaster configuration
   - Confirm tasks.json file format

3. **"Sync timeout"**
   - Increase timeout configuration
   - Check system performance
   - Verify network connectivity

### Debug Mode

Enable debug logging:

```bash
export HYPERDASH_DEBUG=true
export TASKMASTER_DEBUG=true
```

### Health Diagnostics

Use built-in diagnostics:

```go
health := integration.HealthCheck()
fmt.Printf("Status: %s\n", health.Status)
fmt.Printf("Last Check: %s\n", health.LastCheck)
fmt.Printf("Errors: %v\n", health.Errors)
```

---

*For additional support, see the [main documentation](README.md) or [troubleshooting guide](USAGE.md#troubleshooting).*