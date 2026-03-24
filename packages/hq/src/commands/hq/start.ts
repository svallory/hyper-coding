import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import {
	type TelegramState,
	generateHqClaudeMd,
	generateHqConfigSkill,
} from "create-hyper-hq/setup/claude-md";
import { isWorkspaceTrusted, trustWorkspace } from "create-hyper-hq/setup/trust";
import { runConfigWizard } from "create-hyper-hq/setup/wizard";
import { configExists, loadConfig } from "#config/index";
import type { HqConfig } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { TELEGRAM_CHANNEL_PLUGIN, getHqTelegramEnv } from "#services/telegram";
import * as tmux from "#services/tmux";
import { renderBanner } from "#utils/banner";
import { log } from "#utils/log";
import { LOG_DIR } from "#utils/paths";

const TELEGRAM_ENV_FILE = resolve(homedir(), ".claude", "channels", "telegram", ".env");
const TELEGRAM_ACCESS_FILE = resolve(homedir(), ".claude", "channels", "telegram", "access.json");

function isHyperOnPath(): boolean {
	const result = spawnSync("which", ["hyper"], { encoding: "utf-8" });
	return result.status === 0;
}

async function ensureConfig(): Promise<HqConfig> {
	if (configExists()) return loadConfig();
	await runConfigWizard();
	return loadConfig();
}

function detectTelegramState(): TelegramState {
	if (!existsSync(TELEGRAM_ENV_FILE)) return "not-configured";
	if (!existsSync(TELEGRAM_ACCESS_FILE)) return "configured-unpaired";
	try {
		const access = JSON.parse(readFileSync(TELEGRAM_ACCESS_FILE, "utf-8"));
		const hasUsers = (access.allowFrom ?? []).length > 0;
		const hasGroups = Object.keys(access.groups ?? {}).length > 0;
		return hasUsers || hasGroups ? "paired" : "configured-unpaired";
	} catch {
		return "configured-unpaired";
	}
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
			description: "Skip permission checks — HQ runs autonomously on startup",
			default: false,
		}),
		"permission-mode": Flags.string({
			description: "Permission mode for the Claude session",
			options: ["default", "acceptEdits", "plan", "bypassPermissions", "auto"],
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
		const permissionMode = flags.yolo
			? "bypassPermissions"
			: (flags["permission-mode"] ?? config.claude.permission_mode);

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

		// Always regenerate CLAUDE.md — content varies based on flags and detected state
		const claudeMdPath = resolve(hqDir, "CLAUDE.md");
		const telegramState = detectTelegramState();
		writeFileSync(
			claudeMdPath,
			generateHqClaudeMd({
				projectsRoot: config.projects_root,
				sessionName,
				autonomous: flags.yolo,
				telegramState,
			}),
			"utf-8",
		);

		// Generate /hq:config skill
		const skillDir = resolve(hqDir, ".claude", "skills", "hq-config");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(resolve(skillDir, "SKILL.md"), generateHqConfigSkill(), "utf-8");

		// Ensure workspace trust for both HQ dir and projects root
		for (const dir of [hqDir, config.projects_root]) {
			if (!isWorkspaceTrusted(dir)) {
				trustWorkspace(dir);
				log(`Trusted ${dir} for Claude Code.`);
			}
		}

		if (tmux.sessionExists(sessionName)) {
			log(`Session '${sessionName}' is already running. Attaching...`);
			tmux.attachSession(sessionName);
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
		});

		const cwd = hqDir;

		log(`Starting HQ session: ${sessionName}`);

		tmux.createSession({ name: sessionName, cwd, command, logFile });

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

		// Enable remote control before the startup prompt — /remote-control is a
		// Claude Code slash command that Claude can't invoke programmatically.
		tmux.sendKeys(sessionName, `/remote-control ${sessionName}`);

		// Send initial prompt so Claude reads CLAUDE.md and runs startup steps
		tmux.sendKeys(sessionName, "you are online, follow your On Startup instructions");

		// Show welcome banner
		this.log(renderBanner({ config, sessionName, logFile }));
		this.log("Attaching to HQ session. To detach without stopping: Ctrl+B, then D\n");

		// Auto-attach so the user lands inside the Claude session.
		// Claude's CLAUDE.md has startup instructions tailored to the
		// current state (Telegram pairing, --yolo mode, etc.)
		tmux.attachSession(sessionName);
	}
}
