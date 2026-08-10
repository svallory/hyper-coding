#!/usr/bin/env bash
# Shared test harness. Source this from each test-*.sh, emit assertions with
# the assert_* helpers, and call `finish` at the end.
#
# Design rules:
#   - every fixture lives under $FIX (a fresh mktemp dir, physical path) and
#     is deleted by finish(); no test may touch a real repository
#   - git is fully isolated: HOME points into $FIX, system config is ignored
#   - TAP-ish output: "ok N - desc" / "not ok N - desc", plan line at the end

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$TESTS_DIR/.." && pwd)"
# Used by the test files that source this harness, not in this file itself.
# shellcheck disable=SC2034
SCRIPTS_DIR="$PLUGIN_DIR/scripts"

FIX="$(mktemp -d "${TMPDIR:-/tmp}/hyper-test.XXXXXX")"
# Physical path: git resolves symlinks (/var -> /private/var on macOS), and
# space_layout compares its argument against git's resolved toplevel.
FIX="$(cd "$FIX" && pwd -P)"

export HOME="$FIX/home"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
mkdir -p "$HOME"
git config --global user.email hyper-test@example.invalid
git config --global user.name  "hyper test"
git config --global init.defaultBranch main
git config --global commit.gpgsign false

_n=0
_fail=0

pass() { _n=$((_n + 1)); echo "ok $_n - $1"; }
fail() { _n=$((_n + 1)); _fail=$((_fail + 1)); echo "not ok $_n - $1"; }
skip() { _n=$((_n + 1)); echo "ok $_n - $1 # SKIP ${2:-}"; }

# assert_ok <desc> <cmd...>   — passes when the command exits 0
assert_ok() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

# assert_fails <desc> <cmd...> — passes when the command exits non-zero
assert_fails() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc (unexpectedly succeeded)"; else pass "$desc"; fi
}

# assert_eq <desc> <expected> <actual>
assert_eq() {
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}

# assert_contains <desc> <haystack> <needle>
assert_contains() {
  case "$2" in
    *"$3"*) pass "$1" ;;
    *)      fail "$1 (output does not contain '$3')" ;;
  esac
}

# assert_not_contains <desc> <haystack> <needle>
assert_not_contains() {
  case "$2" in
    *"$3"*) fail "$1 (output contains '$3')" ;;
    *)      pass "$1" ;;
  esac
}

# Fixture builders ----------------------------------------------------------

# make_checkout <dir> — normal working tree with one commit
make_checkout() {
  git init -q "$1"
  echo hello > "$1/file.txt"
  git -C "$1" add -A
  git -C "$1" commit -qm init
}

# make_bare_space <dir> — bare .git + worktrees/ (the self-identifying shape)
make_bare_space() {
  mkdir -p "$1"
  git init -q --bare "$1/.git"
  mkdir -p "$1/worktrees"
}

finish() {
  echo "1..$_n"
  rm -rf "$FIX"
  [[ $_fail -eq 0 ]] && exit 0
  exit 1
}
