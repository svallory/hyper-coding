import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSecretContent, SECRET_CONTENT_PATTERNS } from "#services/allowlist";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { commitSpace, inspectStagedFiles } from "#services/space-sync";
import {
	fixturePath,
	isolateGitConfig,
	setupSpaceFixtures,
	teardownSpaceFixtures,
} from "#tests/tmp-space";

/**
 * Content-based secret guard. Every value below is synthetic and obviously
 * fake (runs of `x`/`X`); no real credential file is ever read.
 */

const BRANCH = "space/hyper";

/** One fixture per rule: name, line content (line 2 of the file). */
const FIXTURES: { name: string; line: string }[] = [
	{ name: "private key block", line: "-----BEGIN OPENSSH PRIVATE KEY-----" },
	{ name: "GitHub token", line: `gh${"p"}_${"x".repeat(36)}` },
	{ name: "GitHub fine-grained token", line: `github_pat_${"x".repeat(40)}` },
	{ name: "Anthropic API key", line: `sk-ant-${"x".repeat(40)}` },
	{ name: "API key (sk-)", line: `sk-${"x".repeat(40)}` },
	{ name: "AWS access key id", line: `AKIA${"X".repeat(16)}` },
	{ name: "Slack token", line: `xox${"b"}-${"x".repeat(24)}` },
	{ name: "npm token", line: `npm_${"x".repeat(36)}` },
	{ name: "generic secret assignment", line: `password=${"x".repeat(24)}` },
];

let restoreGitConfig: () => void = () => {};
beforeAll(() => {
	setupSpaceFixtures();
	restoreGitConfig = isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
});
afterAll(() => {
	restoreGitConfig();
	teardownSpaceFixtures();
});

function makeSpace(): string {
	const root = fixturePath(`space-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "HYPER.md"), "# hyper\n");
	initSpaceGitDir(root, { branch: BRANCH });
	return root;
}

async function inspect(root: string, files: Record<string, string | Buffer>, allow: string[] = []) {
	for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
	const paths = Object.keys(files);
	spaceGit(root, ["add", "--", ...paths]);
	return inspectStagedFiles(root, paths, allow);
}

describe("findSecretContent", () => {
	it("has one fixture per rule in the table", () => {
		expect(FIXTURES.map((f) => f.name)).toEqual(SECRET_CONTENT_PATTERNS.map((p) => p.name));
	});

	for (const { name, line } of FIXTURES) {
		it(`finds ${name} with its line and rule, never the value`, () => {
			const hits = findSecretContent(`harmless\n${line}\nharmless\n`);
			expect(hits).toContainEqual({ line: 2, pattern: name });
			expect(JSON.stringify(hits)).not.toContain("xxxx");
		});
	}

	it("leaves ordinary text and references alone", () => {
		const text = [
			"token=${GITHUB_TOKEN}",
			"password=short",
			"the password is hunter2 and the token is in the vault",
			"sk-short",
			`AKIA${"X".repeat(15)}`,
			"ghp_tooshort",
		].join("\n");
		expect(findSecretContent(text)).toEqual([]);
	});

	it("counts CRLF lines", () => {
		expect(findSecretContent(`a\r\nb\r\n${FIXTURES[5].line}\r\n`)).toEqual([
			{ line: 3, pattern: "AWS access key id" },
		]);
	});
});

describe("inspectStagedFiles content scan", () => {
	for (const { name, line } of FIXTURES) {
		it(`flags a staged file holding ${name}`, async () => {
			const root = makeSpace();
			const result = await inspect(root, { "notes/a.md": `first\n${line}\n` });
			expect(result.secrets).toEqual(["notes/a.md"]);
			expect(result.contentFindings).toContainEqual({ path: "notes/a.md", line: 2, pattern: name });
		});
	}

	it("skips a binary file (NUL in the first bytes)", async () => {
		const root = makeSpace();
		const body = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\n${FIXTURES[1].line}\n`)]);
		const result = await inspect(root, { "notes/blob.bin": body });
		expect(result.secrets).toEqual([]);
	});

	it("skips a text file above 1 MiB", async () => {
		const root = makeSpace();
		const body = `${"padding line\n".repeat(90_000)}${FIXTURES[1].line}\n`;
		expect(body.length).toBeGreaterThan(1024 * 1024);
		const result = await inspect(root, { "notes/big.txt": body });
		expect(result.secrets).toEqual([]);
	});

	it("scans past the first 4 KiB of a text file", async () => {
		const root = makeSpace();
		const result = await inspect(root, {
			"notes/a.md": `${"x ".repeat(4000)}\n${FIXTURES[1].line}\n`,
		});
		expect(result.contentFindings).toEqual([
			{ path: "notes/a.md", line: 2, pattern: "GitHub token" },
		]);
	});

	it("waives an exact allowed path and reports no finding for it", async () => {
		const root = makeSpace();
		const result = await inspect(
			root,
			{ "notes/a.md": `${FIXTURES[1].line}\n`, "notes/b.md": `${FIXTURES[2].line}\n` },
			["notes/a.md"],
		);
		expect(result.allowedSecrets).toEqual(["notes/a.md"]);
		expect(result.secrets).toEqual(["notes/b.md"]);
		expect(result.contentFindings.map((f) => f.path)).toEqual(["notes/b.md"]);
	});

	it("passes a clean tree", async () => {
		const root = makeSpace();
		const result = await inspect(root, {
			"notes/a.md": "# notes\nnothing here\ntoken=${TOKEN}\n",
			"notes/b.md": "plain\n",
		});
		expect(result).toMatchObject({ secrets: [], allowedSecrets: [], contentFindings: [] });
	});
});

describe("commitSpace content refusal", () => {
	it("refuses with path:line and rule, never the value, and stages nothing", async () => {
		const root = makeSpace();
		writeFileSync(join(root, "notes", "a.md"), `ok\n${FIXTURES[1].line}\n`);
		const failure = await commitSpace(root, BRANCH, "msg", [], "daily", () => {}).then(
			() => null,
			(error: Error) => error,
		);
		expect(failure).not.toBeNull();
		expect(failure!.message).toContain("notes/a.md:2 (GitHub token)");
		expect(failure!.message).not.toContain("xxxxxxxx");
		expect(spaceGit(root, ["ls-files"]).stdout.trim()).toBe("");
	});

	it("commits once the path is allowed", async () => {
		const root = makeSpace();
		writeFileSync(join(root, "notes", "a.md"), `ok\n${FIXTURES[1].line}\n`);
		const result = await commitSpace(root, BRANCH, "msg", ["notes/a.md"], "daily", () => {});
		expect(result.allowedSecrets).toEqual(["notes/a.md"]);
		expect(result.committed).toBeGreaterThan(0);
	});
});
