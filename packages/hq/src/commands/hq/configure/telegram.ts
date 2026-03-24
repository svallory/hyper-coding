import * as p from "@clack/prompts";
import { configureTelegram } from "create-hyper-hq/setup/wizard";
import { configExists, loadConfig, updateConfigTelegram } from "#config/index";
import { BaseCommand } from "#lib/base-command";

export default class ConfigureTelegram extends BaseCommand<typeof ConfigureTelegram> {
	static override description = "Configure Telegram integration for HQ";
	static override examples = ["<%= config.bin %> hq configure telegram"];

	async run(): Promise<void> {
		await this.parse(ConfigureTelegram);

		if (!configExists()) {
			this.error("HQ is not configured yet. Run 'hyper hq setup' first.");
		}

		const config = loadConfig();
		const result = await configureTelegram({
			currentToken: config.telegram?.hq_bot_token,
		});

		if (result.token !== undefined) {
			updateConfigTelegram(result.token);
			p.log.success("Telegram configuration updated.");
			p.log.info("Restart HQ to apply changes: hyper hq stop-all && hyper hq start");
		}
	}
}
