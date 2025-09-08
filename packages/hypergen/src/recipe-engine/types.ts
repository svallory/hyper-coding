/**
 * Recipe Step System Types
 * 
 * Complete TypeScript type definitions for the step-based recipe execution system
 * that coordinates Template, Action, CodeMod, and Recipe tools through sequential steps.
 */

import type { TemplateVariable } from '../config/template-parser.js'
import type { ActionResult, ActionContext, ActionParameter, ActionLogger, ActionUtils } from '../actions/types.js'

/**
 * Core step execution status
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'

/**
 * Tool types supported by the recipe system
 */
export type ToolType = 'template' | 'action' | 'codemod' | 'recipe'

/**
 * Base interface for all recipe steps
 */
export interface BaseRecipeStep {
  /** Unique identifier for this step */
  name: string
  
  /** Human-readable description of what this step does */
  description?: string
  
  /** Conditional expression that determines if this step should execute */
  when?: string
  
  /** Steps that must complete successfully before this step can run */
  dependsOn?: string[]
  
  /** Whether this step can run in parallel with other steps */
  parallel?: boolean
  
  /** Whether to continue recipe execution if this step fails */
  continueOnError?: boolean
  
  /** Timeout in milliseconds for step execution */
  timeout?: number
  
  /** Number of retry attempts on failure */
  retries?: number
  
  /** Tags for categorization and filtering */
  tags?: string[]
  
  /** Variables to pass to the tool (merged with recipe-level variables) */
  variables?: Record<string, any>
  
  /** Environment variables specific to this step */
  environment?: Record<string, string>
}

/**
 * Template step configuration
 * Executes a template to generate files
 */
export interface TemplateStep extends BaseRecipeStep {
  tool: 'template'
  
  /** Template identifier or path */
  template: string
  
  /** Template engine to use (defaults to auto-detection) */
  engine?: 'ejs' | 'liquid' | 'auto'
  
  /** Output directory override (relative to project root) */
  outputDir?: string
  
  /** Whether to overwrite existing files */
  overwrite?: boolean
  
  /** File patterns to exclude from generation */
  exclude?: string[]
  
  /** Template-specific configuration */
  templateConfig?: {
    /** Template variables with type definitions */
    variables?: Record<string, TemplateVariable>
    
    /** Template composition settings */
    composition?: {
      extends?: string
      includes?: Array<{
        template: string
        variables?: Record<string, any>
        condition?: string
      }>
    }
  }
}

/**
 * Action step configuration
 * Executes a V8 decorator-based action
 */
export interface ActionStep extends BaseRecipeStep {
  tool: 'action'
  
  /** Action name to execute */
  action: string
  
  /** Action parameters with validation */
  parameters?: Record<string, any>
  
  /** Whether to run in dry-run mode */
  dryRun?: boolean
  
  /** Whether to force execution (overwrite files) */
  force?: boolean
  
  /** Action-specific configuration */
  actionConfig?: {
    /** Communication settings for multi-action workflows */
    communication?: {
      /** ID for this action instance */
      actionId?: string
      
      /** Message types this action listens for */
      subscribeTo?: string[]
      
      /** Shared data keys this action reads */
      reads?: string[]
      
      /** Shared data keys this action writes */
      writes?: string[]
    }
  }
}

/**
 * CodeMod step configuration
 * Executes code transformations
 */
export interface CodeModStep extends BaseRecipeStep {
  tool: 'codemod'
  
  /** CodeMod identifier or path */
  codemod: string
  
  /** File patterns to transform */
  files: string[]
  
  /** Whether to create backup files */
  backup?: boolean
  
  /** Parser to use for code analysis */
  parser?: 'typescript' | 'javascript' | 'json' | 'auto'
  
  /** CodeMod parameters with validation */
  parameters?: Record<string, any>
  
  /** Whether to force overwrite files */
  force?: boolean
  
  /** CodeMod-specific configuration */
  codemodConfig?: {
    /** Transform options */
    transform?: {
      /** Preserve formatting */
      preserveFormatting?: boolean
      
      /** Include comments in transformation */
      includeComments?: boolean
      
      /** Custom transform rules */
      rules?: Record<string, any>
    }
    
    /** Validation settings */
    validation?: {
      /** Run syntax validation after transformation */
      validateSyntax?: boolean
      
      /** Run type checking (for TypeScript) */
      validateTypes?: boolean
    }
  }
}

/**
 * Recipe step configuration
 * Executes another recipe as a sub-recipe
 */
export interface RecipeStep extends BaseRecipeStep {
  tool: 'recipe'
  
  /** Recipe identifier or path */
  recipe: string
  
  /** Recipe version constraint */
  version?: string
  
  /** Whether to inherit parent recipe variables */
  inheritVariables?: boolean
  
  /** Variable overrides for the sub-recipe */
  variableOverrides?: Record<string, any>
  
  /** Recipe-specific configuration */
  recipeConfig?: {
    /** Execution mode */
    execution?: {
      /** Whether to run sub-recipe in isolation */
      isolated?: boolean
      
      /** Working directory for sub-recipe */
      workingDir?: string
      
      /** Timeout for entire sub-recipe */
      timeout?: number
    }
    
    /** Variable mapping from parent to child */
    variableMapping?: Record<string, string>
  }
}

/**
 * Union type for all step types (discriminated union)
 */
export type RecipeStepUnion = TemplateStep | ActionStep | CodeModStep | RecipeStep

/**
 * Step execution context
 */
export interface StepContext {
  /** Current step being executed */
  step: RecipeStepUnion
  
  /** Resolved variables (merged from recipe and step levels) */
  variables: Record<string, any>
  
  /** Project root directory */
  projectRoot: string
  
  /** Template path (if applicable) */
  templatePath?: string
  
  /** Recipe-level variables */
  recipeVariables: Record<string, any>
  
  /** Results from previous steps */
  stepResults: Map<string, StepResult>
  
  /** Recipe execution metadata */
  recipe: {
    id: string
    name: string
    version?: string
    startTime: Date
  }
  
  /** Step-specific data storage */
  stepData: Record<string, any>
  
  /** Condition evaluator */
  evaluateCondition: (expression: string, context: Record<string, any>) => boolean
  
  /** Dry run mode */
  dryRun?: boolean
  
  /** Force overwrite existing files */
  force?: boolean
  
  /** Logger for step output */
  logger?: ActionLogger
  
  /** Utility functions */
  utils?: ActionUtils
  
  /** Inter-step communication */
  communication?: {
    /** Send data to other steps */
    send: (target: string, data: any) => void
    
    /** Receive data from other steps */
    receive: (source: string) => any
    
    /** Wait for step completion */
    waitForStep: (stepName: string, timeout?: number) => Promise<StepResult>
  }
}

/**
 * Step execution result
 */
export interface StepResult {
  /** Step execution status */
  status: StepStatus
  
  /** Step name */
  stepName: string
  
  /** Tool type that was executed */
  toolType: ToolType
  
  /** Execution start time */
  startTime: Date
  
  /** Execution end time */
  endTime?: Date
  
  /** Execution duration in milliseconds */
  duration?: number
  
  /** Number of retry attempts made */
  retryCount: number
  
  /** Whether step dependencies were satisfied */
  dependenciesSatisfied: boolean
  
  /** Condition evaluation result (if applicable) */
  conditionResult?: boolean
  
  /** Tool-specific execution result */
  toolResult?: ActionResult | TemplateExecutionResult | CodeModExecutionResult | RecipeExecutionResult
  
  /** Files created by this step */
  filesCreated?: string[]
  
  /** Files modified by this step */
  filesModified?: string[]
  
  /** Files deleted by this step */
  filesDeleted?: string[]
  
  /** Error information (if failed) */
  error?: {
    message: string
    code?: string
    stack?: string
    cause?: any
  }
  
  /** Step output data */
  output?: Record<string, any>
  
  /** Metadata for debugging and analysis */
  metadata?: Record<string, any>
}

/**
 * Template execution result
 */
export interface TemplateExecutionResult {
  templateName: string
  templatePath: string
  engine: string
  filesGenerated: string[]
  variables: Record<string, any>
}

/**
 * CodeMod execution result
 */
export interface CodeModExecutionResult {
  codemodName: string
  codemodPath: string
  filesProcessed: string[]
  transformationsSummary: {
    totalFiles: number
    modifiedFiles: number
    errors: number
  }
  backupFiles?: string[]
}

/**
 * Recipe execution result
 */
export interface RecipeExecutionResult {
  recipeName: string
  recipePath: string
  subSteps: StepResult[]
  totalDuration: number
  inheritedVariables: Record<string, any>
}

/**
 * Recipe configuration - replaces TemplateConfig for V8
 */
export interface RecipeConfig {
  /** Recipe name */
  name: string
  
  /** Recipe description */
  description?: string
  
  /** Recipe version */
  version?: string
  
  /** Recipe author */
  author?: string
  
  /** Recipe category for organization */
  category?: string
  
  /** Tags for searchability */
  tags?: string[]
  
  /** Recipe variables with type definitions and validation */
  variables: Record<string, TemplateVariable>
  
  /** Recipe execution steps */
  steps: RecipeStepUnion[]
  
  /** Example configurations */
  examples?: RecipeExample[]
  
  /** Recipe dependencies */
  dependencies?: RecipeDependency[]
  
  /** Expected outputs */
  outputs?: string[]
  
  /** Engine version requirements */
  engines?: {
    hypergen?: string
    node?: string
  }
  
  /** Lifecycle hooks */
  hooks?: {
    /** Before recipe starts */
    beforeRecipe?: string[]
    
    /** After recipe completes */
    afterRecipe?: string[]
    
    /** Before each step */
    beforeStep?: string[]
    
    /** After each step */
    afterStep?: string[]
    
    /** On recipe error */
    onError?: string[]
    
    /** On step error */
    onStepError?: string[]
  }
  
  /** Recipe execution settings */
  settings?: {
    /** Default timeout for all steps */
    timeout?: number
    
    /** Default retry count */
    retries?: number
    
    /** Whether to continue on step failures */
    continueOnError?: boolean
    
    /** Maximum number of parallel steps */
    maxParallelSteps?: number
    
    /** Working directory */
    workingDir?: string
  }
  
  /** Advanced composition features */
  composition?: {
    /** Base recipe to extend */
    extends?: string
    
    /** Recipes to include */
    includes?: Array<{
      recipe: string
      version?: string
      variables?: Record<string, any>
      condition?: string
      strategy?: 'merge' | 'replace' | 'extend'
    }>
    
    /** Conflict resolution strategy */
    conflicts?: {
      strategy: 'merge' | 'replace' | 'extend' | 'error'
      rules?: Record<string, 'merge' | 'replace' | 'extend' | 'error'>
    }
  }
}

/**
 * Recipe example configuration
 */
export interface RecipeExample {
  /** Example title */
  title: string
  
  /** Example description */
  description?: string
  
  /** Example variables */
  variables: Record<string, any>
  
  /** Expected execution result */
  expectedResult?: {
    /** Expected number of steps */
    totalSteps?: number
    
    /** Expected files to be created */
    filesCreated?: string[]
    
    /** Expected execution time range */
    executionTime?: {
      min?: number
      max?: number
    }
  }
}

/**
 * Recipe dependency definition
 */
export interface RecipeDependency {
  /** Dependency name */
  name: string
  
  /** Version constraint */
  version?: string
  
  /** Dependency type */
  type?: 'recipe' | 'template' | 'action' | 'codemod' | 'npm' | 'github' | 'local' | 'http'
  
  /** Source URL for external dependencies */
  url?: string
  
  /** Whether dependency is optional */
  optional?: boolean
  
  /** Whether dependency is only needed for development */
  dev?: boolean
  
  /** Dependency description */
  description?: string
}

/**
 * Recipe execution instance
 */
export interface RecipeExecution {
  /** Unique execution ID */
  id: string
  
  /** Recipe identifier */
  recipeId: string
  
  /** Recipe configuration used */
  recipe: RecipeConfig
  
  /** Current execution status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  
  /** Execution start time */
  startTime: Date
  
  /** Execution end time */
  endTime?: Date
  
  /** Total execution duration */
  duration?: number
  
  /** Step execution results */
  steps: StepResult[]
  
  /** Recipe-level variables */
  variables: Record<string, any>
  
  /** Environment variables */
  environment: Record<string, string>
  
  /** Execution errors */
  errors: string[]
  
  /** Execution warnings */
  warnings: string[]
  
  /** Execution metadata */
  metadata: {
    /** Total number of steps */
    totalSteps: number
    
    /** Number of completed steps */
    completedSteps: number
    
    /** Number of failed steps */
    failedSteps: number
    
    /** Number of skipped steps */
    skippedSteps: number
    
    /** Number of cancelled steps */
    cancelledSteps: number
    
    /** Peak memory usage */
    peakMemory?: number
    
    /** Execution context */
    context: {
      /** Working directory */
      workingDir: string
      
      /** User ID */
      userId?: string
      
      /** Session ID */
      sessionId?: string
    }
  }
  
  /** Execution artifacts */
  artifacts?: {
    /** Generated files */
    files: string[]
    
    /** Log files */
    logs: string[]
    
    /** Report files */
    reports: string[]
  }
}

/**
 * Recipe validation result
 */
export interface RecipeValidationResult {
  /** Whether the recipe is valid */
  isValid: boolean
  
  /** Validation errors */
  errors: RecipeValidationError[]
  
  /** Validation warnings */
  warnings: RecipeValidationWarning[]
  
  /** Recipe being validated */
  recipe: RecipeConfig
  
  /** Validation context */
  context: {
    /** Validation timestamp */
    timestamp: Date
    
    /** Validator version */
    validatorVersion: string
    
    /** Validation scope */
    scope: 'syntax' | 'semantic' | 'full'
  }
}

/**
 * Recipe validation error
 */
export interface RecipeValidationError {
  /** Error code */
  code: string
  
  /** Error message */
  message: string
  
  /** Location of error */
  location?: {
    /** Step name (if applicable) */
    step?: string
    
    /** Field path */
    field?: string
    
    /** Line number (if applicable) */
    line?: number
    
    /** Column number (if applicable) */
    column?: number
  }
  
  /** Error severity */
  severity: 'error' | 'critical'
  
  /** Suggested fix */
  suggestion?: string
}

/**
 * Recipe validation warning
 */
export interface RecipeValidationWarning {
  /** Warning code */
  code: string
  
  /** Warning message */
  message: string
  
  /** Location of warning */
  location?: {
    /** Step name (if applicable) */
    step?: string
    
    /** Field path */
    field?: string
    
    /** Line number (if applicable) */
    line?: number
    
    /** Column number (if applicable) */
    column?: number
  }
  
  /** Warning severity */
  severity: 'warning' | 'info'
  
  /** Suggested improvement */
  suggestion?: string
}

/**
 * Step dependency graph node
 */
export interface StepDependencyNode {
  /** Step name */
  stepName: string
  
  /** Dependencies (steps that must complete first) */
  dependencies: string[]
  
  /** Dependents (steps that depend on this one) */
  dependents: string[]
  
  /** Execution order priority */
  priority: number
  
  /** Whether this step can run in parallel */
  parallelizable: boolean
}

/**
 * Recipe execution plan
 */
export interface RecipeExecutionPlan {
  /** Recipe being executed */
  recipe: RecipeConfig
  
  /** Execution order phases */
  phases: Array<{
    /** Phase number */
    phase: number
    
    /** Steps to execute in this phase */
    steps: string[]
    
    /** Whether steps in this phase can run in parallel */
    parallel: boolean
  }>
  
  /** Dependency graph */
  dependencyGraph: Map<string, StepDependencyNode>
  
  /** Estimated execution time */
  estimatedDuration?: number
  
  /** Resource requirements */
  resources?: {
    /** Memory requirements (MB) */
    memory?: number
    
    /** CPU requirements */
    cpu?: number
    
    /** Disk space requirements (MB) */
    disk?: number
  }
}

/**
 * Step execution options
 */
export interface StepExecutionOptions {
  /** Execution timeout */
  timeout?: number
  
  /** Number of retries */
  retries?: number
  
  /** Whether to continue on error */
  continueOnError?: boolean
  
  /** Whether to run in dry-run mode */
  dryRun?: boolean
  
  /** Whether to run in parallel with other steps */
  parallel?: boolean
  
  /** Custom execution context */
  context?: Partial<StepContext>
}

/**
 * Recipe engine configuration
 */
export interface RecipeEngineConfig {
  /** Maximum number of concurrent step executions */
  maxConcurrency?: number
  
  /** Default step timeout */
  defaultTimeout?: number
  
  /** Default retry count */
  defaultRetries?: number
  
  /** Working directory */
  workingDir?: string
  
  /** Cache configuration */
  cache?: {
    /** Whether to enable caching */
    enabled: boolean
    
    /** Cache directory */
    directory?: string
    
    /** Cache TTL in seconds */
    ttl?: number
  }
  
  /** Logging configuration */
  logging?: {
    /** Log level */
    level: 'debug' | 'info' | 'warn' | 'error'
    
    /** Log file path */
    file?: string
    
    /** Whether to log to console */
    console?: boolean
  }
  
  /** Security settings */
  security?: {
    /** Whether to allow external recipes */
    allowExternalRecipes?: boolean
    
    /** Trusted recipe sources */
    trustedSources?: string[]
    
    /** Sandboxing options */
    sandbox?: boolean
  }
}

/**
 * Type guard functions for step types
 */
export function isTemplateStep(step: RecipeStepUnion): step is TemplateStep {
  return step.tool === 'template'
}

export function isActionStep(step: RecipeStepUnion): step is ActionStep {
  return step.tool === 'action'
}

export function isCodeModStep(step: RecipeStepUnion): step is CodeModStep {
  return step.tool === 'codemod'
}

export function isRecipeStep(step: RecipeStepUnion): step is RecipeStep {
  return step.tool === 'recipe'
}

/**
 * Utility type for extracting step types
 */
export type StepByTool<T extends ToolType> = 
  T extends 'template' ? TemplateStep :
  T extends 'action' ? ActionStep :
  T extends 'codemod' ? CodeModStep :
  T extends 'recipe' ? RecipeStep :
  never

/**
 * Recipe engine error types
 */
export class RecipeValidationError extends Error {
  constructor(
    message: string,
    public code: string,
    public location?: { step?: string; field?: string; line?: number; column?: number }
  ) {
    super(message)
    this.name = 'RecipeValidationError'
  }
}

export class StepExecutionError extends Error {
  constructor(
    message: string,
    public stepName: string,
    public toolType: ToolType,
    public cause?: Error
  ) {
    super(message)
    this.name = 'StepExecutionError'
  }
}

export class RecipeDependencyError extends Error {
  constructor(
    message: string,
    public dependency: string,
    public version?: string
  ) {
    super(message)
    this.name = 'RecipeDependencyError'
  }
}

export class CircularDependencyError extends Error {
  constructor(
    message: string,
    public cycle: string[]
  ) {
    super(message)
    this.name = 'CircularDependencyError'
  }
}