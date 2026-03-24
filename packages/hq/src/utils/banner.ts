import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { keyValue, panel, styledText } from "@hypercli/ui";
import { CONFIG_PATH } from "../config/index.js";
import type { HqConfig } from "../config/schema.js";
import { listProjects } from "../services/projects.js";

function shorten(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function extractBridgeUrl(logFile: string): string | null {
	try {
		const content = readFileSync(logFile, "utf-8");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: need to strip ANSI escape codes from tmux log
		const matches = content.match(/https:\/\/claude\.ai\/code\?bridge=[^\s\x1b]*/g);
		if (matches && matches.length > 0) return matches[matches.length - 1]!;
	} catch {}
	return null;
}

export function renderBanner(opts: {
	config: HqConfig;
	sessionName: string;
	logFile: string;
}): string {
	const { config, sessionName, logFile } = opts;

	let projectCount: number;
	try {
		projectCount = listProjects(config).length;
	} catch {
		projectCount = 0;
	}

	const telegramStatus = config.telegram.hq_bot_token ? "enabled (channel plugin)" : "disabled";
	const bridgeUrl = extractBridgeUrl(logFile);
	const connectValue = bridgeUrl ?? `claude.ai/code → ${sessionName}`;

	const info = keyValue([
		{ key: "Config", value: shorten(CONFIG_PATH) },
		{ key: "Projects", value: `${shorten(config.projects_root)} (${projectCount} found)` },
		{ key: "Telegram", value: telegramStatus },
		{ key: "", value: "" },
		{ key: "Session", value: sessionName },
		{ key: "Connect", value: connectValue },
	]);

	const commands = keyValue(
		[
			{ key: "hyper hq web", value: "Open HQ in claude.ai/code" },
			{ key: "hyper hq list", value: "List projects" },
			{ key: "hyper hq launch <project>", value: "Launch project session" },
			{ key: "hyper hq status", value: "Show running sessions" },
			{ key: "hyper hq attach", value: "Attach to HQ terminal" },
			{ key: "hyper hq config", value: "Show configuration" },
			{ key: "hyper hq stop-all", value: "Stop everything" },
		],
		{ separator: "  ", keyStyle: { dim: true } },
	);

	const content = `${info}\n\n${styledText("Commands", { bold: true })}\n${commands}`;

	return `\n${panel(content, { title: "Hyper HQ — Claude Code Command Center", padding: 1 })}\n`;
}
