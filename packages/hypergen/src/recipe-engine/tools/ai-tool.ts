/**
 * AI Tool Implementation for Recipe Step System
 *
 * Executes AI generation steps within recipes.
 * Uses the central AiService for prompt assembly, model routing,
 * output validation, retry-with-feedback, and cost tracking.
 */

import createDebug from "debug";
import fs from "fs";
import path from "path";
import { Tool, type ToolValidationResult } from "#/base.js";
import { ErrorHandler, ErrorCode } from "#/errors/hypergen-errors";
import type { StepContext, StepResult, StepExecutionOptions, AIStep } from "#/recipe-engine/types";
import { AiService } from "#/ai/ai-service";
import type { AIExecutionResult } from "#/ai/ai-config";

const debug = createDebug("hypergen:v8:recipe:tool:ai");

export class AiTool extends Tool<AIStep> {
	constructor(name: string = "ai-tool", options: Record<string, any> = {}) {
		super("ai", name, options);
	}

	protected async onValidate(step: AIStep, context: StepContext): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Prompt is required
		if (!step.prompt || step.prompt.trim().length === 0) {
			errors.push('AI step requires a non-empty "prompt" field');
		}

		// Output configuration is required
		if (!step.output) {
			errors.push('AI step requires an "output" configuration');
		} else {
			const validTypes = ["variable", "file", "inject", "stdout"];
			if (!validTypes.includes(step.output.type)) {
				errors.push(
					`Invalid output type "${step.output.type}". Must be one of: ${validTypes.join(", ")}`,
				);
			}

			if (step.output.type === "variable" && !step.output.variable) {
				errors.push('Output type "variable" requires a "variable" name');
			}

			if (step.output.type === "file" && !step.output.to) {
				errors.push('Output type "file" requires a "to" path');
			}

			if (step.output.type === "inject" && !step.output.injectInto) {
				errors.push('Output type "inject" requires an "injectInto" path');
			}
		}

		// Temperature range
		if (step.temperature !== undefined && (step.temperature < 0 || step.temperature > 2)) {
			errors.push("Temperature must be between 0 and 2");
		}

		// Max tokens
		if (step.maxTokens !== undefined && step.maxTokens <= 0) {
			errors.push("maxTokens must be a positive number");
		}

		// Check for API key availability (warn, don't error — might be set at runtime)
		// This is intentionally a warning, not an error, since env vars might be set later
		const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
		if (!hasApiKey) {
			warnings.push(
				"No AI provider API key found in environment. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.",
			);
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: 5000,
			resourceRequirements: {
				memory: 50 * 1024 * 1024,
				disk: 0,
				network: true,
				processes: 0,
			},
		};
	}

	protected async onExecute(
		step: AIStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Executing AI step: %s", step.name);

		try {
			// Get AiService instance (initialized by recipe engine with config)
			const aiService = AiService.getInstance();

			// Render Liquid variables in prompt
			const prompt = this.resolveVariables(step.prompt, context.variables);

			// Generate
			const result = await aiService.generate({
				prompt,
				system: step.system ? this.resolveVariables(step.system, context.variables) : undefined,
				model: step.model,
				provider: step.provider,
				temperature: step.temperature,
				maxTokens: step.maxTokens,
				stream: step.stream,
				context: step.context,
				examples: step.examples,
				guardrails: step.guardrails,
				projectRoot: context.projectRoot,
				stepResults: context.stepResults,
				stepName: step.name,
			});

			// Handle output
			await this.handleOutput(step, context, result);

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "completed",
				stepName: step.name,
				toolType: "ai",
				startTime,
				endTime,
				duration,
				retryCount: result.retryAttempts,
				dependenciesSatisfied: true,
				toolResult: result,
				filesCreated: step.output.type === "file" && step.output.to ? [step.output.to] : undefined,
				filesModified:
					step.output.type === "inject" && step.output.injectInto
						? [step.output.injectInto]
						: undefined,
				output: {
					text: result.output,
					tokens: result.usage.totalTokens,
					cost: result.costUsd,
				},
			};
		} catch (error: any) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "failed",
				stepName: step.name,
				toolType: "ai",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: error.code || "AI_EXECUTION_ERROR",
					cause: error,
				},
			};
		}
	}

	/**
	 * Handle output based on the output configuration
	 */
	private async handleOutput(
		step: AIStep,
		context: StepContext,
		result: AIExecutionResult,
	): Promise<void> {
		const output = result.output;

		switch (step.output.type) {
			case "variable": {
				// Store in step data / recipe variables
				const varName = step.output.variable!;
				context.variables[varName] = output;
				context.stepData[`ai_output_${step.name}`] = output;
				debug('Stored AI output in variable "%s"', varName);
				break;
			}

			case "file": {
				const filePath = this.resolveVariables(step.output.to!, context.variables);
				const resolved = path.resolve(context.projectRoot, filePath);
				const dir = path.dirname(resolved);
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
				}
				fs.writeFileSync(resolved, output, "utf-8");
				debug("Wrote AI output to file: %s", resolved);
				break;
			}

			case "inject": {
				const filePath = this.resolveVariables(step.output.injectInto!, context.variables);
				const resolved = path.resolve(context.projectRoot, filePath);
				if (!fs.existsSync(resolved)) {
					throw ErrorHandler.createError(
						ErrorCode.FILE_NOT_FOUND,
						`Cannot inject into non-existent file: ${resolved}`,
						{ file: resolved },
					);
				}

				let content = fs.readFileSync(resolved, "utf-8");

				if (step.output.after) {
					const pattern = step.output.after;
					const idx = content.indexOf(pattern);
					if (idx !== -1) {
						const insertAt = idx + pattern.length;
						content = content.slice(0, insertAt) + "\n" + output + content.slice(insertAt);
					}
				} else if (step.output.before) {
					const pattern = step.output.before;
					const idx = content.indexOf(pattern);
					if (idx !== -1) {
						content = content.slice(0, idx) + output + "\n" + content.slice(idx);
					}
				} else if (step.output.at === "start") {
					content = output + "\n" + content;
				} else {
					// Default: append to end
					content = content + "\n" + output;
				}

				fs.writeFileSync(resolved, content, "utf-8");
				debug("Injected AI output into file: %s", resolved);
				break;
			}

			case "stdout": {
				process.stdout.write(output);
				debug("Wrote AI output to stdout");
				break;
			}
		}
	}

	private resolveVariables(template: string, variables: Record<string, any>): string {
		return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
			const trimmed = key.trim();
			const value = trimmed.split(".").reduce((obj: any, k: string) => obj?.[k], variables);
			return value !== undefined ? String(value) : `{{${trimmed}}}`;
		});
	}
}

export class AiToolFactory {
	create(name: string = "ai-tool", options: Record<string, any> = {}): AiTool {
		return new AiTool(name, options);
	}

	getToolType(): "ai" {
		return "ai";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}
}

export const aiToolFactory = new AiToolFactory();
