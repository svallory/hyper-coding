import { ConfigError, configExists, configPath, loadConfig } from "#config/index";
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
		const { flags } = await this.parse(Status);

		const path = configPath();
		let config: ReturnType<typeof loadConfig>;
		try {
			config = loadConfig();
		} catch (err) {
			// Only a ConfigError is a user error. Anything else is a real bug and
			// must keep its stack so it can be diagnosed, so rethrow it untouched.
			if (!(err instanceof ConfigError)) throw err;
			// In debug/dev mode oclif's prettyPrint() returns `error.stack` verbatim
			// (see @oclif/core lib/errors/pretty-print.js), which would dump the JS
			// frames on top of the friendly message. Hand it a message-only stack —
			// unless the user asked for --debug, where the frames are the point.
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}

		this.log(`Config file: ${path}`);
		this.log(`Exists: ${configExists() ? "yes" : "no (using defaults)"}`);
		this.log("Effective config:");
		this.log(JSON.stringify(config, null, 2));
	}
}
