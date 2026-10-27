#!/usr/bin/env bash
# shellcheck disable=SC2034  # GATE_CMD, BUD_S, CFG_EXTRA... are read by write_cfg in lib/loop-journey.sh
# Row T (ship-loop), journeys 1 — the driver scripts/ship/ship-loop against mux/fake and a stub agent that
# writes scripted verdicts. One driver run is 15-20 ship-mux calls, so only what a whole unit can show is
# run end to end here: READY; QUESTION park and answered resume; BLOCKED park, restart without an answer
# and the verify stage; DIALOG park and clear; OVER-BUDGET and --extend; LIMIT park and resume; restart and
# takeover. Everything a function can decide (prompt text, fmt_*, budgets, trust dialog, signatures, ...) is
# in test-t-ship-loop-fn.sh; the finalize/push journeys are in test-t-ship-loop-b.sh.
#
# The stub agent (tests/fixtures/ship/stub-agent) answers each prompt the driver records in
# <verdict>.json.sent with a scripted file, so no scenario touches a real multiplexer, claude or pi.
# Each journey owns its unit (ref tN): no journey reads another one's state.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/loop-journey.sh"

TRUSTFIX="$TESTS_DIR/fixtures/ship/trust"
key_count() { local n; n="$(grep -c "^<keys:$3>\$" "$SHIP_MUX_FAKE_DIR/sent/$(agent_of "$1" "$2")" 2>/dev/null)"; echo "${n:-0}"; } # ref agent key
start_line() { grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep "$1" | "${2:-head}" -n 1; }                                          # agent [head|tail]

# --- 1: READY ------------------------------------------------------------------------------------------------
# One run carries: --model overrides, --final-gate, an accepted workspace-trust dialog, the files of an earlier
# run that an archive must keep or move, and the rulings file that is created on first use.
export SHIP_TRUST_WAIT_S=2
unit t1
mkdir -p "$(st t1)" "$SHIP_MUX_FAKE_DIR/read"
for _f in unit.json driver.exit config.json; do echo "keep $_f" >"$(st t1)/$_f"; done
echo "spec_write=kept-model" >"$(st t1)/models.override"
echo stale >"$(st t1)/stale.json"
printf '%s\n' "$(cat "$TRUSTFIX/narrow-after-down.txt")" >"$SHIP_MUX_FAKE_DIR/read/t1-dev"
printf 'Welcome back\n' >"$SHIP_MUX_FAKE_DIR/read/t1-dev.after-enter"
script t1 develop.json "$DEV_DONE"
script t1 review-r1.json "$REV_OK"
script t1 final-r1.json "$REV_OK"
: >"$SHIP_TEST_GATELOG"
assert_eq "READY: the rulings file does not exist before the first run" "no" "$([[ -e "$SPACE/notes/decisions.md" ]] && echo yes || echo no)"
stub_start t1; run_loop t1 --final-gate --model dev=zz-dev --model review=zz-review,other; stub_stop
check_result t1 "READY" 0 READY
assert_eq "READY: the PR number comes from develop.json" "7" "$(res t1 .pr)"
assert_eq "READY: one round, review accepted" "ACCEPT" "$(res t1 '.rounds[0].verdict')"
assert_eq "READY: no spec hunks, so the spec stage was skipped" "SKIP" "$(res t1 .spec.verdict)"
assert_eq "READY: the final gate ran once and accepted" "ACCEPT 1" "$(res t1 '"\(.final.verdict) \(.final.rounds)"')"
assert_eq "READY: verify without instructions is a driver-written SKIP" "SKIP" "$(jq -r .verdict "$(st t1)/verify-r1.json")"
assert_eq "READY: finalize.json is DONE" "DONE" "$(jq -r .status "$(st t1)/finalize.json")"
assert_eq "READY: finalize is in result.json" "DONE" "$(res t1 .finalize.status)"
assert_eq "READY: the gate ran once, in the worktree flow" "gate-ran" "$(cat "$SHIP_TEST_GATELOG")"
assert_eq "READY: the branch was pushed" "$(git -C "$SPACE/worktrees/t1" rev-parse HEAD)" "$(git -C "$FIX/origin-t1.git" rev-parse refs/heads/feat-t1)"
assert_eq "READY: only the dev is left running (the reviewer and the final gate were closed)" "t1-dev" "$(live_agents t1)"
assert_eq "READY: the dev was started once" "1" "$(starts_of t1-dev)"
assert_eq "READY: the reviewer was started once" "1" "$(starts_of t1-review-r1)"
assert_ok "READY: the develop verdict validates" validate_verdict "$SCHEMAS_DIR/develop.json" "$(st t1)/develop.json"
assert_contains "READY: the dev prompt names the gate" "$(cat "$(st t1)/develop.prompt.md")" "echo gate-ran"
assert_contains "READY: the dev prompt tells the dev to leave the gate to the driver" "$(cat "$(st t1)/develop.prompt.md")" "Do not run it: the driver runs it itself"
assert_not_contains "READY: the dev prompt no longer tells the dev to run the gate in the foreground" "$(cat "$(st t1)/develop.prompt.md")" "Run it in the foreground"
assert_contains "READY: the verdict example asks for the affected-run tail" "$(cat "$(st t1)/develop.prompt.md")" "affected-run tail"
assert_not_contains "READY: the verdict example no longer asks for the gate tail" "$(cat "$(st t1)/develop.prompt.md")" "gate tail"
assert_not_contains "READY: the dev prompt no longer waits on a green gate before the PR" "$(cat "$(st t1)/develop.prompt.md")" "the gate is green"
assert_contains "READY: the dev prompt names the brief" "$(cat "$(st t1)/develop.prompt.md")" "$BRIEF"
assert_contains "READY: the dev prompt points at the test-engineer skill" "$(cat "$(st t1)/develop.prompt.md")" "$PLUGIN_DIR/skills/test-engineer/SKILL.md"
assert_contains "READY: the review prompt points at the test-engineer skill" "$(cat "$(st t1)/review-r1.prompt.md")" "$PLUGIN_DIR/skills/test-engineer/SKILL.md"
assert_not_contains "READY: no placeholder is left in the dev prompt" "$(cat "$(st t1)/develop.prompt.md")" "{ref}"
assert_ok "READY: each agent got its role profile (settings file)" test -f "$HOME/.cache/hyper/roles/proj-"*/dev.json
assert_contains "READY: claude agents are pinned to a session" "$(jq -c . "$(st t1)/agents/t1-dev.json")" '"harness":"claude"'
assert_contains "READY: the start call carries --session-id" "$(start_line t1-dev)" "--session-id"
assert_contains "READY: and the role flags" "$(start_line t1-dev)" "--strict-mcp-config"
# --model
assert_contains "--model: the dev runs the override" "$(start_line t1-dev)" '"zz-dev"'
assert_contains "--model: the reviewer runs the first of its list" "$(start_line t1-review)" '"zz-review"'
# the final gate's signature is written when it is prompted
assert_ok "final sig: final-r1.sig exists" test -s "$(st t1)/final-r1.sig"
assert_eq "final sig: and equals the diff the review was shown" "$(cat "$(st t1)/review-r1.sig")" "$(cat "$(st t1)/final-r1.sig" 2>/dev/null)"
# the workspace-trust dialog: Enter once, the dev started once
assert_eq "trust dialog: Enter was pressed once" "1" "$(key_count t1 t1-dev enter)"
assert_eq "trust dialog: no down was sent (the default was Yes)" "0" "$(key_count t1 t1-dev down)"
assert_eq "trust dialog: one log line says so" "1" "$(grep -c 'workspace-trust dialog' "$(st t1)/loop.log")"
# a new run moves the earlier run's files aside and keeps the unit's own
for _f in unit.json driver.exit config.json; do
  assert_eq "archive: $_f stays in place" "keep $_f" "$(cat "$(st t1)/$_f" 2>/dev/null)"
done
assert_eq "archive: models.override stays in place" "spec_write=kept-model" "$(cat "$(st t1)/models.override" 2>/dev/null)"
assert_eq "archive: another file is moved into run-*" "yes" "$(ls "$(st t1)"/run-*/stale.json >/dev/null 2>&1 && echo yes || echo no)"
# the rulings file is created on first use (mutation: drop the printf '# Rulings' creation in main)
assert_eq "rulings: decisions.md was created on first use" "# Rulings" "$(head -n 1 "$SPACE/notes/decisions.md" 2>/dev/null)"
unset SHIP_TRUST_WAIT_S

# --- 2: QUESTION park, resume with an answer ------------------------------------------------------------------
reset_fake; unit t2
script t2 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"stuck on a choice","question":"Should EMPTY input fail?"}'
script t2 develop.json.2 "$DEV_DONE"
script t2 review-r1.json "$REV_OK"
stub_start t2; run_loop t2
check_result t2 "QUESTION" 2 PARKED
assert_eq "QUESTION: park.json status" "QUESTION" "$(jq -r .status "$(st t2)/park.json")"
assert_eq "QUESTION: park.json carries the question" "Should EMPTY input fail?" "$(jq -r .question "$(st t2)/park.json")"
assert_eq "QUESTION: park.json names the dev" "t2-dev" "$(jq -r .agent "$(st t2)/park.json")"
assert_eq "QUESTION: park.json is numbered" "1" "$(jq -r .n "$(st t2)/park.json")"
assert_ok "QUESTION: park.json matches the park schema" validate_verdict "$SCHEMAS_DIR/park.json" "$(st t2)/park.json"
assert_eq "QUESTION: result.json embeds the park" "QUESTION" "$(res t2 .park.status)"
assert_eq "QUESTION: the parked dev is still running" "t2-dev" "$(live_agents t2)"
assert_ok "QUESTION: the dev's question is kept next to the park" test -f "$(st t2)/develop.QUESTION-1.json"
assert_ok "QUESTION: the driver exited (no pid left alive)" bash -c '! kill -0 "$(cat "'"$(st t2)"'/driver.pid")" 2>/dev/null'
printf 'No: EMPTY input exits 2.\n' >"$(st t2)/answer-1.md"
run_loop t2; stub_stop
check_result t2 "QUESTION, resumed with answer-1.md" 0 READY
assert_contains "QUESTION: the answer was sent to the parked dev" "$(sent_to t2 t2-dev)" "No: EMPTY input exits 2."
assert_eq "QUESTION: the dev was never restarted" "1" "$(starts_of t2-dev)"
assert_eq "QUESTION: develop was prompted twice (task, answer)" "2" "$(wc -l <"$(st t2)/develop.json.sent" | tr -d ' ')"
assert_ok "QUESTION: the resolved park is archived" test -f "$(st t2)/park-1.json"
assert_ok "QUESTION: no park.json is left" test ! -e "$(st t2)/park.json"

# --- 3: BLOCKED park, restart without an answer, and the verify stage -------------------------------------------
# One unit: the dev is BLOCKED and the lead resumes with no answer (the dev is replaced); verify FAILs once (the dev
# gets the evidence, no review in that round), then BLOCKS (the verifier is kept alive, the answer reaches it).
reset_fake; unit t3
CFG_EXTRA="stages:
  verify:
    instructions: notes/verify.md"; write_cfg
script t3 develop.json.1 '{"status":"BLOCKED","pr":null,"head":null,"summary":"cannot build","question":"the toolchain is missing"}'
script t3 develop.json.2 "$DEV_DONE"
script t3 verify-r1.json '{"verdict":"FAIL","summary":"ran it","failures":[{"what":"exit code is 0 on bad input","evidence":"ran x --bad, echo $? printed 0"}]}'
script t3 fix-r2.json "$DEV_DONE"
script t3 verify-r2.json.1 '{"verdict":"BLOCKED","summary":"could not start the binary","failures":[]}'
script t3 verify-r2.json.2 '{"verdict":"PASS","summary":"fine","failures":[]}'
script t3 review-r2.json "$REV_OK"
stub_start t3; run_loop t3
check_result t3 "BLOCKED" 2 PARKED
assert_eq "BLOCKED: park.json status" "BLOCKED" "$(jq -r .status "$(st t3)/park.json")"
assert_contains "BLOCKED: park.json carries the dev's words" "$(jq -r .question "$(st t3)/park.json")" "the toolchain is missing"
assert_eq "BLOCKED: the dev is left alive" "t3-dev" "$(live_agents t3)"
run_loop t3   # no answer: the parked dev is closed and the stage restarts with a new one
check_result t3 "BLOCKED, resumed without an answer: then verify blocks" 2 PARKED
assert_eq "BLOCKED: the parked dev was closed and a new one started" "2" "$(starts_of t3-dev)"
assert_contains "BLOCKED: the new dev is told it takes over" "$(sent_to t3 t3-dev)" "You are taking over unit t3"
assert_eq "BLOCKED: the resolved park is archived" "yes" "$([[ -e "$(st t3)/park-1.json" ]] && echo yes || echo no)"
assert_contains "verify: the verify prompt carries the project instructions" "$(cat "$(st t3)/verify-r1.prompt.md")" "verify by running it"
assert_contains "verify: the dev gets the failure evidence" "$(cat "$(st t3)/fix-r2.prompt.md")" "echo \$? printed 0"
assert_eq "verify: round 1 is recorded as a verify failure" "VERIFY-FAIL" "$(res t3 '.rounds[0].verdict')"
assert_eq "verify: no review happened in either round so far" "0" "$(( $(starts_of t3-review-r1) + $(starts_of t3-review-r2) ))"
assert_eq "verify BLOCKED: park status" "BLOCKED" "$(jq -r .status "$(st t3)/park.json")"
assert_eq "verify BLOCKED: the stage" "verify" "$(res t3 .stage)"
assert_eq "verify BLOCKED: parked on the verifier" "t3-verify-r2" "$(jq -r .agent "$(st t3)/park.json")"
assert_contains "verify BLOCKED: with its summary" "$(jq -r .question "$(st t3)/park.json")" "could not start the binary"
assert_eq "verify BLOCKED: the verifier stays alive" "t3-dev t3-verify-r2" "$(live_agents t3)"
printf 'The binary is at ./bin/x.\n' >"$(st t3)/answer-$(jq -r .n "$(st t3)/park.json").md"
run_loop t3; stub_stop
check_result t3 "verify BLOCKED, answered" 0 READY
assert_contains "verify BLOCKED: the answer reached the verifier" "$(sent_to t3 t3-verify-r2)" "The binary is at ./bin/x."
assert_eq "verify BLOCKED: the verifier was not restarted" "1" "$(starts_of t3-verify-r2)"
assert_eq "verify BLOCKED: and is closed once it passed" "t3-dev" "$(live_agents t3)"
CFG_EXTRA=''; write_cfg

# --- 4: DIALOG park, cleared ----------------------------------------------------------------------------------
# A permission dialog that is not the trust dialog: parked as DIALOG, no key sent, the dev left alive. (The trust
# dialog's keys are a function-level matter: trust_state and trust_dialog in test-t-ship-loop-fn.sh.)
reset_fake; unit t4
mkdir -p "$SHIP_MUX_FAKE_DIR/status" "$SHIP_MUX_FAKE_DIR/read"
printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t4-dev"
printf 'Some tool wants to run.\n\n  ❯ 1. Yes\n    2. No\n' >"$SHIP_MUX_FAKE_DIR/read/t4-dev"
stub_start t4; run_loop t4
check_result t4 "DIALOG" 2 PARKED
assert_eq "DIALOG: park.json status" "DIALOG" "$(jq -r .status "$(st t4)/park.json")"
assert_eq "DIALOG: the dev is left alive" "t4-dev" "$(live_agents t4)"
assert_eq "DIALOG: no key was sent to the dialog" "0 0" "$(key_count t4 t4-dev enter) $(key_count t4 t4-dev down)"
printf 'idle\n' >"$SHIP_MUX_FAKE_DIR/status/t4-dev"
script t4 develop.json "$DEV_DONE"; script t4 review-r1.json "$REV_OK"
run_loop t4; stub_stop
check_result t4 "DIALOG, resumed after the dialog cleared" 0 READY
assert_eq "DIALOG: the dev was never restarted" "1" "$(starts_of t4-dev)"

# --- 5: OVER-BUDGET, then --extend ------------------------------------------------------------------------------
reset_fake; unit t5
BUD_S=0.02; write_cfg
stub_start t5; run_loop t5
check_result t5 "OVER-BUDGET" 2 OVER-BUDGET
assert_eq "OVER-BUDGET: budget-r1.json verdict" "OVER-BUDGET" "$(jq -r .verdict "$(st t5)/budget-r1.json")"
assert_eq "OVER-BUDGET: names the stage and the class" "develop S" "$(jq -r '"\(.stage) \(.class)"' "$(st t5)/budget-r1.json")"
assert_ok "OVER-BUDGET: budget-r1.json matches the budget schema" validate_verdict "$SCHEMAS_DIR/budget.json" "$(st t5)/budget-r1.json"
assert_eq "OVER-BUDGET: the agent is left running" "t5-dev" "$(live_agents t5)"
script t5 develop.json "$DEV_DONE"; script t5 review-r1.json "$REV_OK"
printf '5\n' >"$(st t5)/extend"
run_loop t5; stub_stop
check_result t5 "OVER-BUDGET, resumed with extend" 0 READY
assert_eq "OVER-BUDGET: the extension was recorded for the stage" "5" "$(cat "$(st t5)/develop.json.extra")"
assert_eq "OVER-BUDGET: the dev was never restarted" "1" "$(starts_of t5-dev)"
BUD_S=10; write_cfg

# --- 13: LIMIT (nothing to fail over to: the unit parks) -----------------------------------------------------------
reset_fake; unit t13
# the limit text appears on the pane after the dev's prompt (the driver reads only the newest lines)
export SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/limitmux" LIMITMUX_REAL="$SCRIPTS_DIR/ship/ship-mux"
mkdir -p "$SHIP_MUX_FAKE_DIR/after-send"
printf "You've hit your weekly limit · resets Fri 4pm\n" >"$SHIP_MUX_FAKE_DIR/after-send/t13-dev"
stub_start t13; run_loop t13; stub_stop
check_result t13 "LIMIT" 2 PARKED
assert_eq "LIMIT: park.json status" "LIMIT" "$(jq -r .status "$(st t13)/park.json")"
assert_contains "LIMIT: the matched text is reported" "$(jq -r .question "$(st t13)/park.json")" "hit your weekly limit"
assert_eq "LIMIT: the agent is left alone" "t13-dev" "$(live_agents t13)"
# resume: the parked agent is closed and the stage restarts through model_pick, so the override applies
# The limit was recorded in limited.json (reactive failover); the quota has reset by the time the lead resumes.
assert_ok "LIMIT: the limit was recorded in limited.json" test -s "$HOME/.cache/hyper/quota/limited.json"
assert_eq "LIMIT: it is an account limit" default "$(jq -r '.accounts | keys | join(",")' "$HOME/.cache/hyper/quota/limited.json")"
bash "$LOOP" --clear-limit default >/dev/null
assert_eq "LIMIT: --clear-limit forgot the account" null "$(jq -r '.accounts.default // null' "$HOME/.cache/hyper/quota/limited.json")"
printf 'dev=zz-after-limit\n' >"$(st t13)/models.override"
rm -f "$SHIP_MUX_FAKE_DIR/after-send/t13-dev" "$SHIP_MUX_FAKE_DIR/status/t13-dev"; rm -rf "$FIX/scripts/t13/.done"
script t13 develop.json "$DEV_DONE"; script t13 review-r1.json "$REV_OK"
clear_sent t13 develop.json; stub_start t13; run_loop t13; stub_stop
check_result t13 "LIMIT, resumed with a models.override" 0 READY
assert_eq "LIMIT: the limited dev was closed and a new one started" "2" "$(starts_of t13-dev)"
assert_contains "LIMIT: the new dev runs the override model" "$(start_line t13-dev tail)" '"zz-after-limit"'
assert_contains "LIMIT: and the first one did not" "$(start_line t13-dev head)" '--model'
assert_not_contains "LIMIT: the first dev was not on the override" "$(start_line t13-dev head)" 'zz-after-limit'
unset SHIP_LOOP_MUX LIMITMUX_REAL

# --- 45: restart and takeover ---------------------------------------------------------------------------------
# A BLOCKED park the lead restarts without an answer continues the same run (clock kept, nothing archived, a new dev
# takes over). The driver is killed while the reviewer works; the dev is then gone as well: the next run reattaches
# the live reviewer (no second start, no second prompt) and the new dev is told it takes over, with the findings.
reset_fake; unit t45
mkdir -p "$(st t45)"
cat >"$(st t45)/park.json" <<PARK
{"status":"BLOCKED","stage":"develop","agent":"t45-dev","question":"it stopped","since":"2026-01-01T00:00:00Z","n":1,"file":"$(st t45)/develop.json"}
PARK
printf '17\n' >"$(st t45)/develop.json.clock"
script t45 develop.json "$DEV_DONE"
stub_start t45
bash "$LOOP" --ref t45 --worktree "$SPACE/worktrees/t45" --branch feat-t45 --brief "$BRIEF" --class S >/dev/null 2>"$FIX/err-t45.log" &
DRV=$!
for _ in $(seq 400); do [[ -e "$(st t45)/review-r1.json.sent" ]] && break; sleep 0.05; done
assert_ok "restart: the driver reached the review" test -e "$(st t45)/review-r1.json.sent"
kill -9 "$DRV" 2>/dev/null; wait "$DRV" 2>/dev/null
assert_contains "restart: the new dev was told it takes over" "$(sent_to t45 t45-dev)" "You are taking over unit t45"
assert_eq "restart: nothing was archived" "0" "$(ls -d "$(st t45)"/run-* 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "restart: the clock of the earlier run was carried (17 s or more)" "yes" "$([[ "$(cat "$(st t45)/develop.json.clock")" -ge 17 ]] && echo yes || echo no)"
(cd "$SPACE" && bash "$SCRIPTS_DIR/ship/ship-mux" close --ref t45 --id "$(agent_of t45 t45-dev)" >/dev/null 2>&1)
script t45 review-r1.json "$REV_CHANGES"; script t45 fix-r2.json "$DEV_DONE"; script t45 review-r2.json "$REV_OK"
run_loop t45; stub_stop
check_result t45 "restart with a live reviewer and a gone dev" 0 READY
assert_eq "restart: the reviewer was reattached, not restarted" "1" "$(starts_of t45-review-r1)"
assert_eq "restart: the reviewer was prompted once" "1" "$(wc -l <"$(st t45)/review-r1.json.sent" | tr -d ' ')"
assert_eq "takeover: a second dev started" "2" "$(starts_of t45-dev)"
assert_contains "takeover: the fix prompt starts with the takeover text" "$(cat "$(st t45)/fix-r2.prompt.md")" "You are taking over unit t45"
assert_contains "takeover: and carries the findings after it" "$(cat "$(st t45)/fix-r2.prompt.md")" "Fix: change it"
assert_eq "takeover: the earlier results are kept and nothing was archived" "DONE 0" "$(jq -r .status "$(st t45)/develop.json") $(ls -d "$(st t45)"/run-* 2>/dev/null | wc -l | tr -d ' ')"

# --- 55: the stub agent does not miss a prompt when a recreated .sent marker has the same inode ----------------------
S55="$FIX/stub55"; mkdir -p "$S55/state" "$S55/script"
printf '{"n":1}\n' >"$S55/script/x.json"; printf '1000 a\n' >"$S55/state/x.json.sent"
bash "$STUB" "$S55/state" "$S55/script" >/dev/null 2>&1 & _sp=$!
for _ in $(seq 60); do [[ -e "$S55/state/x.json" ]] && break; sleep 0.05; done
assert_ok "stub: the first prompt is answered" test -e "$S55/state/x.json"
rm -f "$S55/state/x.json"; printf '1000 b\n' >"$S55/state/x.json.sent"   # truncated in place: the same inode, one line again
for _ in $(seq 60); do [[ -e "$S55/state/x.json" ]] && break; sleep 0.05; done
assert_ok "stub: a marker that reuses the inode still counts as a new prompt" test -e "$S55/state/x.json"
kill "$_sp" 2>/dev/null; wait "$_sp" 2>/dev/null
assert_ok "the stub agent passes bash -n" bash -n "$STUB"

stub_stop
finish
