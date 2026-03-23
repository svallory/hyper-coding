import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import * as p from "@clack/prompts";
import { isWorkspaceTrusted, trustWorkspace } from "../utils/trust.js";
import { CONFIG_PATH, configExists, loadConfig } from "./index.js";
import type { HqConfig } from "./schema.js";

function expandHome(path: string): string {
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

export async function runSetup(force = false): Promise<HqConfig> {
	if (!force && configExists()) {
		return loadConfig();
	}

	p.intro("Welcome to Hyper HQ — Claude Code Command Center");

	p.note(
		"No configuration file found.\n" + "Let's get you set up. This will only take a moment.",
		"First-time setup",
	);

	// Step 1: Projects root
	const projectsRoot = await p.text({
		message: "Where do your projects live?",
		placeholder: "~/work",
		defaultValue: "~/work",
		validate(value) {
			if (!value?.trim()) return "Please enter a path";
			return undefined;
		},
	});

	if (p.isCancel(projectsRoot)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const expandedRoot = expandHome(projectsRoot);

	// Step 2: Ensure directory exists
	if (!existsSync(expandedRoot)) {
		const create = await p.confirm({
			message: `Directory ${expandedRoot} doesn't exist. Create it?`,
			initialValue: true,
		});
		if (p.isCancel(create) || !create) {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}
		mkdirSync(expandedRoot, { recursive: true });
		p.log.success(`Created ${expandedRoot}`);
	}

	// Step 3: HQ directory
	const hqDir = await p.text({
		message: "Where should the HQ session folder live?",
		placeholder: "./hyper-hq",
		defaultValue: "./hyper-hq",
		validate(value) {
			if (!value?.trim()) return "Please enter a path";
			return undefined;
		},
	});

	if (p.isCancel(hqDir)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	// Resolve hq dir relative to projects root
	const expandedHqDir = hqDir.startsWith("/") ? hqDir : resolve(expandedRoot, hqDir);

	if (!existsSync(expandedHqDir)) {
		mkdirSync(expandedHqDir, { recursive: true });
		p.log.success(`Created HQ directory: ${expandedHqDir}`);
	}

	// Step 4: Workspace trust — auto-trust both HQ dir and projects root
	for (const dir of [expandedHqDir, expandedRoot]) {
		if (!isWorkspaceTrusted(dir)) {
			trustWorkspace(dir);
			p.log.success(`Trusted ${dir} for Claude Code.`);
		}
	}

	// Step 5: Telegram
	const useTelegram = await p.confirm({
		message: "Do you want to enable Telegram integration?",
		initialValue: false,
	});

	if (p.isCancel(useTelegram)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	let hqBotToken = "";

	if (useTelegram) {
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

		hqBotToken = token;
	}

	// Build TOML config
	const lines: string[] = [
		"# Hyper HQ — Claude Code Command Center",
		"",
		`projects_root = "${projectsRoot}"`,
		"",
		"[hq]",
		'name = "hyper-hq"',
		`dir = "${hqDir}"`,
		'spawn_mode = "same-dir"',
		"capacity = 32",
		"",
		"[claude]",
		'permission_mode = "default"',
		"",
		"[telegram]",
	];

	if (hqBotToken) {
		lines.push(`hq_bot_token = "${hqBotToken}"`);
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

	// Write config
	const configDir = dirname(CONFIG_PATH);
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	writeFileSync(CONFIG_PATH, configContent, { encoding: "utf-8", mode: 0o600 });
	chmodSync(CONFIG_PATH, 0o600);

	p.note(CONFIG_PATH, "Config saved to");

	if (!useTelegram) {
		p.log.info(
			"Telegram is disabled. Sessions will use Remote Control only (claude.ai/code + mobile).",
		);
		p.log.info("You can enable Telegram later by adding a bot token to your config file.");
	}

	return loadConfig();
}

// Backwards compat — start.ts calls this
export const runSetupIfNeeded = () => runSetup(false);
