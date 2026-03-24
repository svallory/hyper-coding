import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import { generateHqClaudeMd } from "create-hyper-hq/setup/claude-md";
import { isWorkspaceTrusted, trustWorkspace } from "create-hyper-hq/setup/trust";
import { runConfigWizard } from "create-hyper-hq/setup/wizard";
import { configExists, loadConfig } from "#config/index";
import type { HqConfig } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { getHqTelegramEnv, TELEGRAM_CHANNEL_PLUGIN } from "#services/telegram";
import * as tmux from "#services/tmux";
import { renderBanner } from "#utils/banner";
import { log } from "#utils/log";
import { LOG_DIR } from "#utils/paths";

function isHyperOnPath(): boolean {
	const result = spawnSync("which", ["hyper"], { encoding: "utf-8" });
	return result.status === 0;
}

async function ensureConfig(): Promise<HqConfig> {
	if (configExists()) return loadConfig();
	await runConfigWizard();
	return loadConfig();
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
		const config = await ensureConfig();

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
