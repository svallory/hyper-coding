/**
 * Recipe Step System - Tools Framework
 * 
 * Central export point for the Recipe Step System tools framework.
 * Provides access to base classes, registry, and all tool-related functionality.
 */

// Base tool framework
export {
  Tool,
  BaseToolFactory
} from '#/base.js'

// Concrete tool implementations
export {
  TemplateTool,
  TemplateToolFactory,
  templateToolFactory
} from '#/template-tool.js'

export {
  ActionTool,
  ActionToolFactory,
  actionToolFactory
} from '#/action-tool.js'

export {
  RecipeTool,
  RecipeToolFactory,
  recipeToolFactory
} from '#/recipe-tool.js'

export {
  ShellTool,
  ShellToolFactory,
  shellToolFactory
} from '#/shell-tool.js'

export {
  AiTool,
  AiToolFactory,
  aiToolFactory
} from '#/ai-tool.js'

export {
  InstallTool,
  InstallToolFactory,
  installToolFactory
} from '#/install-tool.js'

export {
  QueryTool,
  QueryToolFactory,
  queryToolFactory
} from '#/query-tool.js'

export {
  PatchTool,
  PatchToolFactory,
  patchToolFactory
} from '#/patch-tool.js'

export {
  EnsureDirsTool,
  EnsureDirsToolFactory,
  ensureDirsToolFactory
} from '#/ensure-dirs-tool.js'

export type {
  ToolFactory,
  ToolPhase,
  ToolResource,
  ToolLifecycleMetrics,
  ToolValidationResult
} from '#/base.js'

// Tool registry system
export {
  ToolRegistry,
  getToolRegistry,
  registerTool,
  resolveTool,
  type ToolRegistration,
  type ToolRegistryStats,
  type ToolSearchCriteria,
  type ToolResolutionOptions
} from '#/registry.js'

// Re-export types from recipe-engine types for convenience
export type {
  // Core types
  ToolType,
  StepStatus,
  RecipeStepUnion,
  BaseRecipeStep,
  
  // Step types
  TemplateStep,
  ActionStep,
  CodeModStep,
  RecipeStep,
  ShellStep,
  AIStep,
  InstallStep,
  QueryStep,
  PatchStep,
  EnsureDirsStep,
  
  // Context and execution
  StepContext,
  StepResult,
  StepExecutionOptions,
  
  // Results
  TemplateExecutionResult,
  CodeModExecutionResult,
  RecipeExecutionResult,
  
  // Configuration and validation
  RecipeConfig,
  RecipeValidationResult,
  RecipeValidationError,
  RecipeValidationWarning,
  
  // Engine configuration
  RecipeEngineConfig,
  
  // Type guards
  StepByTool
} from '#/recipe-engine/types'

// Import types and classes for internal use
import type { ToolType, RecipeStepUnion } from '#/recipe-engine/types'
import type { ToolPhase, ToolValidationResult } from '#/base.js'
import { Tool } from '#/base.js'
import { ToolRegistry, getToolRegistry, type ToolResolutionOptions, type ToolRegistryStats } from '#/registry.js'
import { templateToolFactory } from '#/template-tool.js'
import { actionToolFactory } from '#/action-tool.js'
import { recipeToolFactory } from '#/recipe-tool.js'
import { shellToolFactory } from '#/shell-tool.js'
import { promptToolFactory } from '#/prompt-tool.js'
import { sequenceToolFactory } from '#/sequence-tool.js'
import { parallelToolFactory } from '#/parallel-tool.js'
import { aiToolFactory } from '#/ai-tool.js'
import { installToolFactory } from '#/install-tool.js'
import { queryToolFactory } from '#/query-tool.js'
import { patchToolFactory } from '#/patch-tool.js'
import { ensureDirsToolFactory } from '#/ensure-dirs-tool.js'

// Re-export type guard functions for convenience
export {
  isTemplateStep,
  isActionStep,
  isCodeModStep,
  isRecipeStep,
  isAIStep,
  isInstallStep,
  isQueryStep,
  isPatchStep,
  isEnsureDirsStep,

  // Error classes
  StepExecutionError,
  RecipeDependencyError,
  CircularDependencyError
} from '#/recipe-engine/types'

// Tool framework utilities and helpers

/**
 * Tool framework version information
 */
export const TOOL_FRAMEWORK_VERSION = '8.0.0'

/**
 * Supported tool types in the Recipe Step System
 */
export const SUPPORTED_TOOL_TYPES: readonly ToolType[] = ['template', 'action', 'codemod', 'recipe', 'shell', 'ai', 'install', 'query', 'patch', 'ensure-dirs'] as const

/**
 * Default tool registry configuration
 */
export const DEFAULT_REGISTRY_CONFIG = {
  maxCacheSize: 100,
  cacheTimeoutMs: 30 * 60 * 1000, // 30 minutes
  enableInstanceReuse: true
} as const

/**
 * Tool execution phases for lifecycle management
 */
export const TOOL_EXECUTION_PHASES: readonly ToolPhase[] = ['validate', 'execute', 'cleanup'] as const

/**
 * Initialize the tools framework with default configurations
 * 
 * This function sets up the tool registry with sensible defaults
 * and can be called once during application startup.
 */
export function initializeToolsFramework(options?: {
  registryConfig?: Partial<typeof DEFAULT_REGISTRY_CONFIG>
  enableDebugLogging?: boolean
}): ToolRegistry {
  const registry = ToolRegistry.getInstance({
    ...DEFAULT_REGISTRY_CONFIG,
    ...options?.registryConfig
  })

  if (options?.enableDebugLogging) {
    // Enable debug logging for the tools framework
    process.env.DEBUG = process.env.DEBUG 
      ? `${process.env.DEBUG},hypergen:v8:recipe:tool*,hypergen:v8:recipe:registry*`
      : 'hypergen:v8:recipe:tool*,hypergen:v8:recipe:registry*'
  }

  return registry
}

/**
 * Register default tools (template, action, recipe, shell)
 */
export function registerDefaultTools(): void {
  const registry = getToolRegistry()
  
  // Register Template Tool
  if (!registry.isRegistered('template', 'default')) {
    registry.register('template', 'default', templateToolFactory, {
      description: 'Process template files',
      category: 'core'
    })
  }
  
  // Register Action Tool
  if (!registry.isRegistered('action', 'default')) {
    registry.register('action', 'default', actionToolFactory, {
      description: 'Execute TypeScript actions',
      category: 'core'
    })
  }
  
  // Register Recipe Tool
  if (!registry.isRegistered('recipe', 'default')) {
    registry.register('recipe', 'default', recipeToolFactory, {
      description: 'Execute other recipes',
      category: 'core'
    })
  }
  
  // Register Shell Tool
  if (!registry.isRegistered('shell', 'default')) {
    registry.register('shell', 'default', shellToolFactory, {
      description: 'Execute shell commands',
      category: 'core'
    })
  }

  // Register Prompt Tool
  if (!registry.isRegistered('prompt', 'default')) {
    registry.register('prompt', 'default', promptToolFactory, {
      description: 'Interactive user prompts',
      category: 'interaction'
    })
  }

  // Register Sequence Tool
  if (!registry.isRegistered('sequence', 'default')) {
    registry.register('sequence', 'default', sequenceToolFactory, {
      description: 'Sequential step execution',
      category: 'core'
    })
  }

  // Register Parallel Tool
  if (!registry.isRegistered('parallel', 'default')) {
    registry.register('parallel', 'default', parallelToolFactory, {
      description: 'Parallel step execution',
      category: 'core'
    })
  }

  // Register AI Tool
  if (!registry.isRegistered('ai', 'default')) {
    registry.register('ai', 'default', aiToolFactory, {
      description: 'AI-powered code generation',
      category: 'ai'
    })
  }

  // Register Install Tool
  if (!registry.isRegistered('install', 'default')) {
    registry.register('install', 'default', installToolFactory, {
      description: 'Install packages via package manager',
      category: 'core'
    })
  }

  // Register Query Tool
  if (!registry.isRegistered('query', 'default')) {
    registry.register('query', 'default', queryToolFactory, {
      description: 'Query structured data files (JSON, YAML, TOML, .env)',
      category: 'core'
    })
  }

  // Register Patch Tool
  if (!registry.isRegistered('patch', 'default')) {
    registry.register('patch', 'default', patchToolFactory, {
      description: 'Deep-merge data into structured files',
      category: 'core'
    })
  }

  // Register EnsureDirs Tool
  if (!registry.isRegistered('ensure-dirs', 'default')) {
    registry.register('ensure-dirs', 'default', ensureDirsToolFactory, {
      description: 'Create directories (mkdir -p)',
      category: 'core'
    })
  }
}

/**
 * Utility function to create a simple tool validation result
 */
export function createValidationResult(
  isValid: boolean,
  errors: string[] = [],
  warnings: string[] = [],
  suggestions: string[] = []
): ToolValidationResult {
  return {
    isValid,
    errors,
    warnings,
    suggestions
  }
}

/**
 * Utility function to check if a tool type is supported
 */
export function isSupportedToolType(type: string): type is ToolType {
  return SUPPORTED_TOOL_TYPES.includes(type as ToolType)
}

/**
 * Utility function to validate tool type at runtime
 */
export function validateToolType(type: string): ToolType {
  if (!isSupportedToolType(type)) {
    throw new Error(`Unsupported tool type: ${type}. Supported types: ${SUPPORTED_TOOL_TYPES.join(', ')}`)
  }
  return type
}

/**
 * Tool framework constants for error handling and debugging
 */
export const TOOL_FRAMEWORK_CONSTANTS = {
  // Default timeouts
  DEFAULT_TOOL_TIMEOUT: 30000, // 30 seconds
  DEFAULT_VALIDATION_TIMEOUT: 5000, // 5 seconds
  DEFAULT_CLEANUP_TIMEOUT: 10000, // 10 seconds
  
  // Retry configuration
  DEFAULT_MAX_RETRIES: 3,
  MIN_RETRY_DELAY: 1000, // 1 second
  MAX_RETRY_DELAY: 30000, // 30 seconds
  
  // Memory thresholds
  MEMORY_WARNING_THRESHOLD: 512 * 1024 * 1024, // 512MB
  MEMORY_ERROR_THRESHOLD: 1024 * 1024 * 1024, // 1GB
  
  // Cache configuration
  CACHE_CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
  MAX_CACHE_AGE: 60 * 60 * 1000, // 1 hour
  
  // Debug categories
  DEBUG_CATEGORIES: [
    'hypergen:v8:recipe:tool',
    'hypergen:v8:recipe:tool:template',
    'hypergen:v8:recipe:tool:action',
    'hypergen:v8:recipe:tool:codemod',
    'hypergen:v8:recipe:tool:recipe',
    'hypergen:v8:recipe:registry'
  ]
} as const

/**
 * Type-safe tool creation helper
 * 
 * Provides a type-safe way to create tools with proper type checking
 */
export async function createTool<T extends RecipeStepUnion>(
  toolType: T['tool'],
  name: string,
  options?: ToolResolutionOptions
): Promise<Tool<T>> {
  const registry = getToolRegistry()
  return await registry.resolve(toolType, name, options) as Tool<T>
}

/**
 * Batch tool resolution helper
 * 
 * Resolves multiple tools in parallel for better performance
 */
export async function resolveTools(
  requests: Array<{
    toolType: ToolType
    name: string
    options?: ToolResolutionOptions
  }>
): Promise<Tool[]> {
  const registry = getToolRegistry()
  
  const promises = requests.map(request =>
    registry.resolve(request.toolType, request.name, request.options)
  )
  
  return await Promise.all(promises)
}

/**
 * Tool registry health check utility
 * 
 * Performs basic health checks on the tool registry
 */
export function checkRegistryHealth(): {
  healthy: boolean
  issues: string[]
  stats: ToolRegistryStats
} {
  const registry = getToolRegistry()
  const stats = registry.getStats()
  const issues: string[] = []
  
  // Check if we have tools registered
  if (stats.totalRegistrations === 0) {
    issues.push('No tools registered in the registry')
  }
  
  // Check memory usage
  const totalMemory = stats.memory.registrySize + stats.memory.cacheSize
  if (totalMemory > TOOL_FRAMEWORK_CONSTANTS.MEMORY_WARNING_THRESHOLD) {
    issues.push(`High memory usage: ${Math.round(totalMemory / 1024 / 1024)}MB`)
  }
  
  // Check for excessive cached instances
  const cacheRatio = stats.cachedInstances / Math.max(stats.totalRegistrations, 1)
  if (cacheRatio > 5) {
    issues.push(`Excessive cached instances: ${stats.cachedInstances} cached vs ${stats.totalRegistrations} registered`)
  }
  
  return {
    healthy: issues.length === 0,
    issues,
    stats
  }
}

/**
 * Development and debugging utilities
 */
export const DevUtils = {
  /**
   * Enable debug logging for specific tool types
   */
  enableDebugLogging: (toolTypes: ToolType[] = [...SUPPORTED_TOOL_TYPES]) => {
    const categories = toolTypes.map(type => `hypergen:v8:recipe:tool:${type}`)
    const existing = process.env.DEBUG || ''
    process.env.DEBUG = existing 
      ? `${existing},${categories.join(',')}`
      : categories.join(',')
  },

  /**
   * Get detailed registry information for debugging
   */
  getRegistryDebugInfo: () => {
    const registry = getToolRegistry()
    const stats = registry.getStats()
    const health = checkRegistryHealth()
    
    return {
      version: TOOL_FRAMEWORK_VERSION,
      supportedTypes: SUPPORTED_TOOL_TYPES,
      registryStats: stats,
      healthCheck: health,
      registeredTypes: registry.getRegisteredTypes(),
      categories: registry.getCategories()
    }
  },

  /**
   * Reset the tool registry (useful for testing)
   */
  resetRegistry: () => {
    ToolRegistry.reset()
  }
} as const