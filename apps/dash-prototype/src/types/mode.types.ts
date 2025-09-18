import { DashboardMode } from '../services/preferences.service'

/**
 * Mode-specific configuration interface
 */
export interface ModeConfig {
  mode: DashboardMode
  displayName: string
  description: string
  icon: string
  features: FeatureSet
  keyboardShortcuts: KeyboardShortcut[]
  layoutOptions: LayoutOptions
}

/**
 * Feature availability configuration
 */
export interface FeatureSet {
  // Core features (always available)
  epicContext: boolean
  workflowProgress: boolean
  configurationDisplay: boolean
  
  // Enhanced features (interactive mode only)
  keyboardNavigation: boolean
  taskDetails: boolean
  taskActions: boolean
  epicSwitching: boolean
  dependencyVisualization: boolean
  analytics: boolean
  errorHandling: boolean
  helpSystem: boolean
  
  // Display features
  logs: boolean
  agentStatus: boolean
  multiEpicManagement: boolean
  
  // Advanced features
  viMode: boolean
  focusManagement: boolean
  responsiveLayout: boolean
}

/**
 * Layout configuration for different modes
 */
export interface LayoutOptions {
  showTitleBorder: boolean
  showSectionBorders: boolean
  useCompactSpacing: boolean
  maxLogLines: number
  showAnimations: boolean
  enableGradients: boolean
  responsiveBreakpoints: boolean
}

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  key: string
  description: string
  action: string
  available: boolean
}

/**
 * Mode transition configuration
 */
export interface ModeTransition {
  from: DashboardMode
  to: DashboardMode
  preserveState: string[]
  resetState: string[]
  warnings: string[]
}

/**
 * Predefined mode configurations
 */
export const MODE_CONFIGS: Record<DashboardMode, ModeConfig> = {
  [DashboardMode.SIMPLE]: {
    mode: DashboardMode.SIMPLE,
    displayName: 'Simple Mode',
    description: 'Passive monitoring with essential information',
    icon: '👁️',
    features: {
      // Core features
      epicContext: true,
      workflowProgress: true,
      configurationDisplay: true,
      
      // Enhanced features - disabled in simple mode
      keyboardNavigation: false,
      taskDetails: false,
      taskActions: false,
      epicSwitching: true, // Keep basic epic switching
      dependencyVisualization: false,
      analytics: false,
      errorHandling: false,
      helpSystem: true, // Keep basic help
      
      // Display features
      logs: true,
      agentStatus: true,
      multiEpicManagement: false,
      
      // Advanced features - disabled
      viMode: false,
      focusManagement: false,
      responsiveLayout: true
    },
    keyboardShortcuts: [
      { key: 'q', description: 'Quit', action: 'quit', available: true },
      { key: 'h', description: 'Help', action: 'help', available: true },
      { key: 'r', description: 'Refresh', action: 'refresh', available: true },
      { key: 'e', description: 'Switch Epic', action: 'epic-switch', available: true },
      { key: 'm', description: 'Switch to Interactive Mode', action: 'mode-toggle', available: true }
    ],
    layoutOptions: {
      showTitleBorder: true,
      showSectionBorders: true,
      useCompactSpacing: false,
      maxLogLines: 5,
      showAnimations: true,
      enableGradients: true,
      responsiveBreakpoints: true
    }
  },
  
  [DashboardMode.INTERACTIVE]: {
    mode: DashboardMode.INTERACTIVE,
    displayName: 'Interactive Mode',
    description: 'Full feature set with keyboard navigation and task management',
    icon: '⚡',
    features: {
      // Core features
      epicContext: true,
      workflowProgress: true,
      configurationDisplay: true,
      
      // Enhanced features - all enabled
      keyboardNavigation: true,
      taskDetails: true,
      taskActions: true,
      epicSwitching: true,
      dependencyVisualization: true,
      analytics: true,
      errorHandling: true,
      helpSystem: true,
      
      // Display features
      logs: true,
      agentStatus: true,
      multiEpicManagement: true,
      
      // Advanced features
      viMode: true,
      focusManagement: true,
      responsiveLayout: true
    },
    keyboardShortcuts: [
      { key: 'q', description: 'Quit', action: 'quit', available: true },
      { key: 'h', description: 'Help', action: 'help', available: true },
      { key: 'r', description: 'Refresh', action: 'refresh', available: true },
      { key: 'e', description: 'Switch Epic', action: 'epic-switch', available: true },
      { key: 'm', description: 'Switch to Simple Mode', action: 'mode-toggle', available: true },
      { key: 'v', description: 'Toggle Vi Mode', action: 'vi-toggle', available: true },
      { key: 'tab', description: 'Navigate Sections', action: 'nav-section', available: true },
      { key: '↑↓', description: 'Navigate Items', action: 'nav-items', available: true },
      { key: 'enter', description: 'Select/View Details', action: 'select-item', available: true },
      { key: 'space', description: 'Toggle Item', action: 'toggle-item', available: true },
      { key: 'a', description: 'Analytics View', action: 'analytics', available: true },
      { key: 'd', description: 'Dependencies', action: 'dependencies', available: true }
    ],
    layoutOptions: {
      showTitleBorder: true,
      showSectionBorders: true,
      useCompactSpacing: false,
      maxLogLines: 8,
      showAnimations: true,
      enableGradients: true,
      responsiveBreakpoints: true
    }
  },

  [DashboardMode.ANALYTICS]: {
    mode: DashboardMode.ANALYTICS,
    displayName: 'Analytics Mode',
    description: 'Dedicated analytics dashboard with comprehensive data visualization',
    icon: '📊',
    features: {
      // Core features
      epicContext: true,
      workflowProgress: true,
      configurationDisplay: false, // Hide configuration in analytics mode
      
      // Enhanced features
      keyboardNavigation: true,
      taskDetails: false, // Focus on analytics, not individual task details
      taskActions: false,
      epicSwitching: true,
      dependencyVisualization: true,
      analytics: true, // Main feature
      errorHandling: true,
      helpSystem: true,
      
      // Display features
      logs: false, // Hide logs in analytics mode
      agentStatus: false, // Hide agent status
      multiEpicManagement: true,
      
      // Advanced features
      viMode: true,
      focusManagement: true,
      responsiveLayout: true
    },
    keyboardShortcuts: [
      { key: 'q', description: 'Quit', action: 'quit', available: true },
      { key: 'h', description: 'Help', action: 'help', available: true },
      { key: 'r', description: 'Refresh Analytics', action: 'refresh', available: true },
      { key: 'e', description: 'Switch Epic', action: 'epic-switch', available: true },
      { key: 'm', description: 'Switch to Simple Mode', action: 'mode-toggle', available: true },
      { key: '1-7', description: 'Switch Analytics Views', action: 'analytics-nav', available: true },
      { key: '↑↓', description: 'Navigate Views', action: 'nav-items', available: true },
      { key: 'c', description: 'Clear Cache', action: 'clear-cache', available: true },
      { key: 't', description: 'Toggle Export Format', action: 'toggle-format', available: true },
      { key: 'esc', description: 'Exit Analytics', action: 'exit-analytics', available: true }
    ],
    layoutOptions: {
      showTitleBorder: true,
      showSectionBorders: true,
      useCompactSpacing: true, // More compact for analytics
      maxLogLines: 0, // No logs in analytics mode
      showAnimations: false, // Disable animations for better performance
      enableGradients: true,
      responsiveBreakpoints: true
    }
  }
}

/**
 * Mode transition definitions
 */
export const MODE_TRANSITIONS: ModeTransition[] = [
  {
    from: DashboardMode.SIMPLE,
    to: DashboardMode.INTERACTIVE,
    preserveState: [
      'currentEpic',
      'workflowState',
      'logs',
      'configuration',
      'agents',
      'lastUpdate'
    ],
    resetState: [
      'selectedTaskIndex',
      'selectedStepIndex',
      'selectedLogIndex',
      'viMode',
      'showHelp'
    ],
    warnings: [
      'Interactive mode enables keyboard navigation',
      'Additional features will be available',
      'More keyboard shortcuts will be active'
    ]
  },
  {
    from: DashboardMode.INTERACTIVE,
    to: DashboardMode.SIMPLE,
    preserveState: [
      'currentEpic',
      'workflowState',
      'logs',
      'configuration',
      'agents',
      'lastUpdate'
    ],
    resetState: [
      'selectedTaskIndex',
      'selectedStepIndex',
      'selectedLogIndex',
      'viMode',
      'showHelp',
      'focusState'
    ],
    warnings: [
      'Advanced features will be disabled',
      'Keyboard navigation will be limited',
      'Task management features will be hidden'
    ]
  },
  {
    from: DashboardMode.INTERACTIVE,
    to: DashboardMode.ANALYTICS,
    preserveState: [
      'currentEpic',
      'workflowState',
      'configuration',
      'agents',
      'lastUpdate'
    ],
    resetState: [
      'selectedTaskIndex',
      'selectedStepIndex',
      'selectedLogIndex',
      'logs'
    ],
    warnings: [
      'Switching to analytics-focused view',
      'Task details and logs will be hidden',
      'Comprehensive analytics data will be loaded'
    ]
  },
  {
    from: DashboardMode.ANALYTICS,
    to: DashboardMode.SIMPLE,
    preserveState: [
      'currentEpic',
      'workflowState',
      'configuration',
      'agents',
      'lastUpdate'
    ],
    resetState: [
      'analyticsCache',
      'focusState',
      'viMode',
      'showHelp'
    ],
    warnings: [
      'Returning to simple monitoring mode',
      'Analytics data will be cached',
      'Advanced features will be disabled'
    ]
  }
]

/**
 * Utility functions for mode management
 */
export class ModeUtils {
  /**
   * Get configuration for a specific mode
   */
  static getConfig(mode: DashboardMode): ModeConfig {
    return MODE_CONFIGS[mode]
  }

  /**
   * Get available features for a mode
   */
  static getFeatures(mode: DashboardMode): FeatureSet {
    return MODE_CONFIGS[mode].features
  }

  /**
   * Get keyboard shortcuts for a mode
   */
  static getKeyboardShortcuts(mode: DashboardMode): KeyboardShortcut[] {
    return MODE_CONFIGS[mode].keyboardShortcuts
  }

  /**
   * Get layout options for a mode
   */
  static getLayoutOptions(mode: DashboardMode): LayoutOptions {
    return MODE_CONFIGS[mode].layoutOptions
  }

  /**
   * Check if a feature is available in a specific mode
   */
  static isFeatureAvailable(mode: DashboardMode, feature: keyof FeatureSet): boolean {
    return MODE_CONFIGS[mode].features[feature]
  }

  /**
   * Get transition configuration between modes
   */
  static getTransition(from: DashboardMode, to: DashboardMode): ModeTransition | undefined {
    return MODE_TRANSITIONS.find(t => t.from === from && t.to === to)
  }

  /**
   * Get the opposite mode
   */
  static getOppositeMode(mode: DashboardMode): DashboardMode {
    return mode === DashboardMode.SIMPLE ? DashboardMode.INTERACTIVE : DashboardMode.SIMPLE
  }

  /**
   * Validate mode configuration
   */
  static validateModeConfig(config: ModeConfig): boolean {
    return (
      config &&
      Object.values(DashboardMode).includes(config.mode) &&
      config.features &&
      config.keyboardShortcuts &&
      config.layoutOptions &&
      Array.isArray(config.keyboardShortcuts)
    )
  }

  /**
   * Get feature differences between modes
   */
  static getFeatureDifferences(from: DashboardMode, to: DashboardMode): {
    enabled: string[]
    disabled: string[]
  } {
    const fromFeatures = MODE_CONFIGS[from].features
    const toFeatures = MODE_CONFIGS[to].features
    
    const enabled: string[] = []
    const disabled: string[] = []
    
    Object.keys(fromFeatures).forEach(feature => {
      const featureKey = feature as keyof FeatureSet
      if (!fromFeatures[featureKey] && toFeatures[featureKey]) {
        enabled.push(feature)
      } else if (fromFeatures[featureKey] && !toFeatures[featureKey]) {
        disabled.push(feature)
      }
    })
    
    return { enabled, disabled }
  }
}

/**
 * Mode context interface for React components
 */
export interface ModeContextValue {
  currentMode: DashboardMode
  config: ModeConfig
  features: FeatureSet
  layoutOptions: LayoutOptions
  keyboardShortcuts: KeyboardShortcut[]
  isSimpleMode: boolean
  isInteractiveMode: boolean
  toggleMode: () => void
  setMode: (mode: DashboardMode) => void
}