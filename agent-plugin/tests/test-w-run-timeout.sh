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
SYNC="$FIX/sync"; mkdir -p "$SYNC"
for n in a b c; do
  # Rendezvous: each file waits (bounded) until all three have started, so the
  # file can only pass when the others run at the same time. No wall-clock bound.
  cat > "$J/test-$n-iso.sh" <<FILE
echo "mine" > "\$TMPDIR/who-$n"
: > "$SYNC/started-$n"
for i in \$(seq 1 50); do
  [ -e "$SYNC/started-a" ] && [ -e "$SYNC/started-b" ] && [ -e "$SYNC/started-c" ] && break
  sleep 0.1
done
if [ -e "$SYNC/started-a" ] && [ -e "$SYNC/started-b" ] && [ -e "$SYNC/started-c" ]; then
  echo "ok 1 - $n met the others while running"
else
  echo "not ok 1 - $n ran alone: files are not concurrent"
fi
echo "ok 2 - $n sees only its own TMPDIR: \$(ls "\$TMPDIR" | tr '\n' ' ')"
[ "\$(ls "\$TMPDIR")" = "who-$n" ] || echo "not ok 3 - $n shares its TMPDIR"
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
rm -f "$SYNC"/started-a "$SYNC"/started-b "$SYNC"/started-c
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --jobs 3 --shuffle test-a-iso.sh test-b-iso.sh test-c-iso.sh 2>&1)"; rc=$?
assert_eq "--jobs 3 --shuffle: three rendezvousing files all pass in any order" "0" "$rc"
assert_contains "--jobs 3: a has its own TMPDIR" "$out" "a sees only its own TMPDIR: who-a "
assert_contains "--jobs 3: b has its own TMPDIR" "$out" "b sees only its own TMPDIR: who-b "
assert_contains "--jobs 3: c has its own TMPDIR" "$out" "c sees only its own TMPDIR: who-c "
assert_not_contains "--jobs 3: no file reports a shared TMPDIR" "$out" "not ok"
assert_eq "--jobs 3: every file met the other two (concurrency, no time bound)" "3" "$(printf '%s\n' "$out" | grep -c 'met the others while running')"
rm -f "$SYNC"/started-a "$SYNC"/started-b "$SYNC"/started-c
out_serial="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --jobs 1 test-a-iso.sh 2>&1)"
assert_contains "--jobs 1: the same file cannot rendezvous alone (the test can fail)" "$out_serial" "not ok 1 - a ran alone"
assert_eq "--jobs 3: every block has its header" "3" "$(printf '%s\n' "$out" | grep -c '^# === test-.-iso.sh$')"
assert_contains "--jobs 3: summary totals are unchanged" "$out" "3 files, 6 assertions: 6 passed, 0 failed"
# blocks do not interleave: each header is followed by its own ok line
blocks_ok=1
for n in a b c; do
  printf '%s\n' "$out" | grep -A1 "^# === test-$n-iso.sh$" | tail -1 | grep -q "ok 1 - $n met" || blocks_ok=0
done
assert_eq "--jobs 3: each block holds its own file's lines" "1" "$blocks_ok"
out="$(TMPDIR="$FIX/jtmp" HYPER_TEST_FILE_TIMEOUT=4 bash "$J/run.sh" --jobs 2 test-d-hang.sh test-g-quick.sh 2>&1)"; rc=$?
assert_eq "--jobs 2: a timeout fails the run" "1" "$rc"
assert_contains "--jobs 2: the hung file is killed" "$out" "not ok - test-d-hang.sh timed out after 4s"
assert_contains "--jobs 2: its sibling still passes" "$out" "ok 1 - quick file"
assert_eq "--jobs 2: work dirs removed" "" "$(ls "$FIX/jtmp" 2>/dev/null)"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --jobs 0 2>&1)"; rc=$?
assert_eq "--jobs 0 is a usage error" "2" "$rc"

# ---- explicit files, --budget, time lines ---------------------------------------
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" test-f-slow.sh 2>&1)"
assert_not_contains "explicit file: only that file runs" "$out" "test-a-iso.sh"
assert_contains "per-file wall time is printed" "$out" "# time: test-f-slow.sh "
assert_contains "the slowest files are summarised" "$out" "# slowest: test-f-slow.sh"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --budget 1 test-f-slow.sh 2>&1)"; rc=$?
assert_eq "--budget: a slow green file does not fail the run" "0" "$rc"
assert_contains "--budget: the overrun is a visible warning" "$out" "# over budget: test-f-slow.sh "
assert_contains "--budget: the summary counts it" "$out" "1 over budget"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --budget 1 --budget-fail test-f-slow.sh 2>&1)"; rc=$?
assert_eq "--budget-fail: an overrun fails the run" "1" "$rc"
assert_contains "--budget-fail: says which file and why" "$out" "s, over the 1s per-file budget"
assert_eq "the file timeout defaults to 1200 s" "1" "$(grep -c 'HYPER_TEST_FILE_TIMEOUT:-1200' "$TESTS_DIR/run.sh")"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --affected test-g-quick.sh 2>&1)"; rc=$?
assert_eq "--affected with explicit files is a usage error" "2" "$rc"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --affected --base no-such-ref-xyz 2>&1)"; rc=$?
assert_eq "--base must resolve to a git ref" "2" "$rc"
out="$(TMPDIR="$FIX/jtmp" bash "$J/run.sh" --base HEAD test-g-quick.sh 2>&1)"; rc=$?
assert_eq "--base without --affected is a usage error" "2" "$rc"

# ---- INT/TERM kills every file's process group and removes the work dir ---------
cat > "$J/test-h-sig.sh" <<FILE
sleep 60 &
echo \$! > "$SYNC/sig-child"
: > "$SYNC/sig-started"
wait
FILE
TMPDIR="$FIX/jtmp" bash "$J/run.sh" test-h-sig.sh >/dev/null 2>&1 &
runner=$!
for _ in $(seq 1 100); do [ -e "$SYNC/sig-started" ] && break; sleep 0.1; done
kill -TERM "$runner"; wait "$runner"; rc=$?
sleep 0.3
assert_eq "TERM: run.sh exits 130" "130" "$rc"
assert_fails "TERM: the file's background child is dead" kill -0 "$(cat "$SYNC/sig-child")"
assert_eq "TERM: work dirs removed" "" "$(ls "$FIX/jtmp" 2>/dev/null)"

# ---- CLI build failure with a package tree is not a skip (hyper-4at) ------------
T="$FIX/t"; mkdir -p "$T/agent-plugin/tests" "$T/packages/cli" "$T/node_modules" "$T/fakebin"
cp "$TESTS_DIR/run.sh" "$T/agent-plugin/tests/run.sh"
echo '{}' > "$T/packages/cli/package.json"
printf '#!/bin/sh\nexit 1\n' > "$T/fakebin/bun"; chmod +x "$T/fakebin/bun"
echo 'echo "ok 1 - ran"' > "$T/agent-plugin/tests/test-m-cli.sh"
out="$(TMPDIR="$FIX/jtmp" PATH="$T/fakebin:$PATH" HYPER_TEST_CLI_FILES=test-m-cli.sh bash "$T/agent-plugin/tests/run.sh" test-m-cli.sh 2>&1)"; rc=$?
assert_eq "auto with a package tree: a failed build exits 2" "2" "$rc"
assert_contains "auto: says the build failed" "$out" "the hyper CLI build failed"
assert_not_contains "auto: does not fall back to SKIP" "$out" "# SKIP"
out="$(TMPDIR="$FIX/jtmp" PATH="$T/fakebin:$PATH" HYPER_TEST_CLI_FILES=test-m-cli.sh HYPER_TEST_CLI=skip bash "$T/agent-plugin/tests/run.sh" test-m-cli.sh 2>&1)"; rc=$?
assert_eq "skip with a package tree still skips" "0" "$rc"

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
assert_contains "leaf script: role, loop and failover plus the lint files" "$out" "would run: test-s-ship-skills.sh test-t-ship-failover.sh test-t-ship-loop.sh test-t-ship-role.sh test-u-skill-triggers.sh test-w-ship-docs.sh"
assert_contains "leaf script: the rule is printed" "$out" "(agent-plugin/scripts/ship/ship-role)"
assert_not_contains "leaf script: the ship/* catch-all does not widen it" "$out" "running everything"
out="$(sel agent-plugin/scripts/ship/lib.sh)"
assert_contains "lib.sh: says it runs everything" "$out" "running everything"
assert_contains "lib.sh: selects a far-away file" "$out" "test-w-run-timeout.sh"
out="$(sel agent-plugin/scripts/ship/brand-new-script)"
assert_contains "an unmapped ship script widens to ALL" "$out" "running everything"
out="$(sel apps/web/index.ts notes/specs/x.md .beads/issues.jsonl)"
assert_contains "non-plugin path: not covered" "$out" "apps/web/index.ts: not covered by the plugin suite"
assert_contains "non-plugin path: nothing selected" "$out" "affected: nothing selected"
out="$(sel agent-plugin/README.md agent-plugin/CHANGELOG.md)"
assert_eq "plugin top-level docs select only the lint files" "would run: test-s-ship-skills.sh test-u-skill-triggers.sh test-w-ship-docs.sh" "$(printf '%s\n' "$out" | grep '^would run')"
out="$(sel agent-plugin/scripts/ship/notes.md agent-plugin/tests/fixtures/other/x.md)"
assert_contains "a nested .md under scripts/ship falls through to the ALL catch-all" "$out" "scripts/ship/notes.md -> ALL"
assert_contains "a nested .md under tests/fixtures falls through to ALL" "$out" "fixtures/other/x.md -> ALL"
out="$(sel agent-plugin/docs/guide.md agent-plugin/CHANGELOG.md)"
assert_not_contains "docs/ and top-level markdown stay non-widening" "$out" "running everything"
out="$(TMPDIR="$FIX/jtmp" bash "$TESTS_DIR/run.sh" --affected origin/main 2>&1)"; rc=$?
assert_eq "old positional --affected <ref> is a usage error" "2" "$rc"
assert_contains "...that names the right form" "$out" "--affected --base origin/main"
out="$(sel agent-plugin/tests/test-z-brand-new.sh)"
assert_not_contains "a test file that does not exist is not selected" "$(printf '%s\n' "$out" | grep '^would run')" "test-z-brand-new.sh"
: > "$TESTS_DIR/test-z-brand-new.sh"
out="$(sel agent-plugin/tests/test-z-brand-new.sh)"; rm -f "$TESTS_DIR/test-z-brand-new.sh"
assert_contains "a new tests/test-*.sh is selected by SELF" "$(printf '%s\n' "$out" | grep '^would run')" "test-z-brand-new.sh"
out="$(sel agent-plugin/scripts/ship/ship-role agent-plugin/scripts/ship/ship-config)"
assert_eq "two leaves: each test once, sorted" "1" "$(printf '%s\n' "$out" | grep -c '^would run: test-s-ship-skills.sh test-t-ship-config.sh test-t-ship-failover.sh test-t-ship-loop.sh test-t-ship-role.sh ')"
out="$(sel packages/cli/src/x.ts)"
assert_contains "packages/cli selects the CLI-dependent files" "$out" "test-a-detection.sh"
assert_not_contains "packages/cli does not select the rest" "$out" "test-w-run-timeout.sh"
for pk in core kit hq gen ui create-hyper-hq drive; do
  out="$(sel packages/$pk/src/x.ts)"
  assert_contains "packages/$pk selects the CLI-dependent files" "$out" "would run: test-a-detection.sh"
done
for w in bun.lock package.json .github/workflows/agent-plugin.yml; do
  out="$(sel $w)"
  assert_contains "$w selects ALL" "$out" "running everything"
done
out="$(sel packages/cli/package.json.bak apps/x)"
assert_not_contains "root package.json rule is not a substring match" "$out" "running everything"
# union and the real consumers
out="$(sel agent-plugin/skills/test-engineer/SKILL.md)"
for t in test-t-ship-loop.sh test-t-ship-unit.sh test-s-ship-skills.sh test-u-skill-triggers.sh; do
  assert_contains "skills/test-engineer change selects $t" "$out" "$t"
done
out="$(sel agent-plugin/skills/ship/defaults.yml)"
assert_contains "defaults.yml selects failover" "$out" "test-t-ship-failover.sh"
assert_contains "defaults.yml still selects config (union with the other rules)" "$out" "test-t-ship-config.sh"
out="$(sel agent-plugin/scripts/ship/schemas/x.json)"
assert_contains "schemas selects loop" "$out" "test-t-ship-loop.sh"
assert_contains "schemas selects land" "$out" "test-t-ship-land.sh"
out="$(sel agent-plugin/README.md)"
assert_contains "README selects w-ship-docs" "$out" "test-w-ship-docs.sh"
out="$(sel agent-plugin/scripts/ship/mux/fake)"
assert_contains "mux/fake unions with mux/* (docs)" "$out" "test-w-ship-docs.sh"
assert_contains "mux/fake keeps its own consumers" "$out" "test-t-ship-mux-fake.sh"
# a rename is a delete plus an add: both sides select their consumers
out="$(sel agent-plugin/scripts/ship/ship-role agent-plugin/scripts/ship/ship-role2)"
assert_contains "rename: the old path selects its tests" "$out" "test-t-ship-role.sh"
assert_contains "rename: the new, unmapped path widens to ALL" "$out" "ship-role2 -> ALL"
out="$(sel agent-plugin/scripts/ship/ship-config agent-plugin/scripts/ship/ship-cfg-new)"
assert_contains "rename: old side is selected" "$out" "ship-config -> "
# output lists only targets that run
out="$(sel agent-plugin/scripts/ship/ship-loop)"
assert_not_contains "selection output names no file that does not exist" "$out" "test-t-ship-loop-fn.sh"
out="$(sel agent-plugin/tests/helpers.sh)"
assert_contains "helpers.sh runs everything" "$out" "running everything"
out="$(sel agent-plugin/tests/run.sh)"
assert_contains "run.sh selects its own test" "$(printf '%s\n' "$out" | grep '^would run')" "test-w-run-timeout.sh"
: > "$FIX/empty.txt"
out="$(bash "$TESTS_DIR/run.sh" --affected --paths-from "$FIX/empty.txt" 2>&1)"; rc=$?
assert_eq "nothing changed: exit 0" "0" "$rc"
assert_contains "nothing changed: says so" "$out" "affected: nothing changed"
# every file named by a map rule exists: a unit that adds a test adds its row
missing=""
for t in $(grep -v '^#' "$TESTS_DIR/affected.map" | awk 'NF>=2{for(i=2;i<=NF;i++)print $i}' | grep '^test-' | sort -u); do
  [[ -f "$TESTS_DIR/$t" ]] || missing="$missing $t"
done
assert_eq "every test file named in affected.map exists" "" "$missing"

finish
