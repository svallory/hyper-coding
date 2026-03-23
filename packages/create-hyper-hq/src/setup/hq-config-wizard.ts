import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import * as p from "@clack/prompts";

export interface HqConfigResult {
	projectsRoot: string;
	hqDir: string;
	telegramToken?: string;
}

const CONFIG_PATH = resolve(homedir(), ".config", "hyper", "hq.toml");

function expandHome(path: string): string {
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

export async function runConfigWizard(): Promise<HqConfigResult> {
	// Step 1: Projects root
	const projectsRootRaw = await p.text({
		message: "Where are your projects?",
		placeholder: "~/work",
		defaultValue: "~/work",
		validate(value) {
			if (!value?.trim()) return "Please enter a path";
			return undefined;
		},
	});

	if (p.isCancel(projectsRootRaw)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const projectsRoot = expandHome(projectsRootRaw as string);

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
		validate(value) {
			if (!value?.trim()) return "Please enter a path";
			return undefined;
		},
	});

	if (p.isCancel(hqDirRaw)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	const hqDirInput = hqDirRaw as string;
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
	}

	// Build TOML config (using expanded absolute paths)
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
