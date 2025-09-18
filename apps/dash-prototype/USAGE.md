# Epic Dashboard Usage Guide

## Quick Start

### First Time Setup

```bash
cd agent/dashboard
bun install
bun run build
```

### Running the Dashboard

#### Option 1: Using the Executable

```bash
./agent/dashboard/epic-dashboard agent/epics/your-epic-name
```

#### Option 2: Development Mode

```bash
cd agent/dashboard
bun run dev ../epics/your-epic-name
```

## Typical Workflow

1. **Start an Epic** (in Terminal 1):

```bash
# Execute the epic command
/project:tm/plan-to-tasks requirements.txt
```

2. **Monitor Progress** (in Terminal 2):

```bash
# Wait for epic folder to be created, then:
./agent/dashboard/epic-dashboard agent/epics/[generated-epic-name]
```

## Dashboard Sections Explained

```
╔═══════════════════════════════════════════════════════╗
║                    USER-AUTH-SYSTEM                   ║  ← Epic name
╠═══════════════════════════════════════════════════════╣
║ Progress: [████████░░░░░░░░░░░░] 40%                 ║  ← Overall progress
║ Step 4 of 10                                          ║  ← Current step
╠═══════════════════════════════════════════════════════╣
║ Workflow Steps:                                       ║
║ ✅ Document Validation                                ║  ← Completed
║ ✅ Epic Analysis & Setup                              ║  ← Completed
║ ✅ Tag Creation & Switching                           ║  ← Completed
║ ⏳ PRD Generation                                     ║  ← In Progress
║ ⭕ Agent Analysis & Creation                          ║  ← Pending
║ ⭕ Research Decision                                  ║  ← Pending
║ ⭕ Parse PRD to Tasks                                 ║  ← Pending
║ ⭕ Complexity Analysis                                ║  ← Pending
║ ⭕ Multi-Agent Review                                 ║  ← Pending
║ ⭕ Final Verification                                 ║  ← Pending
╠═══════════════════════════════════════════════════════╣
║ Configuration:          │ Agents:                     ║
║ Research: ✓ Enabled     │ Required: 5                 ║
║ No Stop: ✗ Disabled     │ Available: 3                ║
║ Max Agents: 9           │ Created: 2                  ║
╠═══════════════════════════════════════════════════════╣
║ Recent Activity:                                      ║
║ [14:23:15] Starting PRD generation...                 ║
║ [14:23:16] Analyzing document structure               ║
║ [14:23:18] Enriching with technical details           ║
╚═══════════════════════════════════════════════════════╝
```

## Status Indicators

- ✅ **Green Checkmark**: Step completed successfully
- ⏳ **Hourglass**: Step currently in progress
- ⭕ **Circle**: Step pending/not started yet
- 🔴 **Red Circle**: Step failed (if errors occur)

## Log Color Coding

- **White**: Informational messages
- **Green**: Success messages
- **Yellow**: Warning messages
- **Red**: Error messages

## Controls

- **q**: Quit the dashboard
- **Ctrl+C**: Force quit

## Common Scenarios

### Scenario 1: Agent Creation Required

```
⚠️ Workflow paused for agent creation
→ Dashboard shows: Step 5 - Agent Analysis & Creation (paused)
→ Action: Restart Claude Code, then run continuation command
```

### Scenario 2: Parse PRD Retry

```
Dashboard shows multiple "Parse PRD failed - retrying..." messages
→ The workflow automatically retries up to 3 times
→ No action needed unless all retries fail
```

### Scenario 3: Completed Epic

```
Progress: [████████████████████] 100%
All steps show ✅
→ Epic is complete, review artifacts in epic folder
```

## Troubleshooting

### Dashboard Shows "Workflow state not found"

- Epic folder hasn't been created yet
- Wrong path provided
- Solution: Wait for epic to start, verify path

### Dashboard Not Updating

- Check if workflow is still running
- Verify `workflow-state.json` exists
- Try restarting dashboard

### Can't Run Executable

```bash
chmod +x agent/dashboard/epic-dashboard
```

### Building for Different Platforms

```bash
cd agent/dashboard

# Linux
bun run build:linux

# macOS
bun run build:mac

# Windows
bun run build:windows
```

## Tips

1. **Keep Dashboard Open**: Even after completion for review
2. **Multiple Epics**: Run multiple dashboards for parallel epics
3. **Dev Mode**: Use `bun run dev` for debugging
4. **Log History**: Full logs saved in `workflow.log`
5. **State Recovery**: Dashboard reconnects if workflow restarts
