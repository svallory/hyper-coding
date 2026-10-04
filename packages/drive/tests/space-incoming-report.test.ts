import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { incomingReviewPaths } from "#services/space-incoming";
import { isolateGitConfig, type ManifestFixture, withManifestFixture } from "#tests/tmp-manifest";

let fixture: ManifestFixture;
let root: string;
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	root = join(fixture.root, "report");
	mkdirSync(root);
	initSpaceGitDir(root, { branch: "space/report" });
}, 120_000);
afterEach(() => fixture.cleanup());
function commit(paths: string[]): string {
	for (const path of paths) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), `${Date.now()}\n`);
	}
	spaceGit(root, ["add", "--", ...paths]);
	spaceGit(root, ["commit", "-qm", "fixture"]);
	return spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
}
it("reports the whole clone tip, preserving unusual names", async () => {
	const dangerous = [
		".claude/settings.json",
		".claude/hooks/session.sh",
		"bin/a\tcommand",
		".vscode/tasks.json",
		"CLAUDE.md",
		"notes/AGENTS.md",
		"HYPER.md",
		".hyper/memory/MEMORY.md",
	];
	const tip = commit([...dangerous, "notes/safe.md"]);
	expect(await incomingReviewPaths(root, tip)).toEqual(dangerous.sort());
});
it("reports additions and modifications, and deletions of review paths", async () => {
	const base = commit(["bin/change", "bin/delete", "CLAUDE.md"]);
	rmSync(join(root, "bin/delete"));
	spaceGit(root, ["add", "-u"]);
	const tip = commit(["bin/change", ".claude/hooks/new"]);
	expect(await incomingReviewPaths(root, tip, base)).toEqual([
		".claude/hooks/new",
		"bin/change",
		"bin/delete",
	]);
});
