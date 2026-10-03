/** Unprivileged watcher: shared transcripts plus one-level home/config protection. */
import { createHash } from "node:crypto";
import { shellQuote } from "#services/remote";
import { accessPolicyShell, accessRepairShell, directEntriesShell } from "./agent-acl.js";
import {
	agentPaths,
	agentUserOf,
	homeOf,
	primaryUserLines,
	primaryUserOf,
} from "./agent-context.js";
import { runOrFail, runScript } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

export const WATCHER_BIN = "claude-share-watch";
export const WATCHER_UNIT = "claude-share-watch.service";

export function watcherScript(projectsDir: string, home: string, agentUser = "agent"): string {
	const paths = agentPaths(home, "");
	return `#!/usr/bin/env bash
# One policy for the startup sweep, live events, setup and the read-only check.
${accessPolicyShell(paths, agentUser)}
${accessRepairShell()}
projects=${shellQuote(projectsDir)}
me=$(id -u)

on_new() {
  repair_entry "$1" || printf 'hyper: could not protect %s\\n' "$1" >&2
}
widen() {
  [ -L "$1" ] && return 0
  [ -f "$1" ] || [ -d "$1" ] || return 0
  [ "$(stat -c %u "$1" 2>/dev/null || echo x)" = "$me" ] || return 0
  # A transcript moved from the home may carry the private named-user deny.
  # The shared tree is group-based: drop that override before widening its mask.
  if getfacl -c -p "$1" | grep -q "^user:$agent_user:"; then
    setfacl -x "u:$agent_user" "$1" || return 1
  fi
  if [ -d "$1" ]; then
    if getfacl -c -p "$1" | grep -q "^default:user:$agent_user:"; then
      setfacl -x "d:u:$agent_user" "$1" || return 1
    fi
    acl_has "$1" 'default:group:collab:rwx' || setfacl -d -m g:collab:rwx "$1" || return 1
    case "$(group_digit "$(mode3 "$1")")" in 7) return 0 ;; esac
    chmod g+rwx "$1"
  else
    # Avoid an attrib feedback loop: only change masks that lack rw.
    case "$(group_digit "$(mode3 "$1")")" in 6|7) return 0 ;; esac
    chmod g+rw "$1"
  fi
}
sweep() {
${directEntriesShell(paths.home, '  on_new "$entry"')}
${directEntriesShell(paths.claude, '  on_new "$entry"')}
  while IFS= read -r -d '' path; do widen "$path"; done < <(
    find "$projects" -xdev -user "$me" ! -type l -print0 2>/dev/null
  )
}
sweep

# attrib includes chmod, including the zero-group/nonzero-other bypass state.
watch_dir() {
  inotifywait -m -q -e create -e moved_to -e attrib --format '%w%f' "$1" 2>/dev/null |
    while IFS= read -r p; do on_new "$p"; done
}
watch_projects() {
  inotifywait -m -r -q -e create -e moved_to -e attrib --format '%w%f' "$projects" 2>/dev/null |
    while IFS= read -r p; do widen "$p"; done
}
watch_dir ${shellQuote(paths.home)} &
watch_dir ${shellQuote(paths.claude)} &
watch_projects &
wait
`;
}

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

function probe(bin: string, unitPath: string, primaryUser: string, scriptHash: string): string {
	const q = shellQuote;
	return [
		`hash=$(sha256sum ${q(bin)} 2>/dev/null || true)`,
		`printf 'watcher_content=%s\\n' "$(test "\${hash%% *}" = ${q(scriptHash)} && echo yes || echo no)"`,
		`printf 'watcher=%s\\n' "$(test -x ${q(bin)} && echo yes || echo no)"`,
		`printf 'unit=%s\\n' "$(test -f ${q(unitPath)} && echo yes || echo no)"`,
		`printf 'enabled=%s\\n' "$(systemctl --user is-enabled ${q(WATCHER_UNIT)} 2>/dev/null || true)"`,
		`printf 'active=%s\\n' "$(systemctl --user is-active ${q(WATCHER_UNIT)} 2>/dev/null || true)"`,
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(primaryUser)} --property=Linger --value 2>/dev/null || true)"`,
		`printf 'inotifywait=%s\\n' "$(command -v inotifywait >/dev/null 2>&1 && echo yes || echo no)"`,
	].join("\n");
}

export const agentUserWatcher: Task = {
	id: "agent-user.watcher",
	feature: "agent-user",
	needsRoot: false,
	title: "the transcript watcher, so new sessions are shared as they are written",

	async check(ctx: TaskContext): Promise<boolean> {
		const primaryUser = await primaryUserOf(ctx);
		const home = await homeOf(ctx);
		const no = (why: string): false => {
			ctx.log(`agent-user.watcher: not settled — ${why}`);
			return false;
		};
		const result = await runScript(
			ctx,
			probe(
				`${home}/.local/bin/${WATCHER_BIN}`,
				`${home}/.config/systemd/user/${WATCHER_UNIT}`,
				primaryUser,
				createHash("sha256")
					.update(watcherScript(`${home}/.claude/projects`, home, await agentUserOf(ctx)))
					.digest("hex"),
			),
		);
		if (result.code !== 0) return no(`the probe failed: ${result.stderr.trim() || result.code}`);
		const answer = new Map(
			result.stdout.split("\n").map((line) => {
				const at = line.indexOf("=");
				return [line.slice(0, at), line.slice(at + 1).trim()];
			}),
		);
		for (const [key, expected, why] of [
			["inotifywait", "yes", "inotifywait is missing; run the create root script"],
			["watcher", "yes", "the watcher script is missing or not executable"],
			[
				"watcher_content",
				"yes",
				"the installed watcher is out of date; re-run setup to replace it",
			],
			["unit", "yes", "the user service unit is missing"],
			["enabled", "enabled", "the user service is not enabled"],
			["active", "active", "the user service is not active"],
			["linger", "yes", "linger is disabled for the primary user"],
		])
			if (answer.get(key) !== expected) return no(why);
		return true;
	},

	async apply(ctx: TaskContext): Promise<void> {
		const home = await homeOf(ctx);
		const bin = `${home}/.local/bin/${WATCHER_BIN}`;
		const unitPath = `${home}/.config/systemd/user/${WATCHER_UNIT}`;
		await runOrFail(
			ctx,
			"install the transcript watcher",
			[
				`mkdir -p ${shellQuote(`${home}/.local/bin`)}`,
				`cat > ${shellQuote(bin)} <<'HYPER_SHARE_WATCH_EOF'`,
				watcherScript(`${home}/.claude/projects`, home, await agentUserOf(ctx)).trimEnd(),
				"HYPER_SHARE_WATCH_EOF",
				`chmod 0755 ${shellQuote(bin)}`,
			].join("\n"),
		);
		await runScript(ctx, `loginctl enable-linger ${shellQuote(await primaryUserOf(ctx))}`);
		await runOrFail(
			ctx,
			"install and start the watcher unit",
			[
				`mkdir -p ${shellQuote(`${home}/.config/systemd/user`)}`,
				`cat > ${shellQuote(unitPath)} <<'HYPER_SHARE_WATCH_UNIT_EOF'`,
				watcherUnit().trimEnd(),
				"HYPER_SHARE_WATCH_UNIT_EOF",
				"systemctl --user daemon-reload",
				`systemctl --user enable --now ${shellQuote(WATCHER_UNIT)}`,
				// enable --now leaves an already-running old script in memory.
				`systemctl --user restart ${shellQuote(WATCHER_UNIT)}`,
			].join("\n"),
		);
	},

	rootFallback(ctx: TaskContext): string {
		return `# Keep the primary user's units alive after logout.
${primaryUserLines(ctx)}
loginctl enable-linger "$primary_user"
`;
	},
};
