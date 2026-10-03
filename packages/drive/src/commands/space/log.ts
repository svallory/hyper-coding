import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import { logSpace } from "#services/space-history";

export default class Log extends SpaceCommand<typeof Log> {
	static override description = "Show this space's git log (git-log arguments pass through)";
	static override examples = [
		"<%= config.bin %> space log --oneline -n 10",
		"<%= config.bin %> space log --since=yesterday -- notes/",
		"<%= config.bin %> space log HEAD~2..HEAD --stat",
	];
	static override strict = false;
	static override baseFlags = { debug: Flags.boolean({ hidden: true, default: false }) };
	static override usage = "space log [git-log args…]";
	async run(): Promise<void> {
		const args = [...this.argv];
		// Mark arguments as passthrough for oclif while preserving Git's exact argv.
		// Without parse(), development builds emit an UnparsedCommand warning.
		await this.parse(Log, ["--", ...args]);
		const code = await this.inSpace(false, ({ root, branch }) => logSpace(root, branch, args));
		if (code !== 0) this.exit(code);
	}
}
