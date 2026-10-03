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
	static override usage = "space log [git-log args…]";
	async run(): Promise<void> {
		const code = this.inSpace(false, ({ root, branch }) => logSpace(root, branch, this.argv));
		if (code !== 0) this.exit(code);
	}
}
