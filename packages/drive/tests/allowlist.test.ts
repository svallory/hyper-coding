import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	AllowlistError,
	findSecretPaths,
	renderGitignore,
	SECRET_PATTERNS,
} from "#services/allowlist";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import {
	fixturePath,
	initBare,
	isolateGitConfig,
	setupSpaceFixtures,
	teardownSpaceFixtures,
} from "#tests/tmp-space";

/**
 * The space allowlist, proved against git itself (C-4): a real space with the
 * rendered `.gitignore` at its root, then `git check-ignore` per path and a
 * `git add -A` whose index must hold exactly the allowlisted files. Plus the
 * secret guard's matcher (C-7 at the service level; the CLI refusal is T-6).
 */

const BRANCH = "space/hyper";

/** Files that exist in the fixture, whichever way the allowlist rules fall. */
const FIXTURE_FILES = [
	".env",
	"scratch/x",
	"worktrees/m/x",
	"code/a/x",
	"notes/a.md",
	"data/d.json",
	"bin/b.sh",
	".hyper/memory/m.md",
	".claude/settings.json",
	".claude/settings.local.json",
	"1password-credentials.json",
	"HYPER.md",
];

const IGNORED = [
	".env",
	"scratch/x",
	"worktrees/m/x",
	"code/a/x",
	"1password-credentials.json",
	".hyper/space.git/HEAD",
	".claude/settings.local.json",
	".git/HEAD",
];

const TRACKED = [
	".gitignore",
	"HYPER.md",
	"notes/a.md",
	"data/d.json",
	"bin/b.sh",
	".hyper/memory/m.md",
	".claude/settings.json",
];

/** A bare-layout space with the fixture files and a space git dir. */
function makeSpace(tracked: string[] = []): string {
	const root = fixturePath(`allow-${Math.random().toString(36).slice(2)}`);
	// The project repo is a real bare `.git` at the root (bare layout), built
	// by git so `.git/HEAD` exists and the check-ignore case hits a real path.
	initBare(join(root, ".git"));
	for (const file of FIXTURE_FILES) {
		const path = join(root, file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${file}\n`);
	}
	initSpaceGitDir(root, { branch: BRANCH });
	writeFileSync(join(root, ".gitignore"), renderGitignore(tracked));
	return root;
}

/** Is `path` ignored in this space? `git check-ignore -q` exits 0 when ignored. */
function isIgnored(root: string, path: string): boolean {
	return spaceGit(root, ["check-ignore", "-q", path], { allowFailure: true }).status === 0;
}

let restoreGitConfig: () => void = () => {};

beforeAll(() => {
	setupSpaceFixtures();
	restoreGitConfig = isolateGitConfig();
});

afterAll(() => {
	restoreGitConfig();
	teardownSpaceFixtures();
});

describe("renderGitignore", () => {
	it("renders the design's allowlist verbatim, with a trailing newline", () => {
		expect(renderGitignore()).toBe(
			[
				"*",
				"!/.gitignore",
				"!/HYPER.md",
				"!/AGENTS.md",
				"!/CLAUDE.md",
				"!/notes/",
				"!/notes/**",
				"!/data/",
				"!/data/**",
				"!/bin/",
				"!/bin/**",
				"!/.hyper/",
				"!/.hyper/**",
				"/.hyper/space.git/",
				"!/.claude/",
				"!/.claude/**",
				"/.claude/settings.local.json",
				"",
			].join("\n"),
		);
	});

	it("adds one ! pair per tracked entry, normalised and deduplicated", () => {
		const rendered = renderGitignore(["extra/", "./deep/thing"]);
		// The pairs come last-before the safety tail, so assert their order
		// rather than the end of the string.
		const lines = rendered.split("\n");
		const first = lines.indexOf("!/extra/");
		expect(lines.slice(first, first + 4)).toEqual([
			"!/extra/",
			"!/extra/**",
			"!/deep/thing/",
			"!/deep/thing/**",
		]);

		// Normalisation collapses variants; duplicates render once.
		const deduped = renderGitignore(["extra/", "extra", "./extra"]).split("\n");
		expect(deduped.filter((line) => line === "!/extra/")).toHaveLength(1);
		expect(deduped.filter((line) => line === "!/extra/**")).toHaveLength(1);
	});

	it("refuses absolute paths, `..` escapes and empty entries", () => {
		expect(() => renderGitignore(["/etc"])).toThrow(/absolute/);
		expect(() => renderGitignore(["../outside"])).toThrow(/escape/);
		expect(() => renderGitignore(["a/../../b"])).toThrow(/escape/);
		expect(() => renderGitignore([""])).toThrow(/empty/);
		expect(() => renderGitignore(["./"])).toThrow(/inside the space/);
		expect(() => renderGitignore(["."])).toThrow(/inside the space/);
		expect(() => renderGitignore(["  "])).toThrow(/empty or just spaces/);
		expect(() => renderGitignore(["\t"])).toThrow(/empty or just spaces/);
	});

	it("refuses entries whose spaces or segments would never match a path", () => {
		// `a/./b` and `a//b` are the same path to a filesystem; rendered
		// verbatim they are rules that match nothing, so the entry would look
		// tracked while nothing is. Surrounding spaces are invisible for the
		// same reason.
		expect(() => renderGitignore(["a/./b"])).toThrow(/empty or `\.` segment/);
		expect(() => renderGitignore(["a//b"])).toThrow(/empty or `\.` segment/);
		expect(() => renderGitignore([" x"])).toThrow(/start or end with spaces/);
		expect(() => renderGitignore(["x "])).toThrow(/start or end with spaces/);
	});

	it("still accepts the plain forms of those paths", () => {
		const rendered = renderGitignore(["./a/b", "c/"]);
		const lines = rendered.split("\n");
		const first = lines.indexOf("!/a/b/");
		expect(lines.slice(first, first + 4)).toEqual(["!/a/b/", "!/a/b/**", "!/c/", "!/c/**"]);
	});

	// A `tracked` entry lands in the rendered .gitignore verbatim, so anything
	// that can change a rule's meaning must be refused — above all a newline,
	// which would inject a whole extra rule and re-include an ignored tree.
	it("refuses entries that could rewrite the allowlist", () => {
		const injections = [
			["a\n!/scratch/**", /newline/],
			["a\r!/scratch/**", /carriage return/],
			["#comment", /comment/],
			["!/scratch/", /negate/],
			["wild*card", /glob/],
			["que?ry", /glob/],
			["class[abc]", /character class/],
			["back\\slash", /escapes/],
		] as const;

		for (const [entry, message] of injections) {
			expect(() => renderGitignore([entry]), entry).toThrow(AllowlistError);
			expect(() => renderGitignore([entry]), entry).toThrow(message);
		}
	});

	it("renders nothing when any one entry is bad", () => {
		// All-or-nothing: a good entry before a rejected one must not produce a
		// partial allowlist, and certainly not one with the injection in it.
		expect(() => renderGitignore(["good", "bad\n!/scratch/**", "alsogood"])).toThrow(
			AllowlistError,
		);
	});

	it("refuses reserved paths, however they are spelled", () => {
		const reserved = [
			".hyper/space.git",
			".hyper/space.git/",
			".hyper/space.git/hooks",
			".git",
			".git/refs",
			"worktrees",
			"worktrees/",
			"code",
			"scratch",
			".claude/settings.local.json",
			// a case-insensitive filesystem hands back either spelling
			"Worktrees",
			".GIT",
		];

		for (const entry of reserved) {
			expect(() => renderGitignore([entry]), entry).toThrow(AllowlistError);
			expect(() => renderGitignore([entry]), entry).toThrow(/is reserved/);
		}
	});

	it("still allows a legit entry that merely sits near a reserved one", () => {
		const rendered = renderGitignore(["extra/", ".hyper/notes", "code-notes"]);
		expect(rendered).toContain("!/extra/\n!/extra/**\n");
		expect(rendered).toContain("!/.hyper/notes/\n!/.hyper/notes/**\n");
		expect(rendered).toContain("!/code-notes/\n!/code-notes/**\n");
	});
});

describe("reserved paths stay ignored whatever tracked says", () => {
	// The probe behind this: `tracked: [".hyper/space.git"]` staged the whole
	// git dir (config with the remote URL, hooks, index), because the `!` pair
	// lands after `/.hyper/space.git/` and gitignore is last-match-wins. The
	// refusal above stops that entry; this proves the other half — the safety
	// tail re-emits the re-ignores after every pair, so the invariant holds
	// even for a reserved path that slipped through.
	const RESERVED_PATHS = [
		".hyper/space.git/HEAD",
		".hyper/space.git/config",
		"worktrees/m/x",
		"code/a/x",
		"scratch/x",
		".claude/settings.local.json",
		".git/HEAD",
	];

	it("re-emits the base re-ignores after the tracked pairs", () => {
		const lines = renderGitignore(["extra/"]).split("\n");
		const lastTracked = lines.lastIndexOf("!/extra/**");
		expect(lastTracked).toBeGreaterThan(lines.indexOf("!/.hyper/**"));
		for (const tail of ["/.hyper/space.git/", "/.claude/settings.local.json"]) {
			// lastIndexOf: the line is in the base list too; the re-emission is
			// the point, and it has to be the one after the pairs.
			expect(
				lines.lastIndexOf(tail),
				`${tail} should be re-emitted after the pairs`,
			).toBeGreaterThan(lastTracked);
		}
	});

	it("a tracked pair does not un-ignore a reserved path (git decides)", () => {
		const root = makeSpace(["extra/"]);
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", "f"), "extra/f\n");
		for (const path of RESERVED_PATHS) {
			expect(isIgnored(root, path), `${path} must stay ignored`).toBe(true);
		}

		spaceGit(root, ["add", "-A"]);
		const staged = spaceGit(root, ["ls-files"])
			.stdout.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		expect(staged).toContain("extra/f");
		for (const path of RESERVED_PATHS) {
			expect(staged, `${path} must never be staged`).not.toContain(path);
		}
		// Nothing from the space's own git dir may leak into the index.
		expect(staged.filter((path) => path.startsWith(".hyper/space.git/"))).toEqual([]);
	});
});

describe("the rendered allowlist, as git sees it (C-4)", () => {
	let root = "";

	beforeAll(() => {
		root = makeSpace();
	});

	it("ignores the secret-ish, transient and tool paths", () => {
		for (const path of IGNORED) {
			expect(isIgnored(root, path), `${path} should be ignored`).toBe(true);
		}
	});

	it("keeps the space's own files", () => {
		for (const path of TRACKED) {
			expect(isIgnored(root, path), `${path} should not be ignored`).toBe(false);
		}
	});

	it("`add -A` stages exactly the allowlisted files", () => {
		spaceGit(root, ["add", "-A"]);
		const staged = spaceGit(root, ["ls-files"])
			.stdout.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		expect([...staged].sort()).toEqual([...TRACKED].sort());
	});
});

describe("tracked entries extend the allowlist", () => {
	it('`tracked: ["extra/"]` makes extra/ files trackable', () => {
		const root = makeSpace(["extra/"]);
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", "f"), "extra/f\n");

		expect(isIgnored(root, "extra/f")).toBe(false);
		spaceGit(root, ["add", "-A"]);
		const staged = spaceGit(root, ["ls-files"]).stdout.split("\n");
		expect(staged).toContain("extra/f");
	});
});

describe("findSecretPaths", () => {
	const PATHS = [
		".env", // depth 0: `**/` must match zero directories too
		"credentials.json",
		"id_rsa", // depth 0 private key, no extension
		"server.key", // depth 0 `.key`
		"secrets/x", // depth 0 `secrets/`
		"ID_RSA", // case variant: a case-insensitive filesystem hands these back
		"Credentials.json",
		"a/b.PEM",
		"x/id_ed2551919",
		"x/id_ecdsa",
		"notes/env.md", // not a secret: `env.md` has no dot before `env`
		"notes/environment.md", // nor does `environment.md`
		"src/keys.ts", // `.key` is the pattern; `keys.ts` is a source file
		"notes/.env",
		"notes/.env.local",
		"bin/credentials.json",
		"data/1password-credentials.json",
		"keys/server.pem",
		"x/id_rsa.pub",
		"ops/secrets/db.txt",
		"HYPER.md",
		"notes/a.md",
	];

	it("finds every secret pattern and leaves the rest alone", () => {
		expect(findSecretPaths(PATHS)).toEqual([
			".env",
			"credentials.json",
			"id_rsa",
			"server.key",
			"secrets/x",
			"ID_RSA",
			"Credentials.json",
			"a/b.PEM",
			"x/id_ed2551919",
			"x/id_ecdsa",
			"notes/.env",
			"notes/.env.local",
			"bin/credentials.json",
			"data/1password-credentials.json",
			"keys/server.pem",
			"x/id_rsa.pub",
			"ops/secrets/db.txt",
		]);
	});

	it("matches case variants and more SSH key types", () => {
		expect(findSecretPaths(["ID_RSA", "Id_Rsa.PUB", "Credentials.json", "a/b.PEM"])).toEqual([
			"ID_RSA",
			"Id_Rsa.PUB",
			"Credentials.json",
			"a/b.PEM",
		]);
		expect(findSecretPaths(["x/id_ed25519", "x/id_ecdsa.pem"])).toEqual([
			"x/id_ed25519",
			"x/id_ecdsa.pem",
		]);
	});

	it("keeps input order", () => {
		const reversed = [...PATHS].reverse();
		expect(findSecretPaths(reversed)).toEqual(findSecretPaths(PATHS).reverse());
	});

	it("skips exactly the paths in `allow`", () => {
		expect(findSecretPaths(PATHS, ["notes/.env"])).not.toContain("notes/.env");
		expect(findSecretPaths(PATHS, ["notes/.env"])).toHaveLength(16);
		expect(findSecretPaths(PATHS, PATHS)).toEqual([]);
	});

	it("exposes the patterns it guards with", () => {
		expect(SECRET_PATTERNS).toEqual([
			"**/.env*",
			"**/*credentials*",
			"**/*.pem",
			"**/*.key",
			"**/id_rsa*",
			"**/id_ed25519*",
			"**/id_ecdsa*",
			"**/secrets/**",
		]);
	});
});
