/**
 * EnsureDirs Tool Implementation for Recipe Step System
 *
 * Creates directories (mkdir -p equivalent) for each path in an array.
 * Paths are relative to the project root.
 */

import fs from "node:fs";
import path from "node:path";
import createDebug from "debug";
import { Tool, type ToolValidationResult } from "./base.js";
import type {
	EnsureDirsStep,
	EnsureDirsExecutionResult,
	StepContext,
	StepResult,
	StepExecutionOptions,
} from "#/recipe-engine/types";

const debug = createDebug("hypergen:v8:recipe:tool:ensure-dirs");

export class EnsureDirsTool extends Tool<EnsureDirsStep> {
	constructor(
		name: string = "ensure-dirs-tool",
		options: Record<string, any> = {},
	) {
		super("ensure-dirs", name, options);
	}

	protected async onValidate(
		step: EnsureDirsStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		if (!step.paths || !Array.isArray(step.paths) || step.paths.length === 0) {
			errors.push("At least one directory path is required");
		}

		if (step.paths) {
			for (let i = 0; i < step.paths.length; i++) {
				const p = step.paths[i];
				if (typeof p !== "string" || p.trim() === "") {
					errors.push(`Path at index ${i} must be a non-empty string`);
				}
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: 50,
			resourceRequirements: {
				memory: 1 * 1024 * 1024,
				disk: 4096,
				network: false,
				processes: 0,
			},
		};
	}

	protected async onExecute(
		step: EnsureDirsStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Ensuring directories: %o", step.paths);

		try {
			const created: string[] = [];
			const alreadyExisted: string[] = [];

			for (const dirPath of step.paths) {
				// Resolve variables in path
				const resolved = this.resolveVariables(dirPath, context.variables);
				const fullPath = path.resolve(context.projectRoot, resolved);

				if (fs.existsSync(fullPath)) {
					alreadyExisted.push(resolved);
					this.debug("Directory already exists: %s", resolved);
				} else {
					if (!(options?.dryRun || context.dryRun)) {
						fs.mkdirSync(fullPath, { recursive: true });
					}
					created.push(resolved);
					this.debug("Created directory: %s", resolved);
				}
			}

			const endTime = new Date();
			const result: EnsureDirsExecutionResult = {
				paths: step.paths,
				created,
				alreadyExisted,
			};

			return {
				status: "completed",
				stepName: step.name,
				toolType: "ensure-dirs",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: result,
				output: { created, alreadyExisted },
			};
		} catch (error: any) {
			const endTime = new Date();
			return {
				status: "failed",
				stepName: step.name,
				toolType: "ensure-dirs",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: "ENSURE_DIRS_FAILED",
					cause: error,
				},
			};
		}
	}

	private resolveVariables(
		template: string,
		variables: Record<string, any>,
	): string {
		return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
			const value = key
				.trim()
				.split(".")
				.reduce((obj: any, k: string) => obj?.[k], variables);
			return value !== undefined ? String(value) : `{{${key}}}`;
		});
	}
}

export class EnsureDirsToolFactory {
	create(
		name: string = "ensure-dirs-tool",
		options: Record<string, any> = {},
	): EnsureDirsTool {
		return new EnsureDirsTool(name, options);
	}

	getToolType(): "ensure-dirs" {
		return "ensure-dirs";
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

export const ensureDirsToolFactory = new EnsureDirsToolFactory();
