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
} from './base.js'

// Concrete tool implementations
export {
  TemplateTool,
  TemplateToolFactory,
  templateToolFactory
} from './template-tool.js'

export {
  ActionTool,
  ActionToolFactory,
  actionToolFactory
} from './action-tool.js'

export {
  RecipeTool,
  RecipeToolFactory,
  recipeToolFactory
} from './recipe-tool.js'

export type {
  ToolFactory,
  ToolPhase,
  ToolResource,
  ToolLifecycleMetrics,
  ToolValidationResult
} from './base.js'

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
} from './registry.js'

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
} from '../types.js'

// Import types and classes for internal use
import type { ToolType, RecipeStepUnion } from '../types.js'
import type { ToolPhase, ToolValidationResult } from './base.js'
import { Tool } from './base.js'
import { ToolRegistry, getToolRegistry, type ToolResolutionOptions, type ToolRegistryStats } from './registry.js'

// Re-export type guard functions for convenience
export {
  isTemplateStep,
  isActionStep,
  isCodeModStep,
  isRecipeStep,
  
  // Error classes
  StepExecutionError,
  RecipeDependencyError,
  CircularDependencyError
} from '../types.js'

// Tool framework utilities and helpers

/**
 * Tool framework version information
 */
export const TOOL_FRAMEWORK_VERSION = '8.0.0'

/**
 * Supported tool types in the Recipe Step System
 */
export const SUPPORTED_TOOL_TYPES: readonly ToolType[] = ['template', 'action', 'codemod', 'recipe'] as const

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