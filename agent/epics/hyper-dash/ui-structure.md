# HyperDash UI Structure Design

## Global Header Layout




```
                                 🭇🭉🭋 HYPER DASH 🭀🬾🬼
╔════════════════════════════════════════════════════════════════════════════════════════╗
║  Epic: user-onboarding-redesign                                 ⏳︎ Step 3/10            ║
║  Status: IN PROGRESS                                            ⏺︎ Research Mode On     ║
║  [Switch Epic]                                                  Updated: 2m ago        ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

### Header Components:
- **Product Branding**: "HyperDash" with gradient styling (no emoji)
- **Epic Info Panel**: Current epic name, status, and progress indicator
- **Configuration Panel**: Current step, mode indicators, last update time
- **Epic Switcher**: Button/shortcut to change epic context
- **Global Status**: Real-time status indicators

---

## Tab Navigation Bar

```
┌─[Overview]─┬─[Tasks]─┬─[Agents]─┬─[Docs]─┬─[Logs]─┬─[Help]─┐
```

### Tab Design Features:
- **Active Tab**: Bold border with accent color
- **Inactive Tabs**: Subtle borders with muted colors
- **Keyboard Shortcuts**: Numbers 1-6 for direct access
- **Responsive**: Tabs shrink/expand based on terminal width

---

## Tab 1: Overview

```
╔════════════════════════════════════════════════════════════════════════════════════════╗
║                                    OVERVIEW                                            ║
╠════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                        ║
║  ┌─ Workflow Progress ──────────────────────────────────────────────────────────────┐  ║
║  │  ✔︎ Document Validation           ⏳︎ Agent Analysis & Creation                     │  ║
║  │  ✔︎ Epic Analysis & Setup         ○ Research Decision                             │  ║
║  │  ✔︎ Tag Creation & Switching      ○ Parse PRD to Tasks                            │  ║
║  │  ✔︎ PRD Generation                ○ Complexity Analysis                           │  ║
║  │                                  ○ Multi-Agent Review                            │  ║
║  │                                                                                  │  ║
║  │  Progress: [████████░░░░░░░░░░] 40%                                              │  ║
║  └──────────────────────────────────────────────────────────────────────────────────┘  ║
║                                                                                        ║
║  ┌─ Configuration ─────────┐    ┌─ Agent Status ──────────┐    ┌─ Artifacts ────────┐  ║
║  │  ⏺︎ Research: ON         │    │  Required:   8          │    │  ▤ PRD: ✔︎          │  ║
║  │  ◌ No-Stop:  OFF        │    │  Available:  6          │    │  ▤ Tasks: ✔︎        │  ║
║  │  # Max Agents: 9        │    │  Created:    4          │    │  ▤ Report: ✔︎       │  ║
║  │  ≣ Mode: Interactive    │    │  Active:     2          │    │  ▤ Logs: ✔︎         │  ║
║  └─────────────────────────┘    └─────────────────────────┘    └────────────────────┘  ║
║                                                                                        ║
║  ┌─ Recent Activity ────────────────────────────────────────────────────────────────┐  ║
║  │  [15:42] ✔︎ PRD generation completed successfully                                 │  ║
║  │  [15:41] ▤ Generated complexity report for 12 tasks                              │  ║
║  │  [15:40] ⪢ Created api-architect agent for endpoint design                       │  ║
║  │  [15:39] ✔︎ Research phase completed, 15 references found                         │  ║
║  │  [15:38] ◒ Tag 'user-onboarding-v2' created and switched                         │  ║
║  └──────────────────────────────────────────────────────────────────────────────────┘  ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

### Overview Panel Components:
1. **Workflow Progress Panel**: 
   - Visual step progression with status icons
   - Progress bar with percentage
   - Current step highlighting
   - Uses Stickers FlexBox for responsive layout

2. **Configuration Cards** (3-column layout):
   - Epic Configuration: Research mode, no-stop, agent limits
   - Agent Status: Required/available/created/active counts
   - Artifacts: File status indicators for PRD, tasks, reports

3. **Recent Activity Stream**:
   - Timestamped activity log
   - Color-coded by activity type
   - Real-time updates
   - Scrollable with latest at top

---

## Tab 2: Tasks

```
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║                                     TASKS                                                ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║  ┌─ TaskMaster Integration ───────────────────────────────────────────────────────────┐  ║
║  │  Status: ✔︎ Connected    │    Next Task: #1.2.3      │    Progress: 23/45 (51%)     │  ║
║  └────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                                                                          ║
║  ┌─ Task List ────────────┬─ Selected Task Details ───────────────────────────────────┐  ║
║  │  ID     │ Status │ Pri │  Task: 1.2.3 - Implement user registration API            │  ║
║  │ ─────── │ ────── │ ─── │  ──────────────────────────────────────────────────────── │  ║
║  │ ► 1.2.3 │    ⏳︎   │ Hi  │  Description:                                             │  ║
║  │   1.2.4 │    ○   │ Me  │  Create REST API endpoints for user registration          │  ║
║  │   1.2.5 │    ○   │ Me  │  including validation, hashing, and JWT token             │  ║
║  │   1.3.1 │    ○   │ Lo  │  generation. Integrate with existing auth system.         │  ║
║  │   1.3.2 │    ○   │ Lo  │                                                           │  ║
║  │   2.1.1 │    ○   │ Hi  │  Dependencies: 1.2.1, 1.2.2                               │  ║
║  │   2.1.2 │    ○   │ Me  │  Assigned: api-architect                                  │  ║
║  │   2.2.1 │    ○   │ Me  │  Complexity: Medium (3-5 days)                            │  ║
║  │   2.2.2 │    ○   │ Lo  │  Status: In Progress                                      │  ║
║  │                        │                                                           │  ║
║  │  Filter: [All]         │  Subtasks:                                                │  ║
║  │  Sort: [Priority]      │  ├─ 1.2.3.1 ✔︎ API route definitions                       │  ║
║  │                        │  ├─ 1.2.3.2 ⏳︎ Input validation middleware                 │  ║
║  │                        │  ├─ 1.2.3.3 ○ Password hashing implementation             │  ║
║  │                        │  └─ 1.2.3.4 ○ JWT token generation                        │  ║
║  └────────────────────────┴───────────────────────────────────────────────────────────┘  ║
║                                                                                          ║
║  ┌─ Quick Actions ────────────────────────────────────────────────────────────────────┐  ║
║  │  [Enter] View Details  │  [Space] Toggle Status  │  [n] Next Task  │  [r] Refresh  │  ║
║  └────────────────────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

### Tasks Panel Components:
1. **TaskMaster Status Bar**:
   - Connection status to TaskMaster CLI
   - Next task indicator
   - Overall progress statistics

2. **Split Layout** (Stickers FlexBox):
   - **Left Panel**: Task list table with ID, status, priority
   - **Right Panel**: Detailed view of selected task
   - Resizable split with keyboard navigation

3. **Task Table Features**:
   - Sortable columns (ID, Status, Priority)
   - Filter options (All, Pending, In Progress, Done)
   - Color-coded status indicators
   - Keyboard selection and navigation

4. **Task Detail Panel**:
   - Full task description
   - Dependencies and assignments
   - Complexity estimation
   - Subtask breakdown
   - Real-time status updates

---

## Tab 3: Agents

```
╔════════════════════════════════════════════════════════════════════════════════════════╗
║                                    AGENTS                                              ║
╠════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                        ║
║  ┌─ Agent Overview ─────────────────────────────────────────────────────────────────┐  ║
║  │  Total: 8    │  Required: 6    │  Available: 8    │  Active: 3    │  Idle: 5     │  ║
║  └──────────────────────────────────────────────────────────────────────────────────┘  ║
║                                                                                        ║
║  ┌─ Active Agents ───────────────────┬─ Agent Details ──────────────────────────────┐  ║
║  │  Agent               │ Status     │  Agent: api-architect                        │  ║
║  │ ──────────────────── │ ────────── │  ─────────────────────────────────────────── │  ║
║  │ ► api-architect      │ ● Active   │  Type: Specialized Agent                     │  ║
║  │   ux-design-spec     │ ◒ Busy     │  Purpose: API design and architecture        │  ║
║  │   react-expert       │ ⨯ Error    │  Status: Active (Working on task 1.2.3)      │  ║
║  │   dx-optimizer       │ ○ Idle     │                                              │  ║
║  │   docs-architect     │ ○ Idle     │  ── Capabilities: ────────────────────────── │  ║
║  │   typescript-expert  │ ○ Idle     │  • REST API design                           │  ║
║  │   root-cause-debug   │ ○ Idle     │  • Authentication systems                    │  ║
║  │   llm-systems-eng    │ ○ Idle     │  • Database integration                      │  ║
║  │                      │            │  • Performance optimization                  │  ║
║  │  [Create New Agent]  │            │                                              │  ║
║  │                      │            │                                              │  ║
║  │                      │            │  ── Current Task: ────────────────────────── │  ║
║  │                      │            │  Implement user registration API endpoints   │  ║
║  │                      │            │                                              │  ║
║  │                      │            │  ── Recent Activity: ─────────────────────── │  ║
║  │                      │            │  [15:42] Started task 1.2.3                  │  ║
║  │                      │            │  [15:30] Completed task 1.2.1                │  ║
║  │                      │            │  [15:15] Created API design document         │  ║
║  └──────────────────────┴───────────────────────────────────────────────────────────┘  ║
║                                                                                        ║
║  ┌─ Agent Performance ──────────────────────────────────────────────────────────────┐  ║
║  │  Task Completion Rate: ████████░░ 80%    │    Average Task Time: 2.3 hours       │  ║
║  │  Success Rate: ██████████ 95%            │    Queue Length: 3 pending            │  ║
║  └──────────────────────────────────────────────────────────────────────────────────┘  ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

### Agents Panel Components:
1. **Agent Overview Bar**:
   - Total agent count and status breakdown
   - Quick statistics with color-coded indicators
   - Real-time status updates

2. **Split Layout** (Stickers FlexBox):
   - **Left Panel**: Agent list with status indicators
   - **Right Panel**: Detailed view of selected agent
   - Create new agent button/option

3. **Agent List Features**:
   - Status indicators (Active, Busy, Error, Idle)
   - Agent type classification
   - Sortable by status, name, or activity
   - Color-coded status indicators

4. **Agent Detail Panel**:
   - Agent type and specialization
   - Current task assignment
   - Capability breakdown
   - Recent activity log
   - Performance metrics

---

## Tab 4: Docs

```
╔════════════════════════════════════════════════════════════════════════════════════════╗
║                                     DOCS                                               ║
╠════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                        ║
║  ┌─ Document Browser ─────────┬─ Document Viewer ──────────────────────────────────┐   ║
║  │  Plan                      │  # User Onboarding Redesign PRD                    │   ║
║  │  ────────────────────────  │  ════════════════════════════════════════════════  │   ║
║  │  ▤ epic-manifest.md        │                                                    │   ║
║  │  ▶︎ prd.md                  │  ## Executive Summary                              │   ║
║  │  ▤ complexity-report.md    │                                                    │   ║
║  │  ▤ task-breakdown.md       │  This epic focuses on redesigning the user         │   ║
║  │  ▤ architecture.md         │  onboarding experience to improve conversion       │   ║
║  │                            │  rates and reduce time-to-value for new users.     │   ║
║  │  Tasks                     │                                                    │   ║
║  │  ────────────────────────  │  **Problem**: Current onboarding has 40% drop-off  │   ║
║  │  ▤ task-1.2.md             │  rate and takes average 15 minutes to complete.    │   ║
║  │  ▤ task-1.3.md             │                                                    │   ║
║  │  ▤ task-2.1.md             │  **Solution**: Streamlined 3-step onboarding       │   ║
║  │                            │  with progressive disclosure and smart defaults.   │   ║
║  │  Agent Reports             │                                                    │   ║
║  │  ────────────────────────  │  **Value**: Reduce onboarding time to <5 mins      │   ║
║  │  ▤ api-arch-analysis.md    │  and increase conversion rate to >80%.             │   ║
║  │  ▤ ux-design-spec.md       │                                                    │   ║
║  │  ▤ performance-review.md   │  ## Requirements Analysis                          │   ║
║  │                            │                                                    │   ║
║  │  [Search Documents]        │  ### Functional Requirements                       │   ║
║  │  [Filter by Type]          │  1. **Simplified Registration**                    │   ║
║  │                            │     - Single-step email verification               │   ║
║  └────────────────────────────┴────────────────────────────────────────────────────┘   ║
║                                                                                        ║
║  ┌─ Navigation ────────────────────────────────────────────────────────────────────┐   ║
║  │  [↑/↓] Navigate │ [Enter] Open │ [/] Search │ [Tab] Switch Panel │ [?] Help     │   ║
║  └─────────────────────────────────────────────────────────────────────────────────┘   ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

### Docs Panel Components:
1. **Document Browser** (Left Panel):
   - Hierarchical folder structure
   - Epic documents (PRD, manifest, reports)
   - Task-specific documentation
   - Agent-generated reports
   - Search and filter capabilities

2. **Document Viewer** (Right Panel):
   - Glamour-powered markdown rendering
   - Syntax highlighting for code blocks
   - Viewport with scrolling support
   - Search within document
   - Auto-refresh on file changes

3. **Navigation Features**:
   - Keyboard navigation between panels
   - Document type filtering
   - Full-text search across documents
   - Recent documents history

---

## Tab 5: Logs

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║                                     LOGS                                                ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                         ║
║  ┌─ Log Controls ───────────────────────────────────────────────────────────────────┐   ║
║  │  Filter: [All Levels] │ Source: [All Sources] │ [⏺︎ Auto-refresh] │ [↗ Export]    │   ║
║  └──────────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                         ║
║  ┌─ Live Log Stream ────────────────────────────────────────────────────────────────┐   ║
║  │  Time     │ Level │ Source        │ Message                                      │   ║
║  │ ───────── │ ───── │ ───────────── │ ──────────────────────────────────────────── │   ║
║  │  15:42:33 │ INFO  │ workflow      │ PRD generation completed successfully        │   ║
║  │  15:42:31 │ INFO  │ api-architect │ Created endpoint specification document      │   ║
║  │  15:42:28 │ TRACE │ research      │ Found 15 relevant references for patterns    │   ║
║  │  15:42:25 │ DEBUG │ git           │ Tag 'user-onboarding-v2' created             │   ║
║  │  15:42:22 │ INFO  │ agent-mgr     │ api-architect agent activated                │   ║
║  │  15:42:18 │ INFO  │ complexity    │ Generated complexity report for 12 tasks     │   ║
║  │  15:42:15 │ INFO  │ config        │ Research mode enabled for epic               │   ║
║  │  15:42:12 │ TRACE │ workflow      │ Starting step 4: Agent Analysis              │   ║
║  │  15:42:10 │ DEBUG │ validation    │ Epic manifest validation passed              │   ║
║  │  15:42:08 │ DEBUG │ parser        │ Parsed PRD document structure                │   ║
║  │  15:42:05 │ INFO  │ workflow      │ Epic workflow initiated                      │   ║
║  │           │       │               │                                              │   ║
║  │           │       │               │                                              │   ║
║  │           │       │               │                                              │   ║
║  │           │       │               │                                              │   ║
║  │           │       │               │ ── Live updates ──                           │   ║
║  └──────────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                         ║
║  ┌─ Log Statistics ─────────────────────────────────────────────────────────────────┐   ║
║  │  Total: 1,247    │    Errors: 3    │    Warnings: 12    │    Rate: 2.3/sec       │   ║
║  └──────────────────────────────────────────────────────────────────────────────────┘   ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
```

### Logs Panel Components:
1. **Log Controls Bar**:
   - Level filtering (All, Info, Warning, Error, Success)
   - Source filtering (Workflow, Agents, Research, etc.)
   - Auto-refresh toggle
   - Export functionality

2. **Live Log Stream**:
   - Real-time log display with timestamps
   - Color-coded log levels with emoji indicators
   - Source identification
   - Message content with wrapping
   - Auto-scroll to latest entries

3. **Log Statistics**:
   - Total log count
   - Error/warning counts
   - Current logging rate
   - Quick statistics overview

---

## Tab 6: Help

```
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║                                     HELP                                                 ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║  ┌─ Quick Reference ─────────────────────────────────────────────────────────────────┐   ║
║  │                                                                                   │   ║
║  │  ♦ HyperDash Quick Start                                                          │   ║
║  │  ═══════════════════════════════════════════════════════════════════════════════  │   ║
║  │                                                                                   │   ║
║  │  Global Navigation:                    Current Tab (Overview):                    │   ║
║  │  ──────────────────                    ─────────────────────                      │   ║
║  │  [q]        Quit HyperDash             [r]        Refresh data                    │   ║
║  │  [?]        Toggle this help           [e]        Switch epic                     │   ║
║  │  [1-6]      Switch to tab              [↑/↓]      Navigate items                  │   ║
║  │  [Tab]      Next tab                   [Enter]    Select item                     │   ║
║  │  [Shift+Tab] Previous tab              [Space]    Toggle/Action                   │   ║
║  │                                                                                   │   ║
║  │  Vi-Mode Navigation:                   Epic Management:                           │   ║
║  │  ───────────────────                   ─────────────────                          │   ║
║  │  [v]        Toggle Vi-mode             [e]        Open epic selector              │   ║
║  │  [h/j/k/l]  Navigate (Vi-style)        [n]        Next epic in list               │   ║
║  │  [gg]       Go to top                  [p]        Previous epic                   │   ║
║  │  [G]        Go to bottom               [/]        Search epics                    │   ║
║  │                                                                                   │   ║
║  │  Advanced Features:                    Getting Help:                              │   ║
║  │  ─────────────────────                 ──────────────                             │   ║
║  │  [Ctrl+R]   Force refresh all          [F1]       Context help                    │   ║
║  │  [Ctrl+E]   Export current view        [F2]       Keyboard shortcuts              │   ║
║  │  [Ctrl+S]   Save current state         [F3]       Epic workflow guide             │   ║
║  │                                                                                   │   ║
║  └───────────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                          ║
║  ┌─ Epic Workflow Guide ─────────────────────────────────────────────────────────────┐   ║
║  │                                                                                   │   ║
║  │  Understanding Epic Progress:                                                     │   ║
║  │                                                                                   │   ║
║  │  ✔︎ Completed    ⏳︎ In Progress    ○ Pending    ⨯ Failed    ⚠︎ Warning               │   ║
║  │                                                                                   │   ║
║  │  Workflow Steps:                                                                  │   ║
║  │  1. Document Validation - Validates epic manifest and structure                   │   ║
║  │  2. Epic Analysis & Setup - Analyzes requirements and initializes epic            │   ║
║  │  3. Tag Creation & Switching - Creates Git tag and switches branch                │   ║
║  │  4. PRD Generation - Generates Product Requirements Document                      │   ║
║  │  5. Agent Analysis & Creation - Determines and creates required agents            │   ║
║  │  6. Research Decision - Decides whether research mode is needed                   │   ║
║  │  7. Parse PRD to Tasks - Converts PRD into actionable TaskMaster tasks            │   ║
║  │  8. Complexity Analysis - Analyzes task complexity and dependencies               │   ║
║  │  9. Multi-Agent Review - Coordinates multiple agents for task execution           │   ║
║  │  10. Final Verification - Validates epic completion and results                   │   ║
║  │                                                                                   │   ║
║  └───────────────────────────────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

### Help Panel Components:
1. **Quick Reference Section**:
   - Global keyboard shortcuts
   - Context-aware shortcuts for current tab
   - Vi-mode specific commands
   - Epic management shortcuts

2. **Epic Workflow Guide**:
   - Status icon meanings
   - Workflow step explanations
   - Common troubleshooting tips
   - Feature explanations

3. **Interactive Help**:
   - Context-sensitive based on current tab
   - Progressive disclosure (basic → advanced)
   - Search functionality within help
   - Links to external documentation

---

## Responsive Layout Considerations

### Terminal Size Adaptations:

**Extra Large (140+ cols):**
- All panels shown with maximum detail
- Multi-column layouts in all tabs
- Extended help and documentation views

**Large (120-139 cols):**
- Standard layout with all features
- Comfortable spacing and full tables
- Side-by-side panels in most tabs

**Medium (100-119 cols):**
- Slightly compressed but full-featured
- Some panels stack vertically
- Abbreviated column headers

**Small (80-99 cols):**
- Compact mode with reduced spacing
- More vertical stacking
- Shortened text and labels

**Extra Small (60-79 cols):**
- Minimal viable layout
- Single-column only
- Essential information only
- Simplified navigation

## Technical Implementation with Stickers

### Status Character Mapping
```go
// Status indicators using terminal-safe characters
const (
    StatusCompleted   = "✔︎"    // Completed tasks/steps
    StatusInProgress  = "⏳︎"    // Currently active
    StatusPending     = "○"    // Not started
    StatusError       = "⨯"    // Failed/error state
    StatusWarning     = "⚠︎"    // Warning/attention needed
    StatusActive      = "◉"    // Active agents
    StatusBusy        = "⏺︎"    // Busy agents
    StatusIdle        = "◌"    // Idle agents
    StatusOn          = "⏺︎"    // Busy agents
    StatusOff         = "◌"    // Idle agents
    StatusDocument    = "▤"    // Document/file indicators
    StatusCreated     = "✳︎"    // Special events/actions
    StatusSpecial     = "✳︎"    // Special events/actions
)
```

### FlexBox Layout Structure:
```go
// Main layout using Stickers FlexBox
mainLayout := stickers.NewFlexBox().
    SetDirection(stickers.ROW).
    SetGap(1)

// Header section (fixed height)
headerBox := stickers.NewFlexBox().
    SetHeight(5).
    SetDirection(stickers.COLUMN)

// Tab content area (flexible height)
contentBox := stickers.NewFlexBox().
    SetDirection(stickers.COLUMN).
    SetGrow(1)

// Split panels for tabs that need them
leftPanel := stickers.NewFlexBox().
    SetWidth(30).  // Fixed width or ratio
    SetDirection(stickers.COLUMN)

rightPanel := stickers.NewFlexBox().
    SetGrow(1).    // Take remaining space
    SetDirection(stickers.COLUMN)
```

### Advanced Table Integration:
- Use Stickers Table for task lists and agent displays
- Sortable columns with click handlers
- Scrollable content for large datasets
- Cell hover details and context menus

### Character Guidelines:
- **NO EMOJIS**: Use only ASCII/Unicode characters that render consistently
- **Status Indicators**: Use geometric shapes (●○◐◒◉) for clear visual distinction
- **Progress States**: Use checkmarks (✔︎) and time symbols (⏳︎) for workflow progress
- **File Types**: Use square with horizontal lines (▤) for documents and files
- **Special Actions**: Use eight-spoked asterisk (✳︎) for created and special events
- **System Actions**: Use double nested greater-than (⪢) for system actions

This UI structure provides a professional, intuitive interface that leverages the full power of the Charmbracelet ecosystem while maintaining excellent usability and consistent rendering across different terminal sizes and platforms.