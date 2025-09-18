import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * User preference modes for the dashboard
 */
export enum DashboardMode {
  SIMPLE = 'simple',
  INTERACTIVE = 'interactive',
  ANALYTICS = 'analytics'
}

/**
 * Available keyboard shortcut schemes
 */
export enum KeyboardScheme {
  DEFAULT = 'default',
  VIM = 'vim',
  EMACS = 'emacs'
}

/**
 * Display theme options
 */
export enum Theme {
  DEFAULT = 'default',
  MINIMAL = 'minimal',
  COMPACT = 'compact'
}

/**
 * User preferences interface
 */
export interface UserPreferences {
  // Core mode setting
  mode: DashboardMode
  
  // Display preferences
  theme: Theme
  showAnimations: boolean
  compactLayout: boolean
  
  // Keyboard preferences
  keyboardScheme: KeyboardScheme
  viModeDefault: boolean
  
  // Feature toggles for interactive mode
  interactiveFeatures: {
    taskDetails: boolean
    keyboardNavigation: boolean
    analytics: boolean
    multiEpicManagement: boolean
    errorHandling: boolean
    dependencyVisualization: boolean
  }
  
  // Simple mode options
  simpleFeatures: {
    showProgress: boolean
    showLogs: boolean
    showConfiguration: boolean
    autoRefresh: boolean
    refreshInterval: number
  }
  
  // Session preferences
  rememberLastEpic: boolean
  defaultEpicPath?: string
  
  // Layout preferences
  responsiveBreakpoints: boolean
  minimalTitleBar: boolean
  
  // Advanced settings
  debugMode: boolean
  verboseLogging: boolean
  
  // Timestamps
  createdAt: string
  lastModified: string
}

/**
 * Default user preferences
 */
const DEFAULT_PREFERENCES: UserPreferences = {
  mode: DashboardMode.SIMPLE,
  theme: Theme.DEFAULT,
  showAnimations: true,
  compactLayout: false,
  keyboardScheme: KeyboardScheme.DEFAULT,
  viModeDefault: false,
  interactiveFeatures: {
    taskDetails: true,
    keyboardNavigation: true,
    analytics: true,
    multiEpicManagement: true,
    errorHandling: true,
    dependencyVisualization: true
  },
  simpleFeatures: {
    showProgress: true,
    showLogs: true,
    showConfiguration: true,
    autoRefresh: true,
    refreshInterval: 2000
  },
  rememberLastEpic: true,
  responsiveBreakpoints: true,
  minimalTitleBar: false,
  debugMode: false,
  verboseLogging: false,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString()
}

/**
 * Preferences management service for the Epic Dashboard
 */
export class PreferencesService {
  private preferencesPath: string
  private preferencesDir: string
  private _preferences: UserPreferences
  private _listeners: Array<(preferences: UserPreferences) => void> = []

  constructor() {
    this.preferencesDir = join(homedir(), '.epic-dashboard')
    this.preferencesPath = join(this.preferencesDir, 'preferences.json')
    this._preferences = this.loadPreferences()
  }

  /**
   * Get current preferences
   */
  get preferences(): UserPreferences {
    return { ...this._preferences }
  }

  /**
   * Get current dashboard mode
   */
  get mode(): DashboardMode {
    return this._preferences.mode
  }

  /**
   * Check if currently in simple mode
   */
  get isSimpleMode(): boolean {
    return this._preferences.mode === DashboardMode.SIMPLE
  }

  /**
   * Check if currently in interactive mode
   */
  get isInteractiveMode(): boolean {
    return this._preferences.mode === DashboardMode.INTERACTIVE
  }

  /**
   * Check if currently in analytics mode
   */
  get isAnalyticsMode(): boolean {
    return this._preferences.mode === DashboardMode.ANALYTICS
  }

  /**
   * Toggle between dashboard modes (simple -> interactive -> analytics -> simple)
   */
  toggleMode(): DashboardMode {
    let newMode: DashboardMode
    
    switch (this._preferences.mode) {
      case DashboardMode.SIMPLE:
        newMode = DashboardMode.INTERACTIVE
        break
      case DashboardMode.INTERACTIVE:
        newMode = DashboardMode.ANALYTICS
        break
      case DashboardMode.ANALYTICS:
        newMode = DashboardMode.SIMPLE
        break
      default:
        newMode = DashboardMode.SIMPLE
    }
    
    this.updatePreference('mode', newMode)
    return newMode
  }

  /**
   * Set specific dashboard mode
   */
  setMode(mode: DashboardMode): void {
    this.updatePreference('mode', mode)
  }

  /**
   * Update a specific preference
   */
  updatePreference<K extends keyof UserPreferences>(
    key: K, 
    value: UserPreferences[K]
  ): void {
    this._preferences = {
      ...this._preferences,
      [key]: value,
      lastModified: new Date().toISOString()
    }
    
    this.savePreferences()
    this.notifyListeners()
  }

  /**
   * Update multiple preferences at once
   */
  updatePreferences(updates: Partial<UserPreferences>): void {
    this._preferences = {
      ...this._preferences,
      ...updates,
      lastModified: new Date().toISOString()
    }
    
    this.savePreferences()
    this.notifyListeners()
  }

  /**
   * Update a nested preference property
   */
  updateNestedPreference<
    T extends keyof UserPreferences,
    K extends keyof UserPreferences[T]
  >(
    section: T,
    key: K,
    value: UserPreferences[T][K]
  ): void {
    this._preferences = {
      ...this._preferences,
      [section]: {
        ...this._preferences[section],
        [key]: value
      },
      lastModified: new Date().toISOString()
    }
    
    this.savePreferences()
    this.notifyListeners()
  }

  /**
   * Reset preferences to defaults
   */
  resetToDefaults(): void {
    this._preferences = {
      ...DEFAULT_PREFERENCES,
      createdAt: this._preferences.createdAt,
      lastModified: new Date().toISOString()
    }
    
    this.savePreferences()
    this.notifyListeners()
  }

  /**
   * Get feature availability based on current mode
   */
  getFeatureAvailability() {
    const isInteractive = this.isInteractiveMode
    
    return {
      taskDetails: isInteractive && this._preferences.interactiveFeatures.taskDetails,
      keyboardNavigation: isInteractive && this._preferences.interactiveFeatures.keyboardNavigation,
      analytics: isInteractive && this._preferences.interactiveFeatures.analytics,
      multiEpicManagement: isInteractive && this._preferences.interactiveFeatures.multiEpicManagement,
      errorHandling: isInteractive && this._preferences.interactiveFeatures.errorHandling,
      dependencyVisualization: isInteractive && this._preferences.interactiveFeatures.dependencyVisualization,
      
      // Simple mode features are always available
      showProgress: this._preferences.simpleFeatures.showProgress,
      showLogs: this._preferences.simpleFeatures.showLogs,
      showConfiguration: this._preferences.simpleFeatures.showConfiguration,
      autoRefresh: this._preferences.simpleFeatures.autoRefresh
    }
  }

  /**
   * Export preferences for backup
   */
  exportPreferences(): string {
    return JSON.stringify(this._preferences, null, 2)
  }

  /**
   * Import preferences from backup
   */
  importPreferences(preferencesJson: string): boolean {
    try {
      const imported = JSON.parse(preferencesJson) as UserPreferences
      
      // Validate imported preferences
      if (this.validatePreferences(imported)) {
        this._preferences = {
          ...imported,
          lastModified: new Date().toISOString()
        }
        
        this.savePreferences()
        this.notifyListeners()
        return true
      }
      
      return false
    } catch (error) {
      console.error('Failed to import preferences:', error)
      return false
    }
  }

  /**
   * Subscribe to preference changes
   */
  onPreferencesChange(listener: (preferences: UserPreferences) => void): () => void {
    this._listeners.push(listener)
    
    // Return unsubscribe function
    return () => {
      const index = this._listeners.indexOf(listener)
      if (index > -1) {
        this._listeners.splice(index, 1)
      }
    }
  }

  /**
   * Load preferences from disk
   */
  private loadPreferences(): UserPreferences {
    try {
      if (existsSync(this.preferencesPath)) {
        const data = readFileSync(this.preferencesPath, 'utf-8')
        const preferences = JSON.parse(data) as UserPreferences
        
        // Merge with defaults to handle new fields
        return this.mergeWithDefaults(preferences)
      }
    } catch (error) {
      console.error('Failed to load preferences:', error)
    }
    
    // Return defaults if loading fails
    return { ...DEFAULT_PREFERENCES }
  }

  /**
   * Save preferences to disk
   */
  private savePreferences(): void {
    try {
      // Ensure preferences directory exists
      if (!existsSync(this.preferencesDir)) {
        mkdirSync(this.preferencesDir, { recursive: true })
      }
      
      writeFileSync(this.preferencesPath, JSON.stringify(this._preferences, null, 2))
    } catch (error) {
      console.error('Failed to save preferences:', error)
    }
  }

  /**
   * Merge loaded preferences with defaults to handle new fields
   */
  private mergeWithDefaults(loaded: Partial<UserPreferences>): UserPreferences {
    return {
      ...DEFAULT_PREFERENCES,
      ...loaded,
      interactiveFeatures: {
        ...DEFAULT_PREFERENCES.interactiveFeatures,
        ...loaded.interactiveFeatures
      },
      simpleFeatures: {
        ...DEFAULT_PREFERENCES.simpleFeatures,
        ...loaded.simpleFeatures
      },
      lastModified: new Date().toISOString()
    }
  }

  /**
   * Validate preferences structure
   */
  private validatePreferences(preferences: any): preferences is UserPreferences {
    return (
      preferences &&
      typeof preferences === 'object' &&
      Object.values(DashboardMode).includes(preferences.mode) &&
      preferences.interactiveFeatures &&
      preferences.simpleFeatures &&
      typeof preferences.interactiveFeatures === 'object' &&
      typeof preferences.simpleFeatures === 'object'
    )
  }

  /**
   * Notify all listeners of preference changes
   */
  private notifyListeners(): void {
    this._listeners.forEach(listener => {
      try {
        listener(this.preferences)
      } catch (error) {
        console.error('Error in preferences listener:', error)
      }
    })
  }
}

// Export a singleton instance
export const preferencesService = new PreferencesService()