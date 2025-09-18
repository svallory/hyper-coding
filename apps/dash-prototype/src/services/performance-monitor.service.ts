import { EventEmitter } from 'events'

export interface PerformanceMetrics {
  // Rendering Performance
  renderTime: number
  componentRenderCount: number
  lastRenderTime: number
  averageRenderTime: number
  
  // Memory Usage
  memoryUsage: MemoryMetrics
  memoryTrend: MemoryTrendPoint[]
  
  // Event Loop Performance
  eventLoopLag: number
  eventLoopLagHistory: number[]
  
  // User Interaction Performance
  interactionResponseTime: number
  lastInteractionTime: number
  interactionHistory: InteractionMetric[]
  
  // Component Performance
  componentUpdateCounts: Map<string, number>
  heaviestComponents: ComponentPerformance[]
  
  // System Performance
  cpuUsage?: number
  fps: number
  frameDropCount: number
  
  // Timestamp
  timestamp: number
}

export interface MemoryMetrics {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  rssMB: number
}

export interface MemoryTrendPoint {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
}

export interface InteractionMetric {
  type: 'click' | 'keypress' | 'scroll' | 'focus' | 'blur'
  timestamp: number
  responseTime: number
  componentName?: string
  actionDetails?: any
}

export interface ComponentPerformance {
  name: string
  renderCount: number
  totalRenderTime: number
  averageRenderTime: number
  lastRenderTime: number
  memoryImpact: number
}

export interface PerformanceAlert {
  type: 'memory' | 'render' | 'interaction' | 'eventLoop' | 'fps'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  value: number
  threshold: number
  timestamp: number
  suggestions?: string[]
}

export interface PerformanceConfig {
  // Monitoring intervals (ms)
  memoryCheckInterval: number
  eventLoopCheckInterval: number
  performanceUpdateInterval: number
  
  // Alert thresholds
  maxMemoryUsageMB: number
  maxRenderTimeMs: number
  maxEventLoopLagMs: number
  maxInteractionResponseMs: number
  minFPS: number
  
  // History retention
  memoryHistorySize: number
  interactionHistorySize: number
  eventLoopHistorySize: number
  
  // Feature flags
  enableMemoryMonitoring: boolean
  enableRenderTimeTracking: boolean
  enableInteractionTracking: boolean
  enableEventLoopMonitoring: boolean
  enableFrameRateMonitoring: boolean
  enableGarbageCollectionTrigger: boolean
}

export class PerformanceMonitorService extends EventEmitter {
  private metrics: PerformanceMetrics
  private config: PerformanceConfig
  private intervals: NodeJS.Timeout[] = []
  private renderStartTimes: Map<string, number> = new Map()
  private componentRenderCounts: Map<string, number> = new Map()
  private lastInteractionTime = 0
  private frameStartTime = 0
  private frameCount = 0
  private isMonitoring = false
  private performanceObserver?: PerformanceObserver
  
  constructor(config?: Partial<PerformanceConfig>) {
    super()
    
    this.config = {
      // Default configuration
      memoryCheckInterval: 1000,
      eventLoopCheckInterval: 100,
      performanceUpdateInterval: 500,
      
      maxMemoryUsageMB: 512,
      maxRenderTimeMs: 16, // 60fps = 16.67ms per frame
      maxEventLoopLagMs: 10,
      maxInteractionResponseMs: 100,
      minFPS: 30,
      
      memoryHistorySize: 100,
      interactionHistorySize: 50,
      eventLoopHistorySize: 100,
      
      enableMemoryMonitoring: true,
      enableRenderTimeTracking: true,
      enableInteractionTracking: true,
      enableEventLoopMonitoring: true,
      enableFrameRateMonitoring: true,
      enableGarbageCollectionTrigger: true,
      
      ...config
    }
    
    this.metrics = this.initializeMetrics()
    this.setupPerformanceObserver()
  }
  
  private initializeMetrics(): PerformanceMetrics {
    return {
      renderTime: 0,
      componentRenderCount: 0,
      lastRenderTime: 0,
      averageRenderTime: 0,
      
      memoryUsage: this.getCurrentMemoryUsage(),
      memoryTrend: [],
      
      eventLoopLag: 0,
      eventLoopLagHistory: [],
      
      interactionResponseTime: 0,
      lastInteractionTime: 0,
      interactionHistory: [],
      
      componentUpdateCounts: new Map(),
      heaviestComponents: [],
      
      fps: 60,
      frameDropCount: 0,
      
      timestamp: Date.now()
    }
  }
  
  private setupPerformanceObserver() {
    if (typeof PerformanceObserver !== 'undefined') {
      this.performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        for (const entry of entries) {
          if (entry.entryType === 'measure') {
            this.handleMeasureEntry(entry)
          } else if (entry.entryType === 'navigation') {
            this.handleNavigationEntry(entry as PerformanceNavigationTiming)
          }
        }
      })
      
      try {
        this.performanceObserver.observe({ entryTypes: ['measure', 'navigation'] })
      } catch (error) {
        console.warn('Performance Observer not supported:', error)
      }
    }
  }
  
  private handleMeasureEntry(entry: PerformanceEntry) {
    if (entry.name.startsWith('react-render-')) {
      const componentName = entry.name.replace('react-render-', '')
      this.recordComponentRender(componentName, entry.duration)
    }
  }
  
  private handleNavigationEntry(entry: PerformanceNavigationTiming) {
    // Track page load performance if needed
    this.emit('navigation-performance', {
      loadTime: entry.loadEventEnd - entry.navigationStart,
      domContentLoaded: entry.domContentLoadedEventEnd - entry.navigationStart,
      firstPaint: entry.loadEventStart - entry.navigationStart
    })
  }
  
  public startMonitoring(): void {
    if (this.isMonitoring) {
      return
    }
    
    this.isMonitoring = true
    this.emit('monitoring-started')
    
    // Memory monitoring
    if (this.config.enableMemoryMonitoring) {
      const memoryInterval = setInterval(() => {
        this.updateMemoryMetrics()
      }, this.config.memoryCheckInterval)
      this.intervals.push(memoryInterval)
    }
    
    // Event loop lag monitoring
    if (this.config.enableEventLoopMonitoring) {
      const eventLoopInterval = setInterval(() => {
        this.measureEventLoopLag()
      }, this.config.eventLoopCheckInterval)
      this.intervals.push(eventLoopInterval)
    }
    
    // Frame rate monitoring
    if (this.config.enableFrameRateMonitoring) {
      this.startFrameRateMonitoring()
    }
    
    // Performance metrics update
    const metricsInterval = setInterval(() => {
      this.updateMetrics()
      this.checkThresholds()
      this.emit('metrics-updated', this.metrics)
    }, this.config.performanceUpdateInterval)
    this.intervals.push(metricsInterval)
    
    // Garbage collection monitoring (Node.js specific)
    if (this.config.enableGarbageCollectionTrigger && typeof global !== 'undefined' && global.gc) {
      const gcInterval = setInterval(() => {
        this.triggerGarbageCollectionIfNeeded()
      }, 5000)
      this.intervals.push(gcInterval)
    }
  }
  
  public stopMonitoring(): void {
    if (!this.isMonitoring) {
      return
    }
    
    this.isMonitoring = false
    this.intervals.forEach(interval => clearInterval(interval))
    this.intervals = []
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect()
    }
    
    this.emit('monitoring-stopped')
  }
  
  private getCurrentMemoryUsage(): MemoryMetrics {
    let memory: MemoryMetrics
    
    if (typeof process !== 'undefined' && process.memoryUsage) {
      // Node.js environment
      const nodeMemory = process.memoryUsage()
      memory = {
        heapUsed: nodeMemory.heapUsed,
        heapTotal: nodeMemory.heapTotal,
        external: nodeMemory.external,
        arrayBuffers: nodeMemory.arrayBuffers || 0,
        rss: nodeMemory.rss,
        heapUsedMB: Math.round(nodeMemory.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotalMB: Math.round(nodeMemory.heapTotal / 1024 / 1024 * 100) / 100,
        externalMB: Math.round(nodeMemory.external / 1024 / 1024 * 100) / 100,
        rssMB: Math.round(nodeMemory.rss / 1024 / 1024 * 100) / 100
      }
    } else if (typeof performance !== 'undefined' && 'memory' in performance) {
      // Browser environment (Chrome)
      const browserMemory = (performance as any).memory
      memory = {
        heapUsed: browserMemory.usedJSHeapSize || 0,
        heapTotal: browserMemory.totalJSHeapSize || 0,
        external: 0,
        arrayBuffers: 0,
        rss: 0,
        heapUsedMB: Math.round((browserMemory.usedJSHeapSize || 0) / 1024 / 1024 * 100) / 100,
        heapTotalMB: Math.round((browserMemory.totalJSHeapSize || 0) / 1024 / 1024 * 100) / 100,
        externalMB: 0,
        rssMB: 0
      }
    } else {
      // Fallback for environments without memory API
      memory = {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
        rss: 0,
        heapUsedMB: 0,
        heapTotalMB: 0,
        externalMB: 0,
        rssMB: 0
      }
    }
    
    return memory
  }
  
  private updateMemoryMetrics(): void {
    const currentMemory = this.getCurrentMemoryUsage()
    this.metrics.memoryUsage = currentMemory
    
    // Add to trend history
    const trendPoint: MemoryTrendPoint = {
      timestamp: Date.now(),
      heapUsed: currentMemory.heapUsed,
      heapTotal: currentMemory.heapTotal,
      external: currentMemory.external
    }
    
    this.metrics.memoryTrend.push(trendPoint)
    
    // Keep only recent history
    if (this.metrics.memoryTrend.length > this.config.memoryHistorySize) {
      this.metrics.memoryTrend.shift()
    }
  }
  
  private measureEventLoopLag(): void {
    const start = Date.now()
    setImmediate(() => {
      const lag = Date.now() - start
      this.metrics.eventLoopLag = lag
      this.metrics.eventLoopLagHistory.push(lag)
      
      // Keep only recent history
      if (this.metrics.eventLoopLagHistory.length > this.config.eventLoopHistorySize) {
        this.metrics.eventLoopLagHistory.shift()
      }
    })
  }
  
  private startFrameRateMonitoring(): void {
    let lastFrameTime = Date.now()
    let frameCount = 0
    let droppedFrames = 0
    
    const calculateFPS = () => {
      const currentTime = Date.now()
      frameCount++
      
      const deltaTime = currentTime - lastFrameTime
      
      // Expected 60fps = ~16.67ms per frame
      if (deltaTime > 20) { // Frame took longer than expected
        droppedFrames++
      }
      
      if (frameCount >= 60) { // Calculate FPS every 60 frames
        const fps = Math.round(1000 / (deltaTime / frameCount))
        this.metrics.fps = Math.min(fps, 60)
        this.metrics.frameDropCount = droppedFrames
        
        frameCount = 0
        droppedFrames = 0
        lastFrameTime = currentTime
      }
      
      if (this.isMonitoring) {
        requestAnimationFrame(calculateFPS)
      }
    }
    
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(calculateFPS)
    }
  }
  
  private triggerGarbageCollectionIfNeeded(): void {
    const memoryUsageMB = this.metrics.memoryUsage.heapUsedMB
    
    if (memoryUsageMB > this.config.maxMemoryUsageMB * 0.8) {
      // Trigger garbage collection if memory usage is high
      if (typeof global !== 'undefined' && global.gc) {
        try {
          global.gc()
          this.emit('garbage-collection-triggered', { 
            memoryBefore: memoryUsageMB,
            memoryAfter: this.getCurrentMemoryUsage().heapUsedMB
          })
        } catch (error) {
          console.warn('Failed to trigger garbage collection:', error)
        }
      }
    }
  }
  
  private updateMetrics(): void {
    // Update timestamp
    this.metrics.timestamp = Date.now()
    
    // Calculate averages
    if (this.metrics.memoryTrend.length > 0) {
      // Calculate memory trend (rate of change)
      const recent = this.metrics.memoryTrend.slice(-10)
      if (recent.length >= 2) {
        const slope = (recent[recent.length - 1].heapUsed - recent[0].heapUsed) / recent.length
        this.emit('memory-trend', { slope, trend: slope > 0 ? 'increasing' : 'decreasing' })
      }
    }
    
    if (this.metrics.eventLoopLagHistory.length > 0) {
      const avgLag = this.metrics.eventLoopLagHistory.reduce((a, b) => a + b, 0) / this.metrics.eventLoopLagHistory.length
      this.emit('event-loop-lag-average', avgLag)
    }
    
    // Update heaviest components
    this.updateHeaviestComponents()
  }
  
  private updateHeaviestComponents(): void {
    const components: ComponentPerformance[] = []
    
    for (const [name, count] of this.componentRenderCounts.entries()) {
      const renderTime = this.renderStartTimes.get(name) || 0
      components.push({
        name,
        renderCount: count,
        totalRenderTime: renderTime,
        averageRenderTime: renderTime / count,
        lastRenderTime: renderTime,
        memoryImpact: 0 // Will be calculated separately
      })
    }
    
    // Sort by total render time (heaviest first)
    components.sort((a, b) => b.totalRenderTime - a.totalRenderTime)
    this.metrics.heaviestComponents = components.slice(0, 10) // Top 10
  }
  
  private checkThresholds(): void {
    const alerts: PerformanceAlert[] = []
    
    // Memory threshold check
    if (this.metrics.memoryUsage.heapUsedMB > this.config.maxMemoryUsageMB) {
      alerts.push({
        type: 'memory',
        severity: this.metrics.memoryUsage.heapUsedMB > this.config.maxMemoryUsageMB * 1.5 ? 'critical' : 'high',
        message: `High memory usage: ${this.metrics.memoryUsage.heapUsedMB}MB`,
        value: this.metrics.memoryUsage.heapUsedMB,
        threshold: this.config.maxMemoryUsageMB,
        timestamp: Date.now(),
        suggestions: [
          'Consider implementing virtual scrolling for large lists',
          'Check for memory leaks in component lifecycle',
          'Optimize image and data caching strategies'
        ]
      })
    }
    
    // Render time threshold check
    if (this.metrics.lastRenderTime > this.config.maxRenderTimeMs) {
      alerts.push({
        type: 'render',
        severity: this.metrics.lastRenderTime > this.config.maxRenderTimeMs * 2 ? 'high' : 'medium',
        message: `Slow render detected: ${this.metrics.lastRenderTime}ms`,
        value: this.metrics.lastRenderTime,
        threshold: this.config.maxRenderTimeMs,
        timestamp: Date.now(),
        suggestions: [
          'Use React.memo for component optimization',
          'Implement useMemo for expensive calculations',
          'Check for unnecessary re-renders'
        ]
      })
    }
    
    // Event loop lag threshold check
    if (this.metrics.eventLoopLag > this.config.maxEventLoopLagMs) {
      alerts.push({
        type: 'eventLoop',
        severity: this.metrics.eventLoopLag > this.config.maxEventLoopLagMs * 3 ? 'high' : 'medium',
        message: `Event loop lag detected: ${this.metrics.eventLoopLag}ms`,
        value: this.metrics.eventLoopLag,
        threshold: this.config.maxEventLoopLagMs,
        timestamp: Date.now(),
        suggestions: [
          'Break up long-running operations',
          'Use setTimeout for heavy computations',
          'Optimize data processing algorithms'
        ]
      })
    }
    
    // FPS threshold check
    if (this.metrics.fps < this.config.minFPS) {
      alerts.push({
        type: 'fps',
        severity: this.metrics.fps < this.config.minFPS * 0.5 ? 'high' : 'medium',
        message: `Low frame rate: ${this.metrics.fps} FPS`,
        value: this.metrics.fps,
        threshold: this.config.minFPS,
        timestamp: Date.now(),
        suggestions: [
          'Reduce animation complexity',
          'Optimize rendering pipelines',
          'Check for layout thrashing'
        ]
      })
    }
    
    // Emit alerts
    if (alerts.length > 0) {
      this.emit('performance-alerts', alerts)
      alerts.forEach(alert => this.emit('performance-alert', alert))
    }
  }
  
  // Public API methods
  public startComponentRender(componentName: string): void {
    if (!this.config.enableRenderTimeTracking) return
    
    const startTime = performance.now()
    this.renderStartTimes.set(componentName, startTime)
    
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`react-render-${componentName}-start`)
    }
  }
  
  public endComponentRender(componentName: string): number {
    if (!this.config.enableRenderTimeTracking) return 0
    
    const startTime = this.renderStartTimes.get(componentName)
    if (!startTime) return 0
    
    const endTime = performance.now()
    const renderTime = endTime - startTime
    
    // Update metrics
    this.metrics.componentRenderCount++
    this.metrics.lastRenderTime = renderTime
    this.metrics.renderTime += renderTime
    this.metrics.averageRenderTime = this.metrics.renderTime / this.metrics.componentRenderCount
    
    // Update component-specific counts
    const currentCount = this.componentRenderCounts.get(componentName) || 0
    this.componentRenderCounts.set(componentName, currentCount + 1)
    
    if (typeof performance !== 'undefined' && performance.mark && performance.measure) {
      performance.mark(`react-render-${componentName}-end`)
      performance.measure(
        `react-render-${componentName}`,
        `react-render-${componentName}-start`,
        `react-render-${componentName}-end`
      )
    }
    
    this.renderStartTimes.delete(componentName)
    return renderTime
  }
  
  public recordComponentRender(componentName: string, renderTime: number): void {
    this.metrics.componentRenderCount++
    this.metrics.lastRenderTime = renderTime
    this.metrics.renderTime += renderTime
    this.metrics.averageRenderTime = this.metrics.renderTime / this.metrics.componentRenderCount
    
    const currentCount = this.componentRenderCounts.get(componentName) || 0
    this.componentRenderCounts.set(componentName, currentCount + 1)
  }
  
  public recordInteraction(type: InteractionMetric['type'], componentName?: string, actionDetails?: any): void {
    if (!this.config.enableInteractionTracking) return
    
    const now = performance.now()
    const responseTime = this.lastInteractionTime ? now - this.lastInteractionTime : 0
    
    const interaction: InteractionMetric = {
      type,
      timestamp: Date.now(),
      responseTime,
      componentName,
      actionDetails
    }
    
    this.metrics.interactionHistory.push(interaction)
    this.metrics.lastInteractionTime = now
    this.metrics.interactionResponseTime = responseTime
    
    // Keep only recent history
    if (this.metrics.interactionHistory.length > this.config.interactionHistorySize) {
      this.metrics.interactionHistory.shift()
    }
    
    this.lastInteractionTime = now
  }
  
  public getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }
  
  public getConfig(): PerformanceConfig {
    return { ...this.config }
  }
  
  public updateConfig(newConfig: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig }
    this.emit('config-updated', this.config)
  }
  
  public reset(): void {
    this.metrics = this.initializeMetrics()
    this.renderStartTimes.clear()
    this.componentRenderCounts.clear()
    this.lastInteractionTime = 0
    this.emit('metrics-reset')
  }
  
  public exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      config: this.config,
      exportTime: new Date().toISOString()
    }, null, 2)
  }
  
  public getPerformanceReport(): {
    summary: any
    recommendations: string[]
    criticalIssues: PerformanceAlert[]
  } {
    const criticalAlerts: PerformanceAlert[] = []
    const recommendations: string[] = []
    
    // Analyze performance and generate recommendations
    if (this.metrics.memoryUsage.heapUsedMB > this.config.maxMemoryUsageMB) {
      recommendations.push('Implement memory optimization strategies')
    }
    
    if (this.metrics.averageRenderTime > this.config.maxRenderTimeMs) {
      recommendations.push('Optimize component rendering with React.memo and useMemo')
    }
    
    if (this.metrics.eventLoopLag > this.config.maxEventLoopLagMs) {
      recommendations.push('Reduce blocking operations in the main thread')
    }
    
    if (this.metrics.fps < this.config.minFPS) {
      recommendations.push('Optimize animation and rendering performance')
    }
    
    return {
      summary: {
        memoryUsage: this.metrics.memoryUsage,
        averageRenderTime: this.metrics.averageRenderTime,
        eventLoopLag: this.metrics.eventLoopLag,
        fps: this.metrics.fps,
        componentRenderCount: this.metrics.componentRenderCount,
        heaviestComponents: this.metrics.heaviestComponents.slice(0, 5)
      },
      recommendations,
      criticalIssues: criticalAlerts
    }
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitorService()