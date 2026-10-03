import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { DEFAULT_CONFIG, DEFAULT_MACHINE, type DriveConfig, type SyncCadence } from "./schema.js";

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

function configProblem(path: string, detail: string): ConfigError {
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
			`defaults.cadence must be one of "manual", "session-end", "session-end+push" (or empty) — got ${JSON.stringify(config.defaults.cadence)}.`,
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

/**
 * Patch `drive.toml` with the given values and write it back atomically
 * (temp file + rename). Unknown keys and sections already in the file are
 * preserved: the existing TOML is parsed and the patch deep-merged over it,
 * so `hyper drive init` never discards a `[machines.*]` or `[sync.*]` table
 * it knows nothing about. Creates the config directory when missing, and
 * leaves the file untouched when the patch changes nothing.
 */
export function writeConfig(patch: Record<string, unknown>): string {
	const path = configPath();
	let existing: Record<string, unknown> = {};
	if (existsSync(path)) {
		existing = readAndParse(path);
		validateShape(path, existing);
	}
	const next = stringifyTOML(deepMerge(existing, patch));
	if (existsSync(path) && readFileSync(path, "utf-8") === next) return path;
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, next, "utf-8");
	renameSync(tmp, path);
	return path;
}
