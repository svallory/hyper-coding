import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	skipWithoutScript,
	spawnCli,
	spawnCliOnTty,
	withFakeForge,
	withManifestFixture,
} from "#tests/tmp-manifest";

let fixture: ManifestFixture;

type Forge = ReturnType<typeof withFakeForge>;

/**
 * Setup looks for gh and glab, and the real ones would reach a real account
 * and network. Every spawn goes through these two wrappers, which refuse to
 * run unless the fake forge is first on PATH.
 */
function guard(forge: Forge): void {
	if (!forge.env.PATH?.startsWith(`${forge.bin}:`)) {
		throw new Error("setup test would use the real gh/glab: pass a withFakeForge() env");
	}
}

function runSetup(args: string[], forge: Forge, extraEnv: NodeJS.ProcessEnv = {}) {
	guard(forge);
	return spawnCli(args, fixture, { ...forge.env, ...extraEnv });
}

function runSetupOnTty(args: string[], forge: Forge, answers: string[]) {
	guard(forge);
	return spawnCliOnTty(args, fixture, answers, forge.env);
}

const calls = (forge: Forge): string =>
	existsSync(forge.ghLog) ? readFileSync(forge.ghLog, "utf8") : "";

beforeEach(() => {
	isolateGitConfig();
	fixture = withManifestFixture();
});

afterEach(() => {
	fixture.cleanup();
});

describe("hyper drive setup", () => {
	it("still answers to the old name `drive init`", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const result = runSetup(
			["drive", "init", "--remote", fixture.remote, "--name", "mac", "--home", "/tmp/h"],
			withFakeForge(fixture, null),
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(flat(result.stdout)).toContain("Next steps:");
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).self.name).toBe("mac");
	});

	it("never asks for the home directory", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		// Two answers only: remote and machine name. A third prompt would wait
		// for input that never comes and the 60 s guard would fail the test.
		const result = runSetupOnTty(["drive", "setup"], withFakeForge(fixture, null), [
			fixture.remote,
			"",
		]);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(flat(result.stdout)).not.toContain("home directory");
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).self.home).toBe(fixture.home);
	});

	it("offers the logged-in user's hyperdrive as the default remote and creates it", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		// Enter on the remote (takes the default), Enter on the name, "y" to
		// create the repository that does not exist yet.
		const result = runSetupOnTty(["drive", "setup"], forge, ["", "", "y"]);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		const out = flat(result.stdout).replace(/\s+/g, "");
		expect(out).toContain("Loggedintogithub.comasada(gh)");
		expect(out).toContain("Createitasaprivaterepositorywithgh");
		expect(calls(forge)).toContain("repo create ada/hyperdrive --private");
		const config = parseTOML(readFileSync(fixture.configFile, "utf-8"));
		expect(config.remote).toBe("git@github.com:ada/hyperdrive.git");
		expect(existsSync(join(forge.forgeRoot, "ada", "hyperdrive.git", "HEAD"))).toBe(true);
		expect(existsSync(join(fixture.hyperHome, "drive", ".git"))).toBe(true);
		expect(
			git(
				["--git-dir", join(forge.forgeRoot, "ada", "hyperdrive.git"), "log", "--oneline", "main"],
				fixture.root,
			),
		).toContain("manifest: initialise hyperdrive");
	});

	it("declining the offer to create leaves the repository uncreated and no config", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetupOnTty(["drive", "setup"], forge, ["ada/drive", "", "n"]);
		// The tty wrapper's status file lives in the config dir, which setup never
		// made here, so only "failed" is observable; the message proves why.
		expect(result.status).not.toBe(0);
		expect(flat(result.stdout)).toContain("I couldn't reach your hyperdrive");
		expect(calls(forge)).not.toContain("repo create");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("expands owner/name and creates it with --create off a terminal", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).remote).toBe(
			"git@github.com:ada/drive.git",
		);
		expect(calls(forge)).toContain("repo create ada/drive --private");
	});

	it("expands a bare name under the logged-in account, not as a relative path", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(
			["drive", "setup", "--remote", "hyperdrive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(calls(forge)).toContain("api user");
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).remote).toBe(
			"git@github.com:ada/hyperdrive.git",
		);
	});

	it("refuses a bare name when nobody is logged in, writing nothing", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// A directory that would resolve if the name were used as a path.
		mkdirSync(join(fixture.root, "hyperdrive"), { recursive: true });
		const forge = withFakeForge(fixture, null);
		const result = runSetup(["drive", "setup", "--remote", "hyperdrive", "--name", "mac"], forge);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("owner/name");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("expands owner/name onto gitlab when only glab is logged in, and creates there", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, null, { glabLogin: "ada" });
		const result = runSetup(
			["drive", "setup", "--remote", "team/drive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).remote).toBe(
			"git@gitlab.com:team/drive.git",
		);
		const log = calls(forge);
		expect(log).toContain("glab repo create drive --private --group team --skipGitInit");
		expect(log).not.toContain("gh repo create");
	});

	it("runs the forge CLIs from a neutral directory, never the current one", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		const neutral = realpathSync(tmpdir());
		const cwds = [...calls(forge).matchAll(/cwd=(\S*)\]/g)].map((m) => m[1]);
		expect(cwds.length).toBeGreaterThan(0);
		for (const cwd of cwds) expect(cwd).toBe(neutral);
	});

	it("creates on the remote's own host, not the CLI's default", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(
			["drive", "setup", "--remote", "git@ghe.corp:ada/drive.git", "--name", "mac", "--create"],
			forge,
			{ GH_HOST: "ghe.corp" },
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(calls(forge)).toMatch(/gh repo create ada\/drive --private \[GH_HOST=ghe\.corp /);
	});

	it("follows the forge CLI's https protocol when expanding", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada", { https: true });
		const result = runSetup(
			["drive", "setup", "--remote", "hyperdrive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).remote).toBe(
			"https://github.com/ada/hyperdrive.git",
		);
	});

	it("refuses to create off a terminal without --create, naming the flag", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(["drive", "setup", "--remote", "ada/drive", "--name", "mac"], forge);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("--create");
		expect(existsSync(fixture.configFile)).toBe(false);
		expect(calls(forge)).not.toContain("repo create");
	});

	it("reports a failed creation with the CLI's own words and writes no config", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = runSetup(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			forge,
			{ CREATE_FAILS: "1" },
		);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("could not create the repository: boom");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("does not create anything when the repository already exists", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		git(["init", "--bare", join(forge.forgeRoot, "ada", "drive.git")], fixture.root);
		const result = runSetup(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(calls(forge)).not.toContain("repo create");
	});

	it("shows git's error and does not offer to create a repository that exists but is unreachable", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		// The forge knows it, git cannot read it: an access problem, not a missing repo.
		mkdirSync(join(forge.forgeRoot, "ada", "drive.git"), { recursive: true });
		const result = runSetup(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status).toBe(2);
		const said = flat(result.stderr);
		expect(said).toContain("git said:");
		expect(said).toContain("exists");
		expect(calls(forge)).not.toContain("repo create");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("fails on a checkout of another remote before creating anything on the forge", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const first = runSetup(
			["drive", "setup", "--remote", fixture.remote, "--name", "mac", "--home", "/tmp/h"],
			forge,
		);
		expect(first.status, flat(first.stderr)).toBe(0);
		const result = runSetup(
			["drive", "setup", "--remote", "ada/other", "--name", "mac", "--create"],
			forge,
		);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("is a clone of");
		expect(calls(forge)).not.toContain("repo create");
	});

	it("takes the remote already in the config without asking the forge who is logged in", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, `remote = "${fixture.remote}"\n`);
		const result = runSetup(["drive", "setup", "--name", "mac"], forge);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(calls(forge)).not.toContain("api user");
	});

	it("rejects an empty --home", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const result = runSetup(
			["drive", "setup", "--remote", fixture.remote, "--name", "mac", "--home", ""],
			withFakeForge(fixture, null),
		);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("--home");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("asks for every value on a TTY and accepts each default with Enter", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		// The interactive path, end to end: a pipe has no isTTY, so a piped spawn
		// would skip every prompt and prove nothing. Answer the remote (it has no
		// default) and press Enter for the machine name, which must take
		// its default rather than re-prompt forever or hang.
		const result = runSetupOnTty(["drive", "setup"], withFakeForge(fixture, null), [
			fixture.remote,
			"",
		]);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);

		const config = parseTOML(readFileSync(fixture.configFile, "utf-8"));
		expect(config.remote).toBe(fixture.remote);
		// name came from the default the prompt offered; home from the machine.
		expect(config.self.name).toBe(hostname().split(".")[0] || hostname());
		expect(config.self.home).toBe(fixture.home);
		// The prompt was really shown (not skipped), and the checkout was made.
		// clack renders the prompt over a pty with its own spacing, so compare
		// with whitespace removed rather than on the exact layout.
		expect(flat(result.stdout).replace(/\s+/g, "")).toContain(
			"Whereisyourprivatehyperdriverepository".replace(/\s+/g, ""),
		);
		expect(existsSync(join(fixture.hyperHome, "drive", ".git"))).toBe(true);
	});

	it("writes config and creates main on a bare remote; a second run is idempotent", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, null);
		const args = [
			"drive",
			"setup",
			"--remote",
			fixture.remote,
			"--name",
			"mac",
			"--home",
			"/tmp/h",
		];
		const first = runSetup(args, forge);
		expect(first.status, flat(first.stderr)).toBe(0);
		expect(first.stdout).toContain("checkout created");
		const config = parseTOML(readFileSync(fixture.configFile, "utf-8"));
		expect(config.remote).toBe(fixture.remote);
		expect(config.self).toMatchObject({ name: "mac", home: "/tmp/h" });
		expect(existsSync(join(fixture.hyperHome, "drive", "spaces.yaml"))).toBe(true);
		expect(
			git(["--git-dir", fixture.remote, "log", "main", "--format=%s"], fixture.root),
		).toContain("manifest: initialise hyperdrive");

		const second = runSetup(args, forge);
		expect(second.status, flat(second.stderr)).toBe(0);
		expect(second.stdout).toContain("checkout already exists");
		expect(
			git(["--git-dir", fixture.remote, "rev-list", "--count", "main"], fixture.root).trim(),
		).toBe("1");
	});

	it("preserves unknown existing TOML keys and sections", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(
			fixture.configFile,
			'legacy = "keep"\n[machines.other]\nhome = "/home/other"\ncustom = "keep too"\n',
		);
		const result = runSetup(
			["drive", "setup", "--remote", fixture.remote, "--name", "mac", "--home", "/tmp/h"],
			withFakeForge(fixture, null),
		);
		expect(result.status, flat(result.stderr)).toBe(0);
		const raw = readFileSync(fixture.configFile, "utf-8");
		expect(raw).toContain('legacy = "keep"');
		expect(raw).toContain('custom = "keep too"');
		expect(parseTOML(raw).remote).toBe(fixture.remote);
	});

	it("leaves no config behind when the remote cannot be reached", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// The config must not point at a hyperdrive that was never connected.
		const missing = join(fixture.root, "missing.git");
		const result = runSetup(["drive", "setup", "--remote", missing], withFakeForge(fixture, null));
		expect(result.status).not.toBe(0);
		// The URL is wrapped by oclif's renderer, so assert on the sentence
		// rather than on a path that may be broken across lines.
		expect(flat(result.stderr)).toContain("I couldn't reach your hyperdrive");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("reports the missing --remote flag without a TTY", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const result = runSetup(
			["drive", "setup", "--name", "mac", "--home", "/tmp/h"],
			withFakeForge(fixture, null),
		);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("--remote");
		expect(flat(result.stderr)).not.toContain("at Init.run");
	});
});
