/**
 * Tiny CLI over `src/services/sessions.ts` so tests/e2e/sessions.sh can assert
 * against the module without a test runner. Usage:
 *
 *   bun run tests/e2e/sessions-cli.ts <subcommand> [args]
 *
 * Subcommands: encoded <cwd> | live <cwd> | latest <cwd> | lines <path> |
 * last <path> | owner-path <cwd> <id> | read-owner <cwd> <id> |
 * write-owner <cwd> <id> <machine>
 *
 * Every failure prints a line naming the Claude Code field or file it relied
 * on (C-18: a broken assumption must be loud, not silently skipped).
 */

import { basename } from "node:path";
import {
	encodeProjectDir,
	lastAssistantText,
	latestTranscript,
	liveSession,
	ownerPath,
	readOwner,
	transcriptLineCount,
	writeOwner,
} from "../../src/services/sessions.js";

const [command, ...args] = process.argv.slice(2);

function fail(reason: string): never {
	console.error(`FAIL: ${reason}`);
	process.exit(1);
}

function requireArg(name: string, value: string | undefined): string {
	if (!value) fail(`missing argument <${name}>`);
	return value;
}

switch (command) {
	case "encoded": {
		const cwd = requireArg("cwd", args[0]);
		console.log(encodeProjectDir(cwd));
		break;
	}
	case "live": {
		const cwd = requireArg("cwd", args[0]);
		const session = liveSession(cwd);
		if (!session) {
			console.log("none");
			break;
		}
		// C-18: name every field a caller could depend on.
		for (const field of ["pid", "cwd", "startedAt"] as const) {
			if (session[field] === undefined) fail(`sessions file field '${field}' is missing`);
		}
		console.log(
			JSON.stringify({
				pid: session.pid,
				sessionId: session.sessionId ?? null,
				startedAt: session.startedAt ?? null,
				cwd: session.cwd,
				name: session.name ?? null,
			}),
		);
		break;
	}
	case "latest": {
		const cwd = requireArg("cwd", args[0]);
		const transcript = latestTranscript(cwd);
		if (!transcript) {
			console.log("none");
			break;
		}
		console.log(
			JSON.stringify({
				id: transcript.id,
				path: transcript.path,
				basename: basename(transcript.path),
			}),
		);
		break;
	}
	case "lines": {
		const path = requireArg("path", args[0]);
		const count = transcriptLineCount(path);
		if (count === 0) fail(`transcript ${path} has no readable lines`);
		console.log(String(count));
		break;
	}
	case "last": {
		const path = requireArg("path", args[0]);
		const text = lastAssistantText(path);
		if (text === null) {
			fail(
				`no assistant text in ${path}: no line with type 'assistant' and message.content[] of type 'text'`,
			);
		}
		console.log(text);
		break;
	}
	case "owner-path": {
		console.log(ownerPath(requireArg("cwd", args[0]), requireArg("id", args[1])));
		break;
	}
	case "write-owner": {
		const marker = writeOwner(
			requireArg("cwd", args[0]),
			requireArg("id", args[1]),
			requireArg("machine", args[2]),
		);
		console.log(JSON.stringify(marker));
		break;
	}
	case "read-owner": {
		const marker = readOwner(requireArg("cwd", args[0]), requireArg("id", args[1]));
		if (!marker) {
			fail(`ownership marker missing or malformed: ${ownerPath(args[0] ?? "", args[1] ?? "")}`);
		}
		console.log(JSON.stringify(marker));
		break;
	}
	default:
		fail(
			`unknown subcommand '${command ?? ""}' (expected encoded|live|latest|lines|last|owner-path|write-owner|read-owner)`,
		);
}
