/**
 * Step Executor for Recipe Step System
 * 
 * Orchestrates the execution of recipe steps with proper dependency management,
 * conditional logic, and parallel execution capabilities. This is the core
 * coordination layer that brings together all recipe tools.
 */

import createDebug from 'debug'
import { EventEmitter } from 'events'
import { ToolRegistry, getToolRegistry } from './tools/registry.js'
import { Tool } from './tools/base.js'
import { ErrorHandler, ErrorCode, HypergenError } from '../errors/hypergen-errors.js'
import Logger from '../logger.js'
import {
  RecipeStepUnion,
  StepContext,
  StepResult,
  StepStatus,
  ToolType,
  RecipeExecutionPlan,
  StepDependencyNode,
  StepExecutionOptions,
  TemplateStep,
  ActionStep,
  CodeModStep,
  RecipeStep,
  isTemplateStep,
  isActionStep,
  isCodeModStep,
  isRecipeStep,
  isShellStep,
  isPromptStep,
  isSequenceStep,
  isParallelStep,
  StepExecutionError,
  CircularDependencyError
} from './types.js'

const debug = createDebug('hypergen:v8:recipe:step-executor')

/**
 * Step execution metrics and progress tracking
 */
export interface StepExecutionMetrics {
  /** Total execution time in milliseconds */
  totalExecutionTime: number
  
  /** Individual step execution times */
  stepExecutionTimes: Map<string, number>
  
  /** Memory usage statistics */
  memoryUsage: {
    /** Peak memory usage during execution */
    peak: number
    /** Average memory usage */
    average: number
    /** Memory at start */
    start: number
    /** Memory at end */
    end: number
  }
  
  /** Parallelization statistics */
  parallelization: {
    /** Maximum concurrent steps */
    maxConcurrentSteps: number
    /** Average concurrent steps */
    averageConcurrentSteps: number
    /** Total parallel execution phases */
    parallelPhases: number
  }
  
  /** Error and retry statistics */
  errors: {
    /** Total number of step failures */
    totalFailures: number
    /** Total number of retries performed */
    totalRetries: number
    /** Steps that failed permanently */
    permanentFailures: string[]
    /** Steps that succeeded after retries */
    recoveredAfterRetries: string[]
  }
  
  /** Dependency resolution statistics */
  dependencies: {
    /** Total dependency resolution time */
    resolutionTime: number
    /** Number of dependency cycles detected */
    cyclesDetected: number
    /** Dependency depth levels */
    maxDepth: number
  }
}

/**
 * Step execution progress information
 */
export interface StepExecutionProgress {
  /** Current phase being executed */
  currentPhase: number
  
  /** Total number of phases */
  totalPhases: number
  
  /** Steps currently running */
  runningSteps: string[]
  
  /** Steps completed successfully */
  completedSteps: string[]
  
  /** Steps that failed */
  failedSteps: string[]
  
  /** Steps that were skipped */
  skippedSteps: string[]
  
  /** Overall progress percentage (0-100) */
  progressPercentage: number
  
  /** Current execution phase description */
  phaseDescription: string
  
  /** Estimated remaining time in milliseconds */
  estimatedRemainingTime?: number
}

/**
 * Step execution configuration
 */
export interface StepExecutorConfig {
  /** Maximum number of concurrent step executions */
  maxConcurrency: number
  
  /** Default timeout for step execution in milliseconds */
  defaultTimeout: number
  
  /** Default number of retry attempts */
  defaultRetries: number
  
  /** Whether to continue execution if a step fails */
  continueOnError: boolean
  
  /** Whether to enable parallel execution */
  enableParallelExecution: boolean
  
  /** Whether to collect detailed execution metrics */
  collectMetrics: boolean
  
  /** Whether to enable progress tracking */
  enableProgressTracking: boolean
  
  /** Memory threshold for warnings (in MB) */
  memoryWarningThreshold: number
  
  /** Step execution timeout safety factor */
  timeoutSafetyFactor: number
}

/**
 * Default step executor configuration
 */
const DEFAULT_CONFIG: StepExecutorConfig = {
  maxConcurrency: 10,
  defaultTimeout: 30000, // 30 seconds
  defaultRetries: 3,
  continueOnError: false,
  enableParallelExecution: true,
  collectMetrics: true,
  enableProgressTracking: true,
  memoryWarningThreshold: 1024, // 1GB
  timeoutSafetyFactor: 1.2
}

/**
 * Step Executor for orchestrating recipe step execution
 * 
 * The StepExecutor is responsible for:
 * - Managing step dependencies and execution order
 * - Coordinating parallel step execution
 * - Evaluating conditional expressions
 * - Routing steps to appropriate tools
 * - Handling errors and retries
 * - Tracking execution progress and metrics
 */
export class StepExecutor extends EventEmitter {
  private readonly toolRegistry: ToolRegistry
  private readonly logger: Logger
  private readonly debug: ReturnType<typeof createDebug>
  private readonly config: StepExecutorConfig
  
  // Execution state
  private readonly activeExecutions = new Map<string, Promise<StepResult[]>>()
  private readonly runningSteps = new Map<string, { step: RecipeStepUnion; startTime: Date; tool: Tool }>()
  private executionCounter = 0
  
  // Metrics and progress tracking
  private metrics?: StepExecutionMetrics
  private progress?: StepExecutionProgress
  
  constructor(
    toolRegistry?: ToolRegistry,
    config: Partial<StepExecutorConfig> = {}
  ) {
    super()
    
    this.toolRegistry = toolRegistry || getToolRegistry()
    this.logger = new Logger(console.log)
    this.debug = createDebug('hypergen:v8:recipe:step-executor')
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    this.debug('Step executor initialized with config: %o', this.config)
  }

  /**
   * Execute a list of recipe steps with dependency management and parallel execution
   */
  async executeSteps(
    steps: RecipeStepUnion[],
    context: StepContext,
    options: StepExecutionOptions = {}
  ): Promise<StepResult[]> {
    const executionId = this.generateExecutionId()
    const startTime = Date.now()
    
    this.debug('Starting step execution [%s] with %d steps', executionId, steps.length)
    this.emit('execution:started', { executionId, steps: steps.length })
    
    try {
      // Initialize metrics and progress tracking
      if (this.config.collectMetrics) {
        this.initializeMetrics()
      }
      
      if (this.config.enableProgressTracking) {
        this.initializeProgress(steps.length)
      }
      
      // Validate steps and context
      this.validateSteps(steps)
      this.validateContext(context)
      
      // Create execution plan with dependency resolution
      const executionPlan = await this.createExecutionPlan(steps, context)
      
      this.debug('Execution plan created: %d phases', executionPlan.phases.length)
      this.emit('execution:plan-created', { executionId, plan: executionPlan })
      
      // Execute phases sequentially, steps within phases potentially in parallel
      const results = await this.executeExecutionPlan(executionPlan, context, options, executionId)
      
      // Finalize metrics
      if (this.config.collectMetrics && this.metrics) {
        this.metrics.totalExecutionTime = Date.now() - startTime
        this.finalizeMetrics()
      }
      
      this.debug('Step execution completed [%s] in %dms', executionId, Date.now() - startTime)
      this.emit('execution:completed', { 
        executionId, 
        results, 
        duration: Date.now() - startTime,
        metrics: this.metrics 
      })
      
      return results
      
    } catch (error) {
      this.debug('Step execution failed [%s]: %s', executionId, 
        error instanceof Error ? error.message : String(error))
      
      this.emit('execution:failed', { 
        executionId, 
        error, 
        duration: Date.now() - startTime 
      })
      
      if (error instanceof HypergenError) {
        throw error
      }
      
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Step execution failed: ${error instanceof Error ? error.message : String(error)}`,
        { executionId, steps: steps.length }
      )
      
    } finally {
      this.activeExecutions.delete(executionId)
    }
  }

  /**
   * Execute a single step with proper tool routing
   */
  async executeStep(
    step: RecipeStepUnion,
    context: StepContext,
    options: StepExecutionOptions = {}
  ): Promise<StepResult> {
    const stepStartTime = Date.now()
    const stepResult: StepResult = {
      status: 'pending',
      stepName: step.name,
      toolType: step.tool,
      startTime: new Date(),
      retryCount: 0,
      dependenciesSatisfied: true, // Single step execution assumes deps are satisfied
      conditionResult: true
    }
    
    this.debug('Executing single step: %s (%s)', step.name, step.tool)
    this.emit('step:started', { step: step.name, toolType: step.tool })
    
    try {
      stepResult.status = 'running'
      
      // Evaluate condition if present
      if (step.when) {
        stepResult.conditionResult = context.evaluateCondition(step.when, context.variables)
        
        if (!stepResult.conditionResult) {
          this.debug('Step condition not met, skipping: %s', step.name)
          stepResult.status = 'skipped'
          stepResult.endTime = new Date()
          stepResult.duration = Date.now() - stepStartTime
          
          this.emit('step:skipped', { step: step.name, condition: step.when })
          return stepResult
        }
      }
      
      // Execute step with retries
      const maxRetries = options.retries ?? step.retries ?? this.config.defaultRetries
      let lastError: Error | undefined
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          stepResult.retryCount = attempt
          
          if (attempt > 0) {
            this.debug('Retrying step: %s (attempt %d/%d)', step.name, attempt + 1, maxRetries + 1)
            await this.delay(this.calculateRetryDelay(attempt))
          }
          
          // Route to appropriate tool and execute
          const toolResult = await this.routeAndExecuteStep(step, context, options)
          
          stepResult.toolResult = toolResult
          stepResult.status = 'completed'
          stepResult.endTime = new Date()
          stepResult.duration = Date.now() - stepStartTime
          
          // Extract file changes from tool result
          this.extractFileChanges(stepResult, toolResult)
          
          this.debug('Step completed successfully: %s in %dms', step.name, stepResult.duration)
          this.emit('step:completed', { 
            step: step.name, 
            toolType: step.tool, 
            duration: stepResult.duration,
            retries: attempt 
          })
          
          return stepResult
          
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          
          if (attempt < maxRetries) {
            this.debug('Step failed, will retry: %s - %s', step.name, lastError.message)
            this.emit('step:retry', { step: step.name, attempt: attempt + 1, error: lastError })
          }
        }
      }
      
      // All retries exhausted
      stepResult.status = 'failed'
      stepResult.endTime = new Date()
      stepResult.duration = Date.now() - stepStartTime
      stepResult.error = {
        message: lastError?.message || 'Step execution failed',
        stack: lastError?.stack,
        cause: lastError
      }
      
      this.debug('Step failed permanently: %s after %d retries', step.name, maxRetries)
      this.emit('step:failed', { 
        step: step.name, 
        toolType: step.tool, 
        error: lastError,
        retries: maxRetries 
      })
      
      throw new StepExecutionError(
        `Step '${step.name}' failed after ${maxRetries} retries: ${lastError?.message}`,
        step.name,
        step.tool,
        lastError
      )
      
    } catch (error) {
      if (stepResult.status !== 'failed') {
        stepResult.status = 'failed'
        stepResult.endTime = new Date()
        stepResult.duration = Date.now() - stepStartTime
        stepResult.error = {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          cause: error
        }
      }
      
      throw error
    }
  }

  /**
   * Get current execution metrics
   */
  getMetrics(): StepExecutionMetrics | undefined {
    return this.metrics
  }

  /**
   * Get current execution progress
   */
  getProgress(): StepExecutionProgress | undefined {
    return this.progress
  }

  /**
   * Cancel all running executions
   */
  async cancelAllExecutions(): Promise<void> {
    this.debug('Cancelling all running executions')
    
    const promises: Promise<void>[] = []
    
    for (const [executionId] of this.activeExecutions) {
      promises.push(this.cancelExecution(executionId))
    }
    
    await Promise.allSettled(promises)
  }

  /**
   * Cancel a specific execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    this.debug('Cancelling execution: %s', executionId)
    
    // Cancel all running steps for this execution
    for (const [stepName, stepInfo] of this.runningSteps) {
      if (stepName.startsWith(executionId)) {
        try {
          await stepInfo.tool.cleanup()
        } catch (error) {
          this.debug('Error cleaning up step during cancellation: %s - %s', 
            stepName, error instanceof Error ? error.message : String(error))
        }
      }
    }
    
    this.emit('execution:cancelled', { executionId })
  }

  // Private implementation methods

  private async createExecutionPlan(
    steps: RecipeStepUnion[],
    context: StepContext
  ): Promise<RecipeExecutionPlan> {
    const startTime = Date.now()
    
    // Build dependency graph
    const dependencyGraph = this.buildDependencyGraph(steps)
    
    // Detect circular dependencies
    this.detectCircularDependencies(dependencyGraph)
    
    // Create execution phases using topological sort
    const phases = this.createExecutionPhases(steps, dependencyGraph)
    
    const plan: RecipeExecutionPlan = {
      recipe: {
        name: context.recipe.name,
        description: 'Recipe execution plan',
        version: context.recipe.version,
        author: undefined,
        category: undefined,
        tags: [],
        variables: context.recipeVariables,
        steps,
        examples: [],
        dependencies: [],
        outputs: []
      },
      phases,
      dependencyGraph,
      estimatedDuration: this.estimateExecutionDuration(steps)
    }
    
    if (this.config.collectMetrics && this.metrics) {
      this.metrics.dependencies.resolutionTime = Date.now() - startTime
    }
    
    return plan
  }

  private buildDependencyGraph(steps: RecipeStepUnion[]): Map<string, StepDependencyNode> {
    const graph = new Map<string, StepDependencyNode>()
    
    // Initialize nodes
    for (const step of steps) {
      graph.set(step.name, {
        stepName: step.name,
        dependencies: step.dependsOn || [],
        dependents: [],
        priority: 0,
        parallelizable: step.parallel ?? true
      })
    }
    
    // Build dependent relationships
    for (const [stepName, node] of graph) {
      for (const depName of node.dependencies) {
        const depNode = graph.get(depName)
        if (depNode) {
          depNode.dependents.push(stepName)
        }
      }
    }
    
    // Calculate priority based on dependency depth
    this.calculatePriorities(graph)
    
    return graph
  }

  private calculatePriorities(graph: Map<string, StepDependencyNode>): void {
    const visited = new Set<string>()
    
    const calculatePriority = (stepName: string): number => {
      if (visited.has(stepName)) {
        return graph.get(stepName)!.priority
      }
      
      visited.add(stepName)
      const node = graph.get(stepName)!
      
      if (node.dependencies.length === 0) {
        node.priority = 0
        return 0
      }
      
      let maxDepPriority = -1
      for (const depName of node.dependencies) {
        const depPriority = calculatePriority(depName)
        maxDepPriority = Math.max(maxDepPriority, depPriority)
      }
      
      node.priority = maxDepPriority + 1
      return node.priority
    }
    
    for (const stepName of graph.keys()) {
      calculatePriority(stepName)
    }
  }

  private detectCircularDependencies(graph: Map<string, StepDependencyNode>): void {
    const visited = new Set<string>()
    const visiting = new Set<string>()
    
    const visit = (stepName: string, path: string[] = []): void => {
      if (visiting.has(stepName)) {
        const cycle = [...path, stepName]
        throw new CircularDependencyError(
          `Circular dependency detected: ${cycle.join(' -> ')}`,
          cycle
        )
      }
      
      if (visited.has(stepName)) {
        return
      }
      
      visiting.add(stepName)
      const node = graph.get(stepName)!
      
      for (const depName of node.dependencies) {
        visit(depName, [...path, stepName])
      }
      
      visiting.delete(stepName)
      visited.add(stepName)
    }
    
    for (const stepName of graph.keys()) {
      visit(stepName)
    }
  }

  private createExecutionPhases(
    steps: RecipeStepUnion[],
    graph: Map<string, StepDependencyNode>
  ): RecipeExecutionPlan['phases'] {
    const phases: RecipeExecutionPlan['phases'] = []
    const assigned = new Set<string>()
    const stepMap = new Map(steps.map(step => [step.name, step]))
    
    while (assigned.size < steps.length) {
      const readySteps: string[] = []
      
      // Find steps that can run in this phase
      for (const [stepName, node] of graph) {
        if (assigned.has(stepName)) continue
        
        // Check if all dependencies are satisfied
        const dependenciesSatisfied = node.dependencies.every(dep => assigned.has(dep))
        
        if (dependenciesSatisfied) {
          readySteps.push(stepName)
        }
      }
      
      if (readySteps.length === 0) {
        throw ErrorHandler.createError(
          ErrorCode.INTERNAL_ERROR,
          'No ready steps found - possible circular dependency',
          { assigned: Array.from(assigned), total: steps.length }
        )
      }
      
      // Determine if this phase can run in parallel
      const canRunInParallel = this.config.enableParallelExecution && 
        readySteps.length > 1 &&
        readySteps.every(stepName => {
          const step = stepMap.get(stepName)!
          return step.parallel !== false
        })
      
      phases.push({
        phase: phases.length,
        steps: readySteps,
        parallel: canRunInParallel
      })
      
      // Mark steps as assigned
      readySteps.forEach(stepName => assigned.add(stepName))
    }
    
    return phases
  }

  private async executeExecutionPlan(
    plan: RecipeExecutionPlan,
    context: StepContext,
    options: StepExecutionOptions,
    executionId: string
  ): Promise<StepResult[]> {
    const results: StepResult[] = []
    const stepMap = new Map(plan.recipe.steps.map(step => [step.name, step]))
    
    if (this.config.enableProgressTracking && this.progress) {
      this.progress.totalPhases = plan.phases.length
    }
    
    for (let phaseIndex = 0; phaseIndex < plan.phases.length; phaseIndex++) {
      const phase = plan.phases[phaseIndex]
      
      this.debug('Executing phase %d with %d steps (parallel: %s)', 
        phase.phase, phase.steps.length, phase.parallel)
      
      if (this.config.enableProgressTracking && this.progress) {
        this.progress.currentPhase = phaseIndex + 1
        this.progress.phaseDescription = `Phase ${phase.phase + 1}: ${phase.steps.join(', ')}`
      }
      
      this.emit('phase:started', { 
        phase: phase.phase, 
        steps: phase.steps,
        parallel: phase.parallel 
      })
      
      const phaseResults = await this.executePhase(
        phase.steps.map(stepName => stepMap.get(stepName)!),
        context,
        options,
        phase.parallel,
        executionId
      )
      
      results.push(...phaseResults)
      
      // Update step results in context for next phase
      phaseResults.forEach(result => {
        context.stepResults.set(result.stepName, result)
      })
      
      this.emit('phase:completed', { 
        phase: phase.phase, 
        results: phaseResults 
      })
      
      // Check if we should continue execution
      const failed = phaseResults.filter(r => r.status === 'failed')
      if (failed.length > 0 && !options.continueOnError && !this.config.continueOnError) {
        throw new StepExecutionError(
          `Phase ${phase.phase} had failures: ${failed.map(r => r.stepName).join(', ')}`,
          failed[0].stepName,
          failed[0].toolType
        )
      }
    }
    
    return results
  }

  private async executePhase(
    steps: RecipeStepUnion[],
    context: StepContext,
    options: StepExecutionOptions,
    parallel: boolean,
    executionId: string
  ): Promise<StepResult[]> {
    if (!parallel) {
      // Execute steps sequentially
      const results: StepResult[] = []
      
      for (const step of steps) {
        const result = await this.executeStep(step, context, options)
        results.push(result)
        
        // Update progress
        if (this.config.enableProgressTracking && this.progress) {
          if (result.status === 'completed') {
            this.progress.completedSteps.push(step.name)
          } else if (result.status === 'failed') {
            this.progress.failedSteps.push(step.name)
          } else if (result.status === 'skipped') {
            this.progress.skippedSteps.push(step.name)
          }
          this.updateProgressPercentage()
        }
      }
      
      return results
    }
    
    // Execute steps in parallel with concurrency limit
    const concurrency = Math.min(steps.length, this.config.maxConcurrency)
    const results: StepResult[] = []
    
    const executeWithConcurrency = async (stepList: RecipeStepUnion[]): Promise<void> => {
      const promises: Promise<void>[] = []
      let index = 0
      
      const executeNext = async (): Promise<void> => {
        if (index >= stepList.length) return
        
        const step = stepList[index++]
        const stepKey = `${executionId}:${step.name}`
        
        try {
          // Track running step
          const tool = await this.toolRegistry.resolve(step.tool, this.getToolName(step))
          this.runningSteps.set(stepKey, { step, startTime: new Date(), tool })
          
          if (this.config.enableProgressTracking && this.progress) {
            this.progress.runningSteps.push(step.name)
          }
          
          const result = await this.executeStep(step, context, options)
          results.push(result)
          
          // Update progress
          if (this.config.enableProgressTracking && this.progress) {
            const runningIndex = this.progress.runningSteps.indexOf(step.name)
            if (runningIndex !== -1) {
              this.progress.runningSteps.splice(runningIndex, 1)
            }
            
            if (result.status === 'completed') {
              this.progress.completedSteps.push(step.name)
            } else if (result.status === 'failed') {
              this.progress.failedSteps.push(step.name)
            } else if (result.status === 'skipped') {
              this.progress.skippedSteps.push(step.name)
            }
            this.updateProgressPercentage()
          }
          
        } finally {
          this.runningSteps.delete(stepKey)
          
          // Release tool
          const runningStep = this.runningSteps.get(stepKey)
          if (runningStep) {
            this.toolRegistry.release(step.tool, this.getToolName(step), runningStep.tool)
          }
        }
        
        // Execute next step
        return executeNext()
      }
      
      // Start concurrent executions
      for (let i = 0; i < concurrency && i < stepList.length; i++) {
        promises.push(executeNext())
      }
      
      await Promise.all(promises)
    }
    
    await executeWithConcurrency(steps)
    
    // Update parallelization metrics
    if (this.config.collectMetrics && this.metrics) {
      this.metrics.parallelization.maxConcurrentSteps = Math.max(
        this.metrics.parallelization.maxConcurrentSteps,
        Math.min(steps.length, concurrency)
      )
      this.metrics.parallelization.parallelPhases++
    }
    
    return results
  }

  private async routeAndExecuteStep(
    step: RecipeStepUnion,
    context: StepContext,
    options: StepExecutionOptions
  ): Promise<any> {
    const toolName = this.getToolName(step)
    const tool = await this.toolRegistry.resolve(step.tool, toolName)
    
    this.debug('Routing step to tool: %s -> %s:%s', step.name, step.tool, toolName)
    
    try {
      // Initialize tool if needed
      if (!tool.isInitialized()) {
        await tool.initialize()
      }
      
      // Validate step configuration
      const validation = await tool.validate(step, context)
      if (!validation.isValid) {
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          `Step validation failed: ${validation.errors.join(', ')}`,
          { step: step.name, tool: step.tool, errors: validation.errors }
        )
      }
      
      // Execute step through tool
      const result = await tool.execute(step, context)
      
      this.debug('Tool execution completed: %s', step.name)
      return result
      
    } finally {
      // Release tool back to registry
      this.toolRegistry.release(step.tool, toolName, tool)
    }
  }

  private getToolName(step: RecipeStepUnion): string {
    // Route to appropriate tool based on step type
    // Most tools use 'default' as the tool name, but action and codemod use specific names
    if (isTemplateStep(step)) {
      return 'default'
    } else if (isActionStep(step)) {
      return step.action
    } else if (isCodeModStep(step)) {
      return step.codemod
    } else if (isRecipeStep(step)) {
      return 'default'
    } else if (isShellStep(step)) {
      return 'default'
    } else if (isPromptStep(step)) {
      return 'default'
    } else if (isSequenceStep(step)) {
      return 'default'
    } else if (isParallelStep(step)) {
      return 'default'
    }
    
    throw ErrorHandler.createError(
      ErrorCode.VALIDATION_ERROR,
      `Unknown step type: ${(step as any).tool}`,
      { step: (step as any).name }
    )
  }

  private extractFileChanges(result: StepResult, toolResult: any): void {
    // Extract file changes from tool result based on result type
    if (toolResult && typeof toolResult === 'object') {
      if (toolResult.filesGenerated) {
        result.filesCreated = toolResult.filesGenerated
      }
      if (toolResult.filesProcessed) {
        result.filesModified = toolResult.filesProcessed
      }
      if (toolResult.filesCreated) {
        result.filesCreated = toolResult.filesCreated
      }
      if (toolResult.filesModified) {
        result.filesModified = toolResult.filesModified
      }
      if (toolResult.filesDeleted) {
        result.filesDeleted = toolResult.filesDeleted
      }
    }
  }

  private validateSteps(steps: RecipeStepUnion[]): void {
    if (!Array.isArray(steps)) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Steps must be an array'
      )
    }
    
    if (steps.length === 0) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'At least one step is required'
      )
    }
    
    // Validate step names are unique
    const stepNames = new Set<string>()
    for (const step of steps) {
      if (!step.name) {
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          'Step name is required'
        )
      }
      
      if (stepNames.has(step.name)) {
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate step name: ${step.name}`
        )
      }
      stepNames.add(step.name)
      
      if (!step.tool) {
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          `Step ${step.name} must specify a tool`
        )
      }
    }
    
    // Validate dependencies reference existing steps
    for (const step of steps) {
      if (step.dependsOn) {
        for (const depName of step.dependsOn) {
          if (!stepNames.has(depName)) {
            throw ErrorHandler.createError(
              ErrorCode.VALIDATION_ERROR,
              `Step ${step.name} depends on unknown step: ${depName}`
            )
          }
        }
      }
    }
  }

  private validateContext(context: StepContext): void {
    if (!context) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Step context is required'
      )
    }
    
    if (!context.evaluateCondition) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Context must provide evaluateCondition function'
      )
    }
    
    if (!context.recipe) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Context must include recipe information'
      )
    }
  }

  private calculateRetryDelay(attempt: number): number {
    // Exponential backoff with jitter
    const baseDelay = 1000 // 1 second
    const maxDelay = 30000 // 30 seconds
    
    let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
    
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() - 0.5)
    delay += jitter
    
    return Math.max(delay, 100) // Minimum 100ms delay
  }

  private estimateExecutionDuration(steps: RecipeStepUnion[]): number {
    // Simple estimation based on step types and historical data
    const estimations: Record<ToolType, number> = {
      template: 5000, // 5 seconds average
      action: 3000,   // 3 seconds average
      codemod: 10000, // 10 seconds average
      recipe: 15000,  // 15 seconds average (sub-recipes)
      shell: 2000,     // 2 seconds average
      prompt: 30000,   // 30 seconds average (interactive)
      sequence: 0,     // Sequence tool itself is instant
      parallel: 0,     // Parallel tool itself is instant
      ai: 20000        // 20 seconds average (AI generation)
    }
    
    let totalEstimate = 0
    for (const step of steps) {
      totalEstimate += estimations[step.tool] || 5000
    }
    
    return totalEstimate
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${++this.executionCounter}`
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalExecutionTime: 0,
      stepExecutionTimes: new Map(),
      memoryUsage: {
        peak: 0,
        average: 0,
        start: process.memoryUsage().heapUsed,
        end: 0
      },
      parallelization: {
        maxConcurrentSteps: 0,
        averageConcurrentSteps: 0,
        parallelPhases: 0
      },
      errors: {
        totalFailures: 0,
        totalRetries: 0,
        permanentFailures: [],
        recoveredAfterRetries: []
      },
      dependencies: {
        resolutionTime: 0,
        cyclesDetected: 0,
        maxDepth: 0
      }
    }
  }

  private initializeProgress(totalSteps: number): void {
    this.progress = {
      currentPhase: 0,
      totalPhases: 0,
      runningSteps: [],
      completedSteps: [],
      failedSteps: [],
      skippedSteps: [],
      progressPercentage: 0,
      phaseDescription: 'Initializing...'
    }
  }

  private updateProgressPercentage(): void {
    if (!this.progress) return
    
    const totalSteps = this.progress.completedSteps.length + 
                      this.progress.failedSteps.length + 
                      this.progress.skippedSteps.length +
                      this.progress.runningSteps.length
    
    if (totalSteps === 0) return
    
    const completed = this.progress.completedSteps.length + 
                     this.progress.failedSteps.length + 
                     this.progress.skippedSteps.length
    
    this.progress.progressPercentage = Math.round((completed / totalSteps) * 100)
  }

  private finalizeMetrics(): void {
    if (!this.metrics) return
    
    this.metrics.memoryUsage.end = process.memoryUsage().heapUsed
    
    // Calculate average memory usage (simplified)
    this.metrics.memoryUsage.average = (
      this.metrics.memoryUsage.start + this.metrics.memoryUsage.end
    ) / 2
    
    // Set peak to end for now (would need continuous monitoring for accuracy)
    this.metrics.memoryUsage.peak = Math.max(
      this.metrics.memoryUsage.start,
      this.metrics.memoryUsage.end
    )
  }
}