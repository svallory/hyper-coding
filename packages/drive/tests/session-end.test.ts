import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderGitignore } from "#services/allowlist";
import {
	lastSessionSummary,
	readSessionEndInput,
	SESSION_SUMMARY_LIMIT,
	sessionEndMessage,
} from "#services/session-end";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { commitSpace, pushSpace } from "#services/space-sync";
import { git } from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

const id = "ba0efb18-103b-43b5-b5a0-fc3a08a2b00b";
const repository = join(import.meta.dirname, "../../..");
const cli = join(repository, "packages/cli/bin/run.js");
const hook = join(repository, "agent-plugin/scripts/hyper-drive-session-end.sh");
let directory: string;
let transcript: string;
beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "hyper-session-end-")));
	for (const [key, value] of Object.entries({
		HOME: join(directory, "home"),
		HYPER_HOME: join(directory, "hyper"),
		HYPER_DRIVE_CONFIG: join(directory, "drive.toml"),
		XDG_CONFIG_HOME: join(directory, "config"),
		CLAUDE_CONFIG_DIR: join(directory, "claude"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "hook test",
		GIT_COMMITTER_NAME: "hook test",
		GIT_AUTHOR_EMAIL: "hook@example.invalid",
		GIT_COMMITTER_EMAIL: "hook@example.invalid",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		// Without this, the CLI's update-check hook spawns a detached, unref'd
		// get-version process that writes its cache into HOME after the CLI has
		// exited, racing the teardown below (ENOTEMPTY on fd1834ae's CI run).
		HYPER_SKIP_NEW_VERSION_CHECK: "1",
	}))
		vi.stubEnv(key, value);
	mkdirSync(process.env.HOME!, { recursive: true });
	mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
	transcript = join(directory, "transcript.jsonl");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});
function payload(extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		session_id: id,
		transcript_path: transcript,
		cwd: directory,
		hook_event_name: "SessionEnd",
		reason: "prompt_input_exit",
		...extra,
	});
}
function summary(...values: string[]): void {
	writeFileSync(
		transcript,
		values.map((value) => JSON.stringify({ type: "summary", summary: value })).join("\n"),
	);
}
async function message(): Promise<string> {
	return sessionEndMessage(await readSessionEndInput(Readable.from([payload()])));
}
function run(root: string, input = payload(), ...args: string[]) {
	return spawnSync(process.execPath, [cli, "space", "commit", "--session-end", ...args], {
		cwd: root,
		env: process.env,
		input,
		encoding: "utf8",
		timeout: 30_000,
	});
}
async function makeSpace() {
	const root = join(directory, "space");
	const remote = join(directory, "remote.git");
	git(["init", "--bare", remote], directory);
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes/a.md"), "initial\n");
	writeFileSync(join(root, ".gitignore"), renderGitignore());
	initSpaceGitDir(root, { branch: "space/hook", remote });
	spaceGit(root, ["config", "gc.auto", "0"]);
	await commitSpace(root, "space/hook", "initial");
	pushSpace(root, remote, "space/hook");
	return { root, remote };
}
function count(root: string) {
	return Number(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout);
}

describe("SessionEnd input and streamed transcript", () => {
	it("reads a summary and exact session trailer", async () => {
		summary("Finished the hook");
		expect(await message()).toBe(`session: Finished the hook\n\nClaude-Session: ${id}`);
	});
	it("falls back without summary entries", async () => {
		writeFileSync(transcript, '{"type":"user","message":"hello"}\n');
		expect(await message()).toBe(`session ${id} ended\n\nClaude-Session: ${id}`);
	});
	it("last summary wins, ignoring malformed and non-summary records", async () => {
		summary("old", "latest");
		appendFileSync(transcript, '\nnot-json\n{"type":"assistant","summary":"wrong"}\n{"partial":');
		expect(await lastSessionSummary(transcript)).toBe("latest");
	});
	it.each([
		["-n --amend", "-n --amend"],
		["hello\n\rworld\t!", "hello world !"],
		["$(touch /not-a-command)", "$(touch /not-a-command)"],
		["a\u0000\u001bb\u007f\u0085\u202ec", "abc"],
		["x".repeat(10000), "x".repeat(SESSION_SUMMARY_LIMIT)],
	])("sanitizes hostile summary case %#", async (value, expected) => {
		summary(value);
		expect(await lastSessionSummary(transcript)).toBe(expected);
	});
	it("counts Unicode code points rather than splitting surrogate pairs", async () => {
		summary("😀".repeat(201));
		expect(await lastSessionSummary(transcript)).toBe("😀".repeat(200));
	});
	it.each([
		"{bad",
		"[]",
		"null",
		payload({ session_id: "--amend" }),
		payload({ transcript_path: 42 }),
	])("refuses malformed input %j", async (value) => {
		await expect(readSessionEndInput(Readable.from([value]))).rejects.toThrow(/SessionEnd/);
	});
	it("accepts unknown fields", async () => {
		expect(
			await readSessionEndInput(Readable.from([payload({ future: { enabled: true } })])),
		).toEqual({ session_id: id, transcript_path: transcript, reason: "prompt_input_exit" });
	});
	it("rejects oversized stdin", async () => {
		await expect(readSessionEndInput(Readable.from([" ".repeat(65537)]))).rejects.toThrow("64 KiB");
	});
	it("falls back for missing transcripts and directories", async () => {
		expect(await message()).toContain(`session ${id} ended`);
		expect(await lastSessionSummary(directory)).toBeUndefined();
	});
	it("falls back for an unreadable transcript", async () => {
		summary("not readable");
		chmodSync(transcript, 0);
		try {
			expect(await lastSessionSummary(transcript)).toBeUndefined();
		} finally {
			chmodSync(transcript, 0o600);
		}
	});
	it("preserves UTF-8 split across hook input chunks", async () => {
		const bytes = Buffer.from(payload({ transcript_path: "é.jsonl" }));
		const split = bytes.indexOf(Buffer.from("é")) + 1;
		expect(
			(await readSessionEndInput(Readable.from([bytes.subarray(0, split), bytes.subarray(split)])))
				.transcript_path,
		).toBe("é.jsonl");
	});
	it("skips a single 20 MiB summary line, resumes after it, and stays bounded", async () => {
		summary("before oversized");
		appendFileSync(transcript, '\n{"type":"summary","summary":"');
		const chunk = "x".repeat(64 * 1024);
		for (let index = 0; index < 320; index++) appendFileSync(transcript, chunk);
		appendFileSync(transcript, '"}\n');
		const started = performance.now();
		const baseline = process.memoryUsage().rss;
		let peak = baseline;
		const sample = setInterval(() => {
			peak = Math.max(peak, process.memoryUsage().rss);
		}, 5);
		try {
			expect(await lastSessionSummary(transcript)).toBe("before oversized");
		} finally {
			clearInterval(sample);
		}
		peak = Math.max(peak, process.memoryUsage().rss);
		expect(peak - baseline).toBeLessThan(64 * 1024 * 1024);
		expect(performance.now() - started).toBeLessThan(15_000);
		appendFileSync(transcript, '{"type":"summary","summary":"after oversized"}');
		expect(await lastSessionSummary(transcript)).toBe("after oversized");
	}, 20_000);
	it("does not retain a 50 MiB transcript: under 128 MiB RSS growth and 15 seconds", async () => {
		const line = `${JSON.stringify({ type: "assistant", message: "x".repeat(8192) })}\n`;
		writeFileSync(transcript, "");
		for (let bytes = 0; bytes < 50 * 1024 * 1024; bytes += Buffer.byteLength(line))
			appendFileSync(transcript, line);
		appendFileSync(transcript, '\n{"type":"summary","summary":"last in large file"}\n');
		const started = performance.now();
		const baseline = process.memoryUsage().rss;
		let peak = baseline;
		const sample = setInterval(() => {
			peak = Math.max(peak, process.memoryUsage().rss);
		}, 5);
		try {
			expect(await lastSessionSummary(transcript)).toBe("last in large file");
		} finally {
			clearInterval(sample);
		}
		peak = Math.max(peak, process.memoryUsage().rss);
		const elapsed = performance.now() - started;
		console.log(
			`50 MiB transcript: ${elapsed.toFixed(0)}ms, RSS growth ${((peak - baseline) / 1024 / 1024).toFixed(1)}MiB`,
		);
		expect(peak - baseline).toBeLessThan(128 * 1024 * 1024);
		expect(elapsed).toBeLessThan(15_000);
	}, 20_000);
});

describe("a harness that sends summary and harness (pi)", () => {
	it("keeps a Claude payload byte-identical to main", async () => {
		summary("Golden Claude line");
		expect(await message()).toBe(`session: Golden Claude line\n\nClaude-Session: ${id}`);
		expect(await readSessionEndInput(Readable.from([payload()]))).toEqual({
			session_id: id,
			transcript_path: transcript,
			reason: "prompt_input_exit",
		});
	});
	it("prefers the payload summary over the transcript and names the pi trailer", async () => {
		summary("transcript summary");
		expect(
			await sessionEndMessage(
				await readSessionEndInput(
					Readable.from([payload({ summary: "  pi  says   hello \n there ", harness: "pi" })]),
				),
			),
		).toBe(`session: pi says hello there\n\nPi-Session: ${id}`);
	});
	it("falls back to the transcript when pi sends no summary", async () => {
		summary("transcript summary");
		expect(
			await sessionEndMessage(
				await readSessionEndInput(Readable.from([payload({ harness: "pi" })])),
			),
		).toBe(`session: transcript summary\n\nPi-Session: ${id}`);
		rmSync(transcript);
		expect(
			await sessionEndMessage(
				await readSessionEndInput(Readable.from([payload({ harness: "pi" })])),
			),
		).toBe(`session ${id} ended\n\nPi-Session: ${id}`);
	});
	it.each([
		["newlines and tabs", "a\n\tb  c", "a b c"],
		["control and bidi characters", "a\u0000\u001b\u0085\u202eb", "ab"],
		["a long value", "x".repeat(10_000), "x".repeat(SESSION_SUMMARY_LIMIT)],
		["surrogate pairs", "\u{1F600}".repeat(201), "\u{1F600}".repeat(200)],
	])("cleans and caps the payload summary: %s", async (_label, value, expected) => {
		const input = await readSessionEndInput(Readable.from([payload({ summary: value })]));
		expect(input.summary).toBe(expected);
		expect(await sessionEndMessage(input)).toBe(`session: ${expected}\n\nClaude-Session: ${id}`);
	});
	it.each([42, null, {}, [], "", "   \n\t "])("treats %j as no summary at all", async (value) => {
		const input = await readSessionEndInput(Readable.from([payload({ summary: value })]));
		expect(input.summary).toBeUndefined();
		expect(await sessionEndMessage(input)).toBe(`session ${id} ended\n\nClaude-Session: ${id}`);
	});
	it.each([
		["Pi", "claude"],
		["claude", "claude"],
		["PI", "claude"],
		["", "claude"],
		[42, "claude"],
		[null, "claude"],
		[{}, "claude"],
		["pi", "pi"],
	])("reads harness %j as %s", async (harness, expected) => {
		const input = await readSessionEndInput(Readable.from([payload({ harness })]));
		expect(input.harness ?? "claude").toBe(expected);
		const trailer = expected === "pi" ? "Pi-Session" : "Claude-Session";
		expect(await sessionEndMessage(input)).toBe(`session ${id} ended\n\n${trailer}: ${id}`);
	});
	it("commits a pi payload with its summary and trailer", async () => {
		const { root } = await makeSpace();
		const file = join(root, ".hyper/space.git/session-end-payload.test-pi");
		writeFileSync(
			file,
			JSON.stringify({
				session_id: id,
				cwd: root,
				harness: "pi",
				summary: "Fix the pi session-end hook",
			}),
		);
		writeFileSync(join(root, "notes/a.md"), "changed by pi");
		const result = run(root, "", "--payload-file", file);
		expect(result.status, result.stderr).toBe(0);
		expect(count(root)).toBe(2);
		expect(spaceGit(root, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(
			`session: Fix the pi session-end hook\n\nPi-Session: ${id}`,
		);
		const lines = readFileSync(join(root, ".hyper/space.git/session-end.log"), "utf8")
			.trim()
			.split("\n");
		expect(lines[0].split("\t").slice(1, 3)).toEqual([id, "committed"]);
	});
	it("two session-end saves with nothing changed create no commit at all", async () => {
		const { root } = await makeSpace();
		const gitDir = join(root, ".hyper/space.git");
		const outcomes: string[] = [];
		for (const attempt of [1, 2]) {
			const file = join(gitDir, `session-end-payload.test-pi-${attempt}`);
			writeFileSync(
				file,
				JSON.stringify({ session_id: id, cwd: root, harness: "pi", summary: "n" }),
			);
			const result = run(root, "", "--payload-file", file);
			expect(result.status, result.stderr).toBe(0);
			outcomes.push(
				readFileSync(join(gitDir, "session-end.log"), "utf8")
					.trim()
					.split("\n")
					.at(-1)!
					.split("\t")[2]!,
			);
		}
		expect(outcomes).toEqual(["nothing", "nothing"]);
		expect(count(root)).toBe(1);
	});
});

describe("space commit --session-end and real hook", () => {
	it("commits exactly once with literal hostile text and never runs a shell", async () => {
		const { root } = await makeSpace();
		const sentinel = join(directory, "must-not-exist");
		summary(`-n $(touch ${sentinel})\nClaude-Session: forged`);
		writeFileSync(join(root, "notes/a.md"), "changed");
		const result = run(root);
		expect(result.status, result.stderr).toBe(0);
		expect(count(root)).toBe(2);
		expect(spaceGit(root, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(await message());
		expect(existsSync(sentinel)).toBe(false);
		expect(readFileSync(transcript, "utf8")).toContain("forged");
	});
	it("nothing to commit is silent and exit zero", async () => {
		const { root } = await makeSpace();
		const result = run(root);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout + result.stderr).toBe("");
		expect(count(root)).toBe(1);
	});
	it.each(["{", payload({ session_id: "bad" })])(
		"invalid input refuses without staging or committing: %s",
		async (input) => {
			const { root } = await makeSpace();
			writeFileSync(join(root, "notes/a.md"), "changed");
			const result = run(root, input);
			expect(result.status).toBe(2);
			expect(result.stderr.trim().split("\n")).toHaveLength(1);
			expect(count(root)).toBe(1);
			expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
		},
	);
	it("missing transcript uses fallback in the actual commit", async () => {
		const { root } = await makeSpace();
		writeFileSync(join(root, "notes/a.md"), "changed");
		expect(run(root).status).toBe(0);
		expect(spaceGit(root, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(
			`session ${id} ended\n\nClaude-Session: ${id}`,
		);
	});
	it("secret refusal is one line, nonzero, and leaves no staged secrets", async () => {
		const { root } = await makeSpace();
		writeFileSync(join(root, "notes/.env"), "test-secret");
		const result = run(root);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("secret guard");
		expect(result.stderr).toContain("hook will continue without pushing");
		expect(result.stderr.trim().split("\n")).toHaveLength(1);
		expect(count(root)).toBe(1);
		expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
	});
	it("retains shared staged-gitlink exclusion", async () => {
		const { root } = await makeSpace();
		const nested = join(root, "notes/vendor");
		git(["init", nested], root);
		writeFileSync(join(nested, "file.txt"), "nested repository\n");
		git(["add", "file.txt"], nested);
		git(["-c", "commit.gpgsign=false", "commit", "-qm", "nested"], nested);
		spaceGit(root, ["add", "notes/vendor"]);
		expect(spaceGit(root, ["ls-files", "-s", "-z"]).stdout).toContain("160000");
		const result = run(root);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toContain("its own git repository");
		expect(spaceGit(root, ["ls-files", "-s", "-z"]).stdout).not.toContain("160000");
		expect(readFileSync(join(nested, "file.txt"), "utf8")).toBe("nested repository\n");
		expect(count(root)).toBe(1);
	});
	it("ignores clear and resume on stdin too", async () => {
		const { root } = await makeSpace();
		writeFileSync(join(root, "notes/a.md"), "changed");
		for (const reason of ["clear", "resume"]) {
			const result = run(root, payload({ reason }));
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout + result.stderr).toBe("");
		}
		expect(count(root)).toBe(1);
	});
	it("--payload-file only accepts a session-end payload inside a space git dir, and never deletes others", async () => {
		const { root } = await makeSpace();
		const elsewhere = join(directory, "session-end-payload.x");
		writeFileSync(elsewhere, payload());
		const result = run(root, "", "--payload-file", elsewhere);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("--payload-file must be a session-end-payload.*");
		expect(existsSync(elsewhere)).toBe(true);
		const misnamed = join(root, ".hyper/space.git/config");
		expect(run(root, "", "--payload-file", misnamed).status).toBe(2);
		expect(existsSync(misnamed)).toBe(true);
		expect(count(root)).toBe(1);
	});
	it("the worker removes its payload, commits, logs one line, and ignores clear", async () => {
		const { root } = await makeSpace();
		const gitDir = join(root, ".hyper/space.git");
		const file = join(gitDir, "session-end-payload.test1");
		writeFileSync(file, payload({ reason: "clear" }));
		writeFileSync(join(root, "notes/a.md"), "worker change");
		let result = run(root, "", "--payload-file", file);
		expect(result.status, result.stderr).toBe(0);
		expect(existsSync(file)).toBe(false);
		expect(count(root)).toBe(1);
		writeFileSync(file, payload({ reason: "logout" }));
		result = run(root, "", "--payload-file", file);
		expect(result.status, result.stderr).toBe(0);
		expect(existsSync(file)).toBe(false);
		expect(count(root)).toBe(2);
		const lines = readFileSync(join(gitDir, "session-end.log"), "utf8").trim().split("\n");
		expect(lines.map((line) => line.split("\t").slice(1, 3))).toEqual([
			[id, "ignored"],
			[id, "committed"],
		]);
		expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT[^\t]+Z\t/);
	});
	it("rotates the session-end log at 64 KiB, keeping one previous generation", async () => {
		const { root } = await makeSpace();
		const gitDir = join(root, ".hyper/space.git");
		const { appendSessionEndLog, SESSION_END_LOG_LIMIT, lastSessionEndEntry } = await import(
			"#services/session-end-log"
		);
		writeFileSync(join(gitDir, "session-end.log"), "x".repeat(SESSION_END_LOG_LIMIT));
		appendSessionEndLog(gitDir, { session: id, outcome: "failed", detail: "a\tb\nc\u001b[31m" });
		expect(readFileSync(join(gitDir, "session-end.log.1"), "utf8")).toHaveLength(
			SESSION_END_LOG_LIMIT,
		);
		expect(lastSessionEndEntry(gitDir)).toMatchObject({
			session: id,
			outcome: "failed",
			detail: "a b c[31m",
		});
	});
	it("simulates the real hook: manual, commit, +push, refusals, no-op push, clear", async () => {
		const root = join(directory, "real-space");
		const remote = join(directory, "real-remote.git");
		git(["init", "--bare", remote], directory);
		writeFileSync(process.env.HYPER_DRIVE_CONFIG!, `remote = ${JSON.stringify(remote)}\n`);
		makeBareSpace(root);
		mkdirSync(join(root, "notes"));
		writeFileSync(join(root, "notes/a.md"), "initial");
		const init = spawnSync(process.execPath, [cli, "space", "init", root, "--cadence", "manual"], {
			cwd: directory,
			env: process.env,
			encoding: "utf8",
			timeout: 30_000,
		});
		expect(init.status, init.stderr).toBe(0);
		spaceGit(root, ["config", "gc.auto", "0"]);
		const bin = join(directory, "bin");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "hyper"),
			`#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${cli.replaceAll("'", "'\\''")}' "$@"\n`,
			{ mode: 0o755 },
		);
		const log = join(root, ".hyper/space.git/session-end.log");
		const logged = () =>
			existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
		const timings: number[] = [];
		const runHook = async (input = payload()) => {
			const before = logged().length;
			const started = performance.now();
			const result = spawnSync("bash", [hook], {
				cwd: join(root, "notes"),
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
				input,
				encoding: "utf8",
				timeout: 30_000,
			});
			timings.push(performance.now() - started);
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe("");
			const deadline = Date.now() + 60_000;
			while (logged().length === before && Date.now() < deadline)
				await new Promise((resolve) => setTimeout(resolve, 50));
			return (logged()[before] ?? "").split("\t");
		};
		const remoteCount = () =>
			Number(git(["--git-dir", remote, "rev-list", "--count", "space/real-space"], directory));
		summary("Hook simulation complete");
		writeFileSync(join(root, "notes/a.md"), "manual change");
		const manual = spawnSync("bash", [hook], {
			cwd: join(root, "notes"),
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			input: payload(),
			encoding: "utf8",
		});
		expect(manual.status).toBe(0);
		expect(manual.stdout + manual.stderr).toBe("");
		expect(count(root)).toBe(1);
		spaceGit(root, ["config", "hyper.cadence", "session-end"]);
		expect((await runHook())[2]).toBe("committed");
		expect(count(root)).toBe(2);
		expect(remoteCount()).toBe(1);
		expect(spaceGit(root, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(await message());
		spaceGit(root, ["config", "hyper.cadence", "session-end+push"]);
		writeFileSync(join(root, "notes/a.md"), "push change");
		expect((await runHook()).slice(2)).toEqual(["committed", "committed 1 file, pushed"]);
		expect(count(root)).toBe(3);
		expect(remoteCount()).toBe(3);
		writeFileSync(join(root, "notes/a.md"), "earlier unpushed change");
		expect(run(root).status).toBe(0);
		expect(remoteCount()).toBe(3);
		writeFileSync(join(root, "notes/.env"), "guard fixture");
		const refused = await runHook();
		expect(refused[2]).toBe("refused");
		expect(refused[3]).toContain("secret guard");
		expect(remoteCount()).toBe(3);
		expect(count(root)).toBe(4);
		const status = spawnSync(process.execPath, [cli, "space", "status", "--json"], {
			cwd: root,
			env: process.env,
			encoding: "utf8",
		});
		expect(JSON.parse(status.stdout).sessionEndFailure).toMatchObject({
			session: id,
			outcome: "refused",
		});
		rmSync(join(root, "notes/.env"));
		expect((await runHook("{bad"))[2]).toBe("refused");
		expect(remoteCount()).toBe(3);
		expect((await runHook()).slice(2)).toEqual(["nothing", "nothing to commit, pushed"]);
		expect(count(root)).toBe(4);
		expect(remoteCount()).toBe(4);
		writeFileSync(join(root, "notes/a.md"), "cleared change");
		expect((await runHook(payload({ reason: "clear" })))[2]).toBe("ignored");
		expect(count(root)).toBe(4);
		expect(
			readdirSync(join(root, ".hyper/space.git")).filter((name) => name.includes("payload")),
		).toEqual([]);
		const slowest = Math.max(...timings);
		console.log(
			`Real hook simulation: foreground ${timings.map((ms) => ms.toFixed(0)).join("/")} ms; manual 1/1; session-end 2/1; +push 3/3; refusal 4/3; no-op push 4/4 (local/remote commits)`,
		);
		// The foreground target is well under 300 ms on an idle machine; the
		// bound is generous for a loaded CI runner. It must never approach 1.5 s.
		expect(slowest).toBeLessThan(1_200);
	}, 120_000);
});
