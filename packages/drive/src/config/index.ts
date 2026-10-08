import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { quoteForTerminal } from "#lib/terminal-text";
// The engine owns the rules for what an ignore pattern can be (C-8): the
// config loader asks through the engine module rather than importing the
// implementation directly.
import { ignorePatternProblem } from "#services/sync/engine";
import {
	agentUserProblem,
	DEFAULT_CONFIG,
	DEFAULT_MACHINE,
	type DriveConfig,
	isValidAgentUser,
	type SyncCadence,
} from "./schema.js";

/**
 * The one user config file lives at ~/.config/hyper/drive.toml (C-14).
 * HYPER_DRIVE_CONFIG overrides the path (used by tests and tooling).
 */
const CONFIG_PATH = resolve(homedir(), ".config/hyper/drive.toml");

const ALLOWED_CADENCES: readonly SyncCadence[] = ["", "manual", "session-end", "session-end+push"];

export function configPath(): string {
	const override = process.env.HYPER_DRIVE_CONFIG;
	if (!override) return CONFIG_PATH;
	return resolve(override);
}

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return p;
}

function deepMerge<T extends Record<string, unknown>>(
	base: T,
	override: Record<string, unknown>,
): T {
	const result = { ...base } as Record<string, unknown>;
	for (const [key, value] of Object.entries(override)) {
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			result[key] !== null &&
			typeof result[key] === "object" &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else {
			result[key] = value;
		}
	}
	return result as T;
}

export function configExists(): boolean {
	return existsSync(configPath());
}

export class ConfigError extends Error {
	constructor(path: string, detail: string) {
		super(`There's a problem with your hyperdrive config at ${path}: ${detail}`);
		this.name = "ConfigError";
	}
}

export function configProblem(path: string, detail: string): ConfigError {
	return new ConfigError(path, detail);
}

/**
 * True only for TOML tables. smol-toml yields `Date` for bare dates, so a plain
 * prototype check is needed on top of the typeof/array guards.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function describe(value: unknown): string {
	if (Array.isArray(value)) return "a list";
	if (value === null) return "nothing";
	if (value instanceof Date) return "a date";
	return `a ${typeof value}`;
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

const TABLE_KEYS = ["self", "defaults", "warp", "sync", "machines"] as const;
const SYNC_TARGETS = ["claude", "pi"] as const;

/**
 * Validate the raw parsed TOML before it reaches deepMerge, so a scalar where
 * a table is expected (e.g. `self = "x"`) is reported in a friendly way instead
 * of blowing up on a later property write.
 */
function validateShape(path: string, raw: Record<string, unknown>): void {
	for (const key of TABLE_KEYS) {
		if (!(key in raw)) continue;
		if (!isPlainObject(raw[key])) {
			throw configProblem(path, `\`${key}\` must be a section, but it is ${describe(raw[key])}.`);
		}
	}

	if ("self" in raw) {
		// SAFETY: validated as a table just above.
		const self = raw.self as Record<string, unknown>;
		for (const field of ["name", "home"] as const) {
			if (field in self && typeof self[field] !== "string") {
				throw configProblem(
					path,
					`\`self.${field}\` must be a string, but it is ${describe(self[field])}.`,
				);
			}
		}
	}

	if ("sync" in raw) {
		// SAFETY: validated as a table by the TABLE_KEYS loop above.
		const sync = raw.sync as Record<string, unknown>;
		for (const target of SYNC_TARGETS) {
			if (!(target in sync)) continue;
			if (!isPlainObject(sync[target])) {
				throw configProblem(
					path,
					`\`sync.${target}\` must be a section, but it is ${describe(sync[target])}.`,
				);
			}
			// SAFETY: validated as a table just above.
			const entry = sync[target] as Record<string, unknown>;
			if ("ignore" in entry && !isStringList(entry.ignore)) {
				throw configProblem(path, `\`sync.${target}.ignore\` must be a list of strings.`);
			}
			// SAFETY: isStringList() just proved it is a list of strings.
			if ("ignore" in entry && isStringList(entry.ignore)) {
				for (const pattern of entry.ignore) {
					const problem = ignorePatternProblem(pattern);
					if (problem) {
						throw configProblem(path, `\`sync.${target}.ignore\`: ${problem}`);
					}
				}
			}
		}
	}

	if ("machines" in raw) {
		// SAFETY: validated as a table by the TABLE_KEYS loop above.
		const machines = raw.machines as Record<string, unknown>;
		for (const [name, machine] of Object.entries(machines)) {
			if (!isPlainObject(machine)) {
				throw configProblem(
					path,
					`\`machines.${name}\` must be a section, but it is ${describe(machine)}.`,
				);
			}
			if ("features" in machine && !isStringList(machine.features)) {
				throw configProblem(path, `\`machines.${name}.features\` must be a list of strings.`);
			}
			if ("agent_user" in machine && typeof machine.agent_user !== "string") {
				throw configProblem(
					path,
					`\`machines.${name}.agent_user\` must be a string, but it is ${describe(machine.agent_user)}.`,
				);
			}
			if ("agent_user" in machine && !isValidAgentUser(machine.agent_user)) {
				// Not just a type check: this name is interpolated into a root script,
				// so a value carrying shell syntax is a way to run something as root.
				// See AGENT_USER_PATTERN.
				throw configProblem(
					path,
					`\`machines.${name}.agent_user\` is ${describe(machine.agent_user)}, which can't be the agent user: ${agentUserProblem(machine.agent_user)}.`,
				);
			}
			if ("home" in machine && typeof machine.home !== "string") {
				throw configProblem(
					path,
					`\`machines.${name}.home\` must be a string, but it is ${describe(machine.home)}.`,
				);
			}
		}
	}
}

function readAndParse(path: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw configProblem(path, `I couldn't read it (${detail}).`);
	}

	try {
		return parseTOML(raw) as Record<string, unknown>;
	} catch (err) {
		// smol-toml errors include line/column in their message
		const detail = err instanceof Error ? err.message : String(err);
		throw configProblem(path, `the TOML didn't parse — ${detail}`);
	}
}

function validate(path: string, config: DriveConfig): void {
	if (typeof config.remote !== "string") {
		throw configProblem(path, "`remote` must be a string (a git URL).");
	}

	if (typeof config.self.name !== "string" || typeof config.self.home !== "string") {
		throw configProblem(path, "`self.name` and `self.home` must be strings.");
	}

	if (!ALLOWED_CADENCES.includes(config.defaults.cadence)) {
		throw configProblem(
			path,
			`defaults.cadence must be one of "manual", "session-end", "session-end+push" (or empty) — got ${quoteForTerminal(String(config.defaults.cadence))}.`,
		);
	}

	if (!isStringList(config.warp.exclude)) {
		throw configProblem(path, "`warp.exclude` must be a list of strings.");
	}
}

export function loadConfig(): DriveConfig {
	const path = configPath();
	let fileConfig: Record<string, unknown> = {};

	if (existsSync(path)) {
		fileConfig = readAndParse(path);
		validateShape(path, fileConfig);
	}

	// SAFETY: fileConfig passed validateShape(), so every table it overrides is a
	// plain object. Merge onto a clone so omitted keys never alias DEFAULT_CONFIG.
	const merged = deepMerge(
		structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
		fileConfig,
	) as unknown as DriveConfig;

	// Fill per-machine defaults (deepMerge can't, since `machines` starts empty).
	// Clone so machines that omit `features` don't share one array instance.
	for (const [name, machine] of Object.entries(merged.machines)) {
		merged.machines[name] = {
			...structuredClone(DEFAULT_MACHINE),
			...machine,
			// A remote machine's home is on that machine, not here: a `~/` would
			// expand to the wrong user's home. `~` expansion is therefore done only
			// for `self.home` below; ssh/rsync resolve a leading `~` on the target.
			home: machine.home || DEFAULT_MACHINE.home,
		};
	}

	// Home expansion / fallback
	merged.self.home = merged.self.home ? expandHome(merged.self.home) : homedir();

	validate(path, merged);

	return merged;
}

/** The parsed file exactly as the user wrote it, or null when there is none. */
export function readRawConfig(): Record<string, unknown> | null {
	const path = configPath();
	if (!existsSync(path)) return null;
	return readAndParse(path);
}

/** Recursive partial, so one section can be patched without the whole config. */
export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends readonly unknown[]
		? T[K]
		: T[K] extends object
			? DeepPartial<T[K]>
			: T[K];
};

/**
 * Every value the patch produced, checked as a complete config.
 *
 * The merge is over the file alone, so a partial file has no `remote` or
 * `self.name` and `validate` would reject it for missing keys it never
 * claimed. Filling the defaults first is what makes the check about the
 * *values* — a `home = 5` merged in by a patch is still caught.
 */
function validateComplete(path: string, raw: Record<string, unknown>): void {
	// SAFETY: the defaults make every DriveConfig key present, so the merged view
	// is a complete DriveConfig; validate() is what actually enforces that.
	const complete = deepMerge(
		structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
		raw,
	) as unknown as DriveConfig;
	validate(path, complete);
}

/**
 * Patch `drive.toml` with the given values and write it back atomically
 * (temp file + rename). Unknown keys and sections already in the file are
 * preserved: the existing TOML is parsed and the patch deep-merged over it,
 * so `hyper drive setup` never discards a `[machines.*]` or `[sync.*]` table
 * it knows nothing about. Creates the config directory when missing, and
 * leaves the file untouched when the patch changes nothing.
 *
 * Merge semantics: nested tables merge key by key, so patching one field of a
 * `[machines.*]` table leaves its other fields alone. **Arrays are replaced,
 * not appended** — `features = ["tools"]` is what the caller says the machine
 * has, and merging lists would make the second write a lie.
 *
 * Nothing is written that could not be read back. The existing file's *shape*
 * is validated before it is used as a base (so a `sync = 3` sitting in the
 * file is reported rather than merged into), and both the merged values and
 * the serialized text are validated before the rename — a patch that would
 * produce an unusable config leaves the old file byte-for-byte intact, and a
 * failed write removes its temp file rather than leaving it behind.
 *
 * Two things a write does *not* preserve, deliberately:
 * - **Comments and formatting.** smol-toml serializes values, not the
 *   document, so `# notes` above a key do not survive. Don't put anything in a
 *   comment that the file can't also say structurally.
 * - **The file's inode.** `rename` replaces whatever sits at the path: a
 *   symlinked `drive.toml` becomes a regular file and the mode resets to the
 *   process umask. The *contents* are protected; the path's own identity is
 *   not a guarantee we make.
 */
export function writeConfig(patch: Record<string, unknown>): string {
	const path = configPath();
	let existing: Record<string, unknown> = {};
	if (existsSync(path)) {
		existing = readAndParse(path);
		// Shape first, before this becomes the base: a table where a scalar
		// belongs merges into a complete-looking config and only fails later, in
		// whichever command reads the file next.
		validateShape(path, existing);
	}
	const merged = deepMerge(existing, patch);
	validateComplete(path, merged);

	const next = stringifyTOML(merged);
	if (existsSync(path) && readFileSync(path, "utf-8") === next) return path;

	// And the text itself: stringifyTOML has to produce something loadConfig can
	// actually read, which the merge check above cannot see.
	const roundTripped = parseTOML(next) as Record<string, unknown>;
	validateShape(path, roundTripped);
	validateComplete(path, roundTripped);

	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	try {
		writeFileSync(tmp, next, "utf-8");
		renameSync(tmp, path);
	} catch (err) {
		rmSync(tmp, { force: true });
		throw err;
	}
	return path;
}
