/** One policy for setup, its read-only check, and the live watcher. */
import { isValidAgentUser } from "#config/schema";
import { shellQuote } from "#services/remote";
import type { AgentPaths } from "./agent-context.js";

export const COLLAB_GROUP = "collab";
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
  if [ "$(entry_kind "$1")" = read_dir ]; then
    setfacl -R -P -m "u:$agent_user:$access" "$1" || return 1
    setfacl -R -P -x g:${COLLAB_GROUP} "$1" || return 1
    find "$1" -type d -exec setfacl -x d:g:${COLLAB_GROUP} {} + || return 1
    find "$1" -type d -exec setfacl -d -m "$(shared_default "$1")" {} + || return 1
  else
    setfacl -m "u:$agent_user:$access" "$1" || return 1
    if legacy_group "$1"; then setfacl -x g:${COLLAB_GROUP} "$1" || return 1; fi
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
