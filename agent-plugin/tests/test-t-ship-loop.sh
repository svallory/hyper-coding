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
# The driver clears the .sent markers of a restarted stage itself; do it before the stub starts, or the
# stub answers the old marker.
clear_sent() { rm -f "$(st "$1")/$2.sent"; } # ref verdict-file
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
    tail -n 25 "$(st "$1")/loop.log" 2>/dev/null | sed 's/^/# loop.log: /' >&2
    (cd "$(st "$1")" && for f in *.sent; do [ -e "$f" ] && echo "# $f: $(wc -l <"$f" | tr -d ' ') line(s)"; done; ls -l --time-style=full-iso . 2>/dev/null | sed 's/^/# ls: /') >&2
    for f in "$FIX/scripts/$1/.done"/*; do [ -e "$f" ] && echo "# stub done $(basename "$f")=$(cat "$f")" >&2; done
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
# a resume with no answer closes the agent and restarts the stage with a new one
rm -f "$FIX/scripts/t3"/develop.json* ; rm -rf "$FIX/scripts/t3/.done"
script t3 develop.json "$DEV_DONE"; script t3 review-r1.json "$REV_OK"
clear_sent t3 develop.json; stub_start t3; run_loop t3; stub_stop
check_result t3 "BLOCKED, resumed without an answer" 0 READY
assert_eq "BLOCKED: the parked dev was closed and a new one started" "2" "$(starts_of t3-dev)"
assert_eq "BLOCKED: the resolved park is archived" "yes" "$([[ -e "$(st t3)/park-1.json" ]] || ls "$(st t3)"/run-*/park-1.json >/dev/null 2>&1 && echo yes || echo no)"
# a resume with an answer delivers it to the live agent
reset_fake; unit t3b
script t3b develop.json.1 '{"status":"BLOCKED","pr":null,"head":null,"summary":"cannot build","question":"which toolchain?"}'
script t3b develop.json.2 "$DEV_DONE"; script t3b review-r1.json "$REV_OK"
stub_start t3b; run_loop t3b
check_result t3b "BLOCKED (answer case)" 2 PARKED
printf 'Use the system toolchain.\n' >"$(st t3b)/answer-1.md"
run_loop t3b; stub_stop
check_result t3b "BLOCKED, resumed with an answer" 0 READY
assert_contains "BLOCKED: the answer went to the live dev" "$(sent_to t3b t3b-dev)" "Use the system toolchain."
assert_eq "BLOCKED: and the dev was not restarted" "1" "$(starts_of t3b-dev)"

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
# resume: the parked agent is closed and the stage restarts through model_pick, so the override applies
printf 'dev=zz-after-limit\n' >"$(st t13)/models.override"
rm -f "$SHIP_MUX_FAKE_DIR/read/t13-dev"; rm -rf "$FIX/scripts/t13/.done"
script t13 develop.json "$DEV_DONE"; script t13 review-r1.json "$REV_OK"
clear_sent t13 develop.json; stub_start t13; run_loop t13; stub_stop
check_result t13 "LIMIT, resumed with a models.override" 0 READY
assert_eq "LIMIT: the limited dev was closed and a new one started" "2" "$(starts_of t13-dev)"
assert_contains "LIMIT: the new dev runs the override model" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | tail -n 1)" '"zz-after-limit"'
assert_contains "LIMIT: and the first one did not" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | head -n 1)" '--model'
assert_not_contains "LIMIT: the first dev was not on the override" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | head -n 1)" 'zz-after-limit'

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
script t16 develop.json "$DEV_DONE"; script t16 review-r1.json "$REV_OK"; script t16 fix-r2.json "$DEV_DONE"; script t16 review-r2.json "$REV_OK"
printf '#!/bin/sh\ngit -C "%s" rebase -X theirs origin/main >/dev/null 2>&1\ngit -C "%s" push -q --force-with-lease origin feat-t16 >/dev/null 2>&1\nexit 0\n' "$W16" "$W16" >"$FIX/scripts/t16/fix-r2.json.hook"
chmod +x "$FIX/scripts/t16/fix-r2.json.hook"
stub_start t16; run_loop t16; stub_stop
check_result t16 "rebase conflict" 0 READY
assert_contains "conflict: the dev is told the rebase failed" "$(cat "$(st t16)/fix-r2.prompt.md")" "rebasing onto origin/main failed"
assert_contains "conflict: and which file conflicts" "$(cat "$(st t16)/fix-r2.prompt.md")" "f.txt"
assert_eq "conflict: no rebase is left in progress" "no" "$([[ -d "$W16/.git" || -f "$W16/.git" ]] && git -C "$W16" status | grep -q 'rebase in progress' && echo yes || echo no)"
assert_eq "conflict: the dev's resolution was reviewed (fresh reviewer, round 2)" "1" "$(starts_of t16-review-r2)"
assert_eq "conflict: and the review came before the driver's push" "yes" "$([[ "$(grep -n 'round 2 review ACCEPT' "$(st t16)/loop.log" | head -n 1 | cut -d: -f1)" -lt "$(grep -n 'finalized at' "$(st t16)/loop.log" | cut -d: -f1)" ]] && echo yes || echo no)"
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
assert_eq "gate: a fix that changed nothing needs no review" "0" "$(starts_of t17-review-r2)"
assert_eq "gate: nothing was pushed past the dev's commit" "$(git -C "$SPACE/worktrees/t17" rev-parse HEAD)" "$(git -C "$FIX/origin-t17.git" rev-parse refs/heads/feat-t17)"
GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 18: finalize: forbidden pattern goes back to the dev ---------------------------------------------------------------------------------
reset_fake; unit t18
W18="$SPACE/worktrees/t18"
echo "see SECRETWORD here" >"$W18/leak.txt"; git -C "$W18" add -A; git -C "$W18" commit -qm "feat: leak"; git -C "$W18" push -q origin feat-t18 2>/dev/null
CFG_EXTRA="scan:
  forbidden: ['SECRETW[O]RD']"; write_cfg
script t18 develop.json "$DEV_DONE"; script t18 review-r1.json "$REV_OK"; script t18 fix-r2.json "$DEV_DONE"; script t18 review-r2.json "$REV_OK"
printf '#!/bin/sh\necho clean >"%s/leak.txt"\ngit -C "%s" commit -qam "fix: reword"\ngit -C "%s" push -q origin feat-t18 >/dev/null 2>&1\nexit 0\n' "$W18" "$W18" "$W18" >"$FIX/scripts/t18/fix-r2.json.hook"
chmod +x "$FIX/scripts/t18/fix-r2.json.hook"
stub_start t18; run_loop t18; stub_stop
check_result t18 "forbidden pattern" 0 READY
assert_contains "scan: the dev is shown the offending line" "$(cat "$(st t18)/fix-r2.prompt.md")" "leak.txt: see SECRETWORD here"
assert_eq "scan: the rewording was reviewed before the push" "1" "$(starts_of t18-review-r2)"
assert_contains "scan: and the reviewer is told what the dev was fixing" "$(cat "$(st t18)/review-r2.prompt.md")" "added lines match scan.forbidden"
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
assert_eq "preflight: says so, and only that" "preflight: ok" "$OUT"
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
assert_contains "preflight: and names pi, the way it is needed" "$OUT" "preflight: pi not found on PATH (needed by model prov/model:high)"
assert_not_contains "preflight: no shell fragment leaks into the message" "$OUT" "echo"
OUT="$(env -u SHIP_SPACE_ROOT PATH="$FIX/nopi" "$(command -v bash)" "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: hyper missing and SHIP_SPACE_ROOT unset fails it" "1" "$RC"
assert_contains "preflight: and names hyper" "$OUT" "hyper not found"
cp "$PROJECT" "$FIX/ship.yml.bak"; grep -v '^gate:' "$FIX/ship.yml.bak" >"$PROJECT"
OUT="$(bash "$LOOP" --preflight 2>&1)"; RC=$?
assert_eq "preflight: a missing gate fails it" "1" "$RC"
cp "$FIX/ship.yml.bak" "$PROJECT"


# --- 22: the first prompt never starts a turn: no .sent marker, the unit parks BLOCKED -----------------------------------------
reset_fake; unit t22
mkdir -p "$SHIP_MUX_FAKE_DIR/status"; printf 'idle\n' >"$SHIP_MUX_FAKE_DIR/status/t22-dev"
script t22 develop.json "$DEV_DONE"
stub_start t22; run_loop t22; stub_stop
check_result t22 "a prompt that never starts" 2 PARKED
assert_eq "send: park.json status" "BLOCKED" "$(jq -r .status "$(st t22)/park.json")"
assert_eq "send: a prompt that was not delivered leaves no .sent marker" "no" "$([[ -e "$(st t22)/develop.json.sent" ]] && echo yes || echo no)"

# (the seeded .sent markers are empty: a running stub must not take them for a prompt to answer)
# --- 23: a stale verdict (older than the last prompt) is not reused; a gone dev after develop is taken over ----------------------
seed_unit() { # ref — develop.json DONE and an old review CHANGES in the state dir, no agents
  mkdir -p "$(st "$1")"
  printf '%s\n' "$DEV_DONE" >"$(st "$1")/develop.json"; : >"$(st "$1")/develop.json.sent"
  printf '%s\n' "$REV_CHANGES" >"$(st "$1")/review-r1.json"; : >"$(st "$1")/review-r1.json.sent"
  touch -t 202001010000 "$(st "$1")/develop.json" "$(st "$1")/develop.json.sent" "$(st "$1")/review-r1.json" "$(st "$1")/review-r1.json.sent"
}
reset_fake; unit t23
seed_unit t23
touch -t 202002020000 "$(st t23)/review-r1.json.sent"   # prompted again after the verdict was written
script t23 review-r1.json "$REV_OK"
stub_start t23; run_loop t23; stub_stop
check_result t23 "stale verdict (.sent newer)" 0 READY
assert_eq "stale: the old CHANGES verdict was not reused" "ACCEPT" "$(res t23 '.rounds[0].verdict')"
assert_eq "stale: so no fix round happened" "no" "$([[ -e "$(st t23)/fix-r2.json" ]] && echo yes || echo no)"
assert_eq "stale: a reviewer was started to answer the new prompt" "1" "$(starts_of t23-review-r1)"
assert_eq "takeover: a gone dev after a finished develop is replaced, nothing archived" "0" "$(ls -d "$(st t23)"/run-* 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "takeover: develop.json is kept" "DONE" "$(jq -r .status "$(st t23)/develop.json")"
assert_eq "takeover: one new dev" "1" "$(starts_of t23-dev)"
reset_fake; unit t23b
seed_unit t23b
script t23b fix-r2.json "$DEV_DONE"; script t23b review-r2.json "$REV_OK"
stub_start t23b; run_loop t23b; stub_stop
check_result t23b "takeover" 0 READY
assert_contains "takeover: the new dev is told it takes over" "$(cat "$(st t23b)/fix-r2.prompt.md")" "You are taking over unit t23b"
assert_contains "takeover: and gets the findings after the takeover text" "$(cat "$(st t23b)/fix-r2.prompt.md")" "Fix: change it"
assert_eq "takeover: the earlier results are still there" "DONE REQ" "$(jq -r .status "$(st t23b)/develop.json") $([[ -e "$(st t23b)/review-r1.json" ]] && echo REQ)"

# --- 24: an answer from an earlier run is never delivered to a new run's question ------------------------------------------------
reset_fake; unit t24
script t24 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Q1?"}'
stub_start t24; run_loop t24; stub_stop
check_result t24 "stale answer: first question" 2 PARKED
printf 'OLD ANSWER\n' >"$(st t24)/answer-1.md"
_id="$(agent_of t24 t24-dev)"; (cd "$SPACE" && bash "$SCRIPTS_DIR/ship/ship-mux" close --ref t24 --id "$_id" >/dev/null 2>&1)
rm -rf "$FIX/scripts/t24"; mkdir -p "$FIX/scripts/t24"
script t24 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"NEW Q?"}'
script t24 develop.json.2 "$DEV_DONE"; script t24 review-r1.json "$REV_OK"
clear_sent t24 develop.json; stub_start t24; run_loop t24
check_result t24 "stale answer: the new run's question" 2 PARKED
assert_eq "stale answer: the new park is for the new question" "NEW Q?" "$(jq -r .question "$(st t24)/park.json")"
assert_eq "stale answer: the old answer was archived with the old run" "no" "$([[ -e "$(st t24)/answer-1.md" ]] && echo yes || echo no)"
run_loop t24
check_result t24 "stale answer: a plain resume stays parked" 2 PARKED
assert_not_contains "stale answer: OLD ANSWER was never sent to the new dev" "$(sent_to t24 t24-dev)" "OLD ANSWER"
printf 'NEW ANSWER\n' >"$(st t24)/answer-1.md"
run_loop t24; stub_stop
check_result t24 "stale answer: resumed with the new answer" 0 READY
assert_contains "stale answer: the new answer was delivered" "$(sent_to t24 t24-dev)" "NEW ANSWER"

# --- 25: verify BLOCKED parks with the verifier kept alive --------------------------------------------------------------------------------
reset_fake; unit t25
CFG_EXTRA="stages:
  verify:
    instructions: notes/verify.md"; write_cfg
script t25 develop.json "$DEV_DONE"
script t25 verify-r1.json.1 '{"verdict":"BLOCKED","summary":"could not start the binary","failures":[]}'
script t25 verify-r1.json.2 '{"verdict":"PASS","summary":"fine","failures":[]}'
script t25 review-r1.json "$REV_OK"
stub_start t25; run_loop t25
check_result t25 "verify BLOCKED" 2 PARKED
assert_eq "verify BLOCKED: park status" "BLOCKED" "$(jq -r .status "$(st t25)/park.json")"
assert_eq "verify BLOCKED: the stage" "verify" "$(res t25 .stage)"
assert_eq "verify BLOCKED: parked on the verifier" "t25-verify-r1" "$(jq -r .agent "$(st t25)/park.json")"
assert_contains "verify BLOCKED: with its summary" "$(jq -r .question "$(st t25)/park.json")" "could not start the binary"
assert_eq "verify BLOCKED: the verifier stays alive" "t25-dev t25-verify-r1" "$(live_agents t25)"
assert_eq "verify BLOCKED: no review happened" "0" "$(starts_of t25-review-r1)"
printf 'The binary is at ./bin/x.\n' >"$(st t25)/answer-1.md"
run_loop t25; stub_stop
check_result t25 "verify BLOCKED, answered" 0 READY
assert_contains "verify BLOCKED: the answer reached the verifier" "$(sent_to t25 t25-verify-r1)" "The binary is at ./bin/x."
assert_eq "verify BLOCKED: the verifier was not restarted" "1" "$(starts_of t25-verify-r1)"
assert_eq "verify BLOCKED: and is closed once it passed" "t25-dev" "$(live_agents t25)"
# resume without an answer: the verifier is closed and the stage restarts with a new one
reset_fake; unit t25b
script t25b develop.json "$DEV_DONE"
script t25b verify-r1.json '{"verdict":"BLOCKED","summary":"could not start the binary","failures":[]}'
script t25b review-r1.json "$REV_OK"
stub_start t25b; run_loop t25b; stub_stop
check_result t25b "verify BLOCKED (no answer case)" 2 PARKED
rm -f "$FIX/scripts/t25b/verify-r1.json"; rm -rf "$FIX/scripts/t25b/.done"
script t25b verify-r1.json '{"verdict":"PASS","summary":"fine","failures":[]}'
clear_sent t25b verify-r1.json; stub_start t25b; run_loop t25b; stub_stop
check_result t25b "verify BLOCKED, resumed without an answer" 0 READY
assert_eq "verify BLOCKED: a new verifier ran the stage again" "2" "$(starts_of t25b-verify-r1)"
CFG_EXTRA=''; write_cfg

# --- 26: the post-fix review can send the dev back -------------------------------------------------------------------------------------------
reset_fake; unit t26
W26="$SPACE/worktrees/t26"
echo "see SECRETWORD here" >"$W26/leak.txt"; git -C "$W26" add -A; git -C "$W26" commit -qm "feat: leak"; git -C "$W26" push -q origin feat-t26 2>/dev/null
CFG_EXTRA="scan:
  forbidden: ['SECRETW[O]RD']"; write_cfg
script t26 develop.json "$DEV_DONE"; script t26 review-r1.json "$REV_OK"
script t26 fix-r2.json "$DEV_DONE"; script t26 fix-r3.json "$DEV_DONE"
script t26 review-r2.json '{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"leak.txt","line":1,"summary":"REWORD-IS-WRONG","fix":"do it properly"}]}'
script t26 review-r3.json "$REV_OK"
printf '#!/bin/sh\necho clean >"%s/leak.txt"\ngit -C "%s" commit -qam "fix: reword"\nexit 0\n' "$W26" "$W26" >"$FIX/scripts/t26/fix-r2.json.hook"
printf '#!/bin/sh\necho cleaner >"%s/leak.txt"\ngit -C "%s" commit -qam "fix: reword again"\nexit 0\n' "$W26" "$W26" >"$FIX/scripts/t26/fix-r3.json.hook"
chmod +x "$FIX/scripts/t26"/*.hook
stub_start t26; run_loop t26; stub_stop
check_result t26 "post-fix review asks for changes" 0 READY
assert_contains "post-fix: the dev gets the reviewer's finding" "$(cat "$(st t26)/fix-r3.prompt.md")" "REWORD-IS-WRONG"
assert_eq "post-fix: the second fix is reviewed again" "1" "$(starts_of t26-review-r3)"
assert_eq "post-fix: what was pushed is what was last reviewed" "$(git -C "$W26" rev-parse HEAD)" "$(git -C "$FIX/origin-t26.git" rev-parse refs/heads/feat-t26)"
CFG_EXTRA=''; write_cfg

# --- 27: the brief's "Spec: required" turns the spec check on without spec hunks ----------------------------------------------------------------
reset_fake; unit t27
printf '# Brief\n\nSpec: required\n' >"$FIX/brief-spec.md"
script t27 develop.json "$DEV_DONE"; script t27 review-r1.json "$REV_OK"; script t27 spec-r1.json "$SPEC_OK"
_B="$BRIEF"; BRIEF="$FIX/brief-spec.md"
stub_start t27; run_loop t27; stub_stop
BRIEF="$_B"
check_result t27 "Spec: required" 0 READY
assert_eq "Spec: required: the spec check ran" "ACCEPT 1" "$(res t27 '"\(.spec.verdict) \(.spec.rounds)"')"
assert_eq "Spec: required: with its own agent" "1" "$(starts_of t27-spec-r1)"

# --- 28: spec_pending is cleared once the spec check accepts ----------------------------------------------------------------------------------------
reset_fake; unit t28 spec
script t28 develop.json "$DEV_DONE"
script t28 review-r1.json "$REV_OK"; script t28 review-r2.json "$REV_OK"; script t28 review-r3.json "$REV_OK"
script t28 spec-r1.json '{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"docs/spec/a.md","line":1,"summary":"SPECFIND-ZED","fix":"fix it"}],"gaps":[],"removals":[],"commits":[],"gate":"green"}'
script t28 spec-r2.json "$SPEC_OK"; script t28 spec-r3.json "$SPEC_OK"
script t28 final-r2.json "$REV_CHANGES"; script t28 final-r3.json "$REV_OK"
script t28 fix-r2.json "$DEV_DONE"; script t28 fix-r3.json "$DEV_DONE"
stub_start t28; run_loop t28 --final-gate; stub_stop
check_result t28 "spec_pending reset" 0 READY
assert_contains "spec_pending: round 2 is told the earlier spec findings" "$(cat "$(st t28)/spec-r2.prompt.md")" "SPECFIND-ZED"
assert_not_contains "spec_pending: round 3, after an ACCEPT, is not" "$(cat "$(st t28)/spec-r3.prompt.md")" "SPECFIND-ZED"

# --- 29: a spec writer that is WRITTEN with nothing resolved -> ERROR ----------------------------------------------------------------------------------
reset_fake; unit t29 spec
script t29 develop.json "$DEV_DONE"; script t29 review-r1.json "$REV_OK"; script t29 spec-r1.json "$SPEC_GAP"
script t29 specwriter-r1.json '{"status":"WRITTEN","commits":[],"resolved":[],"operator_questions":[],"gate":"green"}'
stub_start t29; run_loop t29; stub_stop
check_result t29 "WRITTEN with nothing resolved" 1 ERROR
assert_contains "WRITTEN: driver.err says so" "$(cat "$(st t29)/driver.err")" "nothing resolved"

# --- 30: the budget clock survives restarts and does not run while parked -----------------------------------------------------------------------------
BUD_S=0.1; write_cfg   # 6 seconds
reset_fake; unit t30
mkdir -p "$SHIP_MUX_FAKE_DIR/status"; printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t30-dev"
stub_start t30; run_loop t30
check_result t30 "parked on a dialog" 2 PARKED
sleep 7   # longer than the whole budget, but the unit was parked
printf 'idle\n' >"$SHIP_MUX_FAKE_DIR/status/t30-dev"
script t30 develop.json "$DEV_DONE"; script t30 review-r1.json "$REV_OK"
run_loop t30; stub_stop
check_result t30 "resumed after more than the budget in wall time" 0 READY
reset_fake; unit t31
mkdir -p "$SHIP_MUX_FAKE_DIR/status"; printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t31-dev"
stub_start t31; run_loop t31; stub_stop
check_result t31 "parked on a dialog (carry case)" 2 PARKED
printf '6\n' >"$(st t31)/develop.json.clock"   # 6 of the 6 seconds are used
printf 'working\n' >"$SHIP_MUX_FAKE_DIR/status/t31-dev"
SECONDS=0; run_loop t31; _took=$SECONDS
check_result t31 "the used time is carried over a restart" 2 OVER-BUDGET
assert_ok "carried clock: over budget well before a clock restarted at zero could be (that needs more than 6 s plus startup; took $_took)" test "$_took" -lt 7
BUD_S=10; write_cfg

# --- 31: a pi model is launched with pi's flags ------------------------------------------------------------------------------------------------------------
reset_fake; unit t32
CFG_EXTRA="roles:
  dev:
    pi_skills: []
    pi_extensions: []"; write_cfg
script t32 develop.json "$DEV_DONE"; script t32 review-r1.json "$REV_OK"
stub_start t32; run_loop t32 --model dev=prov/model:high; stub_stop
check_result t32 "pi dev" 0 READY
CFG_EXTRA=''; write_cfg
_PI="$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t32-dev | head -n 1)"
assert_contains "pi: the harness is pi" "$_PI" '"pi"'
assert_contains "pi: --model carries the full model" "$_PI" 'prov/model:high'
assert_contains "pi: --approve" "$_PI" '"--approve"'
assert_contains "pi: --session-dir" "$_PI" '"--session-dir"'
assert_contains "pi: the session dir is in the state dir" "$_PI" "$(st t32)/pi-sessions"
assert_contains "pi: the ship-role flags for pi" "$_PI" '"--no-mcp"'
assert_not_contains "pi: no claude session id" "$_PI" '--session-id'
assert_not_contains "pi: no claude permission mode" "$_PI" '--permission-mode'
assert_eq "pi: agents/<name>.json records the harness" "pi" "$(jq -r .harness "$(st t32)/agents/t32-dev.json")"

# --- 32: every gap an operator call: park without a writer; mixed gaps: the writer ------------------------------------------------------------------
reset_fake; unit t33 spec
script t33 develop.json "$DEV_DONE"
script t33 review-r1.json "$REV_OK"; script t33 review-r2.json "$REV_OK"
script t33 spec-r1.json '{"verdict":"GAP","findings":[],"gaps":[{"where":"docs/spec/a.md:3","quotes":["silent"],"question":"A or B?","operator_call":true}],"removals":[],"commits":[],"gate":"green"}'
script t33 spec-r2.json "$SPEC_OK"; script t33 specwriter-r1.json "$SW_OK"; script t33 fix-r2.json "$DEV_DONE"
stub_start t33; run_loop t33
check_result t33 "all gaps operator calls" 2 PARKED
assert_eq "operator: park status" "OPERATOR" "$(jq -r .status "$(st t33)/park.json")"
assert_contains "operator: the gap is the question" "$(jq -r .question "$(st t33)/park.json")" "A or B?"
assert_eq "operator: no writer was started" "0" "$(starts_of t33-specwriter-r1)"
run_loop t33
check_result t33 "all gaps operator calls, resumed without an answer" 2 PARKED
assert_eq "operator: still no writer" "0" "$(starts_of t33-specwriter-r1)"
printf 'Pick B.\n' >"$(st t33)/answer-1.md"
run_loop t33; stub_stop
check_result t33 "all gaps operator calls, answered" 0 READY
assert_eq "operator: the writer ran once" "1" "$(starts_of t33-specwriter-r1)"
assert_contains "operator: and got the operator's answer" "$(cat "$(st t33)/specwriter-r1.prompt.md")" "Pick B."
reset_fake; unit t33b spec
script t33b develop.json "$DEV_DONE"
script t33b review-r1.json "$REV_OK"; script t33b review-r2.json "$REV_OK"
script t33b spec-r1.json '{"verdict":"GAP","findings":[],"gaps":[{"where":"a","quotes":["x"],"question":"A or B?","operator_call":true},{"where":"b","quotes":["y"],"question":"EMPTY?","operator_call":false}],"removals":[],"commits":[],"gate":"green"}'
script t33b spec-r2.json "$SPEC_OK"; script t33b specwriter-r1.json "$SW_OK"; script t33b fix-r2.json "$DEV_DONE"
stub_start t33b; run_loop t33b; stub_stop
check_result t33b "mixed gaps" 0 READY
assert_eq "mixed gaps: the writer ran" "1" "$(starts_of t33b-specwriter-r1)"
assert_contains "mixed gaps: and was told to return the operator ones" "$(cat "$(st t33b)/specwriter-r1.prompt.md")" "wait on the operator"


# --- 33: unit files survive an archive; a verdict one second older than its marker is still fresh ------------------------------------
reset_fake; unit t34
mkdir -p "$(st t34)"
for _f in unit.json driver.exit config.json; do echo "keep $_f" >"$(st t34)/$_f"; done
echo "review=kept-model" >"$(st t34)/models.override"
echo stale >"$(st t34)/stale.json"
script t34 develop.json "$DEV_DONE"; script t34 review-r1.json "$REV_OK"
stub_start t34; run_loop t34; stub_stop
check_result t34 "archive keeps the unit files" 0 READY
for _f in unit.json driver.exit config.json; do
  assert_eq "archive: $_f stays in place" "keep $_f" "$(cat "$(st t34)/$_f" 2>/dev/null)"
done
assert_eq "archive: models.override stays in place" "review=kept-model" "$(cat "$(st t34)/models.override" 2>/dev/null)"
assert_eq "archive: another file is moved into run-*" "yes" "$(ls "$(st t34)"/run-*/stale.json >/dev/null 2>&1 && echo yes || echo no)"
reset_fake; unit t35
seed_unit t35
touch -t 202001010000.00 "$(st t35)/review-r1.json"; touch -t 202001010000.01 "$(st t35)/review-r1.json.sent"
script t35 fix-r2.json "$DEV_DONE"; script t35 review-r2.json "$REV_OK"
stub_start t35; run_loop t35; stub_stop
check_result t35 "a marker one second newer" 0 READY
assert_eq "fresh: the verdict was reused, its reviewer never started" "0" "$(starts_of t35-review-r1)"
assert_eq "fresh: so the CHANGES verdict led to a fix round" "CHANGES" "$(res t35 '.rounds[0].verdict')"


# --- 34: a verdict written while the driver is still looking things up is picked up, not prompted over --------------------------------------
# The stub answers 0.3 s after it sees a prompt marker, and `list` takes 0.4 s: the verdict lands between the
# driver's "is it there yet" check and its look at the agent. The driver used to delete it and prompt again.
reset_fake; unit t36
script t36 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Q?"}'
script t36 develop.json.2 "$DEV_DONE"; script t36 review-r1.json "$REV_OK"
export SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/slowmux" SLOWMUX_REAL="$SCRIPTS_DIR/ship/ship-mux"
BUD_S=0.5; write_cfg
STUB_DELAY=0.3 stub_start t36; run_loop t36
check_result t36 "slow lookup: question" 2 PARKED
printf 'Yes.\n' >"$(st t36)/answer-1.md"
run_loop t36; stub_stop
check_result t36 "slow lookup: answered" 0 READY
assert_eq "slow lookup: develop was prompted twice, not three times" "2" "$(wc -l <"$(st t36)/develop.json.sent" | tr -d ' ')"
unset SHIP_LOOP_MUX SLOWMUX_REAL; BUD_S=10; write_cfg

# --- 21: the script's own constraints --------------------------------------------------------------------------------------------------------------
assert_eq "C-1: no husk, forge, user path, host or model literal in ship-loop" "" "$(grep -niE 'husk|forge|/work/lab|/Users/|Users/|gopls|dolphin|sonnet|opus|haiku|fable' "$LOOP")"
assert_eq "C-2: no messaging, Monitor or watchdog in ship-loop" "" "$(grep -nE 'SendMessage|claude-link|hyper msg|Monitor|stall' "$LOOP")"
assert_eq "C-11: ship-loop does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$LOOP")"
assert_eq "AC-6: the plain spec grep is empty too" "" "$(grep -iE 'husk|forge|/work/lab|Users/' "$LOOP")"
assert_ok "bash -n passes" bash -n "$LOOP"
assert_ok "the stub agent passes bash -n" bash -n "$STUB"

stub_stop
finish
