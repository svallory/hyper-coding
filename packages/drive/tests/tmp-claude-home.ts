import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeProjectDir } from "#services/sessions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");

/** A fake Claude home plus the working directory its fixtures describe. */
export interface ClaudeHome {
	/** Temp `~/.claude` (pointed at by `CLAUDE_CONFIG_DIR`). */
	home: string;
	/** A temp working directory inside the temp home, never a real one. */
	cwd: string;
	/** Absolute path of the temp home. */
	scratch: string;
}

/**
 * Build a throwaway `~/.claude` tree in a temp dir and point
 * `CLAUDE_CONFIG_DIR` at it.
 *
 * The working directory is a temp path too: nothing in the fixtures refers to
 * the operator's real directories. Transcripts get deterministic mtimes so
 * newest-first ordering is asserted rather than hoped for. The real `~/.claude`
 * is never read or written.
 */
export function withClaudeHome(): ClaudeHome {
	const scratch = mkdtempSync(join(tmpdir(), "drive-claude-home-"));
	const home = join(scratch, "claude");
	const cwd = join(scratch, "workspace");
	const projects = join(home, "projects", encodeProjectDir(cwd));
	mkdirSync(projects, { recursive: true });
	mkdirSync(join(home, "sessions"), { recursive: true });

	const transcripts = readdirSync(join(FIXTURES, "transcripts")).sort();
	transcripts.forEach((entry, index) => {
		copyFileSync(join(FIXTURES, "transcripts", entry), join(projects, entry));
		// Oldest first by name, so the ordering assertion is about mtime and not
		// about which file the fixture happened to list first.
		const when = new Date(Date.UTC(2026, 0, 1) + index * 3_600_000);
		utimesSync(join(projects, entry), when, when);
	});

	// The fixture's pid is a placeholder; a real, definitely-dead pid is what
	// makes "stale sessions file" a fact rather than an assumption.
	const stale = JSON.parse(
		readFileSync(join(FIXTURES, "sessions", "999999.json"), "utf-8"),
	) as Record<string, unknown>;
	stale.pid = deadPid();
	stale.cwd = cwd;
	writeFileSync(join(home, "sessions", `${stale.pid}.json`), `${JSON.stringify(stale, null, 2)}\n`);

	process.env.CLAUDE_CONFIG_DIR = home;
	return { home, cwd, scratch };
}

/** Remove the temp home and restore whatever `CLAUDE_CONFIG_DIR` was before. */
export function removeClaudeHome(claudeHome: ClaudeHome, previous: string | undefined): void {
	if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = previous;
	rmSync(claudeHome.scratch, { recursive: true, force: true });
}

/** Add a `<pid>.json` sessions file to the fake home. */
export function writeSessionFile(home: string, file: Record<string, unknown>): string {
	const dir = join(home, "sessions");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${file.pid}.json`);
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
	return path;
}

/** Write a sessions file whose JSON is not usable (for the malformed cases). */
export function writeRawSessionFile(home: string, file: string, pid?: number): string {
	const dir = join(home, "sessions");
	mkdirSync(dir, { recursive: true });
	const name = pid === undefined ? `broken-${Date.now()}.json` : `${pid}.json`;
	const path = join(dir, name);
	writeFileSync(path, file, "utf-8");
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

/**
 * `LC_ALL=C TZ=UTC ps -o lstart=` of a live pid.
 *
 * Claude Code stores exactly this string in its sessions files (verified
 * 2.1.288), so a helper that used the ambient locale would agree with a buggy
 * comparison instead of catching it.
 */
export function procStartOf(pid: number): string {
	const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
		encoding: "utf-8",
		env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
	});
	return result.stdout.trim();
}

/** Path for a scratch file that a test writes (inside the temp fixture tree). */
export function scratchPath(claudeHome: ClaudeHome, name: string): string {
	return join(claudeHome.scratch, name);
}
