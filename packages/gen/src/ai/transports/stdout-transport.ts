/**
 * Stdout Transport
 *
 * Extracts the original Pass 1 behavior: assemble the prompt document,
 * write it to stdout, and signal exit code 2 (deferred resolution).
 *
 * Used by both 'stdout' and 'off' AI modes.
 */

import createDebug from "debug";
import { PromptAssembler } from "#/ai/prompt-assembler";
import type {
	AiTransport,
	TransportContext,
	TransportResult,
} from "./types.js";

const debug = createDebug("hypergen:ai:transport:stdout");

export class StdoutTransport implements AiTransport {
	readonly name = "stdout";

	async resolve(ctx: TransportContext): Promise<TransportResult> {
		const assembler = new PromptAssembler();
		const prompt = assembler.assemble(ctx.collector, {
			originalCommand: ctx.originalCommand,
			answersPath: ctx.answersPath,
			promptTemplate: ctx.promptTemplate,
		});

		debug("Writing prompt to stdout (%d chars)", prompt.length);
		process.stdout.write(prompt);

		return { status: "deferred", exitCode: 2 };
	}
}
