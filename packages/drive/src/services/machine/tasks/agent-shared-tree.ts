/** Shared work/transcript trees: the primary must never repair agent-owned files. */
import { shellQuote } from "#services/remote";
import { shellCommand } from "./shell.js";

/** Read-only list of primary-owned entries this user can repair. Never follows links. */
export function unsettledSharedTree(dir: string, agentUser = "agent"): string {
	const body = `for path; do
  good=yes
  if getfacl -c -p "$path" | grep -q ${shellQuote(`^user:${agentUser}:`)}; then good=no; fi
  if [ -d "$path" ] && getfacl -c -p "$path" | grep -q ${shellQuote(`^default:user:${agentUser}:`)}; then good=no; fi
  [ "$(stat -c %G "$path")" = collab ] || good=no
  if [ -d "$path" ]; then
    [ -g "$path" ] || good=no
    getfacl -c -p "$path" | grep -qxF 'group:collab:rwx' || good=no
    getfacl -c -p "$path" | grep -qxF 'default:group:collab:rwx' || good=no
  else
    getfacl -c -p "$path" | grep -qE '^group:collab:rw[-x]([[:space:]]+#effective:rw[-x])?$' || good=no
  fi
  if [ "$good" = no ]; then printf '%s,' "$path"; fi
done`;
	return `find ${shellQuote(dir)} ! -type l -user "$(id -u)" -exec ${shellCommand(body)} {} + 2>/dev/null`;
}

/** Not repairable by the primary; the check reports these as warnings, not failure. */
export function agentWrongGroup(dir: string, agent: string): string {
	return `find ${shellQuote(dir)} ! -type l -user ${shellQuote(agent)} ! -group collab -printf '%p,' 2>/dev/null`;
}

/** No recursive tool invocation: find's physical traversal selects owned entries only. */
export function repairSharedTree(dir: string, agentUser = "agent"): string {
	const q = shellQuote(dir);
	return [
		`find ${q} ! -type l -user "$(id -u)" -exec setfacl -x ${shellQuote(`u:${agentUser}`)} {} +`,
		`find ${q} -type d -user "$(id -u)" -exec setfacl -x ${shellQuote(`d:u:${agentUser}`)} {} +`,
		`find ${q} ! -type l -user "$(id -u)" -exec chgrp -h collab {} +`,
		`find ${q} ! -type l -user "$(id -u)" -exec chmod g+rwX {} +`,
		`find ${q} -type d -user "$(id -u)" -exec chmod g+s {} +`,
		`find ${q} -type d -user "$(id -u)" -exec setfacl -d -m g:collab:rwX {} +`,
		`find ${q} ! -type l -user "$(id -u)" -exec setfacl -m g:collab:rwX {} +`,
	].join("\n");
}
