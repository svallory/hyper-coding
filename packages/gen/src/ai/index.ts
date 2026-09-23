/**
 * AI Integration Module
 *
 * Public exports for Hypergen's AI integration.
 */

// 2-pass AI generation
export { type AiBlockEntry, AiCollector } from "./ai-collector.js";
// Configuration types
export type {
	AIBudgetConfig,
	AIContextConfig,
	AICostSummary,
	AIExample,
	AIExecutionResult,
	AIGuardrailConfig,
	AIModelPricing,
	AIModelRef,
	AIOutputConfig,
	AiServiceConfig,
} from "./ai-config.js";
// Core service
export { AiService, type GenerateOptions } from "./ai-service.js";
// Context collection
export { type ContextBundle, ContextCollector } from "./context-collector.js";
// Cost tracking
export { CostTracker } from "./cost-tracker.js";
// Environment / API key resolution
export {
	ALL_KNOWN_API_KEY_VARS,
	getExpectedEnvVar,
	hasApiKeyAvailable,
	loadDotenv,
	PROVIDER_API_KEY_ENV_VARS,
	resolveApiKey,
} from "./env.js";
// Model routing
export { ModelRouter, type ResolvedModel } from "./model-router.js";
// Output validation
export {
	buildValidationFeedback,
	type ValidationResult,
	validateOutput,
} from "./output-validator.js";
export { type AssemblerOptions, PromptAssembler } from "./prompt-assembler.js";
// Prompt pipeline
export {
	type AssembledPrompt,
	PromptPipeline,
	type PromptPipelineOptions,
} from "./prompt-pipeline.js";

// AI transports (pluggable resolution for 2-pass @ai blocks)
export {
	type AiTransport,
	ApiTransport,
	CommandTransport,
	resolveTransport,
	StdoutTransport,
	type TransportContext,
	type TransportResult,
} from "./transports/index.js";
