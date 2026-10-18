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
	/** Send only what is newer than the target's file (`--update`): shared data, other sessions. */
	update?: boolean;
	/** Transfer filter rules, `--include` first and then `--exclude`, in that order. */
	includes?: string[];
	excludes?: string[];
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
	if (isDir(memory)) out.push({ src: memory, tree: true, label: "project memory", update: true });
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

/** Tier 3 candidates: what would be sent, as few roots as possible, and what was left out. */
export interface OtherSessions {
	/** Sessions (or project folders) that will be sent. */
	ids: string[];
	/** One entry per root, never one per session: one transfer each. */
	entries: TierEntry[];
	/** The per-session paths behind `entries`, for {@link othersBytes} only. */
	sizePaths: string[];
	/** Sessions left out because another machine owns them or they run here. */
	skipped: { id: string; reason: string }[];
}

/** Bytes of what tier 3 would send; walks the trees, so call it only to ask the question. */
export function othersBytes(others: OtherSessions): number {
	return others.sizePaths.reduce((sum, path) => sum + sizeOf(path), 0);
}

/** A name safe to put in an rsync filter pattern. */
const FILTER_SAFE = /^[A-Za-z0-9_-]+$/;

/** `--include` rules that let exactly these `<id>` names (and what is under them) through. */
function includeIds(ids: string[], suffixes: readonly string[]): string[] {
	return ids.flatMap((id) => suffixes.map((suffix) => `/${id}${suffix}`));
}

/**
 * Tier 3, project scope: the project's other sessions with their markers,
 * `<id>/` folders, file history and session env, as THREE roots (the project
 * folder, `file-history`, `session-env`) filtered to the sessions kept.
 *
 * `skip` names a session to leave alone (owned by another machine, or running
 * here): sending ours over the target's newer copy would lose work. Every root
 * is sent with `--update` as well, so a newer file on the target survives.
 */
export function otherSessionEntries(
	home: string,
	key: string,
	sessionId: string,
	skip: (id: string) => string | null = () => null,
): OtherSessions {
	const project = join(home, "projects", key);
	const ids: string[] = [];
	const skipped: OtherSessions["skipped"] = [];
	const sizePaths: string[] = [];
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
		if (!FILTER_SAFE.test(id)) {
			skipped.push({ id, reason: "its name has characters a transfer filter cannot name safely" });
			continue;
		}
		const reason = skip(id);
		if (reason !== null) {
			skipped.push({ id, reason });
			continue;
		}
		ids.push(id);
		for (const path of [
			join(project, name),
			join(project, `${id}.warp.json`),
			join(project, id),
			join(home, "file-history", id),
			join(home, "session-env", id),
		]) {
			if (existsSync(path)) sizePaths.push(path);
		}
	}
	const entries: TierEntry[] =
		ids.length === 0
			? []
			: [
					{
						src: project,
						tree: true,
						label: "the project's other sessions",
						update: true,
						includes: includeIds(ids, [".jsonl", ".warp.json", "/", "/**"]),
						excludes: ["*"],
					},
					...["file-history", "session-env"]
						.filter((folder) => isDir(join(home, folder)))
						.map((folder) => ({
							src: join(home, folder),
							tree: true,
							label: `their ${folder}`,
							update: true,
							includes: includeIds(ids, ["/", "/**"]),
							excludes: ["*"],
						})),
				];
	return { ids, entries, sizePaths, skipped };
}

/** Tier 3, all projects: one root, `projects/` without the current project; `--update` keeps newer target files. */
export function otherProjectEntries(home: string, key: string): OtherSessions {
	const root = join(home, "projects");
	const ids: string[] = [];
	const sizePaths: string[] = [];
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
		sizePaths.push(src);
	}
	const entries: TierEntry[] =
		ids.length === 0
			? []
			: [
					{
						src: root,
						tree: true,
						label: "every other project",
						update: true,
						excludes: [`/${key}/`],
					},
				];
	return { ids, entries, sizePaths, skipped: [] };
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
	| { kind: "ask"; options: SessionCandidate[] }
	/** No transcript to choose from: the caller reports it, not a prompt. */
	| { kind: "none" };

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
	if (sorted.length === 0) return { kind: "none" };
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
