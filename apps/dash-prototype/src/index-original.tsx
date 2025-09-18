#!/usr/bin/env bun
import { existsSync, readFileSync, watchFile } from 'fs'
import { Box, render, Static, Text, useApp, useFocus, useInput, useStdout } from 'ink'
import Gradient from 'ink-gradient'
import Spinner from 'ink-spinner'
import { join } from 'path'
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { TaskMasterDashboard } from './components/TaskMasterDashboard'

interface WorkflowState {
  epic_name: string
  current_step: number
  completed_steps: number[]
  workflow_config: {
    no_stop: boolean
    max_subagents: number
    use_research: boolean
  }
  agents: {
    required: string[]
    created: string[]
    available: string[]
  }
  artifacts: {
    original_doc: string
    prd: string
    tasks_file: string
    complexity_report: string
  }
  tag_name: string
  timestamp: string
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

// Responsive layout system
interface LayoutBreakpoints {
  xs: number   // Extra small terminals
  sm: number   // Small terminals  
  md: number   // Medium terminals
  lg: number   // Large terminals
  xl: number   // Extra large terminals
}

interface ResponsiveConfig {
  minWidth: number
  minHeight: number
  breakpoints: LayoutBreakpoints
}

interface LayoutDimensions {
  width: number
  height: number
  breakpoint: keyof LayoutBreakpoints
  isVerticalLayout: boolean
  isCompact: boolean
  canShowLogs: boolean
  maxLogLines: number
}

// Design system constants
const RESPONSIVE_CONFIG: ResponsiveConfig = {
  minWidth: 60,
  minHeight: 20,
  breakpoints: {
    xs: 60,   // Minimum supported
    sm: 80,   // Compact layout
    md: 100,  // Standard layout
    lg: 120,  // Comfortable layout
    xl: 140   // Spacious layout
  }
}

const SPACING = {
  xs: 0,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4
} as const

const COLORS = {
  primary: 'cyan',
  secondary: 'magenta', 
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  muted: 'gray',
  accent: 'rainbow'
} as const

const WORKFLOW_STEPS = [
  'Document Validation',
  'Epic Analysis & Setup',
  'Tag Creation & Switching',
  'PRD Generation',
  'Agent Analysis & Creation',
  'Research Decision',
  'Parse PRD to Tasks',
  'Complexity Analysis',
  'Multi-Agent Review',
  'Final Verification',
]

// Focus management enums and types
enum FocusableSection {
  HEADER = 'header',
  PROGRESS = 'progress', 
  WORKFLOW_STEPS = 'workflow-steps',
  TASKMASTER = 'taskmaster',
  CONFIGURATION = 'configuration',
  AGENTS = 'agents',
  LOGS = 'logs',
  FOOTER = 'footer'
}

interface FocusState {
  activeSection: FocusableSection
  selectedStepIndex: number
  selectedLogIndex: number
  selectedTaskMasterIndex: number
  viMode: boolean
  showHelp: boolean
  showTaskDetail: boolean
}

interface NavigationProps {
  isActive: boolean
  isFocused: boolean
}

const FOCUS_COLORS = {
  active: 'cyan',
  focused: 'yellow',
  inactive: 'white'
} as const

// Keyboard shortcuts and navigation
const SHORTCUTS = {
  QUIT: 'q',
  HELP: 'h',
  REFRESH: 'r',
  VI_MODE_TOGGLE: 'v',
  TAB: 'tab',
  SHIFT_TAB: 'shift+tab',
  // Arrow keys
  UP: 'upArrow',
  DOWN: 'downArrow', 
  LEFT: 'leftArrow',
  RIGHT: 'rightArrow',
  // Vi-mode keys
  VI_UP: 'k',
  VI_DOWN: 'j',
  VI_LEFT: 'h',
  VI_RIGHT: 'l'
} as const

// Focus management hook
const useFocusManagement = () => {
  const [focusState, setFocusState] = useState<FocusState>({
    activeSection: FocusableSection.PROGRESS,
    selectedStepIndex: 0,
    selectedLogIndex: 0,
    selectedTaskMasterIndex: 0,
    viMode: false,
    showHelp: false,
    showTaskDetail: false
  })

  const navigateToSection = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    setFocusState(prev => {
      const sections = Object.values(FocusableSection)
      const currentIndex = sections.indexOf(prev.activeSection)
      
      let newIndex = currentIndex
      if (direction === 'up' || direction === 'left') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : sections.length - 1
      } else if (direction === 'down' || direction === 'right') {
        newIndex = currentIndex < sections.length - 1 ? currentIndex + 1 : 0
      }
      
      return {
        ...prev,
        activeSection: sections[newIndex],
        selectedStepIndex: 0,
        selectedLogIndex: 0,
        selectedTaskMasterIndex: 0
      }
    })
  }, [])

  const navigateWithinSection = useCallback((direction: 'up' | 'down', maxItems: number) => {
    setFocusState(prev => {
      const currentIndex = prev.activeSection === FocusableSection.WORKFLOW_STEPS
        ? prev.selectedStepIndex
        : prev.selectedLogIndex
      
      let newIndex = currentIndex
      if (direction === 'up') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1
      } else if (direction === 'down') {
        newIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0
      }
      
      if (prev.activeSection === FocusableSection.WORKFLOW_STEPS) {
        return { ...prev, selectedStepIndex: newIndex }
      } else if (prev.activeSection === FocusableSection.LOGS) {
        return { ...prev, selectedLogIndex: newIndex }
      } else if (prev.activeSection === FocusableSection.TASKMASTER) {
        return { ...prev, selectedTaskMasterIndex: newIndex }
      }
      
      return prev
    })
  }, [])

  const toggleViMode = useCallback(() => {
    setFocusState(prev => ({ ...prev, viMode: !prev.viMode }))
  }, [])

  const toggleHelp = useCallback(() => {
    setFocusState(prev => ({ ...prev, showHelp: !prev.showHelp }))
  }, [])

  const toggleTaskDetail = useCallback(() => {
    setFocusState(prev => ({ ...prev, showTaskDetail: !prev.showTaskDetail }))
  }, [])

  return {
    focusState,
    navigateToSection,
    navigateWithinSection,
    toggleViMode,
    toggleHelp,
    toggleTaskDetail
  }
}

// Focusable component wrapper
interface FocusableBoxProps extends ResponsiveBoxProps {
  isFocused: boolean
  isSelected?: boolean
  focusable?: boolean
}

const FocusableBox: React.FC<FocusableBoxProps> = ({ 
  children, 
  isFocused, 
  isSelected = false,
  focusable = true,
  borderStyle,
  borderColor,
  ...props 
}) => {
  // Enhanced visual focus indicators
  const finalBorderStyle = focusable ? (isFocused ? 'bold' : borderStyle || 'single') : borderStyle
  const finalBorderColor = focusable 
    ? (isFocused ? FOCUS_COLORS.focused : (isSelected ? FOCUS_COLORS.active : borderColor))
    : borderColor

  return (
    <ResponsiveBox
      {...props}
      borderStyle={finalBorderStyle}
      borderColor={finalBorderColor}
    >
      {children}
    </ResponsiveBox>
  )
}

// Help system component
const HelpOverlay: React.FC<{ layout: LayoutDimensions; onClose: () => void }> = ({ layout, onClose }) => {
  const helpContent = [
    { category: 'Navigation', shortcuts: [
      ['↑/↓ or k/j', 'Navigate sections/items'],
      ['←/→ or h/l', 'Navigate between panels'],
      ['Tab/Shift+Tab', 'Cycle through sections'],
      ['Enter', 'Select/activate item']
    ]},
    { category: 'General', shortcuts: [
      ['q', 'Quit application'],
      ['h', 'Toggle this help'],
      ['r', 'Refresh data'],
      ['v', 'Toggle Vi-mode navigation']
    ]},
    { category: 'Vi-Mode', shortcuts: [
      ['j/k', 'Down/Up navigation'],
      ['h/l', 'Left/Right navigation'],
      ['g/G', 'Go to first/last item'],
      ['/', 'Search (future feature)']
    ]}
  ]

  return (
    <Box
      position="absolute"
      top={Math.floor((layout.height - 20) / 2)}
      left={Math.floor((layout.width - 60) / 2)}
      width={Math.min(60, layout.width - 4)}
      height={Math.min(20, layout.height - 4)}
      borderStyle="double"
      borderColor="cyan"
      backgroundColor="black"
      flexDirection="column"
      padding={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">KEYBOARD SHORTCUTS</Text>
      </Box>
      
      {helpContent.map((section, sectionIndex) => (
        <Box key={sectionIndex} flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">{section.category}:</Text>
          {section.shortcuts.map((shortcut, shortcutIndex) => (
            <Box key={shortcutIndex} flexDirection="row" marginLeft={2}>
              <Text bold color="white" minWidth={12}>{shortcut[0]}</Text>
              <Text dimColor>{shortcut[1]}</Text>
            </Box>
          ))}
        </Box>
      ))}
      
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>Press 'h' or 'Esc' to close</Text>
      </Box>
    </Box>
  )
}

// Status indicator component
const StatusIndicator: React.FC<{ viMode: boolean; activeSection: string }> = ({ viMode, activeSection }) => (
  <Box flexDirection="row" justifyContent="space-between">
    <Text dimColor>
      Mode: {viMode ? (
        <Text color="green">Vi</Text>
      ) : (
        <Text color="blue">Normal</Text>
      )}
    </Text>
    <Text dimColor>
      Focus: <Text color="yellow">{activeSection}</Text>
    </Text>
  </Box>
)

// Responsive layout utilities
const useResponsiveLayout = (): LayoutDimensions => {
  const { stdout } = useStdout()
  
  return useMemo(() => {
    const width = stdout?.columns || 80
    const height = stdout?.rows || 24
    
    // Determine breakpoint
    let breakpoint: keyof LayoutBreakpoints = 'xs'
    if (width >= RESPONSIVE_CONFIG.breakpoints.xl) breakpoint = 'xl'
    else if (width >= RESPONSIVE_CONFIG.breakpoints.lg) breakpoint = 'lg'
    else if (width >= RESPONSIVE_CONFIG.breakpoints.md) breakpoint = 'md'
    else if (width >= RESPONSIVE_CONFIG.breakpoints.sm) breakpoint = 'sm'
    
    // Layout decisions based on terminal size
    const isVerticalLayout = width < RESPONSIVE_CONFIG.breakpoints.md || height < 25
    const isCompact = width < RESPONSIVE_CONFIG.breakpoints.sm
    const canShowLogs = height >= 30 && width >= RESPONSIVE_CONFIG.breakpoints.sm
    const maxLogLines = Math.max(3, Math.min(8, Math.floor((height - 20) / 2)))
    
    return {
      width,
      height,
      breakpoint,
      isVerticalLayout,
      isCompact,
      canShowLogs,
      maxLogLines
    }
  }, [stdout?.columns, stdout?.rows])
}

const getResponsiveSpacing = (breakpoint: keyof LayoutBreakpoints): number => {
  switch (breakpoint) {
    case 'xs': return SPACING.xs
    case 'sm': return SPACING.sm
    case 'md': return SPACING.md
    case 'lg': return SPACING.lg
    case 'xl': return SPACING.xl
    default: return SPACING.sm
  }
}

const getResponsivePadding = (breakpoint: keyof LayoutBreakpoints): { paddingX: number; paddingY: number } => {
  const base = getResponsiveSpacing(breakpoint)
  return {
    paddingX: Math.max(1, base),
    paddingY: Math.max(0, Math.floor(base / 2))
  }
}

// Responsive components
interface ResponsiveBoxProps {
  children: React.ReactNode
  layout: LayoutDimensions
  width?: string | number
  borderStyle?: 'single' | 'double' | 'round' | 'bold'
  borderColor?: string
  flexDirection?: 'row' | 'column'
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
}

const ResponsiveBox: React.FC<ResponsiveBoxProps> = ({ 
  children, 
  layout, 
  width,
  borderStyle,
  borderColor,
  flexDirection = 'column',
  marginTop,
  marginBottom,
  marginLeft,
  marginRight
}) => {
  const padding = getResponsivePadding(layout.breakpoint)
  const spacing = getResponsiveSpacing(layout.breakpoint)
  
  return (
    <Box
      flexDirection={flexDirection}
      width={width}
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={borderStyle ? padding.paddingX : 0}
      paddingY={borderStyle ? padding.paddingY : 0}
      marginTop={marginTop ?? spacing}
      marginBottom={marginBottom}
      marginLeft={marginLeft}
      marginRight={marginRight}
    >
      {children}
    </Box>
  )
}

const Dashboard: React.FC<{ epicFolder: string }> = ({ epicFolder }) => {
  const { exit } = useApp()
  const layout = useResponsiveLayout()
  const [state, setState] = useState<WorkflowState | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  
  // Focus management
  const { focusState, navigateToSection, navigateWithinSection, toggleViMode, toggleHelp, toggleTaskDetail } = useFocusManagement()

  // Enhanced keyboard input handling
  useInput((input, key) => {
    // Help system
    if (input === SHORTCUTS.HELP || key.escape) {
      if (focusState.showHelp) {
        toggleHelp()
      } else {
        toggleHelp()
      }
      return
    }

    // If help is open, close it on any other key except specific ones
    if (focusState.showHelp) {
      return
    }

    // If task detail view is open, let it handle input
    if (focusState.showTaskDetail) {
      return
    }

    // Global shortcuts
    if (input === SHORTCUTS.QUIT || (key.ctrl && input === 'c')) {
      exit()
      return
    }

    if (input === SHORTCUTS.REFRESH) {
      loadState()
      loadLogs()
      setLastUpdate(new Date())
      return
    }

    if (input === SHORTCUTS.VI_MODE_TOGGLE) {
      toggleViMode()
      return
    }

    // Navigation handling
    const isViMode = focusState.viMode
    const maxSteps = WORKFLOW_STEPS.length
    const maxLogs = logs.length
    const maxTaskMasterItems = 10 // Default max items for TaskMaster tasks

    // Tab navigation
    if (key.tab) {
      if (key.shift) {
        navigateToSection('up')
      } else {
        navigateToSection('down')
      }
      return
    }

    // Arrow key and Vi-mode navigation
    const isUpPressed = key.upArrow || (isViMode && input === SHORTCUTS.VI_UP)
    const isDownPressed = key.downArrow || (isViMode && input === SHORTCUTS.VI_DOWN)
    const isLeftPressed = key.leftArrow || (isViMode && input === SHORTCUTS.VI_LEFT)
    const isRightPressed = key.rightArrow || (isViMode && input === SHORTCUTS.VI_RIGHT)

    if (isUpPressed || isDownPressed) {
      const direction = isUpPressed ? 'up' : 'down'
      
      // Navigate within sections that have multiple items
      if (focusState.activeSection === FocusableSection.WORKFLOW_STEPS && maxSteps > 0) {
        navigateWithinSection(direction, maxSteps)
      } else if (focusState.activeSection === FocusableSection.LOGS && maxLogs > 0) {
        navigateWithinSection(direction, maxLogs)
      } else if (focusState.activeSection === FocusableSection.TASKMASTER && maxTaskMasterItems > 0) {
        navigateWithinSection(direction, maxTaskMasterItems)
      } else {
        // Navigate between sections
        navigateToSection(direction)
      }
    }

    if (isLeftPressed || isRightPressed) {
      const direction = isLeftPressed ? 'left' : 'right'
      navigateToSection(direction)
    }

    // Enter key for task selection in TaskMaster section
    if (key.return && focusState.activeSection === FocusableSection.TASKMASTER) {
      toggleTaskDetail()
    }
  })

  // Check if terminal is too small
  const isTerminalTooSmall = layout.width < RESPONSIVE_CONFIG.minWidth || layout.height < RESPONSIVE_CONFIG.minHeight

  const loadState = () => {
    try {
      const statePath = join(epicFolder, 'workflow-state.json')
      if (existsSync(statePath)) {
        const data = JSON.parse(readFileSync(statePath, 'utf-8'))
        setState(data)
        setError(null)
      } else {
        setError('Workflow state not found')
      }
    } catch (err) {
      setError(`Failed to load state: ${err}`)
    }
  }

  const loadLogs = () => {
    try {
      const logPath = join(epicFolder, 'workflow.log')
      if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, 'utf-8')
        const logLines = logContent.split('\n').filter(l => l.trim())
        const parsedLogs = logLines.slice(-20).map(line => {
          const match = line.match(/^\[(.*?)\] \[(.*?)\] (.*)$/)
          if (match) {
            return {
              timestamp: match[1],
              level: match[2].toLowerCase() as LogEntry['level'],
              message: match[3],
            }
          }
          return {
            timestamp: new Date().toISOString(),
            level: 'info' as LogEntry['level'],
            message: line,
          }
        })
        setLogs(parsedLogs)
      }
    } catch (err) {
      // Silent fail for logs
    }
  }

  useEffect(() => {
    loadState()
    loadLogs()
    setLastUpdate(new Date())

    const statePath = join(epicFolder, 'workflow-state.json')
    const logPath = join(epicFolder, 'workflow.log')

    if (existsSync(statePath)) {
      watchFile(statePath, { interval: 1000 }, () => {
        loadState()
        setLastUpdate(new Date())
      })
    }

    if (existsSync(logPath)) {
      watchFile(logPath, { interval: 500 }, () => {
        loadLogs()
      })
    }

    const interval = setInterval(() => {
      loadState()
      loadLogs()
      setLastUpdate(new Date())
    }, 2000)

    return () => clearInterval(interval)
  }, [epicFolder])

  // Handle terminal too small
  if (isTerminalTooSmall) {
    return (
      <Box flexDirection='column'>
        <ResponsiveBox layout={layout} borderStyle='round' borderColor={COLORS.error}>
          <Text color={COLORS.error}>📏 Terminal Too Small</Text>
          <Text>Minimum size: {RESPONSIVE_CONFIG.minWidth}x{RESPONSIVE_CONFIG.minHeight}</Text>
          <Text>Current size: {layout.width}x{layout.height}</Text>
        </ResponsiveBox>
        <ResponsiveBox layout={layout}>
          <Text dimColor>Press 'q' to quit</Text>
        </ResponsiveBox>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection='column'>
        <ResponsiveBox layout={layout} borderStyle='round' borderColor={COLORS.error}>
          <Text color={COLORS.error}>❌ {error}</Text>
        </ResponsiveBox>
        <ResponsiveBox layout={layout}>
          <Text dimColor>Folder: {epicFolder}</Text>
        </ResponsiveBox>
        <ResponsiveBox layout={layout}>
          <Text dimColor>Press 'q' to quit</Text>
        </ResponsiveBox>
      </Box>
    )
  }

  if (!state) {
    return (
      <Box flexDirection='column' alignItems='center'>
        <ResponsiveBox layout={layout}>
          <Box flexDirection='row' alignItems='center'>
            <Spinner type='dots' />
            <Text> Loading epic state...</Text>
          </Box>
        </ResponsiveBox>
      </Box>
    )
  }

  const progressPercentage = Math.round((state.completed_steps.length / WORKFLOW_STEPS.length) * 100)
  const progressBar = '█'.repeat(Math.floor(progressPercentage / 5))
    + '░'.repeat(20 - Math.floor(progressPercentage / 5))

  const getStepSymbol = (index: number) => {
    if (state.completed_steps.includes(index + 1)) return '✅'
    if (state.current_step === index + 1) return '⏳'
    return '⭕'
  }

  const getLogColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'success':
        return 'green'
      case 'warning':
        return 'yellow'
      case 'error':
        return 'red'
      default:
        return 'white'
    }
  }

  return (
    <Box flexDirection='column'>
      {/* Header - Responsive Epic Name */}
      <FocusableBox 
        layout={layout} 
        marginBottom={getResponsiveSpacing(layout.breakpoint)}
        isFocused={focusState.activeSection === FocusableSection.HEADER}
        focusable={false}
      >
        <Box flexDirection='column' alignItems='center'>
          {layout.breakpoint !== 'xs' ? (
            // Full gradient header for larger terminals
            <>
              <Gradient name={COLORS.accent}>
                <Text bold>╔{'═'.repeat(Math.min(state.epic_name.length + 4, layout.width - 10))}╗</Text>
              </Gradient>
              <Gradient name={COLORS.accent}>
                <Text bold>║ {state.epic_name.toUpperCase().padEnd(Math.min(state.epic_name.length + 2, layout.width - 12))} ║</Text>
              </Gradient>
              <Gradient name={COLORS.accent}>
                <Text bold>╚{'═'.repeat(Math.min(state.epic_name.length + 4, layout.width - 10))}╝</Text>
              </Gradient>
            </>
          ) : (
            // Compact header for small terminals
            <Text bold color={COLORS.primary}>🚀 {state.epic_name.toUpperCase()}</Text>
          )}
        </Box>
      </FocusableBox>

      {/* Progress Bar - Always visible */}
      <FocusableBox 
        layout={layout} 
        borderStyle='round' 
        borderColor={COLORS.primary}
        isFocused={focusState.activeSection === FocusableSection.PROGRESS}
      >
        <Box flexDirection='column'>
          <Box flexDirection='row' justifyContent='space-between'>
            <Text bold>Progress:</Text>
            <Text color={COLORS.primary}>{progressPercentage}%</Text>
          </Box>
          {!layout.isCompact && (
            <Box marginTop={1}>
              <Text color={COLORS.primary}>[{progressBar}]</Text>
            </Box>
          )}
          <Box marginTop={layout.isCompact ? 0 : 1}>
            <Text dimColor>Step {state.current_step} of {WORKFLOW_STEPS.length}</Text>
          </Box>
        </Box>
      </FocusableBox>

      {/* Workflow Steps - Adaptive height */}
      <FocusableBox 
        layout={layout} 
        borderStyle='single' 
        borderColor='white'
        isFocused={focusState.activeSection === FocusableSection.WORKFLOW_STEPS}
      >
        <Text bold underline>Workflow Steps:</Text>
        <Box flexDirection='column' marginTop={1}>
          {WORKFLOW_STEPS.map((step, index) => {
            // In compact mode, only show current and completed steps
            if (layout.isCompact && !state.completed_steps.includes(index + 1) && state.current_step !== index + 1) {
              return null
            }
            
            const isSelected = focusState.activeSection === FocusableSection.WORKFLOW_STEPS 
              && focusState.selectedStepIndex === index
            
            return (
              <Box 
                key={index} 
                flexDirection='row'
                backgroundColor={isSelected ? 'gray' : undefined}
              >
                <Text>{getStepSymbol(index)} </Text>
                <Text
                  color={
                    isSelected 
                      ? FOCUS_COLORS.focused
                      : state.current_step === index + 1
                      ? COLORS.warning
                      : state.completed_steps.includes(index + 1)
                      ? COLORS.success
                      : COLORS.muted
                  }
                >
                  {layout.isCompact && step.length > 30 ? step.substring(0, 27) + '...' : step}
                </Text>
              </Box>
            )
          })}
        </Box>
      </FocusableBox>

      {/* TaskMaster Integration - Conditional rendering based on terminal size */}
      {!layout.isCompact && (
        <FocusableBox 
          layout={layout} 
          borderStyle='single' 
          borderColor='cyan'
          isFocused={focusState.activeSection === FocusableSection.TASKMASTER}
        >
          <TaskMasterDashboard
            compact={layout.isCompact}
            maxTasks={layout.maxLogLines}
            showComplexity={true}
            showDependencies={false}
            selectedTaskIndex={focusState.selectedTaskMasterIndex}
            focusSection={focusState.activeSection === FocusableSection.TASKMASTER ? 'tasks' : undefined}
            showDetailView={focusState.showTaskDetail}
          />
        </FocusableBox>
      )}

      {/* Configuration and Agents - Responsive layout */}
      <Box flexDirection={layout.isVerticalLayout ? 'column' : 'row'}>
        {/* Configuration */}
        <FocusableBox 
          layout={layout} 
          borderStyle='single' 
          borderColor={COLORS.secondary}
          width={layout.isVerticalLayout ? '100%' : '50%'}
          isFocused={focusState.activeSection === FocusableSection.CONFIGURATION}
        >
          <Text bold underline>Configuration:</Text>
          <Box flexDirection='column' marginTop={1}>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>Research:</Text>
              <Text color={state.workflow_config?.use_research ? COLORS.success : COLORS.muted}>
                {state.workflow_config?.use_research ? '✓' : '✗'}
              </Text>
            </Box>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>No Stop:</Text>
              <Text color={state.workflow_config?.no_stop ? COLORS.success : COLORS.muted}>
                {state.workflow_config?.no_stop ? '✓' : '✗'}
              </Text>
            </Box>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>Max Agents:</Text>
              <Text color={COLORS.primary}>{state.workflow_config?.max_subagents || 9}</Text>
            </Box>
          </Box>
        </FocusableBox>

        {/* Agents Status */}
        <FocusableBox 
          layout={layout} 
          borderStyle='single' 
          borderColor={COLORS.warning}
          width={layout.isVerticalLayout ? '100%' : '50%'}
          marginLeft={layout.isVerticalLayout ? 0 : getResponsiveSpacing(layout.breakpoint)}
          marginTop={layout.isVerticalLayout ? getResponsiveSpacing(layout.breakpoint) : 0}
          isFocused={focusState.activeSection === FocusableSection.AGENTS}
        >
          <Text bold underline>Agents:</Text>
          <Box flexDirection='column' marginTop={1}>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>Required:</Text>
              <Text color={COLORS.primary}>{state.agents?.required?.length || 0}</Text>
            </Box>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>Available:</Text>
              <Text color={COLORS.success}>{state.agents?.available?.length || 0}</Text>
            </Box>
            <Box flexDirection='row' justifyContent='space-between'>
              <Text>Created:</Text>
              <Text color={COLORS.warning}>{state.agents?.created?.length || 0}</Text>
            </Box>
          </Box>
        </FocusableBox>
      </Box>

      {/* Recent Logs - Only show if there's space */}
      {layout.canShowLogs && (
        <FocusableBox 
          layout={layout} 
          borderStyle='single' 
          borderColor={COLORS.info}
          isFocused={focusState.activeSection === FocusableSection.LOGS}
        >
          <Text bold underline>Recent Activity:</Text>
          <Box flexDirection='column' marginTop={1} height={layout.maxLogLines}>
            {logs.slice(-layout.maxLogLines).map((log, index) => {
              const isSelected = focusState.activeSection === FocusableSection.LOGS 
                && focusState.selectedLogIndex === index
              
              return (
                <Box 
                  key={index} 
                  flexDirection='row'
                  backgroundColor={isSelected ? 'gray' : undefined}
                >
                  <Text dimColor>[{log.timestamp.split('T')[1]?.split('.')[0] || ''}] </Text>
                  <Text color={isSelected ? FOCUS_COLORS.focused : getLogColor(log.level)}>
                    {layout.isCompact && log.message.length > 40 
                      ? log.message.substring(0, 37) + '...' 
                      : log.message}
                  </Text>
                </Box>
              )
            })}
          </Box>
        </FocusableBox>
      )}

      {/* TaskMaster Compact Status - Only in compact mode */}
      {layout.isCompact && (
        <FocusableBox 
          layout={layout} 
          borderStyle='round' 
          borderColor='cyan'
          isFocused={focusState.activeSection === FocusableSection.TASKMASTER}
        >
          <TaskMasterDashboard
            compact={true}
            maxTasks={3}
            showComplexity={false}
            showDependencies={false}
            focusSection={focusState.activeSection === FocusableSection.TASKMASTER ? 'status' : undefined}
            showDetailView={focusState.showTaskDetail}
          />
        </FocusableBox>
      )}

      {/* Footer - Adaptive */}
      <FocusableBox 
        layout={layout}
        isFocused={focusState.activeSection === FocusableSection.FOOTER}
        focusable={false}
      >
        <Box flexDirection={layout.isCompact ? 'column' : 'row'} justifyContent='space-between'>
          <Text dimColor>Updated: {lastUpdate.toLocaleTimeString()}</Text>
          <Text dimColor>
            {layout.breakpoint !== 'xs' ? 'q=quit • h=help • r=refresh • v=vi' : 'q=quit • h=help'}
          </Text>
          {layout.breakpoint === 'xs' && (
            <Text dimColor>Size: {layout.width}x{layout.height}</Text>
          )}
        </Box>
        
        {/* Status indicator */}
        {!layout.isCompact && (
          <Box marginTop={1}>
            <StatusIndicator 
              viMode={focusState.viMode} 
              activeSection={focusState.activeSection} 
            />
          </Box>
        )}
      </FocusableBox>

      {/* Help overlay */}
      {focusState.showHelp && (
        <HelpOverlay layout={layout} onClose={toggleHelp} />
      )}
    </Box>
  )
}

// Status command - prints once and exits
const printStatus = (epicFolder: string, jsonMode: boolean = false) => {
  try {
    const statePath = join(epicFolder, 'workflow-state.json')
    if (!existsSync(statePath)) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'Workflow state not found' }, null, 2))
      } else {
        console.error('❌ Workflow state not found')
      }
      process.exit(1)
    }

    const state: WorkflowState = JSON.parse(readFileSync(statePath, 'utf-8'))
    const progressPercentage = Math.round((state.completed_steps.length / WORKFLOW_STEPS.length) * 100)

    if (jsonMode) {
      const jsonOutput = {
        epic_name: state.epic_name,
        progress: {
          percentage: progressPercentage,
          current_step: state.current_step,
          total_steps: WORKFLOW_STEPS.length,
          completed_steps: state.completed_steps,
        },
        workflow_config: state.workflow_config,
        agents: state.agents,
        artifacts: state.artifacts,
        tag_name: state.tag_name,
        timestamp: state.timestamp,
        status: progressPercentage === 100 ? 'completed' : 'in-progress',
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else {
      // ASCII output
      const progressBar = '█'.repeat(Math.floor(progressPercentage / 5))
        + '░'.repeat(20 - Math.floor(progressPercentage / 5))

      console.log(`\n╔═══════════════════════════════════════════════════════════════╗`)
      console.log(`║                     EPIC STATUS REPORT                       ║`)
      console.log(`╠═══════════════════════════════════════════════════════════════╣`)
      console.log(`║ Epic: ${state.epic_name.padEnd(53)} ║`)
      console.log(
        `║ Progress: [${progressBar}] ${progressPercentage}%${(' '.repeat(
          19 - progressPercentage.toString().length,
        ))} ║`,
      )
      console.log(`║ Step: ${state.current_step} of ${WORKFLOW_STEPS.length}${' '.repeat(47)} ║`)
      console.log(`║ Tag: ${state.tag_name.padEnd(54)} ║`)
      console.log(`╠═══════════════════════════════════════════════════════════════╣`)
      console.log(`║ Configuration:                                                ║`)
      console.log(`║   Research: ${(state.workflow_config?.use_research ? '✓ Enabled' : '✗ Disabled').padEnd(44)} ║`)
      console.log(`║   No Stop: ${(state.workflow_config?.no_stop ? '✓ Enabled' : '✗ Disabled').padEnd(45)} ║`)
      console.log(`║   Max Agents: ${(state.workflow_config?.max_subagents || 9).toString().padEnd(42)} ║`)
      console.log(`╠═══════════════════════════════════════════════════════════════╣`)
      console.log(`║ Agents:                                                       ║`)
      console.log(`║   Required: ${(state.agents?.required?.length || 0).toString().padEnd(46)} ║`)
      console.log(`║   Available: ${(state.agents?.available?.length || 0).toString().padEnd(45)} ║`)
      console.log(`║   Created: ${(state.agents?.created?.length || 0).toString().padEnd(47)} ║`)
      console.log(`╠═══════════════════════════════════════════════════════════════╣`)
      console.log(`║ Workflow Steps:                                               ║`)

      WORKFLOW_STEPS.forEach((step, index) => {
        const symbol = state.completed_steps.includes(index + 1)
          ? '✅'
          : state.current_step === index + 1
          ? '⏳'
          : '⭕'
        const truncatedStep = step.length > 45 ? step.substring(0, 42) + '...' : step
        console.log(`║   ${symbol} ${(index + 1).toString().padStart(2)}: ${truncatedStep.padEnd(45)} ║`)
      })

      console.log(`╠═══════════════════════════════════════════════════════════════╣`)
      console.log(`║ Status: ${(progressPercentage === 100 ? '✅ COMPLETED' : '⏳ IN PROGRESS').padEnd(51)} ║`)
      console.log(`║ Last Updated: ${new Date(state.timestamp).toLocaleString().padEnd(42)} ║`)
      console.log(`╚═══════════════════════════════════════════════════════════════╝\n`)
    }
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: `Failed to load state: ${err}` }, null, 2))
    } else {
      console.error(`❌ Failed to load state: ${err}`)
    }
    process.exit(1)
  }
}

// Main entry point
const args = process.argv.slice(2)
const command = args[0]

// Handle command modes
if (command === 'status') {
  const epicFolder = args[1]
  const jsonFlag = args.includes('--json') || args.includes('-j')

  if (!epicFolder) {
    console.error('Usage: epic-dashboard status <epic-folder> [--json|-j]')
    process.exit(1)
  }

  if (!existsSync(epicFolder)) {
    console.error(`Epic folder not found: ${epicFolder}`)
    process.exit(1)
  }

  printStatus(epicFolder, jsonFlag)
  process.exit(0)
}

// Default interactive mode
const epicFolder = command

if (!epicFolder) {
  console.error('Usage: epic-dashboard <epic-folder> | epic-dashboard status <epic-folder> [--json]')
  console.error('')
  console.error('Commands:')
  console.error('  <epic-folder>              Interactive dashboard (default)')
  console.error('  status <epic-folder>       Print status once and exit')
  console.error('  status <epic-folder> --json   Print status as JSON')
  process.exit(1)
}

if (!existsSync(epicFolder)) {
  console.error(`Epic folder not found: ${epicFolder}`)
  process.exit(1)
}

// Clear console before starting interactive mode
console.clear()

render(<Dashboard epicFolder={epicFolder} />, {
  // Exit on Ctrl+C
  exitOnCtrlC: true,
})
