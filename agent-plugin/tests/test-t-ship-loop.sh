#!/usr/bin/env bash
# Row T (ship-loop) — the driver scripts/ship/ship-loop against mux/fake and a stub agent
# that writes scripted verdicts. Every scenario asserts the exit code and result.json.status.
#
# The stub agent (tests/fixtures/ship/stub-agent) answers each prompt the driver records in
# <verdict>.json.sent with a scripted file, so no scenario touches a real multiplexer, claude
# or pi. Scenarios: READY; QUESTION park and resume with an answer; BLOCKED; DIALOG;
# OVER-BUDGET and --extend; STUCK; GAP -> spec writer -> ACCEPT; REMOVE (code, spec);
# malformed and schema-invalid verdicts; restart in the middle of a review; LIMIT; verify
# FAIL; the final gate; finalize sending a rebase conflict, a failing gate and a forbidden
# line back to the dev; --model; --preflight; C-1, C-2 and C-11 on the script.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

LOOP="$SCRIPTS_DIR/ship/ship-loop"
STUB="$TESTS_DIR/fixtures/ship/stub-agent"
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"

SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/notes" "$HOME/.claude" "$FIX/bin" "$FIX/scripts"
PROJECT="$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief.md"
printf '# Brief\n\nDo the thing.\n' >"$BRIEF"
printf '{"enabledPlugins":{}}\n' >"$HOME/.claude/settings.json"
printf 'verify by running it\n' >"$SPACE/notes/verify.md"

export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_POLL_S=0.05
export SHIP_IDLE_GRACE_S=3600
export SHIP_TEST_GATELOG="$FIX/gate.log"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS

# Stubs for the CLIs preflight looks for; the driver never runs them in these tests.
for c in claude pi gh; do printf '#!/bin/sh\nexit 0\n' >"$FIX/bin/$c"; chmod +x "$FIX/bin/$c"; done
export PATH="$FIX/bin:$PATH"

# --- fixtures -------------------------------------------------------------------------------------

GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"' MAXR=3 BUD_S=10 CFG_EXTRA=''
write_cfg() {
  cat >"$PROJECT" <<EOF
mux: fake
gate: '$GATE_CMD'
max_rounds: $MAXR
budgets:
  S: $BUD_S
spec:
  paths: ['docs/spec/**']
$CFG_EXTRA
EOF
}
write_cfg

DEV_DONE='{"status":"DONE","pr":7,"head":"abc1234","summary":"done, gate green"}'
REV_OK='{"verdict":"ACCEPT","findings":[]}'
REV_CHANGES='{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"a.go","line":3,"summary":"the bug","fix":"change it"}]}'
SPEC_OK='{"verdict":"ACCEPT","findings":[],"gaps":[],"removals":[],"commits":[],"gate":"green"}'
SPEC_GAP='{"verdict":"GAP","findings":[],"gaps":[{"where":"docs/spec/a.md:3","quotes":["the spec is silent"],"question":"What happens on EMPTY input?","operator_call":false}],"removals":[],"commits":[],"gate":"green"}'
SPEC_RM_CODE='{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"pkg/x.go:10","kind":"code","what":"the --frobnicate flag","why_no_consumer":"the brief names no caller"}],"commits":[],"gate":"green"}'
SPEC_RM_SPEC='{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"docs/spec/a.md:9","kind":"spec","what":"the frobnicate section","why_no_consumer":"nothing consumes it"}],"commits":[],"gate":"green"}'
SW_OK='{"status":"WRITTEN","commits":["abc spec: settle it"],"resolved":[{"where":"docs/spec/a.md#empty","question":"EMPTY input","says":"EMPTY input is rejected with exit 2"}],"operator_questions":[],"gate":"green"}'

# unit <ref> [spec] — origin, a worktree with a branch one commit ahead of main (touching
# docs/spec/ when "spec" is given), and a script directory for the stub agent.
unit() {
  local ref="$1" w="$SPACE/worktrees/$1" o="$FIX/origin-$1.git"
  git init -q --bare "$o"
  git clone -q "$o" "$w" 2>/dev/null
  echo base >"$w/f.txt"; git -C "$w" add -A; git -C "$w" commit -qm "base"; git -C "$w" push -q -u origin main 2>/dev/null
  git -C "$w" checkout -q -b "feat-$ref"
  echo change >"$w/feat.txt"
  if [[ "${2:-}" == spec ]]; then mkdir -p "$w/docs/spec"; echo "spec text" >"$w/docs/spec/a.md"; fi
  git -C "$w" add -A; git -C "$w" commit -qm "feat: the change"
  git -C "$w" push -q -u origin "feat-$ref" 2>/dev/null
  mkdir -p "$FIX/scripts/$ref"
}
script() { printf '%s\n' "$3" >"$FIX/scripts/$1/$2"; } # ref file json
STUB_PID=""
stub_start() { bash "$STUB" "$SPACE/notes/loops/$1" "$FIX/scripts/$1" >/dev/null 2>&1 & STUB_PID=$!; }
stub_stop() { [[ -z "$STUB_PID" ]] || { kill "$STUB_PID" 2>/dev/null; wait "$STUB_PID" 2>/dev/null; STUB_PID=""; }; }

RC="" OUT=""
run_loop() { # ref [args...]
  local ref="$1"; shift
  OUT="$(bash "$LOOP" --ref "$ref" --worktree "$SPACE/worktrees/$ref" --branch "feat-$ref" --brief "$BRIEF" --class S "$@" 2>"$FIX/err-$ref.log")"
  RC=$?
}
st() { echo "$SPACE/notes/loops/$1"; }
res() { jq -r "$2" "$(st "$1")/result.json"; } # ref filter
check_result() { # ref desc exit status
  if [[ "$RC" != "$3" ]]; then
    echo "# $2: driver.err: $(cat "$(st "$1")/driver.err" 2>/dev/null)" >&2
    tail -n 6 "$(st "$1")/loop.log" 2>/dev/null | sed 's/^/# loop.log: /' >&2
  fi
  assert_eq "$2: exit code" "$3" "$RC"
  assert_eq "$2: result.json status" "$4" "$(res "$1" .status)"
  assert_ok "$2: result.json matches the result schema" validate_verdict "$SCHEMAS_DIR/result.json" "$(st "$1")/result.json"
  assert_eq "$2: stdout carries the same result" "$(jq -S . "$(st "$1")/result.json")" "$(jq -S . <<<"$OUT")"
}
SCHEMAS_DIR="$SCRIPTS_DIR/ship/schemas"
starts_of() { jq -s --arg n "$1" '[.[] | select(.verb == "start" and (.args | index($n)))] | length' "$SHIP_MUX_FAKE_LOG"; }
agent_of() { jq -r .id "$(st "$1")/agents/$2.json"; }
sent_to() { cat "$SHIP_MUX_FAKE_DIR/sent/$(agent_of "$1" "$2")" 2>/dev/null; }
live_agents() { (cd "$SPACE" && bash "$SCRIPTS_DIR/ship/ship-mux" list --ref "$1" 2>/dev/null) | jq -r '[.[] | select(.kind == "agent") | .name] | sort | join(" ")'; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG"; }
reset_fake

# --- 1: READY ----------------------------------------------------------------------------------------
unit t1
script t1 develop.json "$DEV_DONE"
script t1 review-r1.json "$REV_OK"
: >"$SHIP_TEST_GATELOG"
stub_start t1; run_loop t1; stub_stop
check_result t1 "READY" 0 READY
assert_eq "READY: the PR number comes from develop.json" "7" "$(res t1 .pr)"
assert_eq "READY: one round, review accepted" "ACCEPT" "$(res t1 '.rounds[0].verdict')"
assert_eq "READY: no spec hunks, so the spec stage was skipped" "SKIP" "$(res t1 .spec.verdict)"
assert_eq "READY: verify without instructions is a driver-written SKIP" "SKIP" "$(jq -r .verdict "$(st t1)/verify-r1.json")"
assert_eq "READY: finalize.json is DONE" "DONE" "$(jq -r .status "$(st t1)/finalize.json")"
assert_eq "READY: finalize is in result.json" "DONE" "$(res t1 .finalize.status)"
assert_eq "READY: the gate ran once, in the worktree flow" "gate-ran" "$(cat "$SHIP_TEST_GATELOG")"
assert_eq "READY: the branch was pushed" "$(git -C "$SPACE/worktrees/t1" rev-parse HEAD)" "$(git -C "$FIX/origin-t1.git" rev-parse refs/heads/feat-t1)"
assert_eq "READY: only the dev is left running (the reviewer was closed)" "t1-dev" "$(live_agents t1)"
assert_eq "READY: the dev was started once" "1" "$(starts_of t1-dev)"
assert_eq "READY: the reviewer was started once" "1" "$(starts_of t1-review-r1)"
assert_ok "READY: the develop verdict validates" validate_verdict "$SCHEMAS_DIR/develop.json" "$(st t1)/develop.json"
assert_contains "READY: the dev prompt names the gate and the brief" "$(cat "$(st t1)/develop.prompt.md")" "echo gate-ran"
assert_contains "READY: the dev prompt names the brief" "$(cat "$(st t1)/develop.prompt.md")" "$BRIEF"
assert_not_contains "READY: no placeholder is left in the dev prompt" "$(cat "$(st t1)/develop.prompt.md")" "{ref}"
assert_contains "READY: the fix-style JSON example is rendered" "$(cat "$(st t1)/develop.prompt.md")" "$(st t1)/develop.json"
assert_ok "READY: each agent got its role profile (settings file)" test -f "$HOME/.cache/hyper/roles/proj-"*/dev.json
assert_contains "READY: claude agents are pinned to a session" "$(jq -c . "$(st t1)/agents/t1-dev.json")" '"harness":"claude"'
assert_contains "READY: the start call carries --session-id" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | head -n 1)" "--session-id"
assert_contains "READY: and the role flags" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | head -n 1)" "--strict-mcp-config"

# --- 2: QUESTION park, resume with an answer --------------------------------------------------------------
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
run_loop t2
check_result t2 "QUESTION, restarted without an answer" 2 PARKED
assert_eq "QUESTION: still parked, nothing was sent to the dev" "1" "$(starts_of t2-dev)"
printf 'No: EMPTY input exits 2.\n' >"$(st t2)/answer-1.md"
run_loop t2; stub_stop
check_result t2 "QUESTION, resumed with answer-1.md" 0 READY
assert_contains "QUESTION: the answer was sent to the parked dev" "$(sent_to t2 t2-dev)" "No: EMPTY input exits 2."
assert_eq "QUESTION: the dev was never restarted" "1" "$(starts_of t2-dev)"
assert_eq "QUESTION: develop was prompted twice (task, answer)" "2" "$(wc -l <"$(st t2)/develop.json.sent" | tr -d ' ')"
assert_ok "QUESTION: the resolved park is archived" test -f "$(st t2)/park-1.json"
assert_ok "QUESTION: no park.json is left" test ! -e "$(st t2)/park.json"

# --- 3: BLOCKED ------------------------------------------------------------------------------------------
reset_fake; unit t3
script t3 develop.json '{"status":"BLOCKED","pr":null,"head":null,"summary":"cannot build","question":"the toolchain is missing"}'
stub_start t3; run_loop t3; stub_stop
check_result t3 "BLOCKED" 2 PARKED
assert_eq "BLOCKED: park.json status" "BLOCKED" "$(jq -r .status "$(st t3)/park.json")"
assert_contains "BLOCKED: park.json carries the dev's words" "$(jq -r .question "$(st t3)/park.json")" "the toolchain is missing"
assert_eq "BLOCKED: the dev is left alive" "t3-dev" "$(live_agents t3)"

# --- 4: DIALOG ---------------------------------------------------------------------------------------------
reset_fake; unit t4
mkdir -p "$SHIP_MUX_FAKE_DIR/status"
printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t4-dev"
stub_start t4; run_loop t4
check_result t4 "DIALOG" 2 PARKED
assert_eq "DIALOG: park.json status" "DIALOG" "$(jq -r .status "$(st t4)/park.json")"
assert_eq "DIALOG: the dev is left alive" "t4-dev" "$(live_agents t4)"
run_loop t4
check_result t4 "DIALOG, restarted while still blocked" 2 PARKED
printf 'idle\n' >"$SHIP_MUX_FAKE_DIR/status/t4-dev"
script t4 develop.json "$DEV_DONE"; script t4 review-r1.json "$REV_OK"
run_loop t4; stub_stop
check_result t4 "DIALOG, resumed after the dialog cleared" 0 READY
assert_eq "DIALOG: the dev was never restarted" "1" "$(starts_of t4-dev)"

# --- 5: OVER-BUDGET, then --extend -----------------------------------------------------------------------------
reset_fake; unit t5
BUD_S=0.02; write_cfg
stub_start t5; run_loop t5
check_result t5 "OVER-BUDGET" 2 OVER-BUDGET
assert_eq "OVER-BUDGET: budget-r1.json verdict" "OVER-BUDGET" "$(jq -r .verdict "$(st t5)/budget-r1.json")"
assert_eq "OVER-BUDGET: names the stage and the class" "develop S" "$(jq -r '"\(.stage) \(.class)"' "$(st t5)/budget-r1.json")"
assert_ok "OVER-BUDGET: budget-r1.json matches the budget schema" validate_verdict "$SCHEMAS_DIR/budget.json" "$(st t5)/budget-r1.json"
assert_eq "OVER-BUDGET: the agent is left running" "t5-dev" "$(live_agents t5)"
run_loop t5
check_result t5 "OVER-BUDGET, restarted without --extend" 2 OVER-BUDGET
assert_eq "OVER-BUDGET: no second budget file" "no" "$([[ -e "$(st t5)/budget-r2.json" ]] && echo yes || echo no)"
script t5 develop.json "$DEV_DONE"; script t5 review-r1.json "$REV_OK"
printf '5\n' >"$(st t5)/extend"
run_loop t5; stub_stop
check_result t5 "OVER-BUDGET, resumed with extend" 0 READY
assert_eq "OVER-BUDGET: the extension was recorded for the stage" "5" "$(cat "$(st t5)/develop.json.extra")"
assert_eq "OVER-BUDGET: the dev was never restarted" "1" "$(starts_of t5-dev)"
BUD_S=10; write_cfg

# --- 6: STUCK at max rounds ------------------------------------------------------------------------------------------
reset_fake; unit t6
MAXR=2; write_cfg
script t6 develop.json "$DEV_DONE"
script t6 review-r1.json "$REV_CHANGES"; script t6 review-r2.json "$REV_CHANGES"
script t6 fix-r2.json "$DEV_DONE"
stub_start t6; run_loop t6; stub_stop
check_result t6 "STUCK" 2 STUCK
assert_eq "STUCK: the stage in flight" "review" "$(res t6 .stage)"
assert_eq "STUCK: both rounds are recorded" "2" "$(res t6 '.rounds | length')"
assert_contains "STUCK: the last findings are reported" "$(res t6 .findings)" "the bug"
assert_contains "STUCK: the fix round got the reviewer's findings" "$(cat "$(st t6)/fix-r2.prompt.md")" "Fix: change it"
assert_contains "STUCK: the fix prompt renders the PR number in its JSON example" "$(cat "$(st t6)/fix-r2.prompt.md")" '"pr":7'
assert_eq "STUCK: no finalize happened" "no" "$([[ -e "$(st t6)/finalize.json" ]] && echo yes || echo no)"
assert_eq "STUCK: the second reviewer is a fresh agent" "1" "$(starts_of t6-review-r2)"
MAXR=3; write_cfg

# --- 7: GAP -> spec writer -> ACCEPT ----------------------------------------------------------------------------------
reset_fake; unit t7 spec
script t7 develop.json "$DEV_DONE"
script t7 review-r1.json "$REV_OK"; script t7 review-r2.json "$REV_OK"
script t7 spec-r1.json "$SPEC_GAP"; script t7 spec-r2.json "$SPEC_OK"
script t7 specwriter-r1.json "$SW_OK"
script t7 fix-r2.json "$DEV_DONE"
stub_start t7; run_loop t7; stub_stop
check_result t7 "GAP -> spec writer" 0 READY
assert_eq "GAP: the spec writer ran once" "1" "$(res t7 .specwriter.runs)"
assert_eq "GAP: its commits are reported" "abc spec: settle it" "$(res t7 '.specwriter.commits[0]')"
assert_eq "GAP: the spec check ran twice and ended in ACCEPT" "ACCEPT 2" "$(res t7 '"\(.spec.verdict) \(.spec.rounds)"')"
assert_contains "GAP: the writer's prompt carries the question" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "What happens on EMPTY input?"
assert_contains "GAP: and the quoted spec text" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "the spec is silent"
assert_contains "GAP: and the rulings file" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "$SPACE/notes/decisions.md"
assert_contains "GAP: the dev gets what the spec now says" "$(cat "$(st t7)/fix-r2.prompt.md")" "EMPTY input is rejected with exit 2"
assert_contains "GAP: the spec check is told what was settled" "$(cat "$(st t7)/spec-r2.prompt.md")" "EMPTY input is rejected with exit 2"
assert_contains "GAP: the spec check diffs the configured spec paths" "$(cat "$(st t7)/spec-r1.prompt.md")" "docs/spec/**"
assert_eq "GAP: the writer was closed once it was WRITTEN" "t7-dev" "$(live_agents t7)"
assert_ok "GAP: the writer verdict validates" validate_verdict "$SCHEMAS_DIR/specwriter.json" "$(st t7)/specwriter-r1.json"

# --- 8: REMOVE (code) -----------------------------------------------------------------------------------------------------
reset_fake; unit t8 spec
script t8 develop.json "$DEV_DONE"
script t8 review-r1.json "$REV_OK"; script t8 review-r2.json "$REV_OK"
script t8 spec-r1.json "$SPEC_RM_CODE"; script t8 spec-r2.json "$SPEC_OK"
script t8 fix-r2.json "$DEV_DONE"
stub_start t8; run_loop t8; stub_stop
check_result t8 "REMOVE (code)" 0 READY
assert_eq "REMOVE code: no spec writer was needed" "0" "$(res t8 .specwriter.runs)"
assert_contains "REMOVE code: the dev is told to remove the element" "$(cat "$(st t8)/fix-r2.prompt.md")" "the --frobnicate flag"
assert_contains "REMOVE code: with the missing consumer" "$(cat "$(st t8)/fix-r2.prompt.md")" "the brief names no caller"
assert_eq "REMOVE code: the check re-ran and accepted" "ACCEPT 2" "$(res t8 '"\(.spec.verdict) \(.spec.rounds)"')"
assert_eq "REMOVE code: nobody started a spec writer" "0" "$(starts_of t8-specwriter-r1)"

# --- 9: REMOVE (spec) -----------------------------------------------------------------------------------------------------
reset_fake; unit t9 spec
script t9 develop.json "$DEV_DONE"
script t9 review-r1.json "$REV_OK"; script t9 review-r2.json "$REV_OK"
script t9 spec-r1.json "$SPEC_RM_SPEC"; script t9 spec-r2.json "$SPEC_OK"
script t9 specwriter-r1.json "$SW_OK"
script t9 fix-r2.json "$DEV_DONE"
stub_start t9; run_loop t9; stub_stop
check_result t9 "REMOVE (spec)" 0 READY
assert_eq "REMOVE spec: the spec writer ran" "1" "$(res t9 .specwriter.runs)"
assert_contains "REMOVE spec: the writer is told what to delete" "$(cat "$(st t9)/specwriter-r1.prompt.md")" "the frobnicate section"
assert_contains "REMOVE spec: with the missing consumer" "$(cat "$(st t9)/specwriter-r1.prompt.md")" "nothing consumes it"
assert_eq "REMOVE spec: the check re-ran and accepted" "ACCEPT 2" "$(res t9 '"\(.spec.verdict) \(.spec.rounds)"')"

# --- 10: spec writer asks the operator ---------------------------------------------------------------------------------------
reset_fake; unit t10 spec
script t10 develop.json "$DEV_DONE"
script t10 review-r1.json "$REV_OK"
script t10 spec-r1.json "$SPEC_GAP"
script t10 specwriter-r1.json '{"status":"OPERATOR","commits":[],"resolved":[],"operator_questions":[{"where":"docs/spec/a.md","question":"Pick A or B?","options":"A, B","recommendation":"A"}],"gate":""}'
stub_start t10; run_loop t10; stub_stop
check_result t10 "OPERATOR" 2 PARKED
assert_eq "OPERATOR: park.json status" "OPERATOR" "$(jq -r .status "$(st t10)/park.json")"
assert_contains "OPERATOR: the question and recommendation are in park.json" "$(jq -r .question "$(st t10)/park.json")" "Recommendation: A"
assert_eq "OPERATOR: the parked agent is the writer" "t10-specwriter-r1" "$(jq -r .agent "$(st t10)/park.json")"

# --- 11: malformed and schema-invalid verdicts -> ERROR ----------------------------------------------------------------------------
reset_fake; unit t11
script t11 develop.json 'this is not json'
stub_start t11; run_loop t11; stub_stop
check_result t11 "malformed JSON" 1 ERROR
assert_contains "malformed JSON: driver.err names the file" "$(cat "$(st t11)/driver.err")" "develop.json"
reset_fake; unit t11b
script t11b develop.json '{"status":"FINISHED","pr":7,"head":"x","summary":"s"}'
stub_start t11b; run_loop t11b; stub_stop
check_result t11b "schema-invalid verdict" 1 ERROR
assert_contains "schema-invalid: driver.err says which enum" "$(cat "$(st t11b)/driver.err")" "FINISHED"
reset_fake; unit t11c
script t11c develop.json "$DEV_DONE"
script t11c review-r1.json '{"verdict":"CHANGES","findings":[]}'
stub_start t11c; run_loop t11c; stub_stop
check_result t11c "CHANGES without findings" 1 ERROR
reset_fake; unit t11d
script t11d develop.json '{"status":"DONE","pr":null,"head":null,"summary":"no PR"}'
stub_start t11d; run_loop t11d; stub_stop
check_result t11d "DONE without a PR" 1 ERROR

# --- 12: restart in the middle of a review -----------------------------------------------------------------------------------------
reset_fake; unit t12
script t12 develop.json "$DEV_DONE"
stub_start t12
bash "$LOOP" --ref t12 --worktree "$SPACE/worktrees/t12" --branch feat-t12 --brief "$BRIEF" --class S >/dev/null 2>"$FIX/err-t12.log" &
DRV=$!
for _ in $(seq 200); do [[ -e "$(st t12)/review-r1.json.sent" ]] && break; sleep 0.05; done
assert_ok "restart: the driver reached the review" test -e "$(st t12)/review-r1.json.sent"
kill -9 "$DRV" 2>/dev/null; wait "$DRV" 2>/dev/null
assert_ok "restart: develop.json was already written" test -s "$(st t12)/develop.json"
script t12 review-r1.json "$REV_OK"
run_loop t12; stub_stop
check_result t12 "restart mid-review" 0 READY
assert_eq "restart: the dev was not started again" "1" "$(starts_of t12-dev)"
assert_eq "restart: the dev was prompted once" "1" "$(wc -l <"$(st t12)/develop.json.sent" | tr -d ' ')"
assert_eq "restart: the reviewer was reattached, not restarted" "1" "$(starts_of t12-review-r1)"
assert_eq "restart: the reviewer was prompted once" "1" "$(wc -l <"$(st t12)/review-r1.json.sent" | tr -d ' ')"

# --- 13: LIMIT (failover is a stub: the unit parks) ------------------------------------------------------------------------------------
reset_fake; unit t13
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf "You've hit your weekly limit. What do you want to do?\n" >"$SHIP_MUX_FAKE_DIR/read/t13-dev"
stub_start t13; run_loop t13; stub_stop
check_result t13 "LIMIT" 2 PARKED
assert_eq "LIMIT: park.json status" "LIMIT" "$(jq -r .status "$(st t13)/park.json")"
assert_contains "LIMIT: the matched text is reported" "$(jq -r .question "$(st t13)/park.json")" "hit your weekly limit"
assert_eq "LIMIT: the agent is left alone" "t13-dev" "$(live_agents t13)"

# --- 14: verify FAIL -> fix -> PASS ---------------------------------------------------------------------------------------------------------
reset_fake; unit t14
CFG_EXTRA="stages:
  verify:
    instructions: notes/verify.md"; write_cfg
script t14 develop.json "$DEV_DONE"
script t14 verify-r1.json '{"verdict":"FAIL","summary":"ran it","failures":[{"what":"exit code is 0 on bad input","evidence":"ran x --bad, echo $? printed 0"}]}'
script t14 verify-r2.json '{"verdict":"PASS","summary":"fine","failures":[]}'
script t14 fix-r2.json "$DEV_DONE"
script t14 review-r2.json "$REV_OK"
stub_start t14; run_loop t14; stub_stop
check_result t14 "verify FAIL then PASS" 0 READY
assert_contains "verify: the dev gets the failure evidence" "$(cat "$(st t14)/fix-r2.prompt.md")" "echo \$? printed 0"
assert_contains "verify: the verify prompt carries the project instructions" "$(cat "$(st t14)/verify-r1.prompt.md")" "verify by running it"
assert_eq "verify: round 1 is recorded as a verify failure" "VERIFY-FAIL" "$(res t14 '.rounds[0].verdict')"
assert_eq "verify: no review in round 1" "no" "$([[ -e "$(st t14)/review-r1.json" ]] && echo yes || echo no)"
CFG_EXTRA=''; write_cfg

# --- 15: final gate -------------------------------------------------------------------------------------------------------------------------
reset_fake; unit t15
script t15 develop.json "$DEV_DONE"
script t15 review-r1.json "$REV_OK"; script t15 review-r2.json "$REV_OK"
script t15 final-r1.json '{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"a.go","line":1,"summary":"the spec does not settle X","fix":"Stop with QUESTION: the spec does not settle X"}]}'
script t15 final-r2.json "$REV_OK"
script t15 fix-r2.json "$DEV_DONE"
stub_start t15; run_loop t15 --final-gate; stub_stop
check_result t15 "final gate" 0 READY
assert_eq "final: two rounds, ending in ACCEPT" "ACCEPT 2" "$(res t15 '"\(.final.verdict) \(.final.rounds)"')"
assert_contains "final: the finding reaches the dev verbatim" "$(cat "$(st t15)/fix-r2.prompt.md")" "Stop with QUESTION: the spec does not settle X"
assert_contains "final: round 2 final gate is told its earlier findings" "$(cat "$(st t15)/final-r2.prompt.md")" "the spec does not settle X"
assert_eq "final: a fresh final agent per round" "1 1" "$(starts_of t15-final-r1) $(starts_of t15-final-r2)"
# without --final-gate there is no final stage
assert_eq "final: not run without the flag (t1)" "NOT_RUN" "$(res t1 .final.verdict)"

# --- 16: finalize: rebase conflict goes back to the dev ---------------------------------------------------------------------------------
reset_fake; unit t16
W16="$SPACE/worktrees/t16"
echo "feature version" >"$W16/f.txt"; git -C "$W16" commit -qam "feat: touch f"; git -C "$W16" push -q origin feat-t16 2>/dev/null
git clone -q "$FIX/origin-t16.git" "$FIX/other-t16" 2>/dev/null
echo "main version" >"$FIX/other-t16/f.txt"; git -C "$FIX/other-t16" commit -qam "main: touch f"; git -C "$FIX/other-t16" push -q origin main 2>/dev/null
script t16 develop.json "$DEV_DONE"; script t16 review-r1.json "$REV_OK"; script t16 fix-r2.json "$DEV_DONE"
printf '#!/bin/sh\ngit -C "%s" rebase -X theirs origin/main >/dev/null 2>&1\ngit -C "%s" push -q --force-with-lease origin feat-t16 >/dev/null 2>&1\nexit 0\n' "$W16" "$W16" >"$FIX/scripts/t16/fix-r2.json.hook"
chmod +x "$FIX/scripts/t16/fix-r2.json.hook"
stub_start t16; run_loop t16; stub_stop
check_result t16 "rebase conflict" 0 READY
assert_contains "conflict: the dev is told the rebase failed" "$(cat "$(st t16)/fix-r2.prompt.md")" "rebasing onto origin/main failed"
assert_contains "conflict: and which file conflicts" "$(cat "$(st t16)/fix-r2.prompt.md")" "f.txt"
assert_eq "conflict: no rebase is left in progress" "no" "$([[ -d "$W16/.git" || -f "$W16/.git" ]] && git -C "$W16" status | grep -q 'rebase in progress' && echo yes || echo no)"
assert_eq "conflict: the pushed branch contains main" "0" "$(git -C "$FIX/origin-t16.git" rev-list --count refs/heads/feat-t16..refs/heads/main)"

# --- 17: finalize: a failing gate that the dev cannot fix -> STUCK ---------------------------------------------------------------------------
reset_fake; unit t17
GATE_CMD='echo "gate says no"; exit 1'; write_cfg
script t17 develop.json "$DEV_DONE"; script t17 review-r1.json "$REV_OK"
script t17 fix-r2.json "$DEV_DONE"; script t17 fix-r3.json "$DEV_DONE"
stub_start t17; run_loop t17; stub_stop
check_result t17 "failing gate" 2 STUCK
assert_eq "gate: the stage" "finalize" "$(res t17 .stage)"
assert_contains "gate: the dev saw the gate output" "$(cat "$(st t17)/fix-r2.prompt.md")" "gate says no"
assert_eq "gate: nothing was pushed past the dev's commit" "$(git -C "$SPACE/worktrees/t17" rev-parse HEAD)" "$(git -C "$FIX/origin-t17.git" rev-parse refs/heads/feat-t17)"
GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 18: finalize: forbidden pattern goes back to the dev ---------------------------------------------------------------------------------
reset_fake; unit t18
W18="$SPACE/worktrees/t18"
echo "see SECRETWORD here" >"$W18/leak.txt"; git -C "$W18" add -A; git -C "$W18" commit -qm "feat: leak"; git -C "$W18" push -q origin feat-t18 2>/dev/null
CFG_EXTRA="scan:
  forbidden: ['SECRETW[O]RD']"; write_cfg
script t18 develop.json "$DEV_DONE"; script t18 review-r1.json "$REV_OK"; script t18 fix-r2.json "$DEV_DONE"
printf '#!/bin/sh\necho clean >"%s/leak.txt"\ngit -C "%s" commit -qam "fix: reword"\ngit -C "%s" push -q origin feat-t18 >/dev/null 2>&1\nexit 0\n' "$W18" "$W18" "$W18" >"$FIX/scripts/t18/fix-r2.json.hook"
chmod +x "$FIX/scripts/t18/fix-r2.json.hook"
stub_start t18; run_loop t18; stub_stop
check_result t18 "forbidden pattern" 0 READY
assert_contains "scan: the dev is shown the offending line" "$(cat "$(st t18)/fix-r2.prompt.md")" "leak.txt: see SECRETWORD here"
assert_eq "scan: a later clean run was pushed" "$(git -C "$W18" rev-parse HEAD)" "$(git -C "$FIX/origin-t18.git" rev-parse refs/heads/feat-t18)"
# an excluded file is not scanned
reset_fake; unit t18b
W18B="$SPACE/worktrees/t18b"
echo "see SECRETWORD here" >"$W18B/leak.txt"; git -C "$W18B" add -A; git -C "$W18B" commit -qm "feat: leak"; git -C "$W18B" push -q origin feat-t18b 2>/dev/null
CFG_EXTRA="scan:
  forbidden: ['SECRETW[O]RD']
  exclude: ['leak.*']"; write_cfg
script t18b develop.json "$DEV_DONE"; script t18b review-r1.json "$REV_OK"
stub_start t18b; run_loop t18b; stub_stop
check_result t18b "excluded file is not scanned" 0 READY
CFG_EXTRA=''; write_cfg

# --- 19: --model overrides ---------------------------------------------------------------------------------------------------------------------
reset_fake; unit t19
script t19 develop.json "$DEV_DONE"; script t19 review-r1.json "$REV_OK"
stub_start t19; run_loop t19 --model dev=zz-dev --model review=zz-review,other; stub_stop
check_result t19 "--model" 0 READY
assert_contains "--model: the dev runs the override" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t19-dev)" '"zz-dev"'
assert_contains "--model: the reviewer runs the first of its list" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t19-review)" '"zz-review"'
reset_fake; unit t19b
printf 'dev=from-file\n' >"$(mkdir -p "$(st t19b)" && st t19b)/models.override"
script t19b develop.json "$DEV_DONE"; script t19b review-r1.json "$REV_OK"
stub_start t19b; run_loop t19b; stub_stop
check_result t19b "models.override" 0 READY
assert_contains "models.override: applied from the state directory" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t19b-dev)" '"from-file"'
unit t19c
run_loop t19c --model nonsense=x
assert_eq "--model with an unknown stage is an error" "1" "$RC"

# --- 20: usage, config and preflight ------------------------------------------------------------------------------------------------------------
run_loop t1 --bogus; assert_eq "usage: an unknown argument exits 1" "1" "$RC"
OUT="$(bash "$LOOP" --worktree "$SPACE/worktrees/t1" --branch b --brief "$BRIEF" --class S 2>&1)"; RC=$?
assert_eq "usage: --ref is required" "1" "$RC"
assert_contains "usage: and named" "$OUT" "--ref is required"
OUT="$(bash "$LOOP" --ref x --worktree "$SPACE/worktrees/t1" --branch b --brief "$BRIEF" --class XL 2>&1)"; RC=$?
assert_eq "usage: a bad class exits 1" "1" "$RC"
reset_fake; unit t20
cp "$PROJECT" "$FIX/ship.yml.bak"; grep -v '^gate:' "$FIX/ship.yml.bak" >"$PROJECT"
run_loop t20
check_result t20 "a config without gate" 1 ERROR
assert_contains "gate: the error names the key" "$(cat "$(st t20)/driver.err")" "gate"
cp "$FIX/ship.yml.bak" "$PROJECT"

OUT="$(bash "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: ok with the toolchain present" "0" "$RC"
assert_contains "preflight: says so" "$OUT" "preflight: ok"
mkdir -p "$SHIP_MUX_FAKE_DIR"; echo "no multiplexer here" >"$SHIP_MUX_FAKE_DIR/check-fail"
OUT="$(bash "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: a failing ship-mux check fails it" "1" "$RC"
assert_contains "preflight: and the reason is shown" "$OUT" "no multiplexer here"
rm -f "$SHIP_MUX_FAKE_DIR/check-fail"
mkdir -p "$FIX/nopi"
for c in git jq yq bash env dirname cat sed tr cut date mkdir tee mktemp rm cp mv ls grep awk wc head tail sort uniq basename realpath readlink touch chmod ln sleep stat uname id; do command -v "$c" >/dev/null 2>&1 || continue; ln -sf "$(command -v "$c")" "$FIX/nopi/$c"; done
ln -sf "$FIX/bin/claude" "$FIX/nopi/claude"; ln -sf "$FIX/bin/gh" "$FIX/nopi/gh"
OUT="$(PATH="$FIX/nopi" "$(command -v bash)" "$LOOP" --preflight --model dev=prov/model:high 2>&1)"; RC=$?
assert_eq "preflight: a pi model without pi on PATH fails it" "1" "$RC"
assert_contains "preflight: and names pi" "$OUT" "pi not found"
OUT="$(env -u SHIP_SPACE_ROOT PATH="$FIX/nopi" "$(command -v bash)" "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: hyper missing and SHIP_SPACE_ROOT unset fails it" "1" "$RC"
assert_contains "preflight: and names hyper" "$OUT" "hyper not found"
cp "$PROJECT" "$FIX/ship.yml.bak"; grep -v '^gate:' "$FIX/ship.yml.bak" >"$PROJECT"
OUT="$(bash "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: a missing gate fails it" "1" "$RC"
cp "$FIX/ship.yml.bak" "$PROJECT"

# --- 21: the script's own constraints --------------------------------------------------------------------------------------------------------------
assert_eq "C-1: no husk, forge, user path, host or model literal in ship-loop" "" "$(grep -niE 'husk|forge|/work/lab|/Users/|Users/|gopls|dolphin|sonnet|opus|haiku|fable' "$LOOP")"
assert_eq "C-2: no messaging, Monitor or watchdog in ship-loop" "" "$(grep -nE 'SendMessage|claude-link|hyper msg|Monitor|stall' "$LOOP")"
assert_eq "C-11: ship-loop does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$LOOP")"
assert_eq "AC-6: the plain spec grep is empty too" "" "$(grep -iE 'husk|forge|/work/lab|Users/' "$LOOP")"
assert_ok "bash -n passes" bash -n "$LOOP"
assert_ok "the stub agent passes bash -n" bash -n "$STUB"

stub_stop
finish
