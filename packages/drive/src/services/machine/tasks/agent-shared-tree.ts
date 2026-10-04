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
# Best-effort checks, not atomic with the final syscall: the final-component
# replacement race requires fd-anchored mutation to eliminate completely.
shared_tree_candidate() {
  [ -n "\${tree_root:-}" ] || return 1
  case "$1" in ./*) ;; *) return 1 ;; esac
  name=\${1#./}
  case "$name" in ''|.|..|*/*) return 1 ;; esac
  here=$(pwd -P) || return 1
  case "$here/$name" in "$tree_root"|"$tree_root"/*) ;; *) return 1 ;; esac
  [ ! -L "$1" ] && [ -e "$1" ] && [ "$(stat -c %u "$1")" = "$(id -u)" ]
}
shared_tree_mutate() {
  shared_tree_candidate "$1" || return 0
  target=$1
  shift
  "$@" "$target"
}
shared_tree_repair() {
  shared_tree_candidate "$1" || return 0
  # No changes once settled: chmod/setfacl themselves generate attrib events.
  if shared_tree_ok "$1"; then return 0; fi
  if getfacl -c -p "$1" | grep -q "^user:$tree_agent:"; then
    shared_tree_mutate "$1" setfacl -x "u:$tree_agent" || return 1
  fi
  if [ "$(stat -c %G "$1")" != collab ]; then shared_tree_mutate "$1" chgrp -h collab || return 1; fi
  shared_tree_mutate "$1" chmod g+rwX || return 1
  if [ -d "$1" ]; then
    shared_tree_mutate "$1" chmod g+s || return 1
    if ! shared_tree_default_ok "$1"; then
      shared_tree_mutate "$1" setfacl -x "d:u:$tree_agent" || return 1
      shared_tree_mutate "$1" setfacl -d -m g:collab:rwX || return 1
    fi
  fi
  # Do not recalculate a file's mask when chmod already restored effective rw.
  if ! shared_tree_access_ok "$1"; then shared_tree_mutate "$1" setfacl -m g:collab:rwX || return 1; fi
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

/** Repair all primary-owned entries through cwd-anchored, physical traversal. */
export function repairSharedTree(dir: string, agentUser = "agent"): string {
	return sharedTreeTraversal(dir, agentUser, false);
}

/** Watcher variant: its event path is $1; mutations still run only via execdir. */
export function repairSharedTreeEntry(dir: string, agentUser = "agent"): string {
	return sharedTreeTraversal(dir, agentUser, true);
}

function sharedTreeTraversal(dir: string, agentUser: string, entryOnly: boolean): string {
	const body = `${sharedTreeRepairShell(agentUser)}
for path; do shared_tree_repair "$path" || exit 1; done`;
	// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
	const entrySetup = entryOnly ? "entry=${1%/}" : "# Traverse the physical root.";
	// execdir requires a safe absolute PATH. Never search the agent-writable cwd.
	return `(
  [ ! -L ${shellQuote(dir)} ] || exit 0
  tree_root=$(CDPATH= cd -P -- ${shellQuote(dir)} && pwd -P) || exit 1
  export tree_root
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
  ${entrySetup}
  find ${entryOnly ? '"$entry" -maxdepth 0' : '"$tree_root"'} ! -type l -user "$(id -u)" -execdir ${shellCommand(body)} {} +
)`;
}
