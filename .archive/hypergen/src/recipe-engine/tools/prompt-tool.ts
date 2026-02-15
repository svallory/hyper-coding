/**
 * Prompt Tool Implementation for Recipe Step System
 *
 * This tool enables interactive user prompts within recipe execution steps.
 * It integrates with the interactive prompt system to collect user input
 * and store it in execution context variables.
 */

import createDebug from "debug";
import { Tool, type ToolValidationResult } from "#/base.js";
import { performInteractivePrompting } from "#/prompts/interactive-prompts";
import type {
	PromptExecutionResult,
	PromptStep,
	StepContext,
	StepExecutionOptions,
	StepResult,
} from "#/recipe-engine/types";

const debug = createDebug("hypergen:v8:recipe:tool:prompt");

export class PromptTool extends Tool<PromptStep> {
	constructor(name = "prompt-tool", options: Record<string, any> = {}) {
		super("prompt", name, options);
	}

	protected async onValidate(
		step: PromptStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];

		if (!step.variable) {
			errors.push("Target variable name is required");
		}

		if (step.promptType === "select" || step.promptType === "multiselect") {
			if (!step.options || (Array.isArray(step.options) && step.options.length === 0)) {
				errors.push(`Options are required for ${step.promptType} prompt`);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings: [],
			suggestions: [],
			estimatedExecutionTime: 0, // Interactive time depends on user
			resourceRequirements: {
				memory: 0,
				disk: 0,
				network: false,
				processes: 0,
			},
		};
	}

	protected async onExecute(
		step: PromptStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Executing prompt step: %s (variable: %s)", step.name, step.variable);

		try {
			// In non-interactive mode or dry-run, use default value if available
			if (options?.dryRun || process.env.CI || process.env.INTERACTIVE === "false") {
				const value = step.default;
				this.debug("Using default value in non-interactive/dry-run mode: %o", value);

				// Update context variables
				context.variables[step.variable] = value;

				return this.createResult(step, value, startTime, "completed");
			}

			// Convert step configuration to prompt configuration
			const promptConfig = {
				type: this.mapPromptType(step.promptType),
				name: step.variable,
				message: step.message || `Enter value for ${step.variable}`,
				default: step.default,
				choices: this.mapOptions(step.options),
				validate: this.createValidator(step.validate),
			};

			// Execute prompt
			// Logger in context is ActionLogger which has info/warn/error but not log
			// We can adapt it or just pass undefined if logger shape doesn't match
			const loggerAdapter = context.logger
				? { log: (msg: string) => context.logger?.info(msg) }
				: undefined;
			const result = await performInteractivePrompting([promptConfig], loggerAdapter);
			const value = result[step.variable];

			this.debug("Prompt completed, value: %o", value);

			// Update context variables
			context.variables[step.variable] = value;

			return this.createResult(step, value, startTime, "completed");
		} catch (error: any) {
			const endTime = new Date();
			return {
				status: "failed",
				stepName: step.name,
				toolType: "prompt",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: "PROMPT_EXECUTION_ERROR",
					cause: error,
				},
			};
		}
	}

	private createResult(
		step: PromptStep,
		value: any,
		startTime: Date,
		status: "completed" | "skipped",
	): StepResult {
		const endTime = new Date();
		return {
			status,
			stepName: step.name,
			toolType: "prompt",
			startTime,
			endTime,
			duration: endTime.getTime() - startTime.getTime(),
			retryCount: 0,
			dependenciesSatisfied: true,
			toolResult: {
				variable: step.variable,
				value,
			} as PromptExecutionResult,
			output: {
				variable: step.variable,
				value,
			},
		};
	}

	private mapPromptType(type: string): string {
		switch (type) {
			case "select":
				return "list";
			case "multiselect":
				return "multiselect"; // assuming supported by prompt tool, otherwise list
			case "confirm":
				return "confirm";
			default:
				return "input";
		}
	}

	private mapOptions(options?: Array<{ label: string; value: any }> | string[]): any[] | undefined {
		if (!options) return undefined;
		if (Array.isArray(options) && typeof options[0] === "string") {
			return options;
		}
		// Extract values if objects
		return (options as Array<{ label: string; value: any }>).map((o) => o.value);
	}

	private createValidator(validate?: string): ((input: any) => boolean | string) | undefined {
		if (!validate) return undefined;

		// Support regex pattern validation
		if (validate.startsWith("/") && validate.endsWith("/")) {
			const pattern = validate.slice(1, -1);
			const regex = new RegExp(pattern);
			return (input: any) => regex.test(String(input)) || "Invalid format";
		}

		return undefined;
	}
}

export class PromptToolFactory {
	create(name = "prompt-tool", options: Record<string, any> = {}): PromptTool {
		return new PromptTool(name, options);
	}

	getToolType(): "prompt" {
		return "prompt";
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

export const promptToolFactory = new PromptToolFactory();
