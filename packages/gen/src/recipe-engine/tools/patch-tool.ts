/**
 * Patch Tool Implementation for Recipe Step System
 *
 * Deep-merges structured data into existing files (JSON, YAML, TOML).
 * Creates the file if it doesn't exist (configurable).
 */

import fs from "node:fs";
import path from "node:path";
import type {
	PatchExecutionResult,
	PatchStep,
	StepContext,
	StepExecutionOptions,
	StepResult,
} from "#recipe-engine/types";
import { Tool, type ToolValidationResult } from "./base.js";

/**
 * Auto-detect file format from extension
 */
function detectFormat(filePath: string): PatchStep["format"] {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".json":
			return "json";
		case ".yml":
		case ".yaml":
			return "yaml";
		case ".toml":
			return "toml";
		default:
			return undefined;
	}
}

/**
 * Deep merge source into target, mutating target.
 * Arrays are replaced, not concatenated.
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = target[key];
		if (
			srcVal !== null &&
			typeof srcVal === "object" &&
			!Array.isArray(srcVal) &&
			tgtVal !== null &&
			typeof tgtVal === "object" &&
			!Array.isArray(tgtVal)
		) {
			target[key] = deepMerge(tgtVal, srcVal);
		} else {
			target[key] = srcVal;
		}
	}
	return target;
}

/**
 * Parse file content based on format
 */
async function parseFile(content: string, format: string): Promise<Record<string, any>> {
	switch (format) {
		case "json":
			return JSON.parse(content);
		case "yaml": {
			const { parse } = await import("yaml");
			return parse(content) ?? {};
		}
		case "toml": {
			try {
				// @ts-ignore -- optional dependency, only needed for TOML files
				const { parse } = await import("smol-toml");
				return parse(content) as Record<string, any>;
			} catch {
				throw new Error(
					'TOML parsing requires the "smol-toml" package. Install it with: bun add smol-toml',
				);
			}
		}
		default:
			throw new Error(`Unsupported format: ${format}`);
	}
}

/**
 * Serialize data to string based on format
 */
async function serializeFile(
	data: Record<string, any>,
	format: string,
	indent: number,
): Promise<string> {
	switch (format) {
		case "json":
			return `${JSON.stringify(data, null, indent)}\n`;
		case "yaml": {
			const { stringify } = await import("yaml");
			return stringify(data, { indent });
		}
		case "toml": {
			try {
				// @ts-ignore -- optional dependency, only needed for TOML files
				const { stringify } = await import("smol-toml");
				return `${stringify(data)}\n`;
			} catch {
				throw new Error(
					'TOML serialization requires the "smol-toml" package. Install it with: bun add smol-toml',
				);
			}
		}
		default:
			throw new Error(`Unsupported format: ${format}`);
	}
}

export class PatchTool extends Tool<PatchStep> {
	constructor(name = "patch-tool", options: Record<string, any> = {}) {
		super("patch", name, options);
	}

	protected async onValidate(step: PatchStep, context: StepContext): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		if (!step.file) {
			errors.push("File path is required");
		}

		if (!step.merge || typeof step.merge !== "object" || Array.isArray(step.merge)) {
			errors.push('"merge" must be a non-null object');
		}

		const format = step.format || (step.file ? detectFormat(step.file) : undefined);
		if (step.file && !format) {
			errors.push(`Cannot detect format for "${step.file}". Specify "format" explicitly.`);
		}

		if (format && !["json", "yaml", "toml"].includes(format)) {
			errors.push(`Unsupported format: ${format}. Must be one of: json, yaml, toml`);
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: 200,
			resourceRequirements: {
				memory: 5 * 1024 * 1024,
				disk: 1024,
				network: false,
				processes: 0,
			},
		};
	}

	protected async onExecute(
		step: PatchStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Patching file: %s", step.file);

		try {
			const filePath = path.resolve(context.projectRoot, step.file);
			const format = step.format || detectFormat(step.file);
			const indent = step.indent ?? 2;
			const createIfMissing = step.createIfMissing ?? true;

			if (!format) {
				throw new Error(`Cannot detect format for "${step.file}". Specify "format" explicitly.`);
			}

			let existing: Record<string, any> = {};
			let created = false;

			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, "utf-8");
				existing = await parseFile(content, format);
			} else if (createIfMissing) {
				created = true;
				// Ensure parent directory exists
				const dir = path.dirname(filePath);
				fs.mkdirSync(dir, { recursive: true });
			} else {
				throw new Error(`File not found: ${step.file} (createIfMissing is false)`);
			}

			// Resolve variables in merge data
			const resolvedMerge = this.resolveVariablesInObject(step.merge, context.variables);

			// Deep merge
			const merged = deepMerge(existing, resolvedMerge);

			// Write back
			if (!(options?.dryRun || context.dryRun)) {
				const serialized = await serializeFile(merged, format, indent);
				fs.writeFileSync(filePath, serialized, "utf-8");
			}

			const endTime = new Date();
			const patchResult: PatchExecutionResult = {
				file: step.file,
				format,
				created,
				merged: resolvedMerge,
			};

			return {
				status: "completed",
				stepName: step.name,
				toolType: "patch",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: patchResult,
				filesModified: created ? undefined : [filePath],
				filesCreated: created ? [filePath] : undefined,
				output: { file: step.file, created, format },
			};
		} catch (error: any) {
			const endTime = new Date();
			return {
				status: "failed",
				stepName: step.name,
				toolType: "patch",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: "PATCH_FAILED",
					cause: error,
				},
			};
		}
	}

	private resolveVariablesInObject(obj: any, variables: Record<string, any>): any {
		if (typeof obj === "string") {
			return obj.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
				const trimmed = key.trim();
				const value = trimmed.split(".").reduce((o: any, k: string) => o?.[k], variables);
				return value !== undefined ? String(value) : `{{${trimmed}}}`;
			});
		}
		if (Array.isArray(obj)) {
			return obj.map((item) => this.resolveVariablesInObject(item, variables));
		}
		if (obj !== null && typeof obj === "object") {
			const result: Record<string, any> = {};
			for (const [key, val] of Object.entries(obj)) {
				result[key] = this.resolveVariablesInObject(val, variables);
			}
			return result;
		}
		return obj;
	}
}

export class PatchToolFactory {
	create(name = "patch-tool", options: Record<string, any> = {}): PatchTool {
		return new PatchTool(name, options);
	}

	getToolType(): "patch" {
		return "patch";
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

export const patchToolFactory = new PatchToolFactory();
