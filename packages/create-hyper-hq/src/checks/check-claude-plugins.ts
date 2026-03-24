import { spawnSync } from "node:child_process";

const PLUGIN_REGEX = /^\s+❯\s+(\S+@\S+)/gm;

/**
 * List installed Claude Code plugins by running `claude plugin list`.
 * Returns plugin identifiers like "telegram@claude-plugins-official".
 */
export function listClaudePlugins(): string[] {
	const result = spawnSync("claude", ["plugin", "list"], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 15_000,
	});

	if (result.status !== 0) return [];

	return Array.from(result.stdout.matchAll(PLUGIN_REGEX), (m) => m[1]!);
}

export function isPluginInstalled(pluginId: string): boolean {
	return listClaudePlugins().includes(pluginId);
}

/**
 * Install a Claude Code plugin. Returns true if successful.
 */
export function installPlugin(pluginId: string): boolean {
	const result = spawnSync("claude", ["plugin", "install", pluginId], {
		encoding: "utf-8",
		stdio: "inherit",
		timeout: 60_000,
	});
	return result.status === 0;
}
