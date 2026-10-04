import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { fetchSpace, spaceStatus } from "#services/space-history";

const NEEDS_ESCAPE = /[\p{Cc}\p{Cf}]/u;
const FORMAT_CHARACTER = /\p{Cf}/gu;
const toEscapeSequence = (character: string): string =>
	`\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`;

/**
 * Status prints paths from the work tree AND from an incoming branch, so a
 * filename is untrusted text. A path carrying a control or format character is
 * quoted and escaped, which also stops it breaking out of its own line.
 */
function displayPath(path: string): string {
	if (!NEEDS_ESCAPE.test(path)) return path;
	// `JSON.stringify` first: it quotes the value and already renders C0 as
	// `\uXXXX`, so escaping again here would double every backslash. Only the
	// FORMAT characters it leaves raw are added, inside the quotes it produced.
	return JSON.stringify(path).replace(FORMAT_CHARACTER, toEscapeSequence);
}

/**
 * `--json` is for machines: paths stay raw so a caller gets the true name back,
 * and `JSON.stringify` renders C0 on its way out. A FORMAT character has no such
 * safety net and would reach the terminal raw inside our own JSON, so it is
 * escaped here and nowhere else.
 */
function escapeForJson(path: string): string {
	return path.replace(FORMAT_CHARACTER, toEscapeSequence);
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
			this.log(
				JSON.stringify(
					{
						...result,
						status: result.status.map((entry) => ({
							...entry,
							path: escapeForJson(entry.path),
							...(entry.originalPath === undefined
								? {}
								: { originalPath: escapeForJson(entry.originalPath) }),
						})),
					},
					null,
					2,
				),
			);
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
			this.log(
				`${entry.code} ${entry.originalPath === undefined ? "" : `${displayPath(entry.originalPath)} -> `}${displayPath(entry.path)}`,
			);
		}
	}
}
