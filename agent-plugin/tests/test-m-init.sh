#!/usr/bin/env bash
# Row M — init. The --new path builds a space from nothing: empty bare repo,
# seeded initial commit, default-branch worktree, full scaffold. The clone
# path is exercised implicitly by the conversion suite's fixtures; this file
# pins the from-scratch path and its refusals.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

INIT="$SCRIPTS_DIR/hyper-init.sh"

# wt (worktrunk) may be installed on the machine running the suite; its
# user-level config would decide worktree placement. Strip it from PATH so
# the deterministic git-worktree fallback runs. git and node must survive.
clean_path="$(dirname "$(command -v git)"):/usr/bin:/bin"
node_dir="$(command -v node >/dev/null 2>&1 && dirname "$(command -v node)" || true)"
[[ -n "$node_dir" ]] && clean_path="$clean_path:$node_dir"

# M1: --new builds a working space from nothing
out="$( (cd "$FIX" && PATH="$clean_path" bash "$INIT" --new proj) 2>&1 )"
rc=$?
d="$FIX/proj"
assert_eq "--new exits 0" 0 "$rc"
assert_eq "repo is bare" "true" "$(git --git-dir="$d/.git" config --get core.bare)"
assert_ok "initial commit exists" git --git-dir="$d/.git" rev-parse refs/heads/main
assert_ok "worktree created for main" test -d "$d/worktrees/main"
assert_ok "worktree is functional" git -C "$d/worktrees/main" rev-parse HEAD
assert_eq "worktree is clean" "" "$(git -C "$d/worktrees/main" status --porcelain=v1)"
assert_eq "worktree is on main" "main" "$(git -C "$d/worktrees/main" branch --show-current)"
for sd in data notes scratch bin; do
  assert_ok "scaffolded $sd/" test -d "$d/$sd"
done
assert_ok "HYPER.md written" test -f "$d/HYPER.md"
assert_ok "memory seed written" test -f "$d/.hyper/memory/hyper-layout.md"
assert_ok "space settings written" test -f "$d/.claude/settings.json"
assert_eq "worktrunk default branch recorded" "main" \
  "$(git --git-dir="$d/.git" config worktrunk.default-branch)"
assert_fails "no origin remote configured" \
  git --git-dir="$d/.git" config --get remote.origin.url
assert_contains "next steps mention adding a remote later" "$out" "remote add origin"

# M2: a space is detected as such, and adopt on it is a case-A no-op
assert_eq "space_layout accepts the new space" "bare" \
  "$(bash -c "source '$SCRIPTS_DIR/hyper-lib.sh'; space_layout '$d'")"
out="$(bash "$SCRIPTS_DIR/hyper-adopt.sh" "$d" --apply 2>&1)"
assert_eq "adopt on the new space exits 0" 0 "$?"
assert_not_contains "adopt does not try to convert it" "$out" "Converting"

# M3: --new with a custom default branch
( cd "$FIX" && PATH="$clean_path" bash "$INIT" --new proj2 --default-branch trunk ) >/dev/null 2>&1
assert_eq "custom branch worktree" "trunk" \
  "$(git -C "$FIX/proj2/worktrees/trunk" branch --show-current)"

# M4: refusals
out="$( (cd "$FIX" && bash "$INIT" --new proj) 2>&1 )"
rc=$?
assert_eq "existing path refused" 1 "$rc"
assert_contains "refusal names the path" "$out" "refusing to overwrite"

out="$( (cd "$FIX" && bash "$INIT" --new a b) 2>&1 )"
rc=$?
assert_eq "--new with two positionals exits 2" 2 "$rc"

out="$( (cd "$FIX" && bash "$INIT" --new) 2>&1 )"
rc=$?
assert_eq "--new without a name exits 2" 2 "$rc"

out="$( (cd "$FIX" && bash "$INIT") 2>&1 )"
rc=$?
assert_eq "no arguments exits 2" 2 "$rc"
assert_contains "usage shows the --new form" "$out" "--new"

# M5: missing git identity refuses BEFORE creating anything
env_home="$FIX/no-ident-home"
mkdir -p "$env_home"
out="$( (cd "$FIX" && HOME="$env_home" GIT_CONFIG_GLOBAL="$env_home/.gitconfig" \
  PATH="$clean_path" bash "$INIT" --new proj3) 2>&1 )"
rc=$?
assert_eq "missing identity exits 1" 1 "$rc"
assert_contains "identity refusal explains the fix" "$out" "user.name"
assert_fails "nothing was created" test -e "$FIX/proj3"

finish
