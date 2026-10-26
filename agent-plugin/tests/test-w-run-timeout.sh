#!/usr/bin/env bash
# Row W — run.sh's per-file timeout kills the whole process group of the file:
# a child that outlives the file must neither write "ghost" output into the next
# file's results nor survive as an orphan, and the killed file's TMPDIR fixtures
# must be removed. Runs a copy of run.sh against fixture test files.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

R="$FIX/runner"
mkdir -p "$R" "$FIX/tmp"
cp "$TESTS_DIR/run.sh" "$R/run.sh"
marker="$FIX/orphan-marker-$$"
cat > "$R/test-a-hang.sh" <<FILE
echo "ok 1 - before the hang"
mkdir -p "\$TMPDIR/leaked-fixture"
sh -c 'sleep 4; echo "not ok 99 - ghost"; : > "$marker"; sleep 30' &
sleep 30
FILE
cat > "$R/test-b-next.sh" <<'FILE'
sleep 2
echo "ok 1 - next file"
FILE

out="$(TMPDIR="$FIX/tmp" HYPER_TEST_FILE_TIMEOUT=3 bash "$R/run.sh" 2>&1)"; rc=$?
sleep 3   # past the ghost's sleep: it must have been killed by now

assert_eq "run.sh fails when a file times out" "1" "$rc"
assert_contains "the hung file is reported as timed out" "$out" "not ok - test-a-hang.sh timed out after 3s"
assert_contains "the next file still runs and passes" "$out" "ok 1 - next file"
assert_not_contains "no ghost output lands in the results" "$out" "ghost"
assert_fails "the orphan never got to write after the kill" test -e "$marker"
assert_contains "summary counts the timeout as a failure" "$out" "1 failed"
assert_eq "run.sh removed its own work dirs" "" "$(ls "$FIX/tmp" 2>/dev/null)"
assert_eq "no orphan sleep survives" "0" "$(pgrep -f "sh -c sleep 4; echo \"not ok 99" | wc -l | tr -d ' ')"

finish
