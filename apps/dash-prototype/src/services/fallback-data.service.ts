import { EventEmitter } from 'events'
import { TaskMasterTask, TaskMasterStats, TaskMasterNextTask, TaskMasterComplexityReport } from './taskmaster.service'

export interface FallbackDataConfig {
  enableStaticFallbacks: boolean
  enableEpicWorkflowIntegration: boolean
  enableMockData: boolean
  staticDataTTL: number
  epicDataTTL: number
  mockDataTTL: number
}

export interface EpicWorkflowData {
  tasks: Array<{
    id: string
    title: string
    status: string
    priority: string
    description?: string
    created_at?: string
    updated_at?: string
  }>
  stats: {
    totalTasks: number
    completedTasks: number
    inProgressTasks: number
    pendingTasks: number
  }
  projectInfo: {
    name: string
    description: string
    lastUpdate: string
  }
}

export interface FallbackDataSource {
  name: string
  priority: number
  available: boolean
  lastCheck: number
  dataTypes: string[]
  getTasks?: () => Promise<TaskMasterTask[]>
  getStats?: () => Promise<TaskMasterStats>
  getNextTask?: () => Promise<TaskMasterNextTask>
  getComplexityReport?: () => Promise<TaskMasterComplexityReport | null>
}

export interface DegradationLevel {
  level: 'none' | 'minimal' | 'moderate' | 'severe' | 'critical'
  description: string
  availableFeatures: string[]
  disabledFeatures: string[]
  dataQuality: 'high' | 'medium' | 'low' | 'minimal'
  userMessage: string
}

/**
 * Graceful degradation service with multiple fallback data providers
 * 
 * Features:
 * - Multiple fallback data sources with priority levels
 * - Epic workflow integration for project data
 * - Static fallback data for worst-case scenarios
 * - Mock data generators for development and testing
 * - Automatic degradation level assessment
 * - Feature availability management based on data sources
 * - Seamless switching between data sources
 */
export class FallbackDataService extends EventEmitter {
  private config: FallbackDataConfig
  private dataSources = new Map<string, FallbackDataSource>()
  private currentDegradationLevel: DegradationLevel
  private epicWorkflowData: EpicWorkflowData | null = null
  private staticFallbackData: any = null

  private readonly defaultConfig: FallbackDataConfig = {
    enableStaticFallbacks: true,
    enableEpicWorkflowIntegration: true,
    enableMockData: false,
    staticDataTTL: 86400000, // 24 hours
    epicDataTTL: 300000,     // 5 minutes
    mockDataTTL: 60000       // 1 minute
  }

  constructor(config: Partial<FallbackDataConfig> = {}) {
    super()
    this.config = { ...this.defaultConfig, ...config }
    
    this.currentDegradationLevel = {
      level: 'none',
      description: 'All systems operational',
      availableFeatures: ['tasks', 'stats', 'nextTask', 'complexityReport'],
      disabledFeatures: [],
      dataQuality: 'high',
      userMessage: 'Connected to TaskMaster CLI'
    }

    this.initializeFallbackSources()
  }

  /**
   * Register a fallback data source
   */
  registerDataSource(source: FallbackDataSource): void {
    this.dataSources.set(source.name, source)
    this.assessDegradationLevel()
    this.emit('dataSourceRegistered', source)
  }

  /**
   * Get tasks with graceful degradation
   */
  async getTasks(): Promise<{ data: TaskMasterTask[]; source: string; degradationLevel: DegradationLevel }> {
    const sources = this.getAvailableSourcesForType('tasks')
    
    for (const source of sources) {
      try {
        if (source.getTasks) {
          const data = await source.getTasks()
          this.emit('dataRetrieved', 'tasks', source.name, data)
          
          return {
            data,
            source: source.name,
            degradationLevel: this.currentDegradationLevel
          }
        }
      } catch (error) {
        this.emit('dataSourceError', source.name, 'tasks', error)
        source.available = false
        source.lastCheck = Date.now()
      }
    }

    // No sources available, return minimal fallback
    const minimalData = this.generateMinimalTaskData()
    this.updateDegradationLevel('critical')
    
    return {
      data: minimalData,
      source: 'minimal-fallback',
      degradationLevel: this.currentDegradationLevel
    }
  }

  /**
   * Get stats with graceful degradation
   */
  async getStats(): Promise<{ data: TaskMasterStats; source: string; degradationLevel: DegradationLevel }> {
    const sources = this.getAvailableSourcesForType('stats')
    
    for (const source of sources) {
      try {
        if (source.getStats) {
          const data = await source.getStats()
          this.emit('dataRetrieved', 'stats', source.name, data)
          
          return {
            data,
            source: source.name,
            degradationLevel: this.currentDegradationLevel
          }
        }
      } catch (error) {
        this.emit('dataSourceError', source.name, 'stats', error)
        source.available = false
        source.lastCheck = Date.now()
      }
    }

    // Generate stats from available task data if possible
    const taskResult = await this.getTasks()
    const statsFromTasks = this.generateStatsFromTasks(taskResult.data)
    
    return {
      data: statsFromTasks,
      source: 'generated-from-tasks',
      degradationLevel: this.currentDegradationLevel
    }
  }

  /**
   * Get next task with graceful degradation
   */
  async getNextTask(): Promise<{ data: TaskMasterNextTask; source: string; degradationLevel: DegradationLevel }> {
    const sources = this.getAvailableSourcesForType('nextTask')
    
    for (const source of sources) {
      try {
        if (source.getNextTask) {
          const data = await source.getNextTask()
          this.emit('dataRetrieved', 'nextTask', source.name, data)
          
          return {
            data,
            source: source.name,
            degradationLevel: this.currentDegradationLevel
          }
        }
      } catch (error) {
        this.emit('dataSourceError', source.name, 'nextTask', error)
        source.available = false
        source.lastCheck = Date.now()
      }
    }

    // Generate next task from available tasks
    const taskResult = await this.getTasks()
    const nextTask = this.generateNextTaskFromTasks(taskResult.data)
    
    return {
      data: nextTask,
      source: 'generated-from-tasks',
      degradationLevel: this.currentDegradationLevel
    }
  }

  /**
   * Get complexity report with graceful degradation
   */
  async getComplexityReport(): Promise<{ data: TaskMasterComplexityReport | null; source: string; degradationLevel: DegradationLevel }> {
    const sources = this.getAvailableSourcesForType('complexityReport')
    
    for (const source of sources) {
      try {
        if (source.getComplexityReport) {
          const data = await source.getComplexityReport()
          this.emit('dataRetrieved', 'complexityReport', source.name, data)
          
          return {
            data,
            source: source.name,
            degradationLevel: this.currentDegradationLevel
          }
        }
      } catch (error) {
        this.emit('dataSourceError', source.name, 'complexityReport', error)
        source.available = false
        source.lastCheck = Date.now()
      }
    }

    // Complexity reports are optional, return null
    return {
      data: null,
      source: 'not-available',
      degradationLevel: this.currentDegradationLevel
    }
  }

  /**
   * Update Epic workflow data
   */
  updateEpicWorkflowData(data: EpicWorkflowData): void {
    this.epicWorkflowData = data
    
    // Update Epic workflow data source availability
    const epicSource = this.dataSources.get('epic-workflow')
    if (epicSource) {
      epicSource.available = true
      epicSource.lastCheck = Date.now()
    }
    
    this.assessDegradationLevel()
    this.emit('epicWorkflowDataUpdated', data)
  }

  /**
   * Get current degradation level
   */
  getCurrentDegradationLevel(): DegradationLevel {
    return { ...this.currentDegradationLevel }
  }

  /**
   * Force degradation level for testing
   */
  forceDegradationLevel(level: DegradationLevel['level']): void {
    this.updateDegradationLevel(level)
    this.emit('degradationLevelForced', level)
  }

  /**
   * Check and refresh data source availability
   */
  async refreshDataSourceAvailability(): Promise<void> {
    const promises = Array.from(this.dataSources.values()).map(async (source) => {
      try {
        // Simple availability check - try to call one of the methods
        if (source.getTasks) {
          await source.getTasks()
          source.available = true
        } else if (source.getStats) {
          await source.getStats()
          source.available = true
        }
        source.lastCheck = Date.now()
      } catch {
        source.available = false
        source.lastCheck = Date.now()
      }
    })

    await Promise.allSettled(promises)
    this.assessDegradationLevel()
    this.emit('dataSourceAvailabilityRefreshed')
  }

  /**
   * Get fallback data statistics
   */
  getFallbackDataStatistics(): {
    totalSources: number
    availableSources: number
    degradationLevel: DegradationLevel
    sourceDetails: Array<{
      name: string
      available: boolean
      priority: number
      lastCheck: number
      dataTypes: string[]
    }>
  } {
    const sourceDetails = Array.from(this.dataSources.values()).map(source => ({
      name: source.name,
      available: source.available,
      priority: source.priority,
      lastCheck: source.lastCheck,
      dataTypes: [...source.dataTypes]
    }))

    return {
      totalSources: this.dataSources.size,
      availableSources: sourceDetails.filter(s => s.available).length,
      degradationLevel: this.getCurrentDegradationLevel(),
      sourceDetails
    }
  }

  // Private implementation methods

  private initializeFallbackSources(): void {
    // Epic workflow integration
    if (this.config.enableEpicWorkflowIntegration) {
      this.registerDataSource({
        name: 'epic-workflow',
        priority: 2,
        available: false,
        lastCheck: 0,
        dataTypes: ['tasks', 'stats'],
        getTasks: () => this.getTasksFromEpicWorkflow(),
        getStats: () => this.getStatsFromEpicWorkflow()
      })
    }

    // Static fallback data
    if (this.config.enableStaticFallbacks) {
      this.registerDataSource({
        name: 'static-fallback',
        priority: 3,
        available: true,
        lastCheck: Date.now(),
        dataTypes: ['tasks', 'stats', 'nextTask'],
        getTasks: () => this.getStaticFallbackTasks(),
        getStats: () => this.getStaticFallbackStats(),
        getNextTask: () => this.getStaticFallbackNextTask()
      })
    }

    // Mock data for development
    if (this.config.enableMockData) {
      this.registerDataSource({
        name: 'mock-data',
        priority: 4,
        available: true,
        lastCheck: Date.now(),
        dataTypes: ['tasks', 'stats', 'nextTask', 'complexityReport'],
        getTasks: () => this.getMockTasks(),
        getStats: () => this.getMockStats(),
        getNextTask: () => this.getMockNextTask(),
        getComplexityReport: () => this.getMockComplexityReport()
      })
    }
  }

  private getAvailableSourcesForType(dataType: string): FallbackDataSource[] {
    return Array.from(this.dataSources.values())
      .filter(source => source.available && source.dataTypes.includes(dataType))
      .sort((a, b) => a.priority - b.priority)
  }

  private assessDegradationLevel(): void {
    const availableSources = Array.from(this.dataSources.values()).filter(s => s.available)
    const totalSources = this.dataSources.size

    if (availableSources.length === 0) {
      this.updateDegradationLevel('critical')
    } else if (availableSources.length === 1 && availableSources[0].name === 'static-fallback') {
      this.updateDegradationLevel('severe')
    } else if (availableSources.length / totalSources < 0.5) {
      this.updateDegradationLevel('moderate')
    } else if (availableSources.some(s => s.name === 'epic-workflow' || s.name === 'static-fallback')) {
      this.updateDegradationLevel('minimal')
    } else {
      this.updateDegradationLevel('none')
    }
  }

  private updateDegradationLevel(level: DegradationLevel['level']): void {
    const degradationLevels: Record<DegradationLevel['level'], DegradationLevel> = {
      none: {
        level: 'none',
        description: 'All systems operational',
        availableFeatures: ['tasks', 'stats', 'nextTask', 'complexityReport', 'realtime'],
        disabledFeatures: [],
        dataQuality: 'high',
        userMessage: 'Connected to TaskMaster CLI'
      },
      minimal: {
        level: 'minimal',
        description: 'Minor service degradation',
        availableFeatures: ['tasks', 'stats', 'nextTask'],
        disabledFeatures: ['complexityReport', 'realtime'],
        dataQuality: 'high',
        userMessage: 'Some advanced features unavailable'
      },
      moderate: {
        level: 'moderate',
        description: 'Moderate service degradation',
        availableFeatures: ['tasks', 'stats'],
        disabledFeatures: ['nextTask', 'complexityReport', 'realtime'],
        dataQuality: 'medium',
        userMessage: 'Using Epic workflow data'
      },
      severe: {
        level: 'severe',
        description: 'Severe service degradation',
        availableFeatures: ['tasks'],
        disabledFeatures: ['stats', 'nextTask', 'complexityReport', 'realtime'],
        dataQuality: 'low',
        userMessage: 'Using static fallback data only'
      },
      critical: {
        level: 'critical',
        description: 'Critical service degradation',
        availableFeatures: [],
        disabledFeatures: ['tasks', 'stats', 'nextTask', 'complexityReport', 'realtime'],
        dataQuality: 'minimal',
        userMessage: 'Service temporarily unavailable'
      }
    }

    const newLevel = degradationLevels[level]
    const oldLevel = this.currentDegradationLevel.level
    
    this.currentDegradationLevel = newLevel
    
    if (oldLevel !== level) {
      this.emit('degradationLevelChanged', oldLevel, level, newLevel)
    }
  }

  // Epic workflow data methods
  private async getTasksFromEpicWorkflow(): Promise<TaskMasterTask[]> {
    if (!this.epicWorkflowData) {
      throw new Error('Epic workflow data not available')
    }

    return this.epicWorkflowData.tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: this.normalizeStatus(task.status),
      priority: this.normalizePriority(task.priority),
      dependencies: [],
      complexity: null,
      description: task.description,
      created_at: task.created_at,
      updated_at: task.updated_at
    }))
  }

  private async getStatsFromEpicWorkflow(): Promise<TaskMasterStats> {
    if (!this.epicWorkflowData) {
      throw new Error('Epic workflow data not available')
    }

    const { stats } = this.epicWorkflowData
    
    return {
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      inProgressTasks: stats.inProgressTasks,
      pendingTasks: stats.pendingTasks,
      blockedTasks: 0,
      deferredTasks: 0,
      cancelledTasks: 0,
      progressPercentage: stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0,
      subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
      priorityBreakdown: { high: 0, medium: stats.totalTasks, low: 0 }
    }
  }

  // Static fallback data methods
  private async getStaticFallbackTasks(): Promise<TaskMasterTask[]> {
    return [
      {
        id: 'epic-task-1',
        title: 'Epic Dashboard Development',
        status: 'in-progress',
        priority: 'high',
        dependencies: [],
        complexity: 8,
        description: 'Developing comprehensive Epic progress tracking dashboard'
      },
      {
        id: 'epic-task-2',
        title: 'TaskMaster Integration',
        status: 'done',
        priority: 'high',
        dependencies: [],
        complexity: 6,
        description: 'Integrating with TaskMaster CLI for task management'
      },
      {
        id: 'epic-task-3',
        title: 'Error Handling Implementation',
        status: 'in-progress',
        priority: 'medium',
        dependencies: ['epic-task-2'],
        complexity: 7,
        description: 'Implementing comprehensive error handling and fallback systems'
      }
    ]
  }

  private async getStaticFallbackStats(): Promise<TaskMasterStats> {
    return {
      totalTasks: 3,
      completedTasks: 1,
      inProgressTasks: 2,
      pendingTasks: 0,
      blockedTasks: 0,
      deferredTasks: 0,
      cancelledTasks: 0,
      progressPercentage: 33,
      subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
      priorityBreakdown: { high: 2, medium: 1, low: 0 }
    }
  }

  private async getStaticFallbackNextTask(): Promise<TaskMasterNextTask> {
    return {
      id: 'epic-task-3',
      title: 'Error Handling Implementation',
      priority: 'medium',
      dependencies: ['epic-task-2'],
      complexity: 7,
      available: true
    }
  }

  // Mock data methods (for development)
  private async getMockTasks(): Promise<TaskMasterTask[]> {
    const mockTasks: TaskMasterTask[] = []
    
    for (let i = 1; i <= 10; i++) {
      mockTasks.push({
        id: `mock-task-${i}`,
        title: `Mock Task ${i}`,
        status: ['pending', 'in-progress', 'done'][Math.floor(Math.random() * 3)] as TaskMasterTask['status'],
        priority: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as TaskMasterTask['priority'],
        dependencies: [],
        complexity: Math.floor(Math.random() * 10) + 1
      })
    }
    
    return mockTasks
  }

  private async getMockStats(): Promise<TaskMasterStats> {
    return {
      totalTasks: 10,
      completedTasks: 3,
      inProgressTasks: 4,
      pendingTasks: 3,
      blockedTasks: 0,
      deferredTasks: 0,
      cancelledTasks: 0,
      progressPercentage: 30,
      subtaskStats: { total: 15, completed: 8, inProgress: 5, pending: 2 },
      priorityBreakdown: { high: 2, medium: 5, low: 3 }
    }
  }

  private async getMockNextTask(): Promise<TaskMasterNextTask> {
    return {
      id: 'mock-task-next',
      title: 'Mock Next Task',
      priority: 'medium',
      dependencies: [],
      complexity: 5,
      available: true
    }
  }

  private async getMockComplexityReport(): Promise<TaskMasterComplexityReport> {
    return {
      tasks: [
        { id: 'mock-task-1', title: 'Complex Task 1', complexity: 9, recommendations: ['Break into subtasks'] },
        { id: 'mock-task-2', title: 'Complex Task 2', complexity: 8, recommendations: ['Add dependencies'] }
      ],
      averageComplexity: 5.5,
      highComplexityTasks: ['mock-task-1', 'mock-task-2'],
      recommendationsCount: 2
    }
  }

  // Utility methods
  private generateMinimalTaskData(): TaskMasterTask[] {
    return [
      {
        id: 'minimal-1',
        title: 'Service Temporarily Unavailable',
        status: 'pending',
        priority: 'high',
        dependencies: [],
        complexity: null,
        description: 'TaskMaster service is temporarily unavailable. Please try again later.'
      }
    ]
  }

  private generateStatsFromTasks(tasks: TaskMasterTask[]): TaskMasterStats {
    const statusCounts = tasks.reduce((counts, task) => {
      counts[task.status] = (counts[task.status] || 0) + 1
      return counts
    }, {} as Record<string, number>)

    const priorityCounts = tasks.reduce((counts, task) => {
      counts[task.priority] = (counts[task.priority] || 0) + 1
      return counts
    }, {} as Record<string, number>)

    const completed = statusCounts['done'] || 0
    const total = tasks.length

    return {
      totalTasks: total,
      completedTasks: completed,
      inProgressTasks: statusCounts['in-progress'] || 0,
      pendingTasks: statusCounts['pending'] || 0,
      blockedTasks: 0,
      deferredTasks: statusCounts['deferred'] || 0,
      cancelledTasks: statusCounts['cancelled'] || 0,
      progressPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
      priorityBreakdown: {
        high: priorityCounts['high'] || 0,
        medium: priorityCounts['medium'] || 0,
        low: priorityCounts['low'] || 0
      }
    }
  }

  private generateNextTaskFromTasks(tasks: TaskMasterTask[]): TaskMasterNextTask {
    const availableTasks = tasks.filter(task => 
      task.status === 'pending' && 
      task.dependencies.length === 0
    )

    if (availableTasks.length === 0) {
      return {
        id: null,
        available: false,
        reason: 'No available tasks found'
      }
    }

    // Sort by priority and complexity
    availableTasks.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const aPriority = priorityOrder[a.priority]
      const bPriority = priorityOrder[b.priority]
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }
      
      return (a.complexity || 0) - (b.complexity || 0)
    })

    const nextTask = availableTasks[0]
    
    return {
      id: nextTask.id,
      title: nextTask.title,
      priority: nextTask.priority,
      dependencies: nextTask.dependencies,
      complexity: nextTask.complexity,
      available: true
    }
  }

  private normalizeStatus(status: string): TaskMasterTask['status'] {
    const lower = status.toLowerCase()
    if (lower.includes('done') || lower.includes('completed')) return 'done'
    if (lower.includes('progress')) return 'in-progress'
    if (lower.includes('review')) return 'review'
    if (lower.includes('deferred')) return 'deferred'
    if (lower.includes('cancelled')) return 'cancelled'
    return 'pending'
  }

  private normalizePriority(priority: string): TaskMasterTask['priority'] {
    const lower = priority.toLowerCase()
    if (lower.includes('high')) return 'high'
    if (lower.includes('low')) return 'low'
    return 'medium'
  }
}

// Export default instance
export const fallbackDataService = new FallbackDataService()