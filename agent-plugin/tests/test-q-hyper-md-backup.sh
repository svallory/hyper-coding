#!/usr/bin/env bash
# Row Q — HYPER.md backup wording (hyper-lib.sh: write_hyper_md_bare /
# write_hyper_md_multi via hyper_md_backup_rule). The docs must match the
# product (C-13): with a space branch (.hyper/space.git) the allowlisted
# directories ARE backed up to the user's hyperdrive; without one, nothing
# at the space root is. Both layouts, with and without the git dir.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
# shellcheck source=agent-plugin/scripts/hyper-require-lib.sh
source "$SCRIPTS_DIR/hyper-require-lib.sh"
hyper_require_lib
set +eu
set +o pipefail

# Q1: bare layout, no space branch — the old, still-true wording.
d="$FIX/q1"; make_bare_space "$d"
write_hyper_md "$d" q1
md="$(cat "$d/HYPER.md")"
assert_contains "bare, no branch: nothing at the root is backed up" "$md" \
  "nothing here is backed up"
assert_not_contains "bare, no branch: no hyperdrive claim" "$md" "hyperdrive branch"

# Q2: bare layout, with a space branch — the allowlist is backed up.
d="$FIX/q2"; make_bare_space "$d"
mkdir -p "$d/.hyper/space.git"
write_hyper_md "$d" q2
md="$(cat "$d/HYPER.md")"
assert_contains "bare, with branch: says the space has a hyperdrive branch" "$md" \
  "hyperdrive branch"
assert_contains "bare, with branch: names the backed-up dirs" "$md" \
  '`notes/`, `data/`, `bin/`, `.hyper/`,'
assert_contains "bare, with branch: worktrees stay local-only" "$md" '`worktrees/`'
assert_not_contains "bare, with branch: old wording gone" "$md" \
  "nothing here is backed up"

# Q3: multi layout, no space branch — the old wording, multi flavour.
d="$FIX/q3"; make_multi_space "$d" solo
write_hyper_md "$d" q3
md="$(cat "$d/HYPER.md")"
assert_contains "multi, no branch: nothing at the root is backed up" "$md" \
  "nothing here is backed up"
assert_not_contains "multi, no branch: no hyperdrive claim" "$md" "hyperdrive branch"

# Q4: multi layout, with a space branch — code/ is named as not backed up.
d="$FIX/q4"; make_multi_space "$d" solo
mkdir -p "$d/.hyper/space.git"
write_hyper_md "$d" q4
md="$(cat "$d/HYPER.md")"
assert_contains "multi, with branch: says the space has a hyperdrive branch" "$md" \
  "hyperdrive branch"
assert_contains "multi, with branch: code/ stays local-only" "$md" '`code/`'
assert_not_contains "multi, with branch: old wording gone" "$md" \
  "nothing here is backed up"
assert_contains "multi, with branch: scratch stays local-only" "$md" '`scratch/`'

# Q5/Q6: the memory seed's backup sentence follows the same condition.
d="$FIX/q5"; make_bare_space "$d"
write_memory_seed "$d" q5 >/dev/null
seed="$(cat "$d/.hyper/memory/hyper-layout.md")"
assert_contains "seed, no branch: nothing backed up" "$seed" \
  "None of it is committed or backed up."

d="$FIX/q6"; make_bare_space "$d"
mkdir -p "$d/.hyper/space.git"
write_memory_seed "$d" q6 >/dev/null
seed="$(cat "$d/.hyper/memory/hyper-layout.md")"
assert_contains "seed, with branch: allowlist backed up, scratch not" "$seed" \
  "are backed up to the hyperdrive"
assert_contains "seed, with branch: scratch stays local" "$seed" '`scratch/` is not.'
assert_not_contains "seed, with branch: old wording gone" "$seed" \
  "None of it is committed or backed up."

finish
