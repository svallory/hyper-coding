/**
 * Hyperdrive for pi: save this space when a pi session ends.
 *
 * Install it with `pi install ./packages/drive/pi` (or
 * `pi --extension ./packages/drive/pi/hyperdrive.ts` for one run), then a pi
 * session in a space whose cadence is `session-end` or `session-end+push`
 * saves itself the way a Claude session does: `session_shutdown` writes the
 * payload and starts the same detached `hyper space commit --session-end`
 * worker, so pi's exit is never held by a commit or a push — only by one
 * read-only `hyper space detect --json` call, killed at 5 s. Failures, and a
 * call that overran that bound in a space, land in
 * `.hyper/space.git/session-end.log` and surface in `hyper space status`.
 *
 * Only `quit` saves. `/new`, `/resume`, `/fork` and `/reload` start over in
 * the same place, exactly like Claude's `/clear` and resume, so they save
 * nothing.
 *
 * The whole handler is wrapped: pi awaits `session_shutdown` with no timeout,
 * so everything it waits for is bounded and it must never throw into pi.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realDeps, type SessionEndDeps, type SessionFacts, saveSessionEnd } from "./session-end.ts";

/** Capture only plain data here: the context is invalid after shutdown. */
function factsFrom(ctx: ExtensionContext): SessionFacts {
	let sessionName: string | undefined;
	let entries: readonly unknown[] = [];
	try {
		sessionName = ctx.sessionManager.getSessionName();
		entries = ctx.sessionManager.getBranch();
	} catch {
		// A session that never persisted has no branch and no name; the summary
		// is then simply absent and the commit says only that the session ended.
	}
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		sessionName,
		entries,
	};
}

/**
 * `deps` exists for the tests: pi calls this factory with the API alone and
 * always gets the real filesystem, the real CLI probe and the real detached
 * spawn.
 */
export default function hyperdrive(pi: ExtensionAPI, deps: SessionEndDeps = realDeps): void {
	pi.on("session_shutdown", async (event, ctx) => {
		try {
			// `/new`, `/resume`, `/fork` and `/reload` are session replacement,
			// not session end: they start over in the same place and committing
			// on each would be noise. Only `quit` saves.
			if (event.reason !== "quit") return;
			const facts = factsFrom(ctx);
			if (!facts.sessionId) return;
			await saveSessionEnd(facts, withNotify(deps, ctx));
		} catch {
			// Never throw into pi, and never print more than the one line the
			// dependencies already printed.
		}
	});
}

/** In TUI and RPC modes the line is a notification; print and JSON modes get stderr. */
function withNotify(deps: SessionEndDeps, ctx: ExtensionContext): SessionEndDeps {
	if (!ctx.hasUI) return deps;
	return {
		...deps,
		notify: (line) => {
			try {
				ctx.ui.notify(line, "info");
			} catch {
				deps.notify(line);
			}
		},
	};
}
