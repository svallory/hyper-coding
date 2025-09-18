# HyperDash Keyboard Shortcuts Reference

A comprehensive guide to all keyboard shortcuts and navigation commands in HyperDash.

## 🚀 Quick Tab Navigation

### Direct Tab Access
| Key | Tab | Description |
|-----|-----|-------------|
| `1` | Overview | Main dashboard with epic status and progress |
| `2` | Tasks | Task management with TaskMaster integration |
| `3` | Agents | Agent monitoring and efficiency analytics |
| `4` | Docs | Markdown document browser with syntax highlighting |
| `5` | Logs | Real-time log viewer with auto-scroll |
| `6` | Performance | System performance monitoring and metrics |
| `7` | Help | Keyboard shortcuts and usage instructions |

### Sequential Navigation
| Key | Action |
|-----|--------|
| `Tab` | Move to next tab |
| `Shift+Tab` | Move to previous tab |

## 📋 List & Table Navigation

### Basic Movement
| Key | Action |
|-----|--------|
| `↑` / `k` | Move up in lists/tables |
| `↓` / `j` | Move down in lists/tables |
| `←` / `h` | Move left (in tables) |
| `→` / `l` | Move right (in tables) |
| `Enter` | Select item or drill down |
| `Esc` | Go back or exit current view |

### Vi-mode Advanced Navigation
| Key | Action |
|-----|--------|
| `gg` | Go to top of current list/viewport |
| `G` | Go to bottom of current list/viewport |
| `Ctrl+u` | Page up |
| `Ctrl+d` | Page down |

## 🔍 Search & Filter

### Search Mode
| Key | Action |
|-----|--------|
| `/` | Enter search mode in current view |
| `Enter` | Execute search |
| `Esc` | Cancel search and exit search mode |
| `n` | Next search result (when available) |
| `N` | Previous search result (when available) |

### Filtering
| Key | Action |
|-----|--------|
| `f` | Filter current list (context-dependent) |
| `Ctrl+f` | Advanced filter options |

## ⌨️ Command Mode

### Command Activation
| Key | Action |
|-----|--------|
| `:` | Enter command mode |
| `Esc` | Exit command mode |

### Available Commands
| Command | Alias | Action |
|---------|--------|--------|
| `:help` | `:h` | Show help screen |
| `:overview` | `:o` | Switch to Overview tab |
| `:tasks` | `:t` | Switch to Tasks tab |
| `:agents` | `:a` | Switch to Agents tab |
| `:docs` | `:d` | Switch to Docs tab |
| `:logs` | `:l` | Switch to Logs tab |
| `:performance` | `:p` | Switch to Performance tab |
| `:quit` | `:q` | Quit application |
| `:refresh` | `:r` | Refresh all data |

## 🔄 Data & System Operations

### Refresh & Reload
| Key | Action |
|-----|--------|
| `r` | Refresh current view data |
| `R` | Force refresh all data |
| `Ctrl+r` | Reload configuration |

### Application Control
| Key | Action |
|-----|--------|
| `q` | Quit application |
| `Ctrl+c` | Force quit (emergency exit) |
| `?` | Toggle help overlay |

## 📊 View-Specific Shortcuts

### Overview Tab
| Key | Action |
|-----|--------|
| `Enter` | View epic details |
| `s` | Sort epics by status |
| `p` | Sort epics by progress |
| `t` | Sort epics by last modified time |

### Tasks Tab
| Key | Action |
|-----|--------|
| `Enter` | View task details |
| `c` | Mark task as completed (if available) |
| `u` | Update task status |
| `d` | View task dependencies |

### Agents Tab
| Key | Action |
|-----|--------|
| `Enter` | View agent details |
| `e` | View agent efficiency metrics |
| `h` | View agent health status |
| `t` | View agent task history |

### Docs Tab
| Key | Action |
|-----|--------|
| `Enter` | Open document for reading |
| `v` | View document in pager mode |
| `e` | Edit document (if external editor configured) |

### Logs Tab
| Key | Action |
|-----|--------|
| `Space` | Pause/resume auto-scroll |
| `Home` | Go to beginning of logs |
| `End` | Go to end of logs |
| `c` | Clear log view |

### Performance Tab
| Key | Action |
|-----|--------|
| `m` | View memory usage details |
| `c` | View CPU usage details |
| `n` | View network activity |
| `i` | View I/O statistics |

## 🎨 Display & Interface

### Layout Control
| Key | Action |
|-----|--------|
| `Ctrl+l` | Redraw screen |
| `+` | Increase font size (if supported) |
| `-` | Decrease font size (if supported) |

### Visual Aids
| Key | Action |
|-----|--------|
| `b` | Toggle borders |
| `h` | Toggle headers |
| `n` | Toggle line numbers |

## 🆘 Help & Information

### Quick Help
| Key | Action |
|-----|--------|
| `?` | Toggle help overlay |
| `F1` | Context-sensitive help |
| `Ctrl+?` | Show all keyboard shortcuts |

### Information
| Key | Action |
|-----|--------|
| `i` | Show current item information |
| `v` | Show version information |
| `s` | Show system status |

## 💡 Tips & Best Practices

### Efficiency Tips
1. **Use number keys (1-7)** for fastest tab switching
2. **Master vi-mode navigation** (`gg`, `G`, `/`) for power user efficiency
3. **Use search (`/`)** to quickly find specific epics, tasks, or agents
4. **Command mode (`:`)** provides quick access to all major functions
5. **Refresh (`r`)** when data seems stale or after external changes

### Workflow Patterns
- **Start with Overview (1)** to get project status at a glance
- **Tasks tab (2)** for detailed work management
- **Agents tab (3)** to monitor AI assistant efficiency
- **Performance tab (6)** to check system health
- **Logs tab (5)** for troubleshooting and real-time monitoring

### Accessibility
- All functions are keyboard-accessible
- No mouse required for any operation
- Screen reader compatible
- High contrast mode available through terminal settings

## 🔧 Customization

### Terminal Configuration
HyperDash respects your terminal's:
- Color scheme
- Font settings
- Key bindings (where possible)
- Accessibility settings

### Advanced Users
For advanced customization, HyperDash can be configured via:
- Environment variables
- Configuration files
- Command-line flags

---

*For more detailed information about specific features, use the `:help` command or press `?` while using HyperDash.*