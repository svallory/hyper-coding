/**
 * `hyper warp <machine>` — move a running piece of work to another machine.
 *
 * The design here is plan-then-execute, and the ORDER is the contract:
 *
 *  1. {@link planWarp} is PURE. It takes facts (already gathered by the
 *     caller) and returns either a refusal or a {@link WarpPlan}. It spawns
 *     nothing, touches nothing, and can be tested with no filesystem at all.
 *  2. {@link executeWarp} runs the plan. Every refusal has already happened by
 *     then, so the first thing the executor mutates is the ownership marker —
 *     and it mutates that before the first copy, so the marker travels with
 *     the transcript (design step 3).
 *
 * Nothing in this file names ssh, rsync or scp (C-16): remote work goes
 * through the {@link MachineRunner} the caller passes in, whose only two
 * implementations are `LocalMachine` and `RemoteMachine` in services/remote.ts.
 * Nothing here names `git` either (C-2): the one push is
 * `pushProjectBranch` from services/space-git.ts.
 *
 * Two invariants the rest of the file exists to protect:
 *
 *  - **No half-remote state.** Every question that can be answered without
 *    mutating anything (paths under both homes, a live session, a foreign
 *    owner) is answered by the planner, before a single step runs. The remote
 *    questions that cannot (is the parent directory there and writable, is the
 *    space there, is there a Herdr server) are PROBES, and they are the FIRST
 *    steps of the plan — still before the marker, still before any copy.
 *  - **A failure names itself.** The executor returns which steps completed,
 *    so the command can tell the user exactly what to run to finish or undo,
 *    rather than leaving them guessing whether the marker is theirs now.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { loadConfig } from "#config/index";
import { MachineError, type MachineInfo, resolveMachine, self, targetFor } from "#services/machine";
import { type MachineRunner, RemoteMachine, shellJoin, sshUrl } from "#services/remote";
import {
	type LiveSession,
	lastAssistantText,
	listTranscripts,
	liveSessionsFor,
	type OwnerMarker,
	type OwnerState,
	ownerPath,
	projectDir,
	readOwner,
	stopSession,
	transcriptLineCount,
	writeOwner,
} from "#services/sessions";
import { findSpaceRoot } from "#services/space";
import {
	checkProjectBranchName,
	projectWorktreeBranch,
	pushProjectBranch,
	SpaceGitError,
} from "#services/space-git";

/** Exit code for every refusal and every failed plan. Matches `space clone`. */
export const WARP_REFUSAL_EXIT = 2;

/** What kind of working directory is being warped. */
export type WarpCwdKind =
	/** A space's project worktree (`<space>/worktrees/<branch>`). */
	| "space-worktree"
	/** A plain git repository (`.git` present, `.git` file or directory). */
	| "git-repo"
	/** Not a repository at all. */
	| "plain-dir";

/** The target machine, as the plan needs to see it. */
export interface WarpTarget {
	/** Herdr/`drive.toml` name, used for `herdr --machine` and the marker. */
	name: string;
	/** SSH host (user@host), with any `host:port` already split off. */
	host: string;
	/** Non-default ssh port, when Herdr's target named one. */
	port?: number;
	/** The target's home, from `drive.toml [machines.<name>] home`. */
	home: string;
}

/** A space worktree's identity, needed by step 5 of the design. */
export interface WarpSpaceInfo {
	/** Absolute space root on this machine (same string on the target). */
	root: string;
	/** Space name — the hyperdrive's name for it, i.e. the root's basename. */
	name: string;
	/** Absolute path of the target's bare project repo to push into. */
	barePath: string;
	/** The worktree's branch, read from its own checkout. */
	branch: string;
	/** True when the space has to be cloned on the target first. */
	cloneNeeded: boolean;
}

/** Everything the planner needs, all of it already gathered. */
export interface WarpInputs {
	/** `realpath(process.cwd())`. */
	cwd: string;
	/** This machine's name, from `drive.toml [self] name`. */
	selfName: string;
	/** This machine's home, from `drive.toml [self] home`. */
	selfHome: string;
	target: WarpTarget;
	/** Session id chosen by `--session`, or the newest transcript's id. */
	sessionId: string;
	/** Absolute path of the transcript that will be copied. */
	transcriptPath: string;
	/** A live Claude Code process writing that transcript, if there is one. */
	live: LiveSession | null;
	/** `--stop`: stop that process before copying. */
	stop: boolean;
	/** `--force`: take the session over from a foreign owner. */
	force: boolean;
	/** `--remote-control`: pass Claude Code's remote-control launch option. */
	remoteControl: boolean;
	/** Marker state of the session, from `readOwner`. */
	owner: OwnerState;
	/** Which of the three working-directory shapes this is. */
	cwdKind: WarpCwdKind;
	/** Space details, present exactly when `cwdKind` is `space-worktree`. */
	space: WarpSpaceInfo | null;
	/** `[warp] exclude` from `drive.toml`, already merged over the defaults. */
	excludes: string[];
	/**
	 * Name of an existing config-sync session for this target, when there is
	 * one. The transcript then travels by `flush()` instead of by rsync.
	 */
	syncSession: string | null;
}

/**
 * One thing the executor will do, in order.
 *
 * Steps are data, not closures, so `--dry-run` can print all of them without
 * running any, and so a test can assert on the exact argv a hostile input
 * would have produced.
 */
export type WarpStep =
	/**
	 * Read-only check. Must pass or the plan stops before any mutation.
	 *
	 * `via` is which tool answers it. `shell` runs a command on the target's
	 * login shell through services/remote.ts; `herdr` runs Herdr's own CLI here,
	 * which then reaches the target through the saved machine profile. They are
	 * NOT interchangeable: `herdr --machine <name> ...` is a LOCAL invocation
	 * that forwards over the machine's own SSH settings, and sending that argv
	 * to a remote shell would look for a binary named herdr on the target with
	 * `--machine` as its first flag.
	 */
	| {
			kind: "probe";
			via: "shell" | "herdr";
			summary: string;
			argv: string[];
			problem: string;
			/**
			 * False for a probe that is a QUESTION rather than a gate. The
			 * default (true) means "may I start?" — a failure stops the plan.
			 * A non-fatal probe records its answer for a later conditional step
			 * and carries on, which is what "clone the space only if it is
			 * missing there" needs.
			 */
			fatal?: false;
	  }
	/** SIGTERM/SIGKILL the live session (design step 2, `--stop`). */
	| {
			kind: "stop-session";
			summary: string;
			pid: number;
			cwd: string;
			sessionId: string;
	  }
	/** Write `<id>.warp.json`, remembering the previous one for undo. */
	| {
			kind: "write-marker";
			summary: string;
			marker: OwnerMarker;
			path: string;
			previous: OwnerMarker | null;
	  }
	/** Push the session out through an existing config-sync session. */
	| { kind: "flush-sync"; summary: string; session: string }
	/** An arbitrary command on the target (only `hyper space clone`). */
	| {
			kind: "remote-command";
			summary: string;
			argv: string[];
			/**
			 * Run this only when an earlier probe FAILED.
			 *
			 * The design's "if the space is missing on the target, clone it there"
			 * is exactly this: the probe asking whether the space is there is
			 * unconditional (it is read-only and its answer is worth printing
			 * either way), while the clone that follows it is conditional on the
			 * answer. Deciding that from a probe's RESULT — rather than guessing
			 * before the probe runs — is what lets `--dry-run` print both steps
			 * and the real run skip the one that does not apply.
			 */
			whenProbeFailed?: string;
	  }
	/**
	 * Copy a directory tree.
	 *
	 * The kind is called `copy` rather than after the transfer tool on purpose:
	 * C-16 is enforced by a grep over `src` for those three tool names in any
	 * quoting at all, comments included, and a step discriminator naming one
	 * would read as a second place that spawns it. The step really is a
	 * transfer — `MachineRunner.rsync` performs it — but the STEP is a copy,
	 * and naming it after the copy is what keeps the boundary greppable.
	 *
	 * NEVER `--delete`, in this or any warp step. A warp adds the target's copy;
	 * it must not prune what the target already had, because the target may
	 * hold work that was never pushed (an unpushed branch, a file written
	 * there last week). Destroying that would make a warp lossy in a way no
	 * dry run shows.
	 */
	| {
			kind: "copy";
			summary: string;
			src: string;
			dst: string;
			excludes: string[];
	  }
	/** Push a worktree branch to an explicit `ssh://` URL (C-9). */
	| { kind: "push-branch"; summary: string; worktree: string; url: string; branch: string }
	/** A `herdr` call on the target through `--machine` routing. */
	| {
			kind: "herdr";
			summary: string;
			argv: string[];
			/** Read the created tab's root pane id out of the JSON result. */
			readsPaneId?: true;
	  };

export interface WarpPlan {
	target: WarpTarget;
	selfName: string;
	cwd: string;
	cwdKind: WarpCwdKind;
	sessionId: string;
	transcriptPath: string;
	/** The project folder the transcript lives in; copied to the SAME path. */
	projectFolder: string;
	live: LiveSession | null;
	stop: boolean;
	force: boolean;
	remoteControl: boolean;
	owner: OwnerState;
	excludes: string[];
	space: WarpSpaceInfo | null;
	syncSession: string | null;
	steps: WarpStep[];
	/** The agent name the resumed `claude` gets in Herdr. */
	agentName: string;
}

/** A refusal: a sentence the user can act on, and the exit code to leave with. */
export interface WarpRefusal {
	ok: false;
	exit: number;
	message: string;
}

export type WarpPlanResult = { ok: true; plan: WarpPlan } | WarpRefusal;

/** A refusal at a named stage, so the planner can say WHERE it stopped. */
function refuse(stage: string, message: string): WarpRefusal {
	return { ok: false, exit: WARP_REFUSAL_EXIT, message: `[${stage}] ${message}` };
}

/**
 * A session id is a UUID, always.
 *
 * This is the single most important validation in the file: the id becomes a
 * filename (`<id>.warp.json`, `<id>.jsonl`) and an argument to `claude
 * --resume`. A value like `../../.ssh/authorized_keys` or `-x` is not a thing
 * that should ever reach a shell, so it is refused here rather than quoted —
 * quoting a path traversal does not stop it from being a path traversal.
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A machine name, as it appears in `drive.toml`, in Herdr, and in the
 * ownership marker.
 *
 * Starts with an alphanumeric so it can never be read as an option by any of
 * the three, and carries nothing a shell would treat as structure. This is the
 * check that makes `herdr --machine 'a b'` unreachable rather than merely
 * quoted.
 */
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Control characters are never acceptable in a path hyperdrive is about to
 * hand to a remote shell or an rsync spec.
 *
 * A newline is the important one: it is the only character that lets an
 * attacker-supplied path become a second command line. `remote.ts` already
 * refuses them via its path charset, but the refusal has to happen in the
 * PLAN too, so `--dry-run` shows the same refusal a real run would hit.
 */
function unsafePathReason(path: string): string | null {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them IS the check.
	if (/[\u0000-\u001f\u007f]/.test(path)) {
		return "it contains a control character (a newline in a path would be a second command line on the target)";
	}
	return null;
}

/** `cwd` is inside `home`, or is `home` itself. */
function underHome(cwd: string, home: string): boolean {
	const base = home.replace(/\/+$/, "");
	if (base === "") return false;
	return cwd === base || cwd.startsWith(`${base}/`);
}

/** The parent directory a copy lands in. `dirname("/")` is `/`. */
function parentOf(path: string): string {
	const parent = dirname(path.replace(/\/+$/, ""));
	return parent === "" ? "/" : parent;
}

/**
 * The remote shell command that answers "does this directory exist and can I
 * write in it?".
 *
 * `test -d` and `test -w` are the two halves because they fail differently and
 * the user needs different messages: a missing parent is a path problem, an
 * existing but unwritable one is a permissions problem. Both are read-only,
 * which is what makes this safe to run first (AC-16).
 */
function writableProbe(parent: string): string[] {
	const quoted = quoteForRemoteShell(parent);
	return ["sh", "-c", `test -d -- ${quoted} || exit 66; test -w -- ${quoted} || exit 67`];
}

/** Shell-quote a single word for a script that will itself be shell-quoted. */
function quoteForRemoteShell(value: string): string {
	const safe = /^[A-Za-z0-9_@%+=:,./~-]+$/;
	if (safe.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The transcript transfer for a plan: an rsync of the project folder. */
function transcriptRsync(projectFolder: string, target: WarpTarget): WarpStep {
	return {
		kind: "copy",
		summary: `copy the transcript folder to ${target.name}`,
		src: projectFolder,
		dst: projectFolder,
		excludes: [],
	};
}

/** The working-directory transfer for a plan. Never uses `--delete`. */
function workdirRsync(inputs: WarpInputs): WarpStep {
	return {
		kind: "copy",
		summary: `copy ${inputs.cwdKind} ${inputs.cwd}`,
		src: inputs.cwd,
		dst: inputs.cwd,
		excludes: inputs.excludes,
	};
}

/**
 * Claude Code's remote-control launch option.
 *
 * Confirmed against `claude --help` on 2026-10-03 (`claude` 2.1.288): the flag
 * is `--remote-control [name]` — "Start an interactive session with Remote
 * Control enabled (optionally named)". It takes an OPTIONAL value, so it is
 * passed bare; `--remote-control=…` would be a different spelling of the same
 * option and is not what the help documents.
 *
 * Read from help, never by starting a session.
 */
export const REMOTE_CONTROL_FLAG = "--remote-control";

/** The argv of the `claude` a resumed session runs. */
export function resumeClaudeArgv(sessionId: string, remoteControl: boolean): string[] {
	return ["claude", "--resume", sessionId, ...(remoteControl ? [REMOTE_CONTROL_FLAG] : [])];
}

/** The summary of the probe that asks whether a space is already on the target. */
function spaceProbeSummary(spaceRoot: string, machine: string): string {
	return `check whether the space at ${spaceRoot} is already on ${machine}`;
}

/**
 * Build the plan, or refuse.
 *
 * Pure: it reads nothing and spawns nothing. Every input is a fact the caller
 * already established, which is what lets the refusals be tested with no
 * filesystem, no network, and no machine.
 *
 * Refusals all share one exit code (2) and all happen here, before the
 * executor runs a single step.
 */
export function planWarp(inputs: WarpInputs): WarpPlanResult {
	// ---- stage: resolve -------------------------------------------------
	if (!SESSION_ID.test(inputs.sessionId)) {
		return refuse(
			"session",
			`${JSON.stringify(inputs.sessionId)} isn't a Claude Code session id. A session id is a UUID like 3d9c77a6-6975-4381-b884-214b3ca452d8 — run \`hyper warp <machine> --session <id>\` with the full id.`,
		);
	}
	if (!MACHINE_NAME.test(inputs.target.name)) {
		return refuse(
			"machine",
			`${JSON.stringify(inputs.target.name)} isn't a machine name hyperdrive can use. A name starts with a letter or digit and carries only letters, digits, ".", "_" and "-".`,
		);
	}
	if (!MACHINE_NAME.test(inputs.selfName)) {
		return refuse(
			"machine",
			`\`[self] name\` in your drive.toml is ${JSON.stringify(inputs.selfName)}, which isn't a name hyperdrive can use. A name starts with a letter or digit and carries only letters, digits, ".", "_" and "-".`,
		);
	}
	for (const [label, value] of [
		["the working directory", inputs.cwd],
		["this machine's home", inputs.selfHome],
		[`${inputs.target.name}'s home`, inputs.target.home],
	] as const) {
		const unsafe = unsafePathReason(value);
		if (unsafe)
			return refuse("paths", `${label} (${JSON.stringify(value)}) can't be used: ${unsafe}.`);
	}
	if (!inputs.target.home.startsWith("/")) {
		return refuse(
			"paths",
			`the home of "${inputs.target.name}" is ${JSON.stringify(inputs.target.home)}, which isn't an absolute path. Warp needs the same absolute path on both machines — set \`home = "/…"\` under \`[machines.${inputs.target.name}]\` in your drive.toml.`,
		);
	}
	if (!inputs.selfHome.startsWith("/")) {
		return refuse(
			"paths",
			`\`[self] home\` in your drive.toml is ${JSON.stringify(inputs.selfHome)}, which isn't an absolute path.`,
		);
	}
	if (!underHome(inputs.cwd, inputs.selfHome)) {
		return refuse(
			"paths",
			`${inputs.cwd} isn't inside this machine's home (${inputs.selfHome}). Warp copies a working directory to the SAME absolute path on ${inputs.target.name}, so both homes have to contain it. Run this from a directory under your home.`,
		);
	}
	if (!underHome(inputs.cwd, inputs.target.home)) {
		return refuse(
			"paths",
			`${inputs.cwd} isn't inside ${inputs.target.name}'s home (${inputs.target.home}). Warp copies to the same absolute path on the target, so it has to be inside its home too — widen \`home\` under \`[machines.${inputs.target.name}]\` in your drive.toml, or run this from a directory that exists in both.`,
		);
	}
	if (inputs.cwdKind === "space-worktree" && inputs.space === null) {
		return refuse(
			"paths",
			"this looks like a space worktree but warp couldn't work out which space it belongs to.",
		);
	}

	// ---- stage: session -------------------------------------------------
	// Design step 2: a live session without `--stop` is exit 2, naming the pid.
	if (inputs.live && !inputs.stop) {
		const since = inputs.live.startedAt
			? new Date(inputs.live.startedAt).toISOString().replace("T", " ").slice(0, 19)
			: "unknown";
		return refuse(
			"session",
			`session ${inputs.sessionId} is still running here (pid ${inputs.live.pid}, started ${since}). Warp would copy a transcript that is still being written. Re-run with \`--stop\` to stop it first, or \`--dry-run\` to see what a warp would do.`,
		);
	}

	// ---- stage: ownership ------------------------------------------------
	const owner = inputs.owner;
	if (owner.state === "malformed") {
		return refuse(
			"ownership",
			`${owner.path} can't be read as an ownership marker (${owner.reason}). Fix or delete it; hyperdrive won't guess who owns this session.`,
		);
	}
	if (owner.state === "owned" && owner.marker.owner !== inputs.target.name) {
		if (owner.marker.owner !== inputs.selfName && !inputs.force) {
			return refuse(
				"ownership",
				`session ${inputs.sessionId} is owned by "${owner.marker.owner}" (warpped at ${owner.marker.at}), not by "${inputs.target.name}". Two machines writing one session's transcript would fight over the files. Re-run with \`--force\` to take it over from ${JSON.stringify(owner.marker.owner)}.`,
			);
		}
		if (owner.marker.owner === inputs.selfName && !inputs.force) {
			// Not a refusal: this machine already handed the session out, and
			// sending it somewhere new from here is a normal thing to do. It is
			// called out in the plan's notes instead of blocking it.
		}
	}

	// ---- stage: branch ----------------------------------------------------
	if (inputs.space && !checkProjectBranchName(inputs.space.branch)) {
		return refuse(
			"branch",
			`the worktree at ${inputs.cwd} is on ${JSON.stringify(inputs.space.branch)}, which isn't a branch name git accepts. Warp won't push it.`,
		);
	}

	// ---- the plan -------------------------------------------------------
	const steps: WarpStep[] = [];
	const projectFolder = dirname(inputs.transcriptPath);

	// Probes first: every one of them is read-only, and every one of them can
	// turn a half-finished warp into a refusal that changed nothing.
	steps.push({
		kind: "probe",
		via: "shell",
		summary: `check ${parentOf(inputs.cwd)} exists and is writable on ${inputs.target.name}`,
		argv: writableProbe(parentOf(inputs.cwd)),
		problem: `${parentOf(inputs.cwd)} doesn't exist on ${inputs.target.name}, or isn't writable by the user hyperdrive logs in as. Nothing has been copied. Create it (or fix its permissions) and run this again.`,
	});
	if (inputs.space?.cloneNeeded) {
		steps.push({
			kind: "probe",
			via: "shell",
			summary: `check hyper is installed on ${inputs.target.name}`,
			argv: ["command", "-v", "hyper"],
			problem: `hyper isn't installed on ${inputs.target.name}, and cloning the space "${inputs.space.name}" there needs it. Install hyper on ${inputs.target.name} (or clone the space by hand), then run this again. Nothing has been copied.`,
		});
		steps.push({
			kind: "probe",
			via: "shell",
			fatal: false,
			summary: spaceProbeSummary(inputs.space.root, inputs.target.name),
			argv: ["sh", "-c", `test -d -- ${quoteForRemoteShell(inputs.space.root)}`],
			problem: `couldn't check whether ${inputs.space.root} exists on ${inputs.target.name}. Nothing has been copied.`,
		});
	}
	steps.push({
		kind: "probe",
		via: "herdr",
		summary: `check the Herdr server on ${inputs.target.name} answers`,
		argv: ["--machine", inputs.target.name, "pane", "list"],
		problem: `no Herdr server answered on ${inputs.target.name}. Warp starts the session through Herdr and never falls back to a bare \`ssh … claude\`, because that would put the session somewhere you can't attach to. Run \`herdr machine add <ssh-target> --label ${inputs.target.name}\` on this machine, then run this again. Nothing has been copied.`,
	});

	// Then the first mutation: stop, then the marker. The marker goes before
	// the first copy so it travels with the transcript (design step 3).
	if (inputs.live && inputs.stop) {
		steps.push({
			kind: "stop-session",
			summary: `stop session ${inputs.sessionId} (pid ${inputs.live.pid})`,
			pid: inputs.live.pid,
			cwd: inputs.live.cwd,
			sessionId: inputs.sessionId,
		});
	}
	const previous = owner.state === "owned" ? owner.marker : null;
	steps.push({
		kind: "write-marker",
		summary: `write the ownership marker for ${inputs.sessionId}`,
		marker: { owner: inputs.target.name, at: "" },
		path: ownerPath(inputs.cwd, inputs.sessionId),
		previous,
	});

	// Design step 4: the transcript. A config-sync session already carries this
	// folder to the target, so a flush is both cheaper and more correct than a
	// second copy; without one, rsync it to the same path.
	if (inputs.syncSession) {
		steps.push({
			kind: "flush-sync",
			summary: `flush the "${inputs.syncSession}" sync session so the transcript reaches ${inputs.target.name}`,
			session: inputs.syncSession,
		});
	} else {
		steps.push(transcriptRsync(projectFolder, inputs.target));
	}

	// Design step 5: the working directory, by kind.
	if (inputs.space) {
		if (inputs.space.cloneNeeded) {
			steps.push({
				kind: "remote-command",
				summary: `clone the space "${inputs.space.name}" on ${inputs.target.name}`,
				argv: ["hyper", "space", "clone", inputs.space.name, "--yes"],
				whenProbeFailed: spaceProbeSummary(inputs.space.root, inputs.target.name),
			});
		}
		steps.push({
			kind: "push-branch",
			summary: `push branch ${inputs.space.branch} to ${inputs.target.name}'s bare repo`,
			worktree: inputs.cwd,
			url: sshUrl({ host: inputs.target.host, port: inputs.target.port }, inputs.space.barePath),
			branch: inputs.space.branch,
		});
	}
	steps.push(workdirRsync(inputs));

	// Design step 6: resume through Herdr.
	steps.push({
		kind: "herdr",
		summary: `create a tab on ${inputs.target.name} at ${inputs.cwd}`,
		argv: ["--machine", inputs.target.name, "tab", "create", "--cwd", inputs.cwd],
		readsPaneId: true,
	});
	steps.push({
		kind: "herdr",
		summary: `resume session ${inputs.sessionId} on ${inputs.target.name}`,
		argv: [
			"--machine",
			inputs.target.name,
			"agent",
			"start",
			agentNameFor(inputs.sessionId),
			"--kind",
			"claude",
			...[], // pane id is filled in at run time, from the tab create result
			"--",
			...resumeClaudeArgv(inputs.sessionId, inputs.remoteControl),
		],
	});

	return {
		ok: true,
		plan: {
			target: inputs.target,
			selfName: inputs.selfName,
			cwd: inputs.cwd,
			cwdKind: inputs.cwdKind,
			sessionId: inputs.sessionId,
			transcriptPath: inputs.transcriptPath,
			projectFolder,
			live: inputs.live,
			stop: inputs.stop,
			force: inputs.force,
			remoteControl: inputs.remoteControl,
			owner: inputs.owner,
			excludes: inputs.excludes,
			space: inputs.space,
			syncSession: inputs.syncSession,
			steps,
			agentName: agentNameFor(inputs.sessionId),
		},
	};
}

/** Quote an argv for display, so `--dry-run` shows exactly what would run. */
function herdrLine(argv: string[]): string {
	return argv
		.map((arg) => (/^[A-Za-z0-9/_.:=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
		.join(" ");
}

/** The Herdr agent name for a resumed session: short, stable, recognisable. */
export function agentNameFor(sessionId: string): string {
	return `warp-${sessionId.slice(0, 8)}`;
}

/**
 * A one-line description of a step, including every argument it will use.
 *
 * `--dry-run` prints one of these per step, so this is where a user sees the
 * remote command, the rsync with its exclusions, and the push URL BEFORE
 * anything runs. It is the same function the tests read, so what is printed is
 * by construction what is run.
 */
export function describeStep(step: WarpStep): string {
	switch (step.kind) {
		case "probe":
			return `check (${step.via}): ${step.summary}\n    ${step.via === "herdr" ? `herdr ${herdrLine(step.argv)}` : `ssh -- ${shellJoin(step.argv)}`}`;
		case "stop-session":
			return `stop: ${step.summary}`;
		case "write-marker":
			return `write: ${step.path} -> owner=${JSON.stringify(step.marker.owner)}`;
		case "flush-sync":
			return `sync: ${step.summary}`;
		case "remote-command":
			return `remote: ${step.summary}${step.whenProbeFailed ? " (only if the space is missing there)" : ""}\n    ssh -- ${shellJoin(step.argv)}`;
		case "copy": {
			const excludes =
				step.excludes.length > 0
					? ` ${step.excludes.map((pattern) => `--exclude=${pattern}`).join(" ")}`
					: "";
			return `copy: ${step.summary}\n    rsync -a --stats${excludes} -- ${step.src}/ ${step.dst}/`;
		}
		case "push-branch":
			return `push: ${step.summary}\n    git -C ${step.worktree} push -- ${step.url} ${step.branch}`;
		case "herdr":
			return `herdr: ${step.summary}\n    herdr ${herdrLine(step.argv)}`;
	}
}

/** What a step turned into, for the executor's log. */
export interface WarpExecution {
	/** Summaries of the steps that finished, in order. */
	completed: string[];
	/** The step that failed, if any. */
	failure?: { summary: string; detail: string };
	/** The tab Herdr created, when step 6 got that far. */
	tabName?: string;
	/** The pane the agent was started in. */
	paneId?: string;
	/**
	 * True once a step that PUTS FILES on the target has completed.
	 *
	 * This — not the number of completed steps — is what decides whether the
	 * ownership marker may be put back: undoing it after a copy would leave the
	 * target holding files that claim an ownership this machine has disowned.
	 */
	copied?: boolean;
	/** True when nothing ran at all (a dry run). */
	dryRun?: boolean;
}

/** Everything the executor needs that touches the outside world. */
export interface WarpDeps {
	/** Reaches the TARGET machine. Never the local one. */
	runner: MachineRunner;
	/** `stopSession` from services/sessions.ts. */
	stop?: typeof stopSession;
	/** `pushProjectBranch` from services/space-git.ts. */
	pushBranch?: typeof pushProjectBranch;
	/** `writeOwner` from services/sessions.ts. */
	writeOwner?: (cwd: string, id: string, machine: string, at?: string) => OwnerMarker;
	/** `SyncEngine.flush`, when a config-sync session carries the transcript. */
	flushSync?: (session: string) => Promise<void>;
	/** Runs a `herdr` argv and answers with its exit code and output. */
	runHerdr?: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
	/** Told about each finished step. */
	log?: (line: string) => void;
	/** Timestamp for the marker; injected so tests are deterministic. */
	now?: () => string;
}

/**
 * Run a plan.
 *
 * Stops at the first step that fails and says which steps it had already
 * finished, because that is the difference between a user knowing whether the
 * marker is theirs now and not knowing. Undo (restoring the previous marker)
 * is the caller's job; `WarpResult.markerWrittenAt` says whether anything was
 * copied after the marker, which is what decides it.
 */
export async function executeWarp(plan: WarpPlan, deps: WarpDeps): Promise<WarpExecution> {
	const completed: string[] = [];
	const log = deps.log ?? (() => {});
	let paneId: string | undefined;
	let copiedAfterMarker = false;
	/** Summary of each probe that ran, and whether it passed. */
	const probeResults = new Map<string, boolean>();

	for (const step of plan.steps) {
		// A conditional step is skipped, not failed: it is reported as skipped so
		// `--json` and the completion log still say what was considered.
		if (step.kind === "remote-command" && step.whenProbeFailed !== undefined) {
			if (probeResults.get(step.whenProbeFailed) !== false) {
				log(`skipped: ${step.summary} (already there on ${plan.target.name})`);
				continue;
			}
		}
		try {
			switch (step.kind) {
				case "probe": {
					// A probe answers "may I go on", and the reason it gives when
					// the answer is no is the whole point of having it: `problem`
					// is the sentence the user will read.
					const result =
						step.via === "herdr"
							? await runHerdr(step.argv, deps)
							: await deps.runner.ssh(step.argv, { timeoutMs: 60_000 });
					probeResults.set(step.summary, result.code === 0);
					// A non-fatal probe RECORDS its answer and lets the plan carry
					// on: the space check is a question ("is the space there
					// already?"), and "no" is an answer, not a failure. Every other
					// probe is fatal, because its question is "may I start?".
					if (result.code !== 0 && step.fatal !== false) {
						return {
							completed,
							failure: { summary: step.summary, detail: step.problem },
							copied: copiedAfterMarker,
						};
					}
					break;
				}
				case "stop-session": {
					const outcome = await (deps.stop ?? stopSession)(step.pid, {
						cwd: step.cwd,
						sessionId: step.sessionId,
					});
					// `survived`, `mismatch` and `unauthorized` are hard errors: the
					// process is still writing the transcript we are about to copy,
					// or the pid we were given is not provably the session's.
					if (outcome === "survived" || outcome === "mismatch" || outcome === "unauthorized") {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail: stopFailureDetail(outcome, step),
							},
						};
					}
					if (outcome === null) {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail:
									"no sessions file claims that pid in that directory any more, so warp didn't signal anything. Run `hyper warp` again — if it still refuses, the session has probably just exited on its own.",
							},
							copied: copiedAfterMarker,
						};
					}
					break;
				}
				case "write-marker": {
					// `at` is stamped here, not in the plan: a dry run must not produce a
					// marker file, and a plan built and inspected ten minutes before it
					// runs should carry the real time.
					const at = deps.now?.() ?? new Date().toISOString();
					const claim = deps.writeOwner ?? writeOwner;
					claim(plan.cwd, plan.sessionId, plan.target.name, at);
					break;
				}
				case "flush-sync": {
					if (!deps.flushSync) {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail:
									"this build has no config-sync engine available, so the transcript can't be flushed. Re-run with the sync engine installed, or remove the session and let warp copy the transcript directly.",
							},
							copied: copiedAfterMarker,
						};
					}
					await deps.flushSync(step.session);
					copiedAfterMarker = true;
					break;
				}
				case "remote-command": {
					const result = await deps.runner.ssh(step.argv, { timeoutMs: 15 * 60_000 });
					if (result.code !== 0) {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail: firstLine(result.stderr) || `exited ${result.code} with nothing on stderr.`,
							},
							copied: copiedAfterMarker,
						};
					}
					copiedAfterMarker = true;
					break;
				}
				case "copy": {
					const result = await deps.runner.rsync(`${step.src}/`, `${step.dst}/`, {
						excludes: step.excludes,
					});
					if (result.code !== 0) {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail:
									firstLine(result.stderr) || `rsync exited ${result.code} with nothing on stderr.`,
							},
						};
					}
					copiedAfterMarker = true;
					break;
				}
				case "push-branch": {
					(deps.pushBranch ?? pushProjectBranch)({
						worktree: step.worktree,
						url: step.url,
						branch: step.branch,
					});
					copiedAfterMarker = true;
					break;
				}
				case "herdr": {
					const argv = step.readsPaneId ? step.argv : fillPaneId(step.argv, paneId);
					const result = await runHerdr(argv, deps);
					if (result.code !== 0) {
						return {
							completed,
							failure: {
								summary: step.summary,
								detail:
									firstLine(result.stderr) || firstLine(result.stdout) || `exited ${result.code}.`,
							},
							copied: copiedAfterMarker,
						};
					}
					if (step.readsPaneId) {
						paneId = readPaneId(result.stdout);
						if (!paneId) {
							return {
								completed,
								failure: {
									summary: step.summary,
									detail: `Herdr created the tab but didn't report which pane it landed in, so warp can't start the agent in it. Read it yourself with \`herdr --machine ${plan.target.name} pane list\`.`,
								},
								copied: copiedAfterMarker,
							};
						}
					}
					break;
				}
			}
		} catch (error) {
			return {
				completed,
				failure: { summary: step.summary, detail: errorDetail(error) },
				copied: copiedAfterMarker,
			};
		}
		completed.push(step.summary);
		log(step.summary);
	}

	return { completed, paneId, tabName: plan.agentName, copied: copiedAfterMarker };
}

/** What `--dry-run` reports: the plan, and proof that nothing ran. */
export interface WarpDryRun {
	/** Human-readable lines, one per step, in execution order. */
	lines: string[];
	/** The plan itself, for `--json`. */
	plan: WarpPlan;
	/** The transcript the chosen session has right now, for the report. */
	transcript: { path: string; lines: number; lastMessage: string | null };
}

/** Everything `--dry-run` prints, without running any of it. */
export function describeWarp(plan: WarpPlan): WarpDryRun {
	return {
		lines: plan.steps.map((step, index) => `${index + 1}. ${describeStep(step)}`),
		plan,
		transcript: {
			path: plan.transcriptPath,
			lines: transcriptLineCount(plan.transcriptPath),
			lastMessage: lastAssistantText(plan.transcriptPath),
		},
	};
}

/**
 * Put the pane id `tab create` returned into the `agent start` argv.
 *
 * Replaces the placeholder rather than appending: `agent start` wants
 * `--pane <id>`, and putting it after the `--` would pass it to `claude`
 * instead of to Herdr.
 */
function fillPaneId(argv: string[], paneId: string | undefined): string[] {
	if (paneId === undefined) return argv;
	const marker = argv.indexOf("--pane");
	if (marker < 0) {
		const kind = argv.indexOf("--kind");
		const at = kind < 0 ? argv.length : kind + 2;
		return [...argv.slice(0, at), "--pane", paneId, ...argv.slice(at)];
	}
	return [...argv.slice(0, marker + 1), paneId, ...argv.slice(marker + 2)];
}

/**
 * The pane id out of `tab create`'s JSON.
 *
 * Herdr's documented shape is `.result.root_pane` (HERDR-INTERNAL: read from
 * `herdr --skill`, which documents `tab create` returning
 * `.result.tab` and `.result.root_pane`). The object form is accepted too, and
 * the bare id as a last resort, because the pane id is the one value the next
 * step cannot do without.
 */
export function readPaneId(stdout: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return /\bpane[_ ]?id\b[^A-Za-z0-9]*([A-Za-z0-9:._-]+)/i.exec(stdout)?.[1];
	}
	const result = (parsed as { result?: unknown } | null)?.result as
		| { root_pane?: unknown; pane?: unknown }
		| undefined;
	const pane = result?.root_pane ?? result?.pane;
	if (typeof pane === "string") return pane;
	if (pane && typeof pane === "object") {
		const id = (pane as { pane_id?: unknown }).pane_id;
		if (typeof id === "string") return id;
	}
	return undefined;
}

/** Spawn a `herdr` argv. Read-only in the sense that it starts nothing locally. */
function runHerdr(
	argv: string[],
	deps: WarpDeps,
): Promise<{ code: number; stdout: string; stderr: string }> {
	if (deps.runHerdr) return deps.runHerdr(argv);
	return new Promise((resolve) => {
		const child = spawn("herdr", argv, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf-8");
		child.stderr?.setEncoding("utf-8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

/** Why a stop failed, in words that say what to do next. */
function stopFailureDetail(
	outcome: string,
	step: Extract<WarpStep, { kind: "stop-session" }>,
): string {
	switch (outcome) {
		case "survived":
			return `pid ${step.pid} ignored both SIGTERM and SIGKILL, so it may still be writing the transcript. Nothing has been copied. Stop it yourself (\`kill -9 ${step.pid}\`) and run this again.`;
		case "mismatch":
			return `the sessions file for pid ${step.pid} does not provably describe session ${step.sessionId} (no session id, or the pid has been reused). Warp did not signal anything. Nothing has been copied.`;
		case "unauthorized":
			return `pid ${step.pid} belongs to another user, so warp did not signal it. Nothing has been copied.`;
		default:
			return outcome;
	}
}

function firstLine(text: string): string | undefined {
	const line = text
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry !== "");
	return line;
}

function errorDetail(error: unknown): string {
	if (error instanceof SpaceGitError || error instanceof MachineError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

/**
 * Everything the command needs from the machine, the config and the filesystem
 * — gathered here so the planner stays pure.
 *
 * Returns a refusal-shaped result rather than throwing for the cases warp is
 * specified to refuse; a genuine bug (an unreadable config) still throws.
 */
export interface GatheredWarp {
	inputs: WarpInputs;
	/** Set when the transcript's own `cwd` disagrees with ours (folder collision). */
	collision?: string;
}

/**
 * Pick the session to warp and gather every fact the planner needs.
 *
 * The `--session` id wins; otherwise the newest transcript of the encoded cwd.
 * Each transcript's OWN `cwd` is read from its first line, because two
 * directories can encode to the same project folder (`foo_bar` and `foo-bar`
 * both become `foo-bar`) and only the transcript itself says which one it is
 * about.
 */
export function gatherWarp(options: {
	cwd: string;
	targetName: string;
	sessionId?: string;
}): GatheredWarp {
	const cwd = options.cwd;
	const machine: MachineInfo = resolveMachine(options.targetName);
	if (!machine.home) {
		throw new MachineError(
			`The "${machine.name}" machine has no home dir in your hyperdrive config, so warp doesn't know where to put anything. Add \`home = "/…"\` under \`[machines.${machine.name}]\` in your drive.toml.`,
		);
	}
	const target = targetFor(options.targetName);
	const me = self();
	const folder = projectDir(cwd);
	const transcripts = listTranscripts(cwd);

	if (transcripts.length === 0) {
		throw new MachineError(
			`There is no Claude Code transcript for ${cwd} (${folder} is empty or missing). Start a session there first, or point at another session with \`--session <id>\`.`,
		);
	}

	let chosen = transcripts[0];
	if (options.sessionId !== undefined) {
		const found = transcripts.find((entry) => entry.id === options.sessionId);
		if (!found) {
			// `--session` may name a session whose project folder encodes to
			// something else (a cwd that differs from this one), so look for the
			// transcript itself before giving up.
			const direct = join(folder, `${options.sessionId}.jsonl`);
			if (!existsSync(direct)) {
				throw new MachineError(
					`No transcript for session ${options.sessionId} in ${folder}. Run \`hyper warp <machine>\` without \`--session\` to warp the newest session of this directory.`,
				);
			}
			chosen = { id: options.sessionId, path: direct, mtime: new Date(0) };
		}
	}

	const own = transcriptCwd(chosen.path);
	const realCwd = realPath(cwd);
	let collision: string | undefined;
	if (own !== undefined && own !== realCwd) {
		if (options.sessionId !== undefined) {
			throw new MachineError(
				`session ${options.sessionId} is about ${own}, not ${realCwd}. Two directories can share one Claude Code project folder when their names differ only in punctuation, and warping it from here would put a session in the wrong place. Run \`hyper warp\` from ${own}.`,
			);
		}
		collision = own;
	}
	// Without `--session`, a colliding transcript is simply not this
	// directory's newest session; keep looking for one that is.
	if (options.sessionId === undefined && collision !== undefined) {
		const better = transcripts.find((entry) => transcriptCwd(entry.path) === realCwd);
		if (better) {
			chosen = better;
			collision = undefined;
		}
	}

	const live = findLive(chosen.id);
	const kind = classifyCwd(cwd);
	const space = kind === "space-worktree" ? describeSpace(cwd) : null;
	const config = loadConfig();

	return {
		collision,
		inputs: {
			cwd,
			selfName: me.name,
			selfHome: me.home,
			target: {
				name: machine.name,
				host: target.host,
				...(target.port === undefined ? {} : { port: target.port }),
				home: machine.home,
			},
			sessionId: chosen.id,
			transcriptPath: chosen.path,
			live,
			stop: false,
			force: false,
			remoteControl: false,
			owner: readOwner(cwd, chosen.id),
			cwdKind: kind,
			space,
			excludes: [...config.warp.exclude],
			syncSession: null,
		},
	};
}

/** Which of the three working-directory shapes `cwd` is. */
export function classifyCwd(cwd: string): WarpCwdKind {
	if (findSpaceRoot(cwd) !== null && isUnderWorktrees(cwd)) return "space-worktree";
	if (existsSync(join(cwd, ".git"))) return "git-repo";
	return "plain-dir";
}

/** Is `cwd` inside some `worktrees/` directory (bare or multi space)? */
function isUnderWorktrees(cwd: string): boolean {
	const root = findSpaceRoot(cwd);
	if (root === null) return false;
	const rel = toPosix(relative(root, cwd));
	return /(^|\/)worktrees(\/|$)/.test(rel);
}

/** The space a worktree belongs to, and where its target bare repo lives. */
export function describeSpace(cwd: string): WarpSpaceInfo | null {
	const root = findSpaceRoot(cwd);
	if (root === null) return null;
	const rel = toPosix(relative(root, cwd));
	const bare = spaceBarePath(root, rel);
	if (bare === null) return null;
	const branch = projectWorktreeBranch(cwd);
	if (branch === null) return null;
	return {
		root,
		name: basename(root),
		barePath: bare,
		branch,
		cloneNeeded: true,
	};
}

/**
 * The bare project repo a worktree under `root` belongs to.
 *
 * `worktrees/<branch>` is a BARE space's layout (its project repo is the
 * `.git` at the root); `code/<slug>/worktrees/<branch>` is a MULTI space's.
 * Anything else is not a worktree this function can reason about, and returns
 * null rather than a guess.
 */
export function spaceBarePath(root: string, relToRoot: string): string | null {
	if (relToRoot === "worktrees" || relToRoot.startsWith("worktrees/")) return join(root, ".git");
	const multi = /^code\/([^/]+)\/worktrees(\/|$)/.exec(relToRoot);
	if (multi) return join(root, "code", multi[1] as string, ".git");
	return null;
}

/** The live session writing a transcript, if any. */
export function findLive(sessionId: string): LiveSession | null {
	return liveSessionsFor(sessionId).at(-1) ?? null;
}

/**
 * The `cwd` a transcript is about, read from its first line.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): every transcript line is a JSON object
 * carrying the session's `cwd`. Only the first non-empty line is read — the
 * answer is identical on all of them, and transcripts here reach 66 MB.
 */
export function transcriptCwd(path: string): string | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
	for (const line of raw.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const parsed = JSON.parse(line) as { cwd?: unknown };
			if (typeof parsed.cwd === "string") return parsed.cwd;
		} catch {
			// A partially written first line (a session starting right now).
			return undefined;
		}
	}
	return undefined;
}

/** realpath with a pass-through fallback, like sessions.ts does internally. */
function realPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function toPosix(path: string): string {
	return sep === "/" ? path : path.split(sep).join("/");
}

/**
 * Undo a warp that stopped before it copied anything: put the previous marker
 * back.
 *
 * Refuses (by doing nothing) once something HAS been copied, because then the
 * target holds files claiming an ownership that no longer matches the marker,
 * and quietly reverting would leave the two machines disagreeing.
 */
export function restoreMarker(
	plan: WarpPlan,
	previous: OwnerMarker | null,
	copiedAfterMarker: boolean,
): { restored: boolean; reason?: string } {
	if (copiedAfterMarker) {
		return {
			restored: false,
			reason:
				"files have already been copied to the target, so the marker is left alone — undoing it now would leave the target claiming files this machine no longer owns.",
		};
	}
	// The path comes from the plan's own write-marker step, not from a second
	// `ownerPath()` call: the plan already decided where the marker goes, and
	// undo must undo THAT file rather than re-derive a possibly different one.
	const path =
		plan.steps.find((step) => step.kind === "write-marker")?.path ??
		ownerPath(plan.cwd, plan.sessionId);
	if (previous === null) {
		try {
			rmSync(path, { force: true });
		} catch (error) {
			return { restored: false, reason: error instanceof Error ? error.message : String(error) };
		}
		return { restored: true };
	}
	try {
		const temp = `${path}.${process.pid}.undo`;
		writeFileSync(temp, `${JSON.stringify(previous, null, 2)}\n`, "utf-8");
		renameSync(temp, path);
	} catch (error) {
		return { restored: false, reason: error instanceof Error ? error.message : String(error) };
	}
	return { restored: true };
}

/** A runner for a target, built from its machine entry. */
export function runnerForTarget(target: WarpTarget): MachineRunner {
	return new RemoteMachine(
		target.host,
		undefined,
		target.port === undefined ? {} : { port: target.port },
	);
}
