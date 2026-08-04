#!/usr/bin/env bash
# Row A — layout detection (hyper-lib.sh: space_layout / is_space /
# find_space_root). The opt-in gate is the safety property under test:
# nothing counts as a space unless the structure or the marker says so.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
# hyper-lib.sh turns on strict mode when sourced; the harness must not
# abort on the first failing assertion, so switch it back off.
source "$SCRIPTS_DIR/hyper-lib.sh"
set +eu
set +o pipefail

# A1: bare .git + worktrees/ — self-identifying
d="$FIX/a1"; make_bare_space "$d"
assert_eq "bare + worktrees/ -> bare" "bare" "$(space_layout "$d")"
assert_ok "bare + worktrees/ is a space" is_space "$d"

# A2: bare .git + HYPER.md marker, no worktrees/
d="$FIX/a2"; mkdir -p "$d"; git init -q --bare "$d/.git"
touch "$d/HYPER.md"
assert_eq "bare + marker -> bare" "bare" "$(space_layout "$d")"

# A3: plain bare repo (a mirror / hosting remote) — no worktrees, no marker
d="$FIX/a3"; mkdir -p "$d"; git init -q --bare "$d/.git"
assert_fails "plain bare repo rejected by space_layout" space_layout "$d"
assert_fails "plain bare repo is not a space" is_space "$d"

# A4: checkout + marker. The checkout layout no longer exists, and is_space
# has no marker-only fallback: HYPER.md lives at the uncommittable bare
# root, so a marker inside an ordinary checkout is legacy debris (or a
# committed copy in a clone) and must not give that checkout space semantics.
d="$FIX/a4"; make_checkout "$d"
touch "$d/HYPER.md"
assert_eq "checkout + marker -> no layout" "" "$(space_layout "$d")"
assert_fails "checkout + marker rejected by space_layout" space_layout "$d"
assert_fails "checkout + marker rejected by is_space (no marker fallback)" is_space "$d"

# A5: checkout with .claude/worktrees/ only — the old structural opt-in is
# gone. Without the marker this is just a plain checkout, not a space.
d="$FIX/a5"; make_checkout "$d"
mkdir -p "$d/.claude/worktrees"
assert_fails ".claude/worktrees/ alone no longer opts a checkout in" space_layout "$d"
assert_fails "checkout with only .claude/worktrees/ is not a space" is_space "$d"

# A6: ordinary repo, no marker, no .claude/worktrees — must NOT be a space
d="$FIX/a6"; make_checkout "$d"
assert_fails "plain checkout rejected by space_layout" space_layout "$d"
assert_fails "plain checkout is not a space" is_space "$d"

# A7: linked worktree (.git is a file) inside a bare space. The worktree
# itself must be rejected — even if a HYPER.md is present inside it — and
# find_space_root must walk past it to the bare root.
d="$FIX/a7"; make_bare_space "$d"
git --git-dir="$d/.git" worktree add -q "$d/worktrees/feat" -b feat 2>/dev/null \
  || git --git-dir="$d/.git" worktree add -q "$d/worktrees/feat" feat
wt="$d/worktrees/feat"
touch "$wt/HYPER.md"
assert_fails "linked worktree rejected by space_layout" space_layout "$wt"
assert_fails "linked worktree is not a space" is_space "$wt"
mkdir -p "$wt/sub"
assert_eq "find_space_root from inside the worktree reaches the bare root" \
  "$d" "$(find_space_root "$wt/sub")"

# A8: subdirectory of a marked checkout — the marker gives it nothing now, so
# the upward walk finds no space at all.
d="$FIX/a8"; make_checkout "$d"
touch "$d/HYPER.md"
mkdir -p "$d/src"
assert_fails "subdirectory of a checkout rejected" space_layout "$d/src"
assert_fails "find_space_root finds nothing above a marked checkout" \
  find_space_root "$d/src"

finish
