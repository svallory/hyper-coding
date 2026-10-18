/**
 * What `hyper warp` sends, and when.
 *
 * `~/.claude/projects` can be gigabytes, so a warp sends Claude's data in
 * three tiers instead of the whole folder:
 *
 * 1. NOW (blocks the resume): the session's transcript and ownership marker
 *    (planned in warp.ts, they need the ownership checks), and here the small
 *    rest: the project's `memory/`, its `.session-aliases`, `file-history/<id>`
 *    and `session-env/<id>`.
 * 2. SOON (background, always on): `<id>/tool-results` and `<id>/subagents`,
 *    started right after the resume launches, so a second warp finishes it.
 * 3. ELSE (asked once): the project's other sessions, or every project.
 *
 * Everything in this file is a pure function over a `~/.claude` tree (pass a
 * fake one) or over plain values; nothing spawns or writes.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): the layout below is Claude Code's. Warp
 * copies each path to the SAME absolute path on the target, like the
 * transcript.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

/** One path warp sends. */
export interface TierEntry {
	/** Absolute source path. */
	src: string;
	/** A directory (sent as its contents) or a single file. */
	tree: boolean;
	/** Short name for plans and progress lines. */
	label: string;
}

/**
 * Parts of `~/.claude` that never travel, relative to it. `shell-snapshots` is
 * handled by {@link isNeverCopied}: only snapshots older than the session are
 * excluded, and none is needed to resume.
 */
export const NEVER_COPIED = ["sessions", "debug", "statsig", ".claude.json"] as const;

export interface NeverCopiedContext {
	/** mtime of the file when it lives in `shell-snapshots/`. */
	mtimeMs?: number;
	/** When the session began (epoch ms). */
	sessionStartMs?: number;
}

/**
 * True for a path (relative to `~/.claude`) warp must never send: the live
 * pid registry, debug logs, statsig cache, the global `.claude.json`, and any
 * shell snapshot older than the session.
 */
export function isNeverCopied(rel: string, context: NeverCopiedContext = {}): boolean {
	const parts = rel.split(sep).join("/").split("/").filter(Boolean);
	const first = parts[0];
	if (first === undefined) return false;
	if ((NEVER_COPIED as readonly string[]).includes(first)) return true;
	if (first === "shell-snapshots") {
		// Without both times we cannot show it is newer than the session.
		if (context.mtimeMs === undefined || context.sessionStartMs === undefined) return true;
		return context.mtimeMs < context.sessionStartMs;
	}
	return false;
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Tier 1 beyond the transcript and marker: the entries that exist, in order.
 * `home` is the Claude config dir, `key` the project folder name.
 */
export function tier1Extras(home: string, key: string, sessionId: string): TierEntry[] {
	const project = join(home, "projects", key);
	const out: TierEntry[] = [];
	const memory = join(project, "memory");
	if (isDir(memory)) out.push({ src: memory, tree: true, label: "project memory" });
	const aliases = join(project, ".session-aliases");
	if (isFile(aliases)) out.push({ src: aliases, tree: false, label: "session aliases" });
	const history = join(home, "file-history", sessionId);
	if (isDir(history)) out.push({ src: history, tree: true, label: "file history" });
	const env = join(home, "session-env", sessionId);
	if (isDir(env)) out.push({ src: env, tree: true, label: "session env" });
	return out;
}

/** Tier 2: the session's big folders, those that exist. */
export function tier2Entries(home: string, key: string, sessionId: string): TierEntry[] {
	const folder = join(home, "projects", key, sessionId);
	const out: TierEntry[] = [];
	for (const name of ["tool-results", "subagents"]) {
		const src = join(folder, name);
		if (isDir(src)) out.push({ src, tree: true, label: `${sessionId} ${name}` });
	}
	return out;
}

/** Bytes under a path (files only; unreadable entries count as zero). */
export function sizeOf(path: string): number {
	let total = 0;
	try {
		const stat = statSync(path);
		if (!stat.isDirectory()) return stat.size;
		for (const entry of readdirSync(path)) total += sizeOf(join(path, entry));
	} catch {
		/* vanished while counting */
	}
	return total;
}

/** The other sessions of a project: how many, and everything that is theirs. */
export interface OtherSessions {
	ids: string[];
	entries: TierEntry[];
	bytes: number;
}

/**
 * Tier 3, project scope: every transcript of the project but `sessionId`, with
 * its marker, its `<id>/` folder, its file history and session env.
 */
export function otherSessionEntries(home: string, key: string, sessionId: string): OtherSessions {
	const project = join(home, "projects", key);
	const ids: string[] = [];
	const entries: TierEntry[] = [];
	let names: string[] = [];
	try {
		names = readdirSync(project);
	} catch {
		/* no project folder */
	}
	for (const name of names.sort()) {
		if (extname(name) !== ".jsonl") continue;
		const id = name.slice(0, -".jsonl".length);
		if (id === sessionId) continue;
		ids.push(id);
		const add = (src: string, tree: boolean, label: string): void => {
			if (existsSync(src)) entries.push({ src, tree, label });
		};
		add(join(project, name), false, `${id} transcript`);
		add(join(project, `${id}.warp.json`), false, `${id} marker`);
		add(join(project, id), true, `${id} folder`);
		add(join(home, "file-history", id), true, `${id} file history`);
		add(join(home, "session-env", id), true, `${id} session env`);
	}
	return { ids, entries, bytes: entries.reduce((sum, entry) => sum + sizeOf(entry.src), 0) };
}

/** Tier 3, all projects: every project folder but `key` (its sessions are asked about separately). */
export function otherProjectEntries(home: string, key: string): OtherSessions {
	const root = join(home, "projects");
	const ids: string[] = [];
	const entries: TierEntry[] = [];
	let names: string[] = [];
	try {
		names = readdirSync(root);
	} catch {
		/* no projects */
	}
	for (const name of names.sort()) {
		const src = join(root, name);
		if (name === key || !isDir(src)) continue;
		ids.push(name);
		entries.push({ src, tree: true, label: `project ${name}` });
	}
	return { ids, entries, bytes: entries.reduce((sum, entry) => sum + sizeOf(entry.src), 0) };
}

/**
 * Entries that sit inside {@link NEVER_COPIED} (or the stale shell snapshots),
 * dropped. A last guard: the builders above never produce one.
 */
export function withoutNeverCopied(home: string, entries: TierEntry[]): TierEntry[] {
	return entries.filter((entry) => {
		const rel = relative(home, entry.src);
		return rel.startsWith("..") || !isNeverCopied(rel);
	});
}

/** The answer to "also sync the other sessions?". */
export type OthersMode = "now" | "background" | "no";

export function parseOthersMode(value: string): OthersMode | null {
	const answer = value.trim().toLowerCase();
	if (answer === "" || answer === "n" || answer === "no") return "no";
	if (answer === "now") return "now";
	if (answer === "b" || answer === "background") return "background";
	return null;
}

/** "12.3 MB" style size for the question. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** The one-line question for tier 3. */
export function othersQuestion(sessions: number, bytes: number, allProjects: boolean): string {
	const what = allProjects
		? `the ${sessions} other projects`
		: `the project's other ${sessions} sessions`;
	return `Also sync ${what} (${formatBytes(bytes)})? [now/background/no] (default no): `;
}

/** A session a person can choose between. */
export interface SessionCandidate {
	id: string;
	mtimeMs: number;
	/** What the user first typed in it, when known. */
	firstMessage: string | null;
}

export interface SessionChoiceInput {
	/** Transcripts of the directory, any order. */
	candidates: SessionCandidate[];
	/** `--session`. */
	explicit?: string;
	/** `CLAUDE_CODE_SESSION_ID`, set when run from inside a Claude session. */
	envSessionId?: string;
	/** Session ids of live registry entries whose cwd matches. */
	liveIds: string[];
	/** `--yes`: take the newest without asking. */
	yes: boolean;
}

export type SessionChoice =
	| { kind: "chosen"; id: string; why: "explicit" | "env" | "live" | "only" | "newest" }
	| { kind: "ask"; options: SessionCandidate[] };

/** How many sessions the picker offers. */
export const PICKER_SIZE = 5;

/**
 * Pick the session to warp. `--session` wins; then the running session's own
 * id; then the one live session of this directory; with one transcript, that;
 * `--yes` takes the newest; otherwise the newest five are offered.
 */
export function chooseSession(input: SessionChoiceInput): SessionChoice {
	const sorted = [...input.candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
	if (input.explicit !== undefined) return { kind: "chosen", id: input.explicit, why: "explicit" };
	const known = new Set(sorted.map((entry) => entry.id));
	if (input.envSessionId !== undefined && known.has(input.envSessionId)) {
		return { kind: "chosen", id: input.envSessionId, why: "env" };
	}
	const live = [...new Set(input.liveIds)].filter((id) => known.has(id));
	if (live.length === 1) return { kind: "chosen", id: live[0] as string, why: "live" };
	if (sorted.length === 1)
		return { kind: "chosen", id: (sorted[0] as SessionCandidate).id, why: "only" };
	if (input.yes && sorted.length > 0) {
		return { kind: "chosen", id: (sorted[0] as SessionCandidate).id, why: "newest" };
	}
	// Several live ones: ask among those; otherwise among the newest.
	const pool = live.length > 1 ? sorted.filter((entry) => live.includes(entry.id)) : sorted;
	return { kind: "ask", options: pool.slice(0, PICKER_SIZE) };
}

/** One picker line: `1) <id>  2026-10-18 10:02  first words`. */
export function pickerLine(index: number, entry: SessionCandidate): string {
	const when = new Date(entry.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
	return `${index + 1}) ${entry.id}  ${when}  ${entry.firstMessage ?? "(no user message)"}`;
}
