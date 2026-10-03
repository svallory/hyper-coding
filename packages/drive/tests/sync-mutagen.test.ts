import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CLAUDE_SYNC_IGNORE,
	DEFAULT_CONFIG,
	type DriveConfig,
	PI_SYNC_IGNORE,
	syncIgnoreFor,
} from "#config/schema";
import type { RunResult, SpawnRequest } from "#services/remote";
import {
	createArgs,
	daemonRegistered,
	MutagenSyncEngine,
	parseSessionList,
	sessionNameProblem,
} from "#services/sync/mutagen";

/**
 * The sync engine's contract. Every assertion here is about the argv or the
 * JSON we hand to the tool — the point of the injectable Spawner is that a
 * real `mutagen` binary is never needed to prove we call it correctly.
 */

/** A fake Spawner that records every request and replays canned results. */
function fakeSpawner(results: Record<string, RunResult> = {}) {
	const calls: SpawnRequest[] = [];
	const spawner = (request: SpawnRequest): Promise<RunResult> => {
		calls.push(request);
		const joined = `${request.file} ${request.args.join(" ")}`;
		for (const [prefix, result] of Object.entries(results)) {
			if (joined.startsWith(prefix)) return Promise.resolve(result);
		}
		return Promise.resolve({ code: 0, stdout: "", stderr: "" });
	};
	return { spawner, calls };
}

const IGNORE = ["sessions", "cache", "auth.json"];

function configWithUser(ignore: string[]): DriveConfig {
	const config = structuredClone(DEFAULT_CONFIG) as DriveConfig;
	config.sync.claude.ignore = ignore;
	return config;
}

describe("createArgs", () => {
	it("emits exactly the flags the operator's hand-run sessions use", () => {
		const args = createArgs(
			"hyper-claude-netcup",
			"/Users/s/a/.claude",
			"netcup:/Users/s/a/.claude",
			{
				ignore: IGNORE,
				symlinkMode: "posix-raw",
				betaFileMode: "0660",
				betaDirMode: "0770",
				mode: "two-way-resolved",
			},
		);
		expect(args).toEqual([
			"sync",
			"create",
			"--name",
			"hyper-claude-netcup",
			"--mode=two-way-resolved",
			"--symlink-mode=posix-raw",
			"--default-file-mode-beta=0660",
			"--default-directory-mode-beta=0770",
			"--ignore",
			"sessions",
			"--ignore",
			"cache",
			"--ignore",
			"auth.json",
			"/Users/s/a/.claude",
			"netcup:/Users/s/a/.claude",
		]);
	});

	it("passes one --ignore per pattern, in list order, and no shell", () => {
		const args = createArgs("n", "a", "b", {
			ignore: [".claude.json*", "a b", "x*y"],
			symlinkMode: "posix-raw",
			betaFileMode: "0660",
			betaDirMode: "0770",
			mode: "two-way-resolved",
		});
		// Each pattern is its own argv element — a glob or space can never be
		// re-split by a shell.
		const ignores = args.filter((_, i) => args[i - 1] === "--ignore");
		expect(ignores).toEqual([".claude.json*", "a b", "x*y"]);
	});
});

describe("create through the engine", () => {
	it("spawns `mutagen sync create` with the exact argv", async () => {
		const { spawner, calls } = fakeSpawner();
		const engine = new MutagenSyncEngine(spawner);
		await engine.create("hyper-pi-loop", "/home/me/.pi/agent", "loop:/home/me/.pi/agent", {
			ignore: IGNORE,
			symlinkMode: "posix-raw",
			betaFileMode: "0660",
			betaDirMode: "0770",
			mode: "two-way-resolved",
		});
		expect(calls).toHaveLength(1);
		// The whole argv, not just the first two words: this is the assertion
		// that the engine is called exactly as the operator's hand-run sessions
		// were, so a future edit to the flag list fails here rather than in prod.
		expect(calls[0]).toEqual({
			file: "mutagen",
			args: [
				"sync",
				"create",
				"--name",
				"hyper-pi-loop",
				"--mode=two-way-resolved",
				"--symlink-mode=posix-raw",
				"--default-file-mode-beta=0660",
				"--default-directory-mode-beta=0770",
				"--ignore",
				"sessions",
				"--ignore",
				"cache",
				"--ignore",
				"auth.json",
				"/home/me/.pi/agent",
				"loop:/home/me/.pi/agent",
			],
			stdin: undefined,
			cwd: undefined,
			tty: undefined,
			env: undefined,
		});
	});
});

describe("list parsing", () => {
	it("parses a real captured `mutagen sync list --template '{{json .}}'`", async () => {
		const fixture = join(import.meta.dirname, "fixtures", "mutagen-sync-list.json");
		expect(existsSync(fixture)).toBe(true);
		const stdout = readFileSync(fixture, "utf-8");
		const sessions = parseSessionList(stdout);

		// The captured output is the operator's real sessions (read-only capture).
		expect(sessions.length).toBe(2);
		const [claude, pi] = sessions;
		expect(claude.name).toBe("claude-config");
		// A local alpha is a bare path; an ssh beta is host:path.
		expect(claude.alpha.startsWith("/")).toBe(true);
		expect(claude.beta).toMatch(/^[^:]+:\//);
		expect(claude.mode).toBe("two-way-resolved");
		expect(claude.ignore.length).toBeGreaterThan(0);
		expect(pi.name).toBe("pi-config");
	});

	it("reports an empty list for an empty array", () => {
		expect(parseSessionList("[]")).toEqual([]);
	});

	it("throws a friendly error on unparsable output, not an empty list", () => {
		expect(() => parseSessionList("not json")).toThrow(/couldn't read/i);
		expect(() => parseSessionList('{"sessions":[]}')).toThrow(/isn't a list/i);
	});

	it("reads status, mode and ignore off a session", () => {
		const stdout = readFileSync(
			join(import.meta.dirname, "fixtures", "mutagen-sync-list.json"),
			"utf-8",
		);
		const [claude] = parseSessionList(stdout);
		expect(typeof claude.status).toBe("string");
		expect(claude.status.length).toBeGreaterThan(0);
		expect(typeof claude.alphaConnected).toBe("boolean");
		expect(claude.alpha).not.toBe("");
		expect(claude.beta).not.toBe("");
	});
});

describe("endpoint URL reconstruction", () => {
	/** Build a session list payload with one ssh beta, however it's spelled. */
	const listWithBeta = (beta: Record<string, unknown>): string =>
		JSON.stringify([
			{
				name: "hyper-claude-loop",
				alpha: { protocol: "local", path: "/a/.claude", connected: true },
				beta: { protocol: "ssh", path: "/r/.claude", connected: true, ...beta },
				status: "watching",
				mode: "two-way-resolved",
				ignore: { paths: [] },
				paused: false,
			},
		]);

	it("keeps the ssh user from a Herdr `user@host` target", () => {
		// Verified against mutagen 0.18.1: `user` is a field of its own, not
		// part of `host`. Dropping it makes --check mismatch forever.
		expect(parseSessionList(listWithBeta({ host: "localhost", user: "me" }))[0].beta).toBe(
			"me@localhost:/r/.claude",
		);
	});

	it("keeps an explicit port, with the colon Mutagen puts after it", () => {
		// Verified by creating throwaway sessions: `host:2222/path` (no colon
		// after the port) is parsed by mutagen as a PATH of "2222/path" with no
		// port set, so the colon is load-bearing.
		expect(
			parseSessionList(listWithBeta({ host: "localhost", user: "me", port: 2222 }))[0].beta,
		).toBe("me@localhost:2222:/r/.claude");
	});

	it("keeps a port with no user", () => {
		expect(parseSessionList(listWithBeta({ host: "h", port: 2222 }))[0].beta).toBe(
			"h:2222:/r/.claude",
		);
	});

	it("uses a bare host when neither user nor port is set", () => {
		expect(parseSessionList(listWithBeta({ host: "netcup" }))[0].beta).toBe("netcup:/r/.claude");
	});

	it("ignores a zero port rather than printing `:0`", () => {
		expect(parseSessionList(listWithBeta({ host: "h", port: 0 }))[0].beta).toBe("h:/r/.claude");
	});

	it("round-trips the captured real sessions unchanged", async () => {
		const stdout = readFileSync(
			join(import.meta.dirname, "fixtures", "mutagen-sync-list.json"),
			"utf-8",
		);
		// The operator's sessions use a bare host and no port, so this pins the
		// no-user/no-port spelling against real captured output.
		expect(parseSessionList(stdout).map((s) => s.beta)).toEqual([
			"netcup:/Users/svallory/.claude",
			"netcup:/Users/svallory/.pi/agent",
		]);
	});
});

describe("round trip", () => {
	/**
	 * The property that actually matters: a session hyperdrive CREATES must be
	 * recognised by the URL we RECONSTRUCT from its JSON, or --check reports a
	 * permanent mismatch against a session we just made.
	 *
	 * Before, a target with a port broke exactly here — the create argv used
	 * `host:port:path` while the parser rebuilt `host:portpath`.
	 */
	for (const [label, host, beta, expected] of [
		["bare host", "netcup", "netcup:/r/.claude", "netcup:/r/.claude"],
		["user@host", "me@host", "me@host:/r/.claude", "me@host:/r/.claude"],
		["user@host:port", "me@host:2222", "me@host:2222:/r/.claude", "me@host:2222:/r/.claude"],
	] as const) {
		it(`reconstructs the URL it created (${label})`, () => {
			const { spawner, calls } = fakeSpawner();
			const engine = new MutagenSyncEngine(spawner);
			void engine.create("hyper-claude-x", "/l/.claude", beta, {
				ignore: [],
				symlinkMode: "posix-raw",
				betaFileMode: "0660",
				betaDirMode: "0770",
				mode: "two-way-resolved",
			});
			// The URL hyperdrive asked for.
			expect(calls[0].args.at(-1)).toBe(beta);

			// The JSON mutagen would report for it: the URL split back into
			// its fields, which is what endpointUrl sees.
			const url = {
				netcup: { protocol: "ssh", host: "netcup", path: "/r/.claude" },
				"me@host": { protocol: "ssh", user: "me", host: "host", path: "/r/.claude" },
				"me@host:2222": {
					protocol: "ssh",
					user: "me",
					host: "host",
					port: 2222,
					path: "/r/.claude",
				},
			}[host];
			const list = JSON.stringify([
				{
					name: "hyper-claude-x",
					alpha: { protocol: "local", path: "/l/.claude", connected: true },
					beta: { ...url, connected: true },
					status: "watching",
					mode: "two-way-resolved",
					ignore: { paths: [] },
					paused: false,
				},
			]);
			expect(parseSessionList(list)[0].beta).toBe(expected);
		});
	}
});

describe("daemonReady", () => {
	it("probes with MUTAGEN_DISABLE_AUTOSTART so a stopped daemon reads as stopped", async () => {
		const { spawner, calls } = fakeSpawner({
			"mutagen sync list": { code: 0, stdout: "[]", stderr: "" },
		});
		await new MutagenSyncEngine(spawner).daemonReady();
		expect(calls).toHaveLength(1);
		// Without this the CLI autostarts the daemon and "running" is always yes.
		expect(calls[0].env).toEqual({ MUTAGEN_DISABLE_AUTOSTART: "1" });
	});

	it("asks the engine once for liveness and the session list together", async () => {
		const { spawner, calls } = fakeSpawner({
			"mutagen sync list": { code: 0, stdout: "[]", stderr: "" },
		});
		const probe = await new MutagenSyncEngine(spawner).probe();
		expect(probe.daemon.running).toBe(true);
		expect(probe.sessions).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("reports not-running and no sessions when the daemon is down", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": {
				code: 1,
				stdout: "",
				stderr: "unable to autostart daemon: connection refused",
			},
		});
		const probe = await new MutagenSyncEngine(spawner).probe();
		expect(probe.daemon.running).toBe(false);
		expect(probe.sessions).toEqual([]);
	});

	it("rethrows a parse failure instead of reporting a stopped daemon", async () => {
		const { spawner } = fakeSpawner({
			// Exit 0 with output we cannot understand: not a daemon problem.
			"mutagen sync list": { code: 0, stdout: "not json at all", stderr: "" },
		});
		await expect(new MutagenSyncEngine(spawner).probe()).rejects.toThrow(/couldn't read/i);
	});

	it("rethrows a non-daemon failure instead of advising `daemon start`", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": { code: 1, stdout: "", stderr: "permission denied" },
		});
		// "run mutagen daemon start" cannot fix a permission problem, so it must
		// not be the advice.
		await expect(new MutagenSyncEngine(spawner).probe()).rejects.toThrow(/permission denied/);
	});

	it("reports not-running only for a daemon-unreachable failure", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": {
				code: 1,
				stdout: "",
				stderr: "unable to autostart daemon: connection refused",
			},
		});
		const probe = await new MutagenSyncEngine(spawner).probe();
		expect(probe.daemon.running).toBe(false);
		expect(probe.sessions).toEqual([]);
	});

	it("is running when `sync list` succeeds", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": { code: 0, stdout: "[]", stderr: "" },
		});
		const state = await new MutagenSyncEngine(spawner).daemonReady();
		expect(state.running).toBe(true);
		expect(typeof state.registered).toBe("boolean");
	});

	it("is not running when the daemon is genuinely unreachable", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": {
				code: 1,
				stdout: "",
				stderr: "unable to autostart daemon: connection refused",
			},
		});
		const state = await new MutagenSyncEngine(spawner).daemonReady();
		expect(state.running).toBe(false);
	});

	it("rethrows a missing binary instead of reporting the daemon as merely stopped", async () => {
		const spawner = () => {
			const err = new Error("spawn mutagen ENOENT") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			return Promise.reject(err);
		};
		// The two are different facts and need different messages: "the daemon is
		// down" is a hint, "the engine is not installed" is the only thing the
		// user can act on. Swallowing it would print a cheerful exit 0.
		await expect(new MutagenSyncEngine(spawner).daemonReady()).rejects.toThrow(
			/mutagen is not installed/,
		);
		await expect(new MutagenSyncEngine(spawner).probe()).rejects.toThrow(
			/mutagen is not installed/,
		);
	});

	it("reports the daemon as stopped when sync list fails for any other reason", async () => {
		const { spawner } = fakeSpawner({
			"mutagen sync list": {
				code: 1,
				stdout: "",
				stderr: "unable to autostart daemon: connection refused",
			},
		});
		const state = await new MutagenSyncEngine(spawner).daemonReady();
		expect(state.running).toBe(false);
	});

	it("matches the documented registration-file check for this platform", () => {
		const home = homedir();
		const expected =
			platform() === "darwin"
				? existsSync(join(home, "Library/LaunchAgents/io.mutagen.mutagen.plist"))
				: platform() === "linux"
					? existsSync(join(home, ".config/systemd/user/mutagen.service"))
					: false;
		expect(daemonRegistered()).toBe(expected);
	});
});

describe("missing binary", () => {
	it("says how to install it", async () => {
		const spawner = () => {
			const err = new Error("spawn mutagen ENOENT") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			return Promise.reject(err);
		};
		await expect(new MutagenSyncEngine(spawner).list()).rejects.toThrow(
			/mutagen is not installed.*hyper machine setup/s,
		);
	});

	it("keeps a non-ENOENT failure distinct from a missing install", async () => {
		const spawner = () => {
			const err = new Error("spawn mutagen EACCES") as NodeJS.ErrnoException;
			err.code = "EACCES";
			return Promise.reject(err);
		};
		await expect(new MutagenSyncEngine(spawner).list()).rejects.toThrow(/couldn't run.*EACCES/i);
	});

	it("carries a message-only stack so oclif never dumps JS frames", async () => {
		const spawner = () => {
			const err = new Error("spawn mutagen ENOENT") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			return Promise.reject(err);
		};
		try {
			await new MutagenSyncEngine(spawner).list();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as Error).stack).toBe((err as Error).message);
			expect((err as Error).stack ?? "").not.toContain("\n    at ");
		}
	});
});

describe("syncIgnoreFor", () => {
	it("matches the ignore list the LIVE sessions store, exactly", async () => {
		// Read from the capture rather than a second copy of it: if the packaged
		// list and the engine's own storage ever diverge, this fails. The leading
		// `/` is part of the pattern (it anchors to the sync root), so an
		// unanchored `sessions` would also swallow `skills/debug/` and friends.
		const stdout = readFileSync(
			join(import.meta.dirname, "fixtures", "mutagen-sync-list.json"),
			"utf-8",
		);
		const [claude, pi] = parseSessionList(stdout);
		expect(CLAUDE_SYNC_IGNORE).toEqual(claude.ignore);
		expect(PI_SYNC_IGNORE).toEqual(pi.ignore);
		expect(CLAUDE_SYNC_IGNORE).toHaveLength(31);
		expect(PI_SYNC_IGNORE).toHaveLength(4);
	});

	it("anchors every packaged pattern at the sync root but .DS_Store", () => {
		// `.DS_Store` is the one deliberately unanchored entry — it matches the
		// live session, and the OS drops it at every level.
		const bare = [...CLAUDE_SYNC_IGNORE, ...PI_SYNC_IGNORE].filter((p) => !p.startsWith("/"));
		expect(bare).toEqual([".DS_Store", ".DS_Store"]);
	});

	it("returns the packaged list when the user adds nothing", () => {
		const ignore = syncIgnoreFor("claude", configWithUser([]));
		expect(ignore).toContain("/.credentials.json");
		expect(ignore).toContain("/sessions");
		expect(ignore).not.toContain("/auth.json");
	});

	it("appends the user's patterns after the packaged ones", () => {
		const ignore = syncIgnoreFor("claude", configWithUser(["my-scratch", "notes.md"]));
		expect(ignore.slice(-2)).toEqual(["my-scratch", "notes.md"]);
	});

	it("de-duplicates, keeping the first (packaged) occurrence", () => {
		const ignore = syncIgnoreFor("claude", configWithUser(["sessions", "new-thing", "sessions"]));
		expect(ignore.filter((p) => p === "sessions")).toHaveLength(1);
		expect(ignore.filter((p) => p === "new-thing")).toHaveLength(1);
	});

	it("has a distinct, credential-safe packaged list for pi", () => {
		expect(syncIgnoreFor("pi", configWithUser([]))).toEqual([
			"/auth.json",
			"/install",
			"/bin",
			".DS_Store",
		]);
	});
});

describe("session name rule (verified against mutagen 0.18.1)", () => {
	// Probed with throwaway sessions: first char must be a Unicode letter;
	// after that, letters, digits and `-` only. Digits/`_`/`.`/space are
	// rejected as the first char; `_` and `.` are rejected anywhere.
	it("accepts the shapes mutagen accepts", () => {
		for (const ok of ["a", "loop", "netcup", "a-b", "a9", "a--b", "éx", "A-9"]) {
			expect(sessionNameProblem(ok), ok).toBeNull();
		}
	});

	it("rejects the shapes mutagen rejects", () => {
		for (const bad of [
			"",
			"9abc",
			"-a",
			"_a",
			".a",
			"a b",
			"a:b",
			"a/b",
			"a_b",
			"a.b",
			"name!",
			"a,b",
		]) {
			expect(sessionNameProblem(bad), bad).not.toBeNull();
		}
	});
});
