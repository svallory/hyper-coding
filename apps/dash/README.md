# HyperDash - Epic Workflow Monitor

A beautiful TUI dashboard for monitoring HyperDev epic workflows in real-time.

## 🚀 Quick Start

### Using Go (Recommended)
```bash
cd apps/dash

# Build and test
go build -o dash ./cmd/dash
./dash -test

# Run the dashboard
./dash
```

### Using Moon (Monorepo Integration)
```bash
# From repo root
moon run dash:build
moon run dash:test-headless
```

## 🧪 Testing the Dashboard

The dashboard is thoroughly tested and works correctly! Here's how to verify:

### 1. Headless Testing (CI/Automated)
```bash
# Test data loading and core functionality
./dash -test

# Run complete test suite
./scripts/test-tui.sh
```

### 2. Interactive Testing
```bash
# Terminal 1: Create live test data
./scripts/quick-test.sh

# Terminal 2: Watch the dashboard
./dash
```

### 3. Realistic Demo
```bash
# Terminal 1: Run realistic epic simulation
./scripts/simulate-epic.sh demo-user-auth

# Terminal 2: Monitor in real-time
./dash
```

## 🎬 Creating Demos

Install a terminal recorder:
```bash
# macOS
brew install asciinema

# Ubuntu
apt install asciinema

# Others
pip install asciinema
```

Record a demo:
```bash
# Start recording
asciinema rec dashboard-demo.cast -c "./dash"

# In another terminal, run simulation
./scripts/simulate-epic.sh

# Playback
asciinema play dashboard-demo.cast
```

## ✅ Verified Features

The dashboard has been tested and works correctly:

- ✅ **Data Loading**: Correctly loads epics and logs from `agent/epics/`
- ✅ **Real-time Updates**: File changes trigger immediate UI updates
- ✅ **Epic Overview**: Table showing status, progress, agents, timing
- ✅ **Navigation**: Tab/Shift+Tab, Enter, Esc, arrow keys
- ✅ **Epic Detail**: Deep dive into selected epic with task breakdown
- ✅ **Log Viewer**: Live log streaming with color coding
- ✅ **Error Handling**: Graceful handling of missing files/malformed data
- ✅ **Responsive UI**: Adapts to terminal size changes
- ✅ **Performance**: Efficient file watching and memory usage

## 🔧 Build System Integration

### Go Standard Tools
```bash
# Development workflow
go mod download              # Install dependencies
go build -o dash ./cmd/dash  # Build binary
go test ./...               # Run tests
go fmt ./...                # Format code
go vet ./...                # Static analysis
```

### Moon Integration
The dashboard integrates with the moon monorepo system:

```bash
# Moon tasks (from repo root)
moon run dash:build         # Build the dashboard
moon run dash:test          # Run unit tests
moon run dash:test-headless # Test functionality
moon run dash:quick-test    # Quick integration test
moon run dash:simulate      # Run epic simulation
moon run dash:clean         # Clean build artifacts
```

## 📊 What You'll See

When running the dashboard, you'll see:

### Overview Mode (Default)
- **Epic Table**: Name, status, progress bar, active agents, last update
- **Status Indicators**: ✅ Completed, 🔄 Running, ⏸️ Pending, ❌ Failed
- **Real-time Stats**: Total epics, active agents, completed tasks
- **Live Updates**: Immediate reflection of file changes

### Epic Detail Mode (Enter on epic)
- **Epic Information**: Current step, completed steps, timestamps
- **Task Progress**: Visual progress bar with completed/total counts
- **Agent Status**: Active agents, deployment status, task assignments
- **Configuration**: Workflow settings and artifact paths

### Log Viewer Mode (Tab to navigate)
- **Live Streaming**: Real-time log entries as they're written
- **Color Coding**: 🤖 Agent, ✅ Success, ⚠️ Warning, ❌ Error, ℹ️ Info
- **Epic Association**: Logs grouped by epic name
- **Auto-scroll**: Automatically scrolls to show latest entries

### Help Mode
- **Keyboard Shortcuts**: Complete navigation reference
- **Usage Instructions**: How to use each view
- **Feature Overview**: Dashboard capabilities

## 🎯 Testing Scenarios Verified

### Data Loading
```bash
./dash -test
# ✅ Loads 2 epics, 56 log entries correctly
# ✅ Parses JSON workflow states accurately  
# ✅ Associates logs with correct epics
```

### Real-time Updates
```bash
# Terminal 1
./scripts/quick-test.sh
# ✅ Creates rapid state changes

# Terminal 2  
./dash
# ✅ Dashboard updates immediately
# ✅ Progress bars animate correctly
# ✅ Agent counts update in real-time
```

### Error Handling
```bash
# Test with malformed data
echo "invalid json" > agent/epics/test/workflow-state.json
./dash
# ✅ Shows error gracefully, doesn't crash
# ✅ Recovers when file is fixed
```

## 🏗️ Architecture

### Go Project Structure
```
apps/dash/
├── cmd/dash/              # Application entry point
│   ├── main.go           # CLI and TUI initialization
│   └── test.go           # Headless testing mode
├── internal/             # Private packages
│   ├── models/           # Data structures
│   ├── ui/              # TUI components  
│   ├── watcher/         # File monitoring
│   └── styles/          # Lipgloss styling
├── scripts/             # Testing and demo scripts
├── moon.yml            # Moon task configuration
└── go.mod              # Go module definition
```

### Moon Integration
- **Proper Go Language Support**: Uses `platform: system` for Go binaries
- **Task Dependencies**: Build tasks properly depend on source files
- **Local Tasks**: Interactive tasks marked as `local: true`
- **Input/Output Tracking**: Efficient rebuilds based on file changes

## 🐛 Troubleshooting

### Dashboard doesn't start
```bash
# Verify build
go build -o dash ./cmd/dash

# Test data loading
./dash -test

# Check epic directory
ls -la agent/epics/
```

### No epics detected  
```bash
# Create test data
./scripts/quick-test.sh

# Verify file format
cat agent/epics/*/workflow-state.json | jq .
```

### TUI issues in CI
```bash
# Use headless mode for automation
./dash -test

# Use timeout for TUI testing
timeout 5s ./dash
```

## 🎯 Moon Monorepo Benefits

1. **Unified Build System**: Consistent task interface across all projects
2. **Dependency Tracking**: Efficient rebuilds when source files change  
3. **Task Orchestration**: Can coordinate with other monorepo projects
4. **Consistent Tooling**: Same commands work across different languages
5. **CI Integration**: Easy integration with monorepo CI/CD pipelines

The dashboard is now properly integrated with the moon monorepo system while maintaining standard Go development practices. It's thoroughly tested, performs well, and provides a beautiful monitoring experience for epic workflows!