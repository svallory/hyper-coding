import { useEffect, useState, useCallback, useRef } from 'react'
import EpicContextManager, { EpicContext, EpicContextSwitchEvent } from '../services/epic-context.service'
import { EpicMetadata } from '../services/epic-discovery.service'

export interface EpicContextState {
  availableEpics: EpicMetadata[]
  currentContext: EpicContext | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  lastSwitchTime: Date | null
  cachedContexts: EpicContext[]
}

export interface EpicContextActions {
  discoverEpics: (forceRefresh?: boolean) => Promise<void>
  switchToEpic: (epicPathOrName: string) => Promise<boolean>
  refreshCurrentContext: () => Promise<void>
  clearCache: () => void
  getStats: () => any
}

export interface UseEpicContextOptions {
  epicRootPaths?: string[]
  autoRefresh?: boolean
  autoRefreshInterval?: number
}

const DEFAULT_OPTIONS: Required<UseEpicContextOptions> = {
  epicRootPaths: [],
  autoRefresh: true,
  autoRefreshInterval: 60000 // 1 minute
}

/**
 * React hook for managing epic contexts and switching between epics
 */
export function useEpicContext(
  initialEpicPath?: string,
  options: UseEpicContextOptions = {}
): [EpicContextState, EpicContextActions] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const managerRef = useRef<EpicContextManager | null>(null)
  
  const [state, setState] = useState<EpicContextState>({
    availableEpics: [],
    currentContext: null,
    isLoading: false,
    isRefreshing: false,
    error: null,
    lastSwitchTime: null,
    cachedContexts: []
  })

  // Initialize context manager and handle initial epic
  useEffect(() => {
    const initializeAndSwitchEpic = async () => {
      
      if (!managerRef.current) {
        managerRef.current = new EpicContextManager(opts.epicRootPaths)
        
        const manager = managerRef.current
        
        // Set up event listeners
        manager.on('epicsDiscovered', (epics: EpicMetadata[]) => {
          setState(prev => ({
            ...prev,
            availableEpics: epics,
            isLoading: false,
            error: null
          }))
        })
        
        manager.on('epicSwitched', (switchEvent: EpicContextSwitchEvent) => {
          setState(prev => ({
            ...prev,
            currentContext: manager.getCurrentContext(),
            lastSwitchTime: switchEvent.switchTime,
            cachedContexts: manager.getCachedContexts(),
            error: null
          }))
        })
        
        manager.on('contextChanged', (context: EpicContext) => {
          setState(prev => ({
            ...prev,
            currentContext: context,
            cachedContexts: manager.getCachedContexts()
          }))
        })
        
        manager.on('contextRefreshed', (context: EpicContext) => {
          setState(prev => ({
            ...prev,
            currentContext: context,
            isRefreshing: false,
            cachedContexts: manager.getCachedContexts()
          }))
        })
        
        manager.on('contextDataUpdated', (context: EpicContext) => {
          setState(prev => ({
            ...prev,
            currentContext: prev.currentContext?.epic.path === context.epic.path ? context : prev.currentContext,
            cachedContexts: manager.getCachedContexts()
          }))
        })
        
        manager.on('contextError', ({ context, error }: { context: EpicContext, error: Error }) => {
          setState(prev => ({
            ...prev,
            error: error.message,
            currentContext: prev.currentContext?.epic.path === context.epic.path ? context : prev.currentContext
          }))
        })
        
        manager.on('error', (error: Error) => {
          setState(prev => ({
            ...prev,
            error: error.message,
            isLoading: false,
            isRefreshing: false
          }))
        })

        manager.on('allContextsCleared', () => {
          setState(prev => ({
            ...prev,
            currentContext: null,
            cachedContexts: [],
            lastSwitchTime: null
          }))
        })
      }
      
      // Now handle epic initialization
      if (managerRef.current) {
        setState(prev => ({ ...prev, isLoading: true, error: null }))
        
        try {
          // Store a local reference to prevent nullification during async operations
          const manager = managerRef.current
          
          // Discover available epics
          const epics = await manager.getAvailableEpics(true)
          
          // Switch to initial epic if provided (use local reference)
          if (initialEpicPath && manager) {
            await manager.switchToEpic(initialEpicPath)
          }
        } catch (error) {
          // Log errors for debugging
          if (process.env.NODE_ENV === 'development') {
            console.error('Epic context initialization error:', error)
          }
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : 'Failed to initialize epic context',
            isLoading: false
          }))
        }
      }
    }

    initializeAndSwitchEpic()
    
    return () => {
      if (managerRef.current) {
        managerRef.current.destroy()
        managerRef.current = null
      }
    }
  }, [initialEpicPath])

  // Auto-refresh epics if enabled
  useEffect(() => {
    if (!opts.autoRefresh || !managerRef.current) return

    const interval = setInterval(async () => {
      try {
        await managerRef.current?.getAvailableEpics(true)
      } catch (error) {
        console.warn('Auto-refresh failed:', error)
      }
    }, opts.autoRefreshInterval)

    return () => clearInterval(interval)
  }, [opts.autoRefresh, opts.autoRefreshInterval])

  // Actions
  const discoverEpics = useCallback(async (forceRefresh: boolean = false) => {
    if (!managerRef.current) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      await managerRef.current.getAvailableEpics(forceRefresh)
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to discover epics',
        isLoading: false
      }))
    }
  }, [])

  const switchToEpic = useCallback(async (epicPathOrName: string): Promise<boolean> => {
    if (!managerRef.current) return false

    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const context = await managerRef.current.switchToEpic(epicPathOrName)
      return context !== null
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to switch epic',
        isLoading: false
      }))
      return false
    } finally {
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }, [])

  const refreshCurrentContext = useCallback(async () => {
    if (!managerRef.current) return

    setState(prev => ({ ...prev, isRefreshing: true, error: null }))
    
    try {
      await managerRef.current.refreshCurrentContext()
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh context',
        isRefreshing: false
      }))
    }
  }, [])

  const clearCache = useCallback(() => {
    if (!managerRef.current) return

    managerRef.current.clearAllContexts()
  }, [])

  const getStats = useCallback(() => {
    if (!managerRef.current) return null

    return managerRef.current.getStats()
  }, [])

  const actions: EpicContextActions = {
    discoverEpics,
    switchToEpic,
    refreshCurrentContext,
    clearCache,
    getStats
  }

  return [state, actions]
}

export default useEpicContext