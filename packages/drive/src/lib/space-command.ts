import type { Command } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { SpaceGitInterruptedError, SpaceRefusedError } from "#services/space-git";
import {
	type InitializedSpace,
	requireInitializedSpace,
	withSpaceSignals,
} from "#services/space-history";
import { SpaceIncomingError } from "#services/space-incoming";

/** Shared detection, scoped interruption handling and friendly command errors. */
export abstract class SpaceCommand<T extends typeof Command> extends BaseCommand<T> {
	private jsonOnError: ((error: Error) => void) | undefined;
	protected async inSpace<Result>(
		debug: boolean,
		action: (space: InitializedSpace) => Result | Promise<Result>,
	): Promise<Result> {
		try {
			return await withSpaceSignals(() => action(requireInitializedSpace()));
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			// A `--json` caller gets JSON for refusals too: a script asking for a
			// result should not have to parse stderr to learn there wasn't one.
			if (this.jsonOnError !== undefined) {
				this.jsonOnError(error);
				this.exit(error instanceof SpaceGitInterruptedError ? 130 : 2);
			}
			const problem = new Error(error.message);
			problem.stack = debug ? (error.stack ?? error.message) : error.message;
			this.error(problem, { exit: error instanceof SpaceGitInterruptedError ? 130 : 2 });
		}
	}

	/**
	 * Install the JSON failure shape for a command whose `--json` output must
	 * exist even on refusal. `reason` is a stable slug so scripts can branch on
	 * it instead of matching prose.
	 */
	protected jsonFailures(): void {
		this.jsonOnError = (error) => {
			this.log(
				JSON.stringify(
					{
						ok: false,
						reason:
							error instanceof SpaceRefusedError
								? error.reason
								: error instanceof SpaceIncomingError
									? error.reason
									: error instanceof SpaceGitInterruptedError
										? "interrupted"
										: "refused",
						message: error.message,
					},
					null,
					2,
				),
			);
		};
	}
}
