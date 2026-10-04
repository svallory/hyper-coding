/**
 * `home-path.symlink` — the same home path on both machines.
 *
 * `warp` moves a session between a Mac and a Linux box, and a session is a set
 * of ABSOLUTE paths. A project under `/Users/svallory/…` on the Mac has to be
 * reachable at the same path on the Linux machine or nothing recorded in the
 * session resolves. This task makes that true, and it does it in the only
 * direction that works:
 *
 *     /Users/<name>  is the REAL home directory   (what passwd says)
 *     /home/<name>   is a symlink to it           (so both spellings work)
 *
 * The other direction — a symlink at `/Users/<name>` — looks equivalent and is
 * not: with `set -o physical` in `.bashrc` (the `home-path.physical` task), a
 * shell that was told `cd /home/<name>/x` prints the PHYSICAL path, and with
 * the symlink at `/Users/<name>` that is `/home/<name>/x`. The acceptance line
 * for this feature (`cd /home/<name>/x && pwd` prints `/Users/<name>/x`) can
 * therefore only hold with the real home on the `/Users` side. Proved with a
 * real bash run in both directions before anything here was written.
 *
 * THAT MEANS MOVING ONE DIRECTORY, which is the sharp edge of this task:
 *
 * - it happens ONLY when `machines.<name>.home` says `/Users/<name>` and the
 *   passwd entry still says `/home/<name>` — so it is opt-in, and the exact
 *   commands are printed in the script's header before the user runs anything;
 * - it is a RENAME, and only ever on one filesystem (`stat -c %d` of `/home`
 *   and of `/` must agree). A rename preserves ownership, modes and ACLs
 *   exactly, which is what the agent-user layout depends on;
 * - `usermod -d` REFUSES while the user has any process running — including
 *   the ssh session the user is running this script from. So the script checks
 *   that FIRST, before touching anything, and refuses with the way out rather
 *   than leaving a half-moved home behind. After `usermod` succeeds, a later
 *   failure is rolled back (`mv` back, `usermod` back) so the script can be
 *   re-run from any state it can be interrupted in;
 * - every other shape is refused, including the one that looks closest:
 *   `/Users/<name>` already existing as a real directory.
 */

import { rootScriptGuards } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { homeOf, primaryUserLines, primaryUserOf } from "./agent-context.js";
import { ensureBashrcLine, runOrFail, runScript } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/** The macOS-shaped home this feature exists for. */
export const USERS_PREFIX = "/Users/";

/** Where the account's home really is, from the password database. */
export const LEGACY_HOME_PREFIX = "/home/";

/** The shell setting that makes `pwd` print the real path. */
export const PHYSICAL_LINE = "set -o physical";

/** What `passwd` says, and what is on disk at both spellings. */
interface Layout {
	/** The home in the password database. */
	passwdHome: string;
	/** `/home/<name>`: absent, a real directory, a symlink, or something else. */
	legacy: string;
	/** `/Users/<name>`: same four answers. */
	target: string;
}

/** Why the machine is not settled, or null when it is. */
export function layoutProblem(layout: Layout, target: string, name: string): string | null {
	const legacy = `${LEGACY_HOME_PREFIX}${name}`;
	if (layout.passwdHome === target && layout.legacy === "symlink") return null;
	if (layout.passwdHome === target && layout.legacy === "absent") return "missing-symlink";
	if (layout.passwdHome === target) {
		return `the passwd entry says ${target} but ${legacy} is a ${layout.legacy === "dir" ? "real directory" : layout.legacy} — I won't replace it with a symlink`;
	}
	if (layout.passwdHome === legacy && layout.legacy === "dir" && layout.target === "absent") {
		return "move";
	}
	if (layout.passwdHome === legacy && layout.legacy === "dir" && layout.target === "dir") {
		return `${target} already exists as a real directory, so moving the home there would overwrite it — move it aside yourself, then re-run`;
	}
	if (layout.passwdHome === legacy && layout.legacy === "symlink") {
		return `${legacy} is a symlink, not a real directory; move the home yourself, then re-run`;
	}
	if (layout.passwdHome !== legacy && layout.passwdHome !== target) {
		return `the passwd entry says ${layout.passwdHome}, which is neither ${legacy} nor ${target} — this task only moves a home between those two`;
	}
	return `${target} is a ${layout.target === "symlink" ? "symlink" : layout.target}, so I can't put a real home there`;
}

/** Read-only: one line per fact, labelled. */
function probe(target: string, name: string): string {
	const q = shellQuote;
	const kind = (path: string) =>
		`if [ -L ${q(path)} ]; then echo symlink; elif [ -d ${q(path)} ]; then echo dir; elif [ -e ${q(path)} ]; then echo file; else echo absent; fi`;
	return [
		`printf 'passwd_home=%s\\n' "$(getent passwd "$(id -un)" | cut -d: -f6)"`,
		`printf 'legacy=%s\\n' "$(${kind(`${LEGACY_HOME_PREFIX}${name}`)})"`,
		`printf 'target=%s\\n' "$(${kind(target)})"`,
		`printf 'users_fs=%s\\n' "$(stat -c %d ${USERS_PREFIX} 2>/dev/null || stat -c %d / 2>/dev/null || echo unknown)"`,
		`printf 'home_fs=%s\\n' "$(stat -c %d ${LEGACY_HOME_PREFIX} 2>/dev/null || echo unknown)"`,
		`printf 'physical=%s\\n' "$(grep -cxF ${q(PHYSICAL_LINE)} "$HOME/.bashrc" 2>/dev/null || true)"`,
	].join("; ");
}

function parseProbe(stdout: string): Layout {
	const answers = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return {
		passwdHome: answers.get("passwd_home") ?? "",
		legacy: answers.get("legacy") ?? "unknown",
		target: answers.get("target") ?? "unknown",
	};
}

/** The configured target home, or a refusal naming what to set. */
async function targetHome(ctx: TaskContext, name: string): Promise<string> {
	const configured = ctx.machine?.home ?? "";
	if (!configured.startsWith(USERS_PREFIX)) {
		throw new Error(
			`The home-path feature moves your home to ${USERS_PREFIX}${name}, and this machine's hyperdrive config doesn't say so: \`machines.${ctx.machine?.name ?? "<machine>"}.home\` is ${configured === "" ? "not set" : `\`${configured}\``}. Set it to ${USERS_PREFIX}${name} (\`hyper machine add ${ctx.machine?.name ?? "<machine>"} --home ${USERS_PREFIX}${name}\`) if that is where you want it, or drop \`home-path\` from the features. Nothing has been changed.`,
		);
	}
	if (configured.replace(/\/+$/, "") !== `${USERS_PREFIX}${name}`) {
		throw new Error(
			`\`machines.${ctx.machine?.name ?? "<machine>"}.home\` is \`${configured}\`, but home-path is about this machine's own user, \`${name}\`: it would have to be exactly ${USERS_PREFIX}${name}. Nothing has been changed.`,
		);
	}
	return `${USERS_PREFIX}${name}`;
}

async function layout(ctx: TaskContext): Promise<{ layout: Layout; target: string; name: string }> {
	const primaryUser = await primaryUserOf(ctx);
	const target = await targetHome(ctx, primaryUser);
	const result = await runScript(ctx, probe(target, primaryUser));
	if (result.code !== 0) {
		throw new Error(
			`I couldn't read the home layout on ${ctx.machine?.name ?? "this machine"}: ${result.stderr.trim() || `exit ${result.code}`}`,
		);
	}
	return { layout: parseProbe(result.stdout), target, name: primaryUser };
}

export const homePathSymlink: Task = {
	id: "home-path.symlink",
	feature: "home-path",
	needsRoot: true,
	title: "your real home at /Users/<name>, with /home/<name> as a symlink to it",

	async check(ctx: TaskContext): Promise<boolean> {
		const { layout: state, target } = await layout(ctx);
		const problem = layoutProblem(state, target, await primaryUserOf(ctx));
		if (problem === null) return true;
		ctx.log(
			problem === "move" || problem === "missing-symlink"
				? `home-path.symlink: not settled — the home is at ${state.passwdHome} and ${target} is not there yet. Run the root script, then re-run setup.`
				: `home-path.symlink: refusing — ${problem}. Nothing has been changed.`,
		);
		return false;
	},

	rootScript(ctx: TaskContext): string {
		// The user and both paths are worked out BY THE SCRIPT, from $SUDO_USER and
		// the password database, so a script written on one machine and run later
		// acts on what is actually there.
		return `# The same home path on this machine and on your Mac.
#
# Your real home is ${USERS_PREFIX}<name> and ${LEGACY_HOME_PREFIX}<name> becomes a symlink to
# it, so a path recorded on either machine resolves on both.
#
# If your home is already at ${USERS_PREFIX}<name>, the only step is the symlink. If it is still
# at ${LEGACY_HOME_PREFIX}<name>, this MOVES that one directory (a rename on one filesystem,
# which preserves its owner, its modes and its ACLs exactly) and then creates the
# symlink. The exact commands are:
#
#     usermod -d ${USERS_PREFIX}<name> <name>      # the home the passwd entry names
#     install -d -m 0755 ${USERS_PREFIX}
#     mv ${LEGACY_HOME_PREFIX}<name> ${USERS_PREFIX}<name>
#     ln -s ${USERS_PREFIX}<name> ${LEGACY_HOME_PREFIX}<name>
#
# Nothing else is touched: not /home itself, not any other user, no file inside
# your home. Every step is guarded, and every step after the usermod is rolled
# back if the next one fails, so the script can be re-run from any state it can
# be interrupted in.

${rootScriptGuards("unused-agent-user")}
${primaryUserLines(ctx)}
name="$primary_user"
legacy_home=${LEGACY_HOME_PREFIX}"$name"
target_home=${USERS_PREFIX}"$name"

refuse() {
  echo "hyper: $*" >&2
  echo "hyper: nothing has been changed." >&2
  exit 1
}

recorded_home="$(getent passwd "$primary_user" | cut -d: -f6)"
[ -n "$recorded_home" ] || refuse "I can't find the passwd entry for '$primary_user'"

# Already the shape we want: the real home at /Users, the legacy path a symlink.
if [ "$recorded_home" = "$target_home" ]; then
  if [ -L "$legacy_home" ]; then
    echo "hyper: $legacy_home already points at $target_home; nothing to do."
    exit 0
  fi
  [ -e "$legacy_home" ] && refuse "$legacy_home exists and is not a symlink"
  install -d -m 0755 ${USERS_PREFIX}
  ln -s "$target_home" "$legacy_home"
  echo "hyper: $legacy_home -> $target_home"
  exit 0
fi

# Everything below is the move. Each precondition is checked BEFORE anything is
# changed, so a refusal always leaves the machine exactly as it was.
[ "$recorded_home" = "$legacy_home" ] \\
  || refuse "the passwd entry says $recorded_home, which is neither $legacy_home nor $target_home"
[ -d "$legacy_home" ] && [ ! -L "$legacy_home" ] \\
  || refuse "$legacy_home is not a real directory"
[ ! -e "$target_home" ] \\
  || refuse "$target_home already exists; move it aside yourself, then re-run"

# One filesystem, or mv would copy a home directory tree instead of renaming it.
home_fs="$(stat -c %d ${LEGACY_HOME_PREFIX} 2>/dev/null || echo none)"
root_fs="$(stat -c %d / 2>/dev/null || echo none)"
[ -n "$root_fs" ] && [ "$home_fs" = "$root_fs" ] \\
  || refuse "${LEGACY_HOME_PREFIX} and / are on different filesystems ($home_fs vs $root_fs), so moving the home would copy it rather than rename it. Put them on one filesystem first."

# usermod refuses while the user has ANY process, including the ssh session
# running this script. Checked here so the refusal happens before the move, and
# says how to run it instead of failing halfway.
busy_pids="$(pgrep -u "$primary_user" 2>/dev/null | tr '\\n' ' ' | sed 's/ $//')"
if [ -n "$busy_pids" ]; then
  echo "hyper: '$primary_user' still has processes running (pids: $busy_pids)." >&2
  echo "       usermod will not change a home directory while that is true, and" >&2
  echo "       doing the move first would leave your home half-way between two" >&2
  echo "       paths. Nothing has been changed. Close EVERY session of" >&2
  echo "       '$primary_user' — every ssh login, every terminal — and re-run this" >&2
  echo "       script. A root console helps only if no session of that user is" >&2
  echo "       open anywhere else; \`loginctl terminate-user $primary_user\` closes" >&2
  echo "       them all from root." >&2
  echo "       To do that one step by hand, from a root console:" >&2
  echo "           usermod -d $target_home $primary_user" >&2
  echo "       then re-run this script; it picks up from there and does the rest." >&2
  exit 1
fi

usermod -d "$target_home" "$primary_user" \\
  || refuse "usermod would not change the home directory"
if ! install -d -m 0755 ${USERS_PREFIX} || ! mv "$legacy_home" "$target_home"; then
  usermod -d "$legacy_home" "$primary_user" || true
  refuse "the move failed; the passwd entry has been put back"
fi
if ! ln -s "$target_home" "$legacy_home"; then
  mv "$target_home" "$legacy_home" || true
  usermod -d "$legacy_home" "$primary_user" || true
  refuse "the symlink could not be created; the move has been undone"
fi
echo "hyper: $target_home is your home; $legacy_home -> $target_home"
echo "hyper: log out and back in, so your shell picks the new path up."
`;
	},
};

/**
 * `home-path.physical` — the shell half, with no root.
 *
 * `set -o physical` makes `pwd` (and a plain `cd`) print the REAL path, so
 * `cd /home/svallory/x` reports `/Users/svallory/x` once the symlink is in
 * place. That is the acceptance line for the feature, and without this line it
 * reports the legacy spelling and every recorded path is machine-specific
 * again.
 *
 * The same line is already written by the agent-user layout, so this task
 * shares `ensureBashrcLine` with it: selecting both features writes it once.
 */
export const homePathPhysical: Task = {
	id: "home-path.physical",
	feature: "home-path",
	needsRoot: false,
	title: "`set -o physical` in your shell, so `pwd` prints the real path",

	async check(ctx: TaskContext): Promise<boolean> {
		const home = await homeOf(ctx);
		const result = await runScript(
			ctx,
			`grep -cxF ${shellQuote(PHYSICAL_LINE)} ${shellQuote(`${home}/.bashrc`)} 2>/dev/null || true`,
		);
		if (result.code !== 0 || Number.parseInt(result.stdout.trim() || "0", 10) === 0) {
			ctx.log(
				`home-path.physical: not settled — ${home}/.bashrc has no \`${PHYSICAL_LINE}\` line.`,
			);
			return false;
		}
		return true;
	},

	async apply(ctx: TaskContext): Promise<void> {
		const home = await homeOf(ctx);
		// Never CREATE the home to put a line in it. `home-path.physical` is not a
		// root task, so it runs BEFORE `home-path.symlink`'s script — and
		// `ensureBashrcLine` starts with `touch`, which on a machine whose home is
		// still at /home/<name> would create an empty /Users/<name> and make the
		// move refuse its own target. The line is written after the move instead,
		// on the next run, which is when the home really is at that path.
		const there = await runScript(ctx, `test -d ${shellQuote(home)} && echo yes || echo no`);
		if (there.stdout.trim() !== "yes") {
			ctx.log(
				`home-path.physical: ${home} isn't there yet — run the home-path root script first (it moves your home there), then re-run setup.`,
			);
			return;
		}
		await runOrFail(
			ctx,
			`add "${PHYSICAL_LINE}" to your .bashrc`,
			ensureBashrcLine(`${home}/.bashrc`, PHYSICAL_LINE),
		);
	},
};
