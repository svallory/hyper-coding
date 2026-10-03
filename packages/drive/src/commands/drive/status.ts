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
			const message = err instanceof Error ? err.message : String(err);
			// A bad config is a user error, not a crash. In debug/dev mode oclif's
			// prettyPrint() returns `error.stack` verbatim (see @oclif/core
			// lib/errors/pretty-print.js), so the JS frames would be dumped on top of
			// the friendly message. Hand it a stack that carries only the message.
			const problem = new Error(message);
			problem.stack = message;
			this.error(problem, { exit: 2 });
		}

		this.log(`Config file: ${path}`);
		this.log(`Exists: ${configExists() ? "yes" : "no (using defaults)"}`);
		this.log("Effective config:");
		this.log(JSON.stringify(config, null, 2));
	}
}
