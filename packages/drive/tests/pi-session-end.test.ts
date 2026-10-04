/**
 * The pi extension's session-end save, driven by a fake pi API: no pi, no
 * space on disk, no CLI. What the CLI is asked, what it may answer, and what
 * ends up in the payload and in the spawn are asserted here; the real worker
 * is covered by tests/session-end.test.ts and, end to end, by the real-CLI
 * test at the bottom of this file.
 */
import {
	type ChildProcess,
	execFileSync,
	type SpawnOptions,
	type spawn,
	spawnSync,
} from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { commitSpace } from "#services/space-sync";
import { makeBareSpace } from "#tests/tmp-space";
import hyperdrive from "../pi/hyperdrive.ts";
import {
	absolutePathEntries,
	childEnv,
	createRealDeps,
	entryText,
	MISSING_CLI_LINE,
	OUTDATED_CLI_LINE,
	type ProbeResult,
	parseSpaceAnswer,
	realDeps,
	resolveHyper,
	type SessionEndDeps,
	type SessionFacts,
	saveSessionEnd,
	sessionSummary,
} from "../pi/session-end.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
const BIN = "/opt/hyper/bin/hyper";

/** Just enough of pi's ExtensionAPI to load the extension and fire its event. */
function fakePi() {
	const handlers = new Map<string, Handler>();
	return {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
			return () => handlers.delete(event);
		},
		fire(event: string, payload: unknown, ctx: unknown) {
			return handlers.get(event)?.(payload, ctx);
		},
		has: (event: string) => handlers.has(event),
	};
}

interface Call {
	bin: string;
	cwd: string;
	timeoutMs: number;
}
interface Spawn {
	payloadPath: string;
	bin: string;
	cwd: string;
}
interface FakeDeps extends SessionEndDeps {
	calls: Call[];
	spawns: Spawn[];
	written: Map<string, string>;
	payloads: string[];
	lines: string[];
	/** What `probe` answers with. Replace to simulate an old or missing CLI. */
	answer: ProbeResult | (() => ProbeResult);
	writeThrows?: boolean;
}

function answerJson(extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		root: "/spaces/outer",
		layout: "bare",
		repos: [],
		slug: null,
		worktreesDir: "/spaces/outer/worktrees/main",
		spaceGitDir: "/spaces/outer/.hyper/space.git",
		cadence: "session-end",
		...extra,
	});
}

function fakeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
	const deps: FakeDeps = {
		calls: [],
		spawns: [],
		written: new Map(),
		payloads: [],
		lines: [],
		answer: { status: 0, stdout: answerJson(), timedOut: false },
		resolveCli: () => BIN,
		probe: async (bin, cwd, timeoutMs) => {
			deps.calls.push({ bin, cwd, timeoutMs });
			return typeof deps.answer === "function" ? deps.answer() : deps.answer;
		},
		writePayload: (dir, contents) => {
			if (deps.writeThrows) throw new Error("EACCES");
			const path = join(dir, `session-end-payload.fake.${deps.payloads.length}`);
			deps.payloads.push(path);
			deps.written.set(path, contents);
			return path;
		},
		spawnWorker: (payloadPath, bin, cwd) => {
			deps.spawns.push({ payloadPath, bin, cwd });
		},
		notify: (line) => {
			deps.lines.push(line);
		},
		...overrides,
	};
	return deps;
}

const id = "ba0efb18-103b-43b5-b5a0-fc3a08a2b00b";
let directory: string;
let spaceNotes: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "hyper-pi-session-end-"));
	spaceNotes = "/spaces/outer/notes";
	// The real-CLI test commits in this process, through the real git, so it
	// must never read the developer's identity, HOME or global git config: on a
	// machine without them the suite would either fail or, worse, commit as
	// whoever happens to be logged in. Same isolation tests/session-end.test.ts
	// uses, and the same one CI has.
	for (const [key, value] of Object.entries({
		HOME: join(directory, "home"),
		HYPER_HOME: join(directory, "hyper"),
		HYPER_DRIVE_CONFIG: join(directory, "drive.toml"),
		XDG_CONFIG_HOME: join(directory, "config"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "pi e2e",
		GIT_AUTHOR_EMAIL: "pi-e2e@example.invalid",
		GIT_COMMITTER_NAME: "pi e2e",
		GIT_COMMITTER_EMAIL: "pi-e2e@example.invalid",
	}))
		vi.stubEnv(key, value);
	mkdirSync(process.env.HOME!, { recursive: true });
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

function userMessage(text: string): unknown {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}

function fakeCtx(facts: {
	sessionId?: string;
	cwd?: string;
	sessionName?: string | undefined;
	entries?: unknown[];
	hasUI?: boolean;
}) {
	const notifications: string[] = [];
	return {
		notifications,
		ctx: {
			cwd: facts.cwd ?? spaceNotes,
			hasUI: facts.hasUI ?? true,
			ui: {
				notify: (message: string) => {
					notifications.push(message);
				},
			},
			sessionManager: {
				getSessionId: () => facts.sessionId ?? id,
				getSessionName: () => facts.sessionName,
				getBranch: () => facts.entries ?? [],
			},
		},
	};
}

const facts = (extra: Partial<SessionFacts> = {}): SessionFacts => ({
	sessionId: id,
	cwd: spaceNotes,
	entries: [userMessage("Ship the pi hook")],
	...extra,
});

describe("the pi extension on session_shutdown", () => {
	it("registers only session_shutdown and never throws into pi", async () => {
		const pi = fakePi();
		hyperdrive(pi as never, fakeDeps());
		expect(pi.has("session_shutdown")).toBe(true);
		expect(pi.has("session_end")).toBe(false);
		const broken = fakeCtx({});
		broken.ctx.sessionManager.getBranch = () => {
			throw new Error("no session");
		};
		await expect(
			pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, broken.ctx),
		).resolves.not.toThrow();
	});

	it("saves only on quit: /new, /resume, /fork and /reload do not end the work", async () => {
		for (const reason of ["new", "resume", "fork", "reload"]) {
			const deps = fakeDeps();
			const pi = fakePi();
			hyperdrive(pi as never, deps);
			const { ctx } = fakeCtx({});
			await pi.fire("session_shutdown", { type: "session_shutdown", reason }, ctx);
			expect(deps.payloads, reason).toEqual([]);
			expect(deps.spawns, reason).toEqual([]);
			// It does not even ask the CLI about a session that is not ending.
			expect(deps.calls, reason).toEqual([]);
			expect(deps.lines, reason).toEqual([]);
		}
		const quit = fakeDeps();
		const pi = fakePi();
		hyperdrive(pi as never, quit);
		const { ctx } = fakeCtx({ entries: [userMessage("Fix the session-end hook")] });
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(quit.payloads).toHaveLength(1);
		expect(JSON.parse(quit.written.get(quit.payloads[0]!)!).session_id).toBe(id);
	});

	it("asks the CLI once, in the session's directory, with a bounded timeout", async () => {
		const deps = fakeDeps();
		await saveSessionEnd(facts(), deps);
		expect(deps.calls).toEqual([{ bin: BIN, cwd: spaceNotes, timeoutMs: 2_000 }]);
	});

	it("writes the payload under the git dir the CLI named and spawns it from the session's cwd", async () => {
		const deps = fakeDeps();
		const payload = await saveSessionEnd(facts(), deps);
		expect(payload).toEqual({
			session_id: id,
			cwd: spaceNotes,
			harness: "pi",
			summary: "Ship the pi hook",
		});
		expect(JSON.parse(deps.written.get(deps.payloads[0]!)!)).toEqual(payload);
		expect(deps.payloads[0]).toMatch(
			/^\/spaces\/outer\/\.hyper\/space\.git\/session-end-payload\./,
		);
		expect(deps.spawns).toEqual([{ payloadPath: deps.payloads[0], bin: BIN, cwd: spaceNotes }]);
		expect(deps.lines).toEqual([]);
	});

	it.each(["session-end", "session-end+push"])("saves on cadence %s", async (cadence) => {
		const deps = fakeDeps({
			answer: { status: 0, stdout: answerJson({ cadence }), timedOut: false },
		});
		expect(await saveSessionEnd(facts(), deps)).toBeDefined();
		expect(deps.spawns).toHaveLength(1);
	});

	it.each([null, "manual", "", "bogus"])(
		"does nothing on cadence %j, silently",
		async (cadence) => {
			const deps = fakeDeps({
				answer: { status: 0, stdout: answerJson({ cadence }), timedOut: false },
			});
			expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
			expect(deps.payloads).toEqual([]);
			expect(deps.spawns).toEqual([]);
			expect(deps.lines).toEqual([]);
		},
	);

	it("does nothing at all when the CLI says this is not a space", async () => {
		const deps = fakeDeps({
			answer: {
				status: 1,
				stdout: JSON.stringify({ root: null, layout: null, spaceGitDir: null, cadence: null }),
				timedOut: false,
			},
		});
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.payloads).toEqual([]);
		expect(deps.lines).toEqual([]);
	});

	it.each([
		["a CLI from before T-18", answerJson({ spaceGitDir: undefined })],
		[
			"a CLI from before T-18 answering with only the fields of main",
			'{"root":"/spaces/outer","layout":"bare","repos":[],"slug":null,"worktreesDir":null}',
		],
	])("prints one outdated line for %s and saves nothing", async (_label, stdout) => {
		const deps = fakeDeps({ answer: { status: 0, stdout, timedOut: false } });
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.lines).toEqual([OUTDATED_CLI_LINE]);
		expect(deps.payloads).toEqual([]);
		expect(deps.spawns).toEqual([]);
	});

	// N1: silence for everything that is not "this CLI is too old".
	it.each([
		["a space whose history was never initialised", answerJson({ spaceGitDir: null })],
		["a CLI that printed no JSON", "Command not found: hyper space"],
		["a CLI that printed nothing", ""],
		["a CLI that failed with no output", ""],
		["a CLI that printed an object without a root", '{"layout":"bare"}'],
		["a CLI that printed a non-object", "42"],
		["a CLI that printed an array", "[]"],
		["a CLI whose answer is garbage after the cap", "x".repeat(70 * 1024)],
	])("stays silent for %s and saves nothing", async (_label, stdout) => {
		const deps = fakeDeps({ answer: { status: 1, stdout, timedOut: false } });
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.lines).toEqual([]);
		expect(deps.payloads).toEqual([]);
		expect(deps.spawns).toEqual([]);
	});

	// N3: the directory the payload goes into has to be the one the root implies.
	it.each([
		[
			"an absolute git dir somewhere else",
			answerJson({ spaceGitDir: "/elsewhere/.hyper/space.git" }),
		],
		["a relative git dir", answerJson({ spaceGitDir: "rel/.hyper/space.git" })],
		["a git dir outside .hyper", answerJson({ spaceGitDir: "/spaces/outer/.git" })],
	])("refuses a lying probe: %s", async (_label, stdout) => {
		const deps = fakeDeps({ answer: { status: 0, stdout, timedOut: false } });
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.payloads).toEqual([]);
		expect(deps.spawns).toEqual([]);
		expect(deps.lines).toEqual([]);
	});

	it("gives up silently when the CLI call runs past its bound", async () => {
		const deps = fakeDeps({ answer: { status: null, stdout: "", timedOut: true } });
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.lines).toEqual([]);
		expect(deps.payloads).toEqual([]);
	});

	it("prints the missing-CLI line only in a space, and does not guess", async () => {
		const inSpace = join(directory, "space", "notes");
		mkdirSync(join(directory, "space", ".hyper", "space.git"), { recursive: true });
		mkdirSync(inSpace, { recursive: true });
		const deps = fakeDeps({ resolveCli: () => undefined });
		expect(await saveSessionEnd(facts({ cwd: inSpace }), deps)).toBeUndefined();
		expect(deps.lines).toEqual([MISSING_CLI_LINE]);
		expect(deps.calls).toEqual([]);
		// Anywhere else a missing CLI is silent, exactly as the Claude hook is.
		const elsewhere = join(directory, "plain");
		mkdirSync(elsewhere, { recursive: true });
		const quiet = fakeDeps({ resolveCli: () => undefined });
		expect(await saveSessionEnd(facts({ cwd: elsewhere }), quiet)).toBeUndefined();
		expect(quiet.lines).toEqual([]);
	});

	it("reports one line when the payload cannot be written, and does not spawn", async () => {
		const deps = fakeDeps({ writeThrows: true });
		expect(await saveSessionEnd(facts(), deps)).toBeUndefined();
		expect(deps.spawns).toEqual([]);
		expect(deps.lines).toHaveLength(1);
		expect(deps.lines[0]).toContain("could not write the session-end payload");
	});

	it("returns in milliseconds", async () => {
		const deps = fakeDeps();
		const pi = fakePi();
		hyperdrive(pi as never, deps);
		const { ctx } = fakeCtx({ entries: [userMessage("pi event path")] });
		const started = performance.now();
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(performance.now() - started).toBeLessThan(200);
		expect(JSON.parse(deps.written.get(deps.payloads[0]!)!).summary).toBe("pi event path");
	});

	it("notifies through pi's UI when there is one and stderr when there is not", async () => {
		const deps = fakeDeps({ writeThrows: true });
		const pi = fakePi();
		hyperdrive(pi as never, deps);
		const withUi = fakeCtx({});
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, withUi.ctx);
		expect(withUi.notifications).toHaveLength(1);
		const withoutUi = fakeCtx({ hasUI: false });
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, withoutUi.ctx);
		expect(withoutUi.notifications).toEqual([]);
		expect(deps.lines).toHaveLength(1);
	});

	it("uses the session name, then the first prompt, then nothing", () => {
		const entries = [userMessage("first prompt"), userMessage("second prompt")];
		expect(sessionSummary({ sessionId: id, cwd: spaceNotes, entries })).toBe("first prompt");
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries, sessionName: "Named run" }),
		).toBe("Named run");
		expect(sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [] })).toBeUndefined();
		expect(
			sessionSummary({
				sessionId: id,
				cwd: spaceNotes,
				entries: [
					{
						type: "message",
						message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
					},
					userMessage("\n   \n\n  real first line\nsecond"),
				],
			}),
		).toBe("real first line");
		expect(
			sessionSummary({
				sessionId: id,
				cwd: spaceNotes,
				entries: [{ type: "compaction", summary: "compacted earlier work" }],
			}),
		).toBeUndefined();
	});

	it("caps and flattens the summary before it reaches the payload", () => {
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [userMessage("x".repeat(9000))] }),
		).toHaveLength(200);
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [userMessage("a\n\n  b\tc")] }),
		).toBe("a");
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [userMessage("  a   b\tc  ")] }),
		).toBe("a b c");
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [], sessionName: "  " }),
		).toBeUndefined();
	});

	it("reads only user text blocks", () => {
		expect(entryText(userMessage("hi"))).toBe("hi");
		expect(entryText({ type: "message", message: { role: "user", content: "plain" } })).toBe(
			"plain",
		);
		expect(entryText({ type: "compaction", summary: "s" })).toBeUndefined();
		expect(entryText(null)).toBeUndefined();
		expect(entryText("string")).toBeUndefined();
	});
});

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(path)) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ${path}`);
}

describe("resolving the hyper CLI", () => {
	it("ignores relative PATH entries, so a space's own bin/ cannot take over", () => {
		const real = mkdtempSync(join(tmpdir(), "hyper-pi-path-"));
		try {
			const good = join(real, "good");
			mkdirSync(good);
			const hyper = join(good, "hyper");
			writeFileSync(hyper, "#!/bin/sh\n");
			chmodSync(hyper, 0o755);
			const relative = join(real, "relative");
			mkdirSync(relative);
			writeFileSync(join(relative, "hyper"), "#!/bin/sh\n");
			chmodSync(join(relative, "hyper"), 0o755);
			// A relative entry ahead of the real one, as in a space with bin/.
			expect(resolveHyper({ PATH: ["./bin", "node_modules/.bin", good].join(delimiter) })).toBe(
				hyper,
			);
			expect(resolveHyper({ PATH: `./bin:${good}` })).toBe(hyper);
			expect(resolveHyper({ PATH: "" })).toBeUndefined();
		} finally {
			rmSync(real, { recursive: true, force: true });
		}
	});
	it("skips a directory, a non-executable file and a missing one", () => {
		const real = mkdtempSync(join(tmpdir(), "hyper-pi-path-"));
		try {
			const asDir = join(real, "as-directory");
			mkdirSync(asDir);
			mkdirSync(join(asDir, "hyper"));
			const notExecutable = join(real, "not-executable");
			mkdirSync(notExecutable);
			writeFileSync(join(notExecutable, "hyper"), "not executable\n");
			chmodSync(join(notExecutable, "hyper"), 0o644);
			const good = join(real, "good");
			mkdirSync(good);
			writeFileSync(join(good, "hyper"), "#!/bin/sh\n");
			chmodSync(join(good, "hyper"), 0o755);
			expect(
				resolveHyper({
					PATH: [asDir, notExecutable, join(real, "absent"), good].join(delimiter),
				}),
			).toBe(join(good, "hyper"));
		} finally {
			rmSync(real, { recursive: true, force: true });
		}
	});
	it("parses only what the CLI can answer", () => {
		expect(
			parseSpaceAnswer({ status: 1, stdout: '{"root":null}', timedOut: false }),
		).toBeUndefined();
		expect(
			parseSpaceAnswer({
				status: 0,
				stdout: answerJson({ root: "/a", spaceGitDir: "/a/.hyper/space.git", cadence: "manual" }),
				timedOut: false,
			}),
		).toEqual({ root: "/a", spaceGitDir: "/a/.hyper/space.git", cadence: "manual" });
		// Only "an object with a root and no spaceGitDir key" is an old CLI.
		expect(() => parseSpaceAnswer({ status: 0, stdout: '{"root":"/a"}', timedOut: false })).toThrow(
			/no git dir/,
		);
		expect(parseSpaceAnswer({ status: 0, stdout: "[]", timedOut: false })).toBeUndefined();
	});
});

describe("what the children get (N2, N5)", () => {
	it("gives every child a PATH of absolute entries only", () => {
		const good = "/opt/hyper/bin";
		const env = childEnv({
			PATH: ["", ".", "./bin", "node_modules/.bin", "~/bin", good, "/usr/bin"].join(delimiter),
			HYPER_HOME: "/hyper",
		});
		expect(env.PATH).toBe([good, "/usr/bin"].join(delimiter));
		expect(env.HYPER_SKIP_NEW_VERSION_CHECK).toBe("1");
		// A bare relative PATH entry list leaves the child with nothing, never
		// with the directory it is about to run in.
		expect(childEnv({ PATH: "./bin:." }).PATH).toBe("");
	});

	it("spawns the worker with detached, no pipes, the session's cwd and this argv", () => {
		const calls: { bin: string; args: readonly string[]; options: SpawnOptions }[] = [];
		const child = { on: () => child, unref: () => {} } as unknown as ChildProcess;
		const deps: SessionEndDeps = createRealDeps({
			spawn: ((bin: string, args: readonly string[], options: SpawnOptions) => {
				calls.push({ bin, args, options });
				return child;
			}) as unknown as typeof spawn,
		});
		deps.spawnWorker(
			"/spaces/outer/.hyper/space.git/session-end-payload.1.abcd",
			"/opt/hyper/bin/hyper",
			"/spaces/outer/notes",
			() => {},
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.bin).toBe("/opt/hyper/bin/hyper");
		expect(calls[0]!.args).toEqual([
			"space",
			"commit",
			"--session-end",
			"--payload-file",
			"/spaces/outer/.hyper/space.git/session-end-payload.1.abcd",
		]);
		expect(calls[0]!.options.detached).toBe(true);
		expect(calls[0]!.options.stdio).toBe("ignore");
		expect(calls[0]!.options.cwd).toBe("/spaces/outer/notes");
		expect(String(calls[0]!.options.env?.PATH).split(delimiter)).toEqual(
			absolutePathEntries(process.env.PATH),
		);
	});

	it("kills a probe that hangs at the bound, and the handler returns", async () => {
		// `sleep 30` never answers; the bound is 250 ms here.
		const bin = join(directory, "sleeper");
		writeFileSync(bin, "#!/bin/sh\nsleep 30\n");
		chmodSync(bin, 0o755);
		const started = Date.now();
		const result = await realDeps.probe(bin, directory, 250);
		const elapsed = Date.now() - started;
		expect(result.timedOut).toBe(true);
		expect(result.stdout).toBe("");
		expect(elapsed).toBeLessThan(5_000);
	});

	it("treats a probe that floods stdout as no answer at all", async () => {
		const bin = join(directory, "flooder");
		writeFileSync(
			bin,
			`#!/bin/sh\n${"yes x | head -c 200000 2>/dev/null || head -c 200000 /dev/zero | tr '\\0' 'x'"}\n`,
		);
		chmodSync(bin, 0o755);
		const result = await realDeps.probe(bin, directory, 5_000);
		expect(result.stdout).toBe("");
	});
});

describe("the real dependencies", () => {
	it("writes the payload 0600, exclusively, inside the git dir it is given", () => {
		const gitDir = join(directory, ".hyper", "space.git");
		mkdirSync(gitDir, { recursive: true });
		const first = realDeps.writePayload(gitDir, '{"session_id":"x"}');
		const second = realDeps.writePayload(gitDir, '{"session_id":"y"}');
		expect(first).not.toBe(second);
		for (const path of [first, second]) {
			expect(path.startsWith(`${gitDir}${"/"}`)).toBe(true);
			expect(path).toContain("session-end-payload.");
			expect(statSync(path).mode & 0o777).toBe(0o600);
		}
		expect(JSON.parse(readFileSync(first, "utf8")).session_id).toBe("x");
		expect(() => realDeps.writePayload(join(directory, "absent"), "{}")).toThrow();
		// O_EXCL really is exclusive: the same name twice is a refusal, and the
		// first file is untouched.
		const name = "session-end-payload.fixed";
		const only = realDeps.writePayload(gitDir, '{"session_id":"first"}', name);
		expect(only).toBe(join(gitDir, name));
		expect(() => realDeps.writePayload(gitDir, '{"session_id":"second"}', name)).toThrow();
		expect(readFileSync(only, "utf8")).toBe('{"session_id":"first"}');
	});

	it("spawns the worker detached, with no pipes, from the given directory", async () => {
		const marker = join(directory, "argv.json");
		const spy = join(directory, "spy-hyper");
		writeFileSync(
			spy,
			`#!/bin/sh\nprintf '{"cwd":"%s","ppid_sam":%s}' "$PWD" "$(ps -o ppid= -p $$ | tr -d ' ')" > ${marker}\n`,
		);
		chmodSync(spy, 0o755);
		const detachedProbe = join(directory, "detached");
		mkdirSync(detachedProbe);
		realDeps.spawnWorker(join(directory, "payload"), spy, detachedProbe, () => {
			throw new Error("the worker must not report anything here");
		});
		await waitForFile(marker);
		const record = JSON.parse(readFileSync(marker, "utf8")) as { cwd: string };
		expect(realpathSync(record.cwd)).toBe(realpathSync(detachedProbe));
		// Detached: the child got its own session, so it is not in pi's group.
		const session = spawnSync("ps", ["-o", "sess=", "-p", String(process.pid)], {
			encoding: "utf8",
		}).stdout.trim();
		expect(session).not.toBe("");
	});

	it("reports a missing worker binary through the notifier instead of throwing", async () => {
		const lines: string[] = [];
		const deps: SessionEndDeps = { ...realDeps, notify: (line) => lines.push(line) };
		// The ENOENT path is asynchronous: spawn returns, then emits "error".
		deps.spawnWorker(
			join(directory, "payload"),
			join(directory, "absent-hyper"),
			directory,
			deps.notify,
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(lines).toEqual([MISSING_CLI_LINE]);
	});

	it("probes the CLI with a hard bound and never inherits pipes", async () => {
		const started = performance.now();
		const result = await realDeps.probe("/bin/sh", directory, 200);
		// /bin/sh ignores the arguments and exits; what matters is that the
		// promise settles with a result rather than hanging.
		expect(result.timedOut).toBe(false);
		expect(performance.now() - started).toBeLessThan(5_000);
	});
});

describe("against the real built CLI, in a throwaway space", () => {
	it("commits once with the summary, then nothing when nothing changed", async () => {
		const repository = join(import.meta.dirname, "../../..");
		const cli = join(repository, "packages/cli/bin/run.js");
		const fix = mkdtempSync(join(tmpdir(), "hyper-pi-e2e-"));
		const bin = join(fix, "bin");
		const space = join(fix, "space");
		const gitDir = join(space, ".hyper", "space.git");
		mkdirSync(bin);
		// A real space, built by the same helpers the rest of this suite uses:
		// bare `.git`, a worktrees/ dir, a space git dir with `core.worktree`
		// and a first commit on the space branch.
		makeBareSpace(space);
		writeFileSync(join(space, ".gitignore"), renderGitignore());
		mkdirSync(join(space, "notes"), { recursive: true });
		writeFileSync(join(space, "notes", "note.md"), "one\n");
		initSpaceGitDir(space, { branch: "space/pi-e2e" });
		spaceGit(space, ["config", "gc.auto", "0"]);
		await commitSpace(space, "space/pi-e2e", "init");
		spaceGit(space, ["symbolic-ref", "HEAD", "refs/heads/space/pi-e2e"]);
		spaceGit(space, ["config", "branch.space/pi-e2e.merge", "refs/heads/space/pi-e2e"]);
		spaceGit(space, ["config", "hyper.cadence", "session-end"]);
		writeFileSync(join(bin, "hyper"), `#!/bin/sh\nexec ${process.execPath} ${cli} "$@"\n`);
		chmodSync(join(bin, "hyper"), 0o755);
		const env = {
			...process.env,
			PATH: `${bin}${delimiter}${process.env.PATH}`,
			// The stubbed, isolated environment of this file's beforeEach, so
			// the CLI subprocess commits with the same throwaway identity.
			HOME: join(fix, "home"),
			HYPER_HOME: join(fix, "hyper"),
			HYPER_DRIVE_CONFIG: join(fix, "drive.toml"),
			XDG_CONFIG_HOME: join(fix, "config"),
			HYPER_SKIP_NEW_VERSION_CHECK: "1",
		};
		try {
			mkdirSync(env.HOME, { recursive: true });
			const hyper = resolveHyper(env);
			expect(hyper).toBe(join(bin, "hyper"));
			const runCli = (args: string[], cwd: string) => {
				try {
					return { status: 0, stdout: execFileSync(hyper!, args, { cwd, env, encoding: "utf8" }) };
				} catch (error) {
					const failed = error as { status?: number; stdout?: string };
					return { status: failed.status ?? null, stdout: failed.stdout ?? "" };
				}
			};
			// detect and the worker go through execFileSync with the fixture
			// environment; the detach itself is covered by the realDeps test.
			const deps = fakeDeps({
				resolveCli: () => hyper,
				probe: async (_cli, cwd) => ({
					...runCli(["space", "detect", "--json"], cwd),
					timedOut: false,
				}),
				writePayload: realDeps.writePayload,
				spawnWorker: (payloadPath, _cli, cwd) => {
					deps.spawns.push({ payloadPath, bin: hyper!, cwd });
					runCli(["space", "commit", "--session-end", "--payload-file", payloadPath], cwd);
				},
			});
			writeFileSync(join(space, "notes", "note.md"), "changed by a pi session\n");
			expect(await saveSessionEnd(facts({ cwd: space }), deps)).toEqual({
				session_id: id,
				cwd: space,
				harness: "pi",
				summary: "Ship the pi hook",
			});
			const log = () => readFileSync(join(gitDir, "session-end.log"), "utf8").trim().split("\n");
			expect(log()[0]!.split("\t")[2]).toBe("committed");
			expect(log()[0]!.split("\t")[3]).toBe("committed 1 file");
			expect(spaceGit(space, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(
				`session: Ship the pi hook\n\nPi-Session: ${id}`,
			);
			// Nothing changed: a second save commits nothing and says so.
			await saveSessionEnd(facts({ cwd: space }), deps);
			expect(log()[1]!.split("\t")[2]).toBe("nothing");
			expect(spaceGit(space, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("2");
			// A directory that is not a space: no payload, no log line, nothing printed.
			const outside = join(fix, "outside");
			mkdirSync(outside, { recursive: true });
			deps.payloads = [];
			expect(await saveSessionEnd(facts({ cwd: outside }), deps)).toBeUndefined();
			expect(deps.payloads).toEqual([]);
			expect(deps.lines).toEqual([]);
			// And a real cwd below the space resolves to the same space.
			const nested = join(space, "notes");
			deps.spawns = [];
			expect((await saveSessionEnd(facts({ cwd: nested }), deps))?.cwd).toBe(nested);
			// The payload went into the space's own git dir, named the way the
			// worker insists on, and the worker ran from the nested directory.
			// The worker removed the payload, so compare the path it was given.
			expect(deps.spawns[0]!.payloadPath.replace(realpathSync(fix), fix)).toMatch(
				new RegExp(`^${escapeRegExp(gitDir)}/session-end-payload\\.`),
			);
			expect(deps.spawns[0]!.cwd).toBe(nested);
		} finally {
			rmSync(fix, { recursive: true, force: true });
		}
	}, 60_000);
});
