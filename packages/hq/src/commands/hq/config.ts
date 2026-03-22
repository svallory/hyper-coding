import { Flags } from "@oclif/core";
import { CONFIG_PATH, configExists, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";

export default class Config extends BaseCommand<typeof Config> {
	static override description = "Show HQ configuration";

	static override examples = [
		"<%= config.bin %> hq config",
		"<%= config.bin %> hq config --json",
		"<%= config.bin %> hq config --path",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({ description: "Output as JSON", default: false }),
		path: Flags.boolean({ description: "Print config file path only", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Config);

		if (flags.path) {
			this.log(CONFIG_PATH);
			return;
		}

		if (!configExists()) {
			this.log(`No config file found at ${CONFIG_PATH}`);
			this.log("");
			this.log('Run "hyper hq start" to create one via the setup wizard.');
			return;
		}

		const config = loadConfig();

		if (flags.json) {
			this.log(JSON.stringify(config, null, 2));
			return;
		}

		const telegramStatus = config.telegram.hq_bot_token
			? "enabled (HQ bot configured)"
			: "disabled";
		const projectBotCount = Object.keys(config.telegram.project_bots).length;
		const projectBotInfo = projectBotCount > 0 ? `${projectBotCount} project bot(s)` : "none";
		const groupCount = Object.values(config.projects).filter((p) => p.type === "group").length;
		const groupInfo = groupCount > 0 ? `${groupCount} group(s) configured` : "none";

		this.log(`Config file: ${CONFIG_PATH}`);
		this.log("");
		this.log(`  projects_root     ${config.projects_root}`);
		this.log(`  hq.name           ${config.hq.name}`);
		this.log(`  hq.dir            ${config.hq.dir}`);
		this.log(`  hq.spawn_mode     ${config.hq.spawn_mode}`);
		this.log(`  hq.capacity       ${config.hq.capacity}`);
		this.log(`  claude.mode       ${config.claude.permission_mode ?? "default"}`);
		this.log(`  telegram          ${telegramStatus}`);
		this.log(`  project bots      ${projectBotInfo}`);
		this.log(`  project groups    ${groupInfo}`);
		this.log("");
		this.log(`Edit: ${CONFIG_PATH}`);
		this.log("Docs: https://clint.saulo.engineer/getting-started/configuration");
	}
}
