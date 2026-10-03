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
	unmetReason:
		"the target shell did not load ~/.local/bin from its startup files; configure PATH in that shell's startup file and re-run setup",
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
case "\${SHELL:-/bin/sh}" in
  */bash|*/zsh) ;;
  *) printf 'Shell %s is not supported; add %s to its startup configuration, then retry.\\n' "\${SHELL:-/bin/sh}" ${shellQuote(PATH_LINE)} >&2; exit 1 ;;
esac
mkdir -p "$HOME/.local/bin"
prepend_path() (
  target="$1"
  # Preserve dotfile-manager links, including relative links and link chains.
  # Resolve each link relative to its own directory, never to the process cwd.
  links=0
  while [ -L "$target" ]; do
    links=$((links + 1))
    [ "$links" -le 40 ] || { echo "too many symlinks resolving $1" >&2; exit 1; }
    link="$(readlink "$target")"
    case "$link" in
      /*) target="$link" ;;
      *) target="$(dirname "$target")/$link" ;;
    esac
  done
  directory="$(CDPATH= cd -P "$(dirname "$target")" && pwd)"
  target="$directory/$(basename "$target")"
  if [ -e "$target" ]; then
    if ! [ -w "$target" ] || ! LC_ALL=C ls -ld "$target" | cut -c 1-10 | grep -q w; then
      echo "rc file is not writable: $target" >&2; exit 1
    fi
  fi
  # A legacy bottom export does not count: it may be below Debian's guard.
  if [ -f "$target" ] && [ "$(head -n 1 "$target")" = ${shellQuote(PATH_LINE)} ]; then exit 0; fi
  tmp="$(mktemp "$target.hyper.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT HUP INT TERM
  if [ -e "$target" ]; then cp -p "$target" "$tmp"; fi
  {
    printf '%s\\n' ${shellQuote(PATH_LINE)}
    if [ -e "$target" ]; then grep -vxF ${shellQuote(PATH_LINE)} "$target" || [ "$?" -eq 1 ]; fi
  } > "$tmp" || exit 1
  mv -f "$tmp" "$target"
)
case "\${SHELL:-/bin/sh}" in
  */bash)
    prepend_path "$HOME/.bashrc"
    # An existing bash_profile masks .profile. Leave profiles that already
    # source .bashrc alone; otherwise the login-shell check cannot see the fix.
    if [ -f "$HOME/.bash_profile" ] && ! sed 's/#.*//' "$HOME/.bash_profile" | grep -Eq '(^|;|&&|[|][|])[[:space:]]*(then[[:space:]]+)?([.]|source)[[:space:]]+[^;]*[.]bashrc'; then
      prepend_path "$HOME/.bash_profile"
    fi
    ${ctx.machine === null ? 'if [ ! -e "$HOME/.bash_profile" ] && [ ! -e "$HOME/.profile" ]; then prepend_path "$HOME/.profile"; fi' : ""}
    ;;
  */zsh) prepend_path "$HOME/.zshenv" ;;
esac
`,
		]);
		if (result.code !== 0) {
			throw new InstallError(
				`I couldn't add the PATH line: ${result.stderr.trim() || `exit ${result.code}`}. Check your shell rc file permissions and retry.`,
			);
		}
	},
};
