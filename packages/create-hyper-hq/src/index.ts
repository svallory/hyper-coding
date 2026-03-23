import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
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

async function main(): Promise<void> {
	// Step 0: Welcome banner
	p.intro(pc.bold("create-hyper-hq"));

	p.note(
		"HQ is an always-on Claude Code command center that runs in a\n" +
			"tmux session. Once started, you can control it from claude.ai,\n" +
			"the Claude mobile app, or Telegram.\n\n" +
			"Let's make sure you have everything you need.",
		"Welcome to Hyper HQ Setup!",
	);

	// Step 1: Detect environment
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

	// Step 2: Check hyper CLI
	p.log.step("Checking for hyper CLI...");
	if (!isToolInstalled("hyper")) {
		await installOrWaitLoop({
			toolName: "hyper",
			toolUrl: "https://hyperdev.saulo.engineer/cli/install",
			description: "The hyper CLI is the main command-line tool for HyperDev.",
			options: getInstallOptions("hyper", installContext),
			checkFn: () => isToolInstalled("hyper"),
		});
	} else {
		const hyperRawVersion = getToolVersion("hyper");
		const hyperInstalled = hyperRawVersion ? parseSemver(hyperRawVersion) : null;
		const hyperLatest = getLatestNpmVersion("@hypercli/cli");

		if (hyperInstalled && hyperLatest && hyperInstalled !== hyperLatest) {
			p.log.warn(`hyper is installed (v${hyperInstalled}), but v${hyperLatest} is available.`);
			const updateChoice = await p.select<string>({
				message: "Would you like to update?",
				options: [
					{
						label: `Yes, update now  (${callingPm} install -g @hypercli/cli)`,
						value: "update",
					},
					{ label: "No, continue with current version", value: "skip" },
					{ label: "Cancel", value: "cancel" },
				],
			});

			if (p.isCancel(updateChoice) || updateChoice === "cancel") {
				p.cancel("Setup cancelled.");
				process.exit(0);
			}

			if (updateChoice === "update") {
				const updateArgs =
					callingPm === "yarn"
						? ["global", "add", "@hypercli/cli"]
						: ["install", "-g", "@hypercli/cli"];
				const updateResult = spawnSync(callingPm, updateArgs, {
					stdio: "inherit",
					encoding: "utf-8",
				});
				if (updateResult.status === 0) {
					p.log.success(`hyper updated to v${hyperLatest}.`);
				} else {
					p.log.warn("Update failed. Continuing with the installed version.");
				}
			} else {
				p.log.info(`Continuing with hyper v${hyperInstalled}.`);
			}
		} else {
			const versionSuffix = hyperInstalled ? ` (v${hyperInstalled})` : "";
			p.log.success(`hyper is installed${versionSuffix} ✓`);
		}
	}

	// Step 3: Check claude CLI
	p.log.step("Checking for Claude CLI...");
	if (!isToolInstalled("claude")) {
		await installOrWaitLoop({
			toolName: "claude",
			toolUrl: "https://claude.ai/code",
			description: "Claude Code is the AI coding assistant that powers HQ sessions.",
			options: getInstallOptions("claude", installContext),
			checkFn: () => isToolInstalled("claude"),
		});
	} else {
		const claudeRawVersion = getToolVersion("claude");
		const claudeInstalled = claudeRawVersion ? parseSemver(claudeRawVersion) : null;
		const claudeLatest = getLatestNpmVersion("@anthropic-ai/claude-code");

		if (claudeInstalled && claudeLatest && claudeInstalled !== claudeLatest) {
			p.log.warn(
				`Claude CLI is installed (v${claudeInstalled}), but v${claudeLatest} is available.`,
			);
			p.log.info(
				"Note: if you installed Claude via the native installer (curl), it auto-updates automatically.",
			);
			const updateChoice = await p.select<string>({
				message: "Would you like to update now?",
				options: [
					{
						label: `Yes, update via npm  (npm install -g @anthropic-ai/claude-code)`,
						value: "npm",
					},
					{ label: "Yes, update via brew  (brew upgrade claude-code)", value: "brew" },
					{ label: "No, continue with current version", value: "skip" },
					{ label: "Cancel", value: "cancel" },
				],
			});

			if (p.isCancel(updateChoice) || updateChoice === "cancel") {
				p.cancel("Setup cancelled.");
				process.exit(0);
			}

			if (updateChoice === "npm") {
				const updateResult = spawnSync("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
					stdio: "inherit",
					encoding: "utf-8",
				});
				if (updateResult.status === 0) {
					p.log.success(`Claude CLI updated to v${claudeLatest}.`);
				} else {
					p.log.warn("Update failed. Continuing with the installed version.");
				}
			} else if (updateChoice === "brew") {
				const updateResult = spawnSync("brew", ["upgrade", "claude-code"], {
					stdio: "inherit",
					encoding: "utf-8",
				});
				if (updateResult.status === 0) {
					p.log.success(`Claude CLI updated to v${claudeLatest}.`);
				} else {
					p.log.warn("Update failed. Continuing with the installed version.");
				}
			} else {
				p.log.info(`Continuing with Claude CLI v${claudeInstalled}.`);
			}
		} else {
			const versionSuffix = claudeInstalled ? ` (v${claudeInstalled})` : "";
			p.log.success(`Claude CLI is installed${versionSuffix} ✓`);
		}
	}

	// Step 4: Check tmux
	p.log.step("Checking for tmux...");
	if (platform.os === "windows") {
		p.log.warn("tmux is not available natively on Windows.");
		p.note(
			"tmux requires a Linux environment. HQ works inside WSL\n" +
				"(Windows Subsystem for Linux).\n\n" +
				"If you're running this from WSL, tmux can be installed with\n" +
				"your Linux distro's package manager.\n\n" +
				"If you're running this from Windows directly, please install\n" +
				"WSL first: " +
				pc.cyan("https://learn.microsoft.com/windows/wsl/install") +
				"\nThen re-run this setup from inside WSL.",
		);

		const wslChoice = await p.select<string>({
			message: "What would you like to do?",
			options: [
				{ label: "I'm in WSL, continue", value: "wsl" },
				{ label: "Cancel", value: "cancel" },
			],
		});

		if (p.isCancel(wslChoice) || wslChoice === "cancel") {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		// Re-detect as Linux
		const wslContext = {
			...installContext,
			os: "linux" as const,
		};

		if (!isToolInstalled("tmux")) {
			await installOrWaitLoop({
				toolName: "tmux",
				toolUrl: "https://github.com/tmux/tmux",
				description:
					"tmux is a terminal multiplexer that keeps HQ sessions running\nin the background, even after you close your terminal.",
				options: getInstallOptions("tmux", wslContext),
				checkFn: () => isToolInstalled("tmux"),
			});
		}
	} else if (!isToolInstalled("tmux")) {
		await installOrWaitLoop({
			toolName: "tmux",
			toolUrl: "https://github.com/tmux/tmux",
			description:
				"tmux is a terminal multiplexer that keeps HQ sessions running\nin the background, even after you close your terminal.",
			options: getInstallOptions("tmux", installContext),
			checkFn: () => isToolInstalled("tmux"),
		});
	} else {
		p.log.success("tmux is installed.");
	}

	// Step 5: Check claude authentication
	p.log.step("Checking Claude authentication...");
	if (!isClaudeAuthenticated()) {
		p.log.warn("Not authenticated with Claude.");
		p.log.message("  You need to log in to Claude to use HQ.");
		p.log.step("Running `claude auth login`...");

		const authSuccess = await runClaudeLogin();

		if (!authSuccess) {
			const retryOrSkip = await p.select<string>({
				message: "Authentication failed or was cancelled. What would you like to do?",
				options: [
					{ label: "Retry", value: "retry" },
					{ label: "Skip (HQ won't work without auth)", value: "skip" },
					{ label: "Cancel", value: "cancel" },
				],
			});

			if (p.isCancel(retryOrSkip) || retryOrSkip === "cancel") {
				p.cancel("Setup cancelled.");
				process.exit(0);
			}

			if (retryOrSkip === "retry") {
				p.log.step("Running `claude auth login`...");
				const retrySuccess = await runClaudeLogin();
				if (!retrySuccess) {
					p.log.warn(
						"Authentication still failed. Continuing setup — you can run `claude auth login` manually.",
					);
				} else {
					p.log.success("Claude authentication successful.");
				}
			} else {
				p.log.warn("Skipping authentication. HQ requires Claude auth to function properly.");
			}
		} else {
			p.log.success("Claude authentication successful.");
		}
	} else {
		p.log.success("Claude is authenticated.");
	}

	// Step 6: Config wizard
	p.log.step("Configuring HQ...");
	const config = await runConfigWizard();

	// Step 7: Trust workspaces + write CLAUDE.md
	p.log.step("Trusting workspace directories...");
	for (const dir of [config.hqDir, config.projectsRoot]) {
		if (!isWorkspaceTrusted(dir)) {
			trustWorkspace(dir);
			p.log.success(`Trusted ${dir}`);
		} else {
			p.log.info(`${dir} is already trusted`);
		}
	}

	// Generate CLAUDE.md
	p.log.step("Generating CLAUDE.md for HQ session...");
	const claudeMdPath = `${config.hqDir}/CLAUDE.md`;
	if (!existsSync(config.hqDir)) {
		mkdirSync(config.hqDir, { recursive: true });
	}
	writeFileSync(claudeMdPath, generateHqClaudeMd(config.projectsRoot), "utf-8");
	p.log.success(`${claudeMdPath} created`);

	// Step 8: All set!
	p.log.success("All set! HQ is ready to go.");

	const startNow = await p.select<string>({
		message: "Start HQ now?",
		options: [
			{ label: "Yes, start HQ", value: "yes" },
			{ label: "No, I'll start it later", value: "no" },
		],
	});

	if (p.isCancel(startNow)) {
		p.cancel("Setup cancelled.");
		process.exit(0);
	}

	p.log.message(`  (You can always run ${pc.cyan("`hyper hq start`")} to launch HQ)`);

	if (startNow === "yes") {
		p.log.step("Starting HQ...");
		const child = spawn("hyper", ["hq", "start"], {
			stdio: "inherit",
			detached: false,
		});

		await new Promise<void>((resolve) => {
			child.on("close", () => resolve());
			child.on("error", (err) => {
				p.log.error(`Failed to start HQ: ${err.message}`);
				resolve();
			});
		});
	}

	p.outro(pc.green("Hyper HQ setup complete!"));
}

main().catch((err) => {
	if (err instanceof Error && err.message === "User force closed the prompt with CTRL+C") {
		process.stdout.write("\nSetup cancelled.\n");
		process.exit(0);
	}
	console.error(err);
	process.exit(1);
});
