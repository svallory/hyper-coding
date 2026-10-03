import { configExists, configPath, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";

export default class Status extends BaseCommand<typeof Status> {
	static override description = "Show the hyperdrive config file and the effective config";

	static override examples = [
		"<%= config.bin %> drive status",
		"HYPER_DRIVE_CONFIG=./drive.toml <%= config.bin %> drive status",
	];

	static override flags = {
		...BaseCommand.baseFlags,
	};

	async run(): Promise<void> {
		await this.parse(Status);

		const path = configPath();
		let config: ReturnType<typeof loadConfig>;
		try {
			config = loadConfig();
		} catch (err) {
			this.error(err instanceof Error ? err.message : String(err));
		}

		this.log(`Config file: ${path}`);
		this.log(`Exists: ${configExists() ? "yes" : "no (using defaults)"}`);
		this.log("Effective config:");
		this.log(JSON.stringify(config, null, 2));
	}
}
