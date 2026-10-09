import { homedir, hostname } from "node:os";
import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import { ConfigError, configPath, readRawConfig, writeConfig } from "#config/index";
import { ManifestError } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { promptValidation, promptValue } from "#lib/prompt-default";
import { escapeControlCharacters } from "#lib/terminal-text";
import {
	createForgeRepo,
	describeRepo,
	detectForge,
	expandRemote,
	FORGE_CLI,
	hasForgeCli,
	parseForgeRemote,
} from "#services/forge";
import { driveCheckoutOrigin, ensureDriveCheckout, remoteHasBranch } from "#services/manifest";

/** This machine's short name: the hostname up to its first dot. */
function defaultName(): string {
	return hostname().split(".")[0] || hostname();
}

export default class Setup extends BaseCommand<typeof Setup> {
	static override description =
		"Connect this machine to your hyperdrive repository (writes ~/.config/hyper/drive.toml; never touches the current directory)";

	/** `drive init` was the name before 0.5.2; kept so old notes and scripts still work. */
	static override aliases = ["drive:init"];

	static override examples = [
		"<%= config.bin %> drive setup",
		"<%= config.bin %> drive setup --remote you/hyperdrive",
		"<%= config.bin %> drive setup --remote git@github.com:you/hyperdrive.git --name mac",
		"<%= config.bin %> drive setup --remote you/hyperdrive --create",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		remote: Flags.string({
			description:
				"Your private hyperdrive repository: a git URL, `owner/name` on your forge, or just `name` under your account",
		}),
		name: Flags.string({ description: "This machine's short name" }),
		home: Flags.string({
			description: "Your home directory on this machine (defaults to the current one)",
		}),
		create: Flags.boolean({
			description:
				"Create the repository with gh or glab when it does not exist yet, without asking",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Setup);
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

			// Only look at the forge when the remote is still unknown: a remote
			// already in the config or on the flag never needs a default, and
			// `gh api user` is a network call worth skipping.
			const forge = flags.remote !== undefined || known(raw?.remote) ? null : detectForge();
			if (forge)
				this.log(`Logged in to ${forge.host} as ${forge.user} (${FORGE_CLI[forge.provider]}).`);

			const remoteDefault = forge ? `git@${forge.host}:${forge.user}/hyperdrive.git` : "";
			const remote = expandRemote(
				await this.value("remote", flags.remote, known(raw?.remote), remoteDefault),
				forge,
			);
			const name = await this.value("name", flags.name, known(rawSelf.name), defaultName());
			// Home is never asked: the flag, else what the file says, else where we are.
			const home = this.flagOrConfig("home", flags.home, known(rawSelf.home)) || homedir();

			await this.offerToCreate(remote, flags.create);

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
			this.log("");
			this.log("Next steps:");
			this.log("  hyper space init             in a space: give it a branch on the hyperdrive");
			this.log("  hyper space clone <name>     recreate a space another machine pushed");
			this.log("  hyper drive sync-config      optional: keep ~/.claude and ~/.pi/agent in step");
		} catch (err) {
			if (!(err instanceof ConfigError || err instanceof ManifestError)) throw err;
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}
	}

	/**
	 * When the remote names a repository on a forge whose CLI is installed,
	 * and that repository cannot be reached, offer to create it (private,
	 * empty) before the checkout is attempted. Anything else — a reachable
	 * remote, a path, an unknown host, no CLI — falls through to the usual
	 * connection error from `ensureDriveCheckout`.
	 */
	private async offerToCreate(remote: string, create: boolean): Promise<void> {
		if (driveCheckoutOrigin() === remote) return;
		const repo = parseForgeRemote(remote);
		if (!repo || !hasForgeCli(repo.provider)) return;
		if (remoteHasBranch(remote) !== null) return;

		const shown = describeRepo(repo);
		let go = create;
		if (!go && process.stdin.isTTY) {
			const answer = await p.confirm({
				message: `I can't reach ${escapeControlCharacters(shown)}. Create it as a private repository with ${FORGE_CLI[repo.provider]}?`,
				initialValue: true,
			});
			if (p.isCancel(answer)) {
				p.cancel("Hyperdrive setup cancelled.");
				throw new ConfigError(configPath(), "setup was cancelled.");
			}
			go = answer;
		}
		if (!go) {
			if (!process.stdin.isTTY) {
				throw new ManifestError(
					remote,
					`I couldn't reach ${escapeControlCharacters(shown)}. Create it first, or pass --create to let ${FORGE_CLI[repo.provider]} create it.`,
				);
			}
			return;
		}
		const result = createForgeRepo(repo);
		if (!result.ok) throw new ManifestError(remote, result.message);
		this.log(result.message);
	}

	private flagOrConfig(key: "home", flag: string | undefined, fromConfig: string): string {
		if (flag !== undefined) {
			if (!flag.trim()) throw new ConfigError(configPath(), `\`--${key}\` cannot be empty.`);
			return flag;
		}
		return fromConfig;
	}

	/**
	 * One value, in order of preference: the flag, then what the config file
	 * already says, then a prompt, then a default. Only a value the FILE
	 * already holds is skipped — a default is offered through the prompt
	 * (Enter accepts it), not used silently, so the user is asked once about
	 * every value and never asked twice.
	 */
	private async value(
		key: "remote" | "name",
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
						? "Where is your private hyperdrive repository? (URL, owner/name, or a name under your account)"
						: "What should this machine be called?",
				placeholder: key === "remote" && !fallback ? "git@github.com:you/hyperdrive.git" : fallback,
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
