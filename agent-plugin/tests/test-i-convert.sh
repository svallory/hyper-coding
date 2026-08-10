#!/usr/bin/env bash
# Row I — checkout conversion (hyper-adopt.sh case B). Adopting an ordinary
# checkout CONVERTS it: repo becomes bare, working tree moves to
# worktrees/<branch>, linked worktrees come home, and four data-safety
# guarantees are verified (refs, stashes, status parity, path inventory).
# Refusals must change nothing; nothing is ever deleted.
#
# All adopt invocations run from $PWD outside the fixture — adopt refuses to
# convert the directory it is standing in, and these tests never stand in it.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

ADOPT="$SCRIPTS_DIR/hyper-adopt.sh"

# snap <dir> — name inventory of everything under <dir>, .git internals
# included. Refusal and dry-run tests prove "nothing changed" by comparing
# this plus the porcelain status before and after.
snap() { (cd "$1" && find . -print | LC_ALL=C sort); }

# ---------------------------------------------------------------------------
# I1: clean checkout → --apply → bare space; second adopt is a case-A no-op
# ---------------------------------------------------------------------------
d="$FIX/i1"; make_checkout "$d"
out="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "clean convert exits 0" 0 "$?"
assert_eq "repo is bare afterwards" "true" \
  "$(git --git-dir="$d/.git" config --get core.bare)"
assert_ok "project file landed in worktrees/main" test -f "$d/worktrees/main/file.txt"
assert_ok "worktree is functional" git -C "$d/worktrees/main" rev-parse HEAD
assert_eq "empty status in the new worktree" "" \
  "$(git -C "$d/worktrees/main" status --porcelain=v1)"
for sd in data notes scratch bin; do
  assert_ok "scaffolded $sd/" test -d "$d/$sd"
done
assert_ok "HYPER.md written at the space root" test -f "$d/HYPER.md"
assert_ok "memory seed written" test -f "$d/.hyper/memory/hyper-layout.md"
assert_ok "space memory index written" test -f "$d/.hyper/memory/MEMORY.md"
# The worktree resolves its own .claude, so conversion must leave a local
# settings file there pointing at the space's memory — absolute, as Claude
# Code requires.
slj="$d/worktrees/main/.claude/settings.local.json"
assert_ok "worktree settings.local.json written" test -f "$slj"
assert_eq "worktree autoMemoryDirectory points at the space memory" \
  "$d/.hyper/memory" \
  "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).autoMemoryDirectory)' "$slj")"
assert_fails "preflight evidence file removed after success" \
  test -e "$d/.hyper-convert.preflight"
assert_fails "no staging dir left behind" test -e "$d/.hyper-convert"
assert_contains "output reports the four guarantees held" "$out" \
  "All four data-safety guarantees held"

# Second adopt: the space is now bare, so this must take case A (no-op
# re-scaffold), never a second conversion.
before="$(snap "$d")"
out2="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "second adopt exits 0" 0 "$?"
assert_contains "second adopt takes the bare path" "$out2" "Layout:    bare"
assert_not_contains "second adopt does not convert again" "$out2" "Converting"
assert_contains "HYPER.md left untouched on re-adopt" "$out2" \
  "exists   HYPER.md (left untouched)"
assert_eq "second adopt changes nothing on disk" "$before" "$(snap "$d")"

# ---------------------------------------------------------------------------
# I2: dirty checkout — modified + untracked + ignored, a stash, a 2nd branch
# ---------------------------------------------------------------------------
d="$FIX/i2"; make_checkout "$d"
echo second > "$d/file2.txt"
echo 'ignored.log' > "$d/.gitignore"
git -C "$d" add -A
git -C "$d" commit -qm more
git -C "$d" branch other
other_pre="$(git -C "$d" rev-parse other)"
# the stash: a modification to file2.txt, stashed away
echo stashed-change >> "$d/file2.txt"
git -C "$d" stash push -qm keepme
# the dirt: modified tracked, untracked, ignored
echo modified >> "$d/file.txt"
echo new > "$d/untracked.txt"
echo log > "$d/ignored.log"
pre_status="$(git -C "$d" status --porcelain=v1)"

out="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "dirty convert exits 0 (guarantees held)" 0 "$?"
wt="$d/worktrees/main"
assert_eq "status parity in the new worktree" \
  "$pre_status" "$(git -C "$wt" status --porcelain=v1)"
assert_ok "modified file kept its modification" grep -q modified "$wt/file.txt"
assert_ok "untracked file survived" test -f "$wt/untracked.txt"
assert_ok "ignored file survived" test -f "$wt/ignored.log"
assert_eq "second branch hash unchanged" "$other_pre" "$(git -C "$wt" rev-parse other)"
assert_eq "the stash survived" 1 \
  "$(git -C "$wt" stash list | grep -c keepme)"
assert_ok "stash pop restores the stashed change" \
  git -C "$wt" stash pop
assert_ok "popped change is back in the file" grep -q stashed-change "$wt/file2.txt"

# ---------------------------------------------------------------------------
# I3: linked worktree living elsewhere → moved under worktrees/, functional
# ---------------------------------------------------------------------------
d="$FIX/i3"; make_checkout "$d"
git -C "$d" worktree add -q "$FIX/i3-elsewhere" -b feature
out="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "convert with a linked worktree exits 0" 0 "$?"
assert_ok "linked worktree moved to worktrees/feature" test -d "$d/worktrees/feature"
assert_fails "old worktree location is gone" test -e "$FIX/i3-elsewhere"
assert_eq "moved worktree is on its branch" "feature" \
  "$(git -C "$d/worktrees/feature" branch --show-current)"
assert_eq "moved worktree is functional (clean status)" "" \
  "$(git -C "$d/worktrees/feature" status --porcelain=v1)"

# ---------------------------------------------------------------------------
# I4: old checkout-layout repo — marker + .claude/worktrees/<wt> + untracked
# data/. Space-local pieces stay at the root; project files and .claude
# config go to the worktree; the old-layout worktree is moved.
# ---------------------------------------------------------------------------
d="$FIX/i4"; make_checkout "$d"
touch "$d/HYPER.md"                       # untracked marker (old layout)
mkdir -p "$d/.claude"
echo '{}' > "$d/.claude/settings.json"       # project config
mkdir -p "$d/data"
echo blob > "$d/data/blob.bin"               # untracked space-local data
mkdir -p "$d/.claude/worktrees"
git -C "$d" worktree add -q "$d/.claude/worktrees/feat" -b feat

out="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "old-layout convert exits 0" 0 "$?"
assert_ok "data file stayed at the space root" test -f "$d/data/blob.bin"
assert_fails "data/ was not moved into the worktree" test -e "$d/worktrees/main/data"
assert_ok "project files in the worktree" test -f "$d/worktrees/main/file.txt"
assert_ok ".claude config went with the project" \
  test -f "$d/worktrees/main/.claude/settings.json"
assert_ok "old-layout worktree moved to worktrees/feat" test -d "$d/worktrees/feat"
assert_eq "moved old-layout worktree on its branch" "feat" \
  "$(git -C "$d/worktrees/feat" branch --show-current)"
assert_fails "no worktree left under .claude/worktrees" \
  test -e "$d/.claude/worktrees/feat"
assert_contains "HYPER.md regenerated for the bare layout" \
  "$(cat "$d/HYPER.md")" "bare layout"

# ---------------------------------------------------------------------------
# I5: refusals — each one stops --apply and changes nothing at all
# ---------------------------------------------------------------------------

# refuse_case <dir> <desc> <expected-message-fragment>
refuse_case() {
  local rd="$1" desc="$2" msg="$3"
  local pre post rout rc
  pre="$(snap "$rd")"
  rout="$(bash "$ADOPT" "$rd" --apply 2>&1)"
  rc=$?
  assert_eq "$desc: --apply exits 1" 1 "$rc"
  assert_contains "$desc: names the refusal" "$rout" "$msg"
  post="$(snap "$rd")"
  assert_eq "$desc: tree unchanged" "$pre" "$post"
  assert_fails "$desc: repo not made bare" \
    bash -c "[[ \"\$(git --git-dir='$rd/.git' config --get core.bare)\" == true ]]"
}

# detached HEAD
d="$FIX/i5-detached"; make_checkout "$d"
git -C "$d" checkout -q --detach
refuse_case "$d" "detached HEAD" "detached HEAD"

# merge in progress (MERGE_HEAD, no conflict)
d="$FIX/i5-merge"; make_checkout "$d"
git -C "$d" checkout -qb side
echo side > "$d/side.txt"; git -C "$d" add -A; git -C "$d" commit -qm side
git -C "$d" checkout -q main
git -C "$d" merge -q --no-commit --no-ff side >/dev/null 2>&1
assert_ok "fixture sanity: MERGE_HEAD exists" test -e "$d/.git/MERGE_HEAD"
refuse_case "$d" "merge in progress" "merge in progress"

# .gitmodules present
d="$FIX/i5-submodule"; make_checkout "$d"
printf '[submodule "x"]\n\tpath = x\n\turl = ../x\n' > "$d/.gitmodules"
refuse_case "$d" "submodules" ".gitmodules present"

# conflicted index, from a real merge conflict
d="$FIX/i5-conflict"; make_checkout "$d"
git -C "$d" checkout -qb branch-a
echo a > "$d/file.txt"; git -C "$d" add -A; git -C "$d" commit -qm a
git -C "$d" checkout -q main
echo b > "$d/file.txt"; git -C "$d" add -A; git -C "$d" commit -qm b
git -C "$d" merge -q branch-a >/dev/null 2>&1
assert_ok "fixture sanity: index has unmerged entries" \
  bash -c "git -C '$d' ls-files -u | grep -q ."
refuse_case "$d" "conflicted index" "unmerged/conflicted"

# tracked file named `data` collides with the scaffold
d="$FIX/i5-datafile"; make_checkout "$d"
echo x > "$d/data"
git -C "$d" add data
git -C "$d" commit -qm data-file
refuse_case "$d" "file named data" "a file named 'data'"

# ---------------------------------------------------------------------------
# I6: dry run — full plan, four guarantees named, zero changes on disk
# ---------------------------------------------------------------------------
d="$FIX/i6"; make_checkout "$d"
echo dirt >> "$d/file.txt"
pre="$(snap "$d")"
pre_status="$(git -C "$d" status --porcelain=v1)"
out="$(bash "$ADOPT" "$d" 2>&1)"
assert_eq "dry run exits 0" 0 "$?"
assert_contains "dry run prints the conversion plan" "$out" "CONVERSION PLAN"
assert_contains "guarantee 1: refs byte-identical" "$out" "byte-identical"
assert_contains "guarantee 2: stash count and hash" "$out" "stash count"
assert_contains "guarantee 3: status parity" "$out" "git status in the new worktree"
assert_contains "guarantee 4: path inventory" "$out" "pre-conversion paths"
assert_contains "output says it was a dry run" "$out" "Dry run"
assert_eq "dry run changes nothing on disk" "$pre" "$(snap "$d")"
assert_eq "dry run leaves the status alone" \
  "$pre_status" "$(git -C "$d" status --porcelain=v1)"
assert_fails "dry run does not make the repo bare" \
  bash -c "[[ \"\$(git --git-dir='$d/.git' config --get core.bare)\" == true ]]"

# Dangling symlinks must not fail the inventory guarantee: -e follows links,
# so a link that was already broken before conversion (routine in
# node_modules) would read as "lost data" on a flawless conversion.
d="$FIX/i-symlink"; make_checkout "$d"
ln -s /nonexistent/target "$d/broken-link"
ln -s ../nope "$d/broken-rel"
out="$(bash "$ADOPT" "$d" --apply 2>&1)"; rc=$?
assert_eq "conversion with dangling symlinks exits 0" 0 "$rc"
assert_contains "all four guarantees held despite dangling links" \
  "$out" "guarantees held"
assert_ok "dangling symlink moved into the worktree" \
  test -L "$d/worktrees/main/broken-link"
assert_ok "relative dangling symlink moved too" \
  test -L "$d/worktrees/main/broken-rel"
assert_fails "preflight evidence removed on success" \
  test -e "$d/.hyper-convert.preflight"

finish
