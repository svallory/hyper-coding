import { Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import * as tmux from "#services/tmux";

export default class Status extends BaseCommand<typeof Status> {
	static override description = "Show running HQ sessions";

	static override examples = ["<%= config.bin %> hq status", "<%= config.bin %> hq status --json"];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({ description: "Output as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Status);
		const sessions = tmux.listSessions("hq");

		if (flags.json) {
			this.log(JSON.stringify(sessions, null, 2));
			return;
		}

		this.log("HQ Sessions");
		this.log("═══════════");

		if (sessions.length === 0) {
			this.log("  No active HQ sessions");
			this.log("");
			this.log("  Start one with: hyper hq start");
			return;
		}

		for (const session of sessions) {
			const isHq = session.name === "hyper-hq";
			const status = session.attached ? "ATTACHED" : "ONLINE";
			const tag = isHq ? "  (HQ)" : "";
			this.log(`  ${session.name.padEnd(24)} ${status.padEnd(10)} ${session.created}${tag}`);
		}
	}
}
