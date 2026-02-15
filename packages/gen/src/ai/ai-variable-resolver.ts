/**
 * AI Variable Resolver
 *
 * Resolves unresolved recipe variables by batching them into a single AI prompt.
 * Uses the existing AiService/transport infrastructure for the actual LLM call.
 */

import createDebug from "debug";
import { AiService } from "./ai-service.js";
import { ErrorHandler, ErrorCode } from "@hypercli/core";
import type { AiServiceConfig } from "./ai-config.js";
import type { TemplateVariable } from "@hypercli/core";

const debug = createDebug("hypergen:ai:variable-resolver");

/**
 * Describes a single unresolved variable to be sent to the AI.
 */
export interface UnresolvedVariable {
	name: string;
	config: TemplateVariable;
	/** The default value, passed as a suggestion when --no-defaults is active */
	defaultValue?: any;
}

/**
 * Metadata about the recipe being executed (gives the AI more context).
 */
export interface RecipeMetadata {
	name: string;
	description?: string;
}

/**
 * Batched AI variable resolution.
 *
 * Collects all unresolved variables, builds one prompt, calls the LLM,
 * parses the JSON response, and validates each value.
 */
export class AiVariableResolver {
	constructor(private readonly aiConfig: AiServiceConfig) {}

	/**
	 * Resolve a batch of variables via a single AI call.
	 *
	 * @returns Record mapping variable names to AI-resolved values.
	 *          Variables the AI could not resolve are omitted.
	 */
	async resolveBatch(
		unresolvedVars: UnresolvedVariable[],
		resolvedVars: Record<string, any>,
		recipeMeta: RecipeMetadata,
		projectContext?: string,
	): Promise<Record<string, any>> {
		if (unresolvedVars.length === 0) return {};

		debug(
			"Resolving %d variables via AI for recipe: %s",
			unresolvedVars.length,
			recipeMeta.name,
		);

		const prompt = this.buildPrompt(
			unresolvedVars,
			resolvedVars,
			recipeMeta,
			projectContext,
		);
		const systemPrompt = this.buildSystemPrompt(unresolvedVars);

		const aiService = AiService.getInstance(this.aiConfig);

		let result: { output: string };
		try {
			result = await aiService.generate({
				prompt,
				system: systemPrompt,
				temperature: this.aiConfig.temperature ?? 0.2,
				maxTokens: this.aiConfig.maxTokens,
				model: this.aiConfig.model,
				provider: this.aiConfig.provider,
				projectRoot: process.cwd(),
				stepName: "ai-variable-resolver",
			});
		} catch (error) {
			debug(
				"AI call failed: %s",
				error instanceof Error ? error.message : String(error),
			);
			// Return empty — caller decides what to do with still-unresolved vars
			return {};
		}

		return this.parseResponse(result.output, unresolvedVars);
	}

	/**
	 * Build the user prompt that describes what variables need values.
	 */
	buildPrompt(
		unresolvedVars: UnresolvedVariable[],
		resolvedVars: Record<string, any>,
		recipeMeta: RecipeMetadata,
		projectContext?: string,
	): string {
		const lines: string[] = [];

		lines.push(`# Variable Resolution Request`);
		lines.push("");
		lines.push(`**Recipe:** ${recipeMeta.name}`);
		if (recipeMeta.description) {
			lines.push(`**Description:** ${recipeMeta.description}`);
		}
		lines.push("");

		// Already-resolved variables as context
		const resolvedKeys = Object.keys(resolvedVars);
		if (resolvedKeys.length > 0) {
			lines.push("## Already Known Variables");
			lines.push("");
			for (const [name, value] of Object.entries(resolvedVars)) {
				lines.push(`- **${name}**: \`${JSON.stringify(value)}\``);
			}
			lines.push("");
		}

		// Project context
		if (projectContext) {
			lines.push("## Project Context");
			lines.push("");
			lines.push(projectContext);
			lines.push("");
		}

		// Variables that need resolution
		lines.push("## Variables to Resolve");
		lines.push("");
		lines.push(
			"For each variable below, determine the best value based on the recipe context, already-known variables, and any constraints.",
		);
		lines.push("");

		for (const { name, config, defaultValue } of unresolvedVars) {
			lines.push(`### \`${name}\``);
			lines.push(`- **Type:** ${config.type}`);
			if (config.required) lines.push(`- **Required:** yes`);
			if (config.description)
				lines.push(`- **Description:** ${config.description}`);
			if (config.suggestion !== undefined)
				lines.push(
					`- **Suggestion:** \`${JSON.stringify(config.suggestion)}\``,
				);
			if (defaultValue !== undefined)
				lines.push(
					`- **Default (skipped):** \`${JSON.stringify(defaultValue)}\``,
				);
			if (config.values)
				lines.push(
					`- **Allowed values:** ${config.values.map((v) => `\`${v}\``).join(", ")}`,
				);
			if (config.pattern) lines.push(`- **Pattern:** \`${config.pattern}\``);
			if (config.min !== undefined) lines.push(`- **Min:** ${config.min}`);
			if (config.max !== undefined) lines.push(`- **Max:** ${config.max}`);
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Build the system prompt instructing the AI to return JSON.
	 */
	buildSystemPrompt(unresolvedVars: UnresolvedVariable[]): string {
		const keys = unresolvedVars.map((v) => `"${v.name}"`).join(", ");

		return [
			"You are a code generation configuration assistant.",
			"You MUST respond with ONLY a valid JSON object — no markdown fences, no explanation, no text outside the JSON.",
			`The JSON object must have exactly these keys: ${keys}.`,
			"Each value must match the type and constraints described in the prompt.",
			"For string values, provide the string directly. For numbers, provide a number. For booleans, provide true/false.",
			"For enum values, pick from the allowed values list. For arrays, provide a JSON array. For objects, provide a JSON object.",
			"Use the suggestion or skipped default as a strong hint when available.",
		].join("\n");
	}

	/**
	 * Parse the AI's JSON response and coerce values to expected types.
	 */
	parseResponse(
		raw: string,
		unresolvedVars: UnresolvedVariable[],
	): Record<string, any> {
		let text = raw.trim();

		// Strip markdown code fences
		const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m);
		if (fenceMatch) {
			text = fenceMatch[1].trim();
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			debug("Failed to parse AI response as JSON: %s", text.slice(0, 200));
			return {};
		}

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			debug("AI response is not a JSON object");
			return {};
		}

		const result: Record<string, any> = {};

		for (const { name, config } of unresolvedVars) {
			if (!(name in parsed)) {
				debug("AI response missing key: %s", name);
				continue;
			}

			const value = parsed[name];
			const coerced = this.coerceValue(value, config);

			if (coerced !== undefined) {
				result[name] = coerced;
			} else {
				debug(
					"AI value for %s failed coercion (type: %s, got: %s)",
					name,
					config.type,
					typeof value,
				);
			}
		}

		debug(
			"Parsed %d/%d variables from AI response",
			Object.keys(result).length,
			unresolvedVars.length,
		);
		return result;
	}

	/**
	 * Coerce a raw AI value to the expected variable type.
	 * Returns undefined if coercion fails.
	 */
	private coerceValue(value: unknown, config: TemplateVariable): any {
		if (value === null || value === undefined) return undefined;

		switch (config.type) {
			case "string":
			case "file":
			case "directory":
				return typeof value === "string" ? value : String(value);

			case "number": {
				const num = typeof value === "number" ? value : Number(value);
				return isNaN(num) ? undefined : num;
			}

			case "boolean":
				if (typeof value === "boolean") return value;
				if (value === "true") return true;
				if (value === "false") return false;
				return undefined;

			case "enum":
				if (config.values && config.values.includes(String(value))) {
					return String(value);
				}
				// For multi-select enums
				if (Array.isArray(value) && config.values) {
					const filtered = value
						.map(String)
						.filter((v) => config.values!.includes(v));
					return filtered.length > 0 ? filtered : undefined;
				}
				return undefined;

			case "array":
				if (Array.isArray(value)) return value;
				if (typeof value === "string") {
					return value
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				}
				return undefined;

			case "object":
				if (typeof value === "object" && !Array.isArray(value)) return value;
				return undefined;

			default:
				return value;
		}
	}
}
