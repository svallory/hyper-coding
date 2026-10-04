#!/bin/sh
# Hook trampoline: hooks.json runs `/bin/sh <this> <script>` instead of
# `bash <script>`, because the harness looks `bash` up on the session's PATH
# in the session's directory — a relative PATH entry would let a `bin/bash`
# in the project or space run before any hook code. /bin/sh is an absolute
# path; this cleans PATH (hyper-safe-path.sh) and only then finds bash.
#
# Only the plugin's own hyper-*.sh scripts, next to this file, are started.
# A hook must never fail a session: anything unexpected exits 0 silently.
case "$0" in
  */*) here="${0%/*}" ;;
  *) exit 0 ;;
esac
. "$here/hyper-safe-path.sh" || exit 0
hyper_safe_path
case "${1-}" in
  hyper-*.sh) ;;
  *) exit 0 ;;
esac
case "$1" in
  */*) exit 0 ;;
esac
[ -f "$here/$1" ] || exit 0
command -v bash >/dev/null 2>&1 || exit 0
script="$here/$1"
shift
exec bash "$script" "$@"
