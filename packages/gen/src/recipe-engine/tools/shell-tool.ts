/**
 * Shell Tool Implementation for Recipe Step System
 *
 * This tool executes shell commands as part of the recipe execution pipeline.
 * It integrates with the existing shell operations in src/ops/shell.ts.
 */

import createDebug from "debug";
import { Tool, type ToolValidationResult } from "./base.js";
import { ErrorHandler, ErrorCode } from "@hypercli/core";
import {
	type StepContext,
	type StepResult,
	type StepExecutionOptions,
	type BaseRecipeStep,
	type ShellStep,
} from "#/recipe-engine/types";
import { renderTemplate } from "#/template-engines/jig-engine";

const debug = createDebug("hypergen:v8:recipe:tool:shell");

export class ShellTool extends Tool<ShellStep> {
	constructor(name: string = "shell-tool", options: Record<string, any> = {}) {
		super("shell", name, options);
	}

	protected async onValidate(step: ShellStep, context: StepContext): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		if (!step.command) {
			errors.push("Shell command is required");
		}

		if (step.cwd && typeof step.cwd !== "string") {
			errors.push("Working directory (cwd) must be a string");
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: 1000,
			resourceRequirements: {
				memory: 10 * 1024 * 1024,
				disk: 0,
				network: true, // Optimistically assume network might be used
				processes: 1,
			},
		};
	}

	protected async onExecute(
		step: ShellStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Executing shell command: %s", step.command);

		try {
			// Render command through Jig to support @if/@elseif/@end tags and {{ variable }} interpolation
			const renderContext = this.buildRenderContext(step, context);
			const command = await renderTemplate(step.command, renderContext);
			const cwd = step.cwd ? await renderTemplate(step.cwd, renderContext) : context.projectRoot;

			// shell() returns a Promise<ActionResult> (which is { status: string })
			// but also executes the command. The current shell op implementation seems to be
			// specific to the legacy action system. We might need to adapt it or use simple exec.
			// However, for now let's use it as requested.

			// NOTE: The current ops/shell.ts implementation is tied to legacy ops.
			// It returns a function runner format. Since we want standard behavior, we might
			// rely on node's child_process directly if ops/shell is too specific, but let's try to reuse.

			// Wait, looking at ops/shell.ts, it uses `exec` from context.
			// We need to provide that context.

			// For now, let's implement a direct execution to be safe and avoid legacy baggage,
			// enabling full control over the step result.

			const { exec } = await import("child_process");
			const { promisify } = await import("util");
			const execAsync = promisify(exec);

			// Strip CLAUDECODE env var to prevent "nested session" errors when
			// running inside Claude Code (the env var makes child processes think
			// they're inside a Claude session and refuse to run).
			const { CLAUDECODE, ...cleanEnv } = process.env;
			const { stdout, stderr } = await execAsync(command, {
				cwd,
				env: { ...cleanEnv, ...step.env },
			});

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "completed",
				stepName: step.name,
				toolType: "shell",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: {
					exitCode: 0,
					stdout: stdout.toString(),
					stderr: stderr.toString(),
				},
				output: {
					stdout: stdout.toString(),
				},
			};
		} catch (error: any) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "failed",
				stepName: step.name,
				toolType: "shell",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: "SHELL_EXECUTION_ERROR",
					cause: error,
				},
			};
		}
	}

	/**
	 * Build render context by merging step and recipe variables.
	 * This matches the pattern used in template-tool.ts for consistency.
	 */
	private buildRenderContext(step: ShellStep, context: StepContext): Record<string, any> {
		// Merge variables: recipe vars < context vars < step vars
		const mergedVars = {
			...context.recipeVariables,
			...context.variables,
			...step.variables,
		};

		return {
			...mergedVars,
			// Recipe-specific context
			recipe: context.recipe,
			step: { name: step.name, description: step.description },
			// Utility functions
			utils: context.utils,
			// Step results for dependency access
			stepResults: context.stepResults ? Object.fromEntries(context.stepResults) : {},
		};
	}
}

export class ShellToolFactory {
	create(name: string = "shell-tool", options: Record<string, any> = {}): ShellTool {
		return new ShellTool(name, options);
	}

	getToolType(): "shell" {
		return "shell";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		// Shell tool setup config is usually empty, but we can validate options if any
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}
}

export const shellToolFactory = new ShellToolFactory();
