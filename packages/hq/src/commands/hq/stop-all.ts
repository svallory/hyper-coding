import { BaseCommand } from "#lib/base-command";
import * as tmux from "#services/tmux";
import { log } from "#utils/log";

export default class StopAll extends BaseCommand<typeof StopAll> {
	static override description = "Stop all HQ-managed sessions";

	static override examples = ["<%= config.bin %> hq stop-all"];

	async run(): Promise<void> {
		await this.parse(StopAll);
		const sessions = tmux.listSessions("hq");

		if (sessions.length === 0) {
			this.log("No HQ sessions running");
			return;
		}

		for (const session of sessions) {
			tmux.killSession(session.name);
			log(`Stopped: ${session.name}`);
		}
	}
}
