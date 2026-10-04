# shellcheck shell=sh
# Rebuild PATH from absolute entries only. Sourced FIRST by every hook script,
# before any command is looked up by name, and by hyper-hook.sh, the POSIX sh
# trampoline hooks.json starts each hook through.
#
# Why: a hook runs in the session's directory, and a relative PATH entry
# (`./bin`, `./node_modules/.bin`, `.`, an empty entry, `~/…` left unexpanded)
# resolves against that directory. In a space, `bin/` is synced content: a
# `bin/hyper`, `bin/git` or `bin/bash` pushed by any peer would otherwise run
# at every session start, edit and session end. In any other repo, a
# `bin/node` would run at every edit.
#
# POSIX sh on purpose (no [[ ]], no arrays): /bin/sh sources this before bash
# itself is looked up. Builtins only: nothing here may resolve a command by
# name, because PATH is not clean yet.
#
# The PATH the hook was started with is kept in HYPER_HOOK_ORIGINAL_PATH (set
# once, by whichever cleaner runs first) for the one place that deliberately
# runs project-defined commands: hyper-check.sh, which the project opted into.
#
# An empty result falls back to the system directories, so a hook never runs
# with no PATH at all.
hyper_safe_path() {
  if [ -z "${HYPER_HOOK_ORIGINAL_PATH+set}" ]; then
    HYPER_HOOK_ORIGINAL_PATH="${PATH-}"
    export HYPER_HOOK_ORIGINAL_PATH
  fi
  _hsp_rest="${PATH-}:"
  _hsp_new=""
  while [ -n "$_hsp_rest" ]; do
    _hsp_entry="${_hsp_rest%%:*}"
    _hsp_rest="${_hsp_rest#*:}"
    case "$_hsp_entry" in
      /*) _hsp_new="${_hsp_new:+$_hsp_new:}$_hsp_entry" ;;
    esac
  done
  [ -n "$_hsp_new" ] || _hsp_new="/usr/bin:/bin:/usr/sbin:/sbin"
  PATH="$_hsp_new"
  export PATH
  unset _hsp_rest _hsp_new _hsp_entry
}
