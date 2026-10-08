import { Flags } from "@oclif/core";
import { ConfigError, configPath, loadConfig } from "#config/index";
import { ManifestError } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { driveCheckoutOrigin, readManifest } from "#services/manifest";

export default class List extends BaseCommand<typeof List> {
	static override description = "List the spaces on your hyperdrive";

	static override examples = [
		"<%= config.bin %> space list",
		"<%= config.bin %> space list --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({ description: "Print the manifest as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(List);
		try {
			const config = loadConfig();
			if (!config.remote) {
				throw new ConfigError(
					configPath(),
					"there's no `remote` yet — run `hyper drive setup` first.",
				);
			}
			// Listing the old checkout while drive.toml names a new remote is how
			// a half-finished `drive setup` used to look like a working setup.
			const origin = driveCheckoutOrigin();
			if (origin !== null && origin !== config.remote) {
				throw new ManifestError(
					origin,
					`the hyperdrive checkout is a clone of ${quoteForTerminal(origin)}, ` +
						`but your config points at ${quoteForTerminal(config.remote)} — run \`hyper drive setup\`.`,
				);
			}
			const manifest = readManifest();
			for (const space of manifest.spaces) {
				for (const repo of space.repos) {
					if (!repo.url.trim())
						this.warn(
							`${escapeControlCharacters(space.name)}/${escapeControlCharacters(repo.slug ?? "project")} has no project URL; space clone will skip it. Add its origin on the original machine and run hyper space init --refresh.`,
						);
				}
			}
			if (flags.json) {
				this.log(JSON.stringify(manifest, null, 2));
				return;
			}
			if (manifest.spaces.length === 0) {
				this.log("no spaces yet");
				return;
			}
			const rows = [
				["NAME", "BRANCH", "LAYOUT", "PATH", "CADENCE"],
				// Manifest data, so escaped for the terminal; `--json` above
				// prints the same values raw.
				...manifest.spaces.map((space) =>
					[space.name, space.branch, space.layout, space.path, space.cadence || "-"].map((cell) =>
						escapeControlCharacters(String(cell)),
					),
				),
			];
			const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
			for (const row of rows) {
				this.log(
					row
						.map((cell, i) => cell.padEnd(widths[i]))
						.join("  ")
						.trimEnd(),
				);
			}
		} catch (err) {
			if (!(err instanceof ConfigError || err instanceof ManifestError)) throw err;
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}
	}
}
