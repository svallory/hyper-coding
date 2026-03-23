import * as p from "@clack/prompts";
import pc from "picocolors";
import type { InstallOption } from "../install/install-options.js";
import { runInstallCommand } from "../install/run-install.js";

export interface InstallOrWaitLoopOptions {
	toolName: string;
	toolUrl: string;
	description: string;
	options: InstallOption[];
	checkFn: () => boolean;
}

export async function installOrWaitLoop(opts: InstallOrWaitLoopOptions): Promise<void> {
	const { toolName, toolUrl, description, options, checkFn } = opts;

	// Already installed — nothing to do
	if (checkFn()) {
		p.log.success(`${toolName} is already installed.`);
		return;
	}

	p.log.warn(`${toolName} is not installed.`);
	p.log.message(`  ${description}\n  ${pc.cyan(toolUrl)}`);

	while (true) {
		const choice = await p.select<string>({
			message: `How would you like to install ${toolName}?`,
			options: options.map((opt) => ({
				label: opt.label,
				value: opt.value,
				hint: opt.hint,
			})),
		});

		if (p.isCancel(choice)) {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (choice === "cancel") {
			p.cancel("Setup cancelled.");
			process.exit(0);
		}

		if (choice === "manual") {
			p.log.message(`  Take your time! Here are some resources:\n  ${pc.cyan(toolUrl)}`);

			while (true) {
				const proceed = await p.select<string>({
					message: "Ready to continue?",
					options: [
						{ label: "Continue", value: "continue" },
						{ label: "Cancel", value: "cancel" },
					],
				});

				if (p.isCancel(proceed) || proceed === "cancel") {
					p.cancel("Setup cancelled.");
					process.exit(0);
				}

				if (checkFn()) {
					p.log.success(`Found ${toolName}!`);
					return;
				}

				p.log.warn(
					`Hmm, I still can't find ${pc.bold(`\`${toolName}\``)} on your PATH.\n  Installation guide: ${pc.cyan(toolUrl)}`,
				);
				// Loop back to ask again
			}
		}

		// Auto-install: find the matching option
		const selectedOption = options.find((o) => o.value === choice);
		if (!selectedOption || !selectedOption.command) {
			p.log.error("Unknown option selected.");
			continue;
		}

		p.log.step(`Running: ${selectedOption.label.split("  ")[0]}`);
		const result = runInstallCommand(selectedOption);

		if (result.success) {
			// Re-check after install (using login shell)
			if (checkFn()) {
				p.log.success(`${toolName} installed successfully!`);
				return;
			}

			p.log.warn(
				`Install command succeeded but ${pc.bold(`\`${toolName}\``)} is still not found on PATH.\n  You may need to open a new terminal. The tool should be available after that.`,
			);
		} else {
			p.log.error(`Installation failed: ${result.error ?? "unknown error"}`);
			p.log.message(
				`  You may need to open a new terminal or install manually:\n  ${pc.cyan(toolUrl)}`,
			);
		}

		// Re-offer options (loop continues)
	}
}
