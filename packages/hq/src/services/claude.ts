export interface ClaudeCommandOpts {
	name: string;
	/** Resume the most recent session in the working directory */
	resume?: boolean;
	permissionMode?: string;
	telegramBotToken?: string;
	channels?: string[];
	/** Extra args passed through to `claude` verbatim */
	extraArgs?: string[];
	logFile: string;
}

/** Escape a value for safe inclusion in a single-quoted shell string */
function shellEscape(value: string): string {
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	return value.replace(/'/g, "'\\''");
}

/**
 * Build the command to start an interactive Claude session.
 *
 * Uses `claude` (interactive mode) instead of `claude remote-control` so that:
 * - Channels work (via --channels at launch)
 * - Remote control works (via /remote-control after launch)
 * - Session resume works (via --resume)
 * - Both channels and remote control coexist in the same session
 *
 * The generated CLAUDE.md instructs the session to run `/remote-control <name>`
 * on startup to enable remote access.
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

	// Pipe to log file
	parts.push(`2>&1 | tee -a '${shellEscape(opts.logFile)}'`);

	return parts.join(" ");
}
