import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	claudeHome,
	encodeProjectDir,
	lastAssistantText,
	latestTranscript,
	listTranscripts,
	liveSession,
	ownerPath,
	projectDir,
	readOwner,
	stopSession,
	transcriptLineCount,
	writeOwner,
} from "#services/sessions";
import {
	deadPid,
	FIXTURE_CWD,
	removeClaudeHome,
	startSleeper,
	withClaudeHome,
	writeSessionFile,
} from "#tests/tmp-claude-home";

const CWD = FIXTURE_CWD;
const __dirname = dirname(fileURLToPath(import.meta.url));
let home = "";

beforeEach(() => {
	home = withClaudeHome();
});

afterEach(() => {
	removeClaudeHome(home);
});

describe("claudeHome", () => {
	it("honours CLAUDE_CONFIG_DIR", () => {
		expect(claudeHome()).toBe(home);
	});

	it("falls back to ~/.claude", () => {
		delete process.env.CLAUDE_CONFIG_DIR;
		expect(claudeHome()).toBe(join(homedir(), ".claude"));
	});
});

describe("encodeProjectDir", () => {
	it("replaces every non-alphanumeric character with a dash", () => {
		// CLAUDE-INTERNAL (verified 2.1.288): the path is realpath'd first.
		expect(encodeProjectDir(CWD)).toBe("-Users-svallory-work-hyper-hyper");
	});

	it("collapses dots, underscores, spaces and non-ASCII alike", () => {
		// Each case was produced by running `claude -p` in a directory of that
		// name and reading the folder it created under ~/.claude/projects.
		expect(encodeProjectDir("/private/tmp/x/plain")).toBe("-private-tmp-x-plain");
		expect(encodeProjectDir("/private/tmp/x/dot.name")).toBe("-private-tmp-x-dot-name");
		expect(encodeProjectDir("/private/tmp/x/under_score")).toBe("-private-tmp-x-under-score");
		expect(encodeProjectDir("/private/tmp/x/with space")).toBe("-private-tmp-x-with-space");
		expect(encodeProjectDir("/private/tmp/x/ünïcodé")).toBe("-private-tmp-x--n-cod-");
		expect(encodeProjectDir("/private/tmp/x/dash-and.ü_ x")).toBe("-private-tmp-x-dash-and----x");
	});

	it("resolves symlinks the way Claude Code does", () => {
		const dir = join(tmpdir(), `drive-enc-${process.pid}`);
		expect(encodeProjectDir(dir)).toBe(encodeProjectDir(dir));
	});
});

describe("projectDir", () => {
	it("points inside the configured home", () => {
		expect(projectDir(CWD)).toBe(join(home, "projects", "-Users-svallory-work-hyper-hyper"));
	});
});

describe("listTranscripts", () => {
	it("returns the *.jsonl files newest first", () => {
		const transcripts = listTranscripts(CWD);
		expect(transcripts.map((t) => t.id)).toEqual([
			"bbbb2222-3333-4444-5555-666666666666",
			"aaaa1111-2222-3333-4444-555555555555",
		]);
		expect(transcripts[0]?.mtime.getTime()).toBeGreaterThan(transcripts[1]?.mtime.getTime() ?? 0);
	});

	it("returns nothing for an unknown cwd", () => {
		expect(listTranscripts("/private/tmp/drive-does-not-exist")).toEqual([]);
		expect(latestTranscript("/private/tmp/drive-does-not-exist")).toBeNull();
	});

	it("latestTranscript picks the newest one", () => {
		expect(latestTranscript(CWD)?.id).toBe("bbbb2222-3333-4444-5555-666666666666");
	});
});

describe("liveSession", () => {
	it("ignores a sessions file whose pid is dead", () => {
		const pid = deadPid();
		writeSessionFile(home, { pid, cwd: CWD, sessionId: "stale", startedAt: 1791000000000 });
		expect(liveSession(CWD)).toBeNull();
	});

	it("finds a live process started in the cwd", () => {
		const sleeper = startSleeper();
		try {
			writeSessionFile(home, {
				pid: sleeper.pid,
				sessionId: "99999999-8888-7777-6666-555555555555",
				cwd: CWD,
				startedAt: 1791000000000,
				version: "2.1.288",
				entrypoint: "cli",
				kind: "interactive",
			});
			expect(liveSession(CWD)).toEqual({
				pid: sleeper.pid,
				sessionId: "99999999-8888-7777-6666-555555555555",
				startedAt: 1791000000000,
				cwd: CWD,
			});
		} finally {
			sleeper.kill();
		}
	});

	it("ignores a live process started in another cwd", () => {
		const sleeper = startSleeper();
		try {
			writeSessionFile(home, {
				pid: sleeper.pid,
				cwd: "/Users/svallory/work/mx",
				startedAt: 1791000000000,
			});
			expect(liveSession(CWD)).toBeNull();
		} finally {
			sleeper.kill();
		}
	});

	it("ignores the <pid>.<hash>.key files that share the directory", () => {
		const sleeper = startSleeper();
		try {
			writeSessionFile(home, { pid: sleeper.pid, cwd: "/somewhere/else" });
			writeFileSync(join(home, "sessions", `${sleeper.pid}.deadbeef.key`), "x");
			expect(liveSession(CWD)).toBeNull();
		} finally {
			sleeper.kill();
		}
	});

	it("returns null when the sessions directory does not exist", () => {
		rmSync(join(home, "sessions"), { recursive: true, force: true });
		expect(liveSession(CWD)).toBeNull();
	});
});

describe("stopSession", () => {
	it("refuses a pid that belongs to another cwd", async () => {
		const sleeper = startSleeper();
		try {
			writeSessionFile(home, { pid: sleeper.pid, cwd: "/Users/svallory/work/mx" });
			expect(await stopSession(sleeper.pid, { cwd: CWD })).toBeNull();
			expect(isAlive(sleeper.pid)).toBe(true);
		} finally {
			sleeper.kill();
		}
	});

	it("terminates a process owned by the cwd", async () => {
		const sleeper = startSleeper();
		writeSessionFile(home, { pid: sleeper.pid, cwd: CWD });
		expect(await stopSession(sleeper.pid, { cwd: CWD, graceMs: 5_000 })).toBe("terminated");
		expect(isAlive(sleeper.pid)).toBe(false);
	});

	it("reports a pid that is already gone", async () => {
		const pid = deadPid();
		writeSessionFile(home, { pid, cwd: CWD });
		expect(await stopSession(pid, { cwd: CWD })).toBe("gone");
	});

	it("refuses a pid with no sessions file at all", async () => {
		expect(await stopSession(deadPid(), { cwd: CWD })).toBeNull();
	});

	it("SIGKILLs a process that ignores SIGTERM", async () => {
		// `/bin/sh` on this machine dies on SIGTERM even with `trap ''`, so the
		// stubborn process is perl, which really does ignore it.
		const child = spawn("/usr/bin/perl", ["-e", '$SIG{TERM} = "IGNORE"; sleep 30'], {
			stdio: "ignore",
		});
		const pid = child.pid;
		if (typeof pid !== "number") throw new Error("could not spawn a stubborn process");
		try {
			writeSessionFile(home, { pid, cwd: CWD });
			// perl needs a moment to boot and install the handler; signalling it
			// any earlier hits the default disposition and it dies "politely".
			await new Promise((done) => {
				setTimeout(done, 750);
			});
			expect(await stopSession(pid, { cwd: CWD, graceMs: 500 })).toBe("killed");
		} finally {
			child.kill("SIGKILL");
		}
	});
});

describe("ownership markers", () => {
	it("writes the marker next to the transcript and reads it back", () => {
		const marker = writeOwner(CWD, "bbbb2222-3333-4444-5555-666666666666", "netcup");
		expect(marker.owner).toBe("netcup");
		expect(new Date(marker.at).toString()).not.toBe("Invalid Date");
		expect(readOwner(CWD, "bbbb2222-3333-4444-5555-666666666666")).toEqual(marker);
		expect(ownerPath(CWD, "bbbb2222-3333-4444-5555-666666666666")).toBe(
			join(projectDir(CWD), "bbbb2222-3333-4444-5555-666666666666.warp.json"),
		);
	});

	it("leaves no temp file behind", () => {
		writeOwner(CWD, "bbbb2222-3333-4444-5555-666666666666", "netcup");
		const leftovers = readdirSync(projectDir(CWD)).filter((f) => f.includes(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it("is not listed as a transcript", () => {
		writeOwner(CWD, "bbbb2222-3333-4444-5555-666666666666", "netcup");
		expect(listTranscripts(CWD)).toHaveLength(2);
	});

	it("returns null for a missing or malformed marker", () => {
		expect(readOwner(CWD, "no-such-session")).toBeNull();
		writeFileSync(ownerPath(CWD, "broken"), "{not json", "utf-8");
		expect(readOwner(CWD, "broken")).toBeNull();
		writeFileSync(ownerPath(CWD, "half"), '{"owner":"netcup"}', "utf-8");
		expect(readOwner(CWD, "half")).toBeNull();
	});
});

describe("transcript reading", () => {
	it("counts non-empty lines", () => {
		const path = join(projectDir(CWD), "aaaa1111-2222-3333-4444-555555555555.jsonl");
		expect(transcriptLineCount(path)).toBe(8);
	});

	it("returns the last assistant text, joining its text blocks", () => {
		const path = join(projectDir(CWD), "aaaa1111-2222-3333-4444-555555555555.jsonl");
		expect(lastAssistantText(path)).toBe("final answer");
	});

	it("skips lines it cannot use instead of throwing", () => {
		const path = join(tmpdir(), `drive-bad-${process.pid}.jsonl`);
		writeFileSync(path, 'garbage\n{"type":"user"}\n{"type":"assistant"}\n', "utf-8");
		expect(transcriptLineCount(path)).toBe(3);
		expect(lastAssistantText(path)).toBeNull();
	});

	it("returns null/0 for a transcript that is not there", () => {
		expect(lastAssistantText("/private/tmp/drive-no-such.jsonl")).toBeNull();
		expect(transcriptLineCount("/private/tmp/drive-no-such.jsonl")).toBe(0);
	});

	it("reads a real `claude -p` transcript captured by the e2e", () => {
		// CLAUDE-INTERNAL (verified 2.1.288): one `claude -p` run produced 40
		// lines of 8 different types (`attachment`, `atis-latch`, `last-prompt`,
		// `queue-operation`, `user`, `assistant`, `system`, `cost-state`); the
		// fixture keeps one of each, with long lines truncated.
		const path = resolve(__dirname, "fixtures/real-transcript-excerpt.jsonl");
		expect(transcriptLineCount(path)).toBe(8);
		expect(lastAssistantText(path)).toBe("ok");
	});
});

describe("fixtures", () => {
	it("the fake home is a copy, never the real ~/.claude", () => {
		expect(home).not.toBe(join(homedir(), ".claude"));
		expect(existsSync(join(home, "sessions", "999999.json"))).toBe(true);
		expect(readFileSync(join(home, "sessions", "999999.json"), "utf-8")).toContain('"pid": 999999');
		expect(statSync(join(home, "projects")).isDirectory()).toBe(true);
	});

	it("999999 in the fixture is not a live pid", () => {
		expect(isAlive(999999)).toBe(false);
	});
});

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
