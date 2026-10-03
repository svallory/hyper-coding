import { spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HOME = resolve(__dirname, "fixtures/claude-home");
const PROJECT_CWD = "/Users/svallory/work/hyper/hyper";

/**
 * Copy the fake `~/.claude` fixture tree to a temp dir, point
 * `CLAUDE_CONFIG_DIR` at it and give the transcripts deterministic mtimes so
 * newest-first ordering is asserted, not hoped for. The real `~/.claude` is
 * never touched.
 */
export function withClaudeHome(): string {
	const home = resolve(
		tmpdir(),
		`drive-claude-home-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	cpSync(FIXTURE_HOME, home, { recursive: true });

	const projects = join(home, "projects");
	for (const [, dir] of listDirs(projects)) {
		const entries = readdirSync(dir).sort();
		entries.forEach((entry, index) => {
			// Oldest first by name, so the ordering assertion is about mtime and
			// not about which file the test happened to create first.
			const when = new Date(Date.UTC(2026, 0, 1) + index * 3_600_000);
			utimesSync(join(dir, entry), when, when);
		});
	}

	process.env.CLAUDE_CONFIG_DIR = home;
	return home;
}

export function removeClaudeHome(home: string): void {
	if (process.env.CLAUDE_CONFIG_DIR === home) delete process.env.CLAUDE_CONFIG_DIR;
	rmSync(home, { recursive: true, force: true });
}

/** The working directory the fixture tree describes. */
export const FIXTURE_CWD = PROJECT_CWD;

/** Add a `<pid>.json` sessions file to the fake home. */
export function writeSessionFile(home: string, file: Record<string, unknown>): string {
	const dir = join(home, "sessions");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${file.pid}.json`);
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
	return path;
}

/** A pid that is guaranteed dead: `true` has exited by the time we return. */
export function deadPid(): number {
	const { pid } = spawnSync("/usr/bin/true");
	if (typeof pid !== "number") throw new Error("could not spawn a process to get a dead pid");
	return pid;
}

/** Start a long-running process, so a test can use a pid that is alive. */
export function startSleeper(seconds = 30): { pid: number; kill: () => void } {
	const child = spawn("/bin/sleep", [String(seconds)], { stdio: "ignore" });
	const pid = child.pid;
	if (typeof pid !== "number") throw new Error("could not spawn a sleeper");
	return { pid, kill: () => child.kill("SIGKILL") };
}

export { readFileSync as readFixtureFile };

function listDirs(root: string): [string, string][] {
	const out: [string, string][] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) out.push([entry.name, join(root, entry.name)]);
	}
	return out;
}
