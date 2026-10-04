/**
 * Keep the space's HYPER.md backup rule true after `hyper space init`.
 *
 * HYPER.md is written at scaffold/clone time, by the bash writers in
 * `scripts/hyper-lib.sh`, and is space content: it is committed and travels to
 * every clone. A space scaffolded before `init` therefore carries the
 * no-branch bullet ("nothing here is committed or backed up until you run
 * `hyper space init`"), or the even older single bullet, after init has made
 * it false. After a successful init or `--refresh`, this re-renders that one
 * bullet with the branch wording and leaves every other byte of the file
 * alone.
 *
 * The texts come from the ONE generator, `hyper_md_backup_rule` (C-5): its
 * forced variants `none` and `legacy` are what a generated, unedited file can
 * hold, and `branch` is the replacement. A bullet that matches none of them
 * was edited by hand and is left as it is; the caller says so in one line.
 */
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLib, type SpaceLayout } from "#services/space";

export const HYPER_MD = "HYPER.md";

/**
 * - `updated`: a generated bullet was replaced with the branch wording.
 * - `current`: the file already has the branch wording.
 * - `edited`: no generated bullet was found, or HYPER.md is not a regular
 *   file (a symlink is never replaced); the file was left alone.
 * - `absent`: there is no HYPER.md (nothing is created).
 */
export type HyperMdRefresh = "updated" | "current" | "edited" | "absent";

function backupRule(
	root: string,
	layout: SpaceLayout,
	state: "branch" | "none" | "legacy",
): string {
	const { ok, stdout } = runLib("hyper_md_backup_rule", [root, layout, state]);
	if (!ok || stdout === "") throw new Error(`hyper_md_backup_rule ${state} printed nothing`);
	return stdout;
}

/** Re-render the backup bullet of `<root>/HYPER.md` for a space that now has a branch. */
export function refreshHyperMdBackupRule(root: string, layout: SpaceLayout): HyperMdRefresh {
	const path = join(root, HYPER_MD);
	let text: string;
	let mode: number;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile()) return "edited";
		mode = stat.mode & 0o7777;
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw error;
	}
	const current = backupRule(root, layout, "branch");
	if (text.includes(current)) return "current";
	// A bullet always starts a line: anchoring on the preceding newline keeps a
	// generated text quoted inside some other paragraph from being rewritten.
	for (const state of ["none", "legacy"] as const) {
		const stale = backupRule(root, layout, state);
		const at = text.indexOf(`\n${stale}`);
		if (at === -1) continue;
		const next = `${text.slice(0, at + 1)}${current}${text.slice(at + 1 + stale.length)}`;
		const temporary = `${path}.hyper-${process.pid}`;
		try {
			writeFileSync(temporary, next, { flag: "wx", mode });
			renameSync(temporary, path);
		} finally {
			rmSync(temporary, { force: true });
		}
		return "updated";
	}
	return "edited";
}
