export interface ClaudeCommandOpts {
	name: string;
	/** Resume the most recent session in the working directory */
	resume?: boolean;
	permissionMode?: string;
	telegramBotToken?: string;
	channels?: string[];
	/** Extra args passed through to `claude` verbatim */
	extraArgs?: string[];
}

/** Escape a value for safe inclusion in a single-quoted shell string */
function shellEscape(value: string): string {
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	return value.replace(/'/g, "'\\''");
}

/**
 * Build the command to start an interactive Claude session.
 *
 * Architecture decision: we use `claude` (interactive mode) instead of
 * `claude remote-control` (subcommand) because:
 *
 * - `claude remote-control` is a standalone server that accepts sessions
 *   from claude.ai/code, but it does NOT support --channels for Telegram.
 * - `claude` (interactive) supports --channels AND the /remote-control
 *   slash command, giving us BOTH Telegram and web access in one session.
 *
 * Flow:
 * 1. Start `claude --channels plugin:telegram@... --continue`
 * 2. The CLAUDE.md instructs Claude to run `/remote-control <name>`
 *    on startup, which enables claude.ai/code access.
 * 3. Result: one session with Telegram channels + web remote control.
 *
 * IMPORTANT: Do NOT pipe stdout (e.g. `| tee`). Claude interactive mode
 * requires a TTY — piping strips it and the process dies immediately.
 * Use tmux `pipe-pane` for logging instead (see tmux.createSession).
 */
export function buildClaudeCommand(opts: ClaudeCommandOpts): string {
	const parts: string[] = [];

	// CLAUDE_CODE_OAUTH_TOKEN breaks remote-control — it must use interactive auth
	parts.push("unset CLAUDE_CODE_OAUTH_TOKEN;");

	// Environment variables for Telegram
	if (opts.telegramBotToken) {
		parts.push(`TELEGRAM_BOT_TOKEN='${shellEscape(opts.telegramBotToken)}'`);
	}

	parts.push("claude");

	if (opts.resume) {
		parts.push("--continue");
	}

	parts.push(`--name '${shellEscape(opts.name)}'`);

	if (opts.permissionMode) {
		parts.push(`--permission-mode ${shellEscape(opts.permissionMode)}`);
	}

	// Channels (e.g. Telegram plugin)
	if (opts.channels && opts.channels.length > 0) {
		parts.push("--channels");
		for (const channel of opts.channels) {
			parts.push(`'${shellEscape(channel)}'`);
		}
	}

	// Extra args passed through verbatim
	if (opts.extraArgs && opts.extraArgs.length > 0) {
		parts.push(...opts.extraArgs);
	}

	return parts.join(" ");
}
