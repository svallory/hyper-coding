import type { Command } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { SpaceGitInterruptedError } from "#services/space-git";
import {
	type InitializedSpace,
	requireInitializedSpace,
	withSpaceSignals,
} from "#services/space-history";

/** Shared detection, scoped interruption handling and friendly command errors. */
export abstract class SpaceCommand<T extends typeof Command> extends BaseCommand<T> {
	protected inSpace<Result>(debug: boolean, action: (space: InitializedSpace) => Result): Result {
		try {
			return withSpaceSignals(() => action(requireInitializedSpace()));
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			const problem = new Error(error.message);
			problem.stack = debug ? (error.stack ?? error.message) : error.message;
			this.error(problem, { exit: error instanceof SpaceGitInterruptedError ? 130 : 2 });
		}
	}
}
