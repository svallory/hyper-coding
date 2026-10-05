import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type DriveConfig, syncIgnoreFor } from "#config/schema";

/**
 * `hyper drive sync-config` driven through the real CLI, with a fake `mutagen`
 * and a fake `herdr` on PATH. The fakes are what make this a unit test: the
 * command's argv, the session names it builds and the URLs it derives are all
 * observable, without touching the operator's live Mutagen sessions or their
 * real `~/.claude`.
 *
 * Nothing here reads the operator's machine: alpha comes from `[self] home` in
 * a temp drive.toml, and beta from `[machines.loop] home` in the same file.
 */

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

/** A shell script on PATH, executable, that hyperdrive will spawn by name. */
function script(dir: string, name: string, body: string): string {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf-8");
	chmodSync(path, 0o755);
	return path;
}

const HERDR_JSON = JSON.stringify([{ label: "loop", target: "localhost", enabled: true }]);

interface Fixture {
	/** Temp dir holding the fake herdr/mutagen. */
	binDir: string;
	/** Temp drive.toml. */
	config: string;
	/** Alpha home — `[self] home`, so `~/.claude` lands under here. */
	alphaHome: string;
	/** Beta home — `[machines.loop] home`. */
	betaHome: string;
	/** File the fake mutagen appends every argv to. */
	log: string;
	/** File the fake mutagen answers `sync list` with. */
	sessions: string;
}

function setupFixture(
	sessions: unknown[] = [],
	opts: { betaHome?: string; herdrTarget?: string } = {},
): Fixture {
	const binDir = tmp("drive-sync-bin-");
	const alphaHome = tmp("drive-sync-alpha-");
	const betaHome = opts.betaHome ?? tmp("drive-sync-beta-");
	const log = join(binDir, "argv.log");
	const sessionsFile = join(binDir, "sessions.json");

	script(
		binDir,
		"herdr",
		`cat <<'JSON'\n${JSON.stringify([
			{ label: "loop", target: opts.herdrTarget ?? "localhost", enabled: true },
		])}\nJSON`,
	);

	// The fake mutagen records argv and answers `sync list` from a file the
	// test controls, so "already created" and "not created" are both reachable.
	script(
		binDir,
		"mutagen",
		[
			'printf "%s\\n" "$*" >> "$MUTAGEN_LOG"',
			'case "$1 $2" in',
			`  "sync list") cat "$MUTAGEN_SESSIONS" ;;`,
			// A forced cycle: when the test left an "after" state, it becomes current.
			`  "sync flush") [ -f "$MUTAGEN_SESSIONS.after-flush" ] && mv "$MUTAGEN_SESSIONS.after-flush" "$MUTAGEN_SESSIONS" ;;`,
			`  "sync create") name=""; while [ $# -gt 0 ]; do [ "$1" = "--name" ] && { name="$2"; break; }; shift; done;`,
			`    printf '[{"name":"%s","alpha":"/a","beta":"localhost:/b","status":"watching","mode":"two-way-resolved","ignore":{"paths":[".credentials.json"]},"paused":false}]' "$name" > "$MUTAGEN_SESSIONS" ;;`,
			"esac",
		].join("\n"),
	);

	// The fake ssh records argv and succeeds: the only thing sync-config
	// sends over ssh is the `mkdir -p` of the beta root's parent.
	script(binDir, "ssh", 'printf "%s\\n" "$*" >> "$(dirname "$0")/ssh.log"');

	writeFileSync(sessionsFile, JSON.stringify(sessions), "utf-8");

	const config = join(binDir, "drive.toml");
	writeFileSync(
		config,
		[
			'self_name = "host"',
			"",
			"[self]",
			'name = "host"',
			`home = "${alphaHome}"`,
			"",
			"[machines.loop]",
			`home = "${betaHome}"`,
			'features = ["mutagen"]',
			'agent_user = "agent"',
			"",
		].join("\n"),
		"utf-8",
	);

	return { binDir, config, alphaHome, betaHome, log, sessions: sessionsFile };
}

/** argv the fake mutagen was called with, one line per call. */
function calls(fixture: Fixture): string[] {
	try {
		return readFileSync(fixture.log, "utf-8")
			.split("\n")
			.filter((line) => line !== "");
	} catch {
		return [];
	}
}

function spawnCli(
	fixture: Fixture,
	args: string[],
	path: string[] = [fixture.binDir],
): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			HYPER_DRIVE_CONFIG: fixture.config,
			MUTAGEN_LOG: fixture.log,
			MUTAGEN_SESSIONS: fixture.sessions,
			// PATH is REPLACED, not prepended: execvp would otherwise find the
			// operator's real mutagen/herdr further down and pass the test
			// vacuously.
			PATH: [...path, "/usr/bin", "/bin"].join(":"),
		},
	});
}

// 27 is ESC, via fromCharCode so the literal holds no control character.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const flat = (s: string): string =>
	s
		.replace(ANSI_RE, "")
		.replace(/^\s*›\s*/gm, " ")
		.replace(/\s+/g, " ")
		.trim();

const cliBuilt = existsSync(join(import.meta.dirname, "..", "..", "cli", "dist"));
/** Every suite here drives the built CLI; without it there is nothing to spawn. */
const skipWithoutCli = !cliBuilt;

afterEach(() => {
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config (no machine)", () => {
	it("lists only hyper- sessions in a table and exits 0", () => {
		const fixture = setupFixture([
			{
				name: "hyper-claude-loop",
				alpha: "/a/.claude",
				beta: "localhost:/b/.claude",
				status: "watching",
				mode: "two-way-resolved",
				ignore: { paths: [] },
			},
			{
				name: "someone-elses-session",
				alpha: "/x",
				beta: "y:/z",
				status: "halted",
				mode: "two-way-resolved",
				ignore: { paths: [] },
			},
		]);

		const result = spawnCli(fixture, ["drive", "sync-config"]);
		const out = flat(result.stdout ?? "");

		expect(result.status).toBe(0);
		expect(out).toContain("NAME");
		expect(out).toContain("hyper-claude-loop");
		// Never touch or list sessions hyperdrive doesn't own.
		expect(out).not.toContain("someone-elses-session");
		expect(out).toContain("registered:");
		expect(out).toContain("running:");
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config --check", () => {
	it("exits 1 when a session is missing", () => {
		const fixture = setupFixture([]);

		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);

		expect(result.status).toBe(1);
		const out = flat(result.stdout ?? "");
		expect(out).toContain("hyper-claude-loop");
		expect(out).toContain("missing");
		expect(out).toContain("hyper-pi-loop");
		// --check never creates anything.
		expect(calls(fixture).filter((line) => line.startsWith("sync create"))).toHaveLength(0);
	});

	it("exits 0 and says ready when both sessions already match", () => {
		const fixture = setupFixture([]);
		// Pre-create both sessions with exactly what the command would create.
		const alphaClaude = `${fixture.alphaHome}/.claude`;
		const betaClaude = `localhost:${fixture.betaHome}/.claude`;
		const alphaPi = `${fixture.alphaHome}/.pi/agent`;
		const betaPi = `localhost:${fixture.betaHome}/.pi/agent`;
		writeFileSync(
			fixture.sessions,
			JSON.stringify([
				session("hyper-claude-loop", alphaClaude, betaClaude, "claude"),
				session("hyper-pi-loop", alphaPi, betaPi, "pi"),
			]),
			"utf-8",
		);

		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		const out = flat(result.stdout ?? "");

		expect(result.status).toBe(0);
		expect(out).toContain("ready");
		expect(calls(fixture).filter((line) => line.startsWith("sync create"))).toHaveLength(0);
	});

	it.each([
		[
			"a transition problem",
			{
				beta: { transitionProblems: [{ path: "", error: "unable to create root: no such file" }] },
			},
			"beta transition problem: (root): unable to create root: no such file",
		],
		[
			"a scan problem",
			{ alpha: { scanProblems: [{ path: "x", error: "permission denied" }] } },
			"alpha scan problem: x: permission denied",
		],
		["a last error", { lastError: "connection lost" }, "last error: connection lost"],
		["a halted session", { status: "halted-on-root-emptied" }, "halted (halted-on-root-emptied)"],
	])("is not ready, and names it, with %s (B3)", (_label, change, named) => {
		const fixture = setupFixture([]);
		const pi = session(
			"hyper-pi-loop",
			`${fixture.alphaHome}/.pi/agent`,
			`localhost:${fixture.betaHome}/.pi/agent`,
			"pi",
		) as Record<string, unknown>;
		const { alpha, beta, ...top } = change as Record<string, unknown>;
		Object.assign(pi, top);
		if (alpha) Object.assign(pi.alpha as object, alpha);
		if (beta) Object.assign(pi.beta as object, beta);
		writeFileSync(
			fixture.sessions,
			JSON.stringify([
				session(
					"hyper-claude-loop",
					`${fixture.alphaHome}/.claude`,
					`localhost:${fixture.betaHome}/.claude`,
					"claude",
				),
				pi,
			]),
			"utf-8",
		);
		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		expect(result.status).toBe(1);
		const out = flat(result.stdout ?? "");
		expect(out).toContain(named);
		expect(out).toMatch(/hyper-claude-loop .*ready/);
	});

	it("forces one sync cycle before calling a problem current, so a fixed one is not reported (CI on Linux)", () => {
		const fixture = setupFixture([]);
		const claude = session(
			"hyper-claude-loop",
			`${fixture.alphaHome}/.claude`,
			`localhost:${fixture.betaHome}/.claude`,
			"claude",
		);
		const pi = session(
			"hyper-pi-loop",
			`${fixture.alphaHome}/.pi/agent`,
			`localhost:${fixture.betaHome}/.pi/agent`,
			"pi",
		) as Record<string, unknown>;
		const stale = {
			...pi,
			beta: {
				...(pi.beta as object),
				transitionProblems: [{ path: "blocked/f.txt", error: "permission denied" }],
			},
		};
		writeFileSync(fixture.sessions, JSON.stringify([claude, stale]), "utf-8");
		// The cycle the check forces finds the cause fixed.
		writeFileSync(`${fixture.sessions}.after-flush`, JSON.stringify([claude, pi]), "utf-8");
		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		expect(result.status, flat(result.stdout ?? "")).toBe(0);
		expect(calls(fixture)).toContain("sync flush hyper-pi-loop");
		// The healthy claude session is never flushed.
		expect(calls(fixture)).not.toContain("sync flush hyper-claude-loop");
	});
});

/** A temp drive.toml's effective ignore list for one target. */
function wantIgnore(target: "claude" | "pi"): string[] {
	return syncIgnoreFor(target, structuredClone(DEFAULT_CONFIG) as DriveConfig);
}

/**
 * A session shaped exactly like the fake mutagen's JSON output, carrying the
 * full packaged ignore list — a stub list would (correctly) read as a mismatch.
 */
function session(name: string, alpha: string, beta: string, target: "claude" | "pi" = "claude") {
	return {
		name,
		alpha: { protocol: "local", path: alpha, connected: true },
		beta: {
			protocol: "ssh",
			host: "localhost",
			path: beta.slice("localhost:".length),
			connected: true,
			permissions: { defaultFileMode: "0660", defaultDirectoryMode: "0770" },
		},
		status: "watching",
		mode: "two-way-resolved",
		ignore: { paths: wantIgnore(target) },
		symlink: { mode: "posix-raw" },
		permissions: {},
		paused: false,
	};
}

describe.skipIf(skipWithoutCli)("hyper drive sync-config <machine> (create)", () => {
	it("creates both sessions with the right names, URLs and flags", () => {
		const fixture = setupFixture([]);

		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		const out = flat(result.stdout ?? "");

		expect(result.status).toBe(0);
		expect(out).toContain("hyper-claude-loop");
		expect(out).toContain("hyper-pi-loop");

		const creates = calls(fixture).filter((line) => line.startsWith("sync create"));
		expect(creates).toHaveLength(2);

		const [claude, pi] = creates;
		// Names, flags and URLs, all from the temp drive.toml — the operator's
		// real ~/.claude is never a factor.
		expect(claude).toContain("--name hyper-claude-loop");
		expect(claude).toContain("--mode=two-way-resolved");
		expect(claude).toContain("--symlink-mode=posix-raw");
		expect(claude).toContain("--default-file-mode-beta=0660");
		expect(claude).toContain("--default-directory-mode-beta=0770");
		expect(claude).toContain("--ignore /.credentials.json");
		expect(claude).toContain(`${fixture.alphaHome}/.claude localhost:${fixture.betaHome}/.claude`);

		expect(pi).toContain("--name hyper-pi-loop");
		expect(pi).toContain("--ignore /auth.json");
		expect(pi).toContain(`${fixture.alphaHome}/.pi/agent localhost:${fixture.betaHome}/.pi/agent`);
	});

	it("creates the beta root's missing parent through ssh before the pi session (B3)", () => {
		const fixture = setupFixture([]);
		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status, flat(result.stderr ?? "")).toBe(0);
		const ssh = readFileSync(join(fixture.binDir, "ssh.log"), "utf-8");
		// One remote command: the parent of .pi/agent. .claude's parent is the home.
		expect(ssh.split("\n").filter((line) => line.includes("mkdir"))).toHaveLength(1);
		expect(ssh).toContain(`mkdir -p -- ${fixture.betaHome}/.pi`);
	});

	it("creates the parent under the remote $HOME for a `~` home, never a literal `~`", () => {
		const fixture = setupFixture([], { betaHome: "~" });
		expect(spawnCli(fixture, ["drive", "sync-config", "loop"]).status).toBe(0);
		const ssh = readFileSync(join(fixture.binDir, "ssh.log"), "utf-8");
		expect(ssh).toContain('mkdir -p -- "$HOME/$1"');
		expect(ssh).toContain(" .pi");
	});

	it("appends the subdir for a `~` home instead of syncing the whole home", () => {
		// The blocker: `home = "~"` is legal (config/index.ts does not expand a
		// remote home), and dropping the subdir points a two-way-resolved
		// session at the entire remote home directory.
		const fixture = setupFixture([], { betaHome: "~" });

		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status).toBe(0);

		const creates = calls(fixture).filter((line) => line.startsWith("sync create"));
		expect(creates).toHaveLength(2);
		const [claude, pi] = creates;
		expect(claude).toContain("localhost:~/.claude");
		expect(pi).toContain("localhost:~/.pi/agent");
		// Never the bare home, which would sync all of it.
		for (const line of creates) expect(line).not.toMatch(/localhost:~\s*$/);
	});

	it("handles a `~/sub` home", () => {
		const fixture = setupFixture([], { betaHome: "~/svc" });
		spawnCli(fixture, ["drive", "sync-config", "loop"]);
		const creates = calls(fixture).filter((line) => line.startsWith("sync create"));
		expect(creates[0]).toContain("localhost:~/svc/.claude");
	});

	it("passes a user@host Herdr target through unchanged", () => {
		const fixture = setupFixture([], { herdrTarget: "me@localhost" });
		spawnCli(fixture, ["drive", "sync-config", "loop"]);
		const creates = calls(fixture).filter((line) => line.startsWith("sync create"));
		expect(creates[0]).toContain(`me@localhost:${fixture.betaHome}/.claude`);
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config mismatch handling", () => {
	/** A fixture whose `loop` machine already has one matching session. */
	function withSession(over: (s: Record<string, unknown>) => void): Fixture {
		const fixture = setupFixture([]);
		const alphaClaude = `${fixture.alphaHome}/.claude`;
		const betaClaude = `localhost:${fixture.betaHome}/.claude`;
		const alphaPi = `${fixture.alphaHome}/.pi/agent`;
		const betaPi = `localhost:${fixture.betaHome}/.pi/agent`;
		const claude = session("hyper-claude-loop", alphaClaude, betaClaude, "claude");
		const pi = session("hyper-pi-loop", alphaPi, betaPi, "pi");
		over(claude);
		writeFileSync(fixture.sessions, JSON.stringify([claude, pi]), "utf-8");
		return fixture;
	}

	it("--check exits 1 on a beta mismatch", () => {
		const fixture = withSession((s) => {
			s.beta = { protocol: "ssh", host: "elsewhere", path: "/other/.claude", connected: true };
		});
		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		expect(result.status).toBe(1);
		expect(flat(result.stdout ?? "")).toContain("beta is");
	});

	it("--check exits 1 on a mode mismatch", () => {
		const fixture = withSession((s) => {
			s.mode = "one-way-safe";
		});
		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		expect(result.status).toBe(1);
		expect(flat(result.stdout ?? "")).toContain("mode is");
	});

	it("--check exits 1 when the ignore list is short a packaged pattern", () => {
		const fixture = withSession((s) => {
			s.ignore = { paths: ["/sessions"] };
		});
		const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
		expect(result.status).toBe(1);
		expect(flat(result.stdout ?? "")).toContain("ignore list is missing");
	});

	it("exits non-zero on a mismatch even WITHOUT --check", () => {
		const fixture = withSession((s) => {
			s.alpha = { protocol: "local", path: "/wrong/.claude", connected: true };
		});
		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status).not.toBe(0);
		expect(flat(result.stdout ?? "")).toContain("alpha is");
	});

	it("never terminates a mismatched session — it says how", () => {
		const fixture = withSession((s) => {
			s.alpha = { protocol: "local", path: "/wrong/.claude", connected: true };
		});
		spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(calls(fixture).some((line) => line.startsWith("sync terminate"))).toBe(false);
		// The hint names the machine so the user can just copy it.
		expect(flat(spawnCli(fixture, ["drive", "sync-config", "loop"]).stdout ?? "")).toContain(
			"sync-config loop",
		);
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config without the engine binary", () => {
	it("says which tool is missing and points at machine setup", () => {
		const fixture = setupFixture([]);
		// A PATH with a fake herdr but NO mutagen anywhere: the engine binary is
		// genuinely absent, which is the case under test.
		const noEngineBin = tmp("drive-sync-noengine-");
		script(noEngineBin, "herdr", `cat <<'JSON'\n${HERDR_JSON}\nJSON`);

		const result = spawnCli(fixture, ["drive", "sync-config"], [noEngineBin]);

		expect(result.status).not.toBe(0);
		const err = flat(`${result.stdout ?? ""}${result.stderr ?? ""}`);
		expect(err).toContain("mutagen is not installed");
		expect(err).toContain("hyper machine setup");
		// Friendly means friendly: no JS frames.
		expect(err).not.toContain("at MutagenSyncEngine");
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config collision guard (MUST 2)", () => {
	/**
	 * Sessions are matched by name, but the danger is an EXISTING session under
	 * any name over the same directory pair: two two-way-resolved sessions on
	 * one alpha/beta fight over every conflicting write. The operator's live
	 * hand-made `claude-config` is exactly this shape.
	 */
	it("refuses to create beside the live claude-config session", () => {
		if (!cliBuilt) return;
		const fixture = setupFixture([]);
		const alpha = `${fixture.alphaHome}/.claude`;
		// A pre-existing session under a DIFFERENT name, same alpha+beta.
		writeFileSync(
			fixture.sessions,
			JSON.stringify([
				{
					name: "claude-config",
					alpha: { protocol: "local", path: alpha, connected: true },
					beta: {
						protocol: "ssh",
						host: "localhost",
						path: `${fixture.betaHome}/.claude`,
						connected: true,
						permissions: { defaultFileMode: "0660", defaultDirectoryMode: "0770" },
					},
					status: "watching",
					mode: "two-way-resolved",
					ignore: { paths: [] },
					symlink: { mode: "posix-raw" },
					paused: false,
				},
			]),
			"utf-8",
		);

		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		const out = flat(result.stdout ?? "");

		expect(result.status).not.toBe(0);
		expect(out).toContain("claude-config");
		expect(out).toContain("already syncs");
		// The fix hint is engine-provided (C-8): the command never hardcodes
		// the engine's name itself.
		expect(out).not.toMatch(/Terminate it first \(`mutagen/);
		// The colliding pair was NOT created. The pi pair doesn't collide (it is
		// a different alpha and beta), so it is still created — the guard is per
		// directory pair, which is the right granularity: refusing it would
		// block an unrelated, perfectly safe session.
		const creates = calls(fixture).filter((l) => l.startsWith("sync create"));
		expect(creates.filter((l) => l.includes("--name hyper-claude-loop"))).toHaveLength(0);
		expect(creates.filter((l) => l.includes("--name hyper-pi-loop"))).toHaveLength(1);
	});
});

describe.skipIf(skipWithoutCli)(
	"hyper drive sync-config symlink/permission mismatch (MUST 4)",
	() => {
		function withBroken(over: (s: Record<string, unknown>) => void) {
			const fixture = setupFixture([]);
			const claude = session(
				"hyper-claude-loop",
				`${fixture.alphaHome}/.claude`,
				`localhost:${fixture.betaHome}/.claude`,
				"claude",
			);
			const pi = session(
				"hyper-pi-loop",
				`${fixture.alphaHome}/.pi/agent`,
				`localhost:${fixture.betaHome}/.pi/agent`,
				"pi",
			);
			over(claude);
			writeFileSync(fixture.sessions, JSON.stringify([claude, pi]), "utf-8");
			return fixture;
		}

		it("rejects a session with portable symlinks", () => {
			if (!cliBuilt) return;
			const fixture = withBroken((s) => {
				s.symlink = { mode: "portable" };
			});
			const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
			expect(result.status).toBe(1);
			expect(flat(result.stdout ?? "")).toContain("symlink mode is portable");
		});

		it("rejects a session with the wrong beta file mode", () => {
			if (!cliBuilt) return;
			const fixture = withBroken((s) => {
				(s.beta as Record<string, unknown>).permissions = {
					defaultFileMode: "0644",
					defaultDirectoryMode: "0770",
				};
			});
			const result = spawnCli(fixture, ["drive", "sync-config", "loop", "--check"]);
			expect(result.status).toBe(1);
			expect(flat(result.stdout ?? "")).toContain("beta file mode is 0644");
		});
	},
);

describe.skipIf(skipWithoutCli)("hyper drive sync-config hub topology (star)", () => {
	/**
	 * A hyper-* session sharing ONLY the alpha is the star (hub) topology and
	 * must work: this Mac syncing ~/.claude to netcup and to a second machine
	 * at once. Sessions are keyed by name, so a second machine just yields
	 * different session names over the same local alpha.
	 */
	function foreignSession(name: string, alpha: string, betaPath: string) {
		return {
			name,
			alpha: { protocol: "local", path: alpha, connected: true },
			beta: {
				protocol: "ssh",
				host: "netcup",
				path: betaPath,
				connected: true,
				permissions: { defaultFileMode: "0660", defaultDirectoryMode: "0770" },
			},
			status: "watching",
			mode: "two-way-resolved",
			ignore: { paths: [] },
			symlink: { mode: "posix-raw" },
			paused: false,
		};
	}

	it("creates next to another hyper-* session over the same alpha (star)", () => {
		if (!cliBuilt) return;
		const fixture = setupFixture([]);
		const alpha = `${fixture.alphaHome}/.claude`;
		// Another managed session for a DIFFERENT machine, same local alpha.
		writeFileSync(
			fixture.sessions,
			JSON.stringify([foreignSession("hyper-claude-netcup", alpha, "/home/svallory/.claude")]),
			"utf-8",
		);
		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status).toBe(0);
		const creates = calls(fixture).filter((l) => l.startsWith("sync create"));
		expect(creates.filter((l) => l.includes("--name hyper-claude-loop"))).toHaveLength(1);
	});

	it("refuses a foreign session sharing the same alpha", () => {
		if (!cliBuilt) return;
		const fixture = setupFixture([]);
		const alpha = `${fixture.alphaHome}/.claude`;
		writeFileSync(
			fixture.sessions,
			JSON.stringify([foreignSession("claude-config", alpha, "/home/svallory/.claude")]),
			"utf-8",
		);
		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status).not.toBe(0);
		expect(flat(result.stdout ?? "")).toContain("claude-config");
		expect(calls(fixture).filter((l) => l.includes("--name hyper-claude-loop"))).toHaveLength(0);
	});

	it("refuses a session over the exact same pair even when it is hyper-*", () => {
		if (!cliBuilt) return;
		const fixture = setupFixture([]);
		const alpha = `${fixture.alphaHome}/.claude`;
		const betaPath = `${fixture.betaHome}/.claude`;
		writeFileSync(
			fixture.sessions,
			JSON.stringify(
				[
					foreignSession("hyper-claude-oldname", alpha, betaPath).beta && {
						name: "hyper-claude-oldname",
						alpha: { protocol: "local", path: alpha, connected: true },
						beta: {
							protocol: "ssh",
							host: "localhost",
							path: betaPath,
							connected: true,
							permissions: { defaultFileMode: "0660", defaultDirectoryMode: "0770" },
						},
						status: "watching",
						mode: "two-way-resolved",
						ignore: { paths: [] },
						symlink: { mode: "posix-raw" },
						paused: false,
					},
				].filter(Boolean),
			),
			"utf-8",
		);
		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		expect(result.status).not.toBe(0);
		expect(flat(result.stdout ?? "")).toContain("hyper-claude-oldname");
		expect(calls(fixture).filter((l) => l.includes("--name hyper-claude-loop"))).toHaveLength(0);
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config partial create", () => {
	/**
	 * When the create of one session fails, the command must still report the
	 * rows it decided, exit 2, and print the REAL count — a "0 of 1 missing"
	 * message after a failure would be worse than none.
	 */
	it("keeps decided rows, exits 2, and reports the real count on a create failure", () => {
		if (!cliBuilt) return;
		const fixture = setupFixture([]);
		// Make ONLY the claude create fail: the fake mutagen fails when the
		// session name is the claude one.
		const dir = fixture.binDir;
		writeFileSync(
			join(dir, "mutagen"),
			[
				"#!/bin/sh",
				'printf "%s\\n" "$*" >> "$MUTAGEN_LOG"',
				'case "$1 $2" in',
				'  "sync list") cat "$MUTAGEN_SESSIONS" ;;',
				'  "sync create")',
				"    while [ $# -gt 0 ]; do",
				'      if [ "$1" = "--name" ] && [ "$2" = "hyper-claude-loop" ]; then',
				'        echo "boom" >&2; exit 1',
				"      fi",
				"      shift",
				"    done",
				'    printf "[]" > "$MUTAGEN_SESSIONS" ;;',
				"esac",
			].join("\n"),
			"utf-8",
		);
		chmodSync(join(dir, "mutagen"), 0o755);

		const result = spawnCli(fixture, ["drive", "sync-config", "loop"]);
		const out = flat(`${result.stdout ?? ""} ${result.stderr ?? ""}`);

		expect(result.status).toBe(2);
		// The failed row is reported with its detail...
		expect(out).toContain("hyper-claude-loop");
		expect(out).toContain("could not create");
		// ...and the count reflects what was actually decided (1 row), not a
		// stale zero — the round-4 bug this test pins.
		expect(out).toContain("1 of 1");
	});
});

describe.skipIf(skipWithoutCli)("hyper drive sync-config session naming", () => {
	/**
	 * The session name is always `hyper-<target>-<machine>`, so it starts with
	 * a letter even when the machine name doesn't. A machine called `1box`
	 * yields the valid `hyper-claude-1box`; validating the machine name instead
	 * would have wrongly refused it.
	 */
	it("accepts a machine whose name starts with a digit", () => {
		if (!cliBuilt) return;
		const binDir = tmp("drive-sync-digit-");
		const alphaHome = tmp("drive-sync-alpha-");
		const betaHome = tmp("drive-sync-beta-");
		const log = join(binDir, "argv.log");
		const sessionsFile = join(binDir, "sessions.json");
		script(
			binDir,
			"herdr",
			`cat <<'JSON'
[{"label":"1box","target":"localhost","enabled":true}]
JSON`,
		);
		script(
			binDir,
			"mutagen",
			[
				'printf "%s\n" "$*" >> "$MUTAGEN_LOG"',
				'case "$1 $2" in',
				`  "sync list") cat "$MUTAGEN_SESSIONS" ;;`,
				"esac",
			].join("\n"),
		);
		// A create sends one `mkdir -p` of the beta root's parent over ssh. A
		// fake on this PATH, never the real /usr/bin/ssh: without it the test
		// opened a real ssh hop to localhost (and failed where no sshd runs).
		script(binDir, "ssh", 'printf "%s\\n" "$*" >> "$(dirname "$0")/ssh.log"');
		writeFileSync(sessionsFile, "[]", "utf-8");
		const config = join(binDir, "drive.toml");
		writeFileSync(
			config,
			[
				"[self]",
				'name = "host"',
				`home = "${alphaHome}"`,
				"",
				"[machines.1box]",
				`home = "${betaHome}"`,
				"",
			].join("\n"),
			"utf-8",
		);
		const saved = process.env.HYPER_DRIVE_CONFIG;
		process.env.HYPER_DRIVE_CONFIG = config;
		try {
			const result = spawnSync(
				process.execPath,
				[
					join(import.meta.dirname, "..", "..", "cli", "bin", "run.js"),
					"drive",
					"sync-config",
					"1box",
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						NO_COLOR: "1",
						FORCE_COLOR: "0",
						HYPER_DRIVE_CONFIG: config,
						MUTAGEN_LOG: log,
						MUTAGEN_SESSIONS: sessionsFile,
						PATH: [binDir, "/usr/bin", "/bin"].join(":"),
					},
				},
			);
			expect(result.status).toBe(0);
			const creates = readFileSync(log, "utf-8")
				.split("\n")
				.filter((l) => l.includes("sync create"));
			expect(creates.filter((l) => l.includes("--name hyper-claude-1box"))).toHaveLength(1);
			expect(readFileSync(join(binDir, "ssh.log"), "utf-8")).toContain(
				`mkdir -p -- ${betaHome}/.pi`,
			);
		} finally {
			if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
			else process.env.HYPER_DRIVE_CONFIG = saved;
		}
	});
});
