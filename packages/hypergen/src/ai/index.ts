/**
 * AI Integration Module
 *
 * Public exports for Hypergen's AI integration.
 */

// Configuration types
export type {
  AiServiceConfig,
  AIModelRef,
  AIModelPricing,
  AIBudgetConfig,
  AIOutputConfig,
  AIContextConfig,
  AIExample,
  AIGuardrailConfig,
  AIExecutionResult,
  AICostSummary,
} from './ai-config.js'

// Core service
export { AiService, type GenerateOptions } from './ai-service.js'

// Model routing
export { ModelRouter, type ResolvedModel } from './model-router.js'

// Cost tracking
export { CostTracker } from './cost-tracker.js'

// Prompt pipeline
export { PromptPipeline, type AssembledPrompt, type PromptPipelineOptions } from './prompt-pipeline.js'

// Context collection
export { ContextCollector, type ContextBundle } from './context-collector.js'

// Output validation
export { validateOutput, buildValidationFeedback, type ValidationResult } from './output-validator.js'

// Environment / API key resolution
export {
  resolveApiKey,
  hasApiKeyAvailable,
  getExpectedEnvVar,
  loadDotenv,
  PROVIDER_API_KEY_ENV_VARS,
  ALL_KNOWN_API_KEY_VARS,
} from './env.js'

// 2-pass AI generation
export { AiCollector, type AiBlockEntry } from './ai-collector.js'
export { PromptAssembler, type AssemblerOptions } from './prompt-assembler.js'

// AI transports (pluggable resolution for 2-pass @ai blocks)
export {
  resolveTransport,
  StdoutTransport,
  ApiTransport,
  CommandTransport,
  type AiTransport,
  type TransportResult,
  type TransportContext,
} from './transports/index.js'
