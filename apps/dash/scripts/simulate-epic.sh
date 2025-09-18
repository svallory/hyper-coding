#!/bin/bash

# Epic Workflow Simulator
# Creates realistic epic progression with multiple agents and tasks

set -e

EPIC_NAME="${1:-demo-user-auth}"
EPIC_DIR="agent/epics/$EPIC_NAME"
WORKFLOW_STATE="$EPIC_DIR/workflow-state.json"
WORKFLOW_LOG="$EPIC_DIR/workflow.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

log_message() {
    local level="$1"
    local message="$2"
    local timestamp=$(date -Iseconds)
    echo "[$timestamp] [$level] $message" >> "$WORKFLOW_LOG"
    
    # Also log to stdout with colors
    case $level in
        "info") echo -e "${BLUE}ℹ️  $message${NC}" ;;
        "success") echo -e "${GREEN}✅ $message${NC}" ;;
        "warning") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "error") echo -e "${RED}❌ $message${NC}" ;;
        "agent") echo -e "${PURPLE}🤖 $message${NC}" ;;
    esac
}

update_workflow_state() {
    local current_step="$1"
    local completed_steps="$2"
    local tasks_in_progress="$3"
    local tasks_completed="$4"
    local parallel_agents="$5"
    local status="$6"
    
    local timestamp=$(date -Iseconds)
    local last_completion=""
    if [ -n "$4" ] && [ "$4" != "[]" ]; then
        last_completion="\"$timestamp\""
    else
        last_completion="null"
    fi
    
    cat > "$WORKFLOW_STATE" << EOF
{
  "epic_name": "$EPIC_NAME",
  "current_step": $current_step,
  "completed_steps": $completed_steps,
  "workflow_config": {
    "no_stop": false,
    "max_subagents": 8,
    "use_research": true
  },
  "tag_name": "feature/$EPIC_NAME",
  "artifacts": {
    "original_doc": "user-auth-spec.md",
    "prd": "user-auth-prd.md",
    "tasks_file": "tasks.json",
    "complexity_report": "complexity-analysis.md"
  },
  "agents": {
    "required": ["api-architect", "react-expert", "typescript-expert", "dx-optimizer"],
    "created": ["api-architect", "react-expert"],
    "available": ["typescript-expert", "dx-optimizer"]
  },
  "execution": {
    "tasks_in_progress": $tasks_in_progress,
    "tasks_completed": $tasks_completed,
    "parallel_agents_active": $parallel_agents,
    "last_task_completion": $last_completion
  },
  "timestamp": "$timestamp",
  "last_updated": "$timestamp",
  "status": "$status"
}
EOF
}

simulate_step_delay() {
    local min_delay=${1:-2}
    local max_delay=${2:-5}
    local delay=$((RANDOM % (max_delay - min_delay + 1) + min_delay))
    echo "⏱️  Simulating work for ${delay}s..."
    sleep $delay
}

echo -e "${GREEN}🚀 Starting Epic Workflow Simulation: $EPIC_NAME${NC}"
echo "📁 Epic Directory: $EPIC_DIR"
echo "📊 Open the dashboard in another terminal: cd apps/dash && ./dash"
echo ""

# Create epic directory
mkdir -p "$EPIC_DIR"

# Step 1: Epic Creation and Planning
log_message "info" "Epic workflow started for $EPIC_NAME"
update_workflow_state 1 "[]" "[]" "[]" 0 "planning"
log_message "info" "Document analysis and validation in progress"
simulate_step_delay 3 5

log_message "success" "Document validation completed"
log_message "info" "Epic setup and folder creation"
update_workflow_state 1 "[]" "[\"setup-epic\"]" "[]" 1 "planning"
simulate_step_delay 2 3

# Step 2: Tag Creation and PRD Generation  
log_message "success" "Epic folder structure created"
log_message "info" "Creating feature branch: feature/$EPIC_NAME"
update_workflow_state 2 "[1]" "[\"create-branch\", \"generate-prd\"]" "[\"setup-epic\"]" 2 "planning"
simulate_step_delay 3 4

log_message "success" "Feature branch created successfully"
log_message "info" "PRD generation in progress"
log_message "agent" "Deployed api-architect agent for API design"
simulate_step_delay 4 6

# Step 3: Agent Analysis and Task Generation
log_message "success" "PRD generation completed"
update_workflow_state 3 "[1, 2]" "[\"analyze-requirements\", \"create-agents\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\"]" 2 "planning"
log_message "info" "Analyzing requirements and creating specialized agents"
log_message "agent" "Deployed react-expert agent for component architecture"
simulate_step_delay 3 5

log_message "success" "Agent analysis completed"
log_message "info" "Parsing PRD to generate implementation tasks"
update_workflow_state 4 "[1, 2, 3]" "[\"parse-prd\", \"complexity-analysis\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\"]" 3 "planning"
log_message "agent" "Deployed typescript-expert agent for type safety analysis"
simulate_step_delay 4 6

# Step 4: Task Execution Phase
log_message "success" "PRD parsed successfully - 12 tasks generated"
log_message "success" "Complexity analysis completed"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-1.1\", \"task-2.1\", \"task-3.1\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\"]" 3 "executing"
log_message "info" "Starting task execution phase with 3 parallel agents"
log_message "agent" "Starting task 1.1: Database schema design"
log_message "agent" "Starting task 2.1: Authentication API endpoints"
log_message "agent" "Starting task 3.1: User registration component"
simulate_step_delay 5 8

# Task completions with realistic progression
log_message "success" "Task 1.1 completed: Database schema implemented"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-2.1\", \"task-3.1\", \"task-1.2\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\"]" 3 "executing"
log_message "agent" "Starting task 1.2: User model validation"
simulate_step_delay 3 5

log_message "success" "Task 2.1 completed: Auth endpoints implemented"
log_message "warning" "Task 3.1 needs retry - component test failures"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-3.1\", \"task-1.2\", \"task-2.2\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\"]" 3 "executing"
log_message "agent" "Starting task 2.2: JWT token validation"
simulate_step_delay 4 6

log_message "success" "Task 1.2 completed: User validation rules added"
log_message "success" "Task 3.1 completed: Registration component (retry successful)"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-2.2\", \"task-3.2\", \"task-4.1\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\", \"task-1.2\", \"task-3.1\"]" 4 "executing"
log_message "agent" "Deployed dx-optimizer agent for developer experience improvements"
log_message "agent" "Starting task 3.2: Login component"
log_message "agent" "Starting task 4.1: Form validation utilities"
simulate_step_delay 4 7

# Continue with more task completions
log_message "success" "Task 2.2 completed: JWT validation implemented"
log_message "success" "Task 3.2 completed: Login component ready"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-4.1\", \"task-4.2\", \"task-5.1\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\", \"task-1.2\", \"task-3.1\", \"task-2.2\", \"task-3.2\"]" 3 "executing"
log_message "agent" "Starting task 4.2: Error handling components"
log_message "agent" "Starting task 5.1: Integration tests"
simulate_step_delay 5 8

# Error scenario
log_message "error" "Task 5.1 failed: Database connection timeout"
log_message "warning" "Retrying task 5.1 with connection pool optimization"
update_workflow_state 5 "[1, 2, 3, 4]" "[\"task-4.1\", \"task-4.2\", \"task-5.1-retry\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\", \"task-1.2\", \"task-3.1\", \"task-2.2\", \"task-3.2\"]" 3 "executing"
simulate_step_delay 3 5

log_message "success" "Task 4.1 completed: Form validation utilities"
log_message "success" "Task 4.2 completed: Error handling components"
log_message "success" "Task 5.1 completed: Integration tests (retry successful)"
update_workflow_state 6 "[1, 2, 3, 4, 5]" "[\"task-6.1\", \"task-6.2\"]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\", \"task-1.2\", \"task-3.1\", \"task-2.2\", \"task-3.2\", \"task-4.1\", \"task-4.2\", \"task-5.1\"]" 2 "executing"
log_message "agent" "Starting task 6.1: E2E testing"
log_message "agent" "Starting task 6.2: Documentation generation"
simulate_step_delay 6 10

# Final completion
log_message "success" "Task 6.1 completed: E2E tests passing"
log_message "success" "Task 6.2 completed: API documentation generated"
update_workflow_state 7 "[1, 2, 3, 4, 5, 6]" "[]" "[\"setup-epic\", \"create-branch\", \"generate-prd\", \"analyze-requirements\", \"create-agents\", \"parse-prd\", \"complexity-analysis\", \"task-1.1\", \"task-2.1\", \"task-1.2\", \"task-3.1\", \"task-2.2\", \"task-3.2\", \"task-4.1\", \"task-4.2\", \"task-5.1\", \"task-6.1\", \"task-6.2\"]" 0 "completed"
log_message "success" "Epic workflow completed successfully"
log_message "info" "Final verification and cleanup"

echo ""
echo -e "${GREEN}🎉 Epic simulation completed!${NC}"
echo -e "${BLUE}📊 Total tasks completed: 18${NC}"
echo -e "${PURPLE}🤖 Agents deployed: 4${NC}"
echo -e "${YELLOW}⚠️  Warnings encountered: 2${NC}"
echo -e "${RED}❌ Errors recovered: 1${NC}"
echo ""
echo -e "${GREEN}✨ The dashboard should now show the completed epic workflow!${NC}"