import { homedir } from "node:os";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";

export type SyncCadence = "" | "manual" | "session-end" | "session-end+push";

export interface SelfConfig {
	/** This machine's name. */
	name: string;
	/** This machine's home dir (default: os.homedir()). */
	home: string;
}

export interface DefaultsConfig {
	/** When spaces sync to the hyperdrive: manual, on session end, or on session end plus push. */
	cadence: SyncCadence;
}

export interface MachineConfig {
	/** Home dir on that machine. */
	home: string;
	/** Features available on that machine. */
	features: string[];
	/** User agents run as on that machine. */
	agent_user: string;
	/**
	 * Path to a ssh PUBLIC key (.pub) the agent user should accept, so setup can
	 * open a session as that user on this machine. Empty means "ask", and then
	 * the default key in the user's own ~/.ssh is read. A private key is never
	 * read — see services/machine/tasks/agent-key.ts.
	 */
	agent_key: string;
}

/**
 * What an agent user name may look like.
 *
 * This name ends up INSIDE A ROOT SCRIPT: as `useradd`'s argument, in the
 * `gpasswd` line that removes a group membership, as the path of a file that
 * gets deleted, and in text the user pastes into their shell. A value carrying
 * shell syntax would therefore run as root, and one like `..` or `*` would turn
 * the drop-in deletion into "delete something else". So the name is restricted
 * to what a POSIX user name can actually be: lower case, starting with a letter
 * or underscore, no dots, no slashes, no shell metacharacters.
 *
 * Deliberately not `^\w+$`: `\w` is Unicode-aware in JavaScript's regex
 * flavour, and this name has to be safe to hand to a shell on any machine, not
 * only one whose locale can represent it.
 */
export const AGENT_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * The reserved name `agent_user` may never take.
 *
 * `root` is uid 0 on every machine, and the agent user's entire purpose is to
 * be the user with NO privileges. Naming it `root` would make `rm -f <drop-in>`
 * delete the root user's own drop-in and the `gpasswd` line strip root's group
 * memberships — which is precisely the damage this check exists to prevent.
 */
export const FORBIDDEN_AGENT_USER = "root";

/**
 * Is this a name the agent user is allowed to have?
 *
 * Shared by config validation, the machine tasks and the generated root script
 * so the three cannot disagree about what is legal. A root script generated
 * from a name this rejects would be a script that does something other than
 * what it says it does.
 */
export function isValidAgentUser(name: unknown): name is string {
	return typeof name === "string" && AGENT_USER_PATTERN.test(name) && name !== FORBIDDEN_AGENT_USER;
}

/** Why a name was refused, in a sentence that names what is wrong. */
export function agentUserProblem(name: unknown): string {
	if (typeof name !== "string") return `it is ${typeof name}, not a name`;
	if (name === FORBIDDEN_AGENT_USER) {
		return `\`${FORBIDDEN_AGENT_USER}\` is the one account that cannot be the unattended agent`;
	}
	if (name === "") return "it is empty";
	if (name !== name.trim()) return "it has leading or trailing whitespace";
	if (!AGENT_USER_PATTERN.test(name)) {
		return "it must be lower case, start with a letter or underscore, and contain only letters, digits, underscores and dashes (up to 32 characters)";
	}
	return "it is not a usable user name";
}

export interface WarpConfig {
	/** Directory names excluded when warping a session between machines. */
	exclude: string[];
}

export interface SyncTargetConfig {
	/** Extra ignore patterns for this sync target. */
	ignore: string[];
}

/** The two config dirs hyperdrive keeps in sync. */
export type SyncTarget = keyof SyncConfig;

/**
 * Paths under `~/.claude` that must never be synced (packaged defaults; the
 * user's `[sync.claude] ignore` is appended to these).
 *
 * Taken verbatim from the `ignore.paths` the engine stores for the operator's
 * live `claude-config` session — same list, same order, same spelling.
 *
 * THE LEADING SLASH IS PART OF THE PATTERN and is not cosmetic: it anchors the
 * pattern to the root of the synced directory. Unanchored, a root entry like
 * `sessions` also matches a directory of that name at ANY depth —
 * `skills/debug/`, `plugins/.trash/stuff/cache/` — so the entries below are
 * stored exactly as written. `.DS_Store` is the one unanchored entry, matching
 * the live session: the OS puts it at every level and it is cheap to ignore
 * everywhere.
 *
 * What the list covers: machine-local runtime state (sessions, caches, logs,
 * daemons), anything holding credentials or tokens, editor/OS noise, and mutable
 * per-machine settings whose last-writer-wins resolution would make two machines
 * fight. Everything else (skills, commands, agents, CLAUDE.md) is meant to be
 * shared, so it is deliberately NOT here.
 *
 * A constant rather than a config file because it is a product decision, not a
 * setting (C-14).
 */
export const CLAUDE_SYNC_IGNORE: readonly string[] = [
	"/.credentials.json",
	"/.claude.json*",
	"/sessions",
	"/state",
	"/cache",
	"/debug",
	"/telemetry",
	"/daemon",
	"/daemon.log",
	"/ide",
	"/backups",
	"/shell-snapshots",
	"/statusline*.sh",
	"/stats-cache.json",
	"/policy-limits.json*",
	"/remote-settings.json",
	"/.last-*",
	"/gh-pr-status-cache.json",
	"/mcp-needs-auth-cache.json",
	".DS_Store",
	"/usage-data",
	"/jobs",
	"/channels",
	"/chrome",
	"/feedback",
	"/.caveman-active",
	"/downloads",
	"/settings.json.bak*",
	"/.anthropic",
	"/plugins/.trash",
	"/security/agent-sdk-venv",
];

/**
 * Claude Code state that DOES sync between machines (it is the user's, it
 * follows them) but never belongs in a space's history: prompt history,
 * transcripts and their working files, installed plugins, Claude's own
 * install. Together with every anchored {@link CLAUDE_SYNC_IGNORE} entry it is
 * {@link CLAUDE_USER_STATE}: what hyper never tracks under any `.claude/`.
 * Entries are relative to the `.claude/` directory; `*` is a glob.
 */
export const CLAUDE_SYNCED_USER_STATE: readonly string[] = [
	"history.jsonl",
	"projects",
	"todos",
	"plans",
	"tasks",
	"teams",
	"file-history",
	"paste-cache",
	"session-env",
	"shell-snapshots",
	"statsig",
	"plugins",
	"local",
	"security_warnings_state_*",
];

/**
 * Sync-ignore entries that are NOT Claude Code state and so never count as
 * user state in a space: a third-party plugin's flag file, and the status
 * line script, which a project's own `.claude/settings.json` may legitimately
 * point at (review of PR #54, N5).
 */
export const NOT_CLAUDE_USER_STATE: readonly string[] = [".caveman-active", "statusline*.sh"];

/**
 * Claude Code's per-user, per-machine state, as entries relative to a
 * `.claude/` directory: every root-anchored {@link CLAUDE_SYNC_IGNORE} entry
 * (credentials, sessions, caches, daemon, logs, backups, …) plus
 * {@link CLAUDE_SYNCED_USER_STATE}, minus {@link NOT_CLAUDE_USER_STATE}. ONE
 * list for both concerns, so an entry added to the sync ignore list is never
 * tracked in a space either. A space's `.claude/` only holds these when Claude
 * was pointed at it as its config dir; hyper then leaves them out of every
 * commit (ac-gaps item 7).
 */
export const CLAUDE_USER_STATE: readonly string[] = [
	...new Set([
		...CLAUDE_SYNC_IGNORE.filter((entry) => entry.startsWith("/")).map((entry) => entry.slice(1)),
		...CLAUDE_SYNCED_USER_STATE,
	]),
].filter((entry) => !NOT_CLAUDE_USER_STATE.includes(entry));

/**
 * The {@link CLAUDE_USER_STATE} entries whose names are Claude's own and
 * unmistakable, matched under a `.claude/` at ANY depth of the space. Every
 * other entry (`plans`, `tasks`, `state`, `cache`, `local`, `debug`,
 * `plugins`, …) is a generic name a project could use for its own files, so it
 * counts only in the space's TOP-LEVEL `.claude/`, the one Claude can be
 * pointed at as its config dir (review of PR #54, N5).
 */
export const CLAUDE_USER_STATE_ANYWHERE: readonly string[] = [
	".credentials.json",
	".claude.json*",
	"history.jsonl",
	"projects",
	"sessions",
	"session-env",
	"todos",
	"file-history",
	"paste-cache",
	"shell-snapshots",
	"statsig",
	"telemetry",
	"stats-cache.json",
	"mcp-needs-auth-cache.json",
	"policy-limits.json*",
	"remote-settings.json",
	"gh-pr-status-cache.json",
	"security_warnings_state_*",
	"settings.json.bak*",
	".last-*",
	"daemon.log",
	"usage-data",
	".anthropic",
];

/**
 * Paths under `~/.pi/agent` that must never be synced, verbatim from the live
 * `pi-config` session.
 *
 * `/install` and `/bin` are root-anchored WITHOUT a trailing slash: they are
 * the entries, not "a directory with this name".
 */
export const PI_SYNC_IGNORE: readonly string[] = ["/auth.json", "/install", "/bin", ".DS_Store"];

/** The packaged ignore list for a target. */
export function packagedSyncIgnore(target: SyncTarget): readonly string[] {
	return target === "pi" ? PI_SYNC_IGNORE : CLAUDE_SYNC_IGNORE;
}

/**
 * The ignore list to hand the sync engine: packaged patterns first, then the
 * user's own, de-duplicated with the first occurrence winning.
 *
 * Order matters — the engine receives patterns in this order — so appending is
 * the only merge that makes sense. A user pattern that repeats a packaged one is
 * dropped rather than passed twice: the engine would accept it, but the session
 * it stores would then differ from the list `sync-config` prints, and the
 * mismatch check would report a session hyperdrive had just created itself.
 */
export function syncIgnoreFor(target: SyncTarget, config: DriveConfig): string[] {
	const user = config.sync?.[target]?.ignore ?? [];
	const merged: string[] = [];
	for (const pattern of [...packagedSyncIgnore(target), ...user]) {
		const trimmed = pattern.trim();
		if (trimmed === "" || merged.includes(trimmed)) continue;
		merged.push(trimmed);
	}
	return merged;
}

export interface SyncConfig {
	claude: SyncTargetConfig;
	pi: SyncTargetConfig;
}

export interface DriveConfig {
	/** Git URL of the user's hyperdrive repo. */
	remote: string;
	self: SelfConfig;
	defaults: DefaultsConfig;
	machines: Record<string, MachineConfig>;
	warp: WarpConfig;
	sync: SyncConfig;
}

export const DEFAULT_MACHINE: MachineConfig = {
	home: "",
	features: [],
	agent_user: "agent",
	agent_key: "",
};

/* ------------------------------------------------------------------------- */
/* Manifest — spaces.yaml on `main` of the hyperdrive repository (design.md  */
/* "Data Model"). Owned by services/manifest.ts.                             */
/* ------------------------------------------------------------------------- */

/** One project repository of a space. `slug` is set only in a multi space. */
export interface SpaceRepo {
	url: string;
	default_branch: string;
	slug?: string;
}

/** One space, as recorded in the hyperdrive manifest. */
export interface SpaceEntry {
	name: string;
	branch: string;
	group: string | null;
	path: string;
	layout: "bare" | "multi";
	repos: SpaceRepo[];
	cadence: SyncCadence;
	/** Extra allowlist entries beyond the packaged defaults. */
	tracked: string[];
	/** Visibility axis; unused in phase one. */
	public: string[];
}

/** The whole of `spaces.yaml`. */
export interface Manifest {
	spaces: SpaceEntry[];
}

export const EMPTY_MANIFEST: Manifest = { spaces: [] };

const SPACE_LAYOUTS: readonly SpaceEntry["layout"][] = ["bare", "multi"];

// Same list as ALLOWED_CADENCES in config/index.ts, kept local so schema.ts
// stays import-free (index.ts already imports the types from here).
const MANIFEST_CADENCES: readonly SyncCadence[] = ["", "manual", "session-end", "session-end+push"];

/**
 * The shape a space name (and a group) may take: starts with a letter or
 * digit, then lowercase letters, digits, dots, underscores and dashes, and
 * never `..`. It doubles as a path segment and half of a branch name, so it
 * must be boring by construction — `/`, `\` and control characters can never
 * reach the filesystem or `git check-ref-format`.
 */
export const SPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isValidSpaceName(name: string): boolean {
	return SPACE_NAME_PATTERN.test(name) && !name.includes("..");
}

/** Keys a SpaceEntry is allowed to carry, in the order they are written. */
export const SPACE_ENTRY_KEYS = [
	"name",
	"branch",
	"group",
	"path",
	"layout",
	"repos",
	"cadence",
	"tracked",
	"public",
] as const;

const SPACE_REPO_KEYS = ["url", "default_branch", "slug"] as const;

/**
 * Friendly manifest problem, in the style of ConfigError: one sentence naming
 * the file and the offending key. Commands render it without a stack trace.
 */
export class ManifestError extends Error {
	constructor(path: string, detail: string) {
		super(`There's a problem with the hyperdrive manifest at ${path}: ${detail}`);
		this.name = "ManifestError";
	}
}

function manifestProblem(path: string, detail: string): ManifestError {
	return new ManifestError(path, detail);
}

/** A scalar the manifest gave us, as terminal-safe text. */
function describeValue(value: unknown): string {
	return typeof value === "string"
		? quoteForTerminal(value)
		: escapeControlCharacters(JSON.stringify(value) ?? String(value));
}

function describeYaml(value: unknown): string {
	if (Array.isArray(value)) return "a list";
	if (value === null) return "null";
	return `a ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function needString(path: string, key: string, value: unknown): string {
	if (typeof value !== "string") {
		throw manifestProblem(path, `\`${key}\` must be a string, but it is ${describeYaml(value)}.`);
	}
	return value;
}

function needStringList(path: string, key: string, value: unknown): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw manifestProblem(path, `\`${key}\` must be a list of strings.`);
	}
	return value;
}

function warnUnknown(
	path: string,
	scope: string,
	raw: Record<string, unknown>,
	known: readonly string[],
): void {
	for (const key of Object.keys(raw)) {
		if (!known.includes(key)) {
			process.stderr.write(
				// The key is manifest data: escape it so a control character in a
				// key cannot drive the terminal that prints this warning.
				`warning: ignoring unknown key \`${escapeControlCharacters(`${scope}${key}`)}\` in the hyperdrive manifest at ${path}\n`,
			);
		}
	}
}

function validateRepo(path: string, index: number, raw: unknown): SpaceRepo {
	if (!isRecord(raw)) {
		throw manifestProblem(
			path,
			`\`repos[${index}]\` must be a map, but it is ${describeYaml(raw)}.`,
		);
	}
	warnUnknown(path, `repos[${index}].`, raw, SPACE_REPO_KEYS);
	const repo: SpaceRepo = {
		// A local-only repository has no URL to clone; clone reports it as skipped.
		url: raw.url === undefined ? "" : needString(path, `repos[${index}].url`, raw.url),
		default_branch: needString(path, `repos[${index}].default_branch`, raw.default_branch),
	};
	if (raw.slug !== undefined) {
		repo.slug = needString(path, `repos[${index}].slug`, raw.slug);
	}
	return repo;
}

function validateSpace(path: string, raw: unknown): SpaceEntry {
	if (!isRecord(raw)) {
		throw manifestProblem(
			path,
			`every entry of \`spaces\` must be a map, but one is ${describeYaml(raw)}.`,
		);
	}
	warnUnknown(path, "", raw, SPACE_ENTRY_KEYS);

	const name = needString(path, "name", raw.name);
	if (!isValidSpaceName(name)) {
		throw manifestProblem(
			path,
			`\`name\` must be a space name — lowercase letters, digits, dots, underscores and ` +
				`dashes, no "..", and the manifest entry for ${quoteForTerminal(name)} breaks that.`,
		);
	}
	const key = (field: string) => `spaces entry ${quoteForTerminal(name)}: \`${field}\``;

	if (typeof raw.group === "string" && !isValidSpaceName(raw.group)) {
		throw manifestProblem(
			path,
			`\`group\` must be a space name (same shape as \`name\`), but it is ${quoteForTerminal(raw.group)}.`,
		);
	}
	if (raw.group !== null && typeof raw.group !== "string") {
		throw manifestProblem(
			path,
			`${key("group")} must be a string or null, but it is ${describeYaml(raw.group)}.`,
		);
	}
	if (!SPACE_LAYOUTS.includes(raw.layout as SpaceEntry["layout"])) {
		throw manifestProblem(
			path,
			`${key("layout")} must be "bare" or "multi", but it is ${describeValue(raw.layout)}.`,
		);
	}
	if (!Array.isArray(raw.repos)) {
		throw manifestProblem(
			path,
			`${key("repos")} must be a list, but it is ${describeYaml(raw.repos)}.`,
		);
	}
	if (!MANIFEST_CADENCES.includes(raw.cadence as SyncCadence)) {
		throw manifestProblem(
			path,
			`${key("cadence")} must be one of "manual", "session-end", "session-end+push" (or empty) — got ${describeValue(raw.cadence)}.`,
		);
	}

	return {
		name,
		branch: needString(path, key("branch"), raw.branch),
		group: raw.group as string | null,
		path: needString(path, key("path"), raw.path),
		layout: raw.layout as SpaceEntry["layout"],
		repos: raw.repos.map((repo, index) => validateRepo(path, index, repo)),
		cadence: raw.cadence as SyncCadence,
		tracked: needStringList(path, key("tracked"), raw.tracked),
		public: needStringList(path, key("public"), raw.public),
	};
}

/**
 * Validate raw parsed YAML as a Manifest. Unknown keys warn on stderr and are
 * dropped; wrong types throw a ManifestError naming the key.
 */
export function validateManifest(path: string, raw: unknown): Manifest {
	if (!isRecord(raw)) {
		throw manifestProblem(path, `the top level must be a map, but it is ${describeYaml(raw)}.`);
	}
	warnUnknown(path, "", raw, ["spaces"]);
	if (!Array.isArray(raw.spaces)) {
		throw manifestProblem(
			path,
			`\`spaces\` must be a list, but it is ${describeYaml(raw.spaces)}.`,
		);
	}
	return { spaces: raw.spaces.map((entry) => validateSpace(path, entry)) };
}

export const DEFAULT_CONFIG: DriveConfig = {
	remote: "",
	self: {
		name: "",
		home: homedir(),
	},
	defaults: {
		cadence: "",
	},
	machines: {},
	warp: {
		exclude: ["node_modules", "_build", "deps", "target", "dist", ".turbo", ".cache", ".next"],
	},
	sync: {
		claude: { ignore: [] },
		pi: { ignore: [] },
	},
};
