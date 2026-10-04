/**
 * Hyperdrive for pi: save this space when a pi session ends.
 *
 * Install it with `pi install ./packages/drive/pi` (or
 * `pi --extension ./packages/drive/pi/hyperdrive.ts` for one run), then a pi
 * session in a space whose cadence is `session-end` or `session-end+push`
 * saves itself the way a Claude session does: `session_shutdown` writes the
 * payload and starts the same detached `hyper space commit --session-end`
 * worker, so pi's exit is never held by a commit or a push. Failures land in
 * `.hyper/space.git/session-end.log` and surface in `hyper space status`.
 *
 * What the commit subject carries for pi is the session name, or the first
 * line of the first prompt — prompt text lands in the space's history.
 *
 * The whole handler is wrapped: pi awaits `session_shutdown` with no timeout,
 * so it must return in milliseconds and must never throw into pi.
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
 * always gets the real filesystem and the real detached spawn.
 */
export default function hyperdrive(pi: ExtensionAPI, deps: SessionEndDeps = realDeps): void {
	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			const facts = factsFrom(ctx);
			if (!facts.sessionId) return;
			saveSessionEnd(facts, withNotify(deps, ctx));
		} catch {
			// Never throw into pi, and never print more than the one line the
			// dependencies already printed.
		}
	});
}

/** In TUI and RPC modes the line is a notification; print and JSON modes get stderr. */
function withNotify(deps: typeof realDeps, ctx: ExtensionContext): typeof realDeps {
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
