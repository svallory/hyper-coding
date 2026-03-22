import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const CLAUDE_PROJECTS_DIR = resolve(homedir(), ".claude/projects");

/**
 * Check if a directory (or any ancestor) is trusted by Claude Code.
 * Workspace trust is stored as project dirs under ~/.claude/projects/
 * with path encoded using dashes (e.g. /Users/foo/work → -Users-foo-work).
 * Subdirectories of trusted workspaces are also trusted.
 */
export function isWorkspaceTrusted(dir: string): boolean {
	let current = dir;
	while (current !== "/") {
		const encoded = current.replace(/\//g, "-");
		if (existsSync(resolve(CLAUDE_PROJECTS_DIR, encoded))) return true;
		current = dirname(current);
	}
	return false;
}

/**
 * Trust a directory for Claude Code by creating its project entry.
 * This is equivalent to running `claude` in the directory and accepting the trust dialog.
 */
export function trustWorkspace(dir: string): void {
	const encoded = dir.replace(/\//g, "-");
	mkdirSync(resolve(CLAUDE_PROJECTS_DIR, encoded), { recursive: true });
}
