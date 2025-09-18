import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { DashboardMode, preferencesService, UserPreferences } from '../services/preferences.service'
import { ModeConfig, ModeContextValue, ModeUtils, FeatureSet, LayoutOptions, KeyboardShortcut } from '../types/mode.types'

/**
 * Mode management hook
 */
export const useMode = () => {
  const [currentMode, setCurrentMode] = useState<DashboardMode>(preferencesService.mode)
  const [preferences, setPreferences] = useState<UserPreferences>(preferencesService.preferences)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Subscribe to preference changes
  useEffect(() => {
    const unsubscribe = preferencesService.onPreferencesChange((newPreferences) => {
      setPreferences(newPreferences)
      setCurrentMode(newPreferences.mode)
    })

    return unsubscribe
  }, [])

  // Get current mode configuration
  const config = ModeUtils.getConfig(currentMode)
  const features = ModeUtils.getFeatures(currentMode)
  const layoutOptions = ModeUtils.getLayoutOptions(currentMode)
  const keyboardShortcuts = ModeUtils.getKeyboardShortcuts(currentMode)

  // Mode state helpers
  const isSimpleMode = currentMode === DashboardMode.SIMPLE
  const isInteractiveMode = currentMode === DashboardMode.INTERACTIVE
  const isAnalyticsMode = currentMode === DashboardMode.ANALYTICS

  // Mode switching with transition handling
  const setMode = useCallback(async (newMode: DashboardMode) => {
    if (newMode === currentMode || isTransitioning) {
      return
    }

    setIsTransitioning(true)

    try {
      // Get transition configuration
      const transition = ModeUtils.getTransition(currentMode, newMode)
      
      if (transition) {
        // Handle any pre-transition cleanup
        console.log(`Transitioning from ${currentMode} to ${newMode}`)
        console.log('Preserving:', transition.preserveState)
        console.log('Resetting:', transition.resetState)
      }

      // Update the mode in preferences
      preferencesService.setMode(newMode)
      
      // Update local state
      setCurrentMode(newMode)

      // Small delay for smooth transition
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error('Failed to switch mode:', error)
    } finally {
      setIsTransitioning(false)
    }
  }, [currentMode, isTransitioning])

  // Toggle between modes
  const toggleMode = useCallback(() => {
    const oppositeMode = ModeUtils.getOppositeMode(currentMode)
    setMode(oppositeMode)
  }, [currentMode, setMode])

  // Feature availability helpers
  const isFeatureEnabled = useCallback((feature: keyof FeatureSet) => {
    return features[feature] && preferencesService.getFeatureAvailability()[feature as keyof ReturnType<typeof preferencesService.getFeatureAvailability>]
  }, [features])

  // Preference update helpers
  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    preferencesService.updatePreference(key, value)
  }, [])

  const updateNestedPreference = useCallback(<
    T extends keyof UserPreferences,
    K extends keyof UserPreferences[T]
  >(
    section: T,
    key: K,
    value: UserPreferences[T][K]
  ) => {
    preferencesService.updateNestedPreference(section, key, value)
  }, [])

  // Mode-specific configurations
  const getRefreshInterval = useCallback(() => {
    return preferences.simpleFeatures.autoRefresh 
      ? preferences.simpleFeatures.refreshInterval 
      : 0
  }, [preferences])

  const shouldShowFeature = useCallback((feature: keyof FeatureSet) => {
    return isFeatureEnabled(feature)
  }, [isFeatureEnabled])

  const getKeyboardShortcut = useCallback((action: string) => {
    return keyboardShortcuts.find(shortcut => shortcut.action === action)
  }, [keyboardShortcuts])

  // Layout configuration helpers
  const shouldUseCompactLayout = useCallback(() => {
    return layoutOptions.useCompactSpacing || preferences.compactLayout
  }, [layoutOptions, preferences])

  const getMaxLogLines = useCallback(() => {
    if (isSimpleMode) {
      return Math.min(layoutOptions.maxLogLines, 5)
    }
    return layoutOptions.maxLogLines
  }, [isSimpleMode, layoutOptions])

  // Export preferences
  const exportModePreferences = useCallback(() => {
    return preferencesService.exportPreferences()
  }, [])

  // Import preferences
  const importModePreferences = useCallback((preferencesJson: string) => {
    return preferencesService.importPreferences(preferencesJson)
  }, [])

  // Reset to defaults
  const resetPreferences = useCallback(() => {
    preferencesService.resetToDefaults()
  }, [])

  return {
    // Current state
    currentMode,
    config,
    features,
    layoutOptions,
    keyboardShortcuts,
    preferences,
    isTransitioning,

    // Mode state helpers
    isSimpleMode,
    isInteractiveMode,
    isAnalyticsMode,

    // Mode switching
    setMode,
    toggleMode,

    // Feature availability
    isFeatureEnabled,
    shouldShowFeature,

    // Preference management
    updatePreference,
    updateNestedPreference,

    // Mode-specific helpers
    getRefreshInterval,
    getKeyboardShortcut,
    shouldUseCompactLayout,
    getMaxLogLines,

    // Import/Export
    exportModePreferences,
    importModePreferences,
    resetPreferences
  }
}

/**
 * React context for mode management
 */
export const ModeContext = createContext<ModeContextValue | null>(null)

/**
 * Hook to use mode context
 */
export const useModeContext = (): ModeContextValue => {
  const context = useContext(ModeContext)
  if (!context) {
    throw new Error('useModeContext must be used within a ModeProvider')
  }
  return context
}

/**
 * Mode provider component (for future use if needed)
 */
export const createModeContextValue = (modeHook: ReturnType<typeof useMode>): ModeContextValue => {
  return {
    currentMode: modeHook.currentMode,
    config: modeHook.config,
    features: modeHook.features,
    layoutOptions: modeHook.layoutOptions,
    keyboardShortcuts: modeHook.keyboardShortcuts,
    isSimpleMode: modeHook.isSimpleMode,
    isInteractiveMode: modeHook.isInteractiveMode,
    toggleMode: modeHook.toggleMode,
    setMode: modeHook.setMode
  }
}