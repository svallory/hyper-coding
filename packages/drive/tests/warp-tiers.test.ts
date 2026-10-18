import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detachSync, type MachineRunner } from "#services/remote";
import {
	appendSessionEndLog,
	lastSessionEndEntry,
	lastSessionEndFailure,
	lastWarpSync,
	warpSyncStatusLine,
} from "#services/session-end-log";
import { firstUserMessage } from "#services/sessions";
import {
	describeStep,
	executeWarp,
	planWarp,
	type WarpDeps,
	type WarpInputs,
	type WarpPlan,
} from "#services/warp";
import {
	chooseSession,
	formatBytes,
	isNeverCopied,
	otherProjectEntries,
	otherSessionEntries,
	othersQuestion,
	parseOthersMode,
	pickerLine,
	sizeOf,
	tier1Extras,
	tier2Entries,
	withoutNeverCopied,
} from "#services/warp-tiers";

const ID = "3d9c77a6-6975-4381-b884-214b3ca452d8";
const OTHER = "aaaaaaaa-6975-4381-b884-214b3ca452d8";
const KEY = "-home-fixture-work-proj";

let home: string;

/** A fake `~/.claude`: `files` maps a path under it to its content, a trailing `/` makes a directory. */
function tree(files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const path = join(home, rel);
		if (rel.endsWith("/")) {
			mkdirSync(path, { recursive: true });
			continue;
		}
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "warp-tiers-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

const labels = (entries: { src: string }[]) => entries.map((entry) => entry.src.replace(home, ""));

describe("tier 1 beyond the transcript: small things resume needs", () => {
	it("lists project memory, aliases, file history and session env that exist", () => {
		tree({
			[`projects/${KEY}/memory/MEMORY.md`]: "x",
			[`projects/${KEY}/.session-aliases`]: "/p",
			[`file-history/${ID}/a@v1`]: "x",
			[`session-env/${ID}/`]: "",
			[`projects/${KEY}/${ID}.jsonl`]: "{}",
		});
		const entries = tier1Extras(home, KEY, ID);
		expect(labels(entries)).toEqual([
			`/projects/${KEY}/memory`,
			`/projects/${KEY}/.session-aliases`,
			`/file-history/${ID}`,
			`/session-env/${ID}`,
		]);
		expect(entries.map((entry) => entry.tree)).toEqual([true, false, true, true]);
	});

	it("leaves out what is not there, and never mentions another session's data", () => {
		tree({
			[`projects/${KEY}/memory/MEMORY.md`]: "x",
			[`file-history/${OTHER}/a@v1`]: "x",
			[`session-env/${OTHER}/`]: "",
		});
		expect(labels(tier1Extras(home, KEY, ID))).toEqual([`/projects/${KEY}/memory`]);
	});

	it("is empty for a bare home", () => {
		expect(tier1Extras(home, KEY, ID)).toEqual([]);
	});
});

describe("tier 2: the session's big folders", () => {
	it("is tool-results and subagents, and nothing else in the session folder", () => {
		tree({
			[`projects/${KEY}/${ID}/tool-results/a.txt`]: "x",
			[`projects/${KEY}/${ID}/subagents/agent-1.jsonl`]: "x",
			[`projects/${KEY}/${ID}/other/z`]: "x",
		});
		expect(labels(tier2Entries(home, KEY, ID))).toEqual([
			`/projects/${KEY}/${ID}/tool-results`,
			`/projects/${KEY}/${ID}/subagents`,
		]);
	});

	it("takes only the one that exists", () => {
		tree({ [`projects/${KEY}/${ID}/subagents/a`]: "x" });
		expect(labels(tier2Entries(home, KEY, ID))).toEqual([`/projects/${KEY}/${ID}/subagents`]);
	});

	it("is empty without a session folder", () => {
		expect(tier2Entries(home, KEY, ID)).toEqual([]);
	});
});

describe("tier 3: everything else", () => {
	it("collects the project's other sessions with their files, not this one", () => {
		tree({
			[`projects/${KEY}/${ID}.jsonl`]: "{}",
			[`projects/${KEY}/${OTHER}.jsonl`]: "12345",
			[`projects/${KEY}/${OTHER}.warp.json`]: "{}",
			[`projects/${KEY}/${OTHER}/tool-results/a`]: "123",
			[`file-history/${OTHER}/h`]: "1",
			[`session-env/${OTHER}/`]: "",
			[`projects/${KEY}/memory/MEMORY.md`]: "x",
		});
		const others = otherSessionEntries(home, KEY, ID);
		expect(others.ids).toEqual([OTHER]);
		expect(labels(others.entries)).toEqual([
			`/projects/${KEY}/${OTHER}.jsonl`,
			`/projects/${KEY}/${OTHER}.warp.json`,
			`/projects/${KEY}/${OTHER}`,
			`/file-history/${OTHER}`,
			`/session-env/${OTHER}`,
		]);
		// 5 + 2 + 3 + 1 + 0
		expect(others.bytes).toBe(11);
	});

	it("has nothing to offer for a project with one session", () => {
		tree({ [`projects/${KEY}/${ID}.jsonl`]: "{}" });
		expect(otherSessionEntries(home, KEY, ID).ids).toEqual([]);
	});

	it("all-projects lists every project folder but the current one", () => {
		tree({
			[`projects/${KEY}/${ID}.jsonl`]: "{}",
			"projects/-home-other/a.jsonl": "12",
			"projects/-home-third/b.jsonl": "123",
		});
		const all = otherProjectEntries(home, KEY);
		expect(all.ids).toEqual(["-home-other", "-home-third"]);
		expect(all.bytes).toBe(5);
	});

	it("sizeOf counts files under a directory", () => {
		tree({ "d/a": "12", "d/s/b": "345" });
		expect(sizeOf(join(home, "d"))).toBe(5);
		expect(sizeOf(join(home, "missing"))).toBe(0);
	});
});

describe("what never travels", () => {
	it.each(["sessions", "sessions/123.json", "debug/log.txt", "statsig/x", ".claude.json"])(
		"never copies %s",
		(rel) => {
			expect(isNeverCopied(rel)).toBe(true);
		},
	);

	it.each([
		"projects/k/a.jsonl",
		"file-history/id",
		"session-env/id",
		"todos/x",
		".claude.json.backup-not",
	])("allows %s", (rel) => {
		expect(isNeverCopied(rel)).toBe(false);
	});

	it("excludes shell snapshots older than the session, keeps newer ones", () => {
		const start = 1_000_000;
		expect(
			isNeverCopied("shell-snapshots/a.sh", { mtimeMs: start - 1, sessionStartMs: start }),
		).toBe(true);
		expect(
			isNeverCopied("shell-snapshots/a.sh", { mtimeMs: start + 1, sessionStartMs: start }),
		).toBe(false);
		// Unknown age: not shown to be newer, so not copied.
		expect(isNeverCopied("shell-snapshots/a.sh")).toBe(true);
	});

	it("the last guard drops an entry inside an excluded folder", () => {
		const entries = [
			{ src: join(home, "sessions", "1.json"), tree: false, label: "reg" },
			{ src: join(home, "projects", KEY, "memory"), tree: true, label: "memory" },
			{ src: join(home, "debug"), tree: true, label: "debug" },
		];
		expect(withoutNeverCopied(home, entries).map((entry) => entry.label)).toEqual(["memory"]);
	});

	it("no tier builder yields anything under an excluded folder", () => {
		tree({
			"sessions/1.json": "{}",
			"debug/x": "x",
			"statsig/x": "x",
			".claude.json": "{}",
			[`projects/${KEY}/${ID}.jsonl`]: "{}",
			[`projects/${KEY}/memory/m`]: "x",
		});
		const all = [
			...tier1Extras(home, KEY, ID),
			...tier2Entries(home, KEY, ID),
			...otherSessionEntries(home, KEY, ID).entries,
			...otherProjectEntries(home, KEY).entries,
		];
		expect(withoutNeverCopied(home, all)).toEqual(all);
	});
});

describe("choosing the session", () => {
	const old = { id: "old", mtimeMs: 1000, firstMessage: null };
	const mid = { id: "mid", mtimeMs: 2000, firstMessage: null };
	const fresh = { id: "fresh", mtimeMs: 3000, firstMessage: null };
	const base = { candidates: [old, fresh, mid], liveIds: [], yes: false };

	it("--session wins over everything", () => {
		expect(
			chooseSession({ ...base, explicit: "old", envSessionId: "mid", liveIds: ["fresh"] }),
		).toEqual({
			kind: "chosen",
			id: "old",
			why: "explicit",
		});
	});

	it("prefers the id of the session warp runs inside", () => {
		expect(chooseSession({ ...base, envSessionId: "mid", liveIds: ["fresh"] })).toEqual({
			kind: "chosen",
			id: "mid",
			why: "env",
		});
	});

	it("ignores an env id that has no transcript here", () => {
		expect(chooseSession({ ...base, envSessionId: "elsewhere", liveIds: ["old"] })).toEqual({
			kind: "chosen",
			id: "old",
			why: "live",
		});
	});

	it("takes the one live session whose cwd matches", () => {
		expect(chooseSession({ ...base, liveIds: ["mid"] })).toMatchObject({ id: "mid", why: "live" });
	});

	it("with several live ones, asks among those only", () => {
		const choice = chooseSession({ ...base, liveIds: ["old", "mid"] });
		expect(choice).toMatchObject({ kind: "ask" });
		if (choice.kind === "ask")
			expect(choice.options.map((entry) => entry.id)).toEqual(["mid", "old"]);
	});

	it("takes the only transcript without asking", () => {
		expect(chooseSession({ candidates: [old], liveIds: [], yes: false })).toMatchObject({
			id: "old",
			why: "only",
		});
	});

	it("--yes takes the newest", () => {
		expect(chooseSession({ ...base, yes: true })).toMatchObject({ id: "fresh", why: "newest" });
	});

	it("asks when it cannot tell, newest first", () => {
		const choice = chooseSession(base);
		expect(choice.kind).toBe("ask");
		if (choice.kind === "ask")
			expect(choice.options.map((entry) => entry.id)).toEqual(["fresh", "mid", "old"]);
	});

	it("offers at most five", () => {
		const many = Array.from({ length: 9 }, (_, index) => ({
			id: `s${index}`,
			mtimeMs: index,
			firstMessage: null,
		}));
		const choice = chooseSession({ candidates: many, liveIds: [], yes: false });
		if (choice.kind !== "ask") throw new Error("expected a question");
		expect(choice.options.map((entry) => entry.id)).toEqual(["s8", "s7", "s6", "s5", "s4"]);
	});

	it("has nothing to choose without transcripts", () => {
		expect(chooseSession({ candidates: [], liveIds: [], yes: true })).toEqual({
			kind: "ask",
			options: [],
		});
	});

	it("picker lines show the id, the time and what was typed", () => {
		expect(
			pickerLine(0, {
				id: "abc",
				mtimeMs: Date.UTC(2026, 9, 18, 10, 2),
				firstMessage: "fix the bug",
			}),
		).toBe("1) abc  2026-10-18 10:02  fix the bug");
		expect(pickerLine(2, { id: "abc", mtimeMs: 0, firstMessage: null })).toContain(
			"(no user message)",
		);
	});
});

describe("the question for tier 3", () => {
	it("parses the answers, no being the default", () => {
		expect(parseOthersMode("")).toBe("no");
		expect(parseOthersMode(" NO ")).toBe("no");
		expect(parseOthersMode("n")).toBe("no");
		expect(parseOthersMode("now")).toBe("now");
		expect(parseOthersMode("background")).toBe("background");
		expect(parseOthersMode("b")).toBe("background");
		expect(parseOthersMode("maybe")).toBeNull();
	});

	it("words the question with the count and size", () => {
		expect(othersQuestion(7, 5 * 1024 * 1024, false)).toBe(
			"Also sync the project's other 7 sessions (5.0 MB)? [now/background/no] (default no): ",
		);
		expect(othersQuestion(3, 10, true)).toContain("the 3 other projects (10 B)");
	});

	it("formats sizes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(3.3 * 1024 ** 3)).toBe("3.3 GB");
	});
});

describe("first user message of a transcript", () => {
	it("skips meta lines and wrappers, flattens whitespace, and truncates", () => {
		const path = join(home, "t.jsonl");
		writeFileSync(
			path,
			[
				JSON.stringify({ type: "summary", summary: "x" }),
				JSON.stringify({ type: "user", isMeta: true, message: { content: "meta" } }),
				JSON.stringify({ type: "user", message: { content: "<command-name>/x</command-name>" } }),
				JSON.stringify({
					type: "user",
					message: { content: [{ type: "text", text: "  fix\n the   bug " }, { type: "image" }] },
				}),
				JSON.stringify({ type: "user", message: { content: "later" } }),
			].join("\n"),
		);
		expect(firstUserMessage(path)).toBe("fix the bug");
		writeFileSync(
			path,
			`${JSON.stringify({ type: "user", message: { content: "x".repeat(300) } })}\n`,
		);
		expect(firstUserMessage(path, 20)).toBe(`${"x".repeat(19)}…`);
	});

	it("is null for a missing file or a transcript with no user turn", () => {
		expect(firstUserMessage(join(home, "none.jsonl"))).toBeNull();
		writeFileSync(join(home, "e.jsonl"), "not json\n");
		expect(firstUserMessage(join(home, "e.jsonl"))).toBeNull();
	});
});

describe("the plan: which tier goes where", () => {
	const FOLDER = `/home/fixture/.claude/projects/${KEY}`;
	const entry = (src: string, tree = true) => ({
		src,
		tree,
		label: src.split("/").pop() as string,
	});

	function inputs(overrides: Partial<WarpInputs> = {}): WarpInputs {
		return {
			cwd: "/home/fixture/work/proj",
			selfName: "mac",
			selfHome: "/home/fixture",
			target: { name: "netcup", host: "me@box", home: "/home/fixture" },
			sessionId: ID,
			transcriptPath: `${FOLDER}/${ID}.jsonl`,
			transcriptSubfolder: true,
			live: [],
			stop: false,
			force: false,
			remoteControl: false,
			owner: { state: "unowned", path: `${FOLDER}/${ID}.warp.json` },
			strayMarker: null,
			cwdKind: "plain-dir",
			space: null,
			spaceInManifest: { ok: true },
			excludes: [],
			trackedUnderExcludes: [],
			syncSession: null,
			agentSuffix: "k1",
			startedAt: "2026-10-04T12:00:00.000Z",
			...overrides,
		};
	}
	function plan(overrides: Partial<WarpInputs> = {}): WarpPlan {
		const result = planWarp(inputs(overrides));
		if (!result.ok) throw new Error(result.message);
		return result.plan;
	}
	const extras = [entry(`${FOLDER}/memory`), entry(`/home/fixture/.claude/file-history/${ID}`)];
	const tier2 = [entry(`${FOLDER}/${ID}/tool-results`), entry(`${FOLDER}/${ID}/subagents`)];
	const others = [entry(`${FOLDER}/${OTHER}.jsonl`, false)];
	const copySrcs = (p: WarpPlan) =>
		p.steps.flatMap((step) => (step.kind === "copy" ? [step.src] : []));
	const indexOfKind = (p: WarpPlan, kind: string, nth = 0) =>
		p.steps.map((step) => step.kind).indexOf(kind as never, nth);

	it("tier 1 copies come before the working directory and before the resume", () => {
		const p = plan({ tier1Extras: extras, tier2 });
		const srcs = copySrcs(p);
		expect(srcs.slice(0, 2)).toEqual([`${FOLDER}/${ID}.jsonl`, `${FOLDER}/${ID}.warp.json`]);
		expect(srcs.slice(2, 4)).toEqual(extras.map((e) => e.src));
		expect(srcs.at(-1)).toBe("/home/fixture/work/proj");
		const lastCopy = p.steps.map((s) => s.kind).lastIndexOf("copy");
		expect(lastCopy).toBeLessThan(indexOfKind(p, "herdr"));
	});

	it("tier 2 is never a blocking copy: it is a background step after the resume", () => {
		const p = plan({ tier1Extras: extras, tier2 });
		for (const e of tier2) expect(copySrcs(p)).not.toContain(e.src);
		const background = p.steps.find((step) => step.kind === "background-sync");
		expect(background).toMatchObject({ kind: "background-sync", logFile: null });
		expect((background as { entries: unknown[] }).entries).toEqual(tier2);
		expect(indexOfKind(p, "background-sync")).toBeGreaterThan(
			p.steps.map((s) => s.kind).lastIndexOf("herdr"),
		);
	});

	it("no tier 2 means no background step", () => {
		expect(plan().steps.some((step) => step.kind === "background-sync")).toBe(false);
	});

	it("tier 3 'now' joins the blocking copies; 'background' joins the background step", () => {
		const now = plan({ tier2, others: { mode: "now", entries: others } });
		expect(copySrcs(now)).toContain(others[0]?.src);
		expect(
			(now.steps.find((s) => s.kind === "background-sync") as { entries: unknown[] }).entries,
		).toEqual(tier2);

		const background = plan({ tier2, others: { mode: "background", entries: others } });
		expect(copySrcs(background)).not.toContain(others[0]?.src);
		expect(
			(background.steps.find((s) => s.kind === "background-sync") as { entries: unknown[] })
				.entries,
		).toEqual([...tier2, ...others]);
	});

	it("tier 3 'no' adds nothing", () => {
		const p = plan({ tier2, others: { mode: "no", entries: others } });
		expect(JSON.stringify(p.steps)).not.toContain(OTHER);
	});

	it("the log file travels into the step, and dry-run names every path", () => {
		const p = plan({ tier2, syncLogFile: "/space/.hyper/space.git/session-end.log" });
		const step = p.steps.find((s) => s.kind === "background-sync");
		expect(step).toMatchObject({ logFile: "/space/.hyper/space.git/session-end.log" });
		const text = describeStep(step as never);
		expect(text).toContain("background:");
		for (const e of tier2) expect(text).toContain(e.src);
		expect(text).toContain("--partial");
	});

	it("never plans --delete or anything from the excluded folders", () => {
		const p = plan({ tier1Extras: extras, tier2, others: { mode: "now", entries: others } });
		const text = JSON.stringify(p.steps);
		expect(text).not.toContain("--delete");
		expect(text).not.toContain(".claude/sessions");
		expect(text).not.toContain(".claude/debug");
	});

	describe("running it", () => {
		function deps(started: unknown[], fail?: Error): WarpDeps {
			const runner: MachineRunner = {
				async ssh() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async rsync() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async scp() {
					throw new Error("no scp");
				},
			};
			return {
				runner,
				swapMarker: () => {},
				runHerdr: async (argv) => ({
					code: 0,
					stdout: argv.includes("tab")
						? JSON.stringify({ result: { root_pane: { pane_id: "w1:p1" } } })
						: "",
					stderr: "",
				}),
				warpCarriedRefs: () => [],
				detachSync: ((options: unknown) => {
					if (fail) throw fail;
					started.push(options);
					return { pid: 4242 };
				}) as never,
			};
		}

		it("starts the detached transfer after the resume, with the target and the same paths", async () => {
			const started: Array<{
				host: string;
				jobs: { src: string; dst: string }[];
				logFile?: string;
				session: string;
			}> = [];
			const p = plan({ tier2, syncLogFile: "/s/session-end.log" });
			const run = await executeWarp(p, deps(started));
			expect(run.failure).toBeUndefined();
			expect(started).toHaveLength(1);
			expect(started[0]).toMatchObject({
				host: "me@box",
				session: ID,
				logFile: "/s/session-end.log",
			});
			expect(started[0]?.jobs).toEqual(
				tier2.map((e) => ({ src: `${e.src}/`, dst: e.src, label: e.label })),
			);
			expect(run.notices.join("\n")).toContain("pid 4242");
			expect(run.notices.join("\n")).toContain("hyper space status");
		});

		it("without a space log it says nothing will be reported", async () => {
			const started: unknown[] = [];
			const run = await executeWarp(plan({ tier2 }), deps(started));
			expect(run.notices.join("\n")).toContain("reports nothing");
		});

		it("a transfer that cannot start is a notice, not a failed warp", async () => {
			const run = await executeWarp(plan({ tier2 }), deps([], new Error("no sh")));
			expect(run.failure).toBeUndefined();
			expect(run.notices.join("\n")).toContain("Could not start the background transfer");
			expect(run.notices.join("\n")).toContain("no sh");
		});
	});
});

describe("progress lines in the session-end log", () => {
	let gitDir: string;
	beforeEach(() => {
		gitDir = join(home, "space.git");
		mkdirSync(gitDir, { recursive: true });
	});

	it("formats the three states for hyper space status", () => {
		const at = "2026-10-18T10:00:00.000Z";
		expect(
			warpSyncStatusLine({
				at,
				session: ID,
				outcome: "syncing",
				detail: "to netcup: 1 of 3 transfers done",
			}),
		).toBe(`Warp transfer in progress (${at}, session ${ID}): to netcup: 1 of 3 transfers done`);
		expect(warpSyncStatusLine({ at, session: ID, outcome: "synced", detail: "d" })).toContain(
			"finished",
		);
		expect(warpSyncStatusLine({ at, session: ID, outcome: "sync-failed", detail: "d" })).toContain(
			"FAILED",
		);
	});

	it("a progress line does not hide a session-end failure or count as one", () => {
		appendSessionEndLog(gitDir, { session: ID, outcome: "failed", detail: "boom" });
		writeFileSync(
			join(gitDir, "session-end.log"),
			`${readFileSync(join(gitDir, "session-end.log"), "utf8")}2026-10-18T10:00:00.000Z\t${ID}\tsyncing\tto netcup: 0 of 2 transfers done\n`,
		);
		expect(lastSessionEndEntry(gitDir)).toMatchObject({ outcome: "failed", detail: "boom" });
		expect(lastSessionEndFailure(gitDir)).toMatchObject({ outcome: "failed" });
		expect(lastWarpSync(gitDir)).toMatchObject({ outcome: "syncing" });
	});

	it("the newest progress record wins; none means null", () => {
		expect(lastWarpSync(gitDir)).toBeNull();
		const line = (outcome: string, detail: string) =>
			`2026-10-18T10:00:00.000Z\t${ID}\t${outcome}\t${detail}\n`;
		writeFileSync(join(gitDir, "session-end.log"), line("syncing", "a") + line("sync-failed", "b"));
		expect(lastWarpSync(gitDir)).toMatchObject({ outcome: "sync-failed", detail: "b" });
		expect(lastSessionEndEntry(gitDir)).toBeNull();
	});
});

describe("the detached transfer, with a fake rsync and ssh on PATH", () => {
	let bin: string;
	let calls: string;
	let oldPath: string | undefined;

	/** Wait for the log's last line to satisfy `done`. */
	async function waitFor(path: string, done: (text: string) => boolean): Promise<string> {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (existsSync(path)) {
				const text = readFileSync(path, "utf8");
				if (done(text)) return text;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`timed out waiting on ${path}`);
	}

	beforeEach(() => {
		bin = join(home, "bin");
		calls = join(home, "calls.txt");
		mkdirSync(bin);
		oldPath = process.env.PATH;
		process.env.PATH = `${bin}:${oldPath}`;
	});
	afterEach(() => {
		process.env.PATH = oldPath;
	});

	function fake(name: string, body: string): void {
		const path = join(bin, name);
		writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> '${calls}'\n${body}\n`);
		chmodSync(path, 0o755);
	}

	const jobs = (n: number) =>
		Array.from({ length: n }, (_, index) => ({
			src: `/tmp/src${index}/`,
			dst: `/tmp/dst${index}`,
			label: `job ${index}`,
		}));

	it("runs every transfer with --partial and no --delete, then logs synced", async () => {
		fake("ssh", "exit 0");
		fake("rsync", "exit 0");
		const log = join(home, "session-end.log");
		const { pid } = detachSync({
			host: "me@box",
			port: 2222,
			jobs: jobs(2),
			session: ID,
			logFile: log,
			targetName: "netcup",
		});
		expect(pid).toBeGreaterThan(0);
		const text = await waitFor(log, (value) => value.includes("\tsynced\t"));
		const lines = text
			.trim()
			.split("\n")
			.map((line) => line.split("\t"));
		expect(lines.map((line) => line[2])).toEqual(["syncing", "syncing", "syncing", "synced"]);
		expect(lines[0]?.[3]).toBe("to netcup: 0 of 2 transfers done");
		expect(lines[2]?.[3]).toContain("2 of 2 transfers done");
		expect(lines[3]?.[1]).toBe(ID);
		const made = readFileSync(calls, "utf8");
		expect(made).toContain(
			"rsync -a --stats -e ssh -p 2222 --partial -- /tmp/src0/ me@box:/tmp/dst0/",
		);
		expect(made).toContain("ssh -p 2222 me@box -- mkdir -p -- /tmp/dst0");
		expect(made).not.toContain("--delete");
		// The line the status command prints reads back from the same file.
		expect(warpSyncStatusLine(lastWarpSync(join(home))!)).toContain("finished");
	});

	it("a failing transfer ends as sync-failed and says how to finish it", async () => {
		fake("ssh", "exit 0");
		fake("rsync", 'case "$*" in *src1*) exit 23;; esac\nexit 0');
		const log = join(home, "session-end.log");
		detachSync({ host: "me@box", jobs: jobs(2), session: ID, logFile: log, targetName: "netcup" });
		const text = await waitFor(log, (value) => value.includes("sync-failed"));
		expect(text).toContain("1 of 2 transfers failed (last exit 23)");
		expect(text).toContain("run hyper warp again");
	});

	it("never writes through a log that is a symlink", async () => {
		fake("ssh", "exit 0");
		fake("rsync", `touch '${home}/finished'\nexit 0`);
		const victim = join(home, "victim.txt");
		writeFileSync(victim, "keep\n");
		const log = join(home, "session-end.log");
		symlinkSync(victim, log);
		detachSync({ host: "me@box", jobs: jobs(1), session: ID, logFile: log, targetName: "netcup" });
		await waitFor(join(home, "finished"), () => true);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(readFileSync(victim, "utf8")).toBe("keep\n");
	});

	it("works without a log file", async () => {
		fake("ssh", "exit 0");
		fake("rsync", `touch '${home}/finished'\nexit 0`);
		detachSync({ host: "me@box", jobs: jobs(1), session: ID, targetName: "netcup" });
		await waitFor(join(home, "finished"), () => true);
	});

	it("refuses a destination the remote shell could misread, before starting anything", () => {
		expect(() =>
			detachSync({
				host: "me@box",
				jobs: [{ src: "/a/", dst: "/b c", label: "x" }],
				session: ID,
				targetName: "netcup",
			}),
		).toThrow(/isn't a path hyperdrive can use/);
	});

	it("refuses a host that starts with a dash", () => {
		expect(() =>
			detachSync({ host: "-oProxyCommand=x", jobs: jobs(1), session: ID, targetName: "n" }),
		).toThrow(/can't start with "-"/);
	});
});
