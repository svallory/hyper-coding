# Execute Epic Tasks

Execute Task Master tasks from a completed epic to implement the planned features.

## Usage

```bash
/epic:execute <EPIC_FOLDER> [TASK_ID|MODE] [MAX_SUBAGENTS] [NO_STOP=true]
```

**Arguments:**

- `EPIC_FOLDER` (required): Path to epic folder (e.g., `agent/epics/diagram-refactoring`)
- `TASK_ID|MODE` (optional): Task ID number, "next", "all" (default), or "interactive"
- `MAX_SUBAGENTS` (optional): Maximum parallel agents (default: 9)
- `NO_STOP` (optional): Continue execution without stopping (default: true)

## 🚨 PARAMOUNT: PARALLEL EXECUTION MANDATE 🚨

**THIS IS ABSOLUTELY CRITICAL AND MUST BE FOLLOWED AT ALL TIMES:**

1. **ALWAYS run as many parallel agents as task dependencies allow**
2. **NEVER run tasks sequentially when they can be parallelized**
3. **Monitor dependency graph continuously to launch new agents as tasks complete**
4. **Respect MAX_SUBAGENTS limit but push to that limit whenever possible**
5. **Parallel execution is NOT optional - it is MANDATORY for performance**

The system MUST maximize parallel agent deployment up to MAX_SUBAGENTS (default: 9) at all times when dependencies allow.

## Examples

```bash
# Execute all pending tasks (default)
/epic:execute agent/epics/diagram-refactoring

# Execute next available task
/epic:execute agent/epics/diagram-refactoring next

# Execute specific task
/epic:execute agent/epics/diagram-refactoring 3

# Interactive task selection  
/epic:execute agent/epics/diagram-refactoring interactive
```

## Progress Tracking

This command follows the standard epic progress tracking system defined in `.claude/epic/progress-tracking.md`.

**Execution Workflow Steps:**

1. Load Epic Configuration
2. Validate Task Dependencies  
3. Execute Tasks in Parallel
4. Monitor Agent Progress
5. Handle Task Completions
6. Deploy New Agents for Available Tasks
7. Validate Task Results
8. Update Task Status
9. Generate Execution Report

## Implementation

### Step 1: Load Epic Configuration

**Load epic state and switch to Task Master tag:**

1. Read `workflow-state.json` from epic folder
2. Extract epic name and tag name
3. Initialize execution tracking in workflow state
4. Switch to the epic's Task Master tag using `task-master use-tag`
5. Verify tasks exist in the tag
6. Update progress: Step 1 → Step 2

```bash
# Update state for execution start
jq --arg timestamp "$(date -Iseconds)" '
  .current_step = 1 |
  .execution.parallel_agents_active = 0 |
  .execution.tasks_in_progress = [] |
  .last_updated = $timestamp' \
  agent/epics/[EPIC-NAME]/workflow-state.json > tmp.json && \
  mv tmp.json agent/epics/[EPIC-NAME]/workflow-state.json

echo "[$(date -Iseconds)] [info] Starting task execution for $EPIC_NAME" >> agent/epics/[EPIC-NAME]/workflow.log
```

### Step 2: Execute Tasks

**Execute tasks based on mode parameter:**

**Mode "all" (default):**

- **PARAMOUNT**: Analyze dependency graph to identify available tasks for parallel execution
- Launch maximum possible parallel agents (up to MAX_SUBAGENTS) for available tasks
- **CRITICAL**: Update workflow state for each agent deployment and completion
- Continuously monitor task completions to deploy new agents as dependencies are satisfied
- Execute task implementation using appropriate specialized agents IN PARALLEL
- Update task status to "in-progress", then "done" with state tracking
- Maintain maximum parallel deployment until no more tasks available

```bash
# Track agent deployment for each task
for TASK_ID in $AVAILABLE_TASKS; do
  # Update state: deploy agent
  jq --arg task_id "$TASK_ID" --arg timestamp "$(date -Iseconds)" '
    .execution.tasks_in_progress += [$task_id] |
    .execution.parallel_agents_active += 1 |
    .current_step = 4 |
    .last_updated = $timestamp' \
    agent/epics/[EPIC-NAME]/workflow-state.json > tmp.json && \
    mv tmp.json agent/epics/[EPIC-NAME]/workflow-state.json
  
  echo "[$(date -Iseconds)] [agent] Deployed task-executor for task $TASK_ID" >> agent/epics/[EPIC-NAME]/workflow.log
done

# Track task completion
function complete_task() {
  local TASK_ID=$1
  jq --arg task_id "$TASK_ID" --arg timestamp "$(date -Iseconds)" '
    .execution.tasks_in_progress -= [$task_id] |
    .execution.tasks_completed += [$task_id] |
    .execution.parallel_agents_active -= 1 |
    .execution.last_task_completion = $timestamp |
    .last_updated = $timestamp' \
    agent/epics/[EPIC-NAME]/workflow-state.json > tmp.json && \
    mv tmp.json agent/epics/[EPIC-NAME]/workflow-state.json
  
  echo "[$(date -Iseconds)] [success] Task $TASK_ID completed" >> agent/epics/[EPIC-NAME]/workflow.log
}
```

**Mode "next":**

- Get and execute single next available task
- Update task status appropriately

**Mode "3" (specific task ID):**

- Get task details using `task-master get-task --id=3`
- Execute that specific task
- Update task status

**Mode "interactive":**

- Show pending tasks using `task-master get-tasks --status=pending`
- Prompt user to select task ID
- Execute selected task

### Step 3: Report Results

**Show execution summary with progress tracking:**

- Update workflow state to completion
- Display total tasks completed
- Show any remaining pending tasks
- Generate final execution report
- Archive workflow state
- Provide next steps guidance

```bash
# Mark execution complete
jq --arg timestamp "$(date -Iseconds)" '
  .current_step = 9 |
  .completed_steps += [8] |
  .status = "execution_completed" |
  .completed_at = $timestamp |
  .last_updated = $timestamp' \
  agent/epics/[EPIC-NAME]/workflow-state.json > tmp.json && \
  mv tmp.json agent/epics/[EPIC-NAME]/workflow-state.json

echo "[$(date -Iseconds)] [success] Epic execution completed successfully" >> agent/epics/[EPIC-NAME]/workflow.log

# Archive completion state
cp agent/epics/[EPIC-NAME]/workflow-state.json agent/epics/[EPIC-NAME]/workflow-state.execution-completed.json
```

## Task Execution Process

For each task to be implemented:

1. **Analyze Task**: Read task title, description, acceptance criteria
2. **Select Agent**: Determine appropriate specialized agent based on task requirements
3. **Execute Implementation**: Call the selected agent with task context
4. **Validate Results**: Verify implementation meets acceptance criteria
5. **Update Status**: Mark task as completed in Task Master
6. **Create Commit**: Commit changes with conventional commit message

## Dashboard Monitoring

**Real-time progress monitoring:**

Users can monitor execution progress in real-time using the epic dashboard:

```bash
# In separate terminal (optional)
./agent/dashboard/epic-dashboard agent/epics/diagram-refactoring
```

The dashboard displays:

- Current execution step and progress
- Active parallel agents and their tasks
- Task completion timeline
- Real-time log stream
- Agent deployment/completion events

Progress tracking follows the standard defined in `.claude/epic/progress-tracking.md`.

## Error Handling

- **Epic not found**: Show available epics and exit
- **No tasks**: Warn if epic has no pending tasks
- **Task execution fails**: Mark task as failed, continue with others
- **Invalid task ID**: Show error and available task IDs

## Integration Points

- **Task Master**: Uses Task Master API for all task management
- **Specialized Agents**: Calls appropriate agents for implementation
- **Git**: Creates commits for completed tasks
- **Testing**: Runs validation after each task (if configured)

This command focuses purely on task execution and does not manage external tools like dashboards or build systems.
