/**
 * Command Transport
 *
 * Resolves @ai blocks by piping the prompt to a CLI command.
 * Supports two sub-modes:
 *   - 'batched' (default): one invocation, JSON response with all keys
 *   - 'per-block': one invocation per @ai block, raw text response per key
 *
 * Command template:
 *   - Contains {prompt} → shell-escape and substitute into args
 *   - No {prompt} → pipe prompt to subprocess stdin
 */

import { execFile } from "node:child_process";
import createDebug from "debug";
import type { AiBlockEntry } from "#/ai-collector";
import { PromptAssembler } from "#/ai/prompt-assembler";
import { ErrorCode, ErrorHandler } from "#/errors/hypergen-errors";
import type { AiTransport, TransportContext, TransportResult } from "#/types.js";

const debug = createDebug("hypergen:ai:transport:command");

export class CommandTransport implements AiTransport {
	readonly name = "command";

	async resolve(ctx: TransportContext): Promise<TransportResult> {
		const command = ctx.config.command;
		if (!command) {
			throw ErrorHandler.createError(
				ErrorCode.AI_TRANSPORT_FAILED,
				"Command transport requires ai.command to be set in config",
				{},
			);
		}

		const commandMode = ctx.config.commandMode || "batched";
		const entries = ctx.collector.getEntries();
		const expectedKeys = [...entries.keys()];

		debug(
			"Resolving %d AI blocks via command (%s mode): %s",
			expectedKeys.length,
			commandMode,
			command,
		);

		if (commandMode === "per-block") {
			return this.resolvePerBlock(ctx, command, entries);
		}

		return this.resolveBatched(ctx, command, expectedKeys);
	}

	private async resolveBatched(
		ctx: TransportContext,
		command: string,
		expectedKeys: string[],
	): Promise<TransportResult> {
		const assembler = new PromptAssembler();
		const prompt = assembler.assemble(ctx.collector, {
			originalCommand: ctx.originalCommand,
			answersPath: ctx.answersPath,
			promptTemplate: ctx.promptTemplate,
		});

		// Append JSON-only instruction
		const fullPrompt = `${prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object. No markdown fences, no explanation.\n`;

		const stdout = await executeCommand(command, fullPrompt);
		const answers = parseBatchedResponse(stdout, expectedKeys);

		debug("Command resolved %d keys", Object.keys(answers).length);
		return { status: "resolved", answers };
	}

	private async resolvePerBlock(
		ctx: TransportContext,
		command: string,
		entries: Map<string, AiBlockEntry>,
	): Promise<TransportResult> {
		const answers: Record<string, string> = {};

		for (const [key, entry] of entries) {
			debug('Resolving block "%s" via command', key);

			// Build a single-block prompt
			const parts: string[] = [];
			if (entry.contexts.length > 0) {
				parts.push("## Context\n");
				for (const c of entry.contexts) parts.push(`${c}\n`);
			}
			parts.push("## Prompt\n");
			parts.push(`${entry.prompt}\n`);
			if (entry.outputDescription.trim()) {
				parts.push("## Expected Output Format\n");
				parts.push(`${entry.outputDescription}\n`);
			}
			if (entry.examples.length > 0) {
				parts.push("## Examples\n");
				for (const ex of entry.examples) {
					parts.push(`\`\`\`\n${ex}\n\`\`\`\n`);
				}
			}
			parts.push(
				"\nRespond with ONLY the generated content. No explanation, no markdown fences.\n",
			);

			const prompt = parts.join("\n");
			const stdout = await executeCommand(command, prompt);
			answers[key] = stdout.trim();
		}

		debug("Command (per-block) resolved %d keys", Object.keys(answers).length);
		return { status: "resolved", answers };
	}
}

/**
 * Execute a command, either by substituting {prompt} into args or piping via stdin.
 */
function executeCommand(commandTemplate: string, prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const usesSubstitution = commandTemplate.includes("{prompt}");

		let cmd: string;
		let args: string[];

		if (usesSubstitution) {
			// Shell-escape the prompt and substitute
			const escaped = shellEscape(prompt);
			const full = commandTemplate.replace(/\{prompt\}/g, escaped);
			// Use shell execution for substituted commands
			cmd = "/bin/sh";
			args = ["-c", full];
		} else {
			// Parse the command into parts
			const parts = parseCommand(commandTemplate);
			cmd = parts[0];
			args = parts.slice(1);
		}

		debug("Executing: %s %s", cmd, usesSubstitution ? "(with substitution)" : "(with stdin pipe)");

		// Strip CLAUDECODE to avoid "nested session" errors inside Claude Code
		const { CLAUDECODE: _cc, ...cleanEnv } = process.env;
		const child = execFile(
			cmd,
			args,
			{
				maxBuffer: 10 * 1024 * 1024, // 10MB
				timeout: 300_000, // 5 minutes
				env: cleanEnv,
			},
			(error, stdout, stderr) => {
				if (error) {
					const msg = stderr?.trim() || error.message;
					reject(
						ErrorHandler.createError(
							ErrorCode.AI_TRANSPORT_FAILED,
							`Command failed (exit ${error.code ?? "unknown"}): ${msg}`,
							{ cause: error },
						),
					);
					return;
				}
				resolve(stdout);
			},
		);

		// Pipe prompt via stdin if no {prompt} substitution
		if (!usesSubstitution && child.stdin) {
			child.stdin.write(prompt);
			child.stdin.end();
		}
	});
}

/**
 * Parse a batched JSON response from a command.
 */
function parseBatchedResponse(raw: string, expectedKeys: string[]): Record<string, string> {
	let text = raw.trim();

	// Strip markdown code fences
	const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m);
	if (fenceMatch) {
		text = fenceMatch[1].trim();
	}

	// Try to extract JSON object from the response
	const jsonStart = text.indexOf("{");
	const jsonEnd = text.lastIndexOf("}");
	if (jsonStart >= 0 && jsonEnd > jsonStart) {
		text = text.slice(jsonStart, jsonEnd + 1);
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`Failed to parse JSON from command output. Output starts with: "${raw.slice(0, 100)}..."`,
			{ cause: err },
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`Command output is not a JSON object. Got: ${typeof parsed}`,
			{},
		);
	}

	const missing = expectedKeys.filter((k) => !(k in parsed));
	if (missing.length > 0) {
		throw ErrorHandler.createError(
			ErrorCode.AI_TRANSPORT_FAILED,
			`Command response missing expected keys: ${missing.join(", ")}`,
			{
				expected: expectedKeys.join(", "),
				received: Object.keys(parsed).join(", "),
			},
		);
	}

	const answers: Record<string, string> = {};
	for (const key of expectedKeys) {
		const val = parsed[key];
		answers[key] = typeof val === "string" ? val : JSON.stringify(val);
	}

	return answers;
}

/**
 * Simple shell escape for single-quoting a string.
 */
function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Parse a command string into parts, respecting quotes.
 */
function parseCommand(cmd: string): string[] {
	const parts: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < cmd.length; i++) {
		const ch = cmd[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === " " && !inSingle && !inDouble) {
			if (current) {
				parts.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) parts.push(current);

	return parts;
}
