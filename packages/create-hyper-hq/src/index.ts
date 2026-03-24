import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

const PKG_VERSION: string = JSON.parse(
	readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf-8"),
).version;

import { isClaudeAuthenticated, runClaudeLogin } from "./checks/check-claude-auth.js";
import {
	getLatestNpmVersion,
	getToolVersion,
	isToolInstalled,
	parseSemver,
} from "./checks/check-tool.js";
import { detectPlatform, detectSystemPms } from "./checks/detect-os.js";
import { detectAvailableNodePms, detectCallingPm } from "./checks/detect-pm.js";
import { getInstallOptions } from "./install/install-options.js";
import { generateHqClaudeMd } from "./setup/claude-md.js";
import { runConfigWizard } from "./setup/hq-config-wizard.js";
import { isWorkspaceTrusted, trustWorkspace } from "./setup/workspace-trust.js";
import { installOrWaitLoop } from "./ui/prompts.js";

function phase(step: number, total: number, title: string, prevOutro?: string): void {
	if (prevOutro) p.outro(prevOutro);
	p.intro(pc.bold(`${step} of ${total}: ${title}`));
}

async function checkAndUpdateTool(
	name: string,
	npmPackage: string,
	callingPm: string,
): Promise<void> {
	const rawVersion = getToolVersion(name);
	const installed = rawVersion ? parseSemver(rawVersion) : null;
	const latest = getLatestNpmVersion(npmPackage);

	if (installed && latest && installed !== latest) {
		p.log.warn(`${name} is installed (v${installed}), but v${latest} is available.`);

		if (name === "claude") {
			p.log.info("  Note: if you installed via the native installer (curl), it auto-updates.");
		}

		const updateChoice = await p.select({
			message: "Would you like to update?",
			options:
				name === "claude"
					? [
							{
								label: `Yes, update via npm  (npm install -g ${npmPackage})`,
								value: "npm" as const,
							},
							{
								label: "Yes, update via brew  (brew upgrade claude-code)",
								value: "brew" as const,
							},
							{ label: "No, continue with current version", value: "skip" as const },
							{ label: "Cancel", value: "cancel" as const },
						]
					: [
							{
								label: `Yes, update now  (${callingPm} install -g ${npmPackage})`,
								value: "update" as const,
							},
							{ label: "No, continue with current version", value: "skip" as const },
							{ label: "Cancel", value: "cancel" as const },
						],
		});

		if (p.isCancel(updateChoice) || updateChoice === "cancel") {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (updateChoice === "skip") {
			p.log.info(`Continuing with ${name} v${installed}.`);
			return;
		}

		let cmd: string;
		let args: string[];
		if (updateChoice === "brew") {
			cmd = "brew";
			args = ["upgrade", "claude-code"];
		} else if (updateChoice === "npm") {
			cmd = "npm";
			args = ["install", "-g", npmPackage];
		} else {
			cmd = callingPm;
			args = callingPm === "yarn" ? ["global", "add", npmPackage] : ["install", "-g", npmPackage];
		}

		const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf-8" });
		if (result.status === 0) {
			p.log.success(`${name} updated to v${latest}`);
		} else {
			p.log.warn("Update failed. Continuing with the installed version.");
			if (result.stderr) p.log.message(pc.dim(result.stderr.trim()));
		}
	} else {
		const v = installed ? ` (v${installed})` : "";
		p.log.success(`${name} is installed${v}`);
	}
}

async function main(): Promise<void> {
	const TOTAL_PHASES = 3;

	// ─── Welcome ───
	p.intro(pc.bold(`create-hyper-hq`) + pc.dim(` v${PKG_VERSION}`));

	p.note(
		"HQ is an always-on Claude Code command center that runs in a\n" +
			"tmux session. Once started, you can control it from claude.ai,\n" +
			"the Claude mobile app, or Telegram.\n\n" +
			"We'll get you set up in 3 quick steps.",
		"Welcome to Hyper HQ!",
	);

	// ─── Phase 1: Dependency checks ───
	phase(1, TOTAL_PHASES, "Making sure you have the essentials");

	const platform = detectPlatform();
	const systemPms = detectSystemPms();
	const callingPm = detectCallingPm();
	const availableNodePms = detectAvailableNodePms();

	const installContext = {
		callingPm,
		availableNodePms,
		systemPms,
		os: platform.os,
		isRoot: platform.isRoot,
	};

	// Check hyper CLI
	p.log.message(`  ${pc.dim("hyper CLI")}`);
	if (!isToolInstalled("hyper")) {
		await installOrWaitLoop({
			toolName: "hyper",
			toolUrl: "https://hyperdev.saulo.engineer/cli/install",
			description: "The hyper CLI is the main command-line tool for HyperDev.",
			options: getInstallOptions("hyper", installContext),
			checkFn: () => isToolInstalled("hyper"),
		});
	} else {
		await checkAndUpdateTool("hyper", "@hypercli/cli", callingPm);
	}

	// Check Claude CLI
	p.log.message(`  ${pc.dim("Claude Code CLI")}`);
	if (!isToolInstalled("claude")) {
		await installOrWaitLoop({
			toolName: "claude",
			toolUrl: "https://claude.ai/code",
			description: "Claude Code is the AI coding assistant that powers HQ sessions.",
			options: getInstallOptions("claude", installContext),
			checkFn: () => isToolInstalled("claude"),
		});
	} else {
		await checkAndUpdateTool("claude", "@anthropic-ai/claude-code", callingPm);
	}

	// Check tmux
	p.log.message(`  ${pc.dim("tmux")}`);
	if (platform.os === "windows") {
		p.log.warn("tmux is not available natively on Windows.");
		p.note(
			"tmux requires a Linux environment. HQ works inside WSL\n" +
				"(Windows Subsystem for Linux).\n\n" +
				"If you're running this from Windows directly, install WSL first:\n" +
				pc.cyan("https://learn.microsoft.com/windows/wsl/install") +
				"\nThen re-run this setup from inside WSL.",
		);

		const wslChoice = await p.select({
			message: "What would you like to do?",
			options: [
				{ label: "I'm in WSL, continue", value: "wsl" as const },
				{ label: "Cancel", value: "cancel" as const },
			],
		});

		if (p.isCancel(wslChoice) || wslChoice === "cancel") {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (!isToolInstalled("tmux")) {
			await installOrWaitLoop({
				toolName: "tmux",
				toolUrl: "https://github.com/tmux/tmux",
				description:
					"tmux keeps HQ sessions running in the background,\neven after you close your terminal.",
				options: getInstallOptions("tmux", { ...installContext, os: "linux" }),
				checkFn: () => isToolInstalled("tmux"),
			});
		}
	} else if (!isToolInstalled("tmux")) {
		await installOrWaitLoop({
			toolName: "tmux",
			toolUrl: "https://github.com/tmux/tmux",
			description:
				"tmux keeps HQ sessions running in the background,\neven after you close your terminal.",
			options: getInstallOptions("tmux", installContext),
			checkFn: () => isToolInstalled("tmux"),
		});
	} else {
		p.log.success("tmux is installed");
	}

	// Check Claude auth
	p.log.message(`  ${pc.dim("Claude authentication")}`);
	if (!isClaudeAuthenticated()) {
		p.log.warn("Not authenticated with Claude yet.");
		p.log.step("Opening Claude login...");

		const authSuccess = await runClaudeLogin();

		if (!authSuccess) {
			const retryOrSkip = await p.select({
				message: "Auth didn't go through. What now?",
				options: [
					{ label: "Try again", value: "retry" as const },
					{ label: "Skip for now (HQ won't work without auth)", value: "skip" as const },
					{ label: "Cancel", value: "cancel" as const },
				],
			});

			if (p.isCancel(retryOrSkip) || retryOrSkip === "cancel") {
				p.cancel("Setup cancelled.");
				process.exit(0);
			}

			if (retryOrSkip === "retry") {
				const retrySuccess = await runClaudeLogin();
				if (retrySuccess) {
					p.log.success("Authenticated with Claude");
				} else {
					p.log.warn("Still no luck. You can run `claude auth login` later.");
				}
			} else {
				p.log.warn("Skipping auth — remember to run `claude auth login` before starting HQ.");
			}
		} else {
			p.log.success("Authenticated with Claude");
		}
	} else {
		p.log.success("Claude is authenticated");
	}

	// ─── Phase 2: Configuration ───
	phase(2, TOTAL_PHASES, "Pick your settings", "You're all set on prerequisites!");

	const config = await runConfigWizard();

	// ─── Phase 3: Finishing touches ───
	phase(3, TOTAL_PHASES, "Setting everything up", "Settings saved!");

	// Trust workspaces
	for (const dir of [config.hqDir, config.projectsRoot]) {
		if (!isWorkspaceTrusted(dir)) {
			trustWorkspace(dir);
			p.log.success(`Trusted ${dir}`);
		}
	}

	// Generate CLAUDE.md
	const claudeMdPath = `${config.hqDir}/CLAUDE.md`;
	if (!existsSync(config.hqDir)) {
		mkdirSync(config.hqDir, { recursive: true });
	}
	writeFileSync(claudeMdPath, generateHqClaudeMd(config.projectsRoot), "utf-8");
	p.log.success(`Created ${claudeMdPath}`);

	p.outro(pc.green("All set! HQ is ready to go."));

	const nextSteps = [`Run ${pc.cyan("hyper hq start")} to launch HQ.`];

	if (config.telegramToken) {
		nextSteps.push(
			"",
			`${pc.bold("Telegram pairing")} — after HQ starts:`,
			`  1. Message your bot on Telegram — it will reply with a pairing code`,
			`  2. Connect to HQ via ${pc.cyan("claude.ai/code")} and tell it the code`,
			`     HQ will handle the rest automatically`,
		);
	}

	p.note(nextSteps.join("\n"), "Next steps");
}

main().catch((err) => {
	if (err instanceof Error && err.message === "User force closed the prompt with CTRL+C") {
		process.stdout.write("\nSetup cancelled.\n");
		process.exit(0);
	}
	console.error(err);
	process.exit(1);
});
