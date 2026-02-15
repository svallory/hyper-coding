/**
 * Prompt Pipeline
 *
 * 5-stage pipeline that transforms user prompts into fully assembled
 * AI requests ready for the Vercel AI SDK.
 *
 * Stages:
 * 1. Liquid rendering — resolve {{ variables }} in prompt text
 * 2. Context collection — read files, configs, step results
 * 3. Token budgeting — estimate, truncate if needed
 * 4. Prompt assembly — system + context + examples + user prompt
 * 5. Pre-flight check — fits context window? budget allows?
 */

import createDebug from "debug";
import type { StepResult } from "#/recipe-engine/types";
import type { AIContextConfig, AIExample, AIGuardrailConfig } from "./ai-config.js";
import { type ContextBundle, ContextCollector } from "./context-collector.js";

const debug = createDebug("hypergen:ai:prompt-pipeline");

/**
 * Assembled prompt ready for the AI SDK
 */
export interface AssembledPrompt {
	/** System message */
	system: string;
	/** User message (context + examples + task prompt) */
	user: string;
	/** Estimated total token count */
	estimatedTokens: number;
	/** Context bundle used */
	contextBundle: ContextBundle;
}

/**
 * Options for the prompt pipeline
 */
export interface PromptPipelineOptions {
	/** Global system prompt from config */
	globalSystemPrompt?: string;
	/** Step-level system prompt override */
	stepSystemPrompt?: string;
	/** Guardrail rules to inject into system prompt */
	guardrails?: AIGuardrailConfig;
	/** User prompt text (already Liquid-rendered) */
	prompt: string;
	/** Context configuration */
	context?: AIContextConfig;
	/** Few-shot examples */
	examples?: AIExample[];
	/** Project root for file resolution */
	projectRoot: string;
	/** Results from previous steps */
	stepResults: Map<string, StepResult>;
	/** Max output tokens (reserved from context window) */
	maxOutputTokens?: number;
}

export class PromptPipeline {
	private readonly contextCollector = new ContextCollector();

	/**
	 * Execute the full 5-stage pipeline
	 */
	async assemble(options: PromptPipelineOptions): Promise<AssembledPrompt> {
		debug("Starting prompt pipeline");

		// Stage 1: Template rendering is done before this pipeline is called
		// (by the AiTool or @ai template tags, which have access to the Jig engine)

		// Stage 2: Context collection
		const contextBundle = await this.contextCollector.collect(
			options.context,
			options.projectRoot,
			options.stepResults,
		);

		// Stage 3: Token budgeting (already handled by ContextCollector's maxContextTokens)
		// We just track the total here

		// Stage 4: Prompt assembly
		const system = this.assembleSystemPrompt(options);
		const user = this.assembleUserPrompt(options, contextBundle);

		const estimatedTokens = Math.ceil(system.length / 4) + Math.ceil(user.length / 4);
		debug(
			"Prompt assembled: system=%d chars, user=%d chars, ~%d tokens",
			system.length,
			user.length,
			estimatedTokens,
		);

		// Stage 5: Pre-flight check
		// Context window limits are model-specific; we log a warning if suspiciously large
		if (estimatedTokens > 100_000) {
			debug("Warning: estimated prompt size (%d tokens) is very large", estimatedTokens);
		}

		return { system, user, estimatedTokens, contextBundle };
	}

	private assembleSystemPrompt(options: PromptPipelineOptions): string {
		const parts: string[] = [];

		// Global system prompt
		if (options.globalSystemPrompt) {
			parts.push(options.globalSystemPrompt);
		}

		// Step-level system prompt (overrides or appends)
		if (options.stepSystemPrompt) {
			parts.push(options.stepSystemPrompt);
		}

		// Guardrail instructions
		if (options.guardrails) {
			const rules = this.buildGuardrailInstructions(options.guardrails);
			if (rules) {
				parts.push(rules);
			}
		}

		return parts.join("\n\n");
	}

	private assembleUserPrompt(options: PromptPipelineOptions, context: ContextBundle): string {
		const parts: string[] = [];

		// Context section
		if (context.configs.size > 0 || context.files.size > 0 || context.stepOutputs.size > 0) {
			parts.push("## Context\n");

			for (const [name, content] of context.configs) {
				parts.push(`### ${name}\n\`\`\`json\n${content}\n\`\`\`\n`);
			}

			for (const [name, content] of context.stepOutputs) {
				parts.push(`### Output from step "${name}"\n\`\`\`\n${content}\n\`\`\`\n`);
			}

			for (const [filePath, content] of context.files) {
				const ext = filePath.split(".").pop() || "";
				parts.push(`### ${filePath}\n\`\`\`${ext}\n${content}\n\`\`\`\n`);
			}

			if (context.truncated) {
				parts.push("> Note: Some context was truncated to fit token budget.\n");
			}
		}

		// Examples section
		if (options.examples && options.examples.length > 0) {
			parts.push("## Examples\n");
			for (const example of options.examples) {
				if (example.label) {
					parts.push(`### ${example.label}`);
				}
				parts.push(`**Input:**\n${example.input}\n`);
				parts.push(`**Output:**\n${example.output}\n`);
			}
		}

		// Task prompt
		parts.push("## Task\n");
		parts.push(options.prompt);

		return parts.join("\n");
	}

	private buildGuardrailInstructions(guardrails: AIGuardrailConfig): string | null {
		const rules: string[] = [];

		if (guardrails.validateSyntax) {
			const lang =
				guardrails.validateSyntax === true ? "the target language" : guardrails.validateSyntax;
			rules.push(`- Output MUST be valid ${lang} syntax.`);
		}

		if (guardrails.allowedImports && guardrails.allowedImports.length > 0) {
			rules.push(
				`- Only use imports from these packages: ${guardrails.allowedImports.join(", ")}.`,
			);
		}

		if (guardrails.blockedImports && guardrails.blockedImports.length > 0) {
			rules.push(`- Do NOT import from: ${guardrails.blockedImports.join(", ")}.`);
		}

		if (guardrails.requireKnownImports) {
			rules.push("- Only import packages that exist in the project's package.json.");
		}

		if (guardrails.maxOutputLength) {
			rules.push(`- Output must be at most ${guardrails.maxOutputLength} characters.`);
		}

		if (rules.length === 0) return null;

		return `## Rules\n\n${rules.join("\n")}`;
	}
}
