/**
 * AI Service Configuration Types
 *
 * Types for configuring the AI integration in Hypergen.
 * Used in hypergen.config.js under the `ai` key.
 */

/**
 * Top-level AI configuration for hypergen.config.js
 */
export interface AiServiceConfig {
	/**
	 * Path to a custom Jig template for the prompt document generated during
	 * Pass 1 of 2-pass AI generation.  When omitted the built-in template
	 * shipped with Hypergen is used.  Relative paths are resolved from the
	 * project root.
	 */
	promptTemplate?: string;

	/** Default AI provider (e.g., 'anthropic', 'openai', 'ollama') */
	provider?: string;

	/** Default model (e.g., 'claude-sonnet-4-5', 'gpt-4o') */
	model?: string;

	/**
	 * Name of the environment variable that holds the API key.
	 * Example: 'ANTHROPIC_API_KEY'
	 *
	 * When omitted, a well-known default is inferred from the provider
	 * (e.g., provider 'anthropic' → ANTHROPIC_API_KEY).
	 *
	 * The env var is loaded automatically from .env files via dotenvx.
	 * NEVER put actual API keys in config — config files are committed.
	 */
	apiKeyEnvVar?: string;

	/** Default system prompt prepended to all AI calls */
	systemPrompt?: string;

	/** Default temperature (0-2) */
	temperature?: number;

	/** Default max output tokens */
	maxTokens?: number;

	/**
	 * AI resolution mode for 2-pass @ai blocks.
	 * - 'auto': detect from config (default) — API key → api, command set → command, else stdout
	 * - 'api': call LLM via Vercel AI SDK (requires provider + API key env var)
	 * - 'command': pipe prompt to a CLI command (requires ai.command)
	 * - 'stdout': print prompt to stdout, exit code 2 (for AI agents)
	 * - 'off': no AI automation (same as stdout now; future: interactive prompts)
	 */
	mode?: "auto" | "api" | "command" | "stdout" | "off";

	/**
	 * CLI command template for 'command' mode.
	 * Include {prompt} for argument substitution, or omit to pipe via stdin.
	 * Examples: 'claude -p {prompt}', 'llm', 'aichat -r coder'
	 */
	command?: string;

	/**
	 * How command mode handles multiple @ai blocks.
	 * - 'batched': one invocation, expects JSON response (default)
	 * - 'per-block': one invocation per @ai block, raw text response
	 */
	commandMode?: "batched" | "per-block";

	/** Cost budget configuration */
	budget?: AIBudgetConfig;

	/** Default guardrails applied to all AI steps */
	defaultGuardrails?: AIGuardrailConfig;

	/** Fallback models tried when primary fails */
	fallbackModels?: AIModelRef[];

	/** Cost table for token pricing (model name → pricing) */
	costTable?: Record<string, AIModelPricing>;
}

/**
 * Reference to a specific model on a specific provider
 */
export interface AIModelRef {
	provider: string;
	model: string;
	/** Name of the environment variable holding the API key for this fallback */
	apiKeyEnvVar?: string;
}

/**
 * Token pricing for a model
 */
export interface AIModelPricing {
	/** Cost per 1M input tokens in USD */
	inputPer1M: number;
	/** Cost per 1M output tokens in USD */
	outputPer1M: number;
}

/**
 * Budget configuration for AI cost control
 */
export interface AIBudgetConfig {
	/** Hard limit: abort if total cost exceeds this (USD) */
	maxTotalCostUsd?: number;
	/** Warning threshold (USD) */
	warnAtCostUsd?: number;
	/** Hard limit on total tokens across all AI steps */
	maxTotalTokens?: number;
}

/**
 * How AI output is used
 */
export interface AIOutputConfig {
	/** Output destination type */
	type: "variable" | "file" | "inject" | "stdout";
	/** Variable name to store result (for type='variable') */
	variable?: string;
	/** File path to write (supports Liquid interpolation, for type='file') */
	to?: string;
	/** File path to inject into (for type='inject') */
	injectInto?: string;
	/** Inject after this pattern */
	after?: string;
	/** Inject before this pattern */
	before?: string;
	/** Inject at start or end of file */
	at?: "start" | "end";
	/** Zod-compatible JSON schema for structured output */
	schema?: Record<string, any>;
	/** Load schema from file */
	schemaFile?: string;
}

/**
 * Context files and data to include in the prompt
 */
export interface AIContextConfig {
	/** Glob patterns for context files */
	files?: string[];
	/** Explicit file paths to include */
	include?: string[];
	/** Include project config files */
	projectConfig?: boolean | ("tsconfig" | "package.json" | "eslint" | ".editorconfig")[];
	/** Include output from previous recipe steps */
	fromSteps?: string[];
	/** Token budget for context (prevents blowup) */
	maxContextTokens?: number;
	/** What to do when context exceeds budget */
	overflow?: "truncate" | "summarize" | "error";
}

/**
 * Few-shot example for improving generation quality
 */
export interface AIExample {
	/** Human-readable label */
	label?: string;
	/** Example input/prompt */
	input: string;
	/** Expected output */
	output: string;
}

/**
 * Guardrails for validating AI output
 */
export interface AIGuardrailConfig {
	/** Syntax validation (language-specific) */
	validateSyntax?: boolean | ("typescript" | "javascript" | "json" | "yaml" | "css" | "html");
	/** Only allow imports from these packages */
	allowedImports?: string[];
	/** Block specific imports */
	blockedImports?: string[];
	/** All imports must exist in package.json */
	requireKnownImports?: boolean;
	/** Max output length in characters */
	maxOutputLength?: number;
	/** Custom validator module path */
	customValidator?: string;
	/** Retry attempts on validation failure */
	retryOnFailure?: number;
	/** What to do on failure */
	onFailure?: "error" | "retry" | "retry-with-feedback" | "fallback";
	/** Static fallback if all retries fail */
	fallback?: string;
}

/**
 * AI execution result returned by AiService
 */
export interface AIExecutionResult {
	/** Generated text output */
	output: string;
	/** Structured output (if schema was provided) */
	structured?: Record<string, any>;
	/** Token usage */
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	/** Estimated cost in USD */
	costUsd: number;
	/** Model used */
	model: string;
	/** Provider used */
	provider: string;
	/** Number of retry attempts made */
	retryAttempts: number;
	/** Validation results */
	validation?: {
		passed: boolean;
		errors: string[];
	};
	/** Duration in milliseconds */
	durationMs: number;
}

/**
 * Cost summary for an entire recipe execution
 */
export interface AICostSummary {
	/** Total input tokens across all AI steps */
	totalInputTokens: number;
	/** Total output tokens across all AI steps */
	totalOutputTokens: number;
	/** Total tokens */
	totalTokens: number;
	/** Total estimated cost in USD */
	totalCostUsd: number;
	/** Number of AI steps executed */
	stepCount: number;
	/** Per-step breakdown */
	steps: Array<{
		stepName: string;
		model: string;
		inputTokens: number;
		outputTokens: number;
		costUsd: number;
		retryAttempts: number;
	}>;
	/** Whether budget warning was triggered */
	budgetWarningTriggered: boolean;
	/** Whether budget limit was hit */
	budgetLimitHit: boolean;
}
