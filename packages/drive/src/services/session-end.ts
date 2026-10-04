/** Read-only Claude SessionEnd input and transcript message construction. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";

/** Summary cap: 200 Unicode code points, excluding the fixed subject prefix. */
export const SESSION_SUMMARY_LIMIT = 200;
const HOOK_INPUT_LIMIT = 64 * 1024;
/** Skip entire JSONL records above 1 MiB, including oversized summary records. */
export const TRANSCRIPT_LINE_LIMIT = 1024 * 1024;

/** Buffer at most one capped record plus the stream's 64 KiB chunk. */
async function* transcriptLines(stream: Readable): AsyncGenerator<string> {
	let pieces: Buffer[] = [];
	let bytes = 0;
	let skipped = false;
	for await (const chunk of stream) {
		const buffer: Buffer = chunk;
		let start = 0;
		while (start < buffer.length) {
			const newline = buffer.indexOf(10, start);
			const end = newline < 0 ? buffer.length : newline;
			if (!skipped) {
				bytes += end - start;
				if (bytes > TRANSCRIPT_LINE_LIMIT) {
					skipped = true;
					pieces = [];
				} else pieces.push(buffer.subarray(start, end));
			}
			if (newline >= 0) {
				if (!skipped) yield Buffer.concat(pieces, bytes).toString("utf8");
				pieces = [];
				bytes = 0;
				skipped = false;
			}
			start = end + 1;
		}
	}
	if (!skipped && bytes > 0) yield Buffer.concat(pieces, bytes).toString("utf8");
}

export interface SessionEndInput {
	session_id: string;
	transcript_path?: string;
}

/** Remove terminal controls/formatting and fold all line separators into spaces. */
export function sessionEndLine(text: string, limit = SESSION_SUMMARY_LIMIT): string {
	return Array.from(
		text
			.replace(/\s+/gu, " ")
			.replace(/[\p{Cc}\p{Cf}]/gu, "")
			.trim(),
	)
		.slice(0, limit)
		.join("");
}

/** Validate before touching the space. Unknown hook fields are intentionally ignored. */
export async function readSessionEndInput(input: Readable): Promise<SessionEndInput> {
	let raw = "";
	input.setEncoding("utf8");
	for await (const chunk of input) {
		raw += chunk.toString();
		if (Buffer.byteLength(raw) > HOOK_INPUT_LIMIT)
			throw new Error("SessionEnd input exceeds 64 KiB. Send only the hook JSON payload.");
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error(
			"I couldn't read the SessionEnd JSON. Send a valid hook JSON object on stdin; nothing was committed.",
		);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(
			"SessionEnd input must be a JSON object. Check the hook configuration; nothing was committed.",
		);
	const record = value as Record<string, unknown>;
	if (
		typeof record.session_id !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.session_id)
	)
		throw new Error(
			"SessionEnd needs a UUID session_id. Check the hook payload; nothing was committed.",
		);
	if (record.transcript_path !== undefined && typeof record.transcript_path !== "string")
		throw new Error(
			"SessionEnd transcript_path must be a string. Check the hook payload; nothing was committed.",
		);
	return {
		session_id: record.session_id,
		transcript_path: record.transcript_path as string | undefined,
	};
}

/**
 * Stream JSONL, retaining only the last summary from records at most 1 MiB.
 * Oversized, invalid and interrupted JSONL records are ignored. Opening is
 * read-only/nonblocking; directories, devices and FIFOs are not transcripts.
 */
export async function lastSessionSummary(path: string | undefined): Promise<string | undefined> {
	if (!path) return undefined;
	try {
		const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
		try {
			if (!(await file.stat()).isFile()) return undefined;
			const stream = file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
			let summary: string | undefined;
			try {
				for await (const line of transcriptLines(stream)) {
					try {
						const entry = JSON.parse(line);
						if (entry?.type === "summary")
							summary =
								typeof entry.summary === "string" ? sessionEndLine(entry.summary) : undefined;
					} catch {
						/* Transcripts can end with a partially written record. */
					}
				}
			} finally {
				stream.destroy();
			}
			return summary || undefined;
		} finally {
			await file.close();
		}
	} catch {
		// Missing/unreadable transcripts must not prevent saving space files.
		return undefined;
	}
}

export async function sessionEndMessage(input: SessionEndInput): Promise<string> {
	const summary = await lastSessionSummary(input.transcript_path);
	const subject = summary ? `session: ${summary}` : `session ${input.session_id} ended`;
	return `${subject}\n\nClaude-Session: ${input.session_id}`;
}
