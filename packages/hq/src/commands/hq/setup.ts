import * as p from "@clack/prompts";
import { runConfigWizard } from "create-hyper-hq/setup/wizard";
import { configExists, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";

export default class Setup extends BaseCommand<typeof Setup> {
	static override description = "Set up HQ — configure settings";
	static override examples = ["<%= config.bin %> hq setup"];

	async run(): Promise<void> {
		await this.parse(Setup);

		// Pass existing config for re-run safety
		const existing = configExists() ? loadConfig() : undefined;

		await runConfigWizard({
			existing: existing
				? {
						projectsRoot: existing.projects_root,
						hqDir: existing.hq.dir,
						telegramToken: existing.telegram?.hq_bot_token,
					}
				: undefined,
		});

		// Offer to start HQ
		const startNow = await p.confirm({ message: "Start HQ now?" });
		if (p.isCancel(startNow)) return;
		if (startNow) {
			const { spawnSync } = await import("node:child_process");
			spawnSync("hyper", ["hq", "start"], { stdio: "inherit" });
		} else {
			this.log("\nRun 'hyper hq start' whenever you're ready.");
		}
	}
}
