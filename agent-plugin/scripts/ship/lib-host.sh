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
#   ship_sq <string>             print the string single-quoted for a POSIX shell
#   ship_host_run <target> <space root> <host name> <script> [args...]
#                                run a synced ship script on the host under
#                                `bash -lc`, with SHIP_SPACE_ROOT, SHIP_HOST and
#                                SHIP_UNIT_INTERNAL=1 set, and the lead's merged
#                                config (SHIP_CONFIG_JSON, when loaded) passed along
#                                so the host never re-resolves it. Returns ssh's
#                                exit status.
#   ship_host_push <target> <path>...   rsync files or directories to the same
#                                absolute path on the host
#   ship_host_pull_dir <target> <remote dir> <local dir>   mirror a directory back
#                                (local files the host does not have are removed)
#   ship_host_lost <rc>          true when an exit status means the connection was
#                                lost or ssh was killed (255, or killed by a signal)
#
# Any path can be copied (spaces, quotes, non-ASCII, glob characters) except one with
# a newline. rsync gets --protect-args (-s), so the remote path reaches the host
# untouched by its shell; that works the same before and after GNU rsync 3.2.4
# changed how remote arguments are escaped, which quoting by hand does not. The
# stock macOS /usr/bin/rsync is openrsync and has no -s: host mode refuses it (and
# any rsync older than 3.0) and asks for rsync 3 first on PATH. -s still lets the
# remote rsync expand * ? [ ] in a source path, so the mirror-back source is
# backslash-escaped. ssh commands quote with ship_sq.
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

# ship_sq <string> — single-quoted, safe for any POSIX shell (no $'..' form).
ship_sq() {
  local s
  s="$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
  printf "'%s'" "$s"
}

_ship_host_path_ok() {
  local p
  for p in "$@"; do
    if [[ "$p" == *$'\n'* ]]; then
      _ship_err "host mode cannot copy a path with a newline in it: '${p//$'\n'/\\n}'"
      return 1
    fi
  done
}

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

# _ship_host_rsync_ok — the local rsync must be GNU rsync 3.0+ (it needs -s). Checked once.
_ship_host_rsync_ok() {
  [[ "${_SHIP_HOST_RSYNC_CHECKED:-}" == 1 ]] && return 0
  local v ver
  v="$(rsync --version 2>&1 | head -n 2)" || v=""
  ver="$(printf '%s\n' "$v" | sed -n 's/^rsync  *version  *\([0-9][0-9]*\)\..*/\1/p' | head -n 1)"
  if [[ "$v" == *openrsync* || -z "$ver" || "$ver" -lt 3 ]]; then
    _ship_err "host mode needs rsync 3.0 or newer here (--protect-args); this rsync is $(printf '%s' "$v" | head -n 1 | tr -d '\n'). The stock macOS /usr/bin/rsync is openrsync and is too old: install rsync 3 (brew install rsync) and put it first on PATH"
    return 1
  fi
  _SHIP_HOST_RSYNC_CHECKED=1
}

# _ship_rsync_glob_esc <path> — backslash-escape * ? [ ] \ so a protected remote source
# path is matched literally (the remote rsync would otherwise glob it). A path with
# none of * ? [ ] is left alone: rsync only unescapes a path it treats as a pattern,
# so escaping a lone backslash there would break it.
_ship_rsync_glob_esc() {
  if [[ "$1" == *[\*?\[\]]* ]]; then printf '%s' "$1" | sed 's/[][*?\\]/\\&/g'; else printf '%s' "$1"; fi
}

# ship_host_sync <target> — the host needs no hyper CLI, only these files.
ship_host_sync() {
  local target="${1:?ship_host_sync: target required}" cache
  _ship_host_rsync_ok || return 1
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
  cmd="env SHIP_SPACE_ROOT=$(ship_sq "$root") SHIP_HOST=$(ship_sq "$name") SHIP_UNIT_INTERNAL=1"
  if [[ -n "${SHIP_CONFIG_JSON:-}" ]]; then
    cmd+=" SHIP_CONFIG_JSON=$(ship_sq "$SHIP_CONFIG_JSON") SHIP_CONFIG_LAYERS=$(ship_sq '[{"file":"the lead config","data":{}}]')"
  fi
  cmd+=" bash \"\$HOME\"/$(_ship_host_cache)/scripts/ship/$script"
  for a in "$@"; do cmd+=" $(ship_sq "$a")"; done
  ssh "${SHIP_SSH_OPTS[@]}" "$target" bash -lc "$(ship_sq "$cmd")"
}

# ship_host_push <target> <path>... — files and directories keep their absolute path.
ship_host_push() {
  local target="$1" p parent
  shift
  _ship_host_path_ok "$@" || return 1
  _ship_host_rsync_ok || return 1
  for p in "$@"; do
    if [[ -d "$p" ]]; then
      ssh "${SHIP_SSH_OPTS[@]}" "$target" "mkdir -p -- $(ship_sq "$p")" || return $?
      rsync -as "$p/" "$target:$p/" || return $?
    elif [[ -f "$p" ]]; then
      parent="${p%/*}"
      ssh "${SHIP_SSH_OPTS[@]}" "$target" "mkdir -p -- $(ship_sq "$parent")" || return $?
      rsync -as -- "$p" "$target:$p" || return $?
    fi
  done
}

# ship_host_pull_dir <target> <remote dir> <local dir>
ship_host_pull_dir() {
  local src
  _ship_host_path_ok "$2" || return 1
  _ship_host_rsync_ok || return 1
  mkdir -p "$3" || return 1
  src="$(_ship_rsync_glob_esc "$2")"
  rsync -as --delete "$1:$src/" "$3/"
}
