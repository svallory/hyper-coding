# Makefile for HyperDash application

.PHONY: build build-release run test test-coverage clean help deps deps-update format lint lint-full security docker-build docker-run release-snapshot release ci-build ci-test ci-validate install uninstall

# Variables
BINARY_NAME=hyper-dash
MAIN_PACKAGE=./cmd/dash
DIST_DIR=dist
VERSION ?= $(shell git describe --tags --always --dirty)
COMMIT ?= $(shell git rev-parse --short HEAD)
DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS=-ldflags "-s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(DATE) -X main.builtBy=makefile"

# Colors for output
RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[1;33m
BLUE=\033[0;34m
NC=\033[0m # No Color

# Build targets
build: ## Build the application for local development
	@echo "$(BLUE)Building $(BINARY_NAME)...$(NC)"
	go build $(LDFLAGS) -o $(BINARY_NAME) $(MAIN_PACKAGE)
	@echo "$(GREEN)Build completed: $(BINARY_NAME)$(NC)"

# Legacy build target for backward compatibility
dash: build
	@echo "$(YELLOW)Legacy 'dash' target used. Consider using 'make build' instead.$(NC)"

build-release: ## Build for all platforms using build script
	@echo "$(BLUE)Building for all platforms...$(NC)"
	../scripts/build.sh
	@echo "$(GREEN)Cross-platform build completed$(NC)"

ci-build: ## Build for CI/CD with optimizations
	@echo "$(BLUE)Building for CI/CD...$(NC)"
	CGO_ENABLED=0 go build $(LDFLAGS) -trimpath -mod=readonly -o $(BINARY_NAME) $(MAIN_PACKAGE)
	@echo "$(GREEN)CI build completed$(NC)"

# Legacy platform-specific builds (preserved for compatibility)
build-linux: ## Build for Linux (legacy)
	@echo "$(YELLOW)Legacy platform build. Consider using 'make build-release' for all platforms.$(NC)"
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY_NAME)-linux ./cmd/dash

build-darwin: ## Build for macOS (legacy)
	@echo "$(YELLOW)Legacy platform build. Consider using 'make build-release' for all platforms.$(NC)"
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY_NAME)-darwin ./cmd/dash

build-windows: ## Build for Windows (legacy)
	@echo "$(YELLOW)Legacy platform build. Consider using 'make build-release' for all platforms.$(NC)"
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY_NAME)-windows.exe ./cmd/dash

build-all: build-linux build-darwin build-windows ## Build for all platforms (legacy)

# Run targets
run: build ## Build and run the application
	@echo "$(BLUE)Running $(BINARY_NAME)...$(NC)"
	./$(BINARY_NAME)

# Legacy run target
dev: build ## Run in development mode (legacy)
	@echo "$(YELLOW)Legacy 'dev' target used. Consider using 'make run' instead.$(NC)"
	./$(BINARY_NAME) --epic agent/epics

run-test: build ## Run in test mode
	@echo "$(BLUE)Running $(BINARY_NAME) in test mode...$(NC)"
	./$(BINARY_NAME) --test

# Test targets
test: ## Run tests with race detection and coverage
	@echo "$(BLUE)Running tests...$(NC)"
	go test -race -cover -coverprofile=coverage.out ./...
	@echo "$(GREEN)Tests completed$(NC)"

test-short: ## Run short tests only
	@echo "$(BLUE)Running short tests...$(NC)"
	go test -short ./...

test-coverage: test ## Generate coverage report
	@echo "$(BLUE)Generating coverage report...$(NC)"
	go tool cover -html=coverage.out -o coverage.html
	@echo "$(GREEN)Coverage report generated: coverage.html$(NC)"

ci-test: ## Run tests for CI/CD with JSON output
	@echo "$(BLUE)Running CI tests...$(NC)"
	go test -race -cover -coverprofile=coverage.out -json ./... > test-report.json
	@echo "$(GREEN)CI tests completed$(NC)"

benchmark: ## Run benchmarks
	@echo "$(BLUE)Running benchmarks...$(NC)"
	go test -bench=. -benchmem ./...

# Maintenance targets
clean: ## Clean build artifacts and caches
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	go clean
	rm -f $(BINARY_NAME) dash # Remove both new and legacy binary names
	rm -rf $(DIST_DIR)/
	rm -f coverage.out coverage.html test-report.json
	rm -f *.prof gosec.sarif
	@echo "$(GREEN)Clean completed$(NC)"

deps: ## Download and verify dependencies (replaces install)
	@echo "$(BLUE)Installing dependencies...$(NC)"
	go mod download
	go mod verify
	go mod tidy
	@echo "$(GREEN)Dependencies installed$(NC)"

# Legacy deps target
install: deps ## Install dependencies (legacy)
	@echo "$(YELLOW)Legacy 'install' target used. Consider using 'make deps' instead.$(NC)"

deps-update: ## Update all dependencies
	@echo "$(BLUE)Updating dependencies...$(NC)"
	go get -u ./...
	go mod tidy
	@echo "$(GREEN)Dependencies updated$(NC)"

# Code quality targets
format: ## Format code using go fmt
	@echo "$(BLUE)Formatting code...$(NC)"
	go fmt ./...
	@echo "$(GREEN)Code formatted$(NC)"

lint: ## Run basic linting with go vet
	@echo "$(BLUE)Running basic linting...$(NC)"
	go vet ./...
	@echo "$(GREEN)Basic linting completed$(NC)"

lint-full: ## Run comprehensive linting with golangci-lint
	@echo "$(BLUE)Running comprehensive linting...$(NC)"
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
		echo "$(GREEN)Comprehensive linting completed$(NC)"; \
	else \
		echo "$(YELLOW)golangci-lint not installed, running basic lint only$(NC)"; \
		$(MAKE) lint; \
	fi

typecheck: ## Type check without building artifacts
	@echo "$(BLUE)Type checking...$(NC)"
	go build -o /dev/null ./...
	@echo "$(GREEN)Type check completed$(NC)"

# Security targets
security: ## Run security scan with gosec
	@echo "$(BLUE)Running security scan...$(NC)"
	@if command -v gosec >/dev/null 2>&1; then \
		gosec ./...; \
		echo "$(GREEN)Security scan completed$(NC)"; \
	else \
		echo "$(YELLOW)gosec not installed, skipping security scan$(NC)"; \
	fi

security-full: ## Run security scan with SARIF output
	@echo "$(BLUE)Running comprehensive security scan...$(NC)"
	@if command -v gosec >/dev/null 2>&1; then \
		gosec -fmt sarif -out gosec.sarif ./...; \
		echo "$(GREEN)Security scan completed: gosec.sarif$(NC)"; \
	else \
		echo "$(YELLOW)gosec not installed, skipping security scan$(NC)"; \
	fi

# Docker targets
docker-build: ## Build Docker image
	@echo "$(BLUE)Building Docker image...$(NC)"
	docker build -t hyper-dash:latest .
	@echo "$(GREEN)Docker image built: hyper-dash:latest$(NC)"

docker-run: docker-build ## Build and run Docker container
	@echo "$(BLUE)Running Docker container...$(NC)"
	docker run --rm -it hyper-dash:latest

# Release targets
release-prepare: ## Check release readiness
	@echo "$(BLUE)Checking release readiness...$(NC)"
	@if command -v goreleaser >/dev/null 2>&1; then \
		goreleaser check; \
		echo "$(GREEN)Release check passed$(NC)"; \
	else \
		echo "$(YELLOW)goreleaser not installed$(NC)"; \
	fi

release-snapshot: test lint ## Create snapshot release
	@echo "$(BLUE)Creating snapshot release...$(NC)"
	@if command -v goreleaser >/dev/null 2>&1; then \
		goreleaser release --snapshot --rm-dist; \
		echo "$(GREEN)Snapshot release created$(NC)"; \
	else \
		echo "$(YELLOW)goreleaser not installed, using build script$(NC)"; \
		$(MAKE) build-release; \
	fi

release: test lint ## Create production release
	@echo "$(BLUE)Creating production release...$(NC)"
	@if command -v goreleaser >/dev/null 2>&1; then \
		goreleaser release --rm-dist; \
		echo "$(GREEN)Production release created$(NC)"; \
	else \
		echo "$(RED)goreleaser required for production releases$(NC)"; \
		exit 1; \
	fi

# CI/CD validation
ci-validate: format lint typecheck test ## Run full CI/CD validation suite
	@echo "$(GREEN)CI/CD validation completed successfully$(NC)"

# Installation targets
install-binary: build ## Install binary to system
	@echo "$(BLUE)Installing $(BINARY_NAME)...$(NC)"
	sudo cp $(BINARY_NAME) /usr/local/bin/
	@echo "$(GREEN)$(BINARY_NAME) installed to /usr/local/bin/$(NC)"

uninstall-binary: ## Remove binary from system
	@echo "$(BLUE)Uninstalling $(BINARY_NAME)...$(NC)"
	sudo rm -f /usr/local/bin/$(BINARY_NAME)
	@echo "$(GREEN)$(BINARY_NAME) uninstalled$(NC)"

# Performance profiling
profile-cpu: ## Generate CPU profile
	@echo "$(BLUE)Generating CPU profile...$(NC)"
	go test -cpuprofile=cpu.prof ./...
	@echo "$(GREEN)CPU profile generated: cpu.prof$(NC)"

profile-mem: ## Generate memory profile
	@echo "$(BLUE)Generating memory profile...$(NC)"
	go test -memprofile=mem.prof ./...
	@echo "$(GREEN)Memory profile generated: mem.prof$(NC)"

# Information targets
version: ## Show version information
	@echo "Version: $(VERSION)"
	@echo "Commit: $(COMMIT)"
	@echo "Date: $(DATE)"

info: ## Show build information
	@echo "$(BLUE)Build Information:$(NC)"
	@echo "  Binary: $(BINARY_NAME)"
	@echo "  Package: $(MAIN_PACKAGE)"
	@echo "  Version: $(VERSION)"
	@echo "  Commit: $(COMMIT)"
	@echo "  Date: $(DATE)"
	@echo "  Go version: $(shell go version)"
	@echo "  Platform: $(shell go env GOOS)/$(shell go env GOARCH)"

# Legacy testing and simulation targets (preserved for compatibility)
create-sample-epic: ## Create a sample epic for testing
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

clean-sample: ## Remove sample epic
	@echo "$(BLUE)Removing sample epic...$(NC)"
	rm -rf agent/epics/sample-epic
	@echo "$(GREEN)Sample epic removed$(NC)"

# Legacy testing and simulation targets (preserved for compatibility)
quick-test: build ## Run quick dashboard functionality test (legacy)
	@echo "$(YELLOW)Legacy 'quick-test' target used.$(NC)"
	@echo "🧪 Running quick dashboard test..."
	./scripts/quick-test.sh

simulate-epic: build ## Run realistic epic workflow simulation (legacy)
	@echo "$(YELLOW)Legacy 'simulate-epic' target used.$(NC)"
	@echo "🎭 Running realistic epic simulation..."
	./scripts/simulate-epic.sh

multi-simulation: build ## Run multiple epics simultaneously (legacy)
	@echo "$(YELLOW)Legacy 'multi-simulation' target used.$(NC)"
	@echo "🎭 Running multi-epic simulation..."
	./scripts/multi-epic-simulation.sh

record-demo: build ## Record dashboard demo video (legacy)
	@echo "$(YELLOW)Legacy 'record-demo' target used.$(NC)"
	@echo "🎬 Starting demo recording..."
	./scripts/record-demo.sh

help: ## Show this help message
	@echo "$(BLUE)HyperDash Makefile$(NC)"
	@echo ""
	@echo "$(YELLOW)Usage:$(NC)"
	@echo "  make <target>"
	@echo ""
	@echo "$(YELLOW)Main Targets:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST) | grep -E "(build|run|test|clean|deps|format|lint|docker|release|ci-|help|info|version)" | head -20
	@echo ""
	@echo "$(YELLOW)Legacy Targets (preserved for compatibility):$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## .*\(legacy\)/ {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make build              # Build for development"
	@echo "  make test               # Run tests with coverage"
	@echo "  make ci-validate        # Run full validation suite"
	@echo "  make build-release      # Build for all platforms"
	@echo "  make docker-build       # Build Docker image"
	@echo "  make release-snapshot   # Create snapshot release"
	@echo ""
	@echo "For a complete list of targets: make help-all"

help-all: ## Show all available targets
	@echo "$(BLUE)All Available Targets:$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-25s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)