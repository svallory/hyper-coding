#!/usr/bin/env bash
# Locate hyper-lib.sh inside the installed hyper CLI and put its path in
# $hyper_lib.
#
# There is exactly ONE copy of the library (C-5): it ships inside the
# @hypercli/drive package, and `hyper space lib-path` prints where it landed.
# The plugin's scripts used to carry their own copy; that copy is gone, and
# every script here resolves the single one through the CLI instead. Duplicating
# it back would be the bug this file exists to prevent.
#
# Usage, from a script:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/hyper-require-lib.sh"
#   hyper_require_lib          # exits 2 with a friendly message if not found
#   source "$hyper_lib"
#
# …or, from a hook that must never fail a session:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/hyper-require-lib.sh"
#   hyper_soft_lib || exit 0   # silently does nothing when hyper is absent
#   source "$hyper_lib"

# hyper_soft_lib — set $hyper_lib, or return 1 without printing anything.
# Used by hyper-context.sh, which runs on every SessionStart and must stay
# silent and exit 0 when the CLI is not installed.
hyper_soft_lib() {
  hyper_lib="$(command -v hyper >/dev/null 2>&1 && hyper space lib-path 2>/dev/null | tail -n 1)" || hyper_lib=""
  # `tail -n 1` is not cosmetic. Toolchain shims (mise/proto/nvm) print a
  # one-off "Detected an AI agent environment" notice to STDOUT on their first
  # run under a new HOME, and the bash suite gives every test file a fresh HOME.
  # Taking the whole stdout would then make the "path" two lines, -f fails, and
  # the suite reports hundreds of assertion failures that have nothing to do
  # with spaces. The real path is always last; an empty result still fails -f.
  [[ -n "$hyper_lib" && -f "$hyper_lib" ]]
}

# hyper_require_lib — the same, but a missing or too-old CLI is a real user
# error: the script cannot do its job without the library, and it should say
# which package to install or update rather than failing later with
# "space_layout: not found".
hyper_require_lib() {
  if ! hyper_soft_lib; then
    hyper_lib=""
    echo "hyper: the hyper CLI is required, and provides hyper-lib.sh — install or update @hypercli/cli (needs 'hyper space lib-path')" >&2
    exit 2
  fi
}
