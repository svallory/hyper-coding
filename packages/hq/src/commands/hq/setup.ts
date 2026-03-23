import { spawnSync } from "node:child_process";
import { Command } from "@oclif/core";
import { runSetup } from "../../config/setup.js";

export default class Setup extends Command {
	static override description = "Set up HQ — check dependencies and configure";
	static override examples = ["<%= config.bin %> <%= command.id %>"];

	async run(): Promise<void> {
		// Check tmux
		const tmux = spawnSync("which", ["tmux"], { encoding: "utf-8" });
		if (tmux.status !== 0) {
			this.warn("tmux is not installed. HQ requires tmux to manage sessions.");
			this.log("  Install: https://github.com/tmux/tmux/wiki/Installing");
		}

		// Check claude
		const claude = spawnSync("which", ["claude"], { encoding: "utf-8" });
		if (claude.status !== 0) {
			this.warn("Claude CLI is not installed. HQ requires claude to run sessions.");
			this.log("  Install: https://claude.ai/code");
		}

		// Check claude auth
		if (claude.status === 0) {
			const auth = spawnSync("claude", ["auth", "status"], {
				encoding: "utf-8",
			});
			if (auth.status !== 0) {
				this.log("\nClaude is not authenticated. Running 'claude auth login'...\n");
				spawnSync("claude", ["auth", "login"], { stdio: "inherit" });
			}
		}

		// Run config wizard (force mode — always run even if config exists)
		await runSetup(true);

		// Offer to start HQ
		const { confirm } = await import("@clack/prompts");
		const startNow = await confirm({ message: "Start HQ now?" });
		if (startNow === true) {
			spawnSync("hyper", ["hq", "start"], { stdio: "inherit" });
		} else {
			this.log("\nRun 'hyper hq start' whenever you're ready.");
		}
	}
}
