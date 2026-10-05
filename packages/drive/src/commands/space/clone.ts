import { createInterface } from "node:readline/promises";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
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
									`The hyperdrive proposes ${escapeControlCharacters(target)} (recorded as ${quoteForTerminal(recorded)}). Clone here? [y/N] `,
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
				`Path: ${escapeControlCharacters(result.path)}${result.remapped ? ` (from ${quoteForTerminal(result.originalPath)})` : ""}`,
			);
			this.log(
				`Branch: ${escapeControlCharacters(result.branch)} | Cadence: ${escapeControlCharacters(result.cadence || "unset")} | Repos cloned: ${result.reposCloned.length}`,
			);
			this.log(
				`Worktrees: ${result.worktrees.map(escapeControlCharacters).join(", ") || "none (no project URLs)"}`,
			);
			this.log(
				`Manifest: ${
					result.manifestPath === "recorded"
						? "this clone's path recorded"
						: result.manifestPath === "unchanged"
							? "path already recorded"
							: "path NOT recorded (see the warning above)"
				}`,
			);
			this.log(
				`Library wrote: ${result.libraryWrites.map(escapeControlCharacters).join(", ") || "nothing; tracked files preserved"}`,
			);
		} catch (error) {
			if (error instanceof CloneCancelledError) {
				// Declining a prompt is a decision, not a failure to fix. Set the
				// code here rather than inferring it from any prompt library's
				// cancelled state, so it cannot depend on how the answer arrived.
				process.exitCode = 1;
				this.error(error.message, { exit: 1 });
			}
			if (!(error instanceof Error)) throw error;
			const problem = new Error(error.message);
			problem.stack = flags.debug ? error.stack : error.message;
			this.error(problem, { exit: error instanceof SpaceGitInterruptedError ? 130 : 2 });
		}
	}
}
