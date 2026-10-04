/**
 * The pi extension's session-end save, driven by a fake pi API: no pi, no
 * space on disk, no CLI. The cadence filter, the payload content and the
 * detached spawn arguments are all asserted here; the real worker is covered
 * by tests/session-end.test.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import hyperdrive from "../pi/hyperdrive.ts";
import {
	findSpaceRoot,
	readCadenceFromConfig,
	realDeps,
	type SessionEndDeps,
	saveSessionEnd,
	sessionSummary,
} from "../pi/session-end.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

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

interface FakeDeps extends SessionEndDeps {
	payloads: { dir: string; contents: string }[];
	spawns: { payloadPath: string; spaceRoot: string }[];
	lines: string[];
	dirs: Set<string>;
	files: Map<string, string>;
	/** Paths written by writePayload, mapped back to what spawnWorker received. */
	written: Map<string, string>;
}

function fakeDeps(spaceRoot?: string): FakeDeps {
	const dirs = new Set<string>();
	if (spaceRoot) dirs.add(join(spaceRoot, ".hyper", "space.git"));
	const deps: FakeDeps = {
		payloads: [],
		spawns: [],
		lines: [],
		dirs,
		files: new Map(),
		written: new Map(),
		readFile: (path) => {
			const value = deps.files.get(path);
			if (value === undefined) throw new Error(`ENOENT ${path}`);
			return value;
		},
		isDirectory: (path) => dirs.has(path),
		writePayload: (dir, contents) => {
			const path = join(dir, `session-end-payload.fake.${deps.payloads.length}`);
			deps.payloads.push({ dir, contents });
			deps.written.set(path, contents);
			return path;
		},
		spawnWorker: (payloadPath, root) => {
			deps.spawns.push({ payloadPath, spaceRoot: root });
		},
		notify: (line) => {
			deps.lines.push(line);
		},
	};
	return deps;
}

function config(cadence?: string): string {
	return `[core]\n\trepositoryformatversion = 0\n${
		cadence ? `[hyper]\n\tcadence = ${cadence}\n` : ""
	}`;
}

const id = "ba0efb18-103b-43b5-b5a0-fc3a08a2b00b";
let directory: string;
let root: string;
let spaceNotes: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "hyper-pi-session-end-"));
	root = join(directory, "space");
	spaceNotes = join(root, "notes");
});
afterEach(() => {
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

describe("the pi extension on session_shutdown", () => {
	it("registers only session_shutdown and never throws into pi", async () => {
		const pi = fakePi();
		hyperdrive(pi as never, fakeDeps());
		expect(pi.has("session_shutdown")).toBe(true);
		expect(pi.has("session_end")).toBe(false);
		// No space above the cwd, and a session manager that throws: still silent.
		const broken = fakeCtx({});
		broken.ctx.sessionManager.getBranch = () => {
			throw new Error("no session");
		};
		await expect(
			pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, broken.ctx),
		).resolves.not.toThrow();
		expect(broken.notifications).toEqual([]);
	});

	it.each(["quit", "reload", "new", "resume", "fork"])(
		"saves on every shutdown reason: %s",
		async (reason) => {
			const deps = fakeDeps(root);
			deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end"));
			const pi = fakePi();
			hyperdrive(pi as never, deps);
			const { ctx } = fakeCtx({ entries: [userMessage("Fix the session-end hook")] });
			await pi.fire("session_shutdown", { type: "session_shutdown", reason }, ctx);
			expect(deps.payloads).toHaveLength(1);
			expect(deps.spawns).toHaveLength(1);
			expect(JSON.parse(deps.payloads[0].contents).session_id).toBe(id);
		},
	);

	it("writes the payload the worker accepts and spawns it detached in the space", async () => {
		const deps = fakeDeps(root);
		deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end+push"));
		const { ctx } = fakeCtx({ entries: [userMessage("Ship the pi hook")] });
		const payload = saveSessionEnd(
			{ sessionId: id, cwd: ctx.cwd, entries: [userMessage("Ship the pi hook")] },
			deps,
		);
		expect(payload).toEqual({
			session_id: id,
			cwd: spaceNotes,
			harness: "pi",
			summary: "Ship the pi hook",
		});
		expect(deps.payloads[0].dir).toBe(join(root, ".hyper", "space.git"));
		expect(JSON.parse(deps.payloads[0].contents)).toEqual(payload);
		expect(deps.spawns).toHaveLength(1);
		expect(deps.spawns[0].spaceRoot).toBe(root);
		expect(deps.spawns[0].payloadPath).toMatch(
			new RegExp(
				`^${join(root, ".hyper", "space.git").replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}/session-end-payload\\.`,
			),
		);
		expect(deps.lines).toEqual([]);
	});

	it("does nothing outside a space, and nothing on manual or unset cadence", async () => {
		const nowhere = fakeDeps();
		expect(saveSessionEnd({ sessionId: id, cwd: directory, entries: [] }, nowhere)).toBeUndefined();
		for (const cadence of [undefined, "manual", "", "bogus"]) {
			const deps = fakeDeps(root);
			deps.files.set(join(root, ".hyper", "space.git", "config"), config(cadence));
			expect(saveSessionEnd({ sessionId: id, cwd: spaceNotes, entries: [] }, deps)).toBeUndefined();
			expect(deps.payloads).toEqual([]);
			expect(deps.spawns).toEqual([]);
			expect(deps.lines).toEqual([]);
		}
		// A missing config file is not an error either.
		const absent = fakeDeps(root);
		expect(saveSessionEnd({ sessionId: id, cwd: spaceNotes, entries: [] }, absent)).toBeUndefined();
		expect(absent.spawns).toEqual([]);
	});

	it("reports a missing CLI as one line and still leaves the payload for a later run", async () => {
		const deps = fakeDeps(root);
		deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end"));
		deps.spawnWorker = (payloadPath, spaceRoot) => {
			deps.spawns.push({ payloadPath, spaceRoot });
			deps.lines.push("hyperdrive: the hyper CLI is not installed; nothing was saved");
		};
		saveSessionEnd({ sessionId: id, cwd: spaceNotes, entries: [userMessage("x")] }, deps);
		expect(deps.lines).toHaveLength(1);
		expect(deps.spawns).toHaveLength(1);
	});

	it("reports one line when the payload cannot be written, and does not spawn", async () => {
		const deps = fakeDeps(root);
		deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end"));
		deps.writePayload = () => {
			throw new Error("EACCES");
		};
		expect(
			saveSessionEnd({ sessionId: id, cwd: spaceNotes, entries: [userMessage("x")] }, deps),
		).toBeUndefined();
		expect(deps.spawns).toEqual([]);
		expect(deps.lines).toHaveLength(1);
		expect(deps.lines[0]).toContain("could not write the session-end payload");
	});

	it("sends the same payload through pi's own event, and returns in milliseconds", async () => {
		const deps = fakeDeps(root);
		deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end"));
		const pi = fakePi();
		hyperdrive(pi as never, deps);
		const { ctx } = fakeCtx({ entries: [userMessage("pi event path")] });
		const started = performance.now();
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(performance.now() - started).toBeLessThan(200);
		expect(JSON.parse(deps.payloads[0].contents).summary).toBe("pi event path");
		expect(deps.spawns).toHaveLength(1);
	});

	it("uses the session name, then the first prompt, then nothing", () => {
		const entries = [userMessage("first prompt"), userMessage("second prompt")];
		expect(sessionSummary({ sessionId: id, cwd: spaceNotes, entries })).toBe("first prompt");
		expect(
			sessionSummary({ sessionId: id, cwd: spaceNotes, entries, sessionName: "Named run" }),
		).toBe("Named run");
		expect(sessionSummary({ sessionId: id, cwd: spaceNotes, entries: [] })).toBeUndefined();
		// Assistant turns and non-text blocks are not prompts.
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

	it("notifies through pi's UI when there is one and stderr when there is not", async () => {
		const deps = fakeDeps(root);
		deps.files.set(join(root, ".hyper", "space.git", "config"), config("session-end"));
		deps.writePayload = () => {
			throw new Error("EACCES");
		};
		const pi = fakePi();
		hyperdrive(pi as never, deps);
		const withUi = fakeCtx({});
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, withUi.ctx);
		expect(withUi.notifications).toHaveLength(1);
		const withoutUi = fakeCtx({ hasUI: false });
		await pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, withoutUi.ctx);
		expect(withoutUi.notifications).toEqual([]);
		// Exactly one line reached stderr; the TUI one went to pi's own UI.
		expect(deps.lines).toHaveLength(1);
	});

	it("spawns no git, ssh, rsync or scp: only the hyper CLI, with these arguments", async () => {
		const source = readFileSync(new URL("../pi/session-end.ts", import.meta.url), "utf8");
		const spawns = [...source.matchAll(/\bspawn\(([\s\S]*?)\);/g)].map((match) => match[1]);
		expect(spawns).toHaveLength(1);
		expect(spawns[0]).toContain('"hyper"');
		for (const forbidden of ["git", "ssh", "rsync", "scp"]) {
			expect(spawns[0]).not.toContain(`"${forbidden}"`);
		}
	});
});

describe("space discovery and cadence reading without git", () => {
	it("finds the nearest ancestor holding .hyper/space.git", () => {
		const deps = fakeDeps(root);
		expect(findSpaceRoot(spaceNotes, deps.isDirectory)).toBe(root);
		expect(findSpaceRoot(join(root, "notes", "deep", "deeper"), deps.isDirectory)).toBe(root);
		expect(findSpaceRoot(directory, deps.isDirectory)).toBeUndefined();
		expect(findSpaceRoot("/", deps.isDirectory)).toBeUndefined();
	});
	it.each([
		[config("session-end"), "session-end"],
		[config("session-end+push"), "session-end+push"],
		['[hyper]\n\tcadence = "manual"\n', "manual"],
		["[hyper]\n\tcadence=session-end\n", "session-end"],
		["[core]\n\tcadence = session-end\n", ""],
		["[hyper]\n\tother = session-end\n", ""],
		["# cadence = session-end\n", ""],
		["", ""],
		[undefined, ""],
	])("reads cadence %j", (contents, expected) => {
		expect(readCadenceFromConfig(contents as string | undefined)).toBe(expected);
	});
	it("writes a payload file the worker will accept and removes nothing else", () => {
		const dir = join(directory, "space.git");
		mkdirSync(dir);
		writeFileSync(join(directory, "keep.txt"), "keep");
		const path = realDeps.writePayload(dir, '{"session_id":"x"}');
		expect(path.startsWith(join(dir, "session-end-payload."))).toBe(true);
		expect(JSON.parse(readFileSync(path, "utf8")).session_id).toBe("x");
	});
});
