import { useEffect, useState, useCallback, useRef } from 'react'
import { 
  TaskMasterService, 
  TaskMasterTask, 
  TaskMasterStats, 
  TaskMasterNextTask, 
  TaskMasterComplexityReport,
  TaskMasterCLIAvailability,
  TaskMasterConfig
} from '../services/taskmaster.service'

export interface TaskMasterState {
  tasks: TaskMasterTask[]
  stats: TaskMasterStats | null
  nextTask: TaskMasterNextTask | null
  complexityReport: TaskMasterComplexityReport | null
  cliAvailability: TaskMasterCLIAvailability | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  lastUpdate: Date | null
  cacheStats: { size: number; entries: string[] }
}

export interface TaskMasterActions {
  refresh: () => Promise<void>
  refreshTasks: () => Promise<void>
  refreshStats: () => Promise<void>
  refreshNextTask: () => Promise<void>
  refreshComplexityReport: () => Promise<void>
  checkCLIAvailability: () => Promise<void>
  clearCache: () => void
  getTask: (id: string) => Promise<TaskMasterTask | null>
  startBackgroundRefresh: (intervalMs?: number) => void
  stopBackgroundRefresh: () => void
}

export interface UseTaskMasterOptions {
  config?: TaskMasterConfig
  autoRefresh?: boolean
  autoRefreshInterval?: number
  enableBackgroundRefresh?: boolean
  fallbackData?: Partial<TaskMasterState>
}

const DEFAULT_OPTIONS: Required<UseTaskMasterOptions> = {
  config: {},
  autoRefresh: true,
  autoRefreshInterval: 30000,
  enableBackgroundRefresh: true,
  fallbackData: {}
}

/**
 * React hook for TaskMaster CLI integration
 * 
 * Provides:
 * - Async data fetching with loading states
 * - Intelligent caching and background refresh
 * - Error handling with fallback data
 * - CLI availability monitoring
 * - Real-time updates via events
 */
export function useTaskMaster(options: UseTaskMasterOptions = {}): [TaskMasterState, TaskMasterActions] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const serviceRef = useRef<TaskMasterService | null>(null)
  
  // Initialize state with fallback data
  const [state, setState] = useState<TaskMasterState>(() => ({
    tasks: [],
    stats: null,
    nextTask: null,
    complexityReport: null,
    cliAvailability: null,
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdate: null,
    cacheStats: { size: 0, entries: [] },
    ...opts.fallbackData
  }))

  // Initialize service
  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new TaskMasterService(opts.config)
      
      // Set up event listeners
      const service = serviceRef.current
      
      service.on('ready', () => {
        setState(prev => ({ 
          ...prev, 
          isLoading: false,
          error: null 
        }))
      })
      
      service.on('error', (error: Error) => {
        setState(prev => ({ 
          ...prev, 
          error: error.message,
          isLoading: false,
          isRefreshing: false
        }))
      })
      
      service.on('cliAvailable', (availability: TaskMasterCLIAvailability) => {
        setState(prev => ({ 
          ...prev, 
          cliAvailability: availability,
          error: null
        }))
      })
      
      service.on('cliUnavailable', (availability: TaskMasterCLIAvailability) => {
        setState(prev => ({ 
          ...prev, 
          cliAvailability: availability,
          error: availability.error || 'TaskMaster CLI is not available'
        }))
      })
      
      service.on('tasksUpdated', (tasks: TaskMasterTask[]) => {
        setState(prev => ({ 
          ...prev, 
          tasks,
          lastUpdate: new Date(),
          cacheStats: service.getCacheStats()
        }))
      })
      
      service.on('statsUpdated', (stats: TaskMasterStats) => {
        setState(prev => ({ 
          ...prev, 
          stats,
          lastUpdate: new Date(),
          cacheStats: service.getCacheStats()
        }))
      })
      
      service.on('nextTaskUpdated', (nextTask: TaskMasterNextTask) => {
        setState(prev => ({ 
          ...prev, 
          nextTask,
          lastUpdate: new Date(),
          cacheStats: service.getCacheStats()
        }))
      })
      
      service.on('complexityReportUpdated', (report: TaskMasterComplexityReport) => {
        setState(prev => ({ 
          ...prev, 
          complexityReport: report,
          lastUpdate: new Date(),
          cacheStats: service.getCacheStats()
        }))
      })
      
      service.on('refreshCompleted', () => {
        setState(prev => ({ 
          ...prev, 
          isRefreshing: false,
          lastUpdate: new Date(),
          cacheStats: service.getCacheStats()
        }))
      })
      
      service.on('cacheCleared', () => {
        setState(prev => ({ 
          ...prev, 
          cacheStats: service.getCacheStats()
        }))
      })
      
      // Start background refresh if enabled
      if (opts.enableBackgroundRefresh) {
        service.startBackgroundRefresh(opts.autoRefreshInterval)
      }
    }
    
    return () => {
      if (serviceRef.current) {
        serviceRef.current.destroy()
        serviceRef.current = null
      }
    }
  }, [])

  // Initial data load
  useEffect(() => {
    if (serviceRef.current && opts.autoRefresh) {
      const loadInitialData = async () => {
        try {
          setState(prev => ({ ...prev, isLoading: true }))
          await serviceRef.current?.refreshAll()
        } catch (error) {
          setState(prev => ({ 
            ...prev, 
            error: error instanceof Error ? error.message : 'Failed to load initial data',
            isLoading: false
          }))
        }
      }
      
      loadInitialData()
    }
  }, [opts.autoRefresh])

  // Actions
  const refresh = useCallback(async () => {
    if (!serviceRef.current) return
    
    setState(prev => ({ ...prev, isRefreshing: true, error: null }))
    
    try {
      await serviceRef.current.refreshAll()
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Refresh failed',
        isRefreshing: false
      }))
    }
  }, [])

  const refreshTasks = useCallback(async () => {
    if (!serviceRef.current) return
    
    try {
      const tasks = await serviceRef.current.getTasks()
      setState(prev => ({ 
        ...prev, 
        tasks,
        lastUpdate: new Date(),
        cacheStats: serviceRef.current!.getCacheStats()
      }))
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to refresh tasks'
      }))
    }
  }, [])

  const refreshStats = useCallback(async () => {
    if (!serviceRef.current) return
    
    try {
      const stats = await serviceRef.current.getStats()
      setState(prev => ({ 
        ...prev, 
        stats,
        lastUpdate: new Date(),
        cacheStats: serviceRef.current!.getCacheStats()
      }))
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to refresh stats'
      }))
    }
  }, [])

  const refreshNextTask = useCallback(async () => {
    if (!serviceRef.current) return
    
    try {
      const nextTask = await serviceRef.current.getNextTask()
      setState(prev => ({ 
        ...prev, 
        nextTask,
        lastUpdate: new Date(),
        cacheStats: serviceRef.current!.getCacheStats()
      }))
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to refresh next task'
      }))
    }
  }, [])

  const refreshComplexityReport = useCallback(async () => {
    if (!serviceRef.current) return
    
    try {
      const report = await serviceRef.current.getComplexityReport()
      setState(prev => ({ 
        ...prev, 
        complexityReport: report,
        lastUpdate: new Date(),
        cacheStats: serviceRef.current!.getCacheStats()
      }))
    } catch (error) {
      // Complexity reports are optional, so don't set error state
      console.warn('Failed to refresh complexity report:', error)
    }
  }, [])

  const checkCLIAvailability = useCallback(async () => {
    if (!serviceRef.current) return
    
    try {
      const availability = await serviceRef.current.checkCLIAvailability()
      setState(prev => ({ 
        ...prev, 
        cliAvailability: availability,
        error: availability.available ? null : (availability.error || 'CLI not available')
      }))
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to check CLI availability'
      }))
    }
  }, [])

  const clearCache = useCallback(() => {
    if (!serviceRef.current) return
    
    serviceRef.current.clearCache()
    setState(prev => ({ 
      ...prev, 
      cacheStats: serviceRef.current!.getCacheStats()
    }))
  }, [])

  const getTask = useCallback(async (id: string): Promise<TaskMasterTask | null> => {
    if (!serviceRef.current) return null
    
    try {
      return await serviceRef.current.getTask(id)
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to get task'
      }))
      return null
    }
  }, [])

  const startBackgroundRefresh = useCallback((intervalMs: number = opts.autoRefreshInterval) => {
    if (!serviceRef.current) return
    
    serviceRef.current.startBackgroundRefresh(intervalMs)
  }, [opts.autoRefreshInterval])

  const stopBackgroundRefresh = useCallback(() => {
    if (!serviceRef.current) return
    
    serviceRef.current.stopBackgroundRefresh()
  }, [])

  const actions: TaskMasterActions = {
    refresh,
    refreshTasks,
    refreshStats,
    refreshNextTask,
    refreshComplexityReport,
    checkCLIAvailability,
    clearCache,
    getTask,
    startBackgroundRefresh,
    stopBackgroundRefresh
  }

  return [state, actions]
}

export default useTaskMaster