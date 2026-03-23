import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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

function pad(label: string, value: string, width: number): string {
	const content = `	${label}${value}`;
	return `║${content.padEnd(width)}║`;
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

	const telegramStatus = config.telegram.hq_bot_token ? "enabled" : "disabled";
	const bridgeUrl = extractBridgeUrl(logFile);
	const connectValue = bridgeUrl ?? `claude.ai/code → ${sessionName}`;

	// Build content rows to determine width
	const rows: Array<[string, string] | null> = [
		["Config:		", shorten(CONFIG_PATH)],
		["Projects:	", `${shorten(config.projects_root)} (${projectCount} found)`],
		["Telegram:	", telegramStatus],
		null,
		["Session:	 ", sessionName],
		["Connect:	 ", connectValue],
		null,
		["Commands:", ""],
		["	hyper hq list", "					List projects"],
		["	hyper hq spawn <name>", "	Start project session"],
		["	hyper hq status", "				Show running sessions"],
		["	hyper hq attach", "				Attach to HQ terminal"],
		["	hyper hq config", "				Show configuration"],
		["	hyper hq stop-all", "			Stop everything"],
	];

	const title = "	Hyper HQ — Claude Code Command Center";

	// Calculate width: widest content + 2 for padding
	let maxContent = title.length;
	for (const row of rows) {
		if (row) {
			const len = `	${row[0]}${row[1]}`.length;
			if (len > maxContent) maxContent = len;
		}
	}

	const w = maxContent + 2; // inner width with padding
	const bar = "═".repeat(w);
	const empty = `║${" ".repeat(w)}║`;

	const lines: string[] = ["", `╔${bar}╗`, `║${title.padEnd(w)}║`, `╠${bar}╣`, empty];

	for (const row of rows) {
		if (row === null) {
			lines.push(empty);
		} else {
			lines.push(pad(row[0], row[1], w));
		}
	}

	lines.push(empty, `╚${bar}╝`, "");

	return lines.join("\n");
}
