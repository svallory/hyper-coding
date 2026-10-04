import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import {
	isIgnoredSessionEnd,
	readSessionEndInput,
	sessionEndLine,
	sessionEndMessage,
} from "#services/session-end";
import { SESSION_END_FAILURES } from "#services/session-end-log";
import { runSessionEndWorker } from "#services/session-end-worker";
import { requireInitializedSpace, withSpaceSignals } from "#services/space-history";
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
		message: Flags.string({ char: "m", description: "Commit message (default: space: update)" }),
		"session-end": Flags.boolean({
			description:
				"Read Claude hook JSON on stdin; use the last transcript summary (200 characters)",
			exclusive: ["message", "allow-secret", "json"],
		}),
		"payload-file": Flags.string({
			description:
				"With --session-end: read the hook JSON from this file in .hyper/space.git (removed after reading), then commit, push for the session-end+push cadence, and record the result in .hyper/space.git/session-end.log (used by the detached SessionEnd worker)",
			dependsOn: ["session-end"],
		}),
		"allow-secret": Flags.string({
			description: "Exact space-relative secret path to allow (repeatable; acknowledged in output)",
			multiple: true,
		}),
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Commit);
		if (flags["payload-file"] !== undefined) {
			// The detached worker: stdout/stderr go nowhere, the log is the output.
			// Its exit status still says whether the save worked, for callers that look.
			let entry: Awaited<ReturnType<typeof runSessionEndWorker>>;
			try {
				entry = await withSpaceSignals(() => runSessionEndWorker(flags["payload-file"]!));
			} catch (error) {
				process.stderr.write(
					`hyperdrive: ${sessionEndLine(error instanceof Error ? error.message : String(error), 1000)}\n`,
				);
				this.exit(2);
			}
			if (SESSION_END_FAILURES.includes(entry.outcome)) {
				process.stderr.write(`hyperdrive: ${entry.outcome}: ${entry.detail}\n`);
				this.exit(2);
			}
			return;
		}
		if (flags["session-end"]) {
			try {
				const input = await readSessionEndInput(process.stdin);
				if (isIgnoredSessionEnd(input)) return;
				const message = await sessionEndMessage(input);
				const warnings: string[] = [];
				const result = await withSpaceSignals(async () => {
					const { root, branch } = requireInitializedSpace();
					return commitSpace(root, branch, message, [], "daily", (warning) =>
						warnings.push(warning),
					);
				});
				if (result.committed > 0)
					this.log(`hyperdrive: committed ${result.committed} file(s) at session end.`);
				if (warnings.length > 0)
					process.stderr.write(`hyperdrive: ${sessionEndLine(warnings.join(" "), 1000)}\n`);
			} catch (error) {
				process.stderr.write(
					`hyperdrive: ${sessionEndLine(error instanceof Error ? error.message : String(error), 1000)} SessionEnd hook will continue without pushing; inspect \`hyper space status\`.\n`,
				);
				this.exit(2);
			}
			return;
		}
		const result = await this.inSpace(flags.debug, async ({ root, branch }) => {
			const { unborn: _unborn, ...committed } = await commitSpace(
				root,
				branch,
				flags.message ?? "space: update",
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
