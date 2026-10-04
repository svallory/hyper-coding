import * as p from "@clack/prompts";
import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { pullSpace } from "#services/space-history";

export default class Pull extends SpaceCommand<typeof Pull> {
	static override description = "Fetch this space and fast-forward only; never merge or rebase";
	static override examples = [
		"<%= config.bin %> space pull",
		"<%= config.bin %> space pull --accept-tracked --json",
	];
	static override flags = {
		...SpaceCommand.baseFlags,
		"accept-tracked": Flags.boolean({
			description: "Consent to incoming tracked directories becoming eligible for local commits",
			default: false,
		}),
		json: Flags.boolean({
			description: "Print pull results and files needing review as JSON",
			default: false,
		}),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Pull);
		if (flags.json) this.jsonFailures();
		const result = await this.inSpace(flags.debug, async ({ root, branch }) => ({
			branch,
			...(await pullSpace(root, branch, {
				acceptTracked: flags["accept-tracked"],
				confirmTracked:
					process.stdin.isTTY && process.stdout.isTTY && !flags.json
						? async (entries) => {
								for (const entry of entries)
									this.log(
										`${JSON.stringify(entry.path)}: ${entry.localFiles} local files would become eligible for commit`,
									);
								const answer = await p.confirm({
									message: "Accept these incoming tracked directories on this machine?",
									initialValue: false,
								});
								return !p.isCancel(answer) && answer;
							}
						: undefined,
			})),
		}));
		if (flags.json) {
			this.log(JSON.stringify({ ok: true, ...result }, null, 2));
			return;
		}
		this.log(
			result.updated
				? `Fast-forwarded ${result.branch}.`
				: `${result.branch} is already up to date.`,
		);
		for (const entry of result.addedTracked)
			this.log(
				`Accepted ${JSON.stringify(entry.path)}: ${entry.localFiles} local files are now eligible for commit.`,
			);
		if (result.allowlistRestored)
			this.log(
				"Preserved this machine's tracked entries by re-rendering .gitignore; review and commit its local modification.",
			);
		if (result.reviewPaths.length > 0) {
			this.log("These can run commands or instruct agents; review them:");
			for (const path of result.reviewPaths) this.log(`  ${JSON.stringify(path)}`);
		}
	}
}
