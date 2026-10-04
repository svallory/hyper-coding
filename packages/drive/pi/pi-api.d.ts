/**
 * The slice of pi's extension API this extension uses, declared locally so
 * `@hypercli/drive` does not take a runtime dependency on the agent that loads
 * it. At runtime pi resolves `@earendil-works/pi-coding-agent` to its own
 * installed package; these declarations only have to match it.
 *
 * Source of truth: `dist/core/extensions/types.d.ts` of the installed
 * `@earendil-works/pi-coding-agent` (ExtensionAPI, ExtensionContext,
 * SessionShutdownEvent). Widen them here only when pi widens them.
 */
declare module "@earendil-works/pi-coding-agent" {
	export interface SessionShutdownEvent {
		type: "session_shutdown";
		reason: "quit" | "reload" | "new" | "resume" | "fork";
		/** Destination session file when shutting down due to session replacement. */
		targetSessionFile?: string;
	}

	export interface ReadonlySessionManager {
		getCwd(): string;
		getSessionId(): string;
		getSessionFile(): string | undefined;
		getSessionName(): string | undefined;
		getBranch(): unknown[];
	}

	export interface ExtensionUIContext {
		notify(message: string, level?: "info" | "warning" | "error"): void;
	}

	export interface ExtensionContext {
		ui: ExtensionUIContext;
		/** Whether dialog-capable UI is available (true in TUI and RPC modes). */
		hasUI: boolean;
		/** Current working directory. */
		cwd: string;
		/** Session manager (read-only). */
		sessionManager: ReadonlySessionManager;
	}

	export interface ExtensionAPI {
		on(
			event: "session_shutdown",
			handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>,
		): () => void;
	}
}
