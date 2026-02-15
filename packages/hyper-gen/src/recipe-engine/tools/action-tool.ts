/**
 * Action Tool Implementation for Recipe Step System
 * 
 * This tool executes TypeScript decorator-based actions using the existing
 * action system infrastructure. It integrates with the ActionExecutor,
 * ActionRegistry, and ActionParameterResolver to provide seamless action
 * execution within the Recipe Step System.
 */

import createDebug from 'debug'
import { Tool, type ToolValidationResult } from '#//base.js'
import { HypergenError, ErrorCode, ErrorHandler, withErrorHandling } from '@hypercli/core'
import { 
  type ActionStep, 
  type StepContext, 
  type StepResult,
  type StepExecutionOptions,
  isActionStep
} from '#/recipe-engine/types'
import type { ActionResult, ActionContext, ActionLogger, ActionUtils } from '#/actions/types'
import { ActionExecutor } from '#/actions/executor'
import { ActionRegistry } from '#/actions/registry'
import { ActionParameterResolver } from '#/actions/parameter-resolver'
import { DefaultActionUtils, ConsoleActionLogger } from '#/actions/utils'

const debug = createDebug('hypergen:v8:recipe:tool:action')

/**
 * Action context preparation result
 */
interface ActionContextPreparation {
  /** Prepared action context */
  context: ActionContext
  
  /** Action metadata */
  metadata: any
  
  /** Resolved parameters */
  parameters: Record<string, any>
  
  /** Communication configuration */
  communication?: {
    actionId: string
    subscribeTo?: string[]
    reads?: string[]
    writes?: string[]
  }
}

/**
 * Action Tool for executing TypeScript decorator-based actions in the Recipe Step System
 * 
 * Features:
 * - Integration with existing ActionExecutor and ActionRegistry
 * - Parameter resolution using ActionParameterResolver
 * - Context preparation from StepContext to ActionContext
 * - Action communication and lifecycle management
 * - Rich error handling and retry logic
 * - Performance tracking and resource management
 */
export class ActionTool extends Tool<ActionStep> {
  private executor: ActionExecutor
  private registry: ActionRegistry
  private parameterResolver: ActionParameterResolver
  private defaultUtils: ActionUtils
  private defaultLogger: ActionLogger
  private executorInitialized = false
  
  constructor(name: string = 'action-tool', options: Record<string, any> = {}) {
    super('action', name, options)
    
    // Initialize action system components
    this.registry = ActionRegistry.getInstance()
    this.parameterResolver = new ActionParameterResolver()
    this.defaultUtils = new DefaultActionUtils()
    this.defaultLogger = new ConsoleActionLogger()
    this.executor = new ActionExecutor(options.communicationConfig)
  }

  /**
   * Initialize action tool and ensure action registry is populated
   */
  protected async onInitialize(): Promise<void> {
    this.debug('Initializing action tool and action system')
    
    try {
      // Register cleanup resource for communication manager
      this.registerResource({
        id: 'action-communication',
        type: 'memory',
        cleanup: () => {
          this.executor.clearCommunicationState()
        },
        metadata: { communicationManager: true }
      })

      // Register resource for tracking active actions
      this.registerResource({
        id: 'active-actions',
        type: 'memory',
        cleanup: () => {
          // Any active actions will be cleaned up by the executor
        },
        metadata: { activeActions: new Set() }
      })
      
      this.executorInitialized = true
      this.debug('Action tool initialized successfully')
    } catch (error) {
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to initialize action tool: ${error instanceof Error ? error.message : String(error)}`,
        { phase: 'initialize', cause: error }
      )
    }
  }

  /**
   * Validate action step configuration
   */
  protected async onValidate(step: ActionStep, context: StepContext): Promise<ToolValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const suggestions: string[] = []

    // Validate step is an action step
    if (!isActionStep(step)) {
      errors.push('Step is not a valid ActionStep')
      return { isValid: false, errors, warnings, suggestions }
    }

    // Validate required fields
    if (!step.action) {
      errors.push('Action name is required')
      return { isValid: false, errors, warnings, suggestions }
    }

    // Validate action exists in registry
    const actionInfo = this.executor.getActionInfo(step.action)
    if (!actionInfo.exists) {
      errors.push(`Action '${step.action}' not found in registry`)
      
      // Suggest similar action names
      const availableActions = this.executor.getAvailableActionNames()
      const similarActions = availableActions.filter(name => 
        name.toLowerCase().includes(step.action.toLowerCase()) ||
        step.action.toLowerCase().includes(name.toLowerCase())
      ).slice(0, 3)
      
      if (similarActions.length > 0) {
        suggestions.push(`Similar actions available: ${similarActions.join(', ')}`)
      }
      
      return { isValid: false, errors, warnings, suggestions }
    }

    // Validate action parameters - for recipe steps, we're more lenient
    // since missing required parameters can be prompted interactively
    if (step.parameters) {
      try {
        const paramValidation = await this.executor.validateParameters(step.action, step.parameters)
        if (!paramValidation.valid) {
          // Convert parameter errors to warnings for recipe steps, unless they're type validation errors
          for (const error of paramValidation.errors) {
            if (error.includes('not provided') || error.includes('Required parameter')) {
              // Missing parameter - this is fine for recipes, will be prompted
              warnings.push(`Parameter will be prompted: ${error}`)
            } else {
              // Type validation or other errors - these are real errors
              errors.push(error)
            }
          }
        }
      } catch (error) {
        // If validation fails, it might be due to action not found, which we handle separately
        this.debug('Parameter validation failed: %s', error instanceof Error ? error.message : String(error))
      }
    }

    // Check for missing required parameters
    if (actionInfo.requiredParameters && actionInfo.requiredParameters.length > 0) {
      const providedParams = Object.keys(step.parameters || {})
      const missingRequired = actionInfo.requiredParameters.filter(param => 
        !providedParams.includes(param)
      )
      
      if (missingRequired.length > 0) {
        warnings.push(`Missing required parameters: ${missingRequired.join(', ')}`)
        suggestions.push('These will be prompted interactively during execution')
      }
    }

    // Validate communication configuration
    if (step.actionConfig?.communication) {
      const comm = step.actionConfig.communication
      
      if (comm.actionId && typeof comm.actionId !== 'string') {
        errors.push('actionId must be a string')
      }
      
      if (comm.subscribeTo && !Array.isArray(comm.subscribeTo)) {
        errors.push('subscribeTo must be an array')
      }
      
      if (comm.reads && !Array.isArray(comm.reads)) {
        errors.push('reads must be an array')
      }
      
      if (comm.writes && !Array.isArray(comm.writes)) {
        errors.push('writes must be an array')
      }
    }

    // Performance and complexity warnings
    if (actionInfo.parameterCount && actionInfo.parameterCount > 10) {
      warnings.push('Action has many parameters, consider using configuration file')
    }

    // Estimate execution time (basic heuristic)
    let estimatedTime = 500 // Base time in ms
    if (actionInfo.parameterCount) {
      estimatedTime += actionInfo.parameterCount * 100 // Add time per parameter
    }
    if (step.parameters && Object.keys(step.parameters).length > 5) {
      estimatedTime += 200 // Additional time for complex parameter resolution
    }

    const resourceRequirements = {
      memory: 5 * 1024 * 1024, // 5MB base memory
      disk: 0, // Actions typically don't use disk directly
      network: false, // Actions may use network, but we can't predict
      processes: 1
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      estimatedExecutionTime: estimatedTime,
      resourceRequirements
    }
  }

  /**
   * Execute the action tool
   */
  protected async onExecute(
    step: ActionStep,
    context: StepContext,
    options?: StepExecutionOptions
  ): Promise<StepResult> {
    this.debug('Executing action step: %s -> %s', step.name, step.action)
    
    const startTime = new Date()
    const activeActionsResource = this.resources.get('active-actions')

    try {
      // Ensure executor is initialized
      if (!this.executorInitialized) {
        await this.onInitialize()
      }

      // Prepare action context from step context
      const contextPrep = await this.prepareActionContext(step, context, options)
      
      // Track active action
      if (activeActionsResource?.metadata?.activeActions) {
        (activeActionsResource.metadata.activeActions as Set<string>).add(contextPrep.communication?.actionId || step.name)
      }

      this.debug('Action context prepared for %s: actionId=%s, params=%d', 
        step.action, 
        contextPrep.communication?.actionId,
        Object.keys(contextPrep.parameters).length
      )

      // Execute action using the ActionExecutor
      const actionResult = await this.executeActionWithLifecycle(
        step,
        contextPrep,
        options
      )

      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      this.debug('Action %s completed successfully: %s (duration: %dms)', 
        step.action, 
        actionResult.success ? 'SUCCESS' : 'FAILED',
        duration
      )

      // Create step result from action result
      return this.createStepResult(
        step,
        actionResult,
        startTime,
        endTime,
        duration,
        contextPrep
      )
    } catch (error) {
      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      this.debug('Action execution failed: %s', error instanceof Error ? error.message : String(error))

      return {
        status: 'failed',
        stepName: step.name,
        toolType: 'action',
        startTime,
        endTime,
        duration,
        retryCount: 0,
        dependenciesSatisfied: true,
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: error instanceof HypergenError ? error.code : 'ACTION_EXECUTION_ERROR',
          stack: error instanceof Error ? error.stack : undefined,
          cause: error
        },
        metadata: {
          actionName: step.action,
          executionPhase: 'execution'
        }
      }
    } finally {
      // Clean up active action tracking
      if (activeActionsResource?.metadata?.activeActions) {
        const actionId = step.actionConfig?.communication?.actionId || step.name;
        (activeActionsResource.metadata.activeActions as Set<string>).delete(actionId)
      }
    }
  }

  /**
   * Tool-specific cleanup logic
   */
  protected async onCleanup(): Promise<void> {
    this.debug('Cleaning up action tool resources')
    
    // Clear any remaining communication state
    if (this.executorInitialized) {
      this.executor.clearCommunicationState()
    }
  }

  /**
   * Prepare ActionContext from StepContext
   */
  private async prepareActionContext(
    step: ActionStep,
    context: StepContext,
    options?: StepExecutionOptions
  ): Promise<ActionContextPreparation> {
    // Get action metadata from registry
    const actionInfo = this.executor.getActionInfo(step.action)
    if (!actionInfo.exists || !actionInfo.metadata) {
      throw ErrorHandler.createError(
        ErrorCode.ACTION_NOT_FOUND,
        `Action '${step.action}' not found or has no metadata`,
        { action: step.action }
      )
    }

    // Resolve parameters using ActionParameterResolver
    const resolvedParameters = await this.parameterResolver.resolveParametersInteractively(
      actionInfo.metadata,
      {
        ...step.parameters,
        // Merge step and recipe variables
        ...context.recipeVariables,
        ...step.variables,
        ...context.variables
      },
      {
        useDefaults: true, // Use defaults for recipe step execution
        dryRun: options?.dryRun || context.dryRun || false,
        force: step.force || context.force || false,
        skipOptional: false, // Don't skip optional in recipes
        timeout: step.timeout || options?.timeout,
        intro: `🎯 Configuring action: ${step.action}`,
        outro: `✅ Action ${step.action} configured`
      }
    )

    // Prepare communication configuration
    let communication: ActionContextPreparation['communication']
    if (step.actionConfig?.communication) {
      communication = {
        actionId: step.actionConfig.communication.actionId || 
                 `${step.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        subscribeTo: step.actionConfig.communication.subscribeTo,
        reads: step.actionConfig.communication.reads,
        writes: step.actionConfig.communication.writes
      }
    }

    // Build ActionContext compatible with existing action system
    const actionContext: ActionContext = {
      variables: resolvedParameters,
      projectRoot: context.projectRoot,
      templatePath: context.templatePath,
      logger: context.logger || this.defaultLogger,
      utils: context.utils || this.defaultUtils,
      dryRun: options?.dryRun || context.dryRun || false,
      force: step.force || context.force || false
    }

    return {
      context: actionContext,
      metadata: actionInfo.metadata,
      parameters: resolvedParameters,
      communication
    }
  }

  /**
   * Execute action with full lifecycle management
   */
  private async executeActionWithLifecycle(
    step: ActionStep,
    contextPrep: ActionContextPreparation,
    options?: StepExecutionOptions
  ): Promise<ActionResult> {
    // Use ActionExecutor's interactive execution for full feature support
    return await this.executor.executeInteractively(
      step.action,
      contextPrep.parameters,
      contextPrep.context,
      {
        useDefaults: true,
        dryRun: options?.dryRun || contextPrep.context.dryRun,
        force: contextPrep.context.force,
        skipOptional: false,
        timeout: step.timeout || options?.timeout,
        actionId: contextPrep.communication?.actionId
      }
    )
  }

  /**
   * Create StepResult from ActionResult
   */
  private createStepResult(
    step: ActionStep,
    actionResult: ActionResult,
    startTime: Date,
    endTime: Date,
    duration: number,
    contextPrep: ActionContextPreparation
  ): StepResult {
    const result: StepResult = {
      status: actionResult.success ? 'completed' : 'failed',
      stepName: step.name,
      toolType: 'action',
      startTime,
      endTime,
      duration,
      retryCount: 0,
      dependenciesSatisfied: true,
      toolResult: actionResult,
      filesCreated: actionResult.filesCreated || [],
      filesModified: actionResult.filesModified || [],
      filesDeleted: actionResult.filesDeleted || [],
      output: {
        actionName: step.action,
        actionResult: actionResult.success,
        message: actionResult.message,
        data: actionResult.data,
        // Communication information
        ...(contextPrep.communication && {
          communication: {
            actionId: contextPrep.communication.actionId,
            subscribeTo: contextPrep.communication.subscribeTo,
            reads: contextPrep.communication.reads,
            writes: contextPrep.communication.writes
          }
        })
      },
      metadata: {
        actionMetadata: contextPrep.metadata,
        resolvedParameters: Object.keys(contextPrep.parameters),
        parameterCount: Object.keys(contextPrep.parameters).length,
        communicationEnabled: !!contextPrep.communication,
        executorStats: this.executor.getWorkflowStatus()
      }
    }

    // Add error information if action failed
    if (!actionResult.success) {
      result.error = {
        message: actionResult.message || 'Action execution failed',
        code: 'ACTION_EXECUTION_FAILED'
      }
    }

    return result
  }

  /**
   * Get action execution statistics
   */
  getExecutionStats(): {
    totalActions: number
    activeActions: number
    completedActions: number
    failedActions: number
    communicationStats: any
  } {
    const workflowStatus = this.executor.getWorkflowStatus()
    const activeActionsResource = this.resources.get('active-actions')
    const activeCount = activeActionsResource?.metadata?.activeActions 
      ? (activeActionsResource.metadata.activeActions as Set<string>).size 
      : 0

    return {
      totalActions: this.registry.getAll().length,
      activeActions: activeCount,
      completedActions: workflowStatus.completedActions,
      failedActions: workflowStatus.failedActions,
      communicationStats: workflowStatus
    }
  }

  /**
   * Get available actions for this tool
   */
  getAvailableActions(): Array<{
    name: string
    description?: string
    category?: string
    parameterCount: number
    requiredParameters: string[]
  }> {
    return this.executor.getAvailableActionNames().map(name => {
      const info = this.executor.getActionInfo(name)
      return {
        name,
        description: info.metadata?.description,
        category: info.metadata?.category,
        parameterCount: info.parameterCount || 0,
        requiredParameters: info.requiredParameters || []
      }
    })
  }

  /**
   * Search actions by query
   */
  searchActions(query: string): string[] {
    return this.executor.searchActions(query)
  }

  /**
   * Get actions by category
   */
  getActionsByCategory(category: string): string[] {
    return this.executor.getActionsByCategory(category)
  }

  /**
   * Validate action parameters without execution
   */
  async validateActionParameters(actionName: string, parameters: Record<string, any>): Promise<{
    valid: boolean
    errors: string[]
  }> {
    return this.executor.validateParameters(actionName, parameters)
  }
}

/**
 * Action Tool Factory
 */
export class ActionToolFactory {
  create(name: string = 'action-tool', options: Record<string, any> = {}): ActionTool {
    return new ActionTool(name, options)
  }

  getToolType(): 'action' {
    return 'action'
  }

  validateConfig(config: Record<string, any>): ToolValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    const suggestions: string[] = []

    // Validate communication configuration
    if (config.communicationConfig) {
      if (typeof config.communicationConfig !== 'object') {
        errors.push('communicationConfig must be an object')
      } else {
        const commConfig = config.communicationConfig
        
        if (commConfig.maxMessages !== undefined && 
            (typeof commConfig.maxMessages !== 'number' || commConfig.maxMessages < 0)) {
          warnings.push('maxMessages should be a positive number')
        }
        
        if (commConfig.ttl !== undefined && 
            (typeof commConfig.ttl !== 'number' || commConfig.ttl < 0)) {
          warnings.push('ttl should be a positive number')
        }
      }
    }

    // Validate timeout settings
    if (config.defaultTimeout !== undefined) {
      if (typeof config.defaultTimeout !== 'number' || config.defaultTimeout < 0) {
        warnings.push('defaultTimeout should be a positive number')
      }
    }

    // Performance suggestions
    if (config.enableProfiling === undefined) {
      suggestions.push('Consider enabling profiling for performance monitoring')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions
    }
  }
}

// Export default instance
export const actionToolFactory = new ActionToolFactory()