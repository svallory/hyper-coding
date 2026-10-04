/**
 * Running shell snippets on the target machine, the way a task needs to.
 *
 * Every command here goes through `ctx.runner`, so a local setup runs it here
 * and a remote one runs it over ssh (C-16): a task never spawns a process and
 * never decides how to reach the machine.
 *
 * Snippets are passed to `sh -c` rather than as an argv, because the checks
 * want pipes and `[ … ]` tests and a dozen `&&`-joined probes, and hand-rolling
 * that as an argv array produces something no one can read in a log. The runner
 * quotes the whole snippet, so its spaces survive.
 */

import { type RunResult, shellJoin, shellQuote } from "#services/remote";
import type { TaskContext } from "./types.js";

/** Embed a shell program as one argument, never by hand-written quote delimiters. */
export function shellCommand(script: string): string {
	return shellJoin(["sh", "-c", script, "_"]);
}

/** Run one snippet on the target. Never throws on a non-zero exit — checks test the code. */
export async function runScript(ctx: TaskContext, script: string): Promise<RunResult> {
	return ctx.runner.ssh(["sh", "-c", script]);
}

/** Run a snippet, turning a non-zero exit into an error naming what was being done. */
export async function runOrFail(
	ctx: TaskContext,
	what: string,
	script: string,
): Promise<RunResult> {
	// `set -e` first, always. Snippets here are several commands joined with `;`,
	// and without it ONLY THE LAST COMMAND'S exit code is the snippet's — so a
	// `setfacl` that failed on a missing file was invisible, and the task then
	// failed its check forever with nothing to show for it. Every mutating
	// snippet goes through here, so this is the one place that has to be right.
	const result = await runScript(ctx, `set -e\n${script}`);
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
		throw new Error(`I couldn't ${what} on ${ctx.machine?.name ?? "this machine"}: ${detail}`);
	}
	return result;
}

/** True when the snippet exits 0. Anything else — including a crash — is false. */
export async function succeeds(ctx: TaskContext, script: string): Promise<boolean> {
	const result = await runScript(ctx, script);
	return result.code === 0;
}

/**
 * Append one line to an rc file, once.
 *
 * Shared by the two tasks that own a line in the primary's `.bashrc` — the
 * agent-user layout (`umask 002`, `set -o physical`) and the home-path feature
 * (`set -o physical` again) — so running both features cannot produce two
 * copies of the same line, and neither has to know what the other writes.
 *
 * The match is on the WHOLE line (`grep -x`), so a commented-out copy or a
 * differently-quoted one is not mistaken for the real thing.
 */
export function ensureBashrcLine(path: string, line: string): string {
	const q = shellQuote;
	return [
		`touch ${q(path)}`,
		`grep -qxF ${q(line)} ${q(path)} || printf '%s\\n' ${q(line)} >> ${q(path)}`,
	].join("\n");
}
