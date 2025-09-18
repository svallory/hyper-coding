# HyperDash Makefile

.PHONY: build run clean install test dev

# Build the dashboard binary
build:
	go build -o dash ./cmd/dash

# Run the dashboard with default settings
run: build
	./dash

# Run in development mode with verbose output
dev: build
	./dash -epic agent/epics

# Clean build artifacts
clean:
	rm -f dash
	go clean

# Install dependencies
install:
	go mod download
	go mod tidy

# Run tests
test:
	go test ./...

# Build for different platforms
build-linux:
	GOOS=linux GOARCH=amd64 go build -o dash-linux ./cmd/dash

build-darwin:
	GOOS=darwin GOARCH=amd64 go build -o dash-darwin ./cmd/dash

build-windows:
	GOOS=windows GOARCH=amd64 go build -o dash-windows.exe ./cmd/dash

# Build for all platforms
build-all: build-linux build-darwin build-windows

# Create a sample epic for testing
create-sample-epic:
	@echo "Creating sample epic for testing..."
	@mkdir -p agent/epics/sample-epic
	@echo '{\
		"epic_name": "sample-epic",\
		"current_step": 3,\
		"completed_steps": [1, 2],\
		"workflow_config": {\
			"no_stop": false,\
			"max_subagents": 5,\
			"use_research": null\
		},\
		"tag_name": null,\
		"artifacts": {\
			"original_doc": "spec.md",\
			"prd": "prd.md"\
		},\
		"agents": {\
			"required": ["task-executor", "reviewer"],\
			"created": ["task-executor"],\
			"available": []\
		},\
		"execution": {\
			"tasks_in_progress": ["task-3.1", "task-3.2"],\
			"tasks_completed": ["task-1.1", "task-2.1", "task-2.2"],\
			"parallel_agents_active": 2,\
			"last_task_completion": "2025-01-16T14:45:30Z"\
		},\
		"timestamp": "2025-01-16T14:30:00Z",\
		"last_updated": "2025-01-16T14:46:00Z",\
		"status": "running"\
	}' > agent/epics/sample-epic/workflow-state.json
	@echo '[2025-01-16T14:30:00Z] [info] Epic workflow started for sample-epic' > agent/epics/sample-epic/workflow.log
	@echo '[2025-01-16T14:32:15Z] [success] Document validation completed' >> agent/epics/sample-epic/workflow.log
	@echo '[2025-01-16T14:35:20Z] [agent] Deployed task-executor agent for task 3.1' >> agent/epics/sample-epic/workflow.log
	@echo '[2025-01-16T14:40:45Z] [agent] Deployed task-executor agent for task 3.2' >> agent/epics/sample-epic/workflow.log
	@echo '[2025-01-16T14:42:10Z] [success] Task 2.2 completed by agent' >> agent/epics/sample-epic/workflow.log
	@echo '[2025-01-16T14:45:30Z] [info] Step 3 in progress with 2 active agents' >> agent/epics/sample-epic/workflow.log
	@echo "Sample epic created at agent/epics/sample-epic"

# Remove sample epic
clean-sample:
	rm -rf agent/epics/sample-epic

# Testing and Demo Commands
quick-test: build
	@echo "🧪 Running quick dashboard test..."
	./scripts/quick-test.sh

simulate-epic: build
	@echo "🎭 Running realistic epic simulation..."
	./scripts/simulate-epic.sh

multi-simulation: build
	@echo "🎭 Running multi-epic simulation..."
	./scripts/multi-epic-simulation.sh

record-demo: build
	@echo "🎬 Starting demo recording..."
	./scripts/record-demo.sh

# Help
help:
	@echo "HyperDash Build Commands:"
	@echo ""
	@echo "  build              Build the dashboard binary"
	@echo "  run               Build and run with default settings"  
	@echo "  dev               Run in development mode"
	@echo "  clean             Clean build artifacts"
	@echo "  install           Install dependencies"
	@echo "  test              Run tests"
	@echo ""
	@echo "  build-linux       Build for Linux"
	@echo "  build-darwin      Build for macOS"
	@echo "  build-windows     Build for Windows"
	@echo "  build-all         Build for all platforms"
	@echo ""
	@echo "  create-sample-epic Create sample epic for testing"
	@echo "  clean-sample      Remove sample epic"
	@echo ""
	@echo "  quick-test        Run quick dashboard functionality test"
	@echo "  simulate-epic     Run realistic epic workflow simulation"
	@echo "  multi-simulation  Run multiple epics simultaneously"
	@echo "  record-demo       Record dashboard demo video"
	@echo ""
	@echo "  help              Show this help message"