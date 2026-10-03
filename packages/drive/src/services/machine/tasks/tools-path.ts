/** Make user-level tools visible to the target user's shell, not just hyper. */
import { shellQuote } from "#services/remote";
import { InstallError } from "../tools.js";
import type { Task } from "./types.js";

export const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';
const PATH_CHECK = 'case ":$PATH:" in *":$HOME/.local/bin:"*) exit 0 ;; *) exit 1 ;; esac';

export const pathTask: Task = {
	id: "tools.path",
	feature: "tools",
	needsRoot: false,
	title: "~/.local/bin on PATH",
	async check(ctx) {
		// A plain remote command sees exactly the non-interactive target PATH.
		// Locally, ask the user's login shell; hyper may have widened its own PATH.
		const probe =
			ctx.machine === null ? `exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(PATH_CHECK)}` : PATH_CHECK;
		const result = await ctx.runner.ssh(
			["sh", "-c", `test -d "$HOME/.local/bin" || exit 1\n${probe}`],
			{ timeoutMs: 5000 },
		);
		return result.code === 0;
	},
	async apply(ctx) {
		const result = await ctx.runner.ssh([
			"sh",
			"-c",
			`set -eu
mkdir -p "$HOME/.local/bin"
case "\${SHELL:-/bin/sh}" in
  */bash) target="$HOME/.bashrc" ;;
  */zsh) target="$HOME/.zshenv" ;;
  *) target="$HOME/.profile" ;;
esac
# The first line must work even above Debian's non-interactive return guard.
# An old bottom-appended line is not evidence that this shell can see it.
if [ -f "$target" ] && [ "$(head -n 1 "$target")" = ${shellQuote(PATH_LINE)} ]; then exit 0; fi
tmp="$(mktemp "$target.hyper.XXXXXX")"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
if [ -e "$target" ]; then cp -p "$target" "$tmp"; fi
{
  printf '%s\\n' ${shellQuote(PATH_LINE)}
  if [ -e "$target" ]; then grep -vxF ${shellQuote(PATH_LINE)} "$target" || [ "$?" -eq 1 ]; fi
} > "$tmp"
mv -f "$tmp" "$target"
`,
		]);
		if (result.code !== 0) {
			throw new InstallError(
				`I couldn't add the PATH line: ${result.stderr.trim() || `exit ${result.code}`}. Check your shell rc file permissions and retry.`,
			);
		}
	},
};
