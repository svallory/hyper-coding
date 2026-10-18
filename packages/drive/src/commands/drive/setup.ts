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
	forgeRepoExists,
	hasForgeCli,
	isBareName,
	isShorthand,
	parseForgeRemote,
} from "#services/forge";
import {
	assertDriveOrigin,
	driveCheckoutOrigin,
	ensureDriveCheckout,
	probeRemote,
} from "#services/manifest";

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
			description:
				"Your home directory on this machine (defaults to the config's value, else this user's home)",
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

			// Only look at the forge when it matters: the remote is still unknown
			// (it needs a default) or is a shorthand (`name`, `owner/name`) that
			// has to be expanded. A full URL or path never needs `gh api user`,
			// a network call worth skipping.
			const given = flags.remote ?? known(raw?.remote);
			const forge = !given.trim() || isShorthand(given) ? detectForge() : null;
			if (forge)
				this.log(`Logged in to ${forge.host} as ${forge.user} (${FORGE_CLI[forge.provider]}).`);

			const remoteDefault = forge
				? forge.https
					? `https://${forge.host}/${forge.user}/hyperdrive.git`
					: `git@${forge.host}:${forge.user}/hyperdrive.git`
				: "";
			const typed = await this.value("remote", flags.remote, known(raw?.remote), remoteDefault);
			const remote = expandRemote(typed, forge);
			// Unexpanded, a bare name is a path relative to the current directory.
			if (isBareName(typed) && remote === typed.trim()) {
				throw new ConfigError(
					configPath(),
					`I can't tell whose account \`${escapeControlCharacters(typed.trim())}\` belongs to: neither gh nor glab is logged in. Pass owner/name or the full git URL.`,
				);
			}
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
	 * and git cannot reach it, ask the forge whether it exists. Only a
	 * definite "no such repository" offers to create it (private, empty);
	 * a repository that exists, or an answer we can't read, is a connection
	 * problem and shows git's own words. Anything else — a reachable remote,
	 * a path, an unknown host, no CLI — falls through to the usual connection
	 * error from `ensureDriveCheckout`.
	 *
	 * A checkout that belongs to another remote fails first, before anything
	 * is created on a forge.
	 */
	private async offerToCreate(remote: string, create: boolean): Promise<void> {
		assertDriveOrigin(remote);
		if (driveCheckoutOrigin() !== null) return;
		const repo = parseForgeRemote(remote);
		if (!repo || !hasForgeCli(repo.provider)) return;
		const probe = probeRemote(remote);
		if (probe.ok) return;
		const found = forgeRepoExists(repo);
		if (found !== "missing") {
			const hint =
				found === "exists"
					? `${FORGE_CLI[repo.provider]} says the repository exists, so this is probably access (an SSH key or credentials for this machine).`
					: `I couldn't tell whether the repository exists, so I won't try to create it.`;
			throw new ManifestError(
				remote,
				`I couldn't reach ${escapeControlCharacters(describeRepo(repo))}. git said: ${escapeControlCharacters(probe.said)} ${hint}`,
			);
		}

		const shown = describeRepo(repo);
		let go = create;
		if (!go && process.stdin.isTTY) {
			const answer = await p.confirm({
				message: `${escapeControlCharacters(shown)} does not exist yet. Create it as a private repository with ${FORGE_CLI[repo.provider]}?`,
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
					`${escapeControlCharacters(shown)} does not exist yet. Create it first, or pass --create to let ${FORGE_CLI[repo.provider]} create it.`,
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
