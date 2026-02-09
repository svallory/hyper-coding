/**
 * Hypergen - Modern Code Generator
 *
 * Public API exports for programmatic usage
 */

// Core types
export type { RunnerConfig, RunnerResult } from './types.js'

// Logger
export { default as Logger } from './logger.js'

// Engine (for programmatic use)
export { default as engine, ShowHelpError } from './engine.js'

// Runner (for backward compatibility with tests)
export async function runner(
  argv: string[],
  config: RunnerConfig,
): Promise<RunnerResult> {
  const logger = config.logger || new Logger(console.log.bind(console))

  try {
    const actions = await engine(argv, config)
    return { success: true, actions, time: 0 }
  } catch (err: any) {
    logger.log(err.toString())
    if (config.debug) {
      logger.log('details -----------')
      logger.log(err.stack)
      logger.log('-------------------')
    }
    if (err instanceof ShowHelpError) {
      return { success: true, actions: [], time: 0 }
    }
    return { success: false, actions: [], time: 0 }
  }
}

// Configuration
export {
  HypergenConfigLoader,
  createConfigFile,
  getConfigInfo,
  type ResolvedConfig,
  type HypergenConfig,
} from './config/hypergen-config.js'

// Template parsing
export { TemplateParser, type TemplateConfig } from './config/template-parser.js'

// URL resolution
export { TemplateURLManager } from './config/url-resolution/index.js'

// Actions system
export {
  ActionExecutor,
  ActionRegistry,
  DefaultActionUtils,
  ConsoleActionLogger,
  action,
} from './actions/index.js'

// Discovery
export { GeneratorDiscovery } from './discovery/index.js'

// Recipe Engine
export * from './recipe-engine/index.js'

// AI Integration
export {
  AiService,
  CostTracker,
  ModelRouter,
  PromptPipeline,
  ContextCollector,
} from './ai/index.js'

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
} from './ai/index.js'

// Errors
export {
  HypergenError,
  ErrorCode,
  ErrorHandler,
} from './errors/hypergen-errors.js'

// oclif base command for plugin development
export { BaseCommand } from './lib/base-command.js'
