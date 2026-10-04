/**
 * `hyper warp <machine>` — move a running piece of work to another machine.
 *
 * The design here is plan-then-execute, and the ORDER is the contract:
 *
 *  1. {@link planWarp} is PURE. It takes facts (already gathered by the
 *     caller) and returns either a refusal or a {@link WarpPlan}. It spawns
 *     nothing, touches nothing, and can be tested with no filesystem at all.
 *  2. {@link executeWarp} runs the plan: first the PROBE BLOCK (read-only
 *     questions to the target), then the mutations (stop, marker, copies,
 *     push, resume).
 *
 * Nothing in this file names ssh, rsync or scp (C-16): remote work goes
 * through the {@link MachineRunner} the caller passes in, whose only two
 * implementations are `LocalMachine` and `RemoteMachine` in services/remote.ts.
 * Nothing here names `git` either (C-2): the push and every git command line
 * that runs on the target come from services/space-git.ts.
 *
 * Invariants the rest of the file exists to protect:
 *
 *  - **Every refusal happens before the first mutation, on either side.**
 *    Questions that need no machine (paths, a live session, the owner) are
 *    answered by the planner. Questions about the target are PROBES, and every
 *    probe of a plan comes before its first mutating step (stop, marker, any
 *    copy, clone, push). A probe may be conditional on an earlier probe's
 *    answer ("is the space there?" decides which parent check applies), but
 *    it is never placed after a mutation. Something that can only be checked
 *    after a mutation (the `worktrees/` dir a clone creates) is not a refusal:
 *    it is a step failure, reported with what completed.
 *  - **A failure says what happened.** The executor records which steps
 *    completed and whether anything may have reached the target, and
 *    {@link describeFailure} builds the message from that record, never from
 *    a fixed sentence.
 *  - **The marker is compare-and-swap.** Two concurrent warps cannot both
 *    claim a session, and undo never removes a marker this run did not write.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	linkSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { loadConfig } from "#config/index";
import { MachineError, type MachineInfo, resolveMachine, self, targetFor } from "#services/machine";
import {
	isIpv6Literal,
	isSafeRemotePath,
	type MachineRunner,
	RemoteMachine,
	SAFE_REMOTE_PATH_DESCRIPTION,
	shellJoin,
	sshUrl,
} from "#services/remote";
import {
	type LiveSession,
	lastAssistantText,
	listTranscripts,
	liveSessionsFor,
	type OwnerMarker,
	type OwnerState,
	projectDir,
	readOwner,
	type StopOutcome,
	stopSession,
	transcriptLineCount,
} from "#services/sessions";
import { findSpaceRoot } from "#services/space";
import {
	checkProjectBranchName,
	projectPushArgv,
	projectWorktreeHead,
	pushProjectBranch,
	SpaceGitError,
	TARGET_DIRTY,
	TARGET_WORKTREE_STATE,
	targetBareRepoCheck,
	targetStashSnapshot,
	targetStatusCheck,
	targetWorktreeAdd,
	targetWorktreeReset,
	targetWorktreeState,
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
	/**
	 * True when the session has a `<id>/` folder beside its transcript (Claude
	 * Code keeps per-session tool output there). It travels with the session.
	 */
	transcriptSubfolder: boolean;
	/**
	 * Every live Claude Code process registered under this session id. Usually
	 * zero or one; several means the same session was resumed twice, and all of
	 * them are writing the transcript.
	 */
	live: LiveSession[];
	/** `--stop`: stop those processes before copying. */
	stop: boolean;
	/** `--force`: take the session over from its owner. */
	force: boolean;
	/** `--remote-control`: pass Claude Code's remote-control launch option. */
	remoteControl: boolean;
	/** Marker state of the session, from `readOwner`. */
	owner: OwnerState;
	/**
	 * A `.<id>.warp.json.*.old` left by a marker swap that crashed between
	 * moving the old marker aside and publishing the new one ({@link
	 * findStrayMarker}). With no marker beside it, ownership is UNKNOWN, not
	 * "unowned".
	 */
	strayMarker: string | null;
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
	/**
	 * A short lowercase token that makes this warp's Herdr agent name unique
	 * (`[a-z0-9]+`; the caller uses the clock in base 36). Injected so the
	 * planner stays pure and tests stay deterministic.
	 */
	agentSuffix: string;
	/**
	 * When this warp started (ISO time). Names the stash a `--force` warp
	 * leaves on the target. Injected so the planner stays pure.
	 */
	startedAt: string;
}

/**
 * The read-only questions a plan can ask the target. Each probe has one id so
 * a later step can be conditional on its answer.
 */
export type ProbeId =
	/** Is there a Herdr server for the machine? */
	| "herdr"
	/** Does the working directory's parent exist on the target, writable? */
	| "parent"
	/** Can the transcript folder be written (or created) on the target? */
	| "transcript-folder"
	/** QUESTION: is the space root already on the target? */
	| "space"
	/** With the space present: is its project repo a bare git repo? */
	| "space-repo"
	/** With the space present: is the worktree's parent there and writable? */
	| "space-parent"
	/** QUESTION: is a worktree already registered at this path, on this branch? */
	| "worktree"
	/** With the space present: would the branch push be accepted? */
	| "push-check"
	/** With the space missing: is `hyper` there to clone it? */
	| "hyper"
	/** With the space missing: can the space root be created? */
	| "space-ancestor"
	/** Without --force: the target's copy holds no uncommitted work. */
	| "target-clean";

/**
 * A step that runs only when a probe answered a certain way.
 *
 * `yes` means the probe ran and answered yes (exit 0). `not-yes` means it
 * answered no, OR it never ran because its own condition did not hold — which
 * is what "no worktree is registered there yet" needs when the space itself is
 * missing and the worktree question could not be asked.
 */
export interface StepCondition {
	probe: ProbeId;
	answer: "yes" | "not-yes";
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
	 * Read-only check. A GATE (default) must pass or the plan stops before any
	 * mutation. A QUESTION (`question: true`) answers yes (exit 0) or no
	 * (exit 1); any other exit is still a refusal (the question could not be
	 * asked), with `problems[code]` saying why when the code means something.
	 *
	 * `via` is which tool answers it. `shell` runs a command on the target's
	 * login shell through services/remote.ts; `herdr` runs Herdr's own CLI here,
	 * which reaches the target through the saved machine profile; `push-dry-run`
	 * runs `git push --dry-run` here against the target's ssh:// URL, which
	 * updates nothing on either side.
	 */
	| {
			kind: "probe";
			id: ProbeId;
			via: "shell" | "herdr" | "push-dry-run";
			summary: string;
			/** The argv sent (shell/herdr), or the push line shown (push-dry-run). */
			argv: string[];
			problem: string;
			problems?: Partial<Record<number, string>>;
			question?: true;
			when?: StepCondition;
			/** For `push-dry-run`: what to push. */
			push?: { worktree: string; url: string; branch: string };
			/**
			 * The probe prints paths (`git status --porcelain` lines) when it
			 * refuses; the refusal lists the first few, escaped.
			 */
			listsPaths?: true;
	  }
	/** SIGTERM/SIGKILL one live process (design step 2, `--stop`). */
	| {
			kind: "stop-session";
			summary: string;
			pid: number;
			cwd: string;
			sessionId: string;
	  }
	/** After every stop: no process may still be registered under the id. */
	| { kind: "verify-stopped"; summary: string; sessionId: string }
	/** Compare-and-swap `<id>.warp.json`, remembering the previous one for undo. */
	| {
			kind: "write-marker";
			summary: string;
			owner: string;
			path: string;
			previous: OwnerMarker | null;
	  }
	/** Push the session out through an existing config-sync session. */
	| { kind: "flush-sync"; summary: string; session: string; leaves: string }
	/** A command on the target (clone, worktree add/reset, a post-clone check). */
	| {
			kind: "remote-command";
			summary: string;
			argv: string[];
			when?: StepCondition;
			/** What this leaves on the target; absent for a read-only check. */
			leaves?: string;
			/**
			 * Told to the user, with `{out}` replaced by the first line the
			 * command printed, when it printed one (the stash it made).
			 */
			announce?: string;
			/** Problem sentence when it fails. */
			problem: string;
	  }
	/**
	 * Copy one file (`tree: false`) or a directory's contents (`tree: true`)
	 * to the same absolute path on the target.
	 *
	 * The kind is called `copy` rather than after the transfer tool on purpose:
	 * C-16 is enforced by a grep over `src` for those three tool names in any
	 * quoting at all, comments included.
	 *
	 * NEVER `--delete`. A warp overwrites the target's copy file by file and
	 * keeps files that exist only there; it must not prune what the target
	 * already had. The ownership refusal (the target owns the session →
	 * refuse without `--force`) is what keeps a warp from overwriting newer work.
	 */
	| {
			kind: "copy";
			summary: string;
			src: string;
			dst: string;
			tree: boolean;
			excludes: string[];
			leaves: string;
	  }
	/** Push a worktree branch to an explicit `ssh://` URL (C-9). */
	| {
			kind: "push-branch";
			summary: string;
			worktree: string;
			url: string;
			branch: string;
			/**
			 * The probe whose YES means the branch is checked out in the target's
			 * worktree at this very path, so the push has to tell the target's
			 * receive-pack to accept moving it (see `pushProjectBranch`).
			 */
			checkedOutHereWhen: ProbeId;
			leaves: string;
	  }
	/** A `herdr` call through `--machine` routing. */
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
	live: LiveSession[];
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
	/** Limits the user should know before running it; printed by `--dry-run`. */
	notes: string[];
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
 * The id becomes a filename (`<id>.warp.json`, `<id>.jsonl`) and an argument
 * to `claude --resume`. A value like `../../.ssh/authorized_keys` or `-x` is
 * refused here rather than quoted — quoting a path traversal does not stop it
 * from being a path traversal.
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A machine name, as it appears in `drive.toml`, in Herdr, and in the
 * ownership marker. Starts with an alphanumeric so it can never be read as an
 * option, and carries nothing a shell would treat as structure.
 */
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Herdr's own rule for an agent name (`herdr agent start <name>`). */
const AGENT_NAME = /^[a-z][a-z0-9_-]*$/;

/** The placeholder the `agent start` argv carries until `tab create` answers. */
export const PANE_PLACEHOLDER = "<pane-from-tab-create>";

/**
 * Control characters are never acceptable in a path hyperdrive is about to
 * hand to a remote shell. Checked separately from the remote path rule so the
 * message can say what is wrong with a newline specifically.
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

/** Shell-quote a single word for a script that will itself be shell-quoted. */
function quoteForRemoteShell(value: string): string {
	const safe = /^[A-Za-z0-9_@%+=:,./~-]+$/;
	if (safe.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The remote shell command that answers "does this directory exist and can I
 * write in it?". Exit 66: missing; 67: not writable.
 *
 * NO `--` before the path: `test` is a shell BUILTIN, and dash (`/bin/sh` on
 * Debian and Ubuntu) has no `--` option for it and answers
 * `test: --: unexpected operator`. Safe because the planner has refused any
 * path that is not absolute, and an absolute path is never read as an option.
 */
function writableProbe(dir: string): string[] {
	const quoted = quoteForRemoteShell(dir);
	return ["sh", "-c", `test -d ${quoted} || exit 66; test -w ${quoted} || exit 67`];
}

/**
 * "Can `path` be created (or written, if it exists)?": walk up to the nearest
 * directory that EXISTS on the target and require it to be a writable
 * directory. Prints that directory and exits 67 when it is not, so the
 * refusal can name it.
 */
function nearestWritableProbe(path: string): string[] {
	const quoted = quoteForRemoteShell(path);
	return [
		"sh",
		"-c",
		`d=${quoted}; while [ ! -e "$d" ]; do d=$(dirname "$d"); done; if [ -d "$d" ] && [ -w "$d" ]; then exit 0; fi; printf '%s\\n' "$d"; exit 67`,
	];
}

/**
 * Claude Code's remote-control launch option.
 *
 * Confirmed against `claude --help` (2.1.288, re-read for 2.1.289): the flag is
 * `--remote-control [name]`. It takes an OPTIONAL value, so it is passed bare
 * and last. Read from help, never by starting a session.
 */
export const REMOTE_CONTROL_FLAG = "--remote-control";

/**
 * The arguments `claude` is started with on the target.
 *
 * NOT a command line: `herdr agent start <name> --kind claude --pane <id> --
 * <args>` passes everything after `--` to the agent binary as ARGUMENTS (Herdr
 * already knows the binary from `--kind`). Putting `claude` here would start
 * `claude claude --resume …`, and the first `claude` would arrive in the
 * resumed session as a prompt.
 */
export function resumeAgentArgs(sessionId: string, remoteControl: boolean): string[] {
	return ["--resume", sessionId, ...(remoteControl ? [REMOTE_CONTROL_FLAG] : [])];
}

/** The Herdr agent name for one warp: lowercase, and unique per run. */
export function agentNameFor(sessionId: string, suffix: string): string {
	return `warp-${sessionId.slice(0, 8).toLowerCase()}-${suffix}`;
}

/**
 * Build the plan, or refuse.
 *
 * Pure: it reads nothing and spawns nothing. Refusals all share one exit code
 * (2) and all happen here or in the probe block, before the first mutation.
 */
export function planWarp(inputs: WarpInputs): WarpPlanResult {
	const target = inputs.target;
	// ---- stage: resolve -------------------------------------------------
	if (!SESSION_ID.test(inputs.sessionId)) {
		return refuse(
			"session",
			`${JSON.stringify(inputs.sessionId)} isn't a Claude Code session id. A session id is a UUID like 3d9c77a6-6975-4381-b884-214b3ca452d8 — run \`hyper warp <machine> --session <id>\` with the full id.`,
		);
	}
	if (!MACHINE_NAME.test(target.name)) {
		return refuse(
			"machine",
			`${JSON.stringify(target.name)} isn't a machine name hyperdrive can use. A name starts with a letter or digit and carries only letters, digits, ".", "_" and "-".`,
		);
	}
	if (!MACHINE_NAME.test(inputs.selfName)) {
		return refuse(
			"machine",
			`\`[self] name\` in your drive.toml is ${JSON.stringify(inputs.selfName)}, which isn't a name hyperdrive can use. A name starts with a letter or digit and carries only letters, digits, ".", "_" and "-".`,
		);
	}
	if (isIpv6Literal(target.host)) {
		return refuse(
			"machine",
			`"${target.name}" is saved in Herdr as an IPv6 address (${target.host}). Warp copies with rsync, whose \`host:path\` form can't carry a bare IPv6 address reliably, so it won't start a warp that would fail halfway. Give the machine a name in ~/.ssh/config (\`Host ${target.name}\` with \`HostName ${target.host.replace(/^.*@/, "").replace(/^\[|\]$/g, "")}\`) and save it in Herdr under that name.`,
		);
	}
	const agentName = agentNameFor(inputs.sessionId, inputs.agentSuffix);
	if (!AGENT_NAME.test(agentName)) {
		return refuse(
			"session",
			`the Herdr agent name ${JSON.stringify(agentName)} isn't one Herdr accepts (lowercase letters, digits, "_" and "-", starting with a letter).`,
		);
	}
	const projectFolder = dirname(inputs.transcriptPath);
	for (const [label, value] of [
		["the working directory", inputs.cwd],
		["this machine's home", inputs.selfHome],
		[`${target.name}'s home`, target.home],
		["the transcript folder", projectFolder],
	] as const) {
		const unsafe = unsafePathReason(value);
		if (unsafe)
			return refuse("paths", `${label} (${JSON.stringify(value)}) can't be used: ${unsafe}.`);
	}
	if (!target.home.startsWith("/")) {
		return refuse(
			"paths",
			`the home of "${target.name}" is ${JSON.stringify(target.home)}, which isn't an absolute path. Warp needs the same absolute path on both machines — set \`home = "/…"\` under \`[machines.${target.name}]\` in your drive.toml.`,
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
			`${inputs.cwd} isn't inside this machine's home (${inputs.selfHome}). Warp copies a working directory to the SAME absolute path on ${target.name}, so both homes have to contain it. Run this from a directory under your home.`,
		);
	}
	if (!underHome(inputs.cwd, target.home)) {
		return refuse(
			"paths",
			`${inputs.cwd} isn't inside ${target.name}'s home (${target.home}). Warp copies to the same absolute path on the target, so it has to be inside its home too — widen \`home\` under \`[machines.${target.name}]\` in your drive.toml, or run this from a directory that exists in both.`,
		);
	}
	// The rule services/remote.ts enforces when it builds a remote path. Applied
	// HERE so `--dry-run` refuses exactly what a real run would, and a real run
	// refuses before the marker is written rather than at the first copy.
	for (const [label, value] of [
		["The working directory", inputs.cwd],
		["The transcript folder", projectFolder],
		...(inputs.space
			? ([
					["The space", inputs.space.root],
					["The space's project repo", inputs.space.barePath],
				] as const)
			: []),
	] as const) {
		if (!isSafeRemotePath(value)) {
			return refuse(
				"paths",
				`${label} ${JSON.stringify(value)} can't be sent to ${target.name}: remote paths may only contain ${SAFE_REMOTE_PATH_DESCRIPTION} (no spaces, quotes or shell characters), because the copy tools quote them differently on each platform. Rename it, or warp from a directory whose path has none of those.`,
			);
		}
	}
	if (inputs.cwdKind === "space-worktree" && inputs.space === null) {
		return refuse(
			"paths",
			"this looks like a space worktree but warp couldn't work out which space or branch it belongs to.",
		);
	}

	// ---- stage: session -------------------------------------------------
	// A live session without `--stop` is exit 2, naming every pid.
	if (inputs.live.length > 0 && !inputs.stop) {
		const described = inputs.live
			.map((live) => {
				const since = live.startedAt
					? new Date(live.startedAt).toISOString().replace("T", " ").slice(0, 19)
					: "unknown";
				return `pid ${live.pid}, started ${since}`;
			})
			.join("; ");
		const several =
			inputs.live.length > 1
				? ` ${inputs.live.length} processes are running it, and all of them write the same transcript.`
				: "";
		return refuse(
			"session",
			`session ${inputs.sessionId} is still running here (${described}).${several} Warp would copy a transcript that is still being written. Re-run with \`--stop\` to stop ${inputs.live.length > 1 ? "them" : "it"} first, or \`--dry-run\` to see what a warp would do.`,
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
	if (owner.state === "unowned" && inputs.strayMarker && !inputs.force) {
		return refuse(
			"ownership",
			`ownership of session ${inputs.sessionId} is unknown: there is no marker, but ${inputs.strayMarker} is left over from a warp that stopped while swapping it, so the session may belong to another machine. Check which machine has it, then delete that file, or pass --force to claim it for ${target.name}.`,
		);
	}
	if (owner.state === "owned" && !inputs.force) {
		if (owner.marker.owner === target.name) {
			// The marker says the session already lives on the target: it was
			// warped there and never warped back. Copying again would overwrite
			// whatever was written there since with this machine's older copy.
			return refuse(
				"ownership",
				`session ${inputs.sessionId} lives on ${target.name} now (warped there at ${owner.marker.at}). Warp it back from there (\`hyper warp ${inputs.selfName}\` on ${target.name}), or pass --force to overwrite ${target.name}'s copy with this machine's.`,
			);
		}
		if (owner.marker.owner !== inputs.selfName) {
			return refuse(
				"ownership",
				`session ${inputs.sessionId} is owned by "${owner.marker.owner}" (warped at ${owner.marker.at}), not by "${inputs.selfName}". Two machines writing one session's transcript would fight over the files. Re-run with \`--force\` to take it over from ${JSON.stringify(owner.marker.owner)}.`,
			);
		}
	}

	// ---- stage: branch ----------------------------------------------------
	if (inputs.space && !checkProjectBranchName(inputs.space.branch)) {
		return refuse(
			"branch",
			`the worktree at ${inputs.cwd} is on ${JSON.stringify(inputs.space.branch)}, which isn't a branch name git accepts. Warp won't push it.`,
		);
	}

	// ---- the plan: probes ------------------------------------------------
	const steps: WarpStep[] = [];
	const name = target.name;

	if (!inputs.syncSession) {
		steps.push({
			kind: "probe",
			id: "transcript-folder",
			via: "shell",
			summary: `check ${projectFolder} can be written on ${name}`,
			argv: nearestWritableProbe(projectFolder),
			problem: `the transcript folder ${projectFolder} can't be written on ${name}: the nearest directory that exists there (named below) isn't a directory the user hyperdrive logs in as can write. Fix its permissions and run this again.`,
		});
	}

	const space = inputs.space;
	const url = space
		? sshUrl(
				{ host: target.host, ...(target.port === undefined ? {} : { port: target.port }) },
				space.barePath,
			)
		: "";
	if (space) {
		const parent = parentOf(inputs.cwd);
		const present: StepCondition = { probe: "space", answer: "yes" };
		const missing: StepCondition = { probe: "space", answer: "not-yes" };
		const states = TARGET_WORKTREE_STATE;
		steps.push(
			{
				kind: "probe",
				id: "space",
				via: "shell",
				question: true,
				summary: `ask whether the space ${space.root} is already on ${name}`,
				argv: ["sh", "-c", `test -d ${quoteForRemoteShell(space.root)}`],
				problem: `couldn't check whether ${space.root} exists on ${name}.`,
			},
			// --- the space is there: its repo, the worktree's parent, the
			// worktree registration, and whether the push would be accepted.
			{
				kind: "probe",
				id: "space-repo",
				via: "shell",
				when: present,
				summary: `check ${space.barePath} is a bare git repo on ${name}`,
				argv: targetBareRepoCheck(space.barePath),
				problem: `${space.root} exists on ${name} but ${space.barePath} isn't a bare git repository there, so there is nothing to push the branch into. Clone the space there properly (\`hyper space clone ${space.name} ${space.root}\` into an empty directory), or move that directory away.`,
			},
			{
				kind: "probe",
				id: "space-parent",
				via: "shell",
				when: present,
				summary: `check ${parent} exists and is writable on ${name}`,
				argv: writableProbe(parent),
				problem: `${parent} doesn't exist on ${name}, or isn't writable by the user hyperdrive logs in as. Create it (or fix its permissions) and run this again.`,
				problems: {
					66: `${parent} doesn't exist on ${name}. Create it there and run this again.`,
					67: `${parent} exists on ${name} but isn't writable by the user hyperdrive logs in as. Fix its permissions and run this again.`,
				},
			},
			{
				kind: "probe",
				id: "worktree",
				via: "shell",
				question: true,
				when: present,
				summary: `ask whether ${inputs.cwd} is already a worktree of the space on ${name}, on ${space.branch}`,
				argv: targetWorktreeState(space.barePath, inputs.cwd, space.branch),
				problem: `couldn't read the worktrees of ${space.barePath} on ${name}.`,
				problems: {
					[states.otherBranchHere]: `${inputs.cwd} on ${name} is a worktree of the space on another branch (or a detached HEAD), not ${space.branch}. Warp won't switch it. Check out ${space.branch} there, or remove that worktree, then run this again.`,
					[states.branchElsewhere]: `branch ${space.branch} is checked out in another worktree on ${name}, not at ${inputs.cwd}. git won't check one branch out twice. Remove that worktree (or switch it to another branch) and run this again.`,
					[states.occupied]: `${inputs.cwd} exists on ${name} and isn't a worktree of the space (an earlier copy?). Move it away there and run this again.`,
					[states.registeredButMissing]: `${inputs.cwd} is registered as a worktree on ${name}, but the directory (or its .git file) is gone. Run \`git --git-dir=${space.barePath} worktree prune\` there and run this again.`,
				},
			},
			...(inputs.force
				? []
				: [
						{
							kind: "probe" as const,
							id: "target-clean" as const,
							via: "shell" as const,
							when: { probe: "worktree", answer: "yes" } as StepCondition,
							listsPaths: true as const,
							summary: `check the worktree ${inputs.cwd} on ${name} has no uncommitted work`,
							argv: targetStatusCheck(inputs.cwd),
							problem: `couldn't read \`git status\` of ${inputs.cwd} on ${name}.`,
							problems: {
								[TARGET_DIRTY]: `${name} has uncommitted work in the worktree ${inputs.cwd}. Commit or stash it there, or pass --force to overwrite it (a --force warp first saves the tracked changes there as a stash).`,
							},
						},
					]),
			{
				kind: "probe",
				id: "push-check",
				via: "push-dry-run",
				when: present,
				summary: `check ${name} would accept branch ${space.branch} (git push --dry-run)`,
				argv: projectPushArgv({ worktree: inputs.cwd, url, branch: space.branch, dryRun: true }),
				push: { worktree: inputs.cwd, url, branch: space.branch },
				problem: `${name} would reject branch ${space.branch}: its copy has commits this one doesn't (not a fast-forward), or it refused the push. Bring those commits here first, or push to a new branch, then run this again.`,
			},
			// --- the space is missing: hyper must be there to clone it, and the
			// space root must be creatable.
			{
				kind: "probe",
				id: "hyper",
				via: "shell",
				when: missing,
				summary: `check hyper is installed on ${name}`,
				argv: ["command", "-v", "hyper"],
				problem: `the space isn't on ${name}, and cloning it there needs hyper, which the non-interactive ssh shell on ${name} can't find (\`command -v hyper\` failed). Install hyper there (on the PATH a non-login shell gets), or clone the space by hand with \`hyper space clone ${space.name} ${space.root}\`, then run this again.`,
			},
			{
				kind: "probe",
				id: "space-ancestor",
				via: "shell",
				when: missing,
				summary: `check ${space.root} can be created on ${name}`,
				argv: nearestWritableProbe(space.root),
				problem: `the space ${space.root} can't be created on ${name}: the nearest directory that exists there (named below) isn't writable by the user hyperdrive logs in as. Fix its permissions (or create the space there yourself) and run this again.`,
			},
		);
	} else {
		const parent = parentOf(inputs.cwd);
		steps.push({
			kind: "probe",
			id: "parent",
			via: "shell",
			summary: `check ${parent} exists and is writable on ${name}`,
			argv: writableProbe(parent),
			problem: `${parent} doesn't exist on ${name}, or isn't writable by the user hyperdrive logs in as. Create it (or fix its permissions) and run this again.`,
			problems: {
				66: `${parent} doesn't exist on ${name}. Create it there and run this again.`,
				67: `${parent} exists on ${name} but isn't writable by the user hyperdrive logs in as. Fix its permissions and run this again.`,
			},
		});
		if (inputs.cwdKind === "git-repo" && !inputs.force) {
			steps.push({
				kind: "probe",
				id: "target-clean",
				via: "shell",
				listsPaths: true,
				summary: `check the repository ${inputs.cwd} on ${name}, if there is one, has no uncommitted work`,
				argv: targetStatusCheck(inputs.cwd),
				problem: `couldn't read \`git status\` of ${inputs.cwd} on ${name}.`,
				problems: {
					[TARGET_DIRTY]: `${name} has uncommitted work in the repository ${inputs.cwd}. Commit or stash it there, or pass --force to overwrite it (files are overwritten one by one; nothing is saved first).`,
				},
			});
		}
	}
	steps.push({
		kind: "probe",
		id: "herdr",
		via: "herdr",
		summary: `check the Herdr server on ${name} answers`,
		argv: ["--machine", name, "pane", "list"],
		problem: `no Herdr server answered on ${name}. Warp starts the session through Herdr and never falls back to a bare \`ssh … claude\`, because that would put the session somewhere you can't attach to. Run \`herdr machine add <ssh-target> --label ${name}\` on this machine, then run this again.`,
	});

	// ---- the plan: mutations ---------------------------------------------
	// Stop, then the marker. The marker goes before the first copy so it
	// travels with the transcript (design step 3).
	if (inputs.stop && inputs.live.length > 0) {
		for (const live of inputs.live) {
			steps.push({
				kind: "stop-session",
				summary: `stop session ${inputs.sessionId} (pid ${live.pid})`,
				pid: live.pid,
				cwd: live.cwd,
				sessionId: inputs.sessionId,
			});
		}
		steps.push({
			kind: "verify-stopped",
			summary: `check nothing is still running session ${inputs.sessionId}`,
			sessionId: inputs.sessionId,
		});
	}
	// Beside the transcript the plan was GIVEN, not re-derived from the
	// environment (`ownerPath` reads CLAUDE_CONFIG_DIR/HOME): the planner is
	// pure, and the marker must travel with exactly the transcript it copies.
	const markerPath = join(projectFolder, `${inputs.sessionId}.warp.json`);
	steps.push({
		kind: "write-marker",
		summary: `write the ownership marker for ${inputs.sessionId} (owner ${name})`,
		owner: name,
		path: markerPath,
		previous: owner.state === "owned" ? owner.marker : null,
	});

	// Design step 4: the transcript — THIS session's files only. The project
	// folder holds every session of the directory; copying the folder would
	// overwrite other sessions' transcripts on the target with this machine's.
	if (inputs.syncSession) {
		steps.push({
			kind: "flush-sync",
			summary: `flush the "${inputs.syncSession}" sync session so the transcript reaches ${name}`,
			session: inputs.syncSession,
			leaves: `whatever "${inputs.syncSession}" synced (this session's transcript among it)`,
		});
	} else {
		steps.push({
			kind: "copy",
			summary: `copy the transcript ${inputs.transcriptPath} to ${name}`,
			src: inputs.transcriptPath,
			dst: inputs.transcriptPath,
			tree: false,
			excludes: [],
			leaves: `the transcript ${inputs.transcriptPath}`,
		});
		if (inputs.transcriptSubfolder) {
			const folder = join(projectFolder, inputs.sessionId);
			steps.push({
				kind: "copy",
				summary: `copy the session folder ${folder} to ${name}`,
				src: folder,
				dst: folder,
				tree: true,
				excludes: [],
				leaves: `the session folder ${folder}`,
			});
		}
		steps.push({
			kind: "copy",
			summary: `copy the ownership marker ${markerPath} to ${name}`,
			src: markerPath,
			dst: markerPath,
			tree: false,
			excludes: [],
			leaves: `the ownership marker ${markerPath}`,
		});
	}

	// Design step 5: the working directory, by kind.
	if (space) {
		const missing: StepCondition = { probe: "space", answer: "not-yes" };
		steps.push(
			{
				kind: "remote-command",
				when: missing,
				summary: `clone the space "${space.name}" to ${space.root} on ${name}`,
				// `--yes` BEFORE `--`: after `--` oclif reads every word as an
				// argument, so a trailing `--yes` would be an extra one. The `--`
				// is what keeps a space named `-x` from being read as an option,
				// and the explicit path pins where the clone lands.
				argv: ["hyper", "space", "clone", "--yes", "--", space.name, space.root],
				leaves: `the space ${space.root} (cloned from the hyperdrive)`,
				problem: `\`hyper space clone\` failed on ${name}.`,
			},
			{
				kind: "remote-command",
				when: missing,
				summary: `check the clone put the project repo at ${space.barePath} on ${name}`,
				argv: targetBareRepoCheck(space.barePath),
				problem: `\`hyper space clone\` finished on ${name}, but ${space.barePath} isn't a bare git repo there, so the branch has nowhere to go.`,
			},
			...(inputs.force
				? [
						{
							kind: "remote-command" as const,
							when: { probe: "worktree", answer: "yes" } as StepCondition,
							summary: `save uncommitted tracked work in ${inputs.cwd} on ${name} as a stash (--force)`,
							argv: targetStashSnapshot(
								inputs.cwd,
								`hyper warp ${inputs.sessionId} ${inputs.startedAt}`,
							),
							leaves: `a stash in ${inputs.cwd} ("hyper warp ${inputs.sessionId} ${inputs.startedAt}")`,
							announce: `${name}'s uncommitted tracked work in ${inputs.cwd} was saved as stash {out} ("hyper warp ${inputs.sessionId} ${inputs.startedAt}"); see \`git -C ${inputs.cwd} stash list\` there. Untracked files are not in it (they are kept unless this warp copied a file of the same name).`,
							problem: `couldn't save the uncommitted work in ${inputs.cwd} on ${name} as a stash, so warp stopped before overwriting it.`,
						},
					]
				: []),
			{
				kind: "push-branch",
				summary: `push branch ${space.branch} to ${name}'s bare repo`,
				worktree: inputs.cwd,
				url,
				branch: space.branch,
				checkedOutHereWhen: "worktree",
				leaves: `branch ${space.branch} in ${space.barePath}`,
			},
			{
				kind: "remote-command",
				when: { probe: "worktree", answer: "not-yes" },
				summary: `register ${inputs.cwd} as a worktree of ${space.barePath} on ${name}`,
				argv: targetWorktreeAdd(space.barePath, inputs.cwd, space.branch),
				leaves: `a worktree registration for ${inputs.cwd} in ${space.barePath}`,
				problem: `\`git worktree add\` failed on ${name}.`,
			},
			{
				kind: "remote-command",
				summary: `make the index of ${inputs.cwd} match ${space.branch} on ${name} (git reset, files untouched)`,
				argv: targetWorktreeReset(inputs.cwd),
				leaves: `an index for ${inputs.cwd}`,
				problem: `\`git reset\` in ${inputs.cwd} failed on ${name}.`,
			},
			{
				kind: "copy",
				summary: `copy the worktree ${inputs.cwd} to ${name}`,
				src: inputs.cwd,
				dst: inputs.cwd,
				tree: true,
				// The worktree's own `.git` FILE points at this machine's admin dir
				// for it; the target has its own from `worktree add`. Anchored, so
				// a nested repository's `.git` deeper in the tree still travels.
				excludes: ["/.git", ...inputs.excludes],
				leaves: `files under ${inputs.cwd}`,
			},
		);
	} else {
		steps.push({
			kind: "copy",
			summary: `copy ${inputs.cwdKind} ${inputs.cwd} to ${name}`,
			src: inputs.cwd,
			dst: inputs.cwd,
			tree: true,
			excludes: inputs.excludes,
			leaves: `files under ${inputs.cwd}`,
		});
	}

	// Design step 6: resume through Herdr.
	steps.push(
		{
			kind: "herdr",
			summary: `create a tab on ${name} at ${inputs.cwd}`,
			argv: [
				"--machine",
				name,
				"tab",
				"create",
				"--cwd",
				inputs.cwd,
				"--label",
				agentName,
				"--no-focus",
			],
			readsPaneId: true,
		},
		{
			kind: "herdr",
			summary: `resume session ${inputs.sessionId} on ${name} as agent ${agentName}`,
			argv: [
				"--machine",
				name,
				"agent",
				"start",
				agentName,
				"--kind",
				"claude",
				"--pane",
				PANE_PLACEHOLDER,
				"--",
				...resumeAgentArgs(inputs.sessionId, inputs.remoteControl),
			],
		},
	);

	const notes = [
		`Only this session's files travel: ${basename(inputs.transcriptPath)}, ${basename(markerPath)}${inputs.transcriptSubfolder ? `, ${inputs.sessionId}/` : ""}. Other sessions in ${projectFolder} are left alone on both sides.`,
		`${name}'s copy of ${inputs.cwd} is overwritten file by file with this machine's; files that exist only on ${name} are kept (no --delete).`,
	];
	if (space) {
		notes.push(
			`The worktree arrives as a git worktree of ${space.barePath} on ${name}, on ${space.branch}. Staged-but-uncommitted changes arrive as unstaged modifications: the index does not travel.`,
		);
	}
	if (inputs.cwdKind === "git-repo") {
		notes.push(
			`The repository's .git travels with it and is merged into ${name}'s copy file by file, like everything else.`,
		);
	}
	if (inputs.cwdKind !== "plain-dir") {
		notes.push(
			inputs.force
				? space
					? `--force: uncommitted tracked work in ${name}'s worktree is saved there as a stash first; untracked files are not in that stash.`
					: `--force: uncommitted work in ${name}'s copy of the repository is overwritten file by file; nothing is saved first.`
				: `${name}'s copy is refused if it holds uncommitted work (git status not clean); --force overwrites it${space ? " after saving it as a stash" : ""}.`,
		);
	} else {
		notes.push(
			`A plain directory has nothing to compare: whatever ${name} holds at ${inputs.cwd} is overwritten file by file, without a check.`,
		);
	}

	return {
		ok: true,
		plan: {
			target,
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
			agentName,
			notes,
		},
	};
}

/** Quote an argv for display, so `--dry-run` shows exactly what would run. */
function displayLine(argv: string[]): string {
	return argv
		.map((arg) => (/^[A-Za-z0-9/_.:=@<>-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
		.join(" ");
}

/** "(only if …)" for a conditional step, in words. */
function conditionText(when: StepCondition | undefined, target: string): string {
	if (!when) return "";
	const phrases: Partial<Record<ProbeId, [string, string]>> = {
		space: [`the space is already on ${target}`, `the space is missing on ${target}`],
		worktree: [
			`the worktree is already registered there on ${target}`,
			`no worktree is registered there yet on ${target}`,
		],
	};
	const pair = phrases[when.probe];
	const text = pair ? pair[when.answer === "yes" ? 0 : 1] : `${when.probe} answered ${when.answer}`;
	return ` (only if ${text})`;
}

/**
 * A one-line description of a step, including every argument it will use.
 *
 * `--dry-run` prints one of these per step, so this is where a user sees the
 * remote command, the copy with its exclusions, and the push URL BEFORE
 * anything runs.
 */
export function describeStep(step: WarpStep, target = "the target"): string {
	switch (step.kind) {
		case "probe": {
			const label = step.question ? "ask" : "check";
			const line =
				step.via === "herdr"
					? `herdr ${displayLine(step.argv)}`
					: step.via === "push-dry-run"
						? displayLine(step.argv)
						: `ssh -- ${shellJoin(step.argv)}`;
			return `${label} (${step.via}): ${step.summary}${conditionText(step.when, target)}\n    ${line}`;
		}
		case "stop-session":
			return `stop: ${step.summary}`;
		case "verify-stopped":
			return `check: ${step.summary}`;
		case "write-marker":
			return `write: ${step.path} -> owner=${JSON.stringify(step.owner)} (only if it still says ${step.previous ? JSON.stringify(step.previous.owner) : "nothing"})`;
		case "flush-sync":
			return `sync: ${step.summary}`;
		case "remote-command":
			return `remote: ${step.summary}${conditionText(step.when, target)}\n    ssh -- ${shellJoin(step.argv)}`;
		case "copy": {
			const excludes =
				step.excludes.length > 0
					? ` ${step.excludes.map((pattern) => `--exclude=${pattern}`).join(" ")}`
					: "";
			const slash = step.tree ? "/" : "";
			return `copy: ${step.summary}\n    rsync -a --stats${excludes} -- ${step.src}${slash} ${step.dst}${slash}`;
		}
		case "push-branch":
			return `push: ${step.summary}\n    ${displayLine(projectPushArgv(step))}\n    (when the worktree is already registered there on this branch, the target's receive-pack is told to accept moving it: --receive-pack='... receive.denyCurrentBranch=ignore ...')`;
		case "herdr":
			return `herdr: ${step.summary}\n    herdr ${displayLine(step.argv)}`;
	}
}

/** One step the executor finished (or failed at), for the report. */
export interface StepRecord {
	kind: WarpStep["kind"];
	summary: string;
	/** What it leaves on the target, when it can leave anything. */
	leaves?: string;
}

/** What running a plan did. */
export interface WarpExecution {
	/** Steps that finished, in order. Probes included. */
	completed: StepRecord[];
	/** Conditional steps that did not apply. */
	skipped: string[];
	/** The step that failed, if any. */
	failure?: { step: StepRecord; detail: string };
	/**
	 * True once a step that PUTS THINGS ON THE TARGET was attempted — the
	 * attempt, not its success: a copy that failed with "partial transfer"
	 * (rsync 23/24), or dropped mid-way, may have delivered files. This is what
	 * decides whether the ownership marker may be put back.
	 */
	copied: boolean;
	/** Pids this run stopped. */
	stopped: number[];
	/** The marker this run wrote, when it wrote one. */
	markerWritten?: OwnerMarker;
	/** The pane the agent was started in. */
	paneId?: string;
	/** Things the user must be told even on success (a stash left on the target). */
	notices: string[];
	/** The Herdr agent name. */
	agentName: string;
}

/** Everything the executor needs that touches the outside world. */
export interface WarpDeps {
	/** Reaches the TARGET machine. Never the local one. */
	runner: MachineRunner;
	/** `stopSession` from services/sessions.ts. */
	stop?: typeof stopSession;
	/** Live processes of a session, re-read after the stops. */
	liveSessions?: (sessionId: string) => LiveSession[];
	/** `pushProjectBranch` from services/space-git.ts. */
	pushBranch?: typeof pushProjectBranch;
	/** {@link swapMarker}; injected so tests can watch the marker. */
	swapMarker?: typeof swapMarker;
	/** `SyncEngine.flush`, when a config-sync session carries the transcript. */
	flushSync?: (session: string) => Promise<void>;
	/** Runs a `herdr` argv and answers with its exit code and output. */
	runHerdr?: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
	/** Told about each finished step. */
	log?: (line: string) => void;
	/** Timestamp for the marker; injected so tests are deterministic. */
	now?: () => string;
}

/** Steps that may leave something on the target once attempted. */
function putsThingsOnTarget(step: WarpStep): boolean {
	switch (step.kind) {
		case "copy":
		case "flush-sync":
		case "push-branch":
			return true;
		case "remote-command":
			return step.leaves !== undefined;
		default:
			return false;
	}
}

function recordOf(step: WarpStep): StepRecord {
	const leaves = "leaves" in step ? step.leaves : undefined;
	return { kind: step.kind, summary: step.summary, ...(leaves ? { leaves } : {}) };
}

/**
 * Run a plan.
 *
 * Stops at the first step that fails. Never undoes anything itself; the
 * caller decides about the marker with {@link restoreMarker} and tells the
 * user with {@link describeFailure}.
 */
export async function executeWarp(plan: WarpPlan, deps: WarpDeps): Promise<WarpExecution> {
	const log = deps.log ?? (() => {});
	const answers = new Map<ProbeId, "yes" | "no">();
	const execution: WarpExecution = {
		completed: [],
		skipped: [],
		copied: false,
		stopped: [],
		agentName: plan.agentName,
		notices: [],
	};
	const fail = (step: WarpStep, detail: string): WarpExecution => ({
		...execution,
		failure: { step: recordOf(step), detail },
	});
	const holds = (when: StepCondition | undefined): boolean => {
		if (!when) return true;
		const answer = answers.get(when.probe);
		return when.answer === "yes" ? answer === "yes" : answer !== "yes";
	};

	for (const step of plan.steps) {
		const when = "when" in step ? step.when : undefined;
		if (!holds(when)) {
			execution.skipped.push(step.summary);
			log(`skipped: ${step.summary}${conditionText(when, plan.target.name)}`);
			continue;
		}
		if (putsThingsOnTarget(step)) execution.copied = true;
		try {
			switch (step.kind) {
				case "probe": {
					const result = await runProbe(step, deps);
					if (result.code === 0) {
						answers.set(step.id, "yes");
						break;
					}
					if (step.question && result.code === 1) {
						answers.set(step.id, "no");
						break;
					}
					return fail(step, probeDetail(step, result, plan.target.name));
				}
				case "stop-session": {
					const outcome = await (deps.stop ?? stopSession)(step.pid, {
						cwd: step.cwd,
						sessionId: step.sessionId,
					});
					// `survived`, `mismatch` and `unauthorized` are hard errors: the
					// process may still be writing the transcript we are about to
					// copy, or the pid is not provably the session's.
					// null: no sessions file claims that pid any more, i.e. it exited
					// between the listing and now. That is "gone": nothing was
					// signalled, and the verify-stopped step that follows decides
					// whether anything is still running the session.
					if (outcome === null || outcome === "gone") break;
					if (outcome !== "terminated" && outcome !== "killed") {
						return fail(step, stopFailureDetail(outcome, step));
					}
					execution.stopped.push(step.pid);
					break;
				}
				case "verify-stopped": {
					const still = (deps.liveSessions ?? liveSessionsFor)(step.sessionId);
					if (still.length > 0) {
						return fail(
							step,
							`session ${step.sessionId} is still running here (pid ${still.map((live) => live.pid).join(", ")}) after the stop. Warp won't copy a transcript something is still writing. Stop ${still.length > 1 ? "them" : "it"} yourself and run this again.`,
						);
					}
					break;
				}
				case "write-marker": {
					// `at` is stamped here, not in the plan: a dry run must not produce a
					// marker, and a plan inspected minutes before it runs should carry
					// the real time.
					const marker: OwnerMarker = {
						owner: step.owner,
						at: deps.now?.() ?? new Date().toISOString(),
					};
					(deps.swapMarker ?? swapMarker)(step.path, step.previous, marker);
					execution.markerWritten = marker;
					break;
				}
				case "flush-sync": {
					if (!deps.flushSync) {
						return fail(
							step,
							"this build has no config-sync engine available, so the transcript can't be flushed.",
						);
					}
					await deps.flushSync(step.session);
					break;
				}
				case "remote-command": {
					const result = await deps.runner.ssh(step.argv, { timeoutMs: 15 * 60_000 });
					if (result.code !== 0) {
						const said = firstLine(result.stderr) ?? firstLine(result.stdout);
						return fail(
							step,
							`${step.problem}${said ? ` It said: ${said}` : ` (exit ${result.code}, nothing on stderr)`}`,
						);
					}
					const printed = firstLine(result.stdout);
					if (step.announce && printed) {
						execution.notices.push(step.announce.replace("{out}", printed));
					}
					break;
				}
				case "copy": {
					const result = await deps.runner.rsync(
						step.tree ? `${step.src}/` : step.src,
						step.tree ? `${step.dst}/` : step.dst,
						{ excludes: step.excludes },
					);
					if (result.code !== 0) {
						const said = firstLine(result.stderr);
						const partial =
							result.code === 23 || result.code === 24
								? " rsync reports a PARTIAL transfer: some files arrived, some did not."
								: "";
						return fail(
							step,
							`the copy failed (exit ${result.code})${said ? `: ${said}` : ""}.${partial}`,
						);
					}
					break;
				}
				case "push-branch": {
					(deps.pushBranch ?? pushProjectBranch)({
						worktree: step.worktree,
						url: step.url,
						branch: step.branch,
						checkedOutAtSamePath: answers.get(step.checkedOutHereWhen) === "yes",
					});
					break;
				}
				case "herdr": {
					let argv = step.argv;
					if (argv.includes(PANE_PLACEHOLDER)) {
						if (!execution.paneId) {
							return fail(
								step,
								"there is no pane to start the agent in (tab create reported none).",
							);
						}
						argv = argv.map((arg) =>
							arg === PANE_PLACEHOLDER ? (execution.paneId as string) : arg,
						);
					}
					const result = await runHerdr(argv, deps);
					if (result.code !== 0) {
						return fail(
							step,
							firstLine(result.stderr) ??
								firstLine(result.stdout) ??
								`herdr exited ${result.code}.`,
						);
					}
					if (step.readsPaneId) {
						const paneId = readPaneId(result.stdout);
						if (!paneId) {
							return fail(
								step,
								`Herdr answered tab create without a pane id (expected .result.root_pane.pane_id in its JSON), so warp can't start the agent in it. The tab may exist on ${plan.target.name}: see \`herdr --machine ${plan.target.name} tab list\`.`,
							);
						}
						execution.paneId = paneId;
					}
					break;
				}
			}
		} catch (error) {
			return fail(step, errorDetail(error));
		}
		execution.completed.push(recordOf(step));
		log(step.summary);
	}
	return execution;
}

async function runProbe(
	step: Extract<WarpStep, { kind: "probe" }>,
	deps: WarpDeps,
): Promise<{ code: number; stdout: string; stderr: string }> {
	if (step.via === "herdr") return runHerdr(step.argv, deps);
	if (step.via === "push-dry-run") {
		if (!step.push) return { code: 2, stdout: "", stderr: "no push described" };
		try {
			(deps.pushBranch ?? pushProjectBranch)({ ...step.push, dryRun: true });
			return { code: 0, stdout: "", stderr: "" };
		} catch (error) {
			return { code: 2, stdout: "", stderr: errorDetail(error) };
		}
	}
	return deps.runner.ssh(step.argv, { timeoutMs: 60_000 });
}

function probeDetail(
	step: Extract<WarpStep, { kind: "probe" }>,
	result: { code: number; stdout: string; stderr: string },
	target: string,
): string {
	if (result.code === 255 && step.via === "shell") {
		return `couldn't reach ${target} over ssh to ${step.summary}${firstLine(result.stderr) ? `: ${firstLine(result.stderr)}` : ""}.`;
	}
	const base = step.problems?.[result.code] ?? step.problem;
	if (step.listsPaths && result.code !== 0 && result.stdout.trim() !== "") {
		return `${base}\n${listPaths(result.stdout)}`;
	}
	const said = firstLine(result.stdout) ?? firstLine(result.stderr);
	return said ? `${base} (${target} said: ${said})` : base;
}

/** How many dirty paths a refusal names before it just counts the rest. */
const LISTED_PATHS = 10;

/**
 * `git status --porcelain` lines for a terminal: at most {@link LISTED_PATHS},
 * each with control characters (an ESC sequence in a file name could repaint
 * the user's terminal) shown as `\xNN`, then a count of the rest.
 */
export function listPaths(porcelain: string): string {
	const lines = porcelain.split("\n").filter((line) => line.trim() !== "");
	const shown = lines.slice(0, LISTED_PATHS).map(
		(line) =>
			// biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them IS the point.
			`  ${line.replace(/[\u0000-\u001f\u007f-\u009f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)}`,
	);
	const rest = lines.length - shown.length;
	return [...shown, ...(rest > 0 ? [`  … and ${rest} more`] : [])].join("\n");
}

/** What `--dry-run` reports: the plan, and proof that nothing ran. */
export interface WarpDryRun {
	/** Human-readable lines, one per step, in execution order. */
	lines: string[];
	/** Limits worth knowing, from the plan. */
	notes: string[];
	/** The plan itself, for `--json`. */
	plan: WarpPlan;
	/** The transcript the chosen session has right now, for the report. */
	transcript: { path: string; lines: number; lastMessage: string | null };
}

/** Everything `--dry-run` prints, without running any of it. */
export function describeWarp(plan: WarpPlan): WarpDryRun {
	return {
		lines: plan.steps.map((step, index) => `${index + 1}. ${describeStep(step, plan.target.name)}`),
		notes: plan.notes,
		plan,
		transcript: {
			path: plan.transcriptPath,
			lines: transcriptLineCount(plan.transcriptPath),
			lastMessage: lastAssistantText(plan.transcriptPath),
		},
	};
}

/**
 * The pane id out of `herdr tab create`'s JSON: `.result.root_pane.pane_id`.
 *
 * HERDR-INTERNAL (from the lead's live Herdr, 2026-10-04): `tab create`
 * prints `{"result":{"tab":{…},"root_pane":{"pane_id":"w1E:pZ",…}}}`. Anything
 * else is undefined, and the executor fails clearly rather than guessing a
 * pane to start an agent in.
 */
export function readPaneId(stdout: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	const pane = (parsed as { result?: { root_pane?: unknown } } | null)?.result?.root_pane;
	if (pane && typeof pane === "object") {
		const id = (pane as { pane_id?: unknown }).pane_id;
		if (typeof id === "string" && id !== "") return id;
	}
	return undefined;
}

/** Spawn a `herdr` argv. */
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
	outcome: StopOutcome | null,
	step: Extract<WarpStep, { kind: "stop-session" }>,
): string {
	switch (outcome) {
		case "survived":
			return `pid ${step.pid} ignored both SIGTERM and SIGKILL, so it may still be writing the transcript. Stop it yourself (\`kill -9 ${step.pid}\`) and run this again.`;
		case "mismatch":
			return `the sessions file for pid ${step.pid} does not provably describe session ${step.sessionId} (no session id, or the pid has been reused). Warp did not signal it.`;
		case "unauthorized":
			return `pid ${step.pid} belongs to another user, so warp did not signal it.`;

		default:
			return String(outcome);
	}
}

function firstLine(text: string): string | undefined {
	return text
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry !== "");
}

function errorDetail(error: unknown): string {
	if (error instanceof SpaceGitError || error instanceof MachineError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

/**
 * The message for a warp that stopped part-way, built from what actually
 * happened: which steps completed, whether anything may have reached the
 * target, what became of the marker, and how to carry on.
 */
export function describeFailure(
	plan: WarpPlan,
	execution: WarpExecution,
	undo: { restored: boolean; reason?: string },
): string {
	const failure = execution.failure;
	if (!failure) return "";
	const target = plan.target.name;
	const lines = [`Warp to ${target} stopped at: ${failure.step.summary}`, failure.detail];
	const changes = execution.completed.filter((record) => record.kind !== "probe");
	const failedAtProbe = failure.step.kind === "probe";

	if (changes.length === 0 && failedAtProbe) {
		lines.push("Nothing was changed on either machine: every check runs before the first change.");
	} else if (changes.length > 0) {
		lines.push(`Done before that: ${changes.map((record) => record.summary).join("; ")}.`);
	} else {
		lines.push("No change had completed before that.");
	}

	if (execution.copied) {
		const arrived = changes.flatMap((record) => (record.leaves ? [record.leaves] : []));
		const partial = failure.step.leaves ? [`possibly part of ${failure.step.leaves}`] : [];
		const all = [...arrived, ...partial];
		if (all.length > 0) lines.push(`What may now be on ${target}: ${all.join("; ")}.`);
	}

	if (execution.markerWritten) {
		if (undo.restored) {
			lines.push(
				plan.owner.state === "owned"
					? `The ownership marker was put back to owner ${JSON.stringify(plan.owner.marker.owner)}.`
					: "The ownership marker was removed again.",
			);
		} else {
			lines.push(
				`The ownership marker still says ${target} owns this session${undo.reason ? ` (${undo.reason})` : ""}.`,
			);
		}
	}

	lines.push(...execution.notices);
	if (execution.stopped.length > 0) {
		lines.push(
			`The session was stopped here (pid ${execution.stopped.join(", ")}) and isn't running anywhere now. To keep working here, run \`claude --resume ${plan.sessionId}\` from ${plan.cwd}.`,
		);
	}

	if (execution.markerWritten && !undo.restored) {
		lines.push(
			`To finish the warp, fix the problem and run \`hyper warp ${target} --force\` (the marker already names ${target}, so it needs --force). To keep the session here instead, delete ${ownerMarkerPath(plan)}.`,
		);
	} else {
		lines.push(`Fix the problem and run \`hyper warp ${target}\` again.`);
	}
	return lines.join("\n");
}

function ownerMarkerPath(plan: WarpPlan): string {
	const step = plan.steps.find((entry) => entry.kind === "write-marker");
	return step?.kind === "write-marker"
		? step.path
		: join(plan.projectFolder, `${plan.sessionId}.warp.json`);
}

/**
 * Everything the command needs from the machine, the config and the filesystem
 * — gathered here so the planner stays pure.
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
	if (options.sessionId === undefined && collision !== undefined) {
		const better = transcripts.find((entry) => transcriptCwd(entry.path) === realCwd);
		if (better) {
			chosen = better;
			collision = undefined;
		}
	}

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
			transcriptSubfolder: isDirectory(join(dirname(chosen.path), chosen.id)),
			live: liveSessionsFor(chosen.id),
			stop: false,
			force: false,
			remoteControl: false,
			owner: readOwner(cwd, chosen.id),
			strayMarker: findStrayMarker(dirname(chosen.path), chosen.id),
			cwdKind: kind,
			space,
			excludes: [...config.warp.exclude],
			syncSession: null,
			agentSuffix: Date.now().toString(36),
			startedAt: new Date().toISOString(),
		},
	};
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
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

/**
 * The space a worktree belongs to, and where its target bare repo lives.
 *
 * Throws for a detached HEAD, with its own message: warp pushes a BRANCH, and
 * "check out a branch first" is something the user can act on.
 */
export function describeSpace(cwd: string): WarpSpaceInfo | null {
	const root = findSpaceRoot(cwd);
	if (root === null) return null;
	const rel = toPosix(relative(root, cwd));
	const bare = spaceBarePath(root, rel);
	if (bare === null) return null;
	const head = projectWorktreeHead(cwd);
	if (head.state === "detached") {
		throw new MachineError(
			`The worktree at ${cwd} has a detached HEAD. Warp moves a space worktree by pushing its branch to the target, so there has to be one: check out a branch (\`git switch -c <name>\`) and run this again.`,
		);
	}
	if (head.state !== "branch") return null;
	return { root, name: basename(root), barePath: bare, branch: head.branch };
}

/**
 * The bare project repo a worktree under `root` belongs to.
 *
 * `worktrees/<branch>` is a BARE space's layout (its project repo is the
 * `.git` at the root); `code/<slug>/worktrees/<branch>` is a MULTI space's.
 */
export function spaceBarePath(root: string, relToRoot: string): string | null {
	if (relToRoot === "worktrees" || relToRoot.startsWith("worktrees/")) return join(root, ".git");
	const multi = /^code\/([^/]+)\/worktrees(\/|$)/.exec(relToRoot);
	if (multi) return join(root, "code", multi[1] as string, ".git");
	return null;
}

/**
 * The `cwd` a transcript is about, read from its first line.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): every transcript line is a JSON object
 * carrying the session's `cwd`.
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
			return undefined;
		}
	}
	return undefined;
}

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

/** The marker changed under us: another warp, or a sync, got there first. */
export class MarkerConflictError extends Error {
	constructor(path: string, detail: string) {
		super(
			`the ownership marker ${path} changed while warp was running (${detail}). Another warp of this session may be running. Nothing was overwritten; check who owns it and run this again.`,
		);
		this.name = "MarkerConflictError";
	}
}

function sameMarker(a: OwnerMarker | null, b: OwnerMarker | null): boolean {
	if (a === null || b === null) return a === b;
	return a.owner === b.owner && a.at === b.at;
}

function parseMarker(raw: string): OwnerMarker | null {
	try {
		const parsed = JSON.parse(raw) as Partial<OwnerMarker>;
		return typeof parsed.owner === "string" && typeof parsed.at === "string"
			? { owner: parsed.owner, at: parsed.at }
			: null;
	} catch {
		return null;
	}
}

/**
 * Compare-and-swap the ownership marker at `path`: replace `expected` (null:
 * no marker) with `next` (null: remove it). Throws {@link MarkerConflictError}
 * and changes nothing when the file is not what was expected.
 *
 * Lock-free, with two atomic filesystem operations:
 *
 * - taking the current marker OUT of place with `rename` (only one process can
 *   move a given file), then checking it is the one expected;
 * - publishing the new one with `link`, which fails if a file is already
 *   there (exclusive create, unlike `rename`, which would overwrite).
 *
 * So two warps racing for one session cannot both win: one of them finds the
 * file gone or a different marker in place, and stops.
 */
export function swapMarker(
	path: string,
	expected: OwnerMarker | null,
	next: OwnerMarker | null,
): void {
	const dir = dirname(path);
	const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	let grabbed: string | null = null;
	if (expected !== null) {
		grabbed = join(dir, `.${basename(path)}.${unique}.old`);
		try {
			renameSync(path, grabbed);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new MarkerConflictError(path, "it was removed");
			}
			throw error;
		}
		const found = parseMarker(readFileSync(grabbed, "utf-8"));
		if (!sameMarker(found, expected)) {
			putBack(grabbed, path);
			throw new MarkerConflictError(
				path,
				`expected owner ${JSON.stringify(expected.owner)}, found ${found ? JSON.stringify(found.owner) : "something unreadable"}`,
			);
		}
	}
	if (next !== null) {
		const temp = join(dir, `.${basename(path)}.${unique}.new`);
		writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
		try {
			linkSync(temp, path);
		} catch (error) {
			rmSync(temp, { force: true });
			if (grabbed) putBack(grabbed, path);
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw new MarkerConflictError(path, "another marker was written meanwhile");
			}
			throw error;
		}
		rmSync(temp, { force: true });
	}
	if (grabbed) rmSync(grabbed, { force: true });
}

/**
 * A marker {@link swapMarker} moved aside (`.<id>.warp.json.<unique>.old`)
 * and never cleaned up, i.e. a swap that crashed. Null when there is none.
 */
export function findStrayMarker(folder: string, sessionId: string): string | null {
	const prefix = `.${sessionId}.warp.json.`;
	let names: string[];
	try {
		names = readdirSync(folder);
	} catch {
		return null;
	}
	const stray = names.find((name) => name.startsWith(prefix) && name.endsWith(".old"));
	return stray ? join(folder, stray) : null;
}

/** Put a marker we moved aside back, unless something else took its place. */
function putBack(grabbed: string, path: string): void {
	try {
		linkSync(grabbed, path);
	} catch {
		// Someone else published a marker meanwhile: theirs wins.
	}
	rmSync(grabbed, { force: true });
}

/**
 * Undo a warp that stopped before anything could reach the target: put the
 * previous marker back.
 *
 * Does nothing (and says why) when this run wrote no marker, when something
 * may already have been copied (the target may hold files claiming an
 * ownership this machine would then disown), or when the marker is no longer
 * the one this run wrote (another warp got there; never delete theirs).
 */
export function restoreMarker(
	plan: WarpPlan,
	execution: WarpExecution,
	swap: typeof swapMarker = swapMarker,
): { restored: boolean; reason?: string } {
	if (!execution.markerWritten) return { restored: false, reason: "this run never wrote it" };
	if (execution.copied) {
		return {
			restored: false,
			reason: `a copy to ${plan.target.name} was attempted, so files claiming that ownership may be there`,
		};
	}
	const step = plan.steps.find((entry) => entry.kind === "write-marker");
	if (step?.kind !== "write-marker") return { restored: false, reason: "the plan has no marker" };
	try {
		swap(step.path, execution.markerWritten, step.previous);
	} catch (error) {
		return { restored: false, reason: errorDetail(error) };
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
