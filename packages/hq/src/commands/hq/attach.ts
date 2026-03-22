import { execFileSync } from "node:child_process";
import { Args } from "@oclif/core";
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
			description: "Session name or project name (default: hyper-hq)",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Attach);
		let target = args.session ?? "hyper-hq";

		if (!target.startsWith("hq")) {
			target = `hq-${target}`;
		}

		if (!tmux.sessionExists(target)) {
			this.error(`Session '${target}' not found. Run 'hyper hq status' to see active sessions.`);
		}

		execFileSync("tmux", ["attach", "-t", target], { stdio: "inherit" });
	}
}
