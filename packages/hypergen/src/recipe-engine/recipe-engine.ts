/**
 * Recipe Engine - Main Orchestrator for Recipe Step System
 * 
 * The RecipeEngine is the primary entry point for executing recipes in Hypergen V8.
 * It provides recipe discovery, loading, validation, variable resolution, and execution
 * coordination through the complete Recipe Step System.
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import createDebug from 'debug'
import { EventEmitter } from 'events'
import { TemplateParser, type TemplateVariable } from '../config/template-parser.js'
import { StepExecutor, type StepExecutorConfig } from './step-executor.js'
import { ToolRegistry, getToolRegistry } from './tools/registry.js'
import { HypergenError, ErrorHandler, ErrorCode } from '../errors/hypergen-errors.js'
import Logger from '../logger.js'
import context from '../context.js'
import { performInteractivePrompting } from '../prompts/interactive-prompts.js'
import { AiCollector } from '../ai/ai-collector.js'
import type {
  RecipeConfig,
  RecipeExecution,
  RecipeValidationResult,
  StepContext,
  StepResult,
  RecipeStepUnion,
  StepExecutionOptions
} from './types.js'
import {
  RecipeValidationError,
  RecipeDependencyError
} from './types.js'

const debug = createDebug('hypergen:v8:recipe:engine')

/**
 * Recipe source types for loading
 */
export type RecipeSource = {
  type: 'content'
  content: string
  name: string
} | {
  type: 'file'
  path: string
} | {
  type: 'package'
  name: string
  version?: string
} | {
  type: 'url'
  url: string
  version?: string
}

/**
 * Recipe execution options
 */
export interface RecipeExecutionOptions {
  /** Variables to pass to the recipe */
  variables?: Record<string, any>

  /** Environment variables */
  environment?: Record<string, string>

  /** Working directory for execution */
  workingDir?: string

  /** Whether to run in dry-run mode */
  dryRun?: boolean

  /** Whether to force overwrite existing files */
  force?: boolean

  /** Whether to continue on step failures */
  continueOnError?: boolean

  /** Custom step execution options */
  stepOptions?: Partial<StepExecutionOptions>

  /** Whether to skip user prompts (use defaults/existing values) */
  skipPrompts?: boolean

  /** Custom logger for output */
  logger?: Logger

  /** Progress callback */
  onProgress?: (progress: { step: string; phase: string; percentage: number }) => void

  /** Step completion callback */
  onStepComplete?: (result: StepResult) => void

  /** AI answers for 2-pass generation (Pass 2) */
  answers?: Record<string, any>
}

/**
 * Recipe engine configuration
 */
export interface RecipeEngineConfig {
  /** Step executor configuration */
  stepExecutor?: Partial<StepExecutorConfig>

  /** Tool registry configuration */
  toolRegistry?: {
    maxCacheSize?: number
    cacheTimeoutMs?: number
    enableInstanceReuse?: boolean
  }

  /** Working directory for all operations */
  workingDir?: string

  /** Default timeout for all operations */
  defaultTimeout?: number

  /** Whether to enable debug logging */
  enableDebugLogging?: boolean

  /** Recipe cache configuration */
  cache?: {
    enabled: boolean
    directory?: string
    ttl?: number
  }

  /** Security settings */
  security?: {
    allowExternalSources?: boolean
    trustedSources?: string[]
    validateSignatures?: boolean
  }

  /** Helper functions from hypergen config */
  helpers?: Record<string, any>
}

/**
 * Recipe execution result
 */
export interface RecipeExecutionResult {
  /** Execution ID */
  executionId: string
  
  /** Recipe that was executed */
  recipe: RecipeConfig
  
  /** Overall execution status */
  success: boolean
  
  /** Step execution results */
  stepResults: StepResult[]
  
  /** Total execution time in milliseconds */
  duration: number
  
  /** Files created during execution */
  filesCreated: string[]
  
  /** Files modified during execution */
  filesModified: string[]
  
  /** Files deleted during execution */
  filesDeleted: string[]
  
  /** Execution errors */
  errors: string[]
  
  /** Execution warnings */
  warnings: string[]
  
  /** Final resolved variables */
  variables: Record<string, any>
  
  /** Execution metadata */
  metadata: {
    startTime: Date
    endTime: Date
    workingDir: string
    totalSteps: number
    completedSteps: number
    failedSteps: number
    skippedSteps: number
  }
}

/**
 * Recipe loading result
 */
export interface RecipeLoadResult {
  recipe: RecipeConfig
  source: RecipeSource
  validation: RecipeValidationResult
  dependencies: RecipeConfig[]
}

/**
 * Default recipe engine configuration
 */
const DEFAULT_CONFIG: Required<RecipeEngineConfig> = {
  stepExecutor: {
    maxConcurrency: 10,
    defaultTimeout: 30000,
    defaultRetries: 3,
    continueOnError: false,
    enableParallelExecution: true,
    collectMetrics: true,
    enableProgressTracking: true,
    memoryWarningThreshold: 1024,
    timeoutSafetyFactor: 1.2
  },
  toolRegistry: {
    maxCacheSize: 100,
    cacheTimeoutMs: 30 * 60 * 1000,
    enableInstanceReuse: true
  },
  workingDir: process.cwd(),
  defaultTimeout: 60000,
  enableDebugLogging: false,
  cache: {
    enabled: true,
    directory: path.join(process.cwd(), '.hypergen', 'cache'),
    ttl: 3600000 // 1 hour
  },
  security: {
    allowExternalSources: true,
    trustedSources: [],
    validateSignatures: false
  },
  helpers: {}
}

/**
 * Main Recipe Engine for Hypergen V8
 * 
 * The RecipeEngine provides the primary API for executing recipes. It handles:
 * - Recipe discovery and loading from various sources
 * - Recipe validation and preprocessing
 * - Variable resolution with user prompts
 * - Step orchestration through StepExecutor
 * - Result aggregation and reporting
 * - Error handling and recovery
 */
export class RecipeEngine extends EventEmitter {
  private readonly config: Required<RecipeEngineConfig>
  private readonly logger: Logger
  private readonly debug: ReturnType<typeof createDebug>
  private readonly stepExecutor: StepExecutor
  private readonly toolRegistry: ToolRegistry

  // Execution state
  private readonly activeExecutions = new Map<string, RecipeExecution>()
  private executionCounter = 0

  // Caching
  private readonly recipeCache = new Map<string, { recipe: RecipeConfig; timestamp: number }>()

  // Timer for cache cleanup
  private cleanupIntervalId: NodeJS.Timeout | null = null
  
  constructor(config: RecipeEngineConfig = {}) {
    super()
    
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = new Logger(console.log)
    this.debug = createDebug('hypergen:v8:recipe:engine')
    
    // Initialize tool registry
    this.toolRegistry = getToolRegistry()
    
    // Initialize step executor
    this.stepExecutor = new StepExecutor(this.toolRegistry, this.config.stepExecutor)
    
    this.debug('Recipe engine initialized with config: %o', {
      workingDir: this.config.workingDir,
      cacheEnabled: this.config.cache.enabled,
      allowExternalSources: this.config.security.allowExternalSources
    })
    
    // Set up debug logging if enabled
    if (this.config.enableDebugLogging) {
      const existing = process.env.DEBUG || ''
      const recipeDebug = 'hypergen:v8:recipe:*'
      process.env.DEBUG = existing 
        ? `${existing},${recipeDebug}`
        : recipeDebug
    }
    
    // Forward step executor events
    this.stepExecutor.on('execution:started', (data) => this.emit('execution:started', data))
    this.stepExecutor.on('execution:completed', (data) => this.emit('execution:completed', data))
    this.stepExecutor.on('execution:failed', (data) => this.emit('execution:failed', data))
    this.stepExecutor.on('step:started', (data) => this.emit('step:started', data))
    this.stepExecutor.on('step:completed', (data) => this.emit('step:completed', data))
    this.stepExecutor.on('step:failed', (data) => this.emit('step:failed', data))
    this.stepExecutor.on('phase:started', (data) => this.emit('phase:started', data))
    this.stepExecutor.on('phase:completed', (data) => this.emit('phase:completed', data))
    
    // Start cache cleanup if enabled
    if (this.config.cache.enabled) {
      this.startCacheCleanup()
    }
  }

  /**
   * Execute a recipe from various sources
   * 
   * @param source Recipe source (file path, URL, package name, or content)
   * @param options Execution options including variables and behavior settings
   * @returns Promise resolving to execution result
   */
  async executeRecipe(
    source: string | RecipeSource,
    options: RecipeExecutionOptions = {}
  ): Promise<RecipeExecutionResult> {
    const executionId = this.generateExecutionId()
    const startTime = Date.now()
    
    this.debug('Starting recipe execution [%s] from source: %o', executionId, source)
    this.emit('recipe:started', { executionId, source })
    
    try {
      // Normalize source
      const normalizedSource = this.normalizeSource(source)
      
      // Load and validate recipe
      const loadResult = await this.loadRecipe(normalizedSource)
      const { recipe, validation } = loadResult
      
      if (!validation.isValid) {
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          `Recipe validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
          { executionId, errors: validation.errors.map(e => e.message) }
        )
      }
      
      this.debug('Recipe loaded and validated: %s', recipe.name)
      
      // Resolve variables with user input if needed
      const resolvedVariables = await this.resolveVariables(
        recipe, 
        options.variables || {}, 
        options.skipPrompts || false,
        options.logger
      )
      
      this.debug('Variables resolved: %o', Object.keys(resolvedVariables))
      
      // Create execution context
      const context = await this.createExecutionContext(
        recipe,
        resolvedVariables,
        options,
        executionId,
        normalizedSource
      )
      
      // Create step execution options
      const stepOptions: StepExecutionOptions = {
        timeout: options.stepOptions?.timeout || this.config.defaultTimeout,
        continueOnError: options.continueOnError || this.config.stepExecutor.continueOnError,
        dryRun: options.dryRun || false,
        ...options.stepOptions
      }
      
      // Execute steps through StepExecutor
      this.debug('Starting step execution with %d steps', recipe.steps.length)
      const stepResults = await this.stepExecutor.executeSteps(
        recipe.steps,
        context,
        stepOptions
      )
      
      // Aggregate results
      const result = this.aggregateResults(
        executionId,
        recipe,
        stepResults,
        resolvedVariables,
        startTime,
        context
      )
      
      this.debug('Recipe execution completed [%s] in %dms', executionId, result.duration)
      this.emit('recipe:completed', { executionId, result })
      
      return result
      
    } catch (error) {
      const duration = Date.now() - startTime
      const normalizedSource = this.normalizeSource(source)
      
      this.debug('Recipe execution failed [%s]: %s', executionId, 
        error instanceof Error ? error.message : String(error))
      
      this.emit('recipe:failed', { 
        executionId, 
        error, 
        duration,
        source: normalizedSource 
      })
      
      // Create error result
      const errorResult: RecipeExecutionResult = {
        executionId,
        recipe: {} as RecipeConfig,
        success: false,
        stepResults: [],
        duration,
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        variables: options.variables || {},
        metadata: {
          startTime: new Date(startTime),
          endTime: new Date(),
          workingDir: options.workingDir || this.config.workingDir,
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0
        }
      }
      
      if (error instanceof HypergenError) {
        throw error
      }
      
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Recipe execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
      
    } finally {
      this.activeExecutions.delete(executionId)
    }
  }

  /**
   * Load a recipe from a source without executing it
   */
  async loadRecipe(source: string | RecipeSource): Promise<RecipeLoadResult> {
    const normalizedSource = this.normalizeSource(source)
    const cacheKey = this.getCacheKey(normalizedSource)
    
    // Check cache first
    if (this.config.cache.enabled) {
      const cached = this.recipeCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.config.cache.ttl) {
        this.debug('Recipe loaded from cache: %s', cacheKey)
        
        // Still need to validate for dependencies
        const validation = await this.validateRecipe(cached.recipe)
        return {
          recipe: cached.recipe,
          source: normalizedSource,
          validation,
          dependencies: []
        }
      }
    }
    
    this.debug('Loading recipe from source: %o', normalizedSource)
    
    // Load recipe content
    const content = await this.loadRecipeContent(normalizedSource)
    
    // Parse recipe
    const recipe = await this.parseRecipeContent(content, normalizedSource)
    
    // Validate recipe
    const validation = await this.validateRecipe(recipe)
    
    // Load dependencies
    const dependencies = await this.loadDependencies(recipe)
    
    // Cache result
    if (this.config.cache.enabled && validation.isValid) {
      this.recipeCache.set(cacheKey, {
        recipe,
        timestamp: Date.now()
      })
    }
    
    this.debug('Recipe loaded successfully: %s', recipe.name)
    
    return {
      recipe,
      source: normalizedSource,
      validation,
      dependencies
    }
  }

  /**
   * Validate a recipe configuration
   */
  async validateRecipe(recipe: RecipeConfig): Promise<RecipeValidationResult> {
    const errors: RecipeValidationError[] = []
    const warnings: string[] = []
    
    this.debug('Validating recipe: %s', recipe.name)
    
    // Basic validation
    if (!recipe.name || typeof recipe.name !== 'string') {
      errors.push(new RecipeValidationError('Recipe name is required and must be a string', 'MISSING_NAME'))
    }
    
    if (!recipe.variables || typeof recipe.variables !== 'object') {
      errors.push(new RecipeValidationError('Recipe variables section is required', 'MISSING_VARIABLES'))
    } else if (typeof recipe.variables === 'object' && Object.keys(recipe.variables).length === 0) {
      // Allow empty variables object, don't treat as error
    }
    
    if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
      errors.push(new RecipeValidationError('Recipe must have at least one step', 'MISSING_STEPS'))
    }
    
    // Validate variables
    if (recipe.variables) {
      for (const [varName, varConfig] of Object.entries(recipe.variables)) {
        const validation = this.validateVariable(varName, varConfig)
        if (validation.error) {
          errors.push(new RecipeValidationError(validation.error, 'INVALID_VARIABLE', {
            field: `variables.${varName}`
          }))
        }
      }
    }
    
    // Validate steps
    if (recipe.steps) {
      const stepNames = new Set<string>()
      
      for (const [index, step] of recipe.steps.entries()) {
        const stepErrors = this.validateStep(step, index, stepNames)
        errors.push(...stepErrors)
      }
      
      // Validate dependencies
      this.validateStepDependencies(recipe.steps, errors)
    }
    
    // Validate dependencies
    if (recipe.dependencies) {
      for (const dep of recipe.dependencies) {
        const depValidation = await this.validateDependency(dep)
        if (!depValidation.isValid) {
          errors.push(new RecipeValidationError(
            `Dependency validation failed: ${dep.name}`,
            'INVALID_DEPENDENCY'
          ))
        }
      }
    }
    
    const result: RecipeValidationResult = {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.map(w => ({
        code: 'WARNING',
        message: w,
        severity: 'warning' as const,
        suggestion: undefined
      })),
      recipe,
      context: {
        timestamp: new Date(),
        validatorVersion: '8.0.0',
        scope: 'full'
      }
    }
    
    this.debug('Recipe validation completed: %s (errors: %d, warnings: %d)', 
      recipe.name, errors.length, warnings.length)
    
    return result
  }

  /**
   * Get current execution status
   */
  getExecutions(): RecipeExecution[] {
    return Array.from(this.activeExecutions.values())
  }

  /**
   * Cancel a recipe execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    this.debug('Cancelling execution: %s', executionId)
    
    const execution = this.activeExecutions.get(executionId)
    if (!execution) {
      throw ErrorHandler.createError(
        ErrorCode.ACTION_NOT_FOUND,
        `Execution not found: ${executionId}`
      )
    }
    
    // Cancel through step executor
    await this.stepExecutor.cancelExecution(executionId)
    
    // Update execution status
    execution.status = 'cancelled'
    execution.endTime = new Date()
    
    this.emit('recipe:cancelled', { executionId })
  }

  /**
   * Cancel all active executions
   */
  async cancelAllExecutions(): Promise<void> {
    this.debug('Cancelling all executions')
    
    const promises = Array.from(this.activeExecutions.keys())
      .map(id => this.cancelExecution(id))
    
    await Promise.allSettled(promises)
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.debug('Cleaning up recipe engine')

    // Stop the cache cleanup timer
    this.stopCacheCleanup()

    // Cancel all executions
    await this.cancelAllExecutions()

    // Clear caches
    this.recipeCache.clear()

    // Clean up step executor
    await this.stepExecutor.cancelAllExecutions()

    this.emit('cleanup:completed')
  }

  // Private implementation methods

  private normalizeSource(source: string | RecipeSource): RecipeSource {
    if (typeof source === 'string') {
      // Auto-detect source type
      if (source.startsWith('http://') || source.startsWith('https://')) {
        return { type: 'url', url: source }
      } else if (source.includes('/') || source.includes('\\') || source.endsWith('.yml') || source.endsWith('.yaml')) {
        return { type: 'file', path: source }
      } else {
        return { type: 'package', name: source }
      }
    }
    return source
  }

  private getCacheKey(source: RecipeSource): string {
    switch (source.type) {
      case 'file':
        return `file:${source.path}`
      case 'url':
        return `url:${source.url}${source.version ? `@${source.version}` : ''}`
      case 'package':
        return `package:${source.name}${source.version ? `@${source.version}` : ''}`
      case 'content':
        return `content:${source.name}`
      default:
        return 'unknown'
    }
  }

  private async loadRecipeContent(source: RecipeSource): Promise<string> {
    switch (source.type) {
      case 'file':
        return this.loadFileContent(source.path)
      
      case 'url':
        return this.loadUrlContent(source.url)
      
      case 'package':
        return this.loadPackageContent(source.name, source.version)
      
      case 'content':
        return source.content
      
      default:
        throw ErrorHandler.createError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported source type: ${(source as any).type}`
        )
    }
  }

  private async loadFileContent(filePath: string): Promise<string> {
    try {
      const fullPath = path.resolve(this.config.workingDir, filePath)
      
      if (!fs.existsSync(fullPath)) {
        throw ErrorHandler.createError(
          ErrorCode.ACTION_NOT_FOUND,
          `Recipe file not found: ${fullPath}`
        )
      }
      
      return fs.readFileSync(fullPath, 'utf-8')
    } catch (error) {
      if (error instanceof HypergenError) {
        throw error
      }
      
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to load recipe file: ${error instanceof Error ? error.message : String(error)}`,
        { filePath }
      )
    }
  }

  private async loadUrlContent(url: string): Promise<string> {
    if (!this.config.security.allowExternalSources) {
      throw ErrorHandler.createError(
        ErrorCode.ACTION_EXECUTION_FAILED,
        'External recipe sources are not allowed by security policy',
        { url }
      )
    }
    
    // Check if URL is trusted
    const isTrusted = this.config.security.trustedSources.length === 0 ||
      this.config.security.trustedSources.some(trusted => url.startsWith(trusted))
    
    if (!isTrusted) {
      throw ErrorHandler.createError(
        ErrorCode.ACTION_EXECUTION_FAILED,
        `Untrusted recipe source: ${url}`
      )
    }
    
    try {
      // Use dynamic import for fetch to support Node.js environments
      const fetch = await import('node-fetch').then(m => m.default).catch(() => {
        throw new Error('node-fetch is required for URL sources')
      })
      
      const response = await fetch(url, {
        timeout: this.config.defaultTimeout,
        headers: {
          'User-Agent': 'Hypergen-V8-RecipeEngine/8.0.0'
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      return await response.text()
      
    } catch (error) {
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to load recipe from URL: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async loadPackageContent(packageName: string, version?: string): Promise<string> {
    // For now, treat packages as npm packages with recipe.yml in root
    // In a full implementation, this would use npm/yarn APIs
    const packagePath = version 
      ? `node_modules/${packageName}@${version}/recipe.yml`
      : `node_modules/${packageName}/recipe.yml`
    
    return this.loadFileContent(packagePath)
  }

  private async parseRecipeContent(content: string, source: RecipeSource): Promise<RecipeConfig> {
    try {
      const parsed = yaml.load(content) as any
      
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML format or empty content')
      }
      
      // Convert from template.yml format if needed
      const recipe: RecipeConfig = {
        name: parsed.name || '',  // Don't provide default to trigger validation
        description: parsed.description,
        version: parsed.version || '1.0.0',
        author: parsed.author,
        category: parsed.category || 'general',
        tags: parsed.tags || [],
        variables: parsed.variables || {},
        steps: this.normalizeSteps(parsed.steps || []),
        examples: parsed.examples || [],
        dependencies: parsed.dependencies || [],
        outputs: parsed.outputs || [],
        engines: parsed.engines,
        hooks: parsed.hooks,
        settings: parsed.settings,
        composition: parsed.composition
      }
      
      return recipe
      
    } catch (error) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        `Failed to parse recipe content: ${error instanceof Error ? error.message : String(error)}`,
        { source }
      )
    }
  }

  /**
   * Normalize steps to infer tool types from shorthands
   */
  private normalizeSteps(steps: any[]): RecipeStepUnion[] {
    return steps.map(step => {
      if (!step.tool) {
        if (step.command) {
          step.tool = 'shell'
        } else if (step.recipe) {
          step.tool = 'recipe'
        } else if (step.promptType) { // Inference for prompt
          step.tool = 'prompt'
        } else if (step.sequence) { // Inference for sequence shorthand
          step.tool = 'sequence'
          step.steps = step.sequence
          delete step.sequence
        } else if (step.parallel) { // Inference for parallel shorthand
          step.tool = 'parallel'
          step.steps = step.parallel
          delete step.parallel
        } else if (step.steps) { // Default to sequence for generic steps property
          step.tool = 'sequence'
        } else if (step.template) {
          step.tool = 'template'
        } else if (step.action) {
          step.tool = 'action'
        } else if (step.codemod) {
          step.tool = 'codemod'
        }
      }
      return step as RecipeStepUnion
    })
  }

  private async resolveVariables(
    recipe: RecipeConfig,
    providedVariables: Record<string, any>,
    skipPrompts: boolean,
    logger?: Logger
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {}
    const missingRequired: string[] = []
    
    this.debug('Resolving variables for recipe: %s', recipe.name)
    
    // Process all defined variables
    for (const [varName, varConfig] of Object.entries(recipe.variables)) {
      let value = providedVariables[varName]
      
      // Use default if no value provided
      if (value === undefined) {
        value = varConfig.default
      }
      
      // Check if required variable is missing
      if (varConfig.required && (value === undefined || value === null || value === '')) {
        if (skipPrompts) {
          missingRequired.push(varName)
          continue
        } else {
          // Prompt for missing required variable
          value = await this.promptForVariable(varName, varConfig, logger)
        }
      }
      
      // Validate the value
      if (value !== undefined) {
        const validation = TemplateParser.validateVariableValue(varName, value, varConfig)
        if (!validation.isValid) {
          throw ErrorHandler.createError(
            ErrorCode.VALIDATION_ERROR,
            validation.error || `Invalid value for variable: ${varName}`,
            { variable: varName, value, config: varConfig }
          )
        }
      }
      
      resolved[varName] = TemplateParser.getResolvedValue(value, varConfig)
    }
    
    if (missingRequired.length > 0) {
      throw ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        `Missing required variables: ${missingRequired.join(', ')}`,
        { missingVariables: missingRequired }
      )
    }
    
    // Add any additional provided variables not defined in recipe
    for (const [varName, value] of Object.entries(providedVariables)) {
      if (!recipe.variables[varName]) {
        resolved[varName] = value
      }
    }
    
    this.debug('Variables resolved successfully: %o', Object.keys(resolved))
    
    return resolved
  }

  private async promptForVariable(
    varName: string,
    varConfig: TemplateVariable,
    logger?: Logger
  ): Promise<any> {
    const prompts = [{
      type: this.getPromptType(varConfig),
      name: varName,
      message: varConfig.description || `Enter value for ${varName}:`,
      default: varConfig.default,
      choices: varConfig.type === 'enum' ? varConfig.values : undefined,
      validate: (input: any) => {
        const validation = TemplateParser.validateVariableValue(varName, input, varConfig)
        return validation.isValid || validation.error
      }
    }]
    
    try {
      const answers = await performInteractivePrompting(
        prompts,
        logger || this.logger
      )
      
      return answers[varName]
      
    } catch (error) {
      throw ErrorHandler.createError(
        ErrorCode.INTERNAL_ERROR,
        `Failed to prompt for variable ${varName}: ${error instanceof Error ? error.message : String(error)}`,
        { variable: varName }
      )
    }
  }

  private getPromptType(varConfig: TemplateVariable): string {
    switch (varConfig.type) {
      case 'boolean':
        return 'confirm'
      case 'enum':
        return 'list'
      case 'number':
        return 'number'
      case 'file':
        return 'input' // Could be enhanced with file picker
      case 'directory':
        return 'input' // Could be enhanced with directory picker
      default:
        return 'input'
    }
  }

  private async createExecutionContext(
    recipe: RecipeConfig,
    variables: Record<string, any>,
    options: RecipeExecutionOptions,
    executionId: string,
    source?: string | RecipeSource
  ): Promise<StepContext> {
    // Create base context using existing context function
    const baseContext = context(variables, {
      localsDefaults: {},
      helpers: this.config.helpers
    })

    // Determine collect mode: if no answers provided and AiCollector is in collect mode
    const collectMode = !options.answers && AiCollector.getInstance().collectMode

    return {
      step: {} as RecipeStepUnion, // Will be set by step executor
      variables: baseContext,
      projectRoot: options.workingDir || this.config.workingDir,
      recipeVariables: variables,
      stepResults: new Map(),
      recipe: {
        id: executionId,
        name: recipe.name,
        version: recipe.version,
        startTime: new Date()
      },
      stepData: {},
      evaluateCondition: this.createConditionEvaluator(baseContext),
      answers: options.answers,
      collectMode,
      dryRun: options.dryRun,
      force: options.force,
      logger: options.logger || this.logger,
      templatePath: source && typeof source === 'object' && source.type === 'file'
        ? path.dirname(source.path)
        : undefined
    }
  }

  private createConditionEvaluator(context: Record<string, any>): (expression: string, ctx: Record<string, any>) => boolean {
    return (expression: string, ctx: Record<string, any>) => {
      try {
        // Simple expression evaluation
        // In production, you'd want a safer evaluation method
        // Flatten variables into scope for easier access
        const variableScope = { 
          ...context.variables, 
          ...(ctx.variables || {}),
          variables: { ...context.variables, ...(ctx.variables || {}) }
        }
        const mergedContext = { ...context, ...ctx, ...variableScope }
        // Remove 'variables' from root if it conflicts (though we just added it back explicitly)
        
        // Use a set to ensure unique argument names for Function constructor
        // Filter out reserved keywords to prevent SyntaxError
        const reservedKeywords = new Set([
          'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
          'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
          'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
          'with', 'yield', 'let', 'static', 'enum', 'await', 'implements', 'interface', 'package', 
          'private', 'protected', 'public'
        ])
        
        const argNames = Array.from(new Set(Object.keys(mergedContext)))
          .filter(name => !reservedKeywords.has(name) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name))
          
        const argValues = argNames.map(name => mergedContext[name])
        
        const func = new Function(...argNames, `return ${expression}`)
        return Boolean(func(...argValues))
      } catch (error) {
        this.debug('Condition evaluation failed: %s - %s', expression, 
          error instanceof Error ? error.message : String(error))
        return false
      }
    }
  }

  private aggregateResults(
    executionId: string,
    recipe: RecipeConfig,
    stepResults: StepResult[],
    variables: Record<string, any>,
    startTime: number,
    context: StepContext
  ): RecipeExecutionResult {
    const duration = Date.now() - startTime
    const completedSteps = stepResults.filter(r => r.status === 'completed')
    const failedSteps = stepResults.filter(r => r.status === 'failed')
    const skippedSteps = stepResults.filter(r => r.status === 'skipped')
    
    // Aggregate file changes
    const filesCreated = new Set<string>()
    const filesModified = new Set<string>()
    const filesDeleted = new Set<string>()
    const errors: string[] = []
    const warnings: string[] = []
    
    for (const result of stepResults) {
      if (result.filesCreated) {
        result.filesCreated.forEach(file => filesCreated.add(file))
      }
      if (result.filesModified) {
        result.filesModified.forEach(file => filesModified.add(file))
      }
      if (result.filesDeleted) {
        result.filesDeleted.forEach(file => filesDeleted.add(file))
      }
      if (result.error) {
        errors.push(`${result.stepName}: ${result.error.message}`)
      }
    }
    
    return {
      executionId,
      recipe,
      success: failedSteps.length === 0,
      stepResults,
      duration,
      filesCreated: Array.from(filesCreated),
      filesModified: Array.from(filesModified),
      filesDeleted: Array.from(filesDeleted),
      errors,
      warnings,
      variables,
      metadata: {
        startTime: new Date(startTime),
        endTime: new Date(),
        workingDir: context.projectRoot,
        totalSteps: stepResults.length,
        completedSteps: completedSteps.length,
        failedSteps: failedSteps.length,
        skippedSteps: skippedSteps.length
      }
    }
  }

  private async loadDependencies(recipe: RecipeConfig): Promise<RecipeConfig[]> {
    const dependencies: RecipeConfig[] = []
    
    if (!recipe.dependencies) {
      return dependencies
    }
    
    for (const dep of recipe.dependencies) {
      try {
        const depSource = this.dependencyToSource(dep)
        const depResult = await this.loadRecipe(depSource)
        
        if (!depResult.validation.isValid && !dep.optional) {
          throw new RecipeDependencyError(
            `Required dependency validation failed: ${dep.name}`,
            dep.name,
            dep.version
          )
        }
        
        if (depResult.validation.isValid) {
          dependencies.push(depResult.recipe)
        }
        
      } catch (error) {
        if (dep.optional) {
          this.debug('Optional dependency failed to load: %s - %s', dep.name, 
            error instanceof Error ? error.message : String(error))
        } else {
          throw error
        }
      }
    }
    
    return dependencies
  }

  private dependencyToSource(dependency: any): RecipeSource {
    const name = typeof dependency === 'string' ? dependency : dependency.name
    const version = typeof dependency === 'object' ? dependency.version : undefined
    const type = typeof dependency === 'object' ? dependency.type : 'npm'
    const url = typeof dependency === 'object' ? dependency.url : undefined
    
    switch (type) {
      case 'github':
        return {
          type: 'url',
          url: url || `https://raw.githubusercontent.com/${name}/main/recipe.yml`,
          version
        }
      
      case 'http':
        if (!url) {
          throw new Error(`HTTP dependency requires URL: ${name}`)
        }
        return { type: 'url', url, version }
      
      case 'local':
        return { type: 'file', path: name }
      
      case 'npm':
      default:
        return { type: 'package', name, version }
    }
  }

  private validateVariable(varName: string, varConfig: TemplateVariable): { error?: string } {
    if (!varConfig || typeof varConfig !== 'object') {
      return { error: `Variable '${varName}' must be an object` }
    }
    
    if (!varConfig.type) {
      return { error: `Variable '${varName}' must have a type` }
    }
    
    const validTypes = ['string', 'number', 'boolean', 'enum', 'array', 'object', 'file', 'directory']
    if (!validTypes.includes(varConfig.type)) {
      return { error: `Variable '${varName}' has invalid type: ${varConfig.type}` }
    }
    
    return {}
  }

  private validateStep(step: RecipeStepUnion, index: number, stepNames: Set<string>): RecipeValidationError[] {
    const errors: RecipeValidationError[] = []
    
    if (!step.name) {
      errors.push(new RecipeValidationError(
        `Step ${index + 1} must have a name`,
        'MISSING_STEP_NAME',
        { field: `steps[${index}].name` }
      ))
    } else {
      if (stepNames.has(step.name)) {
        errors.push(new RecipeValidationError(
          `Duplicate step name: ${step.name}`,
          'DUPLICATE_STEP_NAME',
          { field: `steps[${index}].name` }
        ))
      }
      stepNames.add(step.name)
    }
    
    if (!step.tool) {
      errors.push(new RecipeValidationError(
        `Step ${step.name || index + 1} must specify a tool`,
        'MISSING_TOOL',
        { field: `steps[${index}].tool` }
      ))
    }
    
    const validTools = ['template', 'action', 'codemod', 'recipe', 'shell', 'prompt', 'sequence', 'parallel', 'ai']
    if (step.tool && !validTools.includes(step.tool)) {
      errors.push(new RecipeValidationError(
        `Step ${step.name || index + 1} has invalid tool: ${step.tool}`,
        'INVALID_TOOL',
        { field: `steps[${index}].tool` }
      ))
    }
    
    return errors
  }

  private validateStepDependencies(steps: RecipeStepUnion[], errors: RecipeValidationError[]): void {
    const stepNames = new Set(steps.map(s => s.name))
    
    for (const step of steps) {
      if (step.dependsOn) {
        for (const depName of step.dependsOn) {
          if (!stepNames.has(depName)) {
            errors.push(new RecipeValidationError(
              `Step ${step.name} depends on unknown step: ${depName}`,
              'UNKNOWN_DEPENDENCY',
              { step: step.name, field: 'dependsOn' }
            ))
          }
        }
      }
    }
  }

  private async validateDependency(dependency: any): Promise<{ isValid: boolean; error?: string }> {
    const name = typeof dependency === 'string' ? dependency : dependency.name
    
    if (!name) {
      return { isValid: false, error: 'Dependency must have a name' }
    }
    
    // Basic validation - in production you'd check if package/URL exists
    return { isValid: true }
  }

  private generateExecutionId(): string {
    return `recipe_${Date.now()}_${++this.executionCounter}`
  }

  private startCacheCleanup(): void {
    // Clean up cache every 10 minutes
    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now()
      const keysToDelete: string[] = []

      for (const [key, entry] of this.recipeCache) {
        if ((now - entry.timestamp) > this.config.cache.ttl) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach(key => this.recipeCache.delete(key))

      if (keysToDelete.length > 0) {
        this.debug('Cleaned up %d expired cache entries', keysToDelete.length)
      }
    }, 10 * 60 * 1000)
  }

  /**
   * Stop the cache cleanup timer
   */
  public stopCacheCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
      this.debug('Recipe cache cleanup timer stopped')
    }
  }
}

/**
 * Create a new recipe engine instance
 */
export function createRecipeEngine(config?: RecipeEngineConfig): RecipeEngine {
  return new RecipeEngine(config)
}

/**
 * Execute a recipe with default configuration
 */
export async function executeRecipe(
  source: string | RecipeSource,
  options?: RecipeExecutionOptions
): Promise<RecipeExecutionResult> {
  const engine = createRecipeEngine()
  return await engine.executeRecipe(source, options)
}

/**
 * Load and validate a recipe without executing
 */
export async function loadRecipe(
  source: string | RecipeSource,
  config?: RecipeEngineConfig
): Promise<RecipeLoadResult> {
  const engine = createRecipeEngine(config)
  return await engine.loadRecipe(source)
}

/**
 * Validate a recipe configuration
 */
export async function validateRecipe(
  recipe: RecipeConfig,
  config?: RecipeEngineConfig
): Promise<RecipeValidationResult> {
  const engine = createRecipeEngine(config)
  return await engine.validateRecipe(recipe)
}
