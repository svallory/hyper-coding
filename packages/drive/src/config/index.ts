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

	if (!ALLOWED_CADENCES.includes(config.defaults.cadence)) {
		throw configProblem(
			path,
			`defaults.cadence must be one of "manual", "session-end", "session-end+push" (or empty) — got ${JSON.stringify(config.defaults.cadence)}.`,
		);
	}

	if (
		!Array.isArray(config.warp.exclude) ||
		config.warp.exclude.some((entry) => typeof entry !== "string")
	) {
		throw configProblem(path, "`warp.exclude` must be a list of strings.");
	}
}

export function loadConfig(): DriveConfig {
	const path = configPath();
	let fileConfig: Record<string, unknown> = {};

	if (existsSync(path)) {
		fileConfig = readAndParse(path);
	}

	// SAFETY: fileConfig is arbitrary parsed TOML; validate() checks the
	// user-facing fields, and the machine loop below fills the rest.
	const merged = deepMerge(
		DEFAULT_CONFIG as unknown as Record<string, unknown>,
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
