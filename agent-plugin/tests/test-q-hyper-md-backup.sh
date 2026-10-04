#!/usr/bin/env bash
# Row Q — HYPER.md backup wording (hyper-lib.sh: write_hyper_md_bare /
# write_hyper_md_multi via hyper_md_backup_rule, and write_memory_seed).
# The docs must match the product (C-13): with a space branch the
# allowlisted directories ARE committed to the space's branch and reach the
# hyperdrive only when pushed; without one, nothing at the root is committed
# anywhere. Both layouts, with and without the git dir.
#
# Every assertion below is on text the old unconditional writers never
# produced ("until you run `hyper space init`", "committed to it on your
# cadence", "reach your hyperdrive when pushed"), so the file fails against
# the pre-T-9 wording rather than passing on strings that were already
# there — the layout table has always mentioned `worktrees/` and `scratch/`.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
# shellcheck source=agent-plugin/scripts/hyper-require-lib.sh
source "$SCRIPTS_DIR/hyper-require-lib.sh"
hyper_require_lib
set +eu
set +o pipefail

# Q1: bare layout, no space branch — nothing committed anywhere yet, and the
# sentence says it stops being true at `hyper space init`.
d="$FIX/q1"; make_bare_space "$d"
write_hyper_md "$d" q1
md="$(cat "$d/HYPER.md")"
assert_contains "bare, no branch: nothing is committed or backed up" "$md" \
  "nothing here is committed or backed up until you run"
assert_contains "bare, no branch: names hyper space init as the switch" "$md" \
  '`hyper space init`'
assert_contains "bare, no branch: points at status as the live answer" "$md" \
  '`hyper space status` is the live answer'
assert_contains "bare, no branch: intro keeps the flat committed claim" "$md" \
  "nothing here is committed."
assert_not_contains "bare, no branch: no hyperdrive claim" "$md" \
  "hyperdrive branch"
assert_not_contains "bare, no branch: never says 'the project'" "$md" \
  "committed to the project"

# Q2: bare layout, with a space branch — committed to the branch, published
# only by a push, and the intro no longer claims a flat "nothing committed".
d="$FIX/q2"; make_bare_space "$d"
mkdir -p "$d/.hyper/space.git"
write_hyper_md "$d" q2
md="$(cat "$d/HYPER.md")"
assert_contains "bare, with branch: says the space has a hyperdrive branch" "$md" \
  "hyperdrive branch"
assert_contains "bare, with branch: commits on the cadence" "$md" \
  "are committed to it on your cadence"
assert_contains "bare, with branch: only a push reaches the hyperdrive" "$md" \
  'pushed (`session-end+push`, or `hyper space push`)'
assert_contains "bare, with branch: excludes settings.local.json" "$md" \
  '`.claude/settings.local.json`'
assert_contains "bare, with branch: worktrees never committed" "$md" \
  '`scratch/`, `worktrees/` and loose root files are never committed'
assert_contains "bare, with branch: intro says committed to the project" "$md" \
  "nothing here is committed to the project"
assert_not_contains "bare, with branch: never calls a commit a backup" "$md" \
  "are backed up to it"
assert_not_contains "bare, with branch: old wording gone" "$md" \
  "nothing here is committed or backed up"

# Q3: multi layout, no space branch.
d="$FIX/q3"; make_multi_space "$d" solo
write_hyper_md "$d" q3
md="$(cat "$d/HYPER.md")"
assert_contains "multi, no branch: nothing is committed or backed up" "$md" \
  "nothing here is committed or backed up until you run"
assert_contains "multi, no branch: points at status as the live answer" "$md" \
  '`hyper space status` is the live answer'
assert_not_contains "multi, no branch: no hyperdrive claim" "$md" \
  "hyperdrive branch"

# Q4: multi layout, with a space branch — code/ is the dir that stays out.
d="$FIX/q4"; make_multi_space "$d" solo
mkdir -p "$d/.hyper/space.git"
write_hyper_md "$d" q4
md="$(cat "$d/HYPER.md")"
assert_contains "multi, with branch: commits on the cadence" "$md" \
  "are committed to it on your cadence"
assert_contains "multi, with branch: only a push reaches the hyperdrive" "$md" \
  'pushed (`session-end+push`, or `hyper space push`)'
assert_contains "multi, with branch: code/ never committed" "$md" \
  '`scratch/`, `code/` and loose root files are never committed'
assert_contains "multi, with branch: intro says committed to the project" "$md" \
  "nothing here is committed to the project"
assert_not_contains "multi, with branch: never calls a commit a backup" "$md" \
  "are backed up to it"

# Q5/Q6: the memory seed carries the same distinction.
d="$FIX/q5"; make_bare_space "$d"
write_memory_seed "$d" q5 >/dev/null
seed="$(cat "$d/.hyper/memory/hyper-layout.md")"
assert_contains "seed, no branch: nothing backed up until init" "$seed" \
  "not even to the hyperdrive — until \`hyper space init\`"

d="$FIX/q6"; make_bare_space "$d"
mkdir -p "$d/.hyper/space.git"
write_memory_seed "$d" q6 >/dev/null
seed="$(cat "$d/.hyper/memory/hyper-layout.md")"
assert_contains "seed, with branch: committed to the branch" "$seed" \
  "are committed to this space's branch on your cadence"
assert_contains "seed, with branch: only a push publishes" "$seed" \
  "reach your hyperdrive when pushed"
assert_contains "seed, with branch: scratch never committed" "$seed" \
  '`scratch/` is never committed'
assert_not_contains "seed, with branch: never calls a commit a backup" "$seed" \
  "backed up to the hyperdrive"

finish