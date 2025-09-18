# Epic Dashboard

Real-time TUI dashboard for monitoring Task Master Epic progress.

## Installation

```bash
cd agent/dashboard
bun install
```

## Usage

### Development Mode

```bash
bun run dev <epic-folder-path>
```

### Build Executable

```bash
# Build for current platform
bun run build

# Build for all platforms
bun run build:all
```

### Run Executable

```bash
./epic-dashboard agent/epics/your-epic-name
```

## Features

- Real-time progress tracking
- Workflow step visualization
- Agent status monitoring
- Configuration display
- Live log streaming
- Color-coded status indicators

## Controls

- `q` or `Ctrl+C`: Quit dashboard

## Dashboard Sections

1. **Header**: Epic name in large text
2. **Progress Bar**: Visual progress indicator with percentage
3. **Workflow Steps**: All 10 steps with completion status
4. **Configuration**: Research mode, No-stop mode, Max agents
5. **Agent Status**: Required, available, and created agents
6. **Recent Activity**: Last 8 log entries with timestamps
7. **Footer**: Last update time and controls

## File Monitoring

The dashboard monitors:

- `workflow-state.json`: Workflow progress and configuration
- `workflow.log`: Real-time activity logs

Updates automatically every 2 seconds or when files change.
