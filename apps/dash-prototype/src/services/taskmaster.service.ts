import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { errorHandler, ErrorType } from './error-handler.service'
import { recoveryService } from './recovery.service'
import { fallbackDataService } from './fallback-data.service'
import { networkDiagnostics } from './network-diagnostics.service'
import { cliDiagnostics } from './cli-diagnostics.service'
import { offlineCache } from './offline-cache.service'
import { errorLogging } from './error-logging.service'

// Types for TaskMaster CLI responses
export interface TaskMasterTask {
  id: string
  title: string
  status: 'pending' | 'in-progress' | 'done' | 'review' | 'deferred' | 'cancelled'
  priority: 'low' | 'medium' | 'high'
  complexity: number | null
  dependencies: string[]
  subtasks?: TaskMasterSubtask[]
  description?: string
  created_at?: string
  updated_at?: string
  tags?: string[]
}

export interface TaskMasterSubtask {
  id: string
  title: string
  status: 'pending' | 'in-progress' | 'done'
  description?: string
  created_at?: string
  updated_at?: string
}

export interface TaskMasterStats {
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  pendingTasks: number
  blockedTasks: number
  deferredTasks: number
  cancelledTasks: number
  progressPercentage: number
  subtaskStats: {
    total: number
    completed: number
    inProgress: number
    pending: number
  }
  priorityBreakdown: {
    high: number
    medium: number
    low: number
  }
}

export interface TaskMasterNextTask {
  id: string | null
  title?: string
  priority?: string
  dependencies?: string[]
  complexity?: number
  available: boolean
  reason?: string
}

export interface TaskMasterComplexityReport {
  tasks: Array<{
    id: string
    title: string
    complexity: number
    recommendations?: string[]
    estimatedHours?: number
    riskLevel?: 'low' | 'medium' | 'high'
  }>
  averageComplexity: number
  highComplexityTasks: string[]
  recommendationsCount: number
  totalEstimatedHours: number
  complexityDistribution: {
    low: number
    medium: number
    high: number
  }
}

export interface TaskMasterAnalyticsData {
  complexityTrends: Array<{
    date: string
    averageComplexity: number
    taskCount: number
  }>
  completionTrends: Array<{
    date: string
    completed: number
    total: number
    completionRate: number
  }>
  bottlenecks: Array<{
    taskId: string
    title: string
    blockedTasks: string[]
    daysBlocked: number
    impact: 'low' | 'medium' | 'high'
  }>
  productivityMetrics: {
    tasksPerDay: number
    averageCompletionTime: number
    workloadDistribution: Record<string, number>
    burndownRate: number
  }
}

export interface TaskMasterHistoricalData {
  timestamp: string
  tasks: TaskMasterTask[]
  stats: TaskMasterStats
  complexityReport?: TaskMasterComplexityReport
}

export interface TaskMasterConfig {
  cliPath?: string
  workingDirectory?: string
  timeout?: number
  retryAttempts?: number
  retryDelay?: number
}

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

export interface TaskMasterCLIAvailability {
  available: boolean
  version?: string
  lastChecked: number
  error?: string
}

// Cache configuration
const CACHE_CONFIG = {
  LIST_TTL: 30000,           // 30 seconds for task lists
  STATS_TTL: 30000,          // 30 seconds for stats
  NEXT_TTL: 10000,           // 10 seconds for next task
  COMPLEXITY_TTL: 300000,    // 5 minutes for complexity reports
  ANALYTICS_TTL: 120000,     // 2 minutes for analytics data
  HISTORICAL_TTL: 600000,    // 10 minutes for historical data
  AVAILABILITY_TTL: 60000,   // 1 minute for CLI availability check
} as const

// Default configuration
const DEFAULT_CONFIG: Required<TaskMasterConfig> = {
  cliPath: 'task-master',
  workingDirectory: process.cwd(),
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
}

/**
 * TaskMaster CLI Service
 * 
 * Provides async integration with TaskMaster CLI including:
 * - Command execution with error handling
 * - Intelligent caching with TTL
 * - CLI availability detection
 * - Background refresh capabilities
 * - Graceful fallback mechanisms
 */
export class TaskMasterService extends EventEmitter {
  private config: Required<TaskMasterConfig>
  private cache = new Map<string, CacheEntry<any>>()
  private refreshInterval: NodeJS.Timeout | null = null
  private cliAvailability: TaskMasterCLIAvailability | null = null
  private backgroundRefreshEnabled = false
  private historicalDataStore: TaskMasterHistoricalData[] = []

  constructor(config: TaskMasterConfig = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    // Initial CLI availability check
    this.checkCLIAvailability().then(() => {
      this.emit('ready')
    }).catch((error) => {
      this.emit('error', new Error(`Failed to initialize TaskMaster service: ${error.message}`))
    })
  }

  /**
   * Check if TaskMaster CLI is available and working with enhanced diagnostics
   */
  async checkCLIAvailability(): Promise<TaskMasterCLIAvailability> {
    const cacheKey = 'cli_availability'
    const cached = this.getFromCache<TaskMasterCLIAvailability>(cacheKey)
    
    if (cached) {
      this.cliAvailability = cached
      return cached
    }

    try {
      // Perform comprehensive CLI diagnostics
      const diagnostics = await cliDiagnostics.performDiagnostics(this.config.cliPath)
      
      if (diagnostics.available && diagnostics.version) {
        const availability: TaskMasterCLIAvailability = {
          available: true,
          version: diagnostics.version,
          lastChecked: Date.now()
        }
        
        this.cliAvailability = availability
        this.setCache(cacheKey, availability, CACHE_CONFIG.AVAILABILITY_TTL)
        this.emit('cliAvailable', availability)
        
        await errorLogging.info('TaskMasterService', 'CLI available', {
          version: diagnostics.version,
          path: diagnostics.path
        })
        
        return availability
      } else {
        throw new Error(diagnostics.issues.map(issue => issue.message).join('; '))
      }
    } catch (error) {
      const taskMasterError = await errorHandler.handleError(error, {
        component: 'TaskMasterService',
        operation: 'checkCLIAvailability'
      })
      
      const availability: TaskMasterCLIAvailability = {
        available: false,
        lastChecked: Date.now(),
        error: taskMasterError.userFriendlyMessage
      }
      
      this.cliAvailability = availability
      this.setCache(cacheKey, availability, CACHE_CONFIG.AVAILABILITY_TTL)
      this.emit('cliUnavailable', availability)
      
      await errorLogging.logTaskMasterError(taskMasterError)
      
      return availability
    }
  }

  /**
   * Get current CLI availability status
   */
  getCLIAvailability(): TaskMasterCLIAvailability | null {
    return this.cliAvailability
  }

  /**
   * Check if CLI is currently available
   */
  isAvailable(): boolean {
    return this.cliAvailability?.available ?? false
  }

  /**
   * Get list of all tasks with enhanced error handling and fallbacks
   */
  async getTasks(): Promise<TaskMasterTask[]> {
    const operationId = 'getTasks'
    
    return await recoveryService.executeWithRecovery(
      async () => {
        const cacheKey = 'tasks_list'
        const cached = this.getFromCache<TaskMasterTask[]>(cacheKey)
        
        if (cached) {
          return cached
        }

        if (!this.isAvailable()) {
          // Try to get fallback data instead of throwing immediately
          const fallbackResult = await fallbackDataService.getTasks()
          if (fallbackResult.data.length > 0) {
            await errorLogging.info('TaskMasterService', 'Using fallback data for tasks', {
              source: fallbackResult.source,
              count: fallbackResult.data.length
            })
            return fallbackResult.data
          }
          throw new Error('TaskMaster CLI is not available and no fallback data exists')
        }

        const startTime = Date.now()
        const result = await this.executeCommand(['list', '--with-subtasks'])
        const tasks = this.parseTaskList(result.stdout)
        
        // Store in cache and offline storage
        this.setCache(cacheKey, tasks, CACHE_CONFIG.LIST_TTL)
        await offlineCache.set(cacheKey, tasks, { source: 'cli', ttl: CACHE_CONFIG.LIST_TTL })
        
        await errorLogging.logPerformance('getTasks', Date.now() - startTime, {
          taskCount: tasks.length,
          source: 'cli'
        })
        
        this.emit('tasksUpdated', tasks)
        return tasks
      },
      operationId,
      [
        {
          strategy: 'CACHE' as any,
          description: 'Use cached task data',
          autoExecute: true,
          action: async () => {
            const cachedData = await offlineCache.get<TaskMasterTask[]>('tasks_list')
            if (cachedData) {
              await errorLogging.info('TaskMasterService', 'Recovery: using cached tasks')
              return cachedData
            }
            throw new Error('No cached data available')
          }
        },
        {
          strategy: 'FALLBACK' as any,
          description: 'Use fallback data provider',
          autoExecute: true,
          action: async () => {
            const fallbackResult = await fallbackDataService.getTasks()
            await errorLogging.info('TaskMasterService', 'Recovery: using fallback tasks', {
              source: fallbackResult.source
            })
            return fallbackResult.data
          }
        }
      ]
    )
  }

  /**
   * Get task statistics with caching
   */
  async getStats(): Promise<TaskMasterStats> {
    const cacheKey = 'task_stats'
    const cached = this.getFromCache<TaskMasterStats>(cacheKey)
    
    if (cached) {
      return cached
    }

    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      const result = await this.executeCommand(['list'])
      const stats = this.parseTaskStats(result.stdout)
      
      this.setCache(cacheKey, stats, CACHE_CONFIG.STATS_TTL)
      this.emit('statsUpdated', stats)
      
      return stats
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Get next available task with caching
   */
  async getNextTask(): Promise<TaskMasterNextTask> {
    const cacheKey = 'next_task'
    const cached = this.getFromCache<TaskMasterNextTask>(cacheKey)
    
    if (cached) {
      return cached
    }

    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      const result = await this.executeCommand(['next'])
      const nextTask = this.parseNextTask(result.stdout)
      
      this.setCache(cacheKey, nextTask, CACHE_CONFIG.NEXT_TTL)
      this.emit('nextTaskUpdated', nextTask)
      
      return nextTask
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Get complexity report with caching
   */
  async getComplexityReport(): Promise<TaskMasterComplexityReport | null> {
    const cacheKey = 'complexity_report'
    const cached = this.getFromCache<TaskMasterComplexityReport>(cacheKey)
    
    if (cached) {
      return cached
    }

    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      const result = await this.executeCommand(['complexity-report'])
      const report = this.parseComplexityReport(result.stdout)
      
      if (report) {
        this.setCache(cacheKey, report, CACHE_CONFIG.COMPLEXITY_TTL)
        this.emit('complexityReportUpdated', report)
      }
      
      return report
    } catch (error) {
      // Complexity reports might not always be available, so don't emit error
      return null
    }
  }

  /**
   * Analyze task complexity patterns
   */
  async analyzeComplexity(): Promise<TaskMasterComplexityReport | null> {
    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      const result = await this.executeCommand(['analyze-complexity'])
      const analysis = this.parseComplexityAnalysis(result.stdout)
      
      if (analysis) {
        this.emit('complexityAnalysisUpdated', analysis)
      }
      
      return analysis
    } catch (error) {
      console.warn('Failed to analyze complexity:', error)
      return null
    }
  }

  /**
   * Get comprehensive analytics data
   */
  async getAnalyticsData(): Promise<TaskMasterAnalyticsData | null> {
    const cacheKey = 'analytics_data'
    const cached = this.getFromCache<TaskMasterAnalyticsData>(cacheKey)
    
    if (cached) {
      return cached
    }

    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      // Collect data from multiple sources
      const [tasks, stats, complexityReport] = await Promise.allSettled([
        this.getTasks(),
        this.getStats(),
        this.getComplexityReport()
      ])

      const analyticsData = this.generateAnalyticsFromData(
        tasks.status === 'fulfilled' ? tasks.value : [],
        stats.status === 'fulfilled' ? stats.value : null,
        complexityReport.status === 'fulfilled' ? complexityReport.value : null
      )

      if (analyticsData) {
        this.setCache(cacheKey, analyticsData, CACHE_CONFIG.ANALYTICS_TTL)
        this.emit('analyticsDataUpdated', analyticsData)
      }

      return analyticsData
    } catch (error) {
      console.warn('Failed to generate analytics data:', error)
      return null
    }
  }

  /**
   * Get historical data for trend analysis
   */
  getHistoricalData(): TaskMasterHistoricalData[] {
    return [...this.historicalDataStore]
  }

  /**
   * Store current state as historical data point
   */
  private async storeHistoricalDataPoint(): Promise<void> {
    try {
      const [tasks, stats, complexityReport] = await Promise.allSettled([
        this.getTasks(),
        this.getStats(),
        this.getComplexityReport()
      ])

      const dataPoint: TaskMasterHistoricalData = {
        timestamp: new Date().toISOString(),
        tasks: tasks.status === 'fulfilled' ? tasks.value : [],
        stats: stats.status === 'fulfilled' ? stats.value : {
          totalTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          pendingTasks: 0,
          blockedTasks: 0,
          deferredTasks: 0,
          cancelledTasks: 0,
          progressPercentage: 0,
          subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
          priorityBreakdown: { high: 0, medium: 0, low: 0 }
        },
        complexityReport: complexityReport.status === 'fulfilled' ? complexityReport.value || undefined : undefined
      }

      this.historicalDataStore.push(dataPoint)

      // Keep only last 100 data points to prevent memory issues
      if (this.historicalDataStore.length > 100) {
        this.historicalDataStore = this.historicalDataStore.slice(-100)
      }

      this.emit('historicalDataUpdated', dataPoint)
    } catch (error) {
      console.warn('Failed to store historical data point:', error)
    }
  }

  /**
   * Get detailed task information
   */
  async getTask(id: string): Promise<TaskMasterTask | null> {
    const cacheKey = `task_${id}`
    const cached = this.getFromCache<TaskMasterTask>(cacheKey)
    
    if (cached) {
      return cached
    }

    if (!this.isAvailable()) {
      throw new Error('TaskMaster CLI is not available')
    }

    try {
      const result = await this.executeCommand(['show', id])
      const task = this.parseTaskDetails(result.stdout)
      
      if (task) {
        this.setCache(cacheKey, task, CACHE_CONFIG.LIST_TTL)
        this.emit('taskUpdated', task)
      }
      
      return task
    } catch (error) {
      this.emit('error', error)
      return null
    }
  }

  /**
   * Start background refresh system
   */
  startBackgroundRefresh(intervalMs: number = 30000): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }

    this.backgroundRefreshEnabled = true
    this.refreshInterval = setInterval(async () => {
      if (!this.backgroundRefreshEnabled) return

      try {
        // Check CLI availability periodically
        await this.checkCLIAvailability()
        
        if (this.isAvailable()) {
          // Refresh cached data if near expiration
          await this.refreshCacheIfNeeded()
          
          // Store historical data point every 5 minutes
          const now = Date.now()
          const lastDataPoint = this.historicalDataStore[this.historicalDataStore.length - 1]
          const timeSinceLastPoint = lastDataPoint ? now - new Date(lastDataPoint.timestamp).getTime() : Infinity
          
          if (timeSinceLastPoint > 300000) { // 5 minutes
            await this.storeHistoricalDataPoint()
          }
        }
      } catch (error) {
        this.emit('error', error)
      }
    }, intervalMs)

    this.emit('backgroundRefreshStarted', intervalMs)
  }

  /**
   * Stop background refresh system
   */
  stopBackgroundRefresh(): void {
    this.backgroundRefreshEnabled = false
    
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }

    this.emit('backgroundRefreshStopped')
  }

  /**
   * Force refresh all cached data
   */
  async refreshAll(): Promise<void> {
    this.clearCache()
    
    if (!this.isAvailable()) {
      await this.checkCLIAvailability()
    }

    if (this.isAvailable()) {
      try {
        await Promise.allSettled([
          this.getTasks(),
          this.getStats(),
          this.getNextTask(),
          this.getComplexityReport(),
          this.getAnalyticsData()
        ])
      } catch (error) {
        this.emit('error', error)
      }
    }

    this.emit('refreshCompleted')
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear()
    this.emit('cacheCleared')
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    }
  }

  /**
   * Execute TaskMaster CLI command with enhanced error handling
   */
  private async executeCommand(
    args: string[], 
    options: { timeout?: number; retryAttempts?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const timeout = options.timeout ?? this.config.timeout
    const retryAttempts = options.retryAttempts ?? this.config.retryAttempts
    const command = `${this.config.cliPath} ${args.join(' ')}`

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        await errorLogging.debug('TaskMasterService', `Executing command (attempt ${attempt}/${retryAttempts})`, {
          command,
          timeout
        })
        
        const result = await this.executeCommandOnce(args, timeout)
        
        if (attempt > 1) {
          await errorLogging.info('TaskMasterService', `Command succeeded after ${attempt} attempts`, {
            command
          })
        }
        
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        await errorLogging.warn('TaskMasterService', `Command attempt ${attempt} failed`, {
          command,
          error: lastError.message,
          willRetry: attempt < retryAttempts
        })
        
        if (attempt < retryAttempts) {
          const delay = this.config.retryDelay * attempt
          await errorLogging.debug('TaskMasterService', `Waiting ${delay}ms before retry`)
          await this.delay(delay)
        }
      }
    }

    // All attempts failed, create comprehensive error
    const taskMasterError = errorHandler.createError(lastError || new Error('Command execution failed after retries'), {
      component: 'TaskMasterService',
      operation: 'executeCommand',
      retryCount: retryAttempts,
      workingDirectory: this.config.workingDirectory
    })
    
    await errorLogging.logTaskMasterError(taskMasterError)
    throw taskMasterError.originalError || taskMasterError
  }

  /**
   * Execute TaskMaster CLI command once
   */
  private executeCommandOnce(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.cliPath, args, {
        cwd: this.config.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let isTimedOut = false

      const timeoutId = setTimeout(() => {
        isTimedOut = true
        child.kill('SIGTERM')
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (isTimedOut) return

        clearTimeout(timeoutId)

        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`))
        }
      })

      child.on('error', (error) => {
        if (isTimedOut) return

        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Parse task list output from TaskMaster CLI
   */
  private parseTaskList(output: string): TaskMasterTask[] {
    const tasks: TaskMasterTask[] = []
    
    try {
      // Look for the table data in the output
      const lines = output.split('\n')
      let inTable = false
      
      for (const line of lines) {
        // Skip header and separator lines
        if (line.includes('┌────') || line.includes('├────') || line.includes('└────') || line.includes('│ ID ')) {
          inTable = true
          continue
        }
        
        if (inTable && line.trim() && line.includes('│')) {
          const task = this.parseTaskTableRow(line)
          if (task) {
            tasks.push(task)
          }
        }
      }
    } catch (error) {
      // If parsing fails, return empty array - graceful degradation
      console.warn('Failed to parse task list:', error)
    }
    
    return tasks
  }

  /**
   * Parse a single task table row
   */
  private parseTaskTableRow(line: string): TaskMasterTask | null {
    try {
      // Split by │ and clean up
      const parts = line.split('│').map(part => part.trim()).filter(part => part)
      
      if (parts.length < 6) return null
      
      const [id, title, status, priority, dependencies, complexity] = parts
      
      return {
        id: id.trim(),
        title: title.trim(),
        status: this.normalizeStatus(status.replace(/[✓⏳❌]/g, '').trim()),
        priority: this.normalizePriority(priority.trim()),
        dependencies: dependencies === 'None' ? [] : dependencies.split(',').map(d => d.trim()),
        complexity: complexity.includes('●') ? parseInt(complexity.replace(/[●\s]/g, '')) : null
      }
    } catch {
      return null
    }
  }

  /**
   * Parse task statistics from list output
   */
  private parseTaskStats(output: string): TaskMasterStats {
    const defaultStats: TaskMasterStats = {
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      pendingTasks: 0,
      blockedTasks: 0,
      deferredTasks: 0,
      cancelledTasks: 0,
      progressPercentage: 0,
      subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
      priorityBreakdown: { high: 0, medium: 0, low: 0 }
    }

    try {
      const lines = output.split('\n')
      
      for (const line of lines) {
        // Parse main task stats
        if (line.includes('Done:')) {
          const match = line.match(/Done:\s*(\d+)\s*In Progress:\s*(\d+)\s*Pending:\s*(\d+)\s*Blocked:\s*(\d+)\s*Deferred:\s*(\d+)/)
          if (match) {
            defaultStats.completedTasks = parseInt(match[1])
            defaultStats.inProgressTasks = parseInt(match[2])
            defaultStats.pendingTasks = parseInt(match[3])
            defaultStats.blockedTasks = parseInt(match[4])
            defaultStats.deferredTasks = parseInt(match[5])
          }
        }
        
        // Parse progress percentage
        if (line.includes('Progress:') && line.includes('%')) {
          const match = line.match(/(\d+)%/)
          if (match) {
            defaultStats.progressPercentage = parseInt(match[1])
          }
        }
        
        // Parse priority breakdown
        if (line.includes('High priority:')) {
          const match = line.match(/(\d+)/)
          if (match) defaultStats.priorityBreakdown.high = parseInt(match[1])
        }
        if (line.includes('Medium priority:')) {
          const match = line.match(/(\d+)/)
          if (match) defaultStats.priorityBreakdown.medium = parseInt(match[1])
        }
        if (line.includes('Low priority:')) {
          const match = line.match(/(\d+)/)
          if (match) defaultStats.priorityBreakdown.low = parseInt(match[1])
        }
        
        // Parse subtask stats
        if (line.includes('Completed:') && line.includes('/')) {
          const match = line.match(/Completed:\s*(\d+)\/(\d+)/)
          if (match) {
            defaultStats.subtaskStats.completed = parseInt(match[1])
            defaultStats.subtaskStats.total = parseInt(match[2])
          }
        }
      }
      
      defaultStats.totalTasks = defaultStats.completedTasks + defaultStats.inProgressTasks + 
        defaultStats.pendingTasks + defaultStats.blockedTasks + defaultStats.deferredTasks + defaultStats.cancelledTasks
    } catch (error) {
      console.warn('Failed to parse task stats:', error)
    }
    
    return defaultStats
  }

  /**
   * Parse next task from output
   */
  private parseNextTask(output: string): TaskMasterNextTask {
    const defaultNext: TaskMasterNextTask = {
      id: null,
      available: false,
      reason: 'No task available'
    }

    try {
      const lines = output.split('\n')
      
      for (const line of lines) {
        if (line.includes('No eligible')) {
          defaultNext.reason = 'No eligible tasks found'
          break
        }
        
        if (line.includes('ID:') && !line.includes('N/A')) {
          const match = line.match(/ID:\s*(\S+)/)
          if (match) {
            defaultNext.id = match[1]
            defaultNext.available = true
            defaultNext.reason = undefined
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse next task:', error)
    }
    
    return defaultNext
  }

  /**
   * Parse task details from show output
   */
  private parseTaskDetails(output: string): TaskMasterTask | null {
    // This would parse detailed task information
    // Implementation depends on the exact format of `task-master show <id>`
    // For now, return null as we don't have the exact format
    return null
  }

  /**
   * Parse complexity report
   */
  private parseComplexityReport(output: string): TaskMasterComplexityReport | null {
    try {
      const lines = output.split('\n')
      const tasks: TaskMasterComplexityReport['tasks'] = []
      let averageComplexity = 0
      let totalEstimatedHours = 0
      const complexityDistribution = { low: 0, medium: 0, high: 0 }
      
      let inTaskTable = false
      let totalComplexity = 0
      let taskCount = 0

      for (const line of lines) {
        // Detect start of task table
        if (line.includes('Task Complexity Analysis') || line.includes('┌───')) {
          inTaskTable = true
          continue
        }

        // Parse task rows
        if (inTaskTable && line.includes('│')) {
          const parts = line.split('│').map(p => p.trim()).filter(p => p)
          if (parts.length >= 4 && !parts[0].includes('ID')) {
            const [id, title, complexityStr, hours] = parts
            const complexity = parseInt(complexityStr.replace(/[●\s]/g, '')) || 0
            const estimatedHours = parseInt(hours) || 0

            if (complexity > 0) {
              const riskLevel: 'low' | 'medium' | 'high' = 
                complexity <= 3 ? 'low' : 
                complexity <= 7 ? 'medium' : 'high'

              tasks.push({
                id: id.trim(),
                title: title.trim(),
                complexity,
                estimatedHours,
                riskLevel,
                recommendations: this.generateComplexityRecommendations(complexity, riskLevel)
              })

              totalComplexity += complexity
              taskCount++
              totalEstimatedHours += estimatedHours

              // Update distribution
              if (complexity <= 3) complexityDistribution.low++
              else if (complexity <= 7) complexityDistribution.medium++
              else complexityDistribution.high++
            }
          }
        }

        // Parse summary statistics
        if (line.includes('Average Complexity:')) {
          const match = line.match(/(\d+\.?\d*)/)
          if (match) averageComplexity = parseFloat(match[1])
        }
      }

      // Calculate averages if not parsed
      if (averageComplexity === 0 && taskCount > 0) {
        averageComplexity = totalComplexity / taskCount
      }

      const highComplexityTasks = tasks
        .filter(task => task.complexity > 7)
        .map(task => task.id)

      return {
        tasks,
        averageComplexity,
        highComplexityTasks,
        recommendationsCount: tasks.reduce((count, task) => count + (task.recommendations?.length || 0), 0),
        totalEstimatedHours,
        complexityDistribution
      }
    } catch (error) {
      console.warn('Failed to parse complexity report:', error)
      return null
    }
  }

  /**
   * Parse complexity analysis output
   */
  private parseComplexityAnalysis(output: string): TaskMasterComplexityReport | null {
    // Similar to parseComplexityReport but for analyze-complexity command
    return this.parseComplexityReport(output)
  }

  /**
   * Generate recommendations based on complexity
   */
  private generateComplexityRecommendations(complexity: number, riskLevel: 'low' | 'medium' | 'high'): string[] {
    const recommendations: string[] = []

    if (complexity > 8) {
      recommendations.push('Consider breaking into smaller subtasks')
      recommendations.push('Assign to senior team member')
      recommendations.push('Allocate extra time for testing')
    } else if (complexity > 5) {
      recommendations.push('Review requirements carefully')
      recommendations.push('Plan for potential blockers')
    } else if (complexity > 3) {
      recommendations.push('Standard implementation approach')
    }

    if (riskLevel === 'high') {
      recommendations.push('Schedule regular check-ins')
      recommendations.push('Document assumptions and decisions')
    }

    return recommendations
  }

  /**
   * Generate analytics data from current state
   */
  private generateAnalyticsFromData(
    tasks: TaskMasterTask[],
    stats: TaskMasterStats | null,
    complexityReport: TaskMasterComplexityReport | null
  ): TaskMasterAnalyticsData | null {
    try {
      const now = new Date()
      const today = now.toISOString().split('T')[0]

      // Generate trends from historical data
      const complexityTrends = this.calculateComplexityTrends()
      const completionTrends = this.calculateCompletionTrends()

      // Identify bottlenecks
      const bottlenecks = this.identifyBottlenecks(tasks)

      // Calculate productivity metrics
      const productivityMetrics = this.calculateProductivityMetrics(tasks, stats)

      return {
        complexityTrends: complexityTrends.length > 0 ? complexityTrends : [{
          date: today,
          averageComplexity: complexityReport?.averageComplexity || 0,
          taskCount: tasks.length
        }],
        completionTrends: completionTrends.length > 0 ? completionTrends : [{
          date: today,
          completed: stats?.completedTasks || 0,
          total: stats?.totalTasks || 0,
          completionRate: stats?.progressPercentage || 0
        }],
        bottlenecks,
        productivityMetrics
      }
    } catch (error) {
      console.warn('Failed to generate analytics data:', error)
      return null
    }
  }

  /**
   * Calculate complexity trends from historical data
   */
  private calculateComplexityTrends(): Array<{ date: string; averageComplexity: number; taskCount: number }> {
    const trends: Array<{ date: string; averageComplexity: number; taskCount: number }> = []
    
    this.historicalDataStore.forEach(dataPoint => {
      const date = dataPoint.timestamp.split('T')[0]
      const complexitySum = dataPoint.tasks.reduce((sum, task) => sum + (task.complexity || 0), 0)
      const tasksWithComplexity = dataPoint.tasks.filter(task => task.complexity !== null)
      
      trends.push({
        date,
        averageComplexity: tasksWithComplexity.length > 0 ? complexitySum / tasksWithComplexity.length : 0,
        taskCount: dataPoint.tasks.length
      })
    })

    return trends
  }

  /**
   * Calculate completion trends from historical data
   */
  private calculateCompletionTrends(): Array<{ date: string; completed: number; total: number; completionRate: number }> {
    const trends: Array<{ date: string; completed: number; total: number; completionRate: number }> = []
    
    this.historicalDataStore.forEach(dataPoint => {
      const date = dataPoint.timestamp.split('T')[0]
      
      trends.push({
        date,
        completed: dataPoint.stats.completedTasks,
        total: dataPoint.stats.totalTasks,
        completionRate: dataPoint.stats.progressPercentage
      })
    })

    return trends
  }

  /**
   * Identify workflow bottlenecks
   */
  private identifyBottlenecks(tasks: TaskMasterTask[]): Array<{
    taskId: string;
    title: string;
    blockedTasks: string[];
    daysBlocked: number;
    impact: 'low' | 'medium' | 'high';
  }> {
    const bottlenecks: Array<{
      taskId: string;
      title: string;
      blockedTasks: string[];
      daysBlocked: number;
      impact: 'low' | 'medium' | 'high';
    }> = []

    // Find tasks that are blocking others
    tasks.forEach(task => {
      const blockedTasks = tasks.filter(t => 
        t.dependencies.includes(task.id) && 
        (task.status === 'pending' || task.status === 'in-progress')
      )

      if (blockedTasks.length > 0) {
        const daysBlocked = this.calculateDaysBlocked(task)
        const impact: 'low' | 'medium' | 'high' = 
          blockedTasks.length > 3 ? 'high' :
          blockedTasks.length > 1 ? 'medium' : 'low'

        bottlenecks.push({
          taskId: task.id,
          title: task.title,
          blockedTasks: blockedTasks.map(t => t.id),
          daysBlocked,
          impact
        })
      }
    })

    return bottlenecks.sort((a, b) => b.blockedTasks.length - a.blockedTasks.length)
  }

  /**
   * Calculate productivity metrics
   */
  private calculateProductivityMetrics(tasks: TaskMasterTask[], stats: TaskMasterStats | null): {
    tasksPerDay: number;
    averageCompletionTime: number;
    workloadDistribution: Record<string, number>;
    burndownRate: number;
  } {
    const completedTasks = tasks.filter(t => t.status === 'done')
    const daysOfData = this.historicalDataStore.length || 1

    const tasksPerDay = completedTasks.length / Math.max(daysOfData, 1)
    
    // Workload distribution by priority
    const workloadDistribution = {
      high: tasks.filter(t => t.priority === 'high').length,
      medium: tasks.filter(t => t.priority === 'medium').length,
      low: tasks.filter(t => t.priority === 'low').length
    }

    // Simple burndown rate calculation
    const burndownRate = stats ? (stats.completedTasks / stats.totalTasks) * 100 : 0

    return {
      tasksPerDay,
      averageCompletionTime: 2.5, // Placeholder - would need created/completed timestamps
      workloadDistribution,
      burndownRate
    }
  }

  /**
   * Calculate days a task has been blocked
   */
  private calculateDaysBlocked(task: TaskMasterTask): number {
    // Placeholder implementation - would need task history
    if (task.status === 'pending' && task.dependencies.length > 0) {
      return 3 // Assume 3 days for demo
    }
    return 0
  }

  /**
   * Normalize status values
   */
  private normalizeStatus(status: string): TaskMasterTask['status'] {
    const cleaned = status.replace(/[✓⏳❌►○]/g, '').trim().toLowerCase()
    
    // Check for special symbols first
    if (status.includes('✓')) return 'done'
    if (status.includes('⏳')) return 'in-progress'
    if (status.includes('►')) return 'in-progress'
    if (status.includes('○')) return 'pending'
    if (status.includes('❌')) return 'cancelled'
    
    // Check text content
    if (cleaned.includes('done') || cleaned.includes('completed')) return 'done'
    if (cleaned.includes('progress')) return 'in-progress'
    if (cleaned.includes('review')) return 'review'
    if (cleaned.includes('deferred')) return 'deferred'
    if (cleaned.includes('cancelled')) return 'cancelled'
    
    return 'pending'
  }

  /**
   * Normalize priority values
   */
  private normalizePriority(priority: string): TaskMasterTask['priority'] {
    const lower = priority.toLowerCase()
    if (lower.includes('high')) return 'high'
    if (lower.includes('low')) return 'low'
    return 'medium'
  }

  /**
   * Cache management methods
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * Refresh cache entries that are near expiration
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now()
    const refreshThreshold = 5000 // Refresh 5 seconds before expiration
    
    for (const [key, entry] of this.cache.entries()) {
      const timeUntilExpiry = (entry.timestamp + entry.ttl) - now
      
      if (timeUntilExpiry < refreshThreshold && timeUntilExpiry > 0) {
        try {
          if (key === 'tasks_list') {
            await this.getTasks()
          } else if (key === 'task_stats') {
            await this.getStats()
          } else if (key === 'next_task') {
            await this.getNextTask()
          }
        } catch (error) {
          // Ignore refresh errors for background updates
        }
      }
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopBackgroundRefresh()
    this.clearCache()
    this.removeAllListeners()
  }
}

// Export default instance
export const taskMasterService = new TaskMasterService()