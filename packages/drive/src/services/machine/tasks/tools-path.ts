/**
 * `tools.path` — is `~/.local/bin` actually on PATH, for the shells that matter?
 *
 * Every recipe in the registry installs into `~/.local/bin`, and appending one
 * line to an rc file is how that becomes usable. It is its own task because
 * "the line is in the file" is not the same as "a shell finds the tool":
 *
 * - Debian's stock `.bashrc` returns early for non-interactive shells, so a line
 *   appended at the bottom is never read by `ssh host 'rg --version'` or by a
 *   script. The line has to go ABOVE that guard, which means prepending.
 * - An rc file the user does not have should stay missing. `~/.profile` is the
 *   one exception, and only when no rc file exists at all: it is the file every
 *   POSIX login shell reads.
 */

import { shellQuote } from "#services/remote";
import type { Task, TaskContext } from "./types.js";

/** The line every recipe relies on. */
export const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

/** The rc files a shell may read, in the order they are worth checking. */
const RC_FILES = [".bashrc", ".zshrc", ".profile", ".bash_profile"] as const;

async function exists(ctx: TaskContext, path: string): Promise<boolean> {
	const result = await ctx.runner.ssh(["sh", "-c", `test -e ${JSON.stringify(path)}`]);
	return result.code === 0;
}

/**
 * Does a *login* shell see `~/.local/bin`?
 *
 * The check asks a login shell, because that is the shell a user gets when they
 * open a terminal, and it is the only one that reads `~/.profile` when there is
 * no `~/.bashrc`.
 */
async function loginShellSeesIt(ctx: TaskContext): Promise<boolean> {
	const result = await ctx.runner.ssh([
		"sh",
		"-c",
		`case ":$PATH:" in *":$HOME/.local/bin:"*) exit 0 ;; esac
# A login shell sources the profile files; ask one to tell us.
out="$(HOME="$HOME" sh -lc 'command -v true' 2>/dev/null)" || exit 1
home_path="$(HOME="$HOME" sh -lc 'printf %s "$PATH"' 2>/dev/null)"
case ":$home_path:" in *":$HOME/.local/bin:"*) exit 0 ;; esac
exit 1`,
	]);
	return result.code === 0;
}

/**
 * The task.
 *
 * `check` asks a real shell rather than grepping a file: a line in `.bashrc`
 * under Debian's non-interactive guard is not on anybody's PATH, and the whole
 * point of this task is that the difference matters.
 */
export const pathTask: Task = {
	id: "tools.path",
	feature: "tools",
	needsRoot: false,
	title: "~/.local/bin on PATH",
	async check(ctx) {
		if (!(await exists(ctx, "$HOME/.local/bin"))) return true; // Nothing installed there yet.
		return loginShellSeesIt(ctx);
	},
	async apply(ctx) {
		// The first rc file the user actually has is the one to touch: a shell that
		// reads two of them will read the same line twice, and a user with three
		// did not ask us to rearrange their dotfiles.
		let target: string | null = null;
		for (const name of RC_FILES) {
			if (await exists(ctx, `$HOME/${name}`)) {
				target = `$HOME/${name}`;
				break;
			}
		}
		// None of them: `~/.profile` is what every POSIX login shell reads, and it
		// is the only file we create.
		target ??= "$HOME/.profile";
		const result = await ctx.runner.ssh([
			"sh",
			"-c",
			`set -eu
target=${target}
[ -e "$target" ] || : > "$target"
grep -qF ${shellQuote(PATH_LINE)} "$target" && exit 0
# Prepend, not append: Debian's .bashrc returns early for non-interactive
# shells, so a line at the bottom is invisible to \`ssh host 'tool'\`.
{
  printf '%s\\n' '# added by hyper machine setup: user-level tools live here'
  printf '%s\\n' ${shellQuote(PATH_LINE)}
  cat "$target"
} > "$target.hyper"
cat "$target.hyper" > "$target"
rm -f "$target.hyper"`,
		]);
		if (result.code !== 0) {
			throw new Error(
				`I couldn't add the PATH line to ${target}: ${result.stderr.trim() || `exit ${result.code}`}`,
			);
		}
	},
};
