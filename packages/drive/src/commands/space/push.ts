import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { escapeControlCharacters } from "#lib/terminal-text";
import { spaceRemote } from "#services/space-history";
import { pushSpace } from "#services/space-sync";

export default class Push extends SpaceCommand<typeof Push> {
	static override description = "Push this space's branch without rewriting remote history";
	static override examples = [
		"<%= config.bin %> space push",
		"<%= config.bin %> space push --debug",
	];
	static override flags = {
		...SpaceCommand.baseFlags,
		"allow-secret": Flags.string({
			description:
				"Publish this exact secret-looking path in an unpushed commit (as `space commit --allow-secret`). Repeatable.",
			multiple: true,
			default: [],
		}),
		"allow-user-state-history": Flags.boolean({
			description:
				"Publish unpushed commits that hold Claude user state (history, transcripts, …) anyway. Not recommended: see the refusal for how to drop it instead.",
			default: false,
		}),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Push);
		const branch = await this.inSpace(flags.debug, ({ root, branch }) => {
			if (flags["allow-user-state-history"])
				this.warn(
					"--allow-user-state-history: publishing Claude user state (prompt history, transcripts, …) that unpushed commits hold. It cannot be taken back from the hyperdrive's history.",
				);
			pushSpace(root, spaceRemote(root), branch, "daily", {
				allowSecrets: flags["allow-secret"],
				allowUserStateHistory: flags["allow-user-state-history"],
			});
			return branch;
		});
		this.log(`Pushed ${escapeControlCharacters(branch)}.`);
	}
}
