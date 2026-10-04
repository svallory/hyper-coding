/** One policy for setup, its read-only check, and the live watcher. */
import { isValidAgentUser } from "#config/schema";
import { shellQuote } from "#services/remote";
import type { AgentPaths } from "./agent-context.js";
import { shellCommand } from "./shell.js";

export const COLLAB_GROUP = "collab";

/**
 * Restart the primary's `systemd --user` manager when — and only when — it is
 * running without the collab group.
 *
 * A running process never gains a group, and with linger the manager is never
 * restarted short of a reboot. One started BEFORE the membership was added
 * therefore runs without collab forever, and so does the transcript watcher it
 * hosts: that watcher's `setfacl` strips setgid bits it cannot restore, and its
 * `chgrp` fails (the T-16 flake's product cause). The repair is restarting
 * `user@<uid>.service`, which is root-only work, so this fragment lives in
 * generated root scripts: `agent-user.create`'s, after the `usermod -aG`, and
 * the watcher task's root fallback, for machines an older setup already left in
 * that state.
 *
 * Guarded three ways, so a second run is a no-op (C-15): a stopped manager
 * picks the group up when it next starts (nothing to do), an already-correct
 * one is left alone, and the group must resolve at all. The fragment assumes
 * `$primary_user` is set (rootScriptGuards / primaryUserLines) and says out
 * loud what a restart costs: it ends the primary's user services.
 */
export function managerCollabRestartLines(): string {
	return `# The primary's systemd --user manager only sees the groups it STARTED with:
# a running process never gains one, and with linger it is never restarted short
# of a reboot. If it is running WITHOUT the ${COLLAB_GROUP} group (it started before
# the membership above was added), restart it — otherwise the transcript watcher
# runs without the group until a reboot: its setfacl strips setgid bits it
# cannot restore, and its chgrp fails. A stopped manager picks the group up when
# it next starts, and an already-correct one is left alone (C-15).
primary_uid="$(id -u "$primary_user")"
collab_gid="$(getent group ${COLLAB_GROUP} | cut -d: -f3 || true)"
manager_pid="$(systemctl show -p MainPID --value "user@$primary_uid.service" 2>/dev/null || true)"
if [ -n "$collab_gid" ] && [ -n "$manager_pid" ] && [ "$manager_pid" != 0 ]; then
  manager_groups="$(sed -n 's/^Groups:[[:space:]]*//p' "/proc/$manager_pid/status" 2>/dev/null || true)"
  case " $manager_groups " in
    *" $collab_gid "*) : the running manager already carries the group ;;
    *)
      echo "hyper: restarting user@$primary_uid.service so the primary's user manager"
      echo "hyper: picks up the ${COLLAB_GROUP} group. THIS ENDS THE PRIMARY'S USER"
      echo "hyper: SERVICES; enabled units (the transcript watcher) start again on"
      echo "hyper: their own."
      systemctl restart "user@$primary_uid.service"
      ;;
  esac
fi`;
}
export const READABLE_FILES = ["settings.json", "CLAUDE.md"] as const;
export const READABLE_DIRS = ["skills", "commands", "agents"] as const;
export const SHARED_ENTRIES = ["projects", ...READABLE_FILES, ...READABLE_DIRS] as const;

/**
 * Read-only shell, byte-identical in all consumers. ACL_USER is decisive before
 * all group entries; a group deny is NOT decisive against other matching groups.
 * Even ACL_USER is skipped by acl_permission_check when the mode's group bits
 * are zero, so the zero-mask/nonzero-other state must still be tightened.
 */
export function accessPolicyShell(
	paths: Pick<AgentPaths, "home" | "work" | "claude">,
	agentUser = "agent",
): string {
	if (!isValidAgentUser(agentUser))
		throw new Error("The access policy needs a valid, non-root agent user name");
	const patterns = (names: readonly string[]) => names.map(shellQuote).join("|");
	return `# BEGIN hyper agent access policy
agent_user=${shellQuote(agentUser)}
entry_scope() {
  # inotify attrib events for watched directories end with a slash.
  case "$1" in */) entry_scope "\${1%/}"; return ;; esac
  if [ -L "$1" ] || [ ! -e "$1" ]; then echo skip; return; fi
  case "$1" in
    ${shellQuote(paths.work)}|${shellQuote(paths.claude)}) echo skip; return ;;
  esac
  case "$(dirname -- "$1")" in
    ${shellQuote(paths.home)}) echo deny ;;
    ${shellQuote(paths.claude)})
      case "$(basename -- "$1")" in
        ${patterns(READABLE_FILES)}) echo read_file ;;
        ${patterns(READABLE_DIRS)}) echo read_dir ;;
        projects) echo skip ;;
        *) echo deny ;;
      esac ;;
    *) echo skip ;;
  esac
}
entry_kind() {
  kind=$(entry_scope "$1")
  if [ "$kind" = deny ] && [ "$(stat -c %u "$1")" != "$(id -u)" ]; then
    echo unowned
  else
    echo "$kind"
  fi
}
mode3() {
  m=$(stat -c %a "$1") || return 1
  # GNU stat omits leading zeroes: 0004 is printed as 4, not 004.
  m=00$m
  while [ \${#m} -gt 3 ]; do m=\${m#?}; done
  printf '%s' "$m"
}
group_digit() { printf '%s' "$1" | cut -c2; }
other_digit() { printf '%s' "$1" | cut -c3; }
bad_state() {
  m=$(mode3 "$1") || return 0
  [ "$(group_digit "$m")" = 0 ] && [ "$(other_digit "$m")" != 0 ]
}
acl_has() { getfacl -c -p "$1" | grep -qxF "$2"; }
legacy_group() { getfacl -c -p "$1" | grep -qE '^(default:)?group:${COLLAB_GROUP}:'; }
unprotected() {
  ! acl_has "$1" "user:$agent_user:---" || bad_state "$1"
}
shared_access() {
  case "$(entry_kind "$1")" in
    read_file) echo r-- ;;
    read_dir) echo r-X ;;
    *) return 1 ;;
  esac
}
shared_default() {
  [ "$(entry_kind "$1")" = read_dir ] || return 1
  access=$(shared_access "$1" | tr X x)
  echo "u::rwx,u:$agent_user:$access,g::$access,o::---"
}
shared_ok() {
  access=$(shared_access "$1" | tr X x) || return 1
  if legacy_group "$1"; then return 1; fi
  acl_has "$1" "user:$agent_user:$access" || return 1
  if [ "$(entry_kind "$1")" = read_dir ]; then
    if getfacl -c -p "$1" | grep -q '^default:group:collab:'; then return 1; fi
    acl_has "$1" "default:user:$agent_user:$access" || return 1
    acl_has "$1" 'default:other::---' || return 1
  fi
}
# END hyper agent access policy`;
}

/**
 * Runs inside `find -execdir`, whose shell gets only what is exported. Keep it
 * self-contained: the group name is interpolated, the ACL strings are exported
 * by the caller, and it never depends on the agent-writable working directory.
 */
const GRANT_SHARED_TRAVERSAL = `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
grant_shared_entry() {
  setfacl -m "u:$agent_user:$access" "$1" || return 1
  if getfacl -c -p "$1" | grep -qE '^(default:)?group:${COLLAB_GROUP}:'; then
    setfacl -x g:${COLLAB_GROUP} "$1" || return 1
    [ ! -d "$1" ] || setfacl -x d:g:${COLLAB_GROUP} "$1" || return 1
  fi
  [ ! -d "$1" ] || setfacl -d -m "$default_acl" "$1" || return 1
}
for path; do grant_shared_entry "$path" || exit 1; done`;

/** Mutations use the same policy and agent identity; never included in a check. */
export function accessRepairShell(): string {
	return `perms_of() {
  case "$1" in
    0) echo --- ;; 1) echo --x ;; 2) echo -w- ;; 3) echo -wx ;;
    4) echo r-- ;; 5) echo r-x ;; 6) echo rw- ;; 7) echo rwx ;;
  esac
}
protect() {
  acl_has "$1" "user:$agent_user:---" || setfacl -m "u:$agent_user:---" "$1" || return 1
  if legacy_group "$1"; then
    setfacl -x g:${COLLAB_GROUP} "$1" || return 1
    # A moved directory retains its old defaults. Clean only this directory;
    # its named-user deny blocks traversal regardless of its children's ACLs.
    if [ -d "$1" ]; then setfacl -x d:g:${COLLAB_GROUP} "$1" || return 1; fi
  fi
  if bad_state "$1"; then chmod o-rwx "$1" || return 1; fi
}
grant_shared() {
  access=$(shared_access "$1") || return 1
  if [ "$(entry_kind "$1")" != read_dir ]; then
    setfacl -m "u:$agent_user:$access" "$1" || return 1
    if legacy_group "$1"; then setfacl -x g:${COLLAB_GROUP} "$1" || return 1; fi
    return 0
  fi
  default_acl=$(shared_default "$1") || return 1
  grant_shared_entry "$1" || return 1
  # One pruned traversal instead of a recursive setfacl. A recursive grant into
  # an agent-owned 0700 subtree fails on "Permission denied", which turned one
  # directory the agent could create at will into denial of the whole grant.
  # The primary can neither reach nor repair inside a pruned subtree.
  # -user "$(id -u)" on the execdir branch: only entries this user OWNS are
  # granted. setfacl on somebody else's file is EPERM however readable it is,
  # and one such file under skills/ used to abort the whole traversal, so the
  # dirs apply stopped on it. Such entries are skipped here and REPORTED by
  # foreignEntriesShell(), which selects exactly the complement (! -user).
  # find resolves the shell through PATH, so pin it before execdir too.
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH access default_acl agent_user
  find "$1" -xdev \\( -type d ! -user "$(id -u)" ! -readable -prune \\) -o \\
    -mindepth 1 ! -type l -user "$(id -u)" -execdir ${shellCommand(GRANT_SHARED_TRAVERSAL)} {} +
}
grant_shared_entry() {
  setfacl -m "u:$agent_user:$access" "$1" || return 1
  if legacy_group "$1"; then setfacl -x g:${COLLAB_GROUP} "$1" || return 1; fi
  if [ -d "$1" ]; then
    if legacy_group "$1"; then setfacl -x d:g:${COLLAB_GROUP} "$1" || return 1; fi
    setfacl -d -m "$default_acl" "$1" || return 1
  fi
}
repair_entry() {
  case "$(entry_kind "$1")" in
    deny) if unprotected "$1" || legacy_group "$1"; then protect "$1"; fi ;;
    read_file|read_dir) if ! shared_ok "$1"; then grant_shared "$1"; fi ;;
  esac
}`;
}

/** Glob expansion preserves spaces/quotes, includes dotfiles, and never descends. */
export function directEntriesShell(dir: string, body: string): string {
	const q = shellQuote(dir);
	return `for entry in ${q}/* ${q}/.[!.]* ${q}/..?*; do\n${body}\ndone`;
}

/**
 * Entries inside a shared config dir this user does not own.
 *
 * These are exactly what the traversal above now skips: a file the primary
 * cannot `setfacl` because it belongs to somebody else. Silently skipping them
 * would mean the agent quietly cannot read one of the shared entries and
 * nothing says so, so the check reports them like the shared trees report the
 * entries it cannot repair — a warning with a count and the first few paths,
 * never a failure, because no unprivileged run can fix them.
 */
export function foreignEntriesShell(dir: string): string {
	return `find ${shellQuote(dir)} -xdev \\( -type d ! -user "$(id -u)" ! -readable -prune \\) -o -mindepth 1 ! -type l ! -user "$(id -u)" -printf '%p,' 2>/dev/null`;
}

export function unprotectedEntriesShell(dir: string): string {
	return directEntriesShell(
		dir,
		`  if [ "$(entry_kind "$entry")" = deny ] && unprotected "$entry"; then printf '%s,' "$entry"; fi`,
	);
}

/** These cannot be repaired unprivileged. Warn rather than silently claiming protection. */
export function unownedEntriesShell(dir: string): string {
	return directEntriesShell(
		dir,
		`  if [ "$(entry_kind "$entry")" = unowned ]; then printf '%s,' "$entry"; fi`,
	);
}
