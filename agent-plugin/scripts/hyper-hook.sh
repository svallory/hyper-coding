#!/bin/sh
# Hook trampoline: hooks.json runs `/bin/sh <this> <script>` instead of
# `bash <script>`, so the hook starts from an absolute path and finds bash on
# the caller's PATH as is.
#
# Only the plugin's own hyper-*.sh scripts, next to this file, are started.
# A hook must never fail a session: anything unexpected exits 0 silently.
case "$0" in
  */*) here="${0%/*}" ;;
  *) exit 0 ;;
esac
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
