import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { DEFAULT_CONFIG, type DriveConfig } from "./schema.js";

/**
 * The one user config file lives at ~/.config/hyper/drive.toml (C-14).
 * HYPER_DRIVE_CONFIG overrides the path (used by tests and tooling).
 */
const CONFIG_PATH = resolve(homedir(), ".config/hyper/drive.toml");

export function configPath(): string {
	return process.env.HYPER_DRIVE_CONFIG ?? CONFIG_PATH;
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

export function loadConfig(): DriveConfig {
	let fileConfig: Record<string, unknown> = {};

	const path = configPath();
	if (existsSync(path)) {
		const raw = readFileSync(path, "utf-8");
		fileConfig = parseTOML(raw) as Record<string, unknown>;
	}

	return deepMerge(
		DEFAULT_CONFIG as unknown as Record<string, unknown>,
		fileConfig,
	) as unknown as DriveConfig;
}
