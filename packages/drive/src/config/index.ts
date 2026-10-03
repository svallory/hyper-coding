import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseTOML } from "smol-toml";
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

function configProblem(path: string, detail: string): Error {
	return new Error(`There's a problem with your hyperdrive config at ${path}: ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
	if (Array.isArray(value)) return "a list";
	if (value === null) return "nothing";
	return `a ${typeof value}`;
}

const TABLE_KEYS = ["self", "defaults", "warp", "sync", "machines"] as const;

/**
 * Validate the raw parsed TOML before it reaches deepMerge, so a scalar where
 * a table is expected (e.g. `self = "x"`) is reported friendlyly instead of
 * blowing up on a later property write.
 */
function validateShape(path: string, raw: Record<string, unknown>): void {
	for (const key of TABLE_KEYS) {
		if (!(key in raw)) continue;
		if (!isPlainObject(raw[key])) {
			throw configProblem(path, `\`${key}\` must be a section, but it is ${describe(raw[key])}.`);
		}
	}

	if ("machines" in raw) {
		// SAFETY: validated as a plain object just above.
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
				throw configProblem(path, `\`machines.${name}.agent_user\` must be a string.`);
			}
			if ("home" in machine && typeof machine.home !== "string") {
				throw configProblem(path, `\`machines.${name}.home\` must be a string.`);
			}
		}
	}
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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

	// Fill per-machine defaults (deepMerge can't, since `machines` starts empty)
	for (const [name, machine] of Object.entries(merged.machines)) {
		merged.machines[name] = {
			...DEFAULT_MACHINE,
			...machine,
			home: machine.home ? expandHome(machine.home) : DEFAULT_MACHINE.home,
		};
	}

	// Home expansion / fallback
	merged.self.home = merged.self.home ? expandHome(merged.self.home) : homedir();

	validate(path, merged);

	return merged;
}
