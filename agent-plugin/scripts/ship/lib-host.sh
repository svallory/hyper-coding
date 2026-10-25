#!/usr/bin/env bash
# Host mode helpers for the ship scripts (ship-unit, ship-land). Source it after
# lib.sh; do not execute it.
#
#   source "${BASH_SOURCE[0]%/*}/lib.sh"
#   source "${BASH_SOURCE[0]%/*}/lib-host.sh"
#
# A host is a key under `hosts:` in the ship config. `local` (or no host) runs
# here; any other name needs `hosts.<name>.ssh`, the ssh destination. The space
# exists on the host at the same absolute path as here.
#
#   ship_host_target <name>      print the ssh destination; return 1 (message on
#                                stderr) when the host has none
#   ship_host_is_local <name>    true for "" and "local"
#   ship_host_sync <target>      rsync scripts/ship/, scripts/hyper-require-lib.sh
#                                and skills/ship/defaults.yml to
#                                ~/.cache/hyper/ship/<plugin version>/ on the host,
#                                keeping the plugin layout
#   ship_host_script <name>      print the remote path expression of a ship script
#                                (the remote shell expands $HOME)
#   ship_host_run <target> <space root> <host name> <script> [args...]
#                                run a synced ship script on the host under a login
#                                shell, with SHIP_SPACE_ROOT and SHIP_HOST set;
#                                returns ssh's exit status
#   ship_host_push <target> <path>...   rsync files or directories to the same
#                                absolute path on the host
#   ship_host_pull_dir <target> <remote dir> <local dir>   mirror a directory back
#                                (local files the host does not have are removed)
#   ship_host_lost <rc>          true when an exit status means the connection was
#                                lost or ssh was killed (255, or killed by a signal)
#
# The ssh and rsync commands are looked up on PATH. Nothing here touches a
# multiplexer.

SHIP_SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

ship_host_is_local() { [[ -z "${1:-}" || "$1" == local ]]; }

ship_host_target() {
  local name="${1:?ship_host_target: host required}" t
  t="$(ship_cfg_get "hosts.$name.ssh" 2>/dev/null)" || t=""
  if [[ -z "$t" ]]; then
    _ship_err "host '$name' has no ssh destination: set hosts.$name.ssh in the ship config"
    return 1
  fi
  printf '%s\n' "$t"
}

ship_host_lost() { [[ "${1:-0}" -eq 255 || "${1:-0}" -ge 128 ]]; }

# _ship_host_version — the plugin version, which names the cache directory.
_ship_host_version() {
  local v=""
  if [[ -f "$SHIP_PLUGIN_ROOT/.claude-plugin/plugin.json" ]]; then
    v="$(jq -r '.version // ""' "$SHIP_PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null)" || v=""
  fi
  [[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || v=dev
  printf '%s\n' "$v"
}

_ship_host_cache() { printf '.cache/hyper/ship/%s' "$(_ship_host_version)"; }

ship_host_script() {
  printf '"$HOME"/%s/scripts/ship/%s' "$(_ship_host_cache)" "${1:?ship_host_script: name required}"
}

# ship_host_sync <target> — the host needs no hyper CLI, only these files.
ship_host_sync() {
  local target="${1:?ship_host_sync: target required}" cache
  cache="$(_ship_host_cache)"
  ssh "${SHIP_SSH_OPTS[@]}" "$target" "mkdir -p $cache/scripts/ship $cache/skills/ship" || return $?
  rsync -a --delete "$SHIP_PLUGIN_ROOT/scripts/ship/" "$target:$cache/scripts/ship/" || return $?
  rsync -a "$SHIP_PLUGIN_ROOT/scripts/hyper-require-lib.sh" "$target:$cache/scripts/" || return $?
  rsync -a "$SHIP_PLUGIN_ROOT/skills/ship/defaults.yml" "$target:$cache/skills/ship/" || return $?
}

# ship_host_run <target> <space root> <host name> <script> [args...]
ship_host_run() {
  local target="$1" root="$2" name="$3" script="$4" cmd a
  shift 4
  cmd="SHIP_SPACE_ROOT=$(printf '%q' "$root") SHIP_HOST=$(printf '%q' "$name") exec bash $(ship_host_script "$script")"
  for a in "$@"; do cmd+=" $(printf '%q' "$a")"; done
  ssh "${SHIP_SSH_OPTS[@]}" "$target" bash -lc "$(printf '%q' "$cmd")"
}

# ship_host_push <target> <path>... — files and directories keep their absolute path.
ship_host_push() {
  local target="$1" p parent
  shift
  for p in "$@"; do
    if [[ -d "$p" ]]; then
      ssh "${SHIP_SSH_OPTS[@]}" "$target" "mkdir -p $(printf '%q' "$p")" || return $?
      rsync -a "$p/" "$target:$p/" || return $?
    elif [[ -f "$p" ]]; then
      parent="${p%/*}"
      ssh "${SHIP_SSH_OPTS[@]}" "$target" "mkdir -p $(printf '%q' "$parent")" || return $?
      rsync -a "$p" "$target:$p" || return $?
    fi
  done
}

# ship_host_pull_dir <target> <remote dir> <local dir>
ship_host_pull_dir() {
  mkdir -p "$3" || return 1
  rsync -a --delete "$1:$2/" "$3/"
}
