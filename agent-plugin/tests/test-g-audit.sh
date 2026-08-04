#!/usr/bin/env bash
# Row G — the read-only audit (hyper-audit.sh): a healthy space reports no
# problems, an orphaned worktree is classified ORPHANED, and secret-looking
# files are reported by path only — contents must never leak into the report.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

AUDIT="$SCRIPTS_DIR/hyper-audit.sh"

# G1: fully healthy bare space
d="$FIX/g1"; make_bare_space "$d"
mkdir -p "$d/data" "$d/notes" "$d/scratch" "$d/bin"
touch "$d/HYPER.md"
out="$(bash "$AUDIT" "$d" 2>&1)"
rc=$?
assert_eq "healthy space -> exit 0" 0 "$rc"
probs="$(printf '%s\n' "$out" | awk '/^Problems:/{f=1;next} /^Warnings:/{f=0} f')"
warns="$(printf '%s\n' "$out" | awk '/^Warnings:/{f=1;next} /^Info:/{f=0} f')"
assert_contains "healthy space reports no problems" "$probs" "(none)"
assert_contains "healthy space reports no warnings" "$warns" "(none)"

# G2: orphaned worktree — .git file whose gitdir no longer exists
d="$FIX/g2"; make_bare_space "$d"
mkdir -p "$d/data" "$d/notes" "$d/scratch" "$d/bin"
touch "$d/HYPER.md"
mkdir -p "$d/worktrees/dead"
printf 'gitdir: %s\n' "$FIX/nonexistent/gitdirs/dead" > "$d/worktrees/dead/.git"
out="$(bash "$AUDIT" "$d" 2>&1)"
probs="$(printf '%s\n' "$out" | awk '/^Problems:/{f=1;next} /^Warnings:/{f=0} f')"
assert_contains "dangling gitdir classified as ORPHANED" "$probs" "ORPHANED"
assert_contains "the orphan is named" "$probs" "worktrees/dead"

# G3: .env at the root — path printed, contents never
d="$FIX/g3"; make_bare_space "$d"
mkdir -p "$d/data" "$d/notes" "$d/scratch" "$d/bin"
touch "$d/HYPER.md"
echo 'API_KEY=HYPER_TEST_SECRET_VALUE_XYZZY' > "$d/.env"
out="$(bash "$AUDIT" "$d" 2>&1)"
assert_contains "the .env path is reported" "$out" ".env"
assert_not_contains "the .env contents never appear" "$out" "HYPER_TEST_SECRET_VALUE_XYZZY"

finish
