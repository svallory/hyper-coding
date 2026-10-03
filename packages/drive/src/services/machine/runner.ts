/**
 * The machine-setup runner.
 *
 * Order of business, and why:
 *
 * 1. Pick the tasks whose feature was selected.
 * 2. Run every non-root task whose `check` fails, then re-check it. A task that
 *    still fails afterwards is reported as skipped rather than applied —
 *    claiming a fix that didn't take would be worse than saying nothing worked.
 * 3. Gather the root scripts of the root tasks whose `check` fails and write
 *    ONE script for the user to read. Root work is never applied piecemeal: a
 *    user who is about to type their password wants to see everything first.
 * 4. Ask what to do with it, and loop until it's either done or skipped.
 *
 * Every prompt goes through the injected {@link SetupPrompt}, so the tests
 * script a sequence of answers and never touch a TTY.
 *
 * This file holds the CLI's only `sudo` call outside `root-script.ts` (C-6),
 * and it is reachable from exactly one place: the user picking "run it for me".
 * `--yes` never reaches it — picking defaults is not asking for a password.
 */

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunResult } from "#services/remote";
import {
	assembleRootScript,
	privilegedArgv,
	type RootScriptEntry,
	remoteScriptPath,
	rootSteps,
	scriptFor,
} from "./root-script.js";
import { type Feature, type Task, type TaskContext, TaskError } from "./tasks/types.js";

/** What the user chose to do with the assembled root script. */
export type RootChoice = "ran" | "run-for-me" | "skip";

/** The questions the runner asks. Implemented by the command; scripted in tests. */
export interface SetupPrompt {
	/**
	 * Asked once per round, with whatever root tasks are still failing. Returning
	 * "ran" is the default answer — the user ran it themselves.
	 */
	rootChoice(question: RootQuestion): Promise<RootChoice>;
}

export interface RootQuestion {
	/** The machine name, or "this machine" for a local setup. */
	machine: string;
	/** Where the script was written, and where to run it from. */
	path: string;
	/** Ids of the tasks that still need it. */
	tasks: string[];
}

/** What setup did. The command prints this; the tests assert on it. */
export interface SetupReport {
	/** Tasks that needed doing and now pass. */
	applied: string[];
	/** Tasks that were already fine. */
	alreadyOk: string[];
	/** Tasks not carried out: skipped by the user, or a fix that didn't take. */
	skipped: string[];
	/**
	 * Tasks whose install threw, with the reason. The run continues past them —
	 * one tool that 404s must not cost the user the other fourteen.
	 */
	failed: { id: string; reason: string }[];
	/** Where the root script was written, when one was. */
	rootScriptPath?: string;
}

export interface RunSetupOptions {
	/** Selected features. Tasks outside them don't run at all. */
	features: Feature[];
	/** The tasks to consider — normally `allTasks()`. Injected so tests use fakes. */
	tasks: Task[];
	prompt: SetupPrompt;
	/** Directory the root script is written into. Created if missing. */
	scratchDir: string;
}

/** Where the script is written, always the same name so it's findable. */
export const ROOT_SCRIPT_NAME = "hyper-machine-root.sh";

/** How the user addresses the target machine. */
function where(ctx: TaskContext): string {
	return ctx.machine === null ? "this machine" : `the "${ctx.machine.name}" machine`;
}

function detail(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Run one task's `check`, turning any failure into a message that names the task
 * and the machine. Without this the user gets a stack trace from inside a check,
 * with no clue which of a dozen tasks broke.
 */
async function checkTask(task: Task, ctx: TaskContext): Promise<boolean> {
	try {
		return await task.check(ctx);
	} catch (err) {
		throw new TaskError(
			task.id,
			`I couldn't check "${task.id}" (${task.title}) on ${where(ctx)}: ${detail(err)}`,
		);
	}
}

/**
 * Run a task's `apply`, with the same treatment as {@link checkTask}.
 *
 * A task is code we wrote, so its failures are bugs rather than the user's
 * problem — but "Error: EACCES" with no task id is not a bug report anyone can
 * act on. Same for the root script: a task that throws while generating it has
 * to say which one did.
 */
async function applyTask(task: Task, ctx: TaskContext): Promise<void> {
	if (task.apply === undefined) return;
	try {
		await task.apply(ctx);
	} catch (err) {
		throw new TaskError(
			task.id,
			`I couldn't apply "${task.id}" (${task.title}) on ${where(ctx)}: ${detail(err)}`,
		);
	}
}

/** The task's root script text, wrapped so a failure names the task. */
function rootScriptFor(task: Task, ctx: TaskContext): string {
	try {
		return scriptFor(task, ctx);
	} catch (err) {
		if (err instanceof TaskError) throw err;
		throw new TaskError(
			task.id,
			`I couldn't write the root steps for "${task.id}" (${task.title}) on ${where(ctx)}: ${detail(err)}`,
		);
	}
}

/**
 * The remote machine's home, for the copied script.
 *
 * `drive.toml`'s `home` is used when it's absolute, which is the normal case.
 * The probe is the fallback: `~` cannot be sent quoted (`remote.ts` documents
 * why a quoted `~` creates a literal directory named `~`), and guessing would
 * put the script somewhere the sudo command can't reach.
 */
async function remoteHome(ctx: TaskContext): Promise<string> {
	if (ctx.machine?.home?.startsWith("/")) return ctx.machine.home;
	const result = await ctx.runner.ssh(["sh", "-c", "echo $HOME"]);
	const home = result.stdout.trim();
	if (result.code === 0 && home.startsWith("/")) return home;
	throw new Error(
		`I couldn't work out the home directory on ${where(ctx)} (asked it, got ${JSON.stringify(result.stdout.trim()) || "nothing"}). Set \`home\` for this machine in your hyperdrive config, or run the script there yourself and pick "I've run it".`,
	);
}

/**
 * The one place hyper asks for a password (C-6).
 *
 * Reachable only when the user answers "run it for me" at the root prompt —
 * never from `--yes`, never from a flag. On a remote machine the script is
 * copied first (it has to exist there to be run there), and both hops ask for a
 * tty so sudo can prompt: without one, sudo fails with "no tty present and no
 * askpass program specified" instead of asking.
 */
async function runRootScript(ctx: TaskContext, localPath: string): Promise<RunResult> {
	if (ctx.machine === null) {
		// Local: tty:true is what makes the terminal (and the user's typing) reach
		// sudo. The runner's spawner inherits stdio for it.
		return ctx.runner.ssh(privilegedArgv(localPath), { tty: true });
	}
	const target = remoteScriptPath(await remoteHome(ctx));
	const copied = await ctx.runner.scp(localPath, target);
	if (copied.code !== 0) {
		throw new Error(
			`I couldn't copy the root script to ${where(ctx)}: ${copied.stderr.trim() || `exit ${copied.code}`}`,
		);
	}
	return ctx.runner.ssh(privilegedArgv(target), { tty: true });
}

/**
 * Run the selected tasks against one machine.
 *
 * Throws {@link TaskError} when a task's check throws — nothing after it runs.
 * Everything else (a script that couldn't be written, a failed scp) throws a
 * plain Error for the command to report.
 */
export async function runSetup(
	ctx: TaskContext,
	{ features, tasks, prompt, scratchDir }: RunSetupOptions,
): Promise<SetupReport> {
	const selected = tasks.filter((task) => features.includes(task.feature));
	const applied: string[] = [];
	const alreadyOk: string[] = [];
	const skipped: string[] = [];
	const failed: { id: string; reason: string }[] = [];
	const needsRoot: Task[] = [];

	for (const task of selected) {
		if (await checkTask(task, ctx)) {
			alreadyOk.push(task.id);
			continue;
		}
		if (task.needsRoot) {
			// Nothing is written yet: the script is assembled once, from every
			// failing root task, so the user reads one file before one sudo.
			needsRoot.push(task);
			continue;
		}
		if (task.apply === undefined) {
			ctx.log(`${task.id}: needs work but the task can't fix it itself — skipping.`);
			skipped.push(task.id);
			continue;
		}
		ctx.log(`${task.id}: doing it now.`);
		try {
			await applyTask(task, ctx);
		} catch (err) {
			// One tool failing is information, not a stop. A recipe that cannot
			// download its release says so, and the rest still get installed —
			// otherwise one 404 costs the user every tool they asked for.
			const reason = detail(err);
			ctx.log(`${task.id}: failed — ${reason}`);
			failed.push({ id: task.id, reason });
			skipped.push(task.id);
			continue;
		}
		if (await checkTask(task, ctx)) applied.push(task.id);
		else {
			ctx.log(`${task.id}: still not right after doing it — skipping.`);
			skipped.push(task.id);
		}
	}

	if (needsRoot.length === 0) return { applied, alreadyOk, skipped, failed };

	const entries: RootScriptEntry[] = needsRoot.map((task) => ({
		task,
		script: rootScriptFor(task, ctx),
	}));
	const script = assembleRootScript(entries, ctx);
	const path = join(scratchDir, ROOT_SCRIPT_NAME);
	await mkdir(scratchDir, { recursive: true });
	await writeFile(path, script, "utf-8");
	// writeFile's mode is masked by umask, and 0700 is the point: a root script
	// is a thing only its owner should read before running.
	await chmod(path, 0o700);

	ctx.log("");
	ctx.log(`Some steps on ${where(ctx)} need root. I wrote them to:`);
	ctx.log(`  ${path}`);
	ctx.log("");
	ctx.log("To run them yourself:");
	for (const line of rootSteps(ctx.machine, path)) ctx.log(`  ${line}`);
	ctx.log("");
	ctx.log(script);

	let remaining = needsRoot;
	while (remaining.length > 0) {
		const choice = await prompt.rootChoice({
			machine: ctx.machine?.name ?? "this machine",
			path,
			tasks: remaining.map((task) => task.id),
		});
		if (choice === "skip") {
			for (const task of remaining) skipped.push(task.id);
			ctx.log("Skipping the root steps. Run that script later whenever you're ready.");
			break;
		}
		if (choice === "run-for-me") {
			ctx.log("OK — I'll ask for your password now.");
			const result = await runRootScript(ctx, path);
			// Say what happened before re-checking. "Still to do" on its own is a
			// riddle when the real cause was three wrong password attempts.
			if (result.code !== 0) {
				const err = result.stderr.trim();
				ctx.log(`The root script on ${where(ctx)} exited ${result.code}${err ? `: ${err}` : "."}`);
			}
		}
		const still: Task[] = [];
		for (const task of remaining) {
			if (await checkTask(task, ctx)) applied.push(task.id);
			else still.push(task);
		}
		remaining = still;
		if (remaining.length === 0) break;
		ctx.log(`Still to do: ${remaining.map((task) => task.id).join(", ")}.`);
	}

	return { applied, alreadyOk, skipped, failed, rootScriptPath: path };
}
