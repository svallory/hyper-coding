import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CLAUDE_JSON_PATH = resolve(homedir(), ".claude.json");

interface ClaudeJson {
	projects?: Record<string, { hasTrustDialogAccepted?: boolean; [key: string]: unknown }>;
	[key: string]: unknown;
}

function readClaudeJson(): ClaudeJson {
	if (!existsSync(CLAUDE_JSON_PATH)) return {};
	return JSON.parse(readFileSync(CLAUDE_JSON_PATH, "utf-8"));
}

function writeClaudeJson(data: ClaudeJson): void {
	writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function isWorkspaceTrusted(dir: string): boolean {
	const data = readClaudeJson();
	return data.projects?.[dir]?.hasTrustDialogAccepted === true;
}

export function trustWorkspace(dir: string): void {
	const data = readClaudeJson();
	if (!data.projects) data.projects = {};
	if (!data.projects[dir]) data.projects[dir] = {};
	data.projects[dir].hasTrustDialogAccepted = true;
	writeClaudeJson(data);
}
