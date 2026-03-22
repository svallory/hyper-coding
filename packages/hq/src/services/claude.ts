export interface ClaudeCommandOpts {
	name: string;
	spawnMode?: string;
	capacity?: number;
	permissionMode?: string;
	telegramBotToken?: string;
	telegramStateDir?: string;
	logFile: string;
}

/** Escape a value for safe inclusion in a single-quoted shell string */
function shellEscape(value: string): string {
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	return value.replace(/'/g, "'\\''");
}

export function buildClaudeCommand(opts: ClaudeCommandOpts): string {
	const parts: string[] = [];

	// CLAUDE_CODE_OAUTH_TOKEN breaks remote-control — it must use interactive auth
	parts.push("unset CLAUDE_CODE_OAUTH_TOKEN;");

	// Environment variables for Telegram
	if (opts.telegramBotToken) {
		parts.push(`TELEGRAM_BOT_TOKEN='${shellEscape(opts.telegramBotToken)}'`);
		if (opts.telegramStateDir) {
			parts.push(`TELEGRAM_STATE_DIR='${shellEscape(opts.telegramStateDir)}'`);
		}
	}

	parts.push("claude");
	parts.push("remote-control");
	parts.push(`--name '${shellEscape(opts.name)}'`);

	if (opts.spawnMode) {
		parts.push(`--spawn ${shellEscape(opts.spawnMode)}`);
	}

	if (opts.capacity) {
		parts.push(`--capacity ${opts.capacity}`);
	}

	if (opts.permissionMode) {
		parts.push(`--permission-mode ${shellEscape(opts.permissionMode)}`);
	}

	// Add Telegram channel if bot token is configured
	if (opts.telegramBotToken) {
		parts.push("--channels plugin:telegram@claude-plugins-official");
	}

	// Pipe to log file
	parts.push(`2>&1 | tee -a '${shellEscape(opts.logFile)}'`);

	return parts.join(" ");
}
