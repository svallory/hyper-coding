import { Args } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import * as tmux from "#services/tmux";
import { log } from "#utils/log";

export default class Stop extends BaseCommand<typeof Stop> {
	static override description = "Stop an HQ session";

	static override examples = ["<%= config.bin %> hq stop", "<%= config.bin %> hq stop my-project"];

	static override args = {
		session: Args.string({
			description: "Session name or project name (default: hyper-hq)",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Stop);
		let target = args.session ?? "hyper-hq";

		if (!target.startsWith("hq")) {
			target = `hq-${target}`;
		}

		if (tmux.killSession(target)) {
			log(`Stopped session: ${target}`);
		} else {
			this.error(`Session '${target}' not found`);
		}
	}
}
