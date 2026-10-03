import { SpaceCommand } from "#lib/space-command";
import { pullSpace } from "#services/space-history";

export default class Pull extends SpaceCommand<typeof Pull> {
	static override description = "Fetch this space and fast-forward only; never merge or rebase";
	static override examples = [
		"<%= config.bin %> space pull",
		"<%= config.bin %> space pull --debug",
	];
	async run(): Promise<void> {
		const { flags } = await this.parse(Pull);
		const result = this.inSpace(flags.debug, ({ root, branch }) => ({
			branch,
			...pullSpace(root, branch),
		}));
		this.log(
			result.updated
				? `Fast-forwarded ${result.branch}.`
				: `${result.branch} is already up to date.`,
		);
	}
}
