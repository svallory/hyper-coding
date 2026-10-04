import { createInterface } from "node:readline/promises";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { CloneCancelledError, cloneSpace } from "#services/space-clone";
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
		yes: Flags.boolean({
			description: "Confirm the manifest-derived destination without prompting",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Clone);
		const interactive = !!(process.stdin.isTTY && process.stderr.isTTY);
		try {
			// Git owns the terminal for progress/authentication; no spinner hides it.
			const result = await cloneSpace(args.name, args.path, {
				yes: flags.yes,
				confirmTarget: interactive
					? async (target, recorded) => {
							const terminal = createInterface({ input: process.stdin, output: process.stderr });
							const controller = new AbortController();
							let interrupted: "SIGINT" | "SIGTERM" = "SIGINT";
							const onInt = (): void => {
								interrupted = "SIGINT";
								controller.abort();
							};
							const onTerm = (): void => {
								interrupted = "SIGTERM";
								controller.abort();
							};
							process.on("SIGINT", onInt);
							process.on("SIGTERM", onTerm);
							terminal.on("SIGINT", onInt);
							try {
								const answer = await terminal.question(
									`The hyperdrive proposes ${target} (recorded as ${JSON.stringify(recorded)}). Clone here? [y/N] `,
									{ signal: controller.signal },
								);
								return /^(y|yes)$/i.test(answer.trim());
							} catch (error) {
								if (controller.signal.aborted) throw new SpaceGitInterruptedError(interrupted);
								throw error;
							} finally {
								process.off("SIGINT", onInt);
								process.off("SIGTERM", onTerm);
								terminal.close();
							}
						}
					: undefined,
			});
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
			if (error instanceof CloneCancelledError) {
				// Declining a prompt is a decision, not a failure to fix.
				this.error(error.message, { exit: 1 });
			}
			if (!(error instanceof Error)) throw error;
			const problem = new Error(error.message);
			problem.stack = flags.debug ? error.stack : error.message;
			this.error(problem, { exit: error instanceof SpaceGitInterruptedError ? 130 : 2 });
		}
	}
}
