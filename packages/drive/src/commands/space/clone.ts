import { Args, Flags, ux } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { cloneSpace } from "#services/space-clone";
import { SpaceGitInterruptedError } from "#services/space-git";

export default class Clone extends BaseCommand<typeof Clone> {
	static override description = "Recreate a space from your hyperdrive on this machine";
	static override examples = [
		"<%= config.bin %> space clone research",
		"<%= config.bin %> space clone research ./research",
		"<%= config.bin %> space clone research ./research --json",
	];
	static override args = {
		name: Args.string({ description: "Space name in the hyperdrive manifest", required: true }),
		path: Args.string({
			description: "Empty destination (default: recorded path remapped under this HOME)",
		}),
	};
	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Clone);
		const progress = process.stderr.isTTY && !flags.json;
		try {
			if (progress) ux.action.start(`Cloning space ${args.name}`);
			const result = cloneSpace(args.name, args.path);
			if (progress) ux.action.stop();
			for (const warning of result.warnings) this.warn(warning);
			if (flags.json) {
				this.log(JSON.stringify(result, null, 2));
				return;
			}
			this.log(
				`Path: ${result.path}${result.remapped ? ` (from ${JSON.stringify(result.originalPath)})` : ""}`,
			);
			this.log(
				`Branch: ${result.branch} | Cadence: ${result.cadence || "unset"} | Repos cloned: ${result.reposCloned.length}`,
			);
			this.log(`Worktrees: ${result.worktrees.join(", ") || "none (no project URLs)"}`);
			this.log(
				`Library wrote: ${result.libraryWrites.join(", ") || "nothing; tracked files preserved"}`,
			);
		} catch (error) {
			if (progress) ux.action.stop("failed");
			if (!(error instanceof Error)) throw error;
			const problem = new Error(error.message);
			problem.stack = flags.debug ? error.stack : error.message;
			this.error(problem, { exit: error instanceof SpaceGitInterruptedError ? 130 : 2 });
		}
	}
}
