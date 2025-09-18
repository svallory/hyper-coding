#!/bin/bash

# Quick Test Script for HyperDash
# Rapidly tests dashboard functionality without long delays

set -e

EPIC_NAME="quick-test"
EPIC_DIR="agent/epics/$EPIC_NAME"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}⚡ Quick HyperDash Test${NC}"
echo "This creates a rapid test scenario for immediate dashboard testing"
echo ""

# Clean up
rm -rf "$EPIC_DIR"
mkdir -p "$EPIC_DIR"

# Create initial state
cat > "$EPIC_DIR/workflow-state.json" << 'EOF'
{
  "epic_name": "quick-test",
  "current_step": 1,
  "completed_steps": [],
  "workflow_config": {
    "no_stop": false,
    "max_subagents": 3,
    "use_research": false
  },
  "tag_name": "test/quick-demo",
  "artifacts": {
    "original_doc": "quick-spec.md",
    "prd": "quick-prd.md"
  },
  "agents": {
    "required": ["task-executor"],
    "created": [],
    "available": ["task-executor"]
  },
  "execution": {
    "tasks_in_progress": [],
    "tasks_completed": [],
    "parallel_agents_active": 0,
    "last_task_completion": null
  },
  "timestamp": "2025-01-16T15:00:00Z",
  "last_updated": "2025-01-16T15:00:00Z",
  "status": "pending"
}
EOF

# Create initial log
echo "[2025-01-16T15:00:00Z] [info] Quick test epic initialized" > "$EPIC_DIR/workflow.log"

echo -e "${BLUE}📊 Dashboard test data created at: $EPIC_DIR${NC}"
echo -e "${YELLOW}🚀 Now run: cd apps/dash && ./dash${NC}"
echo ""

# Rapid state changes for testing
echo -e "${GREEN}⚡ Starting rapid state changes...${NC}"
echo "Watch the dashboard update in real-time!"

sleep 2

# Update 1: Start execution
cat > "$EPIC_DIR/workflow-state.json" << 'EOF'
{
  "epic_name": "quick-test",
  "current_step": 2,
  "completed_steps": [1],
  "workflow_config": {
    "no_stop": false,
    "max_subagents": 3,
    "use_research": false
  },
  "tag_name": "test/quick-demo",
  "artifacts": {
    "original_doc": "quick-spec.md",
    "prd": "quick-prd.md"
  },
  "agents": {
    "required": ["task-executor"],
    "created": ["task-executor"],
    "available": []
  },
  "execution": {
    "tasks_in_progress": ["task-1", "task-2"],
    "tasks_completed": [],
    "parallel_agents_active": 2,
    "last_task_completion": null
  },
  "timestamp": "2025-01-16T15:00:00Z",
  "last_updated": "2025-01-16T15:01:00Z",
  "status": "running"
}
EOF

echo "[2025-01-16T15:01:00Z] [agent] Deployed task-executor for task-1" >> "$EPIC_DIR/workflow.log"
echo "[2025-01-16T15:01:00Z] [agent] Deployed task-executor for task-2" >> "$EPIC_DIR/workflow.log"

sleep 3

# Update 2: Complete some tasks
cat > "$EPIC_DIR/workflow-state.json" << 'EOF'
{
  "epic_name": "quick-test",
  "current_step": 2,
  "completed_steps": [1],
  "workflow_config": {
    "no_stop": false,
    "max_subagents": 3,
    "use_research": false
  },
  "tag_name": "test/quick-demo",
  "artifacts": {
    "original_doc": "quick-spec.md",
    "prd": "quick-prd.md"
  },
  "agents": {
    "required": ["task-executor"],
    "created": ["task-executor"],
    "available": []
  },
  "execution": {
    "tasks_in_progress": ["task-3"],
    "tasks_completed": ["task-1", "task-2"],
    "parallel_agents_active": 1,
    "last_task_completion": "2025-01-16T15:02:30Z"
  },
  "timestamp": "2025-01-16T15:00:00Z",
  "last_updated": "2025-01-16T15:02:30Z",
  "status": "running"
}
EOF

echo "[2025-01-16T15:02:00Z] [success] Task-1 completed successfully" >> "$EPIC_DIR/workflow.log"
echo "[2025-01-16T15:02:30Z] [success] Task-2 completed successfully" >> "$EPIC_DIR/workflow.log"
echo "[2025-01-16T15:02:30Z] [agent] Starting task-3" >> "$EPIC_DIR/workflow.log"

sleep 2

# Update 3: Add some warnings
echo "[2025-01-16T15:03:00Z] [warning] Task-3 retry attempt 1/3" >> "$EPIC_DIR/workflow.log"

sleep 2

# Update 4: Complete everything
cat > "$EPIC_DIR/workflow-state.json" << 'EOF'
{
  "epic_name": "quick-test",
  "current_step": 3,
  "completed_steps": [1, 2],
  "workflow_config": {
    "no_stop": false,
    "max_subagents": 3,
    "use_research": false
  },
  "tag_name": "test/quick-demo",
  "artifacts": {
    "original_doc": "quick-spec.md",
    "prd": "quick-prd.md"
  },
  "agents": {
    "required": ["task-executor"],
    "created": ["task-executor"],
    "available": ["task-executor"]
  },
  "execution": {
    "tasks_in_progress": [],
    "tasks_completed": ["task-1", "task-2", "task-3"],
    "parallel_agents_active": 0,
    "last_task_completion": "2025-01-16T15:03:30Z"
  },
  "timestamp": "2025-01-16T15:00:00Z",
  "last_updated": "2025-01-16T15:03:30Z",
  "status": "completed"
}
EOF

echo "[2025-01-16T15:03:30Z] [success] Task-3 completed successfully" >> "$EPIC_DIR/workflow.log"
echo "[2025-01-16T15:03:30Z] [success] Epic workflow completed" >> "$EPIC_DIR/workflow.log"

echo ""
echo -e "${GREEN}✅ Quick test completed!${NC}"
echo -e "${BLUE}📊 Epic should now show as completed in the dashboard${NC}"