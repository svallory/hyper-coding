import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { fetchSpace, spaceStatus } from "#services/space-history";

function quotePath(path: string): string {
	return JSON.stringify(path).replace(
		/\p{Cc}/gu,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

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
				? `Upstream: ahead ${result.ahead}, behind ${result.behind}${result.refused ? `: the newest commit on the hyperdrive was refused by the last pull (${JSON.stringify(result.refused.reason)})` : " (as of the last contact with the hyperdrive)"}`
				: "Upstream: this machine has not exchanged this branch with the hyperdrive yet — run `hyper space status --fetch` to compare.",
		);
		if (result.status.length === 0) this.log("Working tree clean.");
		for (const entry of result.status) {
			const path = /\p{Cc}/u.test(entry.path) ? quotePath(entry.path) : entry.path;
			this.log(
				`${entry.code} ${entry.originalPath === undefined ? "" : `${quotePath(entry.originalPath)} -> `}${path}`,
			);
		}
	}
}
