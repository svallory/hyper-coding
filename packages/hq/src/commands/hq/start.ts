import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import { runSetupIfNeeded } from "#config/setup";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { getHqTelegramEnv, TELEGRAM_CHANNEL_PLUGIN } from "#services/telegram";
import * as tmux from "#services/tmux";
import { renderBanner } from "#utils/banner";
import { log } from "#utils/log";
import { LOG_DIR } from "#utils/paths";
import { isWorkspaceTrusted, trustWorkspace } from "#utils/trust";

function isHyperOnPath(): boolean {
	const result = spawnSync("which", ["hyper"], { encoding: "utf-8" });
	return result.status === 0;
}

export default class Start extends BaseCommand<typeof Start> {
	static override description = "Start the HQ session — always-on Claude Code command center";

	static override examples = [
		"<%= config.bin %> hq start",
		"<%= config.bin %> hq start --yolo",
		"<%= config.bin %> hq start --fresh",
		"<%= config.bin %> hq start --no-telegram",
		"<%= config.bin %> hq start -- --model opus",
	];

	// Allow extra args after -- to pass through to claude
	static override strict = false;

	static override flags = {
		...BaseCommand.baseFlags,
		name: Flags.string({ description: "Custom session name", default: undefined }),
		fresh: Flags.boolean({
			description: "Start a new session instead of resuming the previous one",
			default: false,
		}),
		yolo: Flags.boolean({
			description: "Skip all permission checks (alias for -- --dangerously-skip-permissions)",
			default: false,
		}),
		"permission-mode": Flags.string({
			description: "Permission mode for the Claude session",
			options: ["default", "acceptEdits", "plan", "auto"],
			default: undefined,
		}),
		telegram: Flags.boolean({
			description: "Enable Telegram channel (enabled by default when configured)",
			default: true,
			allowNo: true,
		}),
	};

	async run(): Promise<void> {
		const { flags, argv } = await this.parse(Start);
		const extraClaudeArgs = argv as string[];
		const config = await runSetupIfNeeded();

		const sessionName = flags.name ?? config.hq.name;
		const permissionMode = flags["permission-mode"] ?? config.claude.permission_mode;

		// --yolo injects --dangerously-skip-permissions
		if (flags.yolo) {
			extraClaudeArgs.push("--dangerously-skip-permissions");
		}

		// Suggest global install if not on PATH
		if (!isHyperOnPath()) {
			p.log.warning(
				"Hyper CLI is not installed globally. The HQ session won't be able to run hyper commands.\n" +
					"  Install globally:\n\n" +
					"    bun install -g @hypercli/cli\n",
			);
		}

		// Ensure HQ directory exists
		const hqDir = config.hq.dir;
		if (!existsSync(hqDir)) {
			mkdirSync(hqDir, { recursive: true });
			log(`Created HQ directory: ${hqDir}`);
		}

		// Generate CLAUDE.md for the HQ session if not present
		const claudeMdPath = resolve(hqDir, "CLAUDE.md");
		if (!existsSync(claudeMdPath)) {
			writeFileSync(claudeMdPath, generateHqClaudeMd(config.projects_root, sessionName), "utf-8");
			log("Generated CLAUDE.md for HQ session.");
		}

		// Ensure workspace trust for both HQ dir and projects root
		for (const dir of [hqDir, config.projects_root]) {
			if (!isWorkspaceTrusted(dir)) {
				trustWorkspace(dir);
				log(`Trusted ${dir} for Claude Code.`);
			}
		}

		if (tmux.sessionExists(sessionName)) {
			log(`Session '${sessionName}' is already running. Use 'hyper hq attach' to connect.`);
			return;
		}

		mkdirSync(LOG_DIR, { recursive: true });

		// Enable Telegram channel if configured and not explicitly disabled
		const telegramEnv =
			flags.telegram && config.telegram.hq_bot_token ? getHqTelegramEnv(config) : null;
		const channels: string[] = [];
		if (telegramEnv) channels.push(TELEGRAM_CHANNEL_PLUGIN);

		const logFile = resolve(LOG_DIR, `${sessionName}.log`);

		const command = buildClaudeCommand({
			name: sessionName,
			resume: !flags.fresh,
			permissionMode,
			telegramBotToken: telegramEnv?.TELEGRAM_BOT_TOKEN,
			channels,
			extraArgs: extraClaudeArgs,
			logFile,
		});

		const cwd = hqDir;

		log(`Starting HQ session: ${sessionName}`);

		tmux.createSession({ name: sessionName, cwd, command });

		// Verify the session actually survived startup
		if (tmux.waitAndVerify(sessionName) === "dead") {
			let lastError = "";
			try {
				const logContent = readFileSync(logFile, "utf-8");
				const errorLines = logContent.split("\n").filter((l) => l.startsWith("Error:"));
				if (errorLines.length > 0) {
					lastError = `\nLast error from log:\n  ${errorLines[errorLines.length - 1]}\n`;
				}
			} catch {}

			this.error(
				`Session '${sessionName}' exited immediately after starting.
${lastError}
Full log: ${logFile}

Common causes:
  - Claude CLI is not authenticated (run: claude auth login)
  - Workspace not trusted (run: cd <dir> && claude)
  - The claude command is not found (check your PATH)
  - Telegram plugin not installed (run: claude plugin install telegram@claude-plugins-official)`,
			);
		}

		// Session survived — disable remain-on-exit so panes clean up normally
		tmux.disableRemainOnExit(sessionName);

		// Show welcome banner
		this.log(renderBanner({ config, sessionName, logFile }));
	}
}

function generateHqClaudeMd(projectsRoot: string, sessionName: string): string {
	return `# Hyper HQ — Claude Code Command Center

You are **Hyper HQ**, an always-running Claude Code instance that serves as a command center.
Calm, decisive, and always in control.

## Your Role

You are a persistent Claude Code session running inside tmux.
Users connect to you from claude.ai/code or mobile apps via Remote Control,
and via Telegram messages through the channels plugin when enabled.

## On Startup

When this session first starts, immediately:
1. Run \`/remote-control ${sessionName}\` to enable Remote Control access
2. Check if Telegram is configured by reading \`~/.claude/channels/telegram/.env\`
3. Check if Telegram is paired by reading \`~/.claude/channels/telegram/access.json\`
   - If the file doesn't exist or \`allowFrom\` is empty, Telegram is NOT yet paired
4. If Telegram is available AND paired, use the \`reply\` tool to send: "Hyper HQ is online. Ready for orders."
5. Run \`hyper hq list --json\` to get the current project inventory.

## Telegram Pairing

If a user connects and Telegram is configured but NOT yet paired:
1. Tell the user to open Telegram and message the bot — the bot will reply with a pairing code
2. Ask the user for the pairing code
3. Run \`/telegram:access pair <code>\` to approve them
4. Run \`/telegram:access policy allowlist\` to lock down access
5. Confirm pairing is complete

## Capabilities

1. **Spawn new Claude sessions** for any project using the \`hyper hq\` CLI
2. **Receive and act on messages** via Telegram (if configured and paired)
3. **Manage running sessions** — start, stop, check status
4. **Coordinate work** across multiple projects

## Key Commands

\`\`\`bash
hyper hq spawn <project>                        # Spawn session for a project
hyper hq spawn <project> --worktree <branch>    # Spawn on existing worktree
hyper hq spawn <project> --new-worktree <branch> # Create worktree + spawn
hyper hq status                                 # Check all running sessions
hyper hq stop <project>                         # Stop a session
hyper hq stop-all                               # Stop everything
hyper hq list                                   # List all projects and worktrees
hyper hq list --json                            # JSON output for parsing
hyper hq config                                 # Show current configuration
\`\`\`

## Handling Requests

When a user asks to open/start/spawn a session:

1. Parse the request for: **project name** and optionally **worktree** (existing or new)
2. Run \`hyper hq list --json\` to verify the project exists
3. Run the appropriate spawn command
4. Reply with confirmation, session name, and remind them to check **claude.ai/code**

## Important Notes

- Projects root: ${projectsRoot}
- Logs: ~/.config/hyper/logs/
- The \`wt\` (worktrunk) command manages worktrees
- Config: ~/.config/hyper/hq.toml

## Package Management
- Use bun, never npm
`;
}
