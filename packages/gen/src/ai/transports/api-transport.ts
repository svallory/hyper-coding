/**
 * API Transport
 *
 * Resolves @ai blocks by calling an LLM via Vercel AI SDK (through AiService).
 * Sends a single batched prompt with all blocks and parses a JSON response.
 */

import { ErrorCode, ErrorHandler } from "@hypercli/core";
import createDebug from "debug";
import { AiService } from "#/ai/ai-service";
import { PromptAssembler } from "#/ai/prompt-assembler";
import type { AiTransport, TransportContext, TransportResult } from "./types.js";

const debug = createDebug("hypergen:ai:transport:api");

export class ApiTransport implements AiTransport {
	readonly name = "api";

	async resolve(ctx: TransportContext): Promise<TransportResult> {
		const assembler = new PromptAssembler();

		// Build the prompt for the LLM (same prompt document, but with JSON-only instructions)
		const prompt = assembler.assemble(ctx.collector, {
			originalCommand: ctx.originalCommand,
			answersPath: ctx.answersPath,
			promptTemplate: ctx.promptTemplate,
		});

		// Build the expected keys list for validation
		const entries = ctx.collector.getEntries();
		const expectedKeys = [...entries.keys()];

		debug("Resolving %d AI blocks via API", expectedKeys.length);

		// Use AiService for generation (reuses retry, cost tracking, model routing)
		const aiService = AiService.getInstance(ctx.config);

		const systemPrompt = [
			"You are a code generation assistant.",
			"You MUST respond with ONLY a valid JSON object — no markdown fences, no explanation, no text outside the JSON.",
			`The JSON object must have exactly these keys: ${expectedKeys.map((k) => `"${k}"`).join(", ")}.`,
			"Each value must be a string containing the generated code or content for that key.",
		].join("\n");

		const result = await aiService.generate({
			prompt,
			system: systemPrompt,
			temperature: ctx.config.temperature ?? 0.2,
			maxTokens: ctx.config.maxTokens,
			model: ctx.config.model,
			provider: ctx.config.provider,
			projectRoot: ctx.projectRoot,
			stepName: "ai-transport-api",
		});

		// Parse JSON response
		const answers = parseJsonResponse(result.output, expectedKeys);
		debug(
			"API resolved %d keys (cost: $%s)",
			Object.keys(answers).length,
			result.costUsd.toFixed(4),
		);

		return { status: "resolved", answers };
	}
}

/**
 * Parse a JSON response from the LLM, stripping common artifacts.
 */
function parseJsonResponse(raw: string, expectedKeys: string[]): Record<string, string> {
	let text = raw.trim();

	// Strip markdown code fences (common LLM quirk)
	const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m);
	if (fenceMatch) {
		text = fenceMatch[1].trim();
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`Failed to parse JSON response from AI provider. Response starts with: "${text.slice(0, 100)}..."`,
			{ cause: err },
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`AI response is not a JSON object. Got: ${typeof parsed}`,
			{},
		);
	}

	// Validate all expected keys are present
	const missing = expectedKeys.filter((k) => !(k in parsed));
	if (missing.length > 0) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`AI response missing expected keys: ${missing.join(", ")}`,
			{
				expected: expectedKeys.join(", "),
				received: Object.keys(parsed).join(", "),
			},
		);
	}

	// Coerce all values to strings
	const answers: Record<string, string> = {};
	for (const key of expectedKeys) {
		const val = parsed[key];
		answers[key] = typeof val === "string" ? val : JSON.stringify(val);
	}

	return answers;
}
