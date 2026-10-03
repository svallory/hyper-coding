import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { fetchSpace, spaceStatus } from "#services/space-history";

export default class Status extends SpaceCommand<typeof Status> {
	static override description = "Show this space's changes, cadence and last-known upstream state";
	static override examples = [
		"<%= config.bin %> space status",
		"<%= config.bin %> space status --json",
		"<%= config.bin %> space status --fetch",
	];
	static override flags = {
		...SpaceCommand.baseFlags,
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
		fetch: Flags.boolean({
			description: "Fetch this space's branch before comparing (otherwise offline)",
			default: false,
		}),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Status);
		const result = await this.inSpace(flags.debug, ({ root, branch }) => {
			if (flags.fetch) fetchSpace(root, branch);
			return spaceStatus(root, branch);
		});
		if (flags.json) {
			this.log(JSON.stringify(result, null, 2));
			return;
		}
		this.log(`Branch:  ${result.branch}`);
		this.log(`Cadence: ${result.cadence || "unset (manual)"}`);
		this.log(
			result.upstreamKnown
				? `Upstream: ahead ${result.ahead}, behind ${result.behind} (as of the last contact with the hyperdrive)`
				: "Upstream: this machine has not exchanged this branch with the hyperdrive yet — run `hyper space status --fetch` to compare.",
		);
		if (result.status.length === 0) this.log("Working tree clean.");
		for (const entry of result.status) {
			const path = /[\n\r\t]/.test(entry.path) ? JSON.stringify(entry.path) : entry.path;
			this.log(
				`${entry.code} ${entry.originalPath === undefined ? "" : `${JSON.stringify(entry.originalPath)} -> `}${path}`,
			);
		}
	}
}
