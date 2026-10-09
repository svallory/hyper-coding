import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
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
		const result = spawnCli(
			["drive", "init", "--remote", fixture.remote, "--name", "mac", "--home", "/tmp/h"],
			fixture,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(flat(result.stdout)).toContain("Next steps:");
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).self.name).toBe("mac");
	});

	it("never asks for the home directory", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		// Two answers only: remote and machine name. A third prompt would wait
		// for input that never comes and the 60 s guard would fail the test.
		const result = spawnCliOnTty(["drive", "setup"], fixture, [fixture.remote, ""]);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(flat(result.stdout)).not.toContain("home directory");
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).self.home).toBe(fixture.home);
	});

	it("offers the logged-in user's hyperdrive as the default remote and creates it", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		// Enter on the remote (takes the default), Enter on the name, "y" to
		// create the repository that does not exist yet.
		const result = spawnCliOnTty(["drive", "setup"], fixture, ["", "", "y"], forge.env);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		const out = flat(result.stdout).replace(/\s+/g, "");
		expect(out).toContain("Loggedintogithub.comasada(gh)");
		expect(out).toContain("Createitasaprivaterepositorywithgh");
		expect(readFileSync(forge.ghLog, "utf8")).toContain("repo create ada/hyperdrive --private");
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

	it("expands owner/name and creates it with --create off a terminal", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = spawnCli(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			fixture,
			forge.env,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(parseTOML(readFileSync(fixture.configFile, "utf-8")).remote).toBe(
			"git@github.com:ada/drive.git",
		);
		expect(readFileSync(forge.ghLog, "utf8")).toContain("repo create ada/drive --private");
		// The remote on the flag never needs a default, so the forge is not asked who is logged in.
		expect(readFileSync(forge.ghLog, "utf8")).not.toContain("api user");
	});

	it("refuses to create off a terminal without --create, naming the flag", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		const result = spawnCli(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac"],
			fixture,
			forge.env,
		);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("--create");
		expect(existsSync(fixture.configFile)).toBe(false);
		expect(readFileSync(forge.ghLog, "utf8")).not.toContain("repo create");
	});

	it("does not create anything when the repository already exists", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const forge = withFakeForge(fixture, "ada");
		git(["init", "--bare", join(forge.forgeRoot, "ada", "drive.git")], fixture.root);
		const result = spawnCli(
			["drive", "setup", "--remote", "ada/drive", "--name", "mac", "--create"],
			fixture,
			forge.env,
		);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
		expect(readFileSync(forge.ghLog, "utf8")).not.toContain("repo create");
	});

	it("asks for every value on a TTY and accepts each default with Enter", (ctx) => {
		if (skipIfUnbuilt(ctx) || skipWithoutScript(ctx)) return;
		// The interactive path, end to end: a pipe has no isTTY, so a piped spawn
		// would skip every prompt and prove nothing. Answer the remote (it has no
		// default) and press Enter for the machine name and home, which must take
		// their defaults rather than re-prompt forever or hang.
		const result = spawnCliOnTty(["drive", "setup"], fixture, [fixture.remote, ""]);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);

		const config = parseTOML(readFileSync(fixture.configFile, "utf-8"));
		expect(config.remote).toBe(fixture.remote);
		// name/home came from the defaults the prompt offered.
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
		const first = spawnCli(args, fixture);
		expect(first.status, flat(first.stderr)).toBe(0);
		expect(first.stdout).toContain("checkout created");
		const config = parseTOML(readFileSync(fixture.configFile, "utf-8"));
		expect(config.remote).toBe(fixture.remote);
		expect(config.self).toMatchObject({ name: "mac", home: "/tmp/h" });
		expect(existsSync(join(fixture.hyperHome, "drive", "spaces.yaml"))).toBe(true);
		expect(
			git(["--git-dir", fixture.remote, "log", "main", "--format=%s"], fixture.root),
		).toContain("manifest: initialise hyperdrive");

		const second = spawnCli(args, fixture);
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
		const result = spawnCli(
			["drive", "setup", "--remote", fixture.remote, "--name", "mac", "--home", "/tmp/h"],
			fixture,
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
		const result = spawnCli(["drive", "setup", "--remote", missing], fixture);
		expect(result.status).not.toBe(0);
		// The URL is wrapped by oclif's renderer, so assert on the sentence
		// rather than on a path that may be broken across lines.
		expect(flat(result.stderr)).toContain("I couldn't reach your hyperdrive");
		expect(existsSync(fixture.configFile)).toBe(false);
	});

	it("reports the missing --remote flag without a TTY", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const result = spawnCli(["drive", "setup", "--name", "mac", "--home", "/tmp/h"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("--remote");
		expect(flat(result.stderr)).not.toContain("at Init.run");
	});
});
