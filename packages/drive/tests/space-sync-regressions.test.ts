import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

let fixture: ManifestFixture;
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
});
afterEach(() => fixture.cleanup());
function space(): string {
	const root = join(fixture.root, "regression");
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "safe.txt"), "safe\n");
	return root;
}
function init(root: string, refresh = false) {
	return spawnCli(
		["space", "init", root, "--cadence", "manual", ...(refresh ? ["--refresh"] : [])],
		fixture,
	);
}

describe("T-6 shared init regressions", () => {
	it.each([
		"notes/readme.txt",
		"notes/server.pem~",
		"notes/server.key.bak",
		"notes/server.pem.other",
		"notes/server.key. ",
	])("guards staged secret %s during init", (path: string) => {
		const root = space();
		writeFileSync(
			join(root, path),
			path.endsWith("txt") ? "-----BEGIN OPENSSH PRIVATE KEY-----\n" : "key\n",
		);
		const result = init(root);
		expect(result.status, flat(result.stderr)).toBe(2);
		expect(flat(result.stderr)).toContain("secret guard");
		expect(
			git(["--git-dir", fixture.remote, "for-each-ref", "refs/heads/space"], fixture.root),
		).toBe("");
	});

	it("classifies a hook saying fetch first as a hook refusal, with sentence punctuation", () => {
		const root = space();
		expect(init(root).status).toBe(0);
		writeFileSync(
			join(fixture.remote, "hooks", "pre-receive"),
			'#!/bin/sh\necho "fetch first please"\nexit 1\n',
			{ mode: 0o755 },
		);
		writeFileSync(join(root, "notes", "safe.txt"), "changed\n");
		const result = init(root, true);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("hook declined");
		expect(flat(result.stderr)).not.toContain("another machine");
		expect(flat(result.stderr)).toContain("fetch first please. Your local history was kept.");
		expect(readFileSync(join(root, "notes", "safe.txt"), "utf8")).toBe("changed\n");
	});
});
