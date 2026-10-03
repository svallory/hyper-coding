/**
 * Tiny CLI over `src/services/sessions.ts` so tests/e2e/sessions.sh can assert
 * against the module without a test runner. Usage:
 *
 *   bun tests/e2e/sessions-cli.ts <subcommand> [args]
 *
 * Subcommands: encoded <cwd> | live <cwd> | live-for <sessionId> |
 * latest <cwd> | lines <path> | last <path> | owner-path <cwd> <id> |
 * read-owner <cwd> <id> | write-owner <cwd> <id> <machine>
 *
 * Contract: exactly one JSON object on the LAST line of stdout, nothing else.
 * Something else on this machine (a proto shim under a fresh HOME) has been
 * known to prepend an NDJSON line, so callers must read the last line and
 * validate it rather than trusting the whole stream.
 *
 * Every failure prints a line naming the Claude Code field or file it relied on
 * (C-18: a broken assumption must be loud, not silently skipped).
 */

import { basename } from "node:path";
import {
	encodeProjectDir,
	lastAssistantText,
	latestTranscript,
	liveSession,
	liveSessions,
	liveSessionsFor,
	ownerPath,
	readOwner,
	transcriptLineCount,
	writeOwner,
} from "../../src/services/sessions.js";

const [command, ...args] = process.argv.slice(2);

function fail(reason: string): never {
	process.stderr.write(`FAIL: ${reason}\n`);
	process.exit(1);
}

function requireArg(name: string, value: string | undefined): string {
	if (!value) fail(`missing argument <${name}>`);
	return value;
}

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

switch (command) {
	case "encoded": {
		emit({ encoded: encodeProjectDir(requireArg("cwd", args[0])) });
		break;
	}
	case "live": {
		const cwd = requireArg("cwd", args[0]);
		const sessions = liveSessions(cwd);
		const newest = liveSession(cwd);
		if (!newest) {
			emit({ live: null });
			break;
		}
		// C-18: name every field a caller could depend on.
		for (const field of ["pid", "cwd", "startedAt", "sessionId", "procStart"] as const) {
			if (newest[field] === undefined) {
				fail(`sessions file field '${field}' is missing for cwd ${cwd}`);
			}
		}
		emit({
			live: {
				pid: newest.pid,
				sessionId: newest.sessionId ?? null,
				startedAt: newest.startedAt ?? null,
				cwd: newest.cwd,
				procStart: newest.procStart ?? null,
				entrypoint: newest.entrypoint ?? null,
				version: newest.version ?? null,
				name: newest.name ?? null,
			},
			count: sessions.length,
			pids: sessions.map((session) => session.pid),
		});
		break;
	}
	case "live-for": {
		const sessionId = requireArg("sessionId", args[0]);
		emit({ live: liveSessionsFor(sessionId).map((session) => session.pid) });
		break;
	}
	case "latest": {
		const cwd = requireArg("cwd", args[0]);
		const transcript = latestTranscript(cwd);
		if (!transcript) {
			emit({ latest: null });
			break;
		}
		emit({
			latest: {
				id: transcript.id,
				path: transcript.path,
				basename: basename(transcript.path),
			},
		});
		break;
	}
	case "lines": {
		const path = requireArg("path", args[0]);
		const count = transcriptLineCount(path);
		if (count === 0) fail(`transcript ${path} has no readable lines`);
		emit({ lines: count });
		break;
	}
	case "last": {
		const path = requireArg("path", args[0]);
		const text = lastAssistantText(path);
		if (text === null) {
			fail(
				`no assistant text in ${path}: no line with type 'assistant' whose message.content[] holds a block of type 'text' for the last message.id`,
			);
		}
		emit({ text });
		break;
	}
	case "owner-path": {
		emit({ path: ownerPath(requireArg("cwd", args[0]), requireArg("id", args[1])) });
		break;
	}
	case "write-owner": {
		const marker = writeOwner(
			requireArg("cwd", args[0]),
			requireArg("id", args[1]),
			requireArg("machine", args[2]),
		);
		emit({ marker });
		break;
	}
	case "read-owner": {
		const state = readOwner(requireArg("cwd", args[0]), requireArg("id", args[1]));
		if (state.state === "malformed") {
			fail(`ownership marker is malformed (${state.path}): ${state.reason}`);
		}
		if (state.state === "unowned") fail(`no ownership marker at ${state.path}`);
		emit({ marker: state.marker, path: state.path });
		break;
	}
	default:
		fail(
			`unknown subcommand '${command ?? ""}' (expected encoded|live|live-for|latest|lines|last|owner-path|write-owner|read-owner)`,
		);
}
