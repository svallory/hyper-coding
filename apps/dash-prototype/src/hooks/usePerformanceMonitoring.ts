import { useEffect, useRef, useCallback, useState } from 'react'
import { performanceMonitor, PerformanceMetrics, PerformanceAlert } from '../services/performance-monitor.service'

export interface UsePerformanceMonitoringOptions {
  componentName?: string
  trackRenderTime?: boolean
  trackInteractions?: boolean
  autoStart?: boolean
}

export interface PerformanceHookReturn {
  metrics: PerformanceMetrics | null
  startRender: () => void
  endRender: () => number
  recordInteraction: (type: string, details?: any) => void
  isMonitoring: boolean
  alerts: PerformanceAlert[]
  startMonitoring: () => void
  stopMonitoring: () => void
  resetMetrics: () => void
}

export const usePerformanceMonitoring = (
  options: UsePerformanceMonitoringOptions = {}
): PerformanceHookReturn => {
  const {
    componentName = 'UnknownComponent',
    trackRenderTime = true,
    trackInteractions = true,
    autoStart = true
  } = options

  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([])
  const [isMonitoring, setIsMonitoring] = useState(false)
  const renderStartTimeRef = useRef<number | null>(null)

  // Initialize monitoring
  useEffect(() => {
    if (autoStart) {
      performanceMonitor.startMonitoring()
      setIsMonitoring(true)
    }

    // Set up event listeners
    const handleMetricsUpdate = (newMetrics: PerformanceMetrics) => {
      setMetrics(newMetrics)
    }

    const handlePerformanceAlerts = (newAlerts: PerformanceAlert[]) => {
      setAlerts(prev => [...prev, ...newAlerts].slice(-10)) // Keep last 10 alerts
    }

    const handleMonitoringStarted = () => {
      setIsMonitoring(true)
    }

    const handleMonitoringStopped = () => {
      setIsMonitoring(false)
    }

    performanceMonitor.on('metrics-updated', handleMetricsUpdate)
    performanceMonitor.on('performance-alerts', handlePerformanceAlerts)
    performanceMonitor.on('monitoring-started', handleMonitoringStarted)
    performanceMonitor.on('monitoring-stopped', handleMonitoringStopped)

    // Get initial metrics
    setMetrics(performanceMonitor.getMetrics())

    return () => {
      performanceMonitor.off('metrics-updated', handleMetricsUpdate)
      performanceMonitor.off('performance-alerts', handlePerformanceAlerts)
      performanceMonitor.off('monitoring-started', handleMonitoringStarted)
      performanceMonitor.off('monitoring-stopped', handleMonitoringStopped)
      
      if (autoStart) {
        performanceMonitor.stopMonitoring()
      }
    }
  }, [autoStart])

  const startRender = useCallback(() => {
    if (trackRenderTime) {
      renderStartTimeRef.current = performance.now()
      performanceMonitor.startComponentRender(componentName)
    }
  }, [componentName, trackRenderTime])

  const endRender = useCallback((): number => {
    if (trackRenderTime && renderStartTimeRef.current !== null) {
      const renderTime = performanceMonitor.endComponentRender(componentName)
      renderStartTimeRef.current = null
      return renderTime
    }
    return 0
  }, [componentName, trackRenderTime])

  const recordInteraction = useCallback((type: string, details?: any) => {
    if (trackInteractions) {
      performanceMonitor.recordInteraction(type as any, componentName, details)
    }
  }, [componentName, trackInteractions])

  const startMonitoring = useCallback(() => {
    performanceMonitor.startMonitoring()
  }, [])

  const stopMonitoring = useCallback(() => {
    performanceMonitor.stopMonitoring()
  }, [])

  const resetMetrics = useCallback(() => {
    performanceMonitor.reset()
    setAlerts([])
  }, [])

  return {
    metrics,
    startRender,
    endRender,
    recordInteraction,
    isMonitoring,
    alerts,
    startMonitoring,
    stopMonitoring,
    resetMetrics
  }
}

// Hook for automatic render time tracking
export const useRenderTimeTracking = (componentName: string) => {
  const { startRender, endRender } = usePerformanceMonitoring({
    componentName,
    trackRenderTime: true,
    trackInteractions: false,
    autoStart: false
  })

  useEffect(() => {
    startRender()
    return () => {
      endRender()
    }
  })

  return { startRender, endRender }
}

// Hook for interaction tracking
export const useInteractionTracking = (componentName: string) => {
  const { recordInteraction } = usePerformanceMonitoring({
    componentName,
    trackRenderTime: false,
    trackInteractions: true,
    autoStart: false
  })

  const trackClick = useCallback((details?: any) => {
    recordInteraction('click', details)
  }, [recordInteraction])

  const trackKeyPress = useCallback((key: string, details?: any) => {
    recordInteraction('keypress', { key, ...details })
  }, [recordInteraction])

  const trackScroll = useCallback((scrollPosition: number, details?: any) => {
    recordInteraction('scroll', { scrollPosition, ...details })
  }, [recordInteraction])

  const trackFocus = useCallback((details?: any) => {
    recordInteraction('focus', details)
  }, [recordInteraction])

  const trackBlur = useCallback((details?: any) => {
    recordInteraction('blur', details)
  }, [recordInteraction])

  return {
    trackClick,
    trackKeyPress,
    trackScroll,
    trackFocus,
    trackBlur
  }
}

// Hook for memory monitoring
export const useMemoryMonitoring = () => {
  const [memoryMetrics, setMemoryMetrics] = useState<PerformanceMetrics['memoryUsage'] | null>(null)
  const [memoryTrend, setMemoryTrend] = useState<'increasing' | 'decreasing' | 'stable'>('stable')

  useEffect(() => {
    const handleMetricsUpdate = (metrics: PerformanceMetrics) => {
      setMemoryMetrics(metrics.memoryUsage)
    }

    const handleMemoryTrend = (data: { slope: number; trend: 'increasing' | 'decreasing' }) => {
      setMemoryTrend(data.trend)
    }

    performanceMonitor.on('metrics-updated', handleMetricsUpdate)
    performanceMonitor.on('memory-trend', handleMemoryTrend)

    return () => {
      performanceMonitor.off('metrics-updated', handleMetricsUpdate)
      performanceMonitor.off('memory-trend', handleMemoryTrend)
    }
  }, [])

  return {
    memoryMetrics,
    memoryTrend
  }
}

// Hook for FPS monitoring
export const useFPSMonitoring = () => {
  const [fps, setFPS] = useState<number>(60)
  const [frameDropCount, setFrameDropCount] = useState<number>(0)

  useEffect(() => {
    const handleMetricsUpdate = (metrics: PerformanceMetrics) => {
      setFPS(metrics.fps)
      setFrameDropCount(metrics.frameDropCount)
    }

    performanceMonitor.on('metrics-updated', handleMetricsUpdate)

    return () => {
      performanceMonitor.off('metrics-updated', handleMetricsUpdate)
    }
  }, [])

  return {
    fps,
    frameDropCount
  }
}

// Hook for performance alerts
export const usePerformanceAlerts = () => {
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([])
  const [criticalAlerts, setCriticalAlerts] = useState<PerformanceAlert[]>([])

  useEffect(() => {
    const handlePerformanceAlert = (alert: PerformanceAlert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 20)) // Keep last 20 alerts
      
      if (alert.severity === 'critical' || alert.severity === 'high') {
        setCriticalAlerts(prev => [alert, ...prev].slice(0, 5)) // Keep last 5 critical alerts
      }
    }

    performanceMonitor.on('performance-alert', handlePerformanceAlert)

    return () => {
      performanceMonitor.off('performance-alert', handlePerformanceAlert)
    }
  }, [])

  const clearAlerts = useCallback(() => {
    setAlerts([])
    setCriticalAlerts([])
  }, [])

  return {
    alerts,
    criticalAlerts,
    clearAlerts
  }
}

// Enhanced HOC for automatic performance tracking
export function withPerformanceTracking<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName?: string
) {
  return React.memo((props: P) => {
    const displayName = componentName || WrappedComponent.displayName || WrappedComponent.name || 'Component'
    const { startRender, endRender, recordInteraction } = usePerformanceMonitoring({
      componentName: displayName,
      trackRenderTime: true,
      trackInteractions: true,
      autoStart: false
    })

    useEffect(() => {
      startRender()
      return () => {
        endRender()
      }
    })

    // Wrap props to inject interaction tracking
    const enhancedProps = {
      ...props,
      onClick: (event: any) => {
        recordInteraction('click', { target: event?.target?.tagName })
        if (props.onClick) {
          props.onClick(event)
        }
      },
      onKeyDown: (event: any) => {
        recordInteraction('keypress', { key: event?.key })
        if (props.onKeyDown) {
          props.onKeyDown(event)
        }
      }
    } as P

    return <WrappedComponent {...enhancedProps} />
  })
}