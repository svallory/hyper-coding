import { useState, useEffect, useCallback } from 'react'
import { taskMasterService, TaskMasterComplexityReport, TaskMasterAnalyticsData, TaskMasterHistoricalData } from '../services/taskmaster.service'
import { errorHandler } from '../services/error-handler.service'

export interface AnalyticsState {
  complexityReport: TaskMasterComplexityReport | null
  analyticsData: TaskMasterAnalyticsData | null
  historicalData: TaskMasterHistoricalData[]
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  lastUpdate: Date | null
  cacheStats: {
    size: number
    entries: string[]
  }
}

export interface AnalyticsActions {
  refreshAll: () => Promise<void>
  refreshComplexity: () => Promise<void>
  refreshAnalytics: () => Promise<void>
  clearCache: () => void
  exportData: (format: 'json' | 'csv') => string
  getInsights: () => string[]
}

export interface UseAnalyticsOptions {
  autoRefresh?: boolean
  autoRefreshInterval?: number
  enableBackgroundRefresh?: boolean
}

/**
 * Hook for managing analytics data and operations
 */
export const useAnalytics = (options: UseAnalyticsOptions = {}): [AnalyticsState, AnalyticsActions] => {
  const {
    autoRefresh = true,
    autoRefreshInterval = 120000, // 2 minutes
    enableBackgroundRefresh = true
  } = options

  const [state, setState] = useState<AnalyticsState>({
    complexityReport: null,
    analyticsData: null,
    historicalData: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdate: null,
    cacheStats: { size: 0, entries: [] }
  })

  // Initialize analytics data
  const initializeAnalytics = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      // Check if TaskMaster CLI is available
      const availability = await taskMasterService.checkCLIAvailability()
      if (!availability.available) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: availability.error || 'TaskMaster CLI not available'
        }))
        return
      }

      // Load analytics data
      const [complexityReport, analyticsData] = await Promise.allSettled([
        taskMasterService.getComplexityReport(),
        taskMasterService.getAnalyticsData()
      ])

      const historicalData = taskMasterService.getHistoricalData()
      const cacheStats = taskMasterService.getCacheStats()

      setState(prev => ({
        ...prev,
        complexityReport: complexityReport.status === 'fulfilled' ? complexityReport.value : null,
        analyticsData: analyticsData.status === 'fulfilled' ? analyticsData.value : null,
        historicalData,
        isLoading: false,
        lastUpdate: new Date(),
        cacheStats,
        error: null
      }))
    } catch (error) {
      const handledError = await errorHandler.handleError(error, {
        component: 'useAnalytics',
        operation: 'initializeAnalytics'
      })

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: handledError.userFriendlyMessage
      }))
    }
  }, [])

  // Refresh all analytics data
  const refreshAll = useCallback(async () => {
    if (state.isRefreshing) return

    try {
      setState(prev => ({ ...prev, isRefreshing: true, error: null }))

      const [complexityReport, analyticsData] = await Promise.allSettled([
        taskMasterService.getComplexityReport(),
        taskMasterService.getAnalyticsData()
      ])

      const historicalData = taskMasterService.getHistoricalData()
      const cacheStats = taskMasterService.getCacheStats()

      setState(prev => ({
        ...prev,
        complexityReport: complexityReport.status === 'fulfilled' ? complexityReport.value : prev.complexityReport,
        analyticsData: analyticsData.status === 'fulfilled' ? analyticsData.value : prev.analyticsData,
        historicalData,
        isRefreshing: false,
        lastUpdate: new Date(),
        cacheStats,
        error: null
      }))
    } catch (error) {
      const handledError = await errorHandler.handleError(error, {
        component: 'useAnalytics',
        operation: 'refreshAll'
      })

      setState(prev => ({
        ...prev,
        isRefreshing: false,
        error: handledError.userFriendlyMessage
      }))
    }
  }, [state.isRefreshing])

  // Refresh complexity report only
  const refreshComplexity = useCallback(async () => {
    try {
      const complexityReport = await taskMasterService.getComplexityReport()
      setState(prev => ({
        ...prev,
        complexityReport,
        lastUpdate: new Date()
      }))
    } catch (error) {
      console.warn('Failed to refresh complexity report:', error)
    }
  }, [])

  // Refresh analytics data only
  const refreshAnalytics = useCallback(async () => {
    try {
      const analyticsData = await taskMasterService.getAnalyticsData()
      setState(prev => ({
        ...prev,
        analyticsData,
        lastUpdate: new Date()
      }))
    } catch (error) {
      console.warn('Failed to refresh analytics data:', error)
    }
  }, [])

  // Clear cache
  const clearCache = useCallback(() => {
    taskMasterService.clearCache()
    setState(prev => ({
      ...prev,
      cacheStats: { size: 0, entries: [] },
      lastUpdate: new Date()
    }))
  }, [])

  // Export data
  const exportData = useCallback((format: 'json' | 'csv'): string => {
    const exportObject = {
      timestamp: new Date().toISOString(),
      complexityReport: state.complexityReport,
      analyticsData: state.analyticsData,
      historicalData: state.historicalData
    }

    if (format === 'json') {
      return JSON.stringify(exportObject, null, 2)
    } else {
      // Simple CSV export for key metrics
      const lines = [
        'Type,Metric,Value',
        `Complexity,Average,${state.complexityReport?.averageComplexity || 0}`,
        `Complexity,High Risk Tasks,${state.complexityReport?.highComplexityTasks.length || 0}`,
        `Productivity,Tasks Per Day,${state.analyticsData?.productivityMetrics.tasksPerDay || 0}`,
        `Productivity,Burndown Rate,${state.analyticsData?.productivityMetrics.burndownRate || 0}`,
        `Bottlenecks,Count,${state.analyticsData?.bottlenecks.length || 0}`
      ]
      return lines.join('\n')
    }
  }, [state])

  // Get key insights
  const getInsights = useCallback((): string[] => {
    const insights: string[] = []

    if (state.complexityReport) {
      const { complexityReport } = state
      
      if (complexityReport.averageComplexity > 7) {
        insights.push('High average complexity detected - consider task breakdown')
      }
      
      if (complexityReport.highComplexityTasks.length > 0) {
        insights.push(`${complexityReport.highComplexityTasks.length} high-risk tasks need attention`)
      }
      
      if (complexityReport.complexityDistribution.high > complexityReport.complexityDistribution.low) {
        insights.push('More high-complexity than low-complexity tasks - workload imbalance')
      }
    }

    if (state.analyticsData) {
      const { analyticsData } = state
      
      if (analyticsData.bottlenecks.length > 0) {
        insights.push(`${analyticsData.bottlenecks.length} workflow bottlenecks identified`)
      }
      
      if (analyticsData.productivityMetrics.tasksPerDay < 1) {
        insights.push('Low productivity - consider process improvements')
      }
      
      if (analyticsData.productivityMetrics.burndownRate > 80) {
        insights.push('Project nearing completion - prepare for wrap-up')
      }
      
      // Trend analysis
      const recentTrend = analyticsData.completionTrends.slice(-3)
      if (recentTrend.length >= 2) {
        const trendDirection = recentTrend[recentTrend.length - 1].completionRate - recentTrend[0].completionRate
        if (trendDirection > 10) {
          insights.push('Positive completion trend detected')
        } else if (trendDirection < -5) {
          insights.push('Declining completion rate - investigation needed')
        }
      }
    }

    if (insights.length === 0) {
      insights.push('All metrics within normal ranges')
    }

    return insights
  }, [state])

  // Event listeners for TaskMaster service updates
  useEffect(() => {
    const handleComplexityUpdate = (report: TaskMasterComplexityReport) => {
      setState(prev => ({
        ...prev,
        complexityReport: report,
        lastUpdate: new Date()
      }))
    }

    const handleAnalyticsUpdate = (data: TaskMasterAnalyticsData) => {
      setState(prev => ({
        ...prev,
        analyticsData: data,
        lastUpdate: new Date()
      }))
    }

    const handleHistoricalUpdate = (dataPoint: TaskMasterHistoricalData) => {
      setState(prev => ({
        ...prev,
        historicalData: [...prev.historicalData, dataPoint].slice(-100), // Keep last 100 points
        lastUpdate: new Date()
      }))
    }

    taskMasterService.on('complexityReportUpdated', handleComplexityUpdate)
    taskMasterService.on('analyticsDataUpdated', handleAnalyticsUpdate)
    taskMasterService.on('historicalDataUpdated', handleHistoricalUpdate)

    return () => {
      taskMasterService.off('complexityReportUpdated', handleComplexityUpdate)
      taskMasterService.off('analyticsDataUpdated', handleAnalyticsUpdate)
      taskMasterService.off('historicalDataUpdated', handleHistoricalUpdate)
    }
  }, [])

  // Auto-refresh setup
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(refreshAll, autoRefreshInterval)
      return () => clearInterval(interval)
    }
  }, [autoRefresh, autoRefreshInterval, refreshAll])

  // Initial load
  useEffect(() => {
    initializeAnalytics()
  }, [initializeAnalytics])

  // Background refresh setup
  useEffect(() => {
    if (enableBackgroundRefresh) {
      taskMasterService.startBackgroundRefresh()
      return () => taskMasterService.stopBackgroundRefresh()
    }
  }, [enableBackgroundRefresh])

  const actions: AnalyticsActions = {
    refreshAll,
    refreshComplexity,
    refreshAnalytics,
    clearCache,
    exportData,
    getInsights
  }

  return [state, actions]
}