import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
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
		message: Flags.string({ char: "m", description: "Commit message", default: "space: update" }),
		"allow-secret": Flags.string({
			description: "Exact space-relative secret path to allow (repeatable; acknowledged in output)",
			multiple: true,
		}),
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Commit);
		const result = await this.inSpace(flags.debug, async ({ root, branch }) => {
			const { unborn: _unborn, ...committed } = await commitSpace(
				root,
				branch,
				flags.message,
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
