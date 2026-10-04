import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { readSessionEndInput, sessionEndLine, sessionEndMessage } from "#services/session-end";
import { requireInitializedSpace, withSpaceSignals } from "#services/space-history";
import { commitSpace } from "#services/space-sync";

export default class Commit extends SpaceCommand<typeof Commit> {
	static override description = "Commit this space's allowlisted changes locally";
	static override examples = [
		"<%= config.bin %> space commit",
		'<%= config.bin %> space commit -m "Update research notes"',
		"<%= config.bin %> space commit --allow-secret notes/example.key --json",
	];
	static override flags = {
		...SpaceCommand.baseFlags,
		message: Flags.string({ char: "m", description: "Commit message (default: space: update)" }),
		"session-end": Flags.boolean({
			description:
				"Read Claude hook JSON on stdin; use the last transcript summary (200 characters)",
			exclusive: ["message", "allow-secret", "json"],
		}),
		"allow-secret": Flags.string({
			description: "Exact space-relative secret path to allow (repeatable; acknowledged in output)",
			multiple: true,
		}),
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Commit);
		if (flags["session-end"]) {
			try {
				const input = await readSessionEndInput(process.stdin);
				const message = await sessionEndMessage(input);
				const warnings: string[] = [];
				const result = await withSpaceSignals(async () => {
					const { root, branch } = requireInitializedSpace();
					return commitSpace(root, branch, message, [], "daily", (warning) =>
						warnings.push(warning),
					);
				});
				if (result.committed > 0)
					this.log(`hyperdrive: committed ${result.committed} file(s) at session end.`);
				if (warnings.length > 0)
					process.stderr.write(`hyperdrive: ${sessionEndLine(warnings.join(" "), 1000)}\n`);
			} catch (error) {
				process.stderr.write(
					`hyperdrive: ${sessionEndLine(error instanceof Error ? error.message : String(error), 1000)} SessionEnd hook will continue without pushing; inspect \`hyper space status\`.\n`,
				);
				this.exit(2);
			}
			return;
		}
		const result = await this.inSpace(flags.debug, async ({ root, branch }) => {
			const { unborn: _unborn, ...committed } = await commitSpace(
				root,
				branch,
				flags.message ?? "space: update",
				flags["allow-secret"] ?? [],
			);
			return { branch, ...committed };
		});
		if (flags.json) this.log(JSON.stringify(result, null, 2));
		else
			this.log(
				result.committed === 0
					? "Nothing to commit — this space is up to date."
					: `Committed ${result.committed} ${result.committed === 1 ? "file" : "files"} on ${result.branch}.`,
			);
	}
}
