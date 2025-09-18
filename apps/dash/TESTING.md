# Testing HyperDash

Complete guide for testing the HyperDash epic workflow monitor.

## 🚀 Quick Start

```bash
cd apps/dash

# Build and run quick test (30 seconds)
make quick-test

# In another terminal, start the dashboard
make run
```

## 🎭 Simulation Scripts

### 1. Quick Test (`make quick-test`)
**Duration**: ~30 seconds  
**Purpose**: Rapid functionality verification

- Creates a test epic with immediate state changes
- Tests real-time updates, agent deployment, task completion
- Perfect for development and CI testing

### 2. Realistic Epic Simulation (`make simulate-epic`)
**Duration**: ~3-5 minutes  
**Purpose**: Full workflow demonstration

- Simulates a complete user authentication epic
- Includes planning, agent deployment, task execution, error handling
- Shows realistic timing and progression
- Demonstrates retry mechanisms and error recovery

### 3. Multi-Epic Simulation (`make multi-simulation`)
**Duration**: ~3-5 minutes  
**Purpose**: Stress testing with multiple workflows

- Runs 4 epics simultaneously:
  - `demo-user-auth`
  - `demo-payment-system` 
  - `demo-notification-service`
  - `demo-admin-dashboard`
- Tests dashboard performance with multiple active epics
- Shows parallel agent execution

### 4. Demo Recording (`make record-demo`)
**Duration**: Variable  
**Purpose**: Create shareable demonstrations

- Automatically detects recording tools (asciinema, terminalizer, ttyrec)
- Builds dashboard and starts simulation
- Records terminal session for sharing
- Provides playback and conversion instructions

## 🎬 Creating Terminal Videos

### Option 1: asciinema (Recommended)
```bash
# Install
brew install asciinema          # macOS
apt install asciinema          # Ubuntu
pip install asciinema          # Others

# Record manually
cd apps/dash
asciinema rec demo.cast -c "./dash" --title "HyperDash Demo"

# Playback
asciinema play demo.cast

# Share online
asciinema upload demo.cast
```

### Option 2: terminalizer
```bash
# Install
npm install -g terminalizer

# Record manually
cd apps/dash
terminalizer record demo -c "./dash"

# Playback
terminalizer play demo

# Generate GIF
terminalizer render demo
```

### Option 3: ttyrec
```bash
# Install
brew install ttyrec            # macOS
apt install ttyrec            # Ubuntu

# Record manually
cd apps/dash
ttyrec -e "./dash" demo.tty

# Playback
ttyplay demo.tty
```

## 📋 Manual Testing Checklist

### Dashboard Startup
- [ ] Dashboard starts without errors
- [ ] Shows "Loading epic data..." briefly
- [ ] Displays empty state when no epics exist
- [ ] Window resizing works correctly

### Epic Discovery
- [ ] Automatically discovers existing epics
- [ ] Shows epic in overview table
- [ ] Displays correct status, progress, and timing
- [ ] Updates when new epics are created

### Real-time Updates
- [ ] File changes trigger immediate updates
- [ ] Progress bars update correctly
- [ ] Agent counts reflect current state
- [ ] Log entries appear in real-time
- [ ] Timestamps show "Just now" for recent updates

### Navigation
- [ ] Tab/Shift+Tab switches views correctly
- [ ] Enter selects epic from overview
- [ ] Esc returns to overview
- [ ] Arrow keys scroll in logs view
- [ ] All keyboard shortcuts work as documented

### Epic Detail View
- [ ] Shows complete epic information
- [ ] Task progress displays correctly
- [ ] Agent status is accurate
- [ ] Navigation between epics works

### Log Viewer
- [ ] Shows recent logs (last 50 entries)
- [ ] Auto-scrolls to bottom on new entries
- [ ] Color coding matches log levels
- [ ] Epic names are correctly associated
- [ ] Timestamps format correctly

### Error Handling
- [ ] Invalid JSON doesn't crash dashboard
- [ ] Missing files are handled gracefully
- [ ] Watcher errors are displayed appropriately
- [ ] Network issues don't hang the interface

## 🧪 Testing Different Scenarios

### Scenario 1: Epic Lifecycle
```bash
# Start with empty dashboard
./dash

# In another terminal:
./scripts/simulate-epic.sh test-lifecycle

# Verify: Epic progresses through all states
# ⏸️ Pending → 🔄 Running → ✅ Completed
```

### Scenario 2: Error Recovery
```bash
# Create an epic with malformed JSON
mkdir -p agent/epics/broken-epic
echo "invalid json" > agent/epics/broken-epic/workflow-state.json

# Verify: Dashboard shows error but doesn't crash
# Fix the JSON and verify recovery
```

### Scenario 3: High Activity
```bash
# Run multi-simulation for stress testing
./scripts/multi-epic-simulation.sh

# Verify: Dashboard handles multiple simultaneous updates
# Check memory usage and performance
```

### Scenario 4: File Permissions
```bash
# Test with read-only files
chmod 444 agent/epics/*/workflow-state.json

# Verify: Dashboard shows appropriate error messages
```

## 📊 Performance Testing

### Memory Usage
```bash
# Monitor memory during multi-epic simulation
top -p $(pgrep dash)

# Expected: <50MB memory usage
```

### CPU Usage
```bash
# Monitor CPU during high activity
htop

# Expected: <5% CPU when idle, <20% during active updates
```

### File Watching
```bash
# Test large number of epics
for i in {1..20}; do
    ./scripts/simulate-epic.sh "stress-test-$i" &
done

# Verify: Dashboard remains responsive
```

## 🐛 Common Issues and Solutions

### Dashboard doesn't start
```bash
# Check build
make build

# Check permissions
ls -la dash

# Check dependencies
go mod tidy
```

### No epics detected
```bash
# Verify directory structure
ls -la agent/epics/

# Check file format
cat agent/epics/*/workflow-state.json | jq .
```

### Updates not showing
```bash
# Check file watcher
lsof | grep workflow-state.json

# Verify file timestamps
stat agent/epics/*/workflow-state.json
```

### Poor performance
```bash
# Check for too many epics
find agent/epics -name "*.json" | wc -l

# Clean up old simulations
rm -rf agent/epics/demo-*
```

## 📈 Continuous Integration Testing

### Unit Tests
```bash
go test ./internal/models/
go test ./internal/watcher/
```

### Integration Tests
```bash
# Automated epic simulation
timeout 60s ./scripts/simulate-epic.sh ci-test

# Verify epic completion
test -f agent/epics/ci-test/workflow-state.json
grep "completed" agent/epics/ci-test/workflow-state.json
```

### Performance Benchmarks
```bash
# Time epic simulation
time ./scripts/simulate-epic.sh benchmark-test

# Measure dashboard startup
time timeout 5s ./dash --help
```

## 🎯 Testing Best Practices

1. **Start Simple**: Use `quick-test` for initial verification
2. **Progress Gradually**: Move to realistic simulations
3. **Test Edge Cases**: Try malformed data and error conditions
4. **Monitor Resources**: Check memory and CPU usage
5. **Record Issues**: Use terminal recording for bug reports
6. **Clean Up**: Remove test data between runs

## 📝 Reporting Issues

When reporting bugs, include:

1. **Environment**: OS, terminal, Go version
2. **Steps to reproduce**: Exact commands used
3. **Expected vs actual behavior**
4. **Terminal recording**: Use asciinema for visual bugs
5. **Log output**: Any error messages or warnings
6. **Test data**: Sample epic files if relevant

This comprehensive testing suite ensures HyperDash works reliably across different scenarios and environments.