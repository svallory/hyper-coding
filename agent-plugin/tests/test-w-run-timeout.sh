#!/usr/bin/env bash
# Row W — run.sh's per-file timeout kills the whole process group of the file:
# a child that outlives the file must neither write "ghost" output into the next
# file's results nor survive as an orphan, and the killed file's TMPDIR fixtures
# must be removed. Runs a copy of run.sh against fixture test files.
# Also covers the rest of run.sh's contract: --jobs keeps per-file isolation,
# SHIP_* from the caller never reaches a file, the hyper CLI skip/require modes,
# --budget, explicit files, and --affected selection (map rules, via --dry-run).

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

# ---- --jobs: parallel files keep their own process group, TMPDIR and output ----
J="$FIX/jobs"
mkdir -p "$J" "$FIX/jtmp"
cp "$TESTS_DIR/run.sh" "$J/run.sh"
for n in a b c; do
  cat > "$J/test-$n-iso.sh" <<FILE
echo "mine" > "\$TMPDIR/who-$n"
sleep 2
echo "ok 1 - $n sees only its own TMPDIR: \$(ls "\$TMPDIR" | tr '\n' ' ')"
[ "\$(ls "\$TMPDIR")" = "who-$n" ] || echo "not ok 2 - $n shares its TMPDIR"
FILE
done
cat > "$J/test-g-quick.sh" <<'FILE'
echo "ok 1 - quick file"
FILE
cat > "$J/test-f-slow.sh" <<'FILE'
sleep 2
echo "ok 1 - slow file"
FILE
cat > "$J/test-d-hang.sh" <<'FILE'
echo "ok 1 - hang starts"
sleep 30
FILE
t0=$SECONDS
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --jobs 3 --shuffle test-a-iso.sh test-b-iso.sh test-c-iso.sh 2>&1)"; rc=$?
took=$((SECONDS - t0))
assert_eq "--jobs 3 --shuffle: three 2 s files all pass in any order" "0" "$rc"
assert_contains "--jobs 3: a has its own TMPDIR" "$out" "a sees only its own TMPDIR: who-a "
assert_contains "--jobs 3: b has its own TMPDIR" "$out" "b sees only its own TMPDIR: who-b "
assert_contains "--jobs 3: c has its own TMPDIR" "$out" "c sees only its own TMPDIR: who-c "
assert_not_contains "--jobs 3: no file reports a shared TMPDIR" "$out" "not ok"
assert_ok "--jobs 3: the files really ran at once (under 5 s for 3 x 2 s)" test "$took" -lt 5
assert_eq "--jobs 3: every block has its header" "3" "$(printf '%s\n' "$out" | grep -c '^# === test-.-iso.sh$')"
assert_contains "--jobs 3: summary totals are unchanged" "$out" "3 files, 3 assertions: 3 passed, 0 failed"
# blocks do not interleave: each header is followed by its own ok line
blocks_ok=1
for n in a b c; do
  printf '%s\n' "$out" | grep -A1 "^# === test-$n-iso.sh$" | tail -1 | grep -q "ok 1 - $n sees" || blocks_ok=0
done
assert_eq "--jobs 3: each block holds its own file's lines" "1" "$blocks_ok"
out="$(TMPDIR="$FIX/jtmp" HYPER_TEST_FILE_TIMEOUT=4 bash "$J/run.sh" --jobs 2 test-d-hang.sh test-a-iso.sh 2>&1)"; rc=$?
assert_eq "--jobs 2: a timeout fails the run" "1" "$rc"
assert_contains "--jobs 2: the hung file is killed" "$out" "not ok - test-d-hang.sh timed out after 4s"
assert_contains "--jobs 2: its sibling still passes" "$out" "a sees only its own TMPDIR: who-a "
assert_eq "--jobs 2: work dirs removed" "" "$(ls "$FIX/jtmp" 2>/dev/null)"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --jobs 0 2>&1)"; rc=$?
assert_eq "--jobs 0 is a usage error" "2" "$rc"

# ---- explicit files, --budget, time lines ---------------------------------------
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" test-f-slow.sh 2>&1)"
assert_not_contains "explicit file: only that file runs" "$out" "test-a-iso.sh"
assert_contains "per-file wall time is printed" "$out" "# time: test-f-slow.sh 2s"
assert_contains "the slowest files are summarised" "$out" "# slowest: test-f-slow.sh"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --budget 1 test-f-slow.sh 2>&1)"; rc=$?
assert_eq "--budget: a file over budget fails the run" "1" "$rc"
assert_contains "--budget: says which file and why" "$out" "s, over the 1s per-file budget"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" test-nope.sh 2>&1)"; rc=$?
assert_eq "an unknown explicit file is a usage error" "2" "$rc"

# ---- the caller's SHIP_* never reaches a file (hyper-655) ------------------------
cat > "$J/test-e-env.sh" <<'FILE'
echo "ok 1 - env: [${SHIP_CONFIG_JSON-}][${SHIP_CONFIG_LAYERS-}][${SHIP_SPACE_ROOT-}][${HYPER_SPACE_ROOT-}] mux=${SHIP_MUX_TEST-}"
FILE
out="$(TMPDIR="$FIX/jtmp" SHIP_CONFIG_JSON='{"units_group":"x"}' SHIP_CONFIG_LAYERS=l SHIP_SPACE_ROOT=/nope HYPER_SPACE_ROOT=/nope bash "$J/run.sh" test-e-env.sh 2>&1)"
assert_contains "SHIP_* and HYPER_SPACE_ROOT are cleared, SHIP_MUX_TEST is set" "$out" "env: [][][][] mux=1"

# ---- the hyper CLI: skip / require / auto without a package tree (hyper-4at) -----
cat > "$J/test-m-cli.sh" <<'FILE'
echo "ok 1 - ran"
FILE
cli_run() { TMPDIR="$FIX/jtmp" HYPER_TEST_CLI_FILES="test-m-cli.sh" HYPER_TEST_CLI="$1" bash "$J/run.sh" test-m-cli.sh test-g-quick.sh 2>&1; }
out="$(cli_run skip)"; rc=$?
assert_contains "skip: the CLI file is a visible SKIP" "$out" "ok - test-m-cli.sh # SKIP hyper CLI not built"
assert_not_contains "skip: the CLI file does not run" "$out" "ok 1 - ran"
assert_contains "skip: other files still run" "$out" "ok 1 - quick file"
assert_contains "skip: the summary counts the skip" "$out" "1 skipped"
out="$(cli_run auto)"
assert_contains "auto without a package tree skips" "$out" "ok - test-m-cli.sh # SKIP hyper CLI not built"
out="$(cli_run require)"; rc=$?
assert_eq "require: exits 2 when the CLI is not built" "2" "$rc"
assert_contains "require: names the build steps" "$out" "bun run build"
assert_not_contains "require: runs nothing" "$out" "# ==="
out="$(TMPDIR="$FIX/jtmp" HYPER_TEST_CLI=bogus bash "$J/run.sh" test-g-quick.sh 2>&1)"; rc=$?
assert_eq "a bad HYPER_TEST_CLI value is a usage error" "2" "$rc"
out="$(TMPDIR="$FIX/jtmp" HYPER_TEST_CLI_FILES="test-m-cli.sh" HYPER_TEST_CLI=require bash "$J/run.sh" test-g-quick.sh 2>&1)"; rc=$?
assert_eq "require: a selection without CLI files needs no CLI" "0" "$rc"

# ---- --affected: which files a changed path selects ------------------------------
sel() { # sel <changed path>... -> run.sh's selection output
  printf '%s\n' "$@" > "$FIX/changed.txt"
  bash "$TESTS_DIR/run.sh" --affected --paths-from "$FIX/changed.txt" --dry-run 2>&1
}
out="$(sel agent-plugin/scripts/ship/ship-role)"
assert_contains "leaf script: its own test is selected" "$out" "would run: test-t-ship-role.sh"
assert_contains "leaf script: the rule is printed" "$out" "(rule agent-plugin/scripts/ship/ship-role)"
assert_contains "leaf script: 1 of N" "$out" "affected: 1 of "
out="$(sel agent-plugin/scripts/ship/lib.sh)"
assert_contains "lib.sh: says it runs everything" "$out" "running everything"
assert_contains "lib.sh: selects a far-away file" "$out" "test-w-run-timeout.sh"
out="$(sel agent-plugin/scripts/ship/brand-new-script)"
assert_contains "an unmapped ship script widens to ALL" "$out" "running everything"
out="$(sel packages/core/src/index.ts notes/specs/x.md .beads/issues.jsonl)"
assert_contains "non-plugin path: not covered" "$out" "packages/core/src/index.ts: not covered by the plugin suite"
assert_contains "non-plugin path: nothing selected" "$out" "affected: nothing selected"
out="$(sel agent-plugin/README.md agent-plugin/CHANGELOG.md)"
assert_contains "plugin top-level docs select nothing" "$out" "affected: nothing selected"
out="$(sel agent-plugin/tests/test-z-brand-new.sh)"
assert_contains "a test file not in the map selects nothing missing" "$out" "affected: nothing selected"
: > "$TESTS_DIR/test-z-brand-new.sh"
out="$(sel agent-plugin/tests/test-z-brand-new.sh)"; rm -f "$TESTS_DIR/test-z-brand-new.sh"
assert_contains "a new tests/test-*.sh is selected by SELF" "$out" "would run: test-z-brand-new.sh"
out="$(sel agent-plugin/scripts/ship/ship-role agent-plugin/scripts/ship/ship-config)"
assert_contains "two leaves: both tests, once each, sorted" "$out" "would run: test-t-ship-config.sh test-t-ship-role.sh"
out="$(sel packages/cli/src/x.ts)"
assert_contains "packages/cli selects the CLI-dependent files" "$out" "test-a-detection.sh"
assert_not_contains "packages/cli does not select the rest" "$out" "test-w-run-timeout.sh"
out="$(sel agent-plugin/tests/helpers.sh)"
assert_contains "helpers.sh runs everything" "$out" "running everything"
out="$(sel agent-plugin/tests/run.sh)"
assert_contains "run.sh selects its own test" "$out" "would run: test-w-run-timeout.sh"
: > "$FIX/empty.txt"
out="$(bash "$TESTS_DIR/run.sh" --affected --paths-from "$FIX/empty.txt" 2>&1)"; rc=$?
assert_eq "nothing changed: exit 0" "0" "$rc"
assert_contains "nothing changed: says so" "$out" "affected: nothing changed"
# every file named by a map rule exists, or is one a later unit adds
missing=""
for t in $(grep -v '^#' "$TESTS_DIR/affected.map" | awk 'NF>=2{for(i=2;i<=NF;i++)print $i}' | grep '^test-' | sort -u); do
  [[ -f "$TESTS_DIR/$t" ]] || missing="$missing $t"
done
echo "# map targets not present yet:${missing:- none}"

finish
