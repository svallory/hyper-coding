import { Args } from "@oclif/core";
import { configExists, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { recordStop } from "#services/sessions";
import * as tmux from "#services/tmux";
import { log } from "#utils/log";

export default class Stop extends BaseCommand<typeof Stop> {
	static override description = "Stop an HQ session";

	static override examples = ["<%= config.bin %> hq stop", "<%= config.bin %> hq stop my-project"];

	static override args = {
		session: Args.string({
			description: "Session name or project name (default: HQ session from config)",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Stop);
		let target = args.session;

		if (!target) {
			target = configExists() ? loadConfig().hq.name : "Hyper HQ";
		} else if (!target.startsWith("hq") && !target.startsWith("Hyper")) {
			target = `hq-${target}`;
		}

		if (tmux.killSession(target)) {
			recordStop(target);
			log(`Stopped session: ${target}`);
		} else {
			this.error(`Session '${target}' not found`);
		}
	}
}
