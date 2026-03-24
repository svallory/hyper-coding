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
async function resolveTilde(raw: string): Promise<string> {
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
function writeTelegramPluginConfig(token: string): void {
	mkdirSync(TELEGRAM_CHANNEL_DIR, { recursive: true });
	const envPath = resolve(TELEGRAM_CHANNEL_DIR, ".env");
	writeFileSync(envPath, `TELEGRAM_BOT_TOKEN=${token}\n`, { encoding: "utf-8", mode: 0o600 });
	chmodSync(envPath, 0o600);
}

export async function runConfigWizard(): Promise<HqConfigResult> {
	const defaultProjectsRoot = resolve(HOME, "projects");

	// Step 1: Projects root
	const projectsRootRaw = await p.text({
		message: "Where are your projects?",
		placeholder: defaultProjectsRoot,
		defaultValue: defaultProjectsRoot,
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

	// Step 2: HQ working directory
	const hqDirRaw = await p.text({
		message: "HQ working directory (relative to projects root)?",
		placeholder: "./hyper-hq",
		defaultValue: "./hyper-hq",
	});

	if (p.isCancel(hqDirRaw)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const hqDirInput = await resolveTilde(hqDirRaw as string);
	const hqDir = hqDirInput.startsWith("/") ? hqDirInput : resolve(projectsRoot, hqDirInput);

	if (!existsSync(hqDir)) {
		mkdirSync(hqDir, { recursive: true });
		p.log.success(`Created HQ directory: ${hqDir}`);
	}

	// Step 3: Telegram integration
	const useTelegram = await p.confirm({
		message: "Enable Telegram integration?",
		initialValue: false,
	});

	if (p.isCancel(useTelegram)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	let telegramToken: string | undefined;

	if (useTelegram) {
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

		telegramToken = token as string;

		// Write token to the plugin's config location
		writeTelegramPluginConfig(telegramToken);
		p.log.success("Bot token saved to Claude Code plugin config");
	}

	// Build TOML config (using expanded absolute paths)
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

	return { projectsRoot, hqDir, telegramToken };
}
