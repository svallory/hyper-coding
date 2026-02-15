/**
 * AI Service
 *
 * Central gateway for all AI operations in Hypergen.
 * Used by both AiTool (recipe steps) and {% ai %} (template tag).
 * Orchestrates prompt pipeline, model routing, output validation,
 * retry-with-feedback, and cost tracking.
 */

import createDebug from "debug";
import { ErrorHandler, ErrorCode } from "#/errors/hypergen-errors";
import { ModelRouter } from "#/model-router.js";
import { CostTracker } from "#/cost-tracker.js";
import { PromptPipeline, type PromptPipelineOptions } from "#/prompt-pipeline.js";
import { validateOutput, buildValidationFeedback } from "#/output-validator.js";
import type {
	AiServiceConfig,
	AIGuardrailConfig,
	AIExecutionResult,
	AICostSummary,
} from "#/ai-config.js";
import type { StepResult } from "#/recipe-engine/types";

const debug = createDebug("hypergen:ai:service");

/**
 * Options for a single AI generation call
 */
export interface GenerateOptions {
	/** The prompt text (already Liquid-rendered) */
	prompt: string;
	/** System prompt override */
	system?: string;
	/** Model override */
	model?: string;
	/** Provider override */
	provider?: string;
	/** Temperature (0-2) */
	temperature?: number;
	/** Max output tokens */
	maxTokens?: number;
	/** Stream to terminal */
	stream?: boolean;
	/** Context configuration */
	context?: PromptPipelineOptions["context"];
	/** Few-shot examples */
	examples?: PromptPipelineOptions["examples"];
	/** Guardrails */
	guardrails?: AIGuardrailConfig;
	/** Project root */
	projectRoot: string;
	/** Previous step results */
	stepResults?: Map<string, StepResult>;
	/** Step name for cost tracking */
	stepName?: string;
}

export class AiService {
	private static instance: AiService | null = null;

	private readonly modelRouter: ModelRouter;
	private readonly costTracker: CostTracker;
	private readonly promptPipeline: PromptPipeline;

	private constructor(private readonly config: AiServiceConfig) {
		this.modelRouter = new ModelRouter(config);
		this.costTracker = new CostTracker(config.budget, config.costTable);
		this.promptPipeline = new PromptPipeline();
		debug("AiService initialized");
	}

	static getInstance(config?: AiServiceConfig): AiService {
		if (!AiService.instance) {
			if (!config) {
				throw ErrorHandler.createError(
					ErrorCode.AI_PROVIDER_UNAVAILABLE,
					"AiService not initialized. Provide AiServiceConfig on first call.",
					{},
				);
			}
			AiService.instance = new AiService(config);
		}
		return AiService.instance;
	}

	static reset(): void {
		AiService.instance = null;
	}

	/**
	 * Generate text using AI with full pipeline: prompt assembly, model routing,
	 * validation, retry-with-feedback, and cost tracking.
	 */
	async generate(options: GenerateOptions): Promise<AIExecutionResult> {
		const startTime = Date.now();
		const stepName = options.stepName || "unnamed";

		// Check budget before starting
		this.costTracker.checkBudget();

		// Resolve model
		const resolved = await this.modelRouter.resolve(options.provider, options.model);

		// Merge guardrails: config defaults + step overrides
		const guardrails: AIGuardrailConfig = {
			...this.config.defaultGuardrails,
			...options.guardrails,
		};

		// Assemble prompt
		const assembled = await this.promptPipeline.assemble({
			globalSystemPrompt: this.config.systemPrompt,
			stepSystemPrompt: options.system,
			guardrails,
			prompt: options.prompt,
			context: options.context,
			examples: options.examples,
			projectRoot: options.projectRoot,
			stepResults: options.stepResults || new Map(),
			maxOutputTokens: options.maxTokens,
		});

		// Retry loop
		const maxRetries = guardrails.retryOnFailure ?? 0;
		let lastOutput = "";
		let lastValidation = { passed: true, errors: [] as string[] };
		let retryAttempts = 0;
		let totalInputTokens = 0;
		let totalOutputTokens = 0;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			let userPrompt = assembled.user;

			// On retry, append feedback
			if (attempt > 0 && !lastValidation.passed) {
				const feedback = buildValidationFeedback(lastValidation as any);
				if (guardrails.onFailure === "retry-with-feedback") {
					userPrompt = `${assembled.user}\n\n## Correction Required\n\n${feedback}\n\n## Previous (Incorrect) Output\n\n\`\`\`\n${lastOutput}\n\`\`\``;
				}
				debug(
					"Retry attempt %d with%s feedback",
					attempt,
					guardrails.onFailure === "retry-with-feedback" ? "" : "out",
				);
			}

			try {
				// Call Vercel AI SDK
				const { generateText } = await import("ai");

				const result = await generateText({
					model: resolved.model,
					system: assembled.system || undefined,
					prompt: userPrompt,
					temperature: options.temperature ?? this.config.temperature ?? 0.2,
					maxTokens: options.maxTokens ?? this.config.maxTokens,
				});

				lastOutput = result.text;
				const inputTokens = result.usage?.promptTokens ?? 0;
				const outputTokens = result.usage?.completionTokens ?? 0;
				totalInputTokens += inputTokens;
				totalOutputTokens += outputTokens;

				debug("AI response: %d input tokens, %d output tokens", inputTokens, outputTokens);

				// Validate output
				const validation = await validateOutput(lastOutput, guardrails, options.projectRoot);
				lastValidation = validation;

				if (validation.passed) {
					// Record cost
					this.costTracker.record(
						stepName,
						resolved.modelName,
						totalInputTokens,
						totalOutputTokens,
						retryAttempts,
					);

					const costUsd = this.costTracker.calculateCost(
						resolved.modelName,
						totalInputTokens,
						totalOutputTokens,
					);

					return {
						output: lastOutput,
						usage: {
							inputTokens: totalInputTokens,
							outputTokens: totalOutputTokens,
							totalTokens: totalInputTokens + totalOutputTokens,
						},
						costUsd,
						model: resolved.modelName,
						provider: resolved.provider,
						retryAttempts,
						validation: { passed: true, errors: [] },
						durationMs: Date.now() - startTime,
					};
				}

				retryAttempts++;
				debug(
					"Validation failed (attempt %d/%d): %s",
					attempt + 1,
					maxRetries + 1,
					validation.errors.join("; "),
				);

				// If we've exhausted retries, handle failure
				if (attempt === maxRetries) {
					// Check if fallback is configured
					if (guardrails.onFailure === "fallback" && guardrails.fallback) {
						debug("Using fallback output");
						this.costTracker.record(
							stepName,
							resolved.modelName,
							totalInputTokens,
							totalOutputTokens,
							retryAttempts,
						);

						return {
							output: guardrails.fallback,
							usage: {
								inputTokens: totalInputTokens,
								outputTokens: totalOutputTokens,
								totalTokens: totalInputTokens + totalOutputTokens,
							},
							costUsd: this.costTracker.calculateCost(
								resolved.modelName,
								totalInputTokens,
								totalOutputTokens,
							),
							model: resolved.modelName,
							provider: resolved.provider,
							retryAttempts,
							validation: { passed: false, errors: validation.errors },
							durationMs: Date.now() - startTime,
						};
					}

					// Record cost even on failure
					this.costTracker.record(
						stepName,
						resolved.modelName,
						totalInputTokens,
						totalOutputTokens,
						retryAttempts,
					);

					throw ErrorHandler.createError(
						ErrorCode.AI_GENERATION_FAILED,
						`AI output failed validation after ${maxRetries + 1} attempts: ${validation.errors.join("; ")}`,
						{},
					);
				}
			} catch (error: any) {
				// Handle API-level errors
				if (
					error.code === ErrorCode.AI_GENERATION_FAILED ||
					(error instanceof Error && error.name === "HypergenError")
				) {
					throw error;
				}

				// Rate limiting
				if (error.status === 429 || error.statusCode === 429) {
					const retryAfter = error.headers?.["retry-after"]
						? parseInt(error.headers["retry-after"]) * 1000
						: 5000;
					debug("Rate limited, waiting %dms", retryAfter);
					await sleep(retryAfter);
					retryAttempts++;
					continue;
				}

				// Network/API errors on last attempt
				if (attempt === maxRetries) {
					throw ErrorHandler.createError(
						ErrorCode.AI_GENERATION_FAILED,
						`AI generation failed: ${error.message}`,
						{},
					);
				}

				// Retry with backoff
				const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
				debug("API error, retrying in %dms: %s", backoff, error.message);
				await sleep(backoff);
				retryAttempts++;
			}
		}

		// Should not reach here, but safety net
		throw ErrorHandler.createError(
			ErrorCode.AI_GENERATION_FAILED,
			"AI generation failed unexpectedly",
			{},
		);
	}

	/**
	 * Get cost summary for the current execution
	 */
	getCostSummary(): AICostSummary {
		return this.costTracker.getSummary();
	}

	/**
	 * Get formatted cost report
	 */
	getCostReport(): string {
		return this.costTracker.formatReport();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
