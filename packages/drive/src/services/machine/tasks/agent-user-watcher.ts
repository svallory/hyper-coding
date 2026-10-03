/**
 * `agent-user.watcher` — keeps freshly written transcripts shared.
 *
 * The problem, from the discovery notes: Claude Code creates session files 0600
 * and replaces `settings.json` by writing a new file. Every one of those writes
 * masks whatever ACL the file had, and `chmod 0600` by the writer beats any
 * default ACL the directory carries. So `agent-user.dirs` can set up the
 * directories, and files created afterwards still land private.
 *
 * The fix is a per-user watcher: `inotifywait` on the shared transcripts dir,
 * `chmod g+rw` on what this user owns. It runs unprivileged, one instance per
 * user, and can only touch files that user owns — which is the whole reason it
 * is per-user rather than one privileged instance watching everything.
 *
 * It is a `systemd --user` unit, not a system template unit as on the machine
 * this was copied from: a user unit needs no root to install or start, and
 * `loginctl enable-linger` on yourself is allowed by stock polkit. Where polkit
 * says otherwise, the one root step is offered as a fallback (see `rootFallback`
 * on {@link Task}) rather than making this whole task a root task — everything
 * else here is your own user's work and has no business behind a password.
 */

import { shellQuote } from "#services/remote";
import { homeOf, primaryUserLines, primaryUserOf } from "./agent-context.js";
import {
	CLAUDE_CHILDREN_ALLOWED,
	COLLAB_GROUP,
	READABLE_FILES,
	TOP_LEVEL_ALLOWED,
} from "./agent-user-dirs.js";
import { runOrFail, runScript } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/** The script name, in `~/.local/bin`. Pinned: the unit points at this path. */
export const WATCHER_BIN = "claude-share-watch";

/** The unit name, for `systemctl --user`. */
export const WATCHER_UNIT = "claude-share-watch.service";

/**
 * The watcher, from the machine it was proven on.
 *
 * `find … -user "$me"` is the security property: this process can only widen
 * permissions on files its own user owns, so running one per user needs no root
 * and can't be pointed at somebody else's data. The `-perm -g=` guards make it
 * idempotent and cheap — only files that actually need it are touched.
 */
export function watcherScript(projectsDir: string, home: string): string {
	const claude = `${home}/.claude`;
	const denyGroup = shellQuote(COLLAB_GROUP);
	// `case` patterns, built from the same names the ACLs use. Written out once
	// here rather than inline in the script, so a rename cannot leave the watcher
	// disagreeing with the ACLs.
	const sharedFilesPattern = READABLE_FILES.join("|");
	const homeAllowedPattern = TOP_LEVEL_ALLOWED.join("|");
	// The same exclusions for the startup sweep's `find`, which walks one level
	// and must skip exactly what the `case` statements above skip.
	const skipNames = [...TOP_LEVEL_ALLOWED, ...CLAUDE_CHILDREN_ALLOWED]
		.map((name) => `! -name ${shellQuote(name)}`)
		.join(" ");
	return `#!/usr/bin/env bash
# Two jobs, one unprivileged process per user.
#
# 1. SHARED TRANSCRIPTS: Claude Code creates session files 0600 and replaces
#    settings.json by writing a new file, so the group ACLs are masked every
#    time. Widen what this user owns back to group-accessible.
# 2. DENY NEW ENTRIES: the primary's home and config dir deny the shared group,
#    and inherit that deny — but a file that arrives by \`mv\` keeps the ACLs it
#    came with, and a tool that copies ACLs can bring its own. Re-assert the
#    deny on anything new, and re-grant read on the two shared files when they
#    are replaced (the inherited default denies them otherwise).
#
# Runs unprivileged: it can only touch files its own user owns, which is why
# there is one instance per user rather than one privileged watcher.
projects=${shellQuote(projectsDir)}
home=${shellQuote(home)}
claude=${shellQuote(claude)}
deny_group=${denyGroup}
me=$(id -u)

on_new() {
  p="$1"
  [ -L "$p" ] && return 0
  case "$(dirname "$p")" in
    "$claude")
      case "$(basename "$p")" in
        ${sharedFilesPattern}) setfacl -m "g:$deny_group:r--" "$p" 2>/dev/null || true ;;
        *) setfacl -m "g:$deny_group:---" "$p" 2>/dev/null || true ;;
      esac
      ;;
    "$home")
      case "$(basename "$p")" in
        ${homeAllowedPattern}) : ;;   # the shared ones carry their own ACLs
        *) setfacl -m "g:$deny_group:---" "$p" 2>/dev/null || true ;;
      esac
      ;;
  esac
}

widen() {
  [ -f "$1" ] || return 0
  [ "$(stat -c %u "$1" 2>/dev/null || echo x)" = "$me" ] || return 0
  chmod g+rw "$1" 2>/dev/null || true
}

# Sweeps, run once at startup so a restart re-asserts everything.
sweep() {
  for d in "$home" "$claude"; do
    find "$d" -mindepth 1 -maxdepth 1 ! -type l ${skipNames} -exec sh -c \\
      'for p; do getfacl -c -p "$p" 2>/dev/null | grep -q "^group:$deny_group:---$" || setfacl -m "g:$deny_group:---" "$p"; done' _ {} + 2>/dev/null
  done
  find "$projects" -xdev -user "$me" \\
    \\( -type f ! -perm -g=rw -exec chmod g+rw {} + \\) -o \\
    \\( -type d ! -perm -g=rwx -exec chmod g+rwx {} + \\) 2>/dev/null
}
sweep

watch_dir() {
  inotifywait -m -q -e create -e moved_to --format '%w%f' "$1" 2>/dev/null |
    while IFS= read -r p; do on_new "$p"; done
}
watch_projects() {
  inotifywait -m -r -q -e create -e moved_to -e attrib --format '%w%f' "$projects" 2>/dev/null |
    while IFS= read -r p; do widen "$p"; done
}

watch_dir "$home" &
watch_dir "$claude" &
watch_projects &
wait
`;
}

/**
 * The user unit.
 *
 * `WantedBy=default.target` is what makes `systemctl --user enable` enough —
 * there is no `multi-user.target` in a user manager, so the system-unit
 * `WantedBy` from the reference machine does not apply here. `Restart=always`
 * because the whole job is watching: an inotify queue overflow ends the process
 * and it should come straight back.
 */
export function watcherUnit(): string {
	return `[Unit]
Description=Keep this user's Claude Code transcripts group-accessible
After=default.target

[Service]
Type=simple
ExecStart=%h/.local/bin/${WATCHER_BIN}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** Read-only answers: is the script, the unit, and the running service all in place? */
function probe(bin: string, unitPath: string, primaryUser: string): string {
	const q = shellQuote;
	return [
		`printf 'watcher=%s\\n' "$(test -x ${q(bin)} && echo yes || echo no)"`,
		`printf 'unit=%s\\n' "$(test -f ${q(unitPath)} && echo yes || echo no)"`,
		`printf 'enabled=%s\\n' "$(systemctl --user is-enabled ${q(WATCHER_UNIT)} 2>/dev/null || true)"`,
		`printf 'active=%s\\n' "$(systemctl --user is-active ${q(WATCHER_UNIT)} 2>/dev/null || true)"`,
		// Linger on YOURSELF: without it, `systemctl --user` has no session to run
		// in once you log out, and the watcher dies with the last ssh.
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(primaryUser)} --property=Linger --value 2>/dev/null || true)"`,
		`printf 'inotifywait=%s\\n' "$(command -v inotifywait >/dev/null 2>&1 && echo yes || echo no)"`,
	].join("; ");
}

function answers(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return map;
}

export const agentUserWatcher: Task = {
	id: "agent-user.watcher",
	feature: "agent-user",
	needsRoot: false,
	title: "the transcript watcher, so new sessions are shared as they are written",

	async check(ctx: TaskContext): Promise<boolean> {
		const primaryUser = await primaryUserOf(ctx);
		const home = await homeOf(ctx);
		const bin = `${home}/.local/bin/${WATCHER_BIN}`;
		const unitPath = `${home}/.config/systemd/user/${WATCHER_UNIT}`;
		const result = await runScript(ctx, probe(bin, unitPath, primaryUser));
		if (result.code !== 0) return false;
		const answer = answers(result.stdout);
		// No inotifywait means nothing to enable; the packages are the root
		// script's business, so this is "not yet", not "broken".
		if (answer.get("inotifywait") !== "yes") return false;
		if (answer.get("watcher") !== "yes") return false;
		if (answer.get("unit") !== "yes") return false;
		if (answer.get("enabled") !== "enabled") return false;
		if (answer.get("active") !== "active") return false;
		return answer.get("linger") === "yes";
	},

	async apply(ctx: TaskContext): Promise<void> {
		const home = await homeOf(ctx);
		const bin = `${home}/.local/bin/${WATCHER_BIN}`;
		const unitPath = `${home}/.config/systemd/user/${WATCHER_UNIT}`;

		// The script. Heredoc-quoted so the `$(…)` and `$1` inside it reach the
		// watcher verbatim instead of being expanded by whatever shell ran this.
		await runOrFail(
			ctx,
			"install the transcript watcher",
			[
				`mkdir -p ${shellQuote(`${home}/.local/bin`)}`,
				`cat > ${shellQuote(bin)} <<'HYPER_SHARE_WATCH_EOF'`,
				watcherScript(`${home}/.claude/projects`, home).trimEnd(),
				"HYPER_SHARE_WATCH_EOF",
				`chmod 0755 ${shellQuote(bin)}`,
			].join("\n"),
		);

		// Linger first: without it `systemctl --user enable --now` starts a unit
		// that dies at logout, and the failure would look like the unit's fault.
		await runScript(ctx, `loginctl enable-linger ${shellQuote(await primaryUserOf(ctx))}`);

		await runOrFail(
			ctx,
			"install and start the watcher unit",
			[
				`mkdir -p ${shellQuote(`${home}/.config/systemd/user`)}`,
				`cat > ${shellQuote(unitPath)} <<'HYPER_SHARE_WATCH_UNIT_EOF'`,
				watcherUnit().trimEnd(),
				"HYPER_SHARE_WATCH_UNIT_EOF",
				// daemon-reload is required or systemd keeps the previous (nonexistent)
				// unit definition and enable fails with a confusing message.
				`systemctl --user daemon-reload`,
				`systemctl --user enable --now ${shellQuote(WATCHER_UNIT)}`,
			].join("\n"),
		);
	},

	/**
	 * The one root step this task can need, offered only when everything else
	 * already worked and linger is still off — which on a machine with a polkit
	 * rule against it means `loginctl enable-linger` failed without a password.
	 *
	 * Idempotent: `enable-linger` on a user that already lingers is a no-op.
	 */
	rootFallback(ctx: TaskContext): string {
		return `# Keep your own systemd --user units (the transcript watcher) alive
# after you log out. Stock polkit allows this without a password; on a machine
# whose rules don't, this is the step that has to be root.
${primaryUserLines(ctx)}
loginctl enable-linger "$primary_user"
`;
	},
};
