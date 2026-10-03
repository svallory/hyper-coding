/** Shared work/transcript rules, identical in setup, checks and watcher events. */
import { shellQuote } from "#services/remote";
import { shellCommand } from "./shell.js";

/** Read-only predicate; keep repair and watcher convergence tied to this policy. */
export function sharedTreePolicyShell(agentUser = "agent"): string {
	return `# BEGIN hyper shared tree policy
tree_agent=${shellQuote(agentUser)}
shared_tree_access_ok() {
  if [ -d "$1" ]; then
    getfacl -c -p "$1" | grep -qxF 'group:collab:rwx'
  else
    getfacl -c -p "$1" | grep -qE '^group:collab:rw[-x]([[:space:]]+#effective:rw[-x])?$'
  fi
}
shared_tree_default_ok() {
  if getfacl -c -p "$1" | grep -q "^default:user:$tree_agent:"; then return 1; fi
  getfacl -c -p "$1" | grep -qxF 'default:group:collab:rwx'
}
shared_tree_ok() {
  [ "$(stat -c %G "$1")" = collab ] || return 1
  if getfacl -c -p "$1" | grep -q "^user:$tree_agent:"; then return 1; fi
  shared_tree_access_ok "$1" || return 1
  if [ -d "$1" ]; then
    [ -g "$1" ] || return 1
    shared_tree_default_ok "$1" || return 1
  fi
}
# END hyper shared tree policy`;
}

/** The single mutation implementation, used by setup and the live watcher. */
export function sharedTreeRepairShell(agentUser = "agent"): string {
	return `${sharedTreePolicyShell(agentUser)}
shared_tree_repair() {
  [ -L "$1" ] && return 0
  [ -e "$1" ] || return 0
  [ "$(stat -c %u "$1")" = "$(id -u)" ] || return 0
  # No changes once settled: chmod/setfacl themselves generate attrib events.
  if shared_tree_ok "$1"; then return 0; fi
  if getfacl -c -p "$1" | grep -q "^user:$tree_agent:"; then
    setfacl -x "u:$tree_agent" "$1" || return 1
  fi
  if [ "$(stat -c %G "$1")" != collab ]; then chgrp -h collab "$1" || return 1; fi
  chmod g+rwX "$1" || return 1
  if [ -d "$1" ]; then
    chmod g+s "$1" || return 1
    if ! shared_tree_default_ok "$1"; then
      setfacl -x "d:u:$tree_agent" "$1" || return 1
      setfacl -d -m g:collab:rwX "$1" || return 1
    fi
  fi
  # Do not recalculate a file's mask when chmod already restored effective rw.
  if ! shared_tree_access_ok "$1"; then setfacl -m g:collab:rwX "$1" || return 1; fi
}`;
}

/** Read-only list of primary-owned entries this user can repair. Never follows links. */
export function unsettledSharedTree(dir: string, agentUser = "agent"): string {
	const body = `${sharedTreePolicyShell(agentUser)}
for path; do
  if ! shared_tree_ok "$path"; then printf '%s,' "$path"; fi
done`;
	return `find ${shellQuote(dir)} ! -type l -user "$(id -u)" -exec ${shellCommand(body)} {} + 2>/dev/null`;
}

/** Not repairable by the primary; the check reports these as warnings, not failure. */
export function agentWrongGroup(dir: string, agent: string): string {
	return `find ${shellQuote(dir)} ! -type l -user ${shellQuote(agent)} ! -group collab -printf '%p,' 2>/dev/null`;
}

/** Physical traversal selects owned entries; the shared function rechecks ownership. */
export function repairSharedTree(dir: string, agentUser = "agent"): string {
	const body = `${sharedTreeRepairShell(agentUser)}
for path; do shared_tree_repair "$path" || exit 1; done`;
	return `find ${shellQuote(dir)} ! -type l -user "$(id -u)" -exec ${shellCommand(body)} {} +`;
}
