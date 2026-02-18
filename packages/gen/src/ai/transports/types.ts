/**
 * AI Transport Interface
 *
 * Defines the contract for resolving @ai blocks collected during Pass 1.
 * Transports handle delivering the prompt to an AI and returning answers.
 */

import type { AiCollector } from "../ai-collector.js";
import type { AiServiceConfig } from "../ai-config.js";

/**
 * Result of a transport resolution attempt.
 * Either answers are resolved inline (auto Pass 2), or deferred (user re-runs with --answers).
 */
export type TransportResult =
	| { status: "resolved"; answers: Record<string, string> }
	| { status: "deferred"; exitCode: number };

/**
 * Context passed to a transport's resolve method.
 */
/**
 * Describes a recipe variable for inclusion in the prompt document.
 */
export interface PromptVariable {
	/** Variable name (JSON key in answers file) */
	name: string;
	/** Variable type */
	type: string;
	/** Whether a value is required */
	required: boolean;
	/** Default value, if any */
	default?: unknown;
	/** Prompt question for the variable */
	prompt?: string;
	/** Human-readable description */
	description?: string;
	/** Allowed values for enum types */
	values?: string[];
	/** Whether the user already provided a value */
	provided: boolean;
	/** The value the user provided (if any) */
	providedValue?: unknown;
}

export interface TransportContext {
	/** The collector with accumulated @ai block data */
	collector: AiCollector;

	/** AI configuration from hypergen.config.js */
	config: AiServiceConfig;

	/** The original CLI command (for callback instructions) */
	originalCommand: string;

	/** Suggested path for the answers JSON file */
	answersPath: string;

	/** Project root directory */
	projectRoot: string;

	/** Optional custom prompt template path */
	promptTemplate?: string;

	/** Recipe variables with their definitions and current values */
	variables?: PromptVariable[];
}

/**
 * A transport knows how to resolve AiBlockEntry[] into answers.
 *
 * Implementations:
 * - StdoutTransport: prints prompt to stdout, exits with code 2
 * - ApiTransport: calls LLM via Vercel AI SDK, returns answers inline
 * - CommandTransport: pipes prompt to a CLI command, parses response
 *
 * Future:
 * - StdioTransport: persistent subprocess with JSON protocol
 */
export interface AiTransport {
	readonly name: string;
	resolve(ctx: TransportContext): Promise<TransportResult>;
}
