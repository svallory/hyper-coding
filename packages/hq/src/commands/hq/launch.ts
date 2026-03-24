import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Args, Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { listProjects, resolveProjectDir } from "#services/projects";
import { recordLaunch } from "#services/sessions";
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

export default class Launch extends BaseCommand<typeof Launch> {
	static override description = "Launch a Claude session for a project";

	static override examples = [
		"<%= config.bin %> hq launch my-project",
		"<%= config.bin %> hq launch my-project src/frontend",
		"<%= config.bin %> hq launch my-project src/frontend my-session",
		"<%= config.bin %> hq launch my-project --yolo",
		"<%= config.bin %> hq launch",
	];

	static override args = {
		project: Args.string({
			description: "Project name (under projects root) or absolute path",
			required: false,
		}),
		path: Args.string({
			description: "Relative path inside the project to use as working directory",
			required: false,
		}),
		"session-name": Args.string({
			description: "Custom session name (default: hq-<project>-MM-DD-HH-mm)",
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
		const { args, flags, argv } = await this.parse(Launch);
		const extraClaudeArgs = argv as string[];
		const config = loadConfig();

		let projectArg = args.project;

		// Interactive project selection if not provided
		if (!projectArg) {
			const projects = listProjects(config);
			if (projects.length === 0) {
				this.error(`No projects found in ${config.projects_root}`);
			}

			const selected = await p.select({
				message: "Select a project",
				options: projects.map((proj) => ({
					value: proj.name,
					label: proj.name,
					hint: proj.path,
				})),
				maxItems: 15,
			});

			if (p.isCancel(selected)) {
				this.error("Cancelled");
			}

			projectArg = selected;
		}

		const permissionMode = flags.yolo
			? "bypassPermissions"
			: (flags["permission-mode"] ?? config.claude.permission_mode);

		const projectDir = resolveProjectDir(projectArg, config);
		const projectName = projectArg.startsWith("/") ? basename(projectArg) : projectArg;

		if (!existsSync(projectDir)) {
			this.error(`Directory not found: ${projectDir}`);
		}

		let workDir = projectDir;
		if (args.path) {
			workDir = resolve(projectDir, args.path);
			if (!existsSync(workDir)) {
				this.error(`Path not found: ${workDir}`);
			}
		}

		const sessionName = sanitizeSessionName(
			args["session-name"] ?? `hq-${projectName}-${formatTimestamp()}`,
		);

		if (tmux.sessionExists(sessionName)) {
			log(
				`Session '${sessionName}' is already running. Use 'hyper hq attach ${sessionName}' to connect.`,
			);
			return;
		}

		mkdirSync(LOG_DIR, { recursive: true });

		const telegramEnv = flags.telegram ? getProjectTelegramEnv(projectName, config) : null;
		const channels: string[] = [];
		if (telegramEnv) channels.push(TELEGRAM_CHANNEL_PLUGIN);

		const logFile = resolve(LOG_DIR, `${sessionName}.log`);

		const command = buildClaudeCommand({
			name: sessionName,
			resume: false,
			permissionMode,
			telegramBotToken: telegramEnv?.TELEGRAM_BOT_TOKEN,
			channels,
			extraArgs: extraClaudeArgs,
		});

		log(`Launching Claude session for: ${projectName}`);
		log(`Working directory: ${workDir}`);

		tmux.createSession({ name: sessionName, cwd: workDir, command, logFile });

		if (tmux.waitAndVerify(sessionName) === "dead") {
			this.error(
				`Session '${sessionName}' exited immediately after starting.
Check the log for details: ${logFile}

Common causes:
  - Claude CLI is not authenticated (run: claude auth login)
  - The claude command is not found (check your PATH)
  - Telegram plugin not installed (run: claude plugin install telegram@claude-plugins-official)`,
			);
		}
		tmux.disableRemainOnExit(sessionName);

		// Record in session history
		recordLaunch({
			sessionName,
			project: projectName,
			path: args.path,
			projectDir,
			workDir,
			permissionMode,
			yolo: flags.yolo,
			telegram: flags.telegram,
			launchedAt: new Date().toISOString(),
			status: "running",
		});

		log("");
		log(`Session '${sessionName}' started`);
		log("Connect via:");
		log(`  Web:      claude.ai/code → find session '${sessionName}'`);
		log(`  Terminal: hyper hq attach ${sessionName}`);
		if (telegramEnv) {
			log(`  Telegram: Message the ${projectName} bot`);
		}
	}
}
