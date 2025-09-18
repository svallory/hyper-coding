# HyperDash

A modern, high-performance task management and epic tracking dashboard built with Go and Bubble Tea. Features real-time task monitoring, performance analytics, and TaskMaster CLI integration.

## 🚀 Quick Installation

### npm (Recommended)

```bash
# Global installation
npm install -g hyper-dash

# Local installation
npm install hyper-dash
```

### Other Installation Methods

#### Homebrew (macOS/Linux)
```bash
brew install hyperdev-io/tap/hyper-dash
```

#### Direct Download
Download the appropriate binary for your platform from [GitHub Releases](https://github.com/hyperdev-io/hyper-dash/releases).

#### Docker
```bash
docker run --rm -it ghcr.io/hyperdev-io/hyper-dash:latest
```

## 🎯 Usage

After installation, you can run HyperDash using:

```bash
# Start the interactive dashboard
hyper-dash

# Test data loading and functionality
hyper-dash -test

# Show version information
hyper-dash --version

# Show help
hyper-dash --help
```

## ✨ Features

### Core Functionality
- **Real-time Epic Monitoring**: Track multiple development epics simultaneously
- **7-Tab Interface**: Comprehensive dashboard with dedicated views for all aspects
- **TaskMaster Integration**: Seamless integration with TaskMaster AI workflows
- **Performance Analytics**: Advanced system performance monitoring and metrics
- **Vi-mode Navigation**: Efficient keyboard-driven interface with vim-style shortcuts

### Task & Agent Management
- **Task Progress Visualization**: Beautiful progress bars and status indicators
- **Agent Activity Tracking**: Monitor TaskMaster agent efficiency and status
- **Dependency Visualization**: Clear task dependency mapping and status tracking
- **Real-time Updates**: Live sync with TaskMaster CLI for current task states

### Documentation & Logs
- **Markdown Document Viewer**: Browse epic documentation with syntax highlighting
- **Real-time Log Streaming**: Auto-scrolling log viewer with color coding
- **File Watching**: Automatic updates when epic data changes
- **Search Functionality**: Full-text search across views and content

### Technical Excellence
- **Cross-platform Support**: Works on macOS, Linux, and Windows
- **Responsive UI**: Adapts to terminal size changes dynamically
- **High Performance**: Optimized rendering and minimal resource usage
- **Error Recovery**: Robust error handling with graceful fallbacks

## 🖥️ Interface Overview

### 7-Tab Dashboard Structure

HyperDash provides a comprehensive 7-tab interface for complete project monitoring:

1. **Overview** (`1`): Main dashboard showing all epics with status and progress
2. **Tasks** (`2`): Task management and tracking across all epics with TaskMaster integration
3. **Agents** (`3`): TaskMaster agent monitoring and analytics with efficiency tracking
4. **Docs** (`4`): Browse and read markdown files in epic directory with syntax highlighting
5. **Logs** (`5`): Real-time log viewer with auto-scroll and color coding
6. **Performance** (`6`): System performance monitoring and resource usage metrics
7. **Help** (`7`): Keyboard shortcuts reference and usage instructions

### Navigation & Keyboard Shortcuts

#### Quick Tab Switching
- **1-7**: Direct jump to specific tabs
- **Tab/Shift+Tab**: Cycle through tabs sequentially

#### List Navigation
- **↑/↓, j/k**: Move up/down in lists
- **←/→, h/l**: Move left/right  
- **Enter**: Select epic or item
- **Esc**: Go back to previous view

#### Vi-mode Navigation
- **gg**: Go to top of current list/viewport
- **G**: Go to bottom of current list/viewport
- **/** : Search in current view (press enter to search, esc to cancel)
- **:** : Command mode (q/quit, help, overview, tasks, agents, docs, logs)

#### General Controls
- **r**: Refresh data
- **q**: Quit application

## 🔧 Configuration

HyperDash automatically discovers epic data from:

- `agent/epics/` directory
- TaskMaster workflow files
- Project configuration files

No additional setup required for basic usage.

## 🛠️ Development

This package downloads and installs pre-compiled binaries for your platform. The source code is written in Go and uses the Charmbracelet ecosystem (Bubble Tea, Bubbles, Lipgloss) for the TUI interface.

### Supported Platforms

- **macOS**: x64, ARM64
- **Linux**: x64, ARM64  
- **Windows**: x64

### Building from Source

If you prefer to build from source:

```bash
git clone https://github.com/hyperdev-io/hyper-dash.git
cd hyper-dash/apps/dash
go build -o hyper-dash ./cmd/dash
```

## 🐛 Troubleshooting

### Installation Issues

If installation fails:

1. **Check Platform Support**: Ensure your platform is supported
2. **Network Issues**: Check internet connectivity and GitHub access
3. **Permission Issues**: Try with `sudo` (for global install) or use local install
4. **Clear Cache**: Run `npm cache clean --force`

### Runtime Issues

If the dashboard doesn't start:

1. **Test Installation**: Run `hyper-dash -test`
2. **Check Data**: Ensure epic data exists in `agent/epics/`
3. **Permissions**: Verify binary has execute permissions
4. **Version**: Run `hyper-dash --version` to verify installation

### Getting Help

- 📖 [Documentation](https://github.com/hyperdev-io/hyper-dash/blob/main/apps/dash/USAGE.md)
- 🐛 [Report Issues](https://github.com/hyperdev-io/hyper-dash/issues)
- 💬 [Discussions](https://github.com/hyperdev-io/hyper-dash/discussions)

## 📄 License

MIT License - see [LICENSE](https://github.com/hyperdev-io/hyper-dash/blob/main/LICENSE) for details.

## 🏗️ Built With

- [Go](https://golang.org/) - Core language
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - TUI framework
- [Bubbles](https://github.com/charmbracelet/bubbles) - TUI components
- [Lipgloss](https://github.com/charmbracelet/lipgloss) - Styling
- [Glamour](https://github.com/charmbracelet/glamour) - Markdown rendering

---

Made with ❤️ by the HyperDev Team