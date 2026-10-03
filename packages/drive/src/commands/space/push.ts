import { SpaceCommand } from "#lib/space-command";
import { spaceRemote } from "#services/space-history";
import { pushSpace } from "#services/space-sync";

export default class Push extends SpaceCommand<typeof Push> {
	static override description = "Push this space's branch without rewriting remote history";
	static override examples = [
		"<%= config.bin %> space push",
		"<%= config.bin %> space push --debug",
	];
	async run(): Promise<void> {
		const { flags } = await this.parse(Push);
		const branch = await this.inSpace(flags.debug, ({ root, branch }) => {
			pushSpace(root, spaceRemote(root), branch);
			return branch;
		});
		this.log(`Pushed ${branch}.`);
	}
}
