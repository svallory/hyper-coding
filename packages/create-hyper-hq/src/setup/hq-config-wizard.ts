import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import * as p from "@clack/prompts";
import { installPlugin, isPluginInstalled } from "../checks/check-claude-plugins.js";

export interface HqConfigResult {
	projectsRoot: string;
	hqDir: string;
	telegramToken?: string;
}

const HOME = homedir();
const CONFIG_PATH = resolve(HOME, ".config", "hyper", "hq.toml");
const TELEGRAM_CHANNEL_DIR = resolve(HOME, ".claude", "channels", "telegram");

/**
 * If the user typed a path starting with `~/`, expand it to their home
 * directory — unless a literal `~` folder exists in cwd, in which case
 * ask them to disambiguate.
 */
export async function resolveTilde(raw: string): Promise<string> {
	if (!raw.startsWith("~/") && raw !== "~") return raw;

	const expanded = resolve(HOME, raw.slice(2) || "");

	// Only disambiguate if a literal `~` folder exists in cwd
	if (!existsSync(resolve("~"))) return expanded;

	const literal = resolve(raw);

	const choice = await p.select({
		message: `There's a folder named "~" in the current directory. Which path did you mean?`,
		options: [
			{ label: expanded, value: "expand" as const, hint: "home directory" },
			{ label: literal, value: "literal" as const, hint: "literal ~ folder" },
		],
	});

	if (p.isCancel(choice)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	return choice === "expand" ? expanded : literal;
}

/**
 * Write the Telegram bot token to ~/.claude/channels/telegram/.env
 * This is what `/telegram:configure <token>` does internally.
 */
export function writeTelegramPluginConfig(token: string): void {
	mkdirSync(TELEGRAM_CHANNEL_DIR, { recursive: true });
	const envPath = resolve(TELEGRAM_CHANNEL_DIR, ".env");
	writeFileSync(envPath, `TELEGRAM_BOT_TOKEN=${token}\n`, { encoding: "utf-8", mode: 0o600 });
	chmodSync(envPath, 0o600);
}

/**
 * Prompt for and resolve the projects root directory.
 * If opts.current is set, it is shown as the default with a "(current)" hint.
 */
export async function configureProjectsRoot(opts?: { current?: string }): Promise<string> {
	const defaultValue = opts?.current ?? resolve(HOME, "projects");
	const placeholder = opts?.current ? `${opts.current} (current)` : defaultValue;

	const projectsRootRaw = await p.text({
		message: "Where are your projects?",
		placeholder,
		defaultValue,
	});

	if (p.isCancel(projectsRootRaw)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const projectsRoot = await resolveTilde(projectsRootRaw as string);

	// Ensure directory exists
	if (!existsSync(projectsRoot)) {
		const create = await p.confirm({
			message: `Directory ${projectsRoot} doesn't exist. Create it?`,
			initialValue: true,
		});
		if (p.isCancel(create) || !create) {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}
		mkdirSync(projectsRoot, { recursive: true });
		p.log.success(`Created ${projectsRoot}`);
	}

	return projectsRoot;
}

/**
 * Prompt for and resolve the HQ working directory.
 * Resolved relative to projectsRoot if not absolute.
 * If opts.current is set, it is shown as the default.
 */
export async function configureHqDir(opts: {
	projectsRoot: string;
	current?: string;
}): Promise<string> {
	const defaultValue = opts.current ?? "./hyper-hq";
	const placeholder = opts.current ? `${opts.current} (current)` : "./hyper-hq";

	const hqDirRaw = await p.text({
		message: "HQ working directory (relative to projects root)?",
		placeholder,
		defaultValue,
	});

	if (p.isCancel(hqDirRaw)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const hqDirInput = await resolveTilde(hqDirRaw as string);
	const hqDir = hqDirInput.startsWith("/") ? hqDirInput : resolve(opts.projectsRoot, hqDirInput);

	if (!existsSync(hqDir)) {
		mkdirSync(hqDir, { recursive: true });
		p.log.success(`Created HQ directory: ${hqDir}`);
	}

	return hqDir;
}

/**
 * Configure Telegram integration.
 * If opts.currentToken exists, asks the user whether to reconfigure.
 * Returns the token if enabled, undefined if disabled.
 */
export async function configureTelegram(opts?: {
	currentToken?: string;
}): Promise<{ token?: string }> {
	// If already configured, ask whether to reconfigure
	if (opts?.currentToken) {
		p.log.info("Telegram is currently configured.");

		const reconfigure = await p.confirm({
			message: "Do you want to reconfigure Telegram?",
			initialValue: false,
		});

		if (p.isCancel(reconfigure)) {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (!reconfigure) {
			return { token: opts.currentToken };
		}
	}

	const useTelegram = await p.confirm({
		message: "Enable Telegram integration?",
		initialValue: false,
	});

	if (p.isCancel(useTelegram)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	if (!useTelegram) {
		return { token: undefined };
	}

	const TELEGRAM_PLUGIN = "telegram@claude-plugins-official";

	// Check if the Telegram channel plugin is installed
	const pluginInstalled = isPluginInstalled(TELEGRAM_PLUGIN);

	if (!pluginInstalled) {
		p.log.warn("The Telegram channel plugin is not installed in Claude Code.");

		const doInstall = await p.confirm({
			message: "Install the Telegram plugin now?",
			initialValue: true,
		});

		if (p.isCancel(doInstall)) {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (doInstall) {
			p.log.step("Installing Telegram plugin...");
			const success = installPlugin(TELEGRAM_PLUGIN);
			if (success) {
				p.log.success("Telegram plugin installed");
			} else {
				p.log.warn(
					"Plugin installation failed. You can install it later with:\n" +
						"  claude plugin install telegram@claude-plugins-official",
				);
			}
		} else {
			p.log.info(
				"You'll need to install the plugin before using Telegram:\n" +
					"  claude plugin install telegram@claude-plugins-official",
			);
		}
	} else {
		p.log.success("Telegram channel plugin is installed");
	}

	p.note(
		"1. Open Telegram and message @BotFather\n" +
			"2. Send /newbot and follow the prompts\n" +
			"3. Copy the token BotFather gives you",
		"Create a Telegram bot",
	);

	const token = await p.text({
		message: "Paste your Telegram bot token:",
		placeholder: "your-bot-token-from-botfather",
		validate(value) {
			if (!value?.trim()) return "Please enter a token";
			if (!value?.includes(":"))
				return "That doesn't look like a bot token (should contain a colon)";
			return undefined;
		},
	});

	if (p.isCancel(token)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const telegramToken = token as string;

	// Write token to the plugin's config location
	writeTelegramPluginConfig(telegramToken);
	p.log.success("Bot token saved to Claude Code plugin config");

	return { token: telegramToken };
}

/**
 * Generate TOML config and write to ~/.config/hyper/hq.toml with mode 0o600.
 */
export async function writeHqConfig(values: {
	projectsRoot: string;
	hqDir: string;
	telegramToken?: string;
}): Promise<void> {
	const { projectsRoot, hqDir, telegramToken } = values;

	const lines: string[] = [
		"# Hyper HQ — Claude Code Command Center",
		"",
		`projects_root = "${projectsRoot}"`,
		"",
		"[hq]",
		'name = "Hyper HQ"',
		`dir = "${hqDir}"`,
		'spawn_mode = "same-dir"',
		"capacity = 32",
		"",
		"[claude]",
		'permission_mode = "default"',
		"",
		"[telegram]",
	];

	if (telegramToken) {
		lines.push(`hq_bot_token = "${telegramToken}"`);
	} else {
		lines.push("# Telegram is disabled. To enable later, add:");
		lines.push('# hq_bot_token = "YOUR_BOT_TOKEN"');
	}

	lines.push(
		"",
		"[telegram.project_bots]",
		"# Add dedicated bots for specific projects:",
		'# my-project = "BOT_TOKEN"',
		"",
		"# [projects.my-org]",
		'# type = "group"	# Treat subfolders as separate projects',
		"",
	);

	const configContent = lines.join("\n");

	// Write config with mode 0o600
	const configDir = dirname(CONFIG_PATH);
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	writeFileSync(CONFIG_PATH, configContent, { encoding: "utf-8", mode: 0o600 });
	chmodSync(CONFIG_PATH, 0o600);

	p.log.success(`Config saved to ${CONFIG_PATH} (mode 0600)`);
}

/**
 * Orchestrator: runs all configuration steps in sequence and writes the config file.
 */
export async function runConfigWizard(opts?: {
	existing?: Partial<HqConfigResult>;
}): Promise<HqConfigResult> {
	const existing = opts?.existing;

	const projectsRoot = await configureProjectsRoot({ current: existing?.projectsRoot });
	const hqDir = await configureHqDir({ projectsRoot, current: existing?.hqDir });
	const { token: telegramToken } = await configureTelegram({
		currentToken: existing?.telegramToken,
	});

	await writeHqConfig({ projectsRoot, hqDir, telegramToken });

	return { projectsRoot, hqDir, telegramToken };
}
