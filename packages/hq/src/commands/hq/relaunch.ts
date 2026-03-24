import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { findLatestSession, findSession, recordLaunch, recordStop } from "#services/sessions";
import { TELEGRAM_CHANNEL_PLUGIN, getProjectTelegramEnv } from "#services/telegram";
import * as tmux from "#services/tmux";
import { sanitizeSessionName } from "#services/tmux";
import { log } from "#utils/log";
import { LOG_DIR } from "#utils/paths";

function formatTimestamp(): string {
	const now = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

export default class Relaunch extends BaseCommand<typeof Relaunch> {
	static override description = "Stop and relaunch a session with --continue";

	static override examples = [
		"<%= config.bin %> hq relaunch hq-my-project-03-24-10-30",
		"<%= config.bin %> hq relaunch my-project",
		"<%= config.bin %> hq relaunch my-project src/frontend",
		"<%= config.bin %> hq relaunch hq-my-project-03-24-10-30 --yolo",
	];

	static override args = {
		target: Args.string({
			description: "Session name, or project name",
			required: true,
		}),
		path: Args.string({
			description: "Relative path inside the project (when target is a project name)",
			required: false,
		}),
	};

	static override strict = false;

	static override flags = {
		...BaseCommand.baseFlags,
		"permission-mode": Flags.string({
			description: "Permission mode",
			options: ["default", "acceptEdits", "plan", "bypassPermissions", "auto"],
		}),
		yolo: Flags.boolean({
			description: "Skip all permission checks (sets --permission-mode bypassPermissions)",
			default: false,
		}),
		telegram: Flags.boolean({
			description: "Enable Telegram channel (enabled by default when configured)",
			default: true,
			allowNo: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags, argv } = await this.parse(Relaunch);
		const extraClaudeArgs = argv as string[];
		const config = loadConfig();

		// Try to find the session — first by exact session name, then by project+path
		let session = findSession(args.target);
		if (!session) {
			session = findLatestSession(args.target, args.path);
		}

		if (!session) {
			this.error(
				`No session found for '${args.target}'${args.path ? ` with path '${args.path}'` : ""}. Run 'hyper hq status' to see active sessions.`,
			);
		}

		const { project, projectDir, workDir, sessionName: oldSessionName } = session;

		// Stop the old session if it's still running
		if (tmux.sessionExists(oldSessionName)) {
			log(`Stopping session '${oldSessionName}'...`);
			tmux.killSession(oldSessionName);
		}
		recordStop(oldSessionName);

		// Build new session
		const permissionMode = flags.yolo
			? "bypassPermissions"
			: (flags["permission-mode"] ?? config.claude.permission_mode);

		const newSessionName = sanitizeSessionName(`hq-${project}-${formatTimestamp()}`);

		if (!existsSync(workDir)) {
			this.error(`Working directory no longer exists: ${workDir}`);
		}

		mkdirSync(LOG_DIR, { recursive: true });

		const telegramEnv = flags.telegram ? getProjectTelegramEnv(project, config) : null;
		const channels: string[] = [];
		if (telegramEnv) channels.push(TELEGRAM_CHANNEL_PLUGIN);

		const logFile = resolve(LOG_DIR, `${newSessionName}.log`);

		const command = buildClaudeCommand({
			name: newSessionName,
			resume: true, // Always --continue for relaunch
			permissionMode,
			telegramBotToken: telegramEnv?.TELEGRAM_BOT_TOKEN,
			channels,
			extraArgs: extraClaudeArgs,
		});

		log(`Relaunching session for: ${project}`);
		log(`Working directory: ${workDir}`);

		tmux.createSession({ name: newSessionName, cwd: workDir, command, logFile });

		if (tmux.waitAndVerify(newSessionName) === "dead") {
			this.error(
				`Session '${newSessionName}' exited immediately after starting.
Check the log for details: ${logFile}`,
			);
		}
		tmux.disableRemainOnExit(newSessionName);

		recordLaunch({
			sessionName: newSessionName,
			project,
			path: session.path,
			projectDir,
			workDir,
			permissionMode,
			yolo: flags.yolo,
			telegram: flags.telegram,
			launchedAt: new Date().toISOString(),
			status: "running",
		});

		log("");
		log(`Session '${newSessionName}' started (continuing from '${oldSessionName}')`);
		log("Connect via:");
		log(`  Web:      claude.ai/code → find session '${newSessionName}'`);
		log(`  Terminal: hyper hq attach ${newSessionName}`);
		if (telegramEnv) {
			log(`  Telegram: Message the ${project} bot`);
		}
	}
}
