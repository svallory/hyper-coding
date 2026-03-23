import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CLAUDE_PROJECTS_DIR = resolve(homedir(), ".claude", "projects");

function encodePath(dir: string): string {
	return dir.replace(/\//g, "-");
}

export function trustWorkspace(dir: string): void {
	mkdirSync(resolve(CLAUDE_PROJECTS_DIR, encodePath(dir)), { recursive: true });
}

export function isWorkspaceTrusted(dir: string): boolean {
	return existsSync(resolve(CLAUDE_PROJECTS_DIR, encodePath(dir)));
}
