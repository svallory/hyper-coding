import { EventEmitter } from 'events'
import { EpicDiscoveryService, EpicMetadata } from './epic-discovery.service'
import { TaskMasterService, TaskMasterTask, TaskMasterStats, TaskMasterNextTask } from './taskmaster.service'

export interface EpicContext {
  epic: EpicMetadata
  taskMasterService: TaskMasterService | null
  isActive: boolean
  lastAccessed: Date
  tasks: TaskMasterTask[]
  stats: TaskMasterStats | null
  nextTask: TaskMasterNextTask | null
  error: string | null
}

export interface EpicContextSwitchEvent {
  previousEpic: EpicMetadata | null
  currentEpic: EpicMetadata
  switchTime: Date
}

export class EpicContextManager extends EventEmitter {
  private contexts: Map<string, EpicContext> = new Map()
  private currentEpicPath: string | null = null
  private discoveryService: EpicDiscoveryService
  private readonly MAX_CACHED_CONTEXTS = 10

  constructor(epicRootPaths?: string[]) {
    super()
    this.discoveryService = new EpicDiscoveryService(epicRootPaths)
  }

  /**
   * Get all available epics
   */
  async getAvailableEpics(forceRefresh: boolean = false): Promise<EpicMetadata[]> {
    try {
      const epics = await this.discoveryService.discoverEpics(forceRefresh)
      this.emit('epicsDiscovered', epics)
      return epics
    } catch (error) {
      this.emit('error', new Error(`Failed to discover epics: ${error}`))
      return []
    }
  }

  /**
   * Switch to a specific epic context
   */
  async switchToEpic(epicPathOrName: string): Promise<EpicContext | null> {
    try {
      // Find the epic
      const epic = await this.discoveryService.getEpic(epicPathOrName)
      if (!epic) {
        throw new Error(`Epic not found: ${epicPathOrName}`)
      }

      if (!epic.isValid) {
        throw new Error(`Invalid epic: ${epic.errors.join(', ')}`)
      }

      const previousEpic = this.getCurrentEpic()
      const previousContext = this.getCurrentContext()

      // Pause previous context if it exists
      if (previousContext && previousContext.taskMasterService) {
        previousContext.taskMasterService.stopBackgroundRefresh()
        previousContext.isActive = false
      }

      // Get or create context for the new epic
      let context = this.contexts.get(epic.path)
      if (!context) {
        context = await this.createEpicContext(epic)
        this.contexts.set(epic.path, context)
      }

      // Activate the new context
      context.isActive = true
      context.lastAccessed = new Date()
      this.currentEpicPath = epic.path

      // Start TaskMaster service for the new context
      if (context.taskMasterService) {
        context.taskMasterService.startBackgroundRefresh()
        // Refresh data for the new context
        try {
          await context.taskMasterService.refreshAll()
          context.tasks = await context.taskMasterService.getTasks()
          context.stats = await context.taskMasterService.getStats()
          context.nextTask = await context.taskMasterService.getNextTask()
          context.error = null
        } catch (error) {
          context.error = `Failed to load TaskMaster data: ${error}`
        }
      }

      // Clean up old contexts if we have too many
      this.cleanupOldContexts()

      // Emit switch event
      const switchEvent: EpicContextSwitchEvent = {
        previousEpic,
        currentEpic: epic,
        switchTime: new Date()
      }
      this.emit('epicSwitched', switchEvent)
      this.emit('contextChanged', context)

      return context
    } catch (error) {
      this.emit('error', error)
      return null
    }
  }

  /**
   * Get the current active epic context
   */
  getCurrentContext(): EpicContext | null {
    if (!this.currentEpicPath) return null
    return this.contexts.get(this.currentEpicPath) || null
  }

  /**
   * Get the current active epic metadata
   */
  getCurrentEpic(): EpicMetadata | null {
    const context = this.getCurrentContext()
    return context ? context.epic : null
  }

  /**
   * Get all cached epic contexts
   */
  getCachedContexts(): EpicContext[] {
    return Array.from(this.contexts.values())
  }

  /**
   * Refresh the current epic context data
   */
  async refreshCurrentContext(): Promise<void> {
    const context = this.getCurrentContext()
    if (!context || !context.taskMasterService) return

    try {
      context.error = null
      await context.taskMasterService.refreshAll()
      context.tasks = await context.taskMasterService.getTasks()
      context.stats = await context.taskMasterService.getStats()
      context.nextTask = await context.taskMasterService.getNextTask()
      context.lastAccessed = new Date()
      
      this.emit('contextRefreshed', context)
    } catch (error) {
      context.error = `Failed to refresh context: ${error}`
      this.emit('error', error)
    }
  }

  /**
   * Remove an epic context from cache
   */
  removeContext(epicPath: string): boolean {
    const context = this.contexts.get(epicPath)
    if (!context) return false

    // Stop TaskMaster service if running
    if (context.taskMasterService) {
      context.taskMasterService.destroy()
    }

    // If this was the current context, clear current
    if (this.currentEpicPath === epicPath) {
      this.currentEpicPath = null
    }

    this.contexts.delete(epicPath)
    this.emit('contextRemoved', epicPath)
    return true
  }

  /**
   * Clear all cached contexts
   */
  clearAllContexts(): void {
    // Stop all TaskMaster services
    for (const context of this.contexts.values()) {
      if (context.taskMasterService) {
        context.taskMasterService.destroy()
      }
    }

    this.contexts.clear()
    this.currentEpicPath = null
    this.emit('allContextsCleared')
  }

  /**
   * Get statistics about the context manager
   */
  getStats() {
    const contexts = Array.from(this.contexts.values())
    return {
      totalContexts: contexts.length,
      activeContexts: contexts.filter(c => c.isActive).length,
      currentEpic: this.getCurrentEpic()?.name || null,
      memoryUsage: contexts.reduce((acc, ctx) => acc + ctx.tasks.length, 0),
      discoveryStats: this.discoveryService.getStats()
    }
  }

  /**
   * Create a new epic context
   */
  private async createEpicContext(epic: EpicMetadata): Promise<EpicContext> {
    const context: EpicContext = {
      epic,
      taskMasterService: null,
      isActive: false,
      lastAccessed: new Date(),
      tasks: [],
      stats: null,
      nextTask: null,
      error: null
    }

    // Create TaskMaster service for this epic
    try {
      context.taskMasterService = new TaskMasterService({
        workingDirectory: epic.path
      })

      // Set up event listeners for the TaskMaster service
      context.taskMasterService.on('tasksUpdated', (tasks: TaskMasterTask[]) => {
        context.tasks = tasks
        context.lastAccessed = new Date()
        this.emit('contextDataUpdated', context)
      })

      context.taskMasterService.on('statsUpdated', (stats: TaskMasterStats) => {
        context.stats = stats
        context.lastAccessed = new Date()
        this.emit('contextDataUpdated', context)
      })

      context.taskMasterService.on('nextTaskUpdated', (nextTask: TaskMasterNextTask) => {
        context.nextTask = nextTask
        context.lastAccessed = new Date()
        this.emit('contextDataUpdated', context)
      })

      context.taskMasterService.on('error', (error: Error) => {
        context.error = error.message
        this.emit('contextError', { context, error })
      })

    } catch (error) {
      context.error = `Failed to create TaskMaster service: ${error}`
    }

    this.emit('contextCreated', context)
    return context
  }

  /**
   * Clean up old contexts to prevent memory leaks
   */
  private cleanupOldContexts(): void {
    if (this.contexts.size <= this.MAX_CACHED_CONTEXTS) return

    // Sort contexts by last accessed time (oldest first)
    const sortedContexts = Array.from(this.contexts.entries())
      .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime())

    // Remove oldest contexts, but keep active ones
    const toRemove = sortedContexts
      .filter(([, context]) => !context.isActive)
      .slice(0, this.contexts.size - this.MAX_CACHED_CONTEXTS)

    for (const [path] of toRemove) {
      this.removeContext(path)
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearAllContexts()
    this.removeAllListeners()
  }
}

export default EpicContextManager