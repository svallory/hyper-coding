import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { DEFAULT_CONFIG, type HqConfig } from "./schema.js";

const CONFIG_PATH = resolve(homedir(), ".config/hyper/hq.toml");

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
	return existsSync(CONFIG_PATH);
}

export function loadConfig(): HqConfig {
	let fileConfig: Record<string, unknown> = {};

	if (existsSync(CONFIG_PATH)) {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		fileConfig = parseTOML(raw) as Record<string, unknown>;
	}

	const merged = deepMerge(
		DEFAULT_CONFIG as unknown as Record<string, unknown>,
		fileConfig,
	) as unknown as HqConfig;

	// Env var overrides
	if (process.env.HYPER_HQ_PROJECTS_ROOT) {
		merged.projects_root = process.env.HYPER_HQ_PROJECTS_ROOT;
	}
	if (process.env.HYPER_HQ_BOT_TOKEN) {
		merged.telegram = merged.telegram ?? ({} as HqConfig["telegram"]);
		merged.telegram.hq_bot_token = process.env.HYPER_HQ_BOT_TOKEN;
	}

	// Expand paths
	merged.projects_root = expandHome(merged.projects_root);

	// Resolve hq.dir relative to projects_root if not absolute
	if (merged.hq.dir.startsWith("./") || !merged.hq.dir.startsWith("/")) {
		merged.hq.dir = resolve(merged.projects_root, merged.hq.dir);
	} else {
		merged.hq.dir = expandHome(merged.hq.dir);
	}

	return merged;
}

export { CONFIG_PATH };
