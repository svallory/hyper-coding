#!/usr/bin/env bash
# Locate, load, and version-check hyper-lib.sh from the installed hyper CLI.
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
#   hyper_require_lib        # loads the library; exits 2 if it can't
#
# …or, from a hook that must never fail a session:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/hyper-require-lib.sh"
#   hyper_soft_lib || exit 0   # loads it silently, or returns 1
#
# Both load the library themselves, so callers never `source "$hyper_lib"`.
# Keeping that inside this file is what makes the version check possible: it
# has to run *after* the library is sourced, and a caller that sources the
# library separately has no single place to enforce it.

# The minimum library contract this plugin understands. Must match
# HYPER_LIB_VERSION in hyper-lib.sh.
#
# Guarded because `readonly FOO=1` aborts with exit 1 under `set -e` when this
# file is sourced twice — "FOO: readonly variable" — which turns a second
# source of a helper into a crash. Set once, read-only from then on.
if [[ -z "${HYPER_REQUIRE_LIB_VERSION:-}" ]]; then
  HYPER_REQUIRE_LIB_VERSION=1
  readonly HYPER_REQUIRE_LIB_VERSION
fi

# hyper_soft_lib — load the library, or return 1 without printing anything.
# Used by hyper-context.sh, which runs on every SessionStart and must stay
# silent and exit 0 when the CLI is not installed.
#
# Sets $hyper_lib to the resolved path, and $hyper_lib_reason to "missing",
# "outdated", or "" — callers that print an error need the reason: "not
# installed" and "installed but too old" are different instructions.
hyper_soft_lib() {
  hyper_lib="$(command -v hyper >/dev/null 2>&1 && hyper space lib-path 2>/dev/null | tail -n 1)" || hyper_lib=""
  # `tail -n 1` is not cosmetic. Toolchain shims (mise/proto/nvm) print a
  # one-off "Detected an AI agent environment" notice to STDOUT on their first
  # run under a new HOME, and the bash suite gives every test file a fresh HOME.
  # Taking the whole stdout would then make the "path" two lines, -f fails, and
  # the suite reports hundreds of assertion failures that have nothing to do
  # with spaces. The real path is always last; an empty result still fails -f.
  if [[ -z "$hyper_lib" || ! -f "$hyper_lib" ]]; then
    hyper_lib_reason="missing"
    return 1
  fi
  # shellcheck source=/dev/null
  if ! source "$hyper_lib"; then
    hyper_lib_reason="missing"
    return 1
  fi
  # The plugin on disk and the library it just got can be arbitrarily far
  # apart in age — a freshly updated plugin against an older CLI is the normal
  # case. Without this check that mismatch surfaces mid-script as
  # "space_layout: command not found", halfway through a conversion, which is
  # the worst possible moment to find out. A library with NO version stamp at
  # all is an older one (the stamp arrived with the contract), so -ge still
  # fails and the reason is "outdated", not "missing".
  if [[ "${HYPER_LIB_VERSION:-0}" -lt "$HYPER_REQUIRE_LIB_VERSION" ]]; then
    hyper_lib_reason="outdated"
    return 1
  fi
  hyper_lib_reason=""
  return 0
}

# hyper_require_lib — the same, but a missing or too-old CLI is a real user
# error: the script cannot do its job without the library, and it should say
# which package to install or update rather than failing later with
# "space_layout: not found".
hyper_require_lib() {
  if hyper_soft_lib; then
    return 0
  fi
  hyper_lib=""
  if [[ "$hyper_lib_reason" == "outdated" ]]; then
    # Wording pin: the test suite greps for "needs hyper-lib.sh v" — change
    # this message and the test must change with it.
    echo "hyper: this plugin needs hyper-lib.sh v$HYPER_REQUIRE_LIB_VERSION+ but @hypercli/cli provides ${HYPER_LIB_VERSION:-a version too old to stamp it} — update @hypercli/cli" >&2
  else
    echo "hyper: the hyper CLI is required, and provides hyper-lib.sh — install or update @hypercli/cli (needs 'hyper space lib-path')" >&2
  fi
  exit 2
}
