import { execFileSync, spawnSync } from "node:child_process";

export interface TmuxSession {
	name: string;
	created: string;
	windows: number;
	attached: boolean;
}

/** Sanitize a string for use as a tmux session name (no dots or colons) */
export function sanitizeSessionName(name: string): string {
	return name.replace(/[.:]/g, "-");
}

function run(args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("tmux", args, { encoding: "utf-8" });
	return {
		ok: result.status === 0,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim(),
	};
}

export function sessionExists(name: string): boolean {
	return run(["has-session", "-t", name]).ok;
}

export function createSession(opts: {
	name: string;
	cwd: string;
	command: string;
	logFile?: string;
}): void {
	// Use remain-on-exit so the pane stays around if the command fails,
	// allowing us to read the exit status and show a useful error.
	const result = run([
		"new-session",
		"-d",
		"-s",
		opts.name,
		"-c",
		opts.cwd,
		"-e",
		"CLINT_SESSION=1",
		opts.command,
	]);
	if (!result.ok) {
		throw new Error(`Failed to create tmux session '${opts.name}': ${result.stderr}`);
	}
	// Keep the pane alive after the command exits so we can detect failures
	run(["set-option", "-t", opts.name, "remain-on-exit", "on"]);

	// Use pipe-pane for logging — this preserves the TTY (unlike shell pipes)
	if (opts.logFile) {
		run(["pipe-pane", "-t", opts.name, "-o", `cat >> '${opts.logFile}'`]);
	}
}

/**
 * Wait and verify a session's command is still running.
 * Polls for up to `timeoutMs`, checking every 500ms.
 * Returns `'running'` if alive, `'dead'` if the pane's command exited.
 */
export function waitAndVerify(name: string, timeoutMs = 5000): "running" | "dead" {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		spawnSync("sleep", ["0.5"]);

		// Check if session still exists at all
		if (!sessionExists(name)) return "dead";

		// Check if the pane process is still running
		const paneResult = run(["list-panes", "-t", name, "-F", "#{pane_dead}"]);
		if (paneResult.ok && paneResult.stdout.trim() === "1") {
			// Pane is dead — command exited. Clean up the session.
			killSession(name);
			return "dead";
		}
	}

	return "running";
}

export function killSession(name: string): boolean {
	return run(["kill-session", "-t", name]).ok;
}

export function listSessions(prefix = "clint"): TmuxSession[] {
	const format =
		"#{session_name}\t#{session_created_string}\t#{session_windows}\t#{?session_attached,1,0}";
	const result = run(["list-sessions", "-F", format]);
	if (!result.ok) return [];

	return result.stdout
		.split("\n")
		.filter((line) => line.startsWith(prefix))
		.map((line) => {
			const [name, created, windows, attached] = line.split("\t");
			return {
				name: name!,
				created: created!,
				windows: Number.parseInt(windows!, 10),
				attached: attached === "1",
			};
		});
}

/** List all HQ-managed tmux sessions (named "Hyper HQ", "hyper-hq", or "hq-*") */
export function listHqSessions(): TmuxSession[] {
	const format =
		"#{session_name}\t#{session_created_string}\t#{session_windows}\t#{?session_attached,1,0}";
	const result = run(["list-sessions", "-F", format]);
	if (!result.ok) return [];

	return result.stdout
		.split("\n")
		.filter((line) => {
			const name = line.split("\t")[0] ?? "";
			return name === "Hyper HQ" || name === "hyper-hq" || name.startsWith("hq-");
		})
		.map((line) => {
			const [name, created, windows, attached] = line.split("\t");
			return {
				name: name!,
				created: created!,
				windows: Number.parseInt(windows!, 10),
				attached: attached === "1",
			};
		});
}

export function disableRemainOnExit(name: string): void {
	run(["set-option", "-t", name, "remain-on-exit", "off"]);
}

export function attachSession(name: string): never {
	execFileSync("tmux", ["attach", "-t", name], { stdio: "inherit" });
	process.exit(0);
}

/** Capture the full scrollback + visible content of a tmux pane */
export function capturePane(name: string): string | null {
	const result = run(["capture-pane", "-t", name, "-p", "-S", "-"]);
	return result.ok ? result.stdout : null;
}

/** Send keystrokes to a tmux pane (simulates typing + Enter) */
export function sendKeys(name: string, text: string): void {
	run(["send-keys", "-t", name, text, "Enter"]);
}
