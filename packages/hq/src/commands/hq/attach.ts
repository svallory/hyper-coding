import { execFileSync } from "node:child_process";
import { Args } from "@oclif/core";
import { configExists, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import * as tmux from "#services/tmux";

export default class Attach extends BaseCommand<typeof Attach> {
	static override description = "Attach to an HQ tmux session";

	static override examples = [
		"<%= config.bin %> hq attach",
		"<%= config.bin %> hq attach my-project",
	];

	static override args = {
		session: Args.string({
			description: "Session name or project name (default: HQ session from config)",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Attach);
		let target = args.session;

		if (!target) {
			// Use the configured HQ session name
			target = configExists() ? loadConfig().hq.name : "Hyper HQ";
		} else if (!target.startsWith("hq") && !target.startsWith("Hyper")) {
			target = `hq-${target}`;
		}

		if (!tmux.sessionExists(target)) {
			this.error(`Session '${target}' not found. Run 'hyper hq status' to see active sessions.`);
		}

		execFileSync("tmux", ["attach", "-t", target], { stdio: "inherit" });
	}
}
