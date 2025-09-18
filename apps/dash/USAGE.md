# HyperDash Usage Guide

## 🚀 **Proper Command Usage**

You're absolutely right about specifying the epic folder! Here are the correct usage patterns:

### **From apps/dash directory (Local Development)**
```bash
cd apps/dash

# Use default local epic directory (apps/dash/agent/epics/)
./dash --test
./dash

# Specify local epic directory explicitly  
./dash --test --epic agent/epics
./dash --epic agent/epics

# Monitor repo root epics from apps/dash
./dash --test --epic ../../agent/epics
./dash --epic ../../agent/epics
```

### **From Repository Root (Production Usage)**
```bash
cd /work/hyper-dash

# Monitor all epics in the repo
./apps/dash/dash --test --epic agent/epics
./apps/dash/dash --epic agent/epics

# Create alias for convenience
alias hyperdash='./apps/dash/dash --epic agent/epics'
hyperdash --test
hyperdash
```

### **With Absolute Paths (Most Explicit)**
```bash
# From anywhere in the system
/work/hyper-dash/apps/dash/dash --test --epic /work/hyper-dash/agent/epics
/work/hyper-dash/apps/dash/dash --epic /work/hyper-dash/agent/epics
```

## 📊 **Tested Scenarios**

### **Local Development Epics** (apps/dash/agent/epics/)
```bash
cd apps/dash
./dash --test
# ✅ Found 4 epics, 88 log entries
# ✅ demo-user-auth, quick-test, sample-epic, test-epic
```

### **Repository Root Epics** (agent/epics/)
```bash
cd /work/hyper-dash
./apps/dash/dash --test --epic agent/epics
# ✅ Found 7 epics, 0 log entries  
# ✅ background-daemon, claude-integration, documentation-migration, 
#    go-cli, hyperdev-docs-transformation, hyperdev-templates, v8-launch
```

## 🎯 **Key Differences**

### **Development vs Production Data**

**Development Epics** (`apps/dash/agent/epics/`):
- Created by simulation scripts
- Rich log data with realistic progression
- Perfect for testing dashboard features
- String-based task IDs (`"task-1.1"`, `"task-2.2"`)

**Production Epics** (`agent/epics/`):
- Real epic workflow data
- Actual project progression
- Live production monitoring
- Numeric task IDs (`1`, `2`, `3`, `4`)

## 🛠️ **Recommended Workflow**

### **For Dashboard Development**
```bash
cd apps/dash

# Create test data
./scripts/quick-test.sh

# Monitor test epics
./dash --epic agent/epics
```

### **For Monitoring Real Epics**
```bash
cd /work/hyper-dash

# Monitor production epics
./apps/dash/dash --epic agent/epics

# Or create permanent alias
echo 'alias hyperdash="/work/hyper-dash/apps/dash/dash --epic /work/hyper-dash/agent/epics"' >> ~/.bashrc
source ~/.bashrc
hyperdash
```

### **For Demo Recording**
```bash
cd apps/dash

# Terminal 1: Start recording
asciinema rec demo.cast -c "./dash --epic agent/epics"

# Terminal 2: Run simulation  
./scripts/simulate-epic.sh demo-recording

# Playback
asciinema play demo.cast
```

## 🎬 **Video Recording Commands**

**Correct recording command:**
```bash
# Record dashboard monitoring local test epics
asciinema rec dashboard-local.cast -c "./dash --epic agent/epics"

# Record dashboard monitoring production epics
cd /work/hyper-dash
asciinema rec dashboard-production.cast -c "./apps/dash/dash --epic agent/epics"
```

## ✅ **Fixed Issues**

1. **Data Model**: Fixed JSON parsing for both string and numeric task IDs
2. **Path Specification**: Made epic directory explicit in all examples
3. **Command Structure**: Clear distinction between local vs production usage
4. **Testing**: Verified both test data and real epic data work correctly

The dashboard now correctly handles both development test data and real production epic data!