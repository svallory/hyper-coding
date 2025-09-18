# Progressive Mode System

The Epic Dashboard now features a **Progressive Mode System** that allows users to toggle between Simple monitoring mode and full Interactive management mode with preserved preferences.

## 🎯 Overview

The Progressive Mode System provides two distinct user experience modes:

### 👁️ Simple Mode (Default)
- **Purpose**: Passive monitoring with essential information
- **Target Users**: Users who want basic epic progress monitoring
- **Features**: Core display elements with minimal interaction
- **Keyboard Navigation**: Limited (basic shortcuts only)

### ⚡ Interactive Mode
- **Purpose**: Full feature set with advanced interactions
- **Target Users**: Power users who need complete epic management
- **Features**: All advanced features enabled
- **Keyboard Navigation**: Full navigation with focus management

## 🔄 Mode Switching

### Quick Switch
Press `m` at any time to toggle between modes with confirmation dialog.

### Confirmation Dialog
- Shows feature differences between modes
- Displays preserved vs reset data
- Provides warnings about feature changes
- Requires confirmation before switching

## 🛠️ Features by Mode

### Simple Mode Features
| Feature | Available | Description |
|---------|-----------|-------------|
| Epic Context | ✅ | Basic epic information display |
| Workflow Progress | ✅ | Progress bar and step display |
| Configuration Display | ✅ | Workflow configuration info |
| Agent Status | ✅ | Basic agent information |
| Recent Logs | ✅ | Activity log (limited lines) |
| Epic Switching | ✅ | Basic epic selection |
| Help System | ✅ | Basic help and shortcuts |

### Interactive Mode Features
| Feature | Available | Description |
|---------|-----------|-------------|
| **All Simple Mode Features** | ✅ | Everything from simple mode |
| Keyboard Navigation | ✅ | Full tab/arrow key navigation |
| Task Details | ✅ | Detailed task information |
| Task Actions | ✅ | Interactive task management |
| Dependency Visualization | ✅ | Task dependency graphs |
| Analytics | ✅ | Progress analytics and insights |
| Error Handling | ✅ | Advanced error management |
| Multi-Epic Management | ✅ | Enhanced epic switching |
| Vi Mode | ✅ | Vim-style navigation |
| Focus Management | ✅ | Visual focus indicators |

## ⌨️ Keyboard Shortcuts

### Universal Shortcuts (Both Modes)
| Key | Action | Description |
|-----|--------|-------------|
| `q` | Quit | Exit the application |
| `h` | Help | Show mode-specific help |
| `r` | Refresh | Refresh all data |
| `e` | Epic Switch | Open epic selector |
| `m` | Mode Toggle | Switch between modes |
| `Esc` | Close Overlays | Close help/selectors |

### Interactive Mode Only
| Key | Action | Description |
|-----|--------|-------------|
| `v` | Vi Mode | Toggle vim-style navigation |
| `Tab` | Navigate Sections | Move between UI sections |
| `↑↓` | Navigate Items | Move within sections |
| `Enter` | Select/View | Open item details |
| `Space` | Toggle | Toggle item state |
| `a` | Analytics | Open analytics view |
| `d` | Dependencies | Show dependency graph |

## 💾 Preferences & Persistence

### Automatic Persistence
- Mode selection persists across sessions
- Feature toggles saved immediately
- User preferences stored in `~/.epic-dashboard/preferences.json`
- No manual save required

### Preference Categories

#### Core Mode Settings
```json
{
  "mode": "simple" | "interactive",
  "theme": "default" | "minimal" | "compact",
  "keyboardScheme": "default" | "vim" | "emacs"
}
```

#### Interactive Features
```json
{
  "interactiveFeatures": {
    "taskDetails": true,
    "keyboardNavigation": true,
    "analytics": true,
    "multiEpicManagement": true,
    "errorHandling": true,
    "dependencyVisualization": true
  }
}
```

#### Simple Features
```json
{
  "simpleFeatures": {
    "showProgress": true,
    "showLogs": true,
    "showConfiguration": true,
    "autoRefresh": true,
    "refreshInterval": 2000
  }
}
```

### Data Preservation During Mode Transitions

#### Always Preserved
- Current epic context
- Workflow state
- Log entries
- Configuration data
- Agent status
- Last update timestamp
- User preferences

#### Reset on Mode Switch
- Selected task index
- Selected step index
- Selected log index
- Vi mode state
- Help panel state
- Focus state (interactive → simple)

## 🎨 Visual Indicators

### Mode Indicators
- **Header**: Shows current mode with icon
- **Footer**: Displays mode-specific shortcuts
- **Focus Highlights**: Interactive mode shows visual focus
- **Border Styles**: Enhanced borders in interactive mode

### Transition Feedback
- **Confirmation Dialog**: Shows impact of mode switch
- **Feature Differences**: Lists enabled/disabled features
- **Warnings**: Important notes about changes
- **Progress**: Smooth transitions without data loss

## 🔧 Implementation Details

### Architecture
```
PreferencesService
├── Mode Management
├── Feature Toggles
├── Persistence Layer
└── Change Notifications

ModeUtils
├── Configuration Management
├── Feature Availability
├── Transition Validation
└── Keyboard Shortcuts

Components
├── ModeToggle (Switch Interface)
├── ModeIndicator (Status Display)
├── HelpPanel (Mode-aware Help)
└── Dashboard (Conditional Rendering)
```

### Services Used
- `PreferencesService`: Core preference management
- `ModeUtils`: Mode configuration utilities
- `useMode`: React hook for mode management
- `HelpPanel`: Mode-aware help system

## 🚀 Usage Examples

### Switching to Interactive Mode
1. Press `m` to open mode selection
2. Review feature differences
3. Press `Enter` to confirm
4. All features become available
5. Preferences automatically saved

### Customizing Features
```typescript
// Disable task details in interactive mode
preferencesService.updateNestedPreference(
  'interactiveFeatures', 
  'taskDetails', 
  false
)

// Change refresh interval
preferencesService.updateNestedPreference(
  'simpleFeatures', 
  'refreshInterval', 
  5000
)
```

### Checking Feature Availability
```typescript
const modeHook = useMode()

if (modeHook.shouldShowFeature('taskDetails')) {
  // Render task details component
}

if (modeHook.isInteractiveMode) {
  // Enable keyboard navigation
}
```

## 📊 Backward Compatibility

### Existing Users
- Default mode is **Simple** (preserves current behavior)
- All existing functionality remains unchanged
- No breaking changes to API or commands
- Progressive enhancement approach

### Migration Path
- First-time users: Start in Simple mode
- Discover Interactive mode through help system
- Gradual feature adoption
- Preference persistence prevents data loss

## 🎯 Success Criteria

All implementation requirements have been met:

✅ **Mode switching interface** - `ModeToggle` component with confirmation  
✅ **User preferences persistence** - `PreferencesService` with file storage  
✅ **Seamless transitions** - No data loss during mode switches  
✅ **Preserved functionality** - Simple mode maintains original behavior  
✅ **Enhanced interactive mode** - All new features available  
✅ **Session persistence** - Preferences saved to `~/.epic-dashboard/`  

## 🔍 Testing

### Manual Testing Completed
- ✅ Mode switching works seamlessly
- ✅ Preferences persist across sessions  
- ✅ No data loss during transitions
- ✅ Visual indicators show current mode
- ✅ Keyboard shortcuts work in both modes
- ✅ Help system adapts to current mode

### Test Commands
```bash
# Build and test
bun run build

# Test with sandbox epic
bun run sandbox:init
bun dev sandbox/epic-test

# Test mode switching
# Press 'm' to switch modes
# Press 'h' for mode-specific help
```

## 📝 Future Enhancements

### Planned Features
- Additional themes (dark, high contrast)
- Custom keyboard shortcuts
- Mode-specific layouts
- Export/import preferences
- Advanced analytics in interactive mode

### Potential Modes
- **Expert Mode**: Power user features
- **Minimal Mode**: Ultra-compact display
- **Presentation Mode**: Clean display for demos

---

The Progressive Mode System successfully implements all requirements while maintaining backward compatibility and providing a smooth user experience for both monitoring and interactive use cases.