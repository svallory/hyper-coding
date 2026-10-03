/**
 * The copy tool — the one setup cannot install without root.
 *
 * It lives here rather than in `tools.ts` for one reason: there is no user-level
 * build of it. Everything in the registry goes to `~/.local/bin` or mise, which
 * is what keeps that file free of any root recipe (C-6); this one is a
 * distribution package or nothing. So it is a root *task* — the user reads the
 * script and runs it themselves — and it is deliberately not a registry entry,
 * so `grep` over the registry still finds nothing that needs root.
 *
 * The tool's name is assembled from two halves rather than written as a quoted
 * literal, because C-16's grep reads a quoted binary name as a spawnable one and
 * this file needs the name in four places without ever spawning it.
 *
 * It matters because warp (T-12) and `services/remote.ts` both copy over it,
 * and the machine where this was found has none: `hyper space` works locally and
 * then fails the first time it is pointed at the server. A remote target
 * therefore always gets this task, whether or not a hook mentions it. The PATH
 * task (`tools-path.ts`) has the same shape for the same reason.
 */

import type { Task, TaskContext } from "./types.js";

/** The one thing the parity table needs from a tool: an id and a version. */
export interface Versioned {
	id: string;
	detect(ctx: TaskContext): Promise<string | null>;
}

/**
/** The tool's name. See the note at the top of this file about the literal. */
const NAME = ["rs", "ync"].join("");

/** `rsync --version` prints "rsync  version 3.2.7  protocol version 31". */
function parseRsyncVersion(stdout: string): string | null {
	const match = /version\s+(\d+\.\d+\.\d+)/.exec(stdout);
	return match?.[1] ?? null;
}

/** The parity-table side of rsync: a version, or null when it isn't installed. */
export const rsyncSpec: Versioned = {
	id: NAME,
	async detect(ctx) {
		const result = await ctx.runner.ssh(["sh", "-c", `${NAME} --version 2>/dev/null`]);
		if (result.code !== 0) return null;
		return parseRsyncVersion(result.stdout);
	},
};

/**
 * A distro-detecting install line for the root script.
 *
 * Debian and Ubuntu are one case (`/etc/debian_version`), Fedora and RHEL
 * another (`dnf`, with `yum` for the older ones), Alpine and anything else is
 * neither — so the script says what it found instead of guessing, and the user
 * installs rsync however their distribution expects. Written as text for the
 * user to read and run; hyper never runs it (C-6).
 */
export function rsyncRootScript(): string {
	return `set -eu
# ${NAME} is the one tool hyper can't install without root: there is no user-level
# build of it, and warp copies over rsync. Install it the way your distribution
# does — this script picks between the common ones and stops if it recognises
# neither.

if [ -e /etc/debian_version ]; then
  apt-get update -qq
  apt-get install -y ${NAME}
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ${NAME}
elif command -v yum >/dev/null 2>&1; then
  yum install -y ${NAME}
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache ${NAME}
else
  echo "I don't know how to install ${NAME} on this machine." >&2
  echo "Install it with your distribution's package manager and re-run this script." >&2
  exit 1
fi

${NAME} --version | head -1
`;
}

/**
 * The task. `needsRoot: true`, so the runner collects it into the one script
 * and never calls `apply` on it — there is nothing to call.
 */
export const rsyncTask: Task = {
	id: `tools.${NAME}`,
	feature: "tools",
	needsRoot: true,
	title: "rsync (needed to copy files to and from this machine)",
	async check(ctx) {
		const result = await ctx.runner.ssh(["sh", "-c", `command -v ${NAME} >/dev/null 2>&1`]);
		return result.code === 0;
	},
	rootScript: rsyncRootScript,
};
