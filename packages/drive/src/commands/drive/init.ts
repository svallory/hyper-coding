import { homedir, hostname } from "node:os";
import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import { ConfigError, configPath, readRawConfig, writeConfig } from "#config/index";
import { ManifestError } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { promptValidation, promptValue } from "#lib/prompt-default";
import { ensureDriveCheckout } from "#services/manifest";

/** This machine's short name: the hostname up to its first dot. */
function defaultName(): string {
	return hostname().split(".")[0] || hostname();
}

export default class Init extends BaseCommand<typeof Init> {
	static override description = "Connect this machine to your hyperdrive repository";

	static override examples = [
		"<%= config.bin %> drive init --remote git@github.com:you/hyperdrive.git",
		"<%= config.bin %> drive init --remote /path/to/hyperdrive.git --name mac --home /Users/you",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		remote: Flags.string({ description: "Git URL of your private hyperdrive repository" }),
		name: Flags.string({ description: "This machine's short name" }),
		home: Flags.string({ description: "Your home directory on this machine" }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Init);
		try {
			// The RAW file, not the effective config: `loadConfig` fills in
			// defaults, and a value that came from a default is exactly the one
			// worth asking about.
			const raw = readRawConfig();
			const rawSelf =
				typeof raw?.self === "object" && raw.self !== null
					? (raw.self as Record<string, unknown>)
					: {};
			const known = (value: unknown): string => (typeof value === "string" ? value : "");

			const remote = await this.value("remote", flags.remote, known(raw?.remote), "");
			const name = await this.value("name", flags.name, known(rawSelf.name), defaultName());
			const home = await this.value("home", flags.home, known(rawSelf.home), homedir());

			// The checkout comes FIRST: an unreachable or mismatched remote must
			// not leave drive.toml pointing at a hyperdrive that was never
			// connected, which would break every later command.
			const checkout = ensureDriveCheckout(remote);
			const path = writeConfig({ remote, self: { name, home } });
			this.log(`Config: ${path}`);
			this.log(
				checkout.created
					? `Hyperdrive checkout created at ${checkout.dir}`
					: `Hyperdrive checkout already exists at ${checkout.dir} (updated if online)`,
			);
		} catch (err) {
			if (!(err instanceof ConfigError || err instanceof ManifestError)) throw err;
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}
	}

	/**
	 * One value, in order of preference: the flag, then what the config file
	 * already says, then a prompt, then a default. Only a value the FILE
	 * already holds is skipped — a default is offered through the prompt
	 * (Enter accepts it), not used silently, so the user is asked once about
	 * every value and never asked twice.
	 */
	private async value(
		key: "remote" | "name" | "home",
		flag: string | undefined,
		fromConfig: string,
		fallback: string,
	): Promise<string> {
		if (flag !== undefined) {
			if (!flag.trim()) throw new ConfigError(configPath(), `\`--${key}\` cannot be empty.`);
			return flag;
		}
		if (fromConfig) return fromConfig;
		if (process.stdin.isTTY) {
			const answer = await p.text({
				message:
					key === "remote"
						? "Where is your private hyperdrive repository?"
						: key === "name"
							? "What should this machine be called?"
							: "What is your home directory on this machine?",
				placeholder: key === "remote" ? "git@github.com:you/hyperdrive.git" : fallback,
				defaultValue: fallback,
				validate: (value) => promptValidation(key, value, fallback),
			});
			if (p.isCancel(answer) || typeof answer !== "string") {
				p.cancel("Hyperdrive setup cancelled.");
				throw new ConfigError(configPath(), "setup was cancelled.");
			}
			return promptValue(answer, fallback);
		}
		if (fallback) return fallback;
		throw new ConfigError(configPath(), `I need --${key} when stdin isn't a terminal.`);
	}
}
