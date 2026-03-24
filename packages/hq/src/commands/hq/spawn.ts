import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { buildClaudeCommand } from "#services/claude";
import { createWorktree, findWorktreePath, resolveProjectDir } from "#services/projects";
import { getProjectTelegramEnv, TELEGRAM_CHANNEL_PLUGIN } from "#services/telegram";
import * as tmux from "#services/tmux";
import { sanitizeSessionName } from "#services/tmux";
import { log } from "#utils/log";
import { LOG_DIR } from "#utils/paths";

export default class Spawn extends BaseCommand<typeof Spawn> {
	static override description = "Spawn a new Claude session for a project";

	static override examples = [
		"<%= config.bin %> hq spawn my-project",
		"<%= config.bin %> hq spawn my-project --worktree feat-auth",
		"<%= config.bin %> hq spawn my-project --new-worktree feat-login",
		"<%= config.bin %> hq spawn /absolute/path/to/project",
		"<%= config.bin %> hq spawn my-project -- --dangerously-skip-permissions",
	];

	static override args = {
		project: Args.string({
			description: "Project name (under projects root) or absolute path",
			required: true,
		}),
	};

	// Allow extra args after -- to pass through to claude
	static override strict = false;

	static override flags = {
		...BaseCommand.baseFlags,
		worktree: Flags.string({ description: "Use an existing worktree (branch name)" }),
		"new-worktree": Flags.string({ description: "Create a new worktree via wt switch -c" }),
		"permission-mode": Flags.string({
			description: "Permission mode",
			options: ["default", "acceptEdits", "plan", "auto"],
		}),
		name: Flags.string({ description: "Custom session name" }),
		resume: Flags.boolean({
			description: "Resume the previous session for this project",
			default: false,
		}),
		yolo: Flags.boolean({
			description: "Skip all permission checks (alias for -- --dangerously-skip-permissions)",
			default: false,
		}),
		telegram: Flags.boolean({
			description: "Enable Telegram channel (enabled by default when configured)",
			default: true,
			allowNo: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags, argv } = await this.parse(Spawn);
		const extraClaudeArgs = argv as string[];
		const config = loadConfig();

		if (flags.yolo) {
			extraClaudeArgs.push("--dangerously-skip-permissions");
		}

		const projectDir = resolveProjectDir(args.project, config);
		const projectName = args.project.startsWith("/") ? basename(args.project) : args.project;

		if (!existsSync(projectDir)) {
			this.error(`Directory not found: ${projectDir}`);
		}

		let workDir = projectDir;
		let branchSuffix = "";

		if (flags["new-worktree"]) {
			log(`Creating worktree: ${flags["new-worktree"]}`);
			workDir = createWorktree(projectDir, flags["new-worktree"]);
			branchSuffix = `-${flags["new-worktree"].replace(/\//g, "-")}`;
			log(`Worktree created at: ${workDir}`);
		} else if (flags.worktree) {
			const wtPath = findWorktreePath(projectDir, flags.worktree);
			if (!wtPath) {
				this.error(`Worktree '${flags.worktree}' not found in ${projectDir}`);
			}
			workDir = wtPath;
			branchSuffix = `-${flags.worktree.replace(/\//g, "-")}`;
		}

		const sessionName = sanitizeSessionName(flags.name ?? `hq-${projectName}${branchSuffix}`);

		if (tmux.sessionExists(sessionName)) {
			log(
				`Session '${sessionName}' is already running. Use 'hyper hq attach ${projectName}' to connect.`,
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
			resume: flags.resume,
			permissionMode: flags["permission-mode"] ?? config.claude.permission_mode,
			telegramBotToken: telegramEnv?.TELEGRAM_BOT_TOKEN,
			channels,
			extraArgs: extraClaudeArgs,
			logFile,
		});

		log(`Spawning Claude session for: ${projectName}`);
		log(`Working directory: ${workDir}`);

		tmux.createSession({ name: sessionName, cwd: workDir, command });

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

		log("");
		log(`Session '${sessionName}' started`);
		log("Connect via:");
		log(`  Web:      claude.ai/code → find session '${sessionName}'`);
		log(`  Terminal: hyper hq attach ${projectName}`);
		if (telegramEnv) {
			log(`  Telegram: Message the ${projectName} bot`);
		}
	}
}
