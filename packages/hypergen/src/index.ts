/**
 * Hypergen - Modern Code Generator
 *
 * Public API exports for programmatic usage
 */

// Core types
export type { RunnerConfig, RenderedAction, ActionResult, Logger as LoggerInterface, Prompter } from '#/types.js'

// Logger
export { default as Logger } from '#/logger.js'

// Configuration
export {
  HypergenConfigLoader,
  createConfigFile,
  getConfigInfo,
  type ResolvedConfig,
  type HypergenConfig,
} from '#/config/hypergen-config.js'

// Template parsing
export { TemplateParser, type TemplateConfig } from '#/config/template-parser.js'

// URL resolution
export { TemplateURLManager } from '#/config/url-resolution/index.js'

// Actions system
export {
  ActionExecutor,
  ActionRegistry,
  DefaultActionUtils,
  ConsoleActionLogger,
  action,
} from '#/actions/index.js'

// Discovery
export { GeneratorDiscovery } from '#/discovery/index.js'

// Recipe Engine
export * from '#/recipe-engine/index.js'

// AI Integration
export {
  AiService,
  CostTracker,
  ModelRouter,
  PromptPipeline,
  ContextCollector,
} from '#/ai/index.js'

export type {
  AiServiceConfig,
  AIOutputConfig,
  AIContextConfig,
  AIExample,
  AIGuardrailConfig,
  AIBudgetConfig,
  AIExecutionResult,
  AICostSummary,
  GenerateOptions,
} from '#/ai/index.js'

// Errors
export {
  HypergenError,
  ErrorCode,
  ErrorHandler,
} from '#/errors/hypergen-errors.js'

// oclif base command for plugin development
export { BaseCommand } from '#/lib/base-command.js'

// Template engine
export { registerHelpers, getJig, initializeJig, renderTemplate } from '#/template-engines/jig-engine.js'

// Helper loading utility
export { loadHelpers } from '#/config/load-helpers.js'
