# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a hybrid repository containing both Go and TypeScript implementations of the Charm ecosystem terminal UI libraries:

- **Bubble Tea** - A TUI framework based on The Elm Architecture
- **Bubbles** - Common UI components for Bubble Tea
- **Lipgloss** - Terminal styling library for beautiful CLI applications
- **Charm X** - Extended utilities and experimental features
- **Termenv** - Terminal environment detection

The repository follows a federated multi-module structure with vendor namespaces:
- `charmbracelet/` - Original Go implementations with extensive examples
- `muesli/` - Terminal environment utilities (Go)
- `lovely/` - TypeScript ports of the libraries
- `agent/dashboard/` - React-based dashboard for Epic progress tracking

## Development Commands

### Go Projects
Each Go module is independent with its own `go.mod`. Use `task` (Taskfile) where available:

**Testing:**
```bash
# Individual modules
cd charmbracelet/bubbletea && go test ./...
cd charmbracelet/bubbles && go test ./...
cd charmbracelet/lipgloss && go test ./...

# With task runner (recommended)
cd charmbracelet/bubbletea && task test
cd charmbracelet/bubbles && task test
cd charmbracelet/lipgloss && task test
```

**Linting:**
```bash
# Individual modules
cd charmbracelet/bubbletea && golangci-lint run

# With task runner (recommended)
cd charmbracelet/bubbletea && task lint
```

### TypeScript Projects
Always use `bun` for package management (never npm):

**Lipgloss TypeScript Port:**
```bash
cd lovely/lipgloss-ts
bun install
bun run build          # Build the library
bun run test           # Run tests
bun run lint           # ESLint with TypeScript
bun run type-check     # TypeScript type checking
bun run format         # Prettier formatting
```

**Epic Dashboard:**
```bash
cd agent/dashboard
bun install
bun run dev            # Development mode
bun run build          # Build executable
bun run status         # Show epic status
```

## Architecture Overview

### Multi-Module Go Structure
- Each library maintains independent `go.mod` files
- Comprehensive example programs in `examples/` directories
- Golden file testing for consistent output validation
- Platform-specific implementations (Windows/Unix) where needed

### TypeScript Architecture
- Modern ES modules with full TypeScript strict mode
- Rollup-based build system with ESBuild for compilation
- Comprehensive type definitions exported for consumers
- API compatibility maintained with Go originals where possible

### Key Patterns
- **Elm Architecture** (Init/Update/View) - Core pattern for Bubble Tea
- **Component-based UI** - Reusable components in Bubbles
- **Declarative styling** - Lipgloss style composition
- **Terminal abstractions** - Cross-platform terminal handling

## Project Structure

```
charmbracelet/
├── bubbletea/         # Core TUI framework (Go)
│   ├── examples/      # Comprehensive example programs
│   └── tutorials/     # Learning materials
├── bubbles/           # UI components library (Go)
├── lipgloss/          # Terminal styling (Go)
├── x/                 # Extended utilities and experimental features
│   ├── ansi/          # ANSI escape sequence handling
│   ├── input/         # Advanced input handling
│   └── exp/           # Experimental packages
muesli/termenv/        # Terminal environment detection (Go)
lovely/lipgloss-ts/    # TypeScript port of Lipgloss
agent/dashboard/       # React dashboard for Epic tracking
```

## Testing Strategy

### Go Testing
- Unit tests with golden file validation
- Example programs serve as integration tests
- Platform-specific test coverage
- Benchmarking for performance-critical paths

### TypeScript Testing
- Bun test runner for fast execution
- Type-level testing for API compatibility
- Example-driven testing approach

## Build and Distribution

### Go Modules
Each module builds independently using standard Go toolchain. No shared build configuration.

### TypeScript Libraries
- ESBuild compilation for performance
- Dual CJS/ESM output with TypeScript declarations
- Tree-shaking friendly exports
- Node.js 18+ requirement

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
