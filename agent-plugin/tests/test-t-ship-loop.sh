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

GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"' MAXR=3 BUD_S=10 BUD_EXTRA='' CFG_EXTRA=''
write_cfg() {
  cat >"$PROJECT" <<EOF
mux: fake
gate: '$GATE_CMD'
max_rounds: $MAXR
budgets:
  S: $BUD_S
$BUD_EXTRA
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
# Every driver run is bounded (RUN_LIMIT_S, default 180): a stage that never gets its answer fails the test
# with a message instead of hanging the suite. On expiry the driver and its children are killed, RC is 124.
RUN_LIMIT_S="${RUN_LIMIT_S:-180}"
run_loop() { # ref [args...]
  local ref="$1" pid wd; shift
  bash "$LOOP" --ref "$ref" --worktree "$SPACE/worktrees/$ref" --branch "feat-$ref" --brief "$BRIEF" --class S "$@" >"$FIX/out-$ref.json" 2>"$FIX/err-$ref.log" &
  pid=$!
  ( sleep "$RUN_LIMIT_S"; pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  wd=$!
  wait "$pid" 2>/dev/null; RC=$?
  pkill -P "$wd" 2>/dev/null; kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  if [[ "$RC" -eq 143 || "$RC" -eq 137 ]]; then
    echo "# TIMEOUT: the driver for $ref was still running after ${RUN_LIMIT_S}s and was killed" >&2
    tail -n 15 "$(st "$ref")/loop.log" 2>/dev/null | sed 's/^/# loop.log: /' >&2
    RC=124
  fi
  OUT="$(cat "$FIX/out-$ref.json" 2>/dev/null)"
}
# whatever a failed check leaves running (stub, driver) is stopped when the suite ends
trap 'stub_stop; pkill -P $$ 2>/dev/null' EXIT
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

# --- 4b: the workspace-trust dialog is accepted once; every other dialog is left alone -----------------------
# The real dialog, captured from Claude Code through ship-mux read (paths scrubbed): cursor on Yes / on No.
TRUSTFIX="$TESTS_DIR/fixtures/ship/trust"
TRUST_DLG="$(cat "$TRUSTFIX/narrow-after-down.txt")"
enter_count() { local n; n="$(grep -c '^<keys:enter>$' "$SHIP_MUX_FAKE_DIR/sent/$(agent_of "$1" "$2")" 2>/dev/null)"; echo "${n:-0}"; }
export SHIP_TRUST_WAIT_S=2

reset_fake; unit t4a
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf '%s\n' "$TRUST_DLG" >"$SHIP_MUX_FAKE_DIR/read/t4a-dev"
printf 'Welcome back\n' >"$SHIP_MUX_FAKE_DIR/read/t4a-dev.after-enter"
script t4a develop.json "$DEV_DONE"; script t4a review-r1.json "$REV_OK"
stub_start t4a; run_loop t4a; stub_stop
check_result t4a "trust dialog accepted" 0 READY
assert_eq "trust dialog: Enter was pressed once" "1" "$(enter_count t4a t4a-dev)"
assert_eq "trust dialog: one log line says so" "1" "$(grep -c 'workspace-trust dialog' "$(st t4a)/loop.log")"
assert_eq "trust dialog: the dev was started once" "1" "$(starts_of t4a-dev)"
assert_eq "default on Yes: no down was sent" "0" "$(grep -c '^<keys:down>$' "$SHIP_MUX_FAKE_DIR/sent/$(agent_of t4a t4a-dev)" 2>/dev/null)"

reset_fake; unit t4b
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf '%s\n' "$TRUST_DLG" >"$SHIP_MUX_FAKE_DIR/read/t4b-dev"
script t4b develop.json "$DEV_DONE"; script t4b review-r1.json "$REV_OK"
stub_start t4b; run_loop t4b; stub_stop
check_result t4b "trust dialog that stays" 2 PARKED
assert_eq "trust dialog that stays: park.json status" "DIALOG" "$(jq -r .status "$(st t4b)/park.json")"
assert_contains "...the message names the trust dialog" "$(jq -r .question "$(st t4b)/park.json")" "workspace-trust dialog"
assert_eq "...Enter was pressed once, not again" "1" "$(enter_count t4b t4b-dev)"
assert_eq "...the dev was left alive" "t4b-dev" "$(live_agents t4b)"

TRUST_NO="$(cat "$TRUSTFIX/narrow-before.txt")"
key_count() { local n; n="$(grep -c "^<keys:$3>\$" "$SHIP_MUX_FAKE_DIR/sent/$(agent_of "$1" "$2")" 2>/dev/null)"; echo "${n:-0}"; }
assert_contains "fixture: the No dialog has the cursor on No" "$TRUST_NO" "❯ No, exit"

reset_fake; unit t4c
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf '%s\n' "$TRUST_NO" >"$SHIP_MUX_FAKE_DIR/read/t4c-dev"
printf '%s\n' "$TRUST_DLG" >"$SHIP_MUX_FAKE_DIR/read/t4c-dev.after-down"
printf 'Welcome back\n' >"$SHIP_MUX_FAKE_DIR/read/t4c-dev.after-enter"
script t4c develop.json "$DEV_DONE"; script t4c review-r1.json "$REV_OK"
stub_start t4c; run_loop t4c; stub_stop
check_result t4c "trust dialog defaulting to No" 0 READY
assert_eq "default on No: one down" "1" "$(key_count t4c t4c-dev down)"
assert_eq "...then one enter" "1" "$(key_count t4c t4c-dev enter)"
assert_eq "...down came before enter" "<keys:down>" "$(grep '^<keys:' "$SHIP_MUX_FAKE_DIR/sent/$(agent_of t4c t4c-dev)" | head -n 1)"

reset_fake; unit t4e
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf '%s\n' "$TRUST_NO" >"$SHIP_MUX_FAKE_DIR/read/t4e-dev"
script t4e develop.json "$DEV_DONE"; script t4e review-r1.json "$REV_OK"
stub_start t4e; run_loop t4e; stub_stop
check_result t4e "trust dialog whose cursor never moves" 2 PARKED
assert_eq "stuck cursor: park.json status" "DIALOG" "$(jq -r .status "$(st t4e)/park.json")"
assert_contains "...the message names the trust dialog" "$(jq -r .question "$(st t4e)/park.json")" "workspace-trust dialog"
assert_eq "...at most 2 downs" "2" "$(key_count t4e t4e-dev down)"
assert_eq "...and Enter was never pressed" "0" "$(key_count t4e t4e-dev enter)"

reset_fake; unit t4d
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf 'Some tool wants to run.\n\n  \u276f 1. Yes\n    2. No\n' >"$SHIP_MUX_FAKE_DIR/read/t4d-dev"
mkdir -p "$SHIP_MUX_FAKE_DIR/status"; printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t4d-dev"
stub_start t4d; run_loop t4d; stub_stop
check_result t4d "another dialog" 2 PARKED
assert_eq "another dialog: parked as DIALOG" "DIALOG" "$(jq -r .status "$(st t4d)/park.json")"
assert_eq "...and no key was sent" "0" "$(enter_count t4d t4d-dev)"

# a trust dialog quoted in the agent's output, with a real permission prompt below it: no key may be sent
PERM=$'\n \u23fa Bash command\n\n   rm -rf build\n\n Do you want to proceed?\n \u276f 1. Yes\n   2. No, and tell Claude what to do differently'
for v in unindented indented; do
  ref="t4f-$v"; ref="${ref//-/}"
  reset_fake; unit "$ref"
  mkdir -p "$SHIP_MUX_FAKE_DIR/read" "$SHIP_MUX_FAKE_DIR/status"
  if [[ $v == unindented ]]; then quoted="$TRUST_DLG"; else quoted="$(printf '%s\n' "$TRUST_DLG" | sed 's/^/    /')"; fi
  printf '%s\n%s\n' "$quoted" "$PERM" >"$SHIP_MUX_FAKE_DIR/read/$ref-dev"
  printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/$ref-dev"
  stub_start "$ref"; run_loop "$ref"; stub_stop
  check_result "$ref" "quoted trust dialog ($v) above a permission prompt" 2 PARKED
  assert_eq "quoted trust dialog ($v): parked as DIALOG" "DIALOG" "$(jq -r .status "$(st "$ref")/park.json")"
  assert_not_contains "...with the generic message, not the trust one" "$(jq -r .question "$(st "$ref")/park.json")" "workspace-trust"
  assert_eq "...no enter was sent" "0" "$(key_count "$ref" "$ref-dev" enter)"
  assert_eq "...no down was sent" "0" "$(key_count "$ref" "$ref-dev" down)"
done

# --- 4g: trust_state on the real captures, and on the ambiguous cases it must never answer ------------------
eval "$(sed -n '/^trust_state() {/,/^}/p' "$LOOP")"
for f in medium narrow wide; do
  assert_eq "trust_state: $f capture, cursor on No" "other" "$(trust_state <"$TRUSTFIX/$f-before.txt")"
  assert_eq "trust_state: $f capture, cursor on Yes" "yes" "$(trust_state <"$TRUSTFIX/$f-after-down.txt")"
done
LAUNCH="env PATH=/usr/bin:/bin:/opt/tools/bin /home/user/.local/bin/launch-peer off claude --model haiku --permission-mode bypassPermissions --session-id 11111111-2222-4333-8444-555555555555"
assert_eq "trust_state: the echoed launch command and a rule above the header do not count" "other" "$(printf '%s\n\n%s\n' "$LAUNCH" "$(cat "$TRUSTFIX/wide-before.txt")" | trust_state)"
assert_eq "trust_state: no dialog at all" "none" "$(printf 'hello\n\n> prompt\n' | trust_state)"
assert_eq "trust_state: a trust dialog quoted with an indent" "none" "$(sed 's/^/      /' "$TRUSTFIX/narrow-before.txt" | trust_state)"
PERM2=$'\n \u23fa Bash command\n\n   rm -rf build\n\n Do you want to proceed?\n \u276f 1. Yes\n   2. No'
assert_eq "trust_state: a trust dialog followed by a real permission prompt" "ambiguous" "$({ cat "$TRUSTFIX/narrow-before.txt"; printf '%s\n' "$PERM2"; } | trust_state)"
assert_eq "trust_state: ...an unnumbered permission prompt too" "ambiguous" "$({ cat "$TRUSTFIX/narrow-before.txt"; printf '\n Allow this tool?\n \u276f Allow once\n   Deny\n'; } | trust_state)"
assert_eq "trust_state: a third option (unnumbered)" "ambiguous" "$(sed 's/^   Yes, I trust this folder$/   Yes, I trust this folder\n   Maybe later/' "$TRUSTFIX/narrow-before.txt" | trust_state)"
assert_eq "trust_state: a third option (numbered)" "ambiguous" "$({ sed '/Enter to confirm/d' "$TRUSTFIX/narrow-before.txt"; printf '  3. Always\n\n Enter to confirm\n'; } | trust_state)"
assert_eq "trust_state: Allow... after the options" "ambiguous" "$({ cat "$TRUSTFIX/narrow-before.txt"; printf '\n Allow all edits this session?\n'; } | trust_state)"
assert_eq "trust_state: a footer that only starts like the real one" "ambiguous" "$(sed 's/Enter to confirm.*/Enter to confirm and allow all commands/' "$TRUSTFIX/narrow-before.txt" | trust_state)"
assert_eq "trust_state: the real footer, boxed" "other" "$(sed 's/^\( *\)\(Enter to confirm.*\)$/\1│ \2 │/' "$TRUSTFIX/narrow-before.txt" | trust_state)"
assert_eq "trust_state: two cursors" "ambiguous" "$(sed 's/^   Yes, I trust this folder$/ ❯ Yes, I trust this folder/' "$TRUSTFIX/narrow-before.txt" | trust_state)"
assert_eq "trust_state: no cursor" "ambiguous" "$(sed 's/^ ❯ No, exit$/   No, exit/' "$TRUSTFIX/narrow-before.txt" | trust_state)"
# --- 4h: a dialog that vanishes after a down key, and a single blank read after Enter --------------------
export SHIP_TRUST_WAIT_S=2
reset_fake; unit t4h
mkdir -p "$SHIP_MUX_FAKE_DIR/read"
printf '%s\n' "$TRUST_NO" >"$SHIP_MUX_FAKE_DIR/read/t4h-dev"
printf 'Welcome back\n' >"$SHIP_MUX_FAKE_DIR/read/t4h-dev.after-down"
script t4h develop.json "$DEV_DONE"; script t4h review-r1.json "$REV_OK"
stub_start t4h; run_loop t4h; stub_stop
check_result t4h "dialog vanished after a down" 2 PARKED
assert_eq "vanished after down: park.json status" "DIALOG" "$(jq -r .status "$(st t4h)/park.json")"
assert_contains "...the message says it vanished" "$(jq -r .question "$(st t4h)/park.json")" "vanished after a down key"
assert_eq "...Enter was never pressed" "0" "$(key_count t4h t4h-dev enter)"

# trust_dialog with a scripted pane: after Enter, one blank read between two dialog reads is not "cleared"
eval "$(sed -n '/^trust_dialog() {/,/^}/p' "$LOOP")"
# shellcheck disable=SC2034  # LOG, POLL_S, TRUST_WAIT_S, WT are read by the eval'd trust_dialog
(
  STATE="$(mktemp -d)"; mkdir -p "$STATE/agents"; LOG=/dev/null; POLL_S=0; TRUST_WAIT_S=2; WT=/x
  YES="$(cat "$TRUSTFIX/narrow-after-down.txt")"; Q="$STATE/q"
  log() { :; }; sleep() { :; }
  park() { echo "PARK $1"; exit 9; }
  # reads come from a queue: the first line of $Q is consumed per read, the last one repeats
  mux() {
    [[ "$1" == read ]] || return 0
    local f; f="$(head -n 1 "$Q")"; [[ "$(wc -l <"$Q")" -le 1 ]] || sed -i.bak 1d "$Q"
    case "$f" in y) printf '%s\n' "$YES" ;; *) printf 'Welcome back\n' ;; esac
  }
  printf 'y\ny\nn\ny\n' >"$Q"
  trust_dialog a a-id develop; echo "rc=$?"
) >"$SHIP_MUX_FAKE_DIR/../t4h-one.out" 2>&1
assert_contains "one blank read after Enter, then the dialog again: parked, not cleared" "$(cat "$SHIP_MUX_FAKE_DIR/../t4h-one.out")" "PARK DIALOG"
# shellcheck disable=SC2034  # LOG, POLL_S, TRUST_WAIT_S, WT are read by the eval'd trust_dialog
(
  STATE="$(mktemp -d)"; mkdir -p "$STATE/agents"; LOG=/dev/null; POLL_S=0; TRUST_WAIT_S=2; WT=/x
  YES="$(cat "$TRUSTFIX/narrow-after-down.txt")"; Q="$STATE/q"
  log() { :; }; sleep() { :; }
  park() { echo "PARK $1"; exit 9; }
  mux() {
    [[ "$1" == read ]] || return 0
    local f; f="$(head -n 1 "$Q")"; [[ "$(wc -l <"$Q")" -le 1 ]] || sed -i.bak 1d "$Q"
    case "$f" in y) printf '%s\n' "$YES" ;; *) printf 'Welcome back\n' ;; esac
  }
  printf 'y\ny\nn\nn\n' >"$Q"
  trust_dialog a a-id develop; echo "rc=$?"
) >"$SHIP_MUX_FAKE_DIR/../t4h-two.out" 2>&1
assert_contains "two blank reads in a row after Enter: cleared" "$(cat "$SHIP_MUX_FAKE_DIR/../t4h-two.out")" "rc=0"
unset SHIP_TRUST_WAIT_S
assert_eq "the rulings file was created on first use" "yes" "$([[ -s "$SPACE/notes/decisions.md" ]] && echo yes || echo no)"

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
for _ in $(seq 2400); do [[ -e "$(st t12)/review-r1.json.sent" ]] && break; sleep 0.05; done
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

# --- 13: LIMIT (nothing to fail over to: the unit parks) ------------------------------------------------------------------------------------
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
assert_contains "LIMIT: the new dev runs the override model" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | tail -n 1)" '"zz-after-limit"'
assert_contains "LIMIT: and the first one did not" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | head -n 1)" '--model'
assert_not_contains "LIMIT: the first dev was not on the override" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep t13-dev | head -n 1)" 'zz-after-limit'
unset SHIP_LOOP_MUX LIMITMUX_REAL

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
BUD_S=0.5; write_cfg   # a 30 s budget: the check below is about the carried clock, not about machine speed
reset_fake; unit t31
mkdir -p "$SHIP_MUX_FAKE_DIR/status"; printf 'working\nblocked\n' >"$SHIP_MUX_FAKE_DIR/status/t31-dev"
stub_start t31; run_loop t31; stub_stop
check_result t31 "parked on a dialog (carry case)" 2 PARKED
printf '30\n' >"$(st t31)/develop.json.clock"   # 30 of the 30 seconds are used
printf 'working\n' >"$SHIP_MUX_FAKE_DIR/status/t31-dev"
SECONDS=0; run_loop t31; _took=$SECONDS
check_result t31 "the used time is carried over a restart" 2 OVER-BUDGET
assert_ok "carried clock: over budget well before a clock restarted at zero could be (that needs more than 30 s; took $_took)" test "$_took" -lt 25
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
export STUB_DELAY=0.3; stub_start t36; unset STUB_DELAY; run_loop t36
check_result t36 "slow lookup: question" 2 PARKED
printf 'Yes.\n' >"$(st t36)/answer-1.md"
run_loop t36; stub_stop
check_result t36 "slow lookup: answered" 0 READY
assert_eq "slow lookup: develop was prompted twice, not three times" "2" "$(wc -l <"$(st t36)/develop.json.sent" | tr -d ' ')"
unset SHIP_LOOP_MUX SLOWMUX_REAL; BUD_S=10; write_cfg

# --- 37: the push invariant — only a diff a READY review was shown goes out ---------------------------------------------------------
leak_unit() { # ref — a unit whose pushed branch carries a forbidden word
  local w="$SPACE/worktrees/$1"
  unit "$1"
  echo "see SECRETWORD here" >"$w/leak.txt"; git -C "$w" add -A; git -C "$w" commit -qm "feat: leak"; git -C "$w" push -q origin "feat-$1" 2>/dev/null
  CFG_EXTRA="scan:
  forbidden: ['SECRETW[O]RD']"; write_cfg
}
reword_hook() { # ref fix-file — the dev rewords the leak in a commit, without pushing
  local w="$SPACE/worktrees/$1"
  printf '#!/bin/sh\necho clean >"%s/leak.txt"\ngit -C "%s" commit -qam "fix: reword"\nexit 0\n' "$w" "$w" >"$FIX/scripts/$1/$2.hook"
  chmod +x "$FIX/scripts/$1/$2.hook"
}
# R7: a post-fix review says CHANGES and the dev's next fix changes nothing: STUCK, never a push
reset_fake; leak_unit t37
O37="$(git -C "$FIX/origin-t37.git" rev-parse refs/heads/feat-t37)"
script t37 develop.json "$DEV_DONE"; script t37 review-r1.json "$REV_OK"
script t37 fix-r2.json "$DEV_DONE"; reword_hook t37 fix-r2.json
script t37 review-r2.json "$REV_CHANGES"
script t37 fix-r3.json "$DEV_DONE"; script t37 fix-r4.json "$DEV_DONE"
stub_start t37; run_loop t37; stub_stop
check_result t37 "R7: a no-op fix after CHANGES" 2 STUCK
assert_eq "R7: nothing was pushed" "$O37" "$(git -C "$FIX/origin-t37.git" rev-parse refs/heads/feat-t37)"
assert_eq "R7: no finalize" "no" "$([[ -e "$(st t37)/finalize.json" ]] && echo yes || echo no)"
assert_eq "R7: the dev was asked again after the no-op" "yes" "$([[ -e "$(st t37)/fix-r4.json.sent" ]] && echo yes || echo no)"
assert_eq "R7: no review of an unchanged diff" "0" "$(starts_of t37-review-r3)"
CFG_EXTRA=''; write_cfg

# R6: the dev parks QUESTION in the middle of a finalize fix; the resume continues that fix and waits for it
reset_fake; leak_unit t38
O38="$(git -C "$FIX/origin-t38.git" rev-parse refs/heads/feat-t38)"
script t38 develop.json "$DEV_DONE"; script t38 review-r1.json "$REV_OK"
script t38 fix-r2.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Reword how?"}'
script t38 fix-r2.json.2 "$DEV_DONE"; reword_hook t38 fix-r2.json
script t38 review-r2.json "$REV_OK"
stub_start t38; run_loop t38
check_result t38 "R6: parked in a finalize fix" 2 PARKED
assert_eq "R6: nothing pushed while parked" "$O38" "$(git -C "$FIX/origin-t38.git" rev-parse refs/heads/feat-t38)"
printf 'Say clean.\n' >"$(st t38)/answer-1.md"
run_loop t38; stub_stop
check_result t38 "R6: answered" 0 READY
assert_eq "R6: the fix was finished (fix-r2.json is DONE)" "DONE" "$(jq -r .status "$(st t38)/fix-r2.json")"
assert_eq "R6: the fix was reviewed before the push" "1" "$(starts_of t38-review-r2)"
assert_eq "R6: the push is the dev's reworded head" "$(git -C "$SPACE/worktrees/t38" rev-parse HEAD)" "$(git -C "$FIX/origin-t38.git" rev-parse refs/heads/feat-t38)"
CFG_EXTRA=''; write_cfg

# R8: the dev parks QUESTION in a fix round and dies; the replacement gets takeover + fix prompt + answer in one message
reset_fake; leak_unit t39
script t39 develop.json "$DEV_DONE"; script t39 review-r1.json "$REV_OK"
script t39 fix-r2.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Reword how?"}'
stub_start t39; run_loop t39; stub_stop
check_result t39 "R8: parked in a fix round" 2 PARKED
printf 'Say clean.\n' >"$(st t39)/answer-1.md"
_id="$(agent_of t39 t39-dev)"; (cd "$SPACE" && bash "$SCRIPTS_DIR/ship/ship-mux" close --ref t39 --id "$_id" >/dev/null 2>&1)
rm -rf "$FIX/scripts/t39"; mkdir -p "$FIX/scripts/t39"
script t39 fix-r2.json "$DEV_DONE"; reword_hook t39 fix-r2.json; script t39 review-r2.json "$REV_OK"
clear_sent t39 fix-r2.json; stub_start t39; run_loop t39; stub_stop
check_result t39 "R8: replaced dev" 0 READY
assert_eq "R8: a second dev started" "2" "$(starts_of t39-dev)"
assert_eq "R8: the new dev's first message is a single send" "1" "$(grep -c 'taking over unit t39' <<<"$(sent_to t39 t39-dev)")"
assert_contains "R8: it carries the fix prompt" "$(sent_to t39 t39-dev)" "SECRETWORD"
assert_contains "R8: and the operator's answer" "$(sent_to t39 t39-dev)" "Say clean."
CFG_EXTRA=''; write_cfg

# The invariant itself: a forged reviewed.sig and a review.sig that does not match the diff do not allow a push
reset_fake; unit t40
script t40 develop.json "$DEV_DONE"; script t40 review-r2.json "$REV_OK"
mkdir -p "$(st t40)"
printf '%s\n' "$DEV_DONE" >"$(st t40)/develop.json"; : >"$(st t40)/develop.json.sent"
printf '%s\n' "$REV_OK" >"$(st t40)/review-r1.json"; : >"$(st t40)/review-r1.json.sent"
echo forged >"$(st t40)/review-r1.sig"; echo forged >"$(st t40)/reviewed.sig"
touch -t 202001010000 "$(st t40)/develop.json" "$(st t40)/develop.json.sent" "$(st t40)/review-r1.json" "$(st t40)/review-r1.json.sent"
stub_start t40; run_loop t40; stub_stop
check_result t40 "invariant: forged signatures" 0 READY
assert_eq "invariant: the diff was reviewed again before the push" "1" "$(starts_of t40-review-r2)"
assert_eq "normal run: no extra review (t1)" "0" "$(starts_of t1-review-r2)"

# --- 41: post-fix reviews keep asking for changes and every fix changes the diff: STUCK at the budget, never a push --------------
churn_hook() { # ref fix-file — each call changes the diff again (and removes the leak)
  local w="$SPACE/worktrees/$1"
  printf '#!/bin/sh\necho clean >"%s/leak.txt"\necho "$$ $(date +%%s)" >>"%s/churn.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: churn"\nexit 0\n' "$w" "$w" "$w" "$w" >"$FIX/scripts/$1/$2.hook"
  chmod +x "$FIX/scripts/$1/$2.hook"
}
reset_fake; leak_unit t41
O41="$(git -C "$FIX/origin-t41.git" rev-parse refs/heads/feat-t41)"
script t41 develop.json "$DEV_DONE"; script t41 review-r1.json "$REV_OK"
for _r in 2 3 4; do script t41 fix-r$_r.json "$DEV_DONE"; churn_hook t41 fix-r$_r.json; script t41 review-r$_r.json "$REV_CHANGES"; done
stub_start t41; run_loop t41; stub_stop
check_result t41 "post-fix review budget" 2 STUCK
assert_eq "budget: nothing was pushed" "$O41" "$(git -C "$FIX/origin-t41.git" rev-parse refs/heads/feat-t41)"
assert_eq "budget: no finalize" "no" "$([[ -e "$(st t41)/finalize.json" ]] && echo yes || echo no)"
assert_eq "budget: the third review was the last" "1 0" "$(starts_of t41-review-r4) $(starts_of t41-review-r5)"
CFG_EXTRA=''; write_cfg

# --- 42: a dev replaced during a finalize fix: the in-flight marker is cleared, the new dev is told everything ----------------------
reset_fake; leak_unit t42
mkdir -p "$(st t42)"
printf '%s\n' "$DEV_DONE" >"$(st t42)/develop.json"; : >"$(st t42)/develop.json.sent"
printf '%s\n' "$REV_OK" >"$(st t42)/review-r1.json"; : >"$(st t42)/review-r1.json.sent"
echo stale >"$(st t42)/review-r1.sig"
printf 'old findings\n' >"$(st t42)/fix-r2.findings"; printf 'finalize\n' >"$(st t42)/fix-r2.src"
# (empty markers, like the other seeds: a running stub must not take them for a prompt)
: >"$(st t42)/fix-r2.json.sent"
touch -t 202001010000 "$(st t42)/develop.json" "$(st t42)/develop.json.sent" "$(st t42)/review-r1.json" "$(st t42)/review-r1.json.sent" "$(st t42)/fix-r2.json.sent"
script t42 review-r2.json "$REV_OK"; script t42 fix-r3.json "$DEV_DONE"; reword_hook t42 fix-r3.json; script t42 review-r3.json "$REV_OK"
stub_start t42; run_loop t42; stub_stop
check_result t42 "takeover with a fix in flight" 0 READY
assert_contains "takeover: the new dev got the takeover text" "$(sent_to t42 t42-dev)" "You are taking over unit t42"
assert_contains "takeover: and the fix prompt" "$(sent_to t42 t42-dev)" "SECRETWORD"
assert_eq "takeover: the in-flight fix marker of the dead dev was cleared" "no" "$([[ -e "$(st t42)/fix-r2.json.sent" ]] && echo yes || echo no)"
CFG_EXTRA=''; write_cfg

# --- 43: a prompt that fails to go out leaves no .sent marker behind ----------------------------------------------------------
reset_fake; unit t43
script t43 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Q?"}'
stub_start t43; run_loop t43; stub_stop
check_result t43 "send failure: first run" 2 PARKED
rm -f "$(st t43)/park.json"      # the lead resumed without an answer and the park is gone: the stage is re-prompted
printf '%s\n' "$DEV_DONE" >"$(st t43)/develop.json"; touch -t 202001010000 "$(st t43)/develop.json"
: >"$FIX/failmux.on"
export SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/failmux" FAILMUX_REAL="$SCRIPTS_DIR/ship/ship-mux" FAILMUX_FILE="$FIX/failmux.on"
run_loop t43
check_result t43 "send failure: the prompt could not go out" 2 PARKED
assert_eq "send failure: parked BLOCKED" "BLOCKED" "$(jq -r .status "$(st t43)/park.json")"
assert_eq "send failure: the stale .sent marker was removed" "no" "$([[ -e "$(st t43)/develop.json.sent" ]] && echo yes || echo no)"
unset SHIP_LOOP_MUX FAILMUX_REAL FAILMUX_FILE

# --- 44: a verdict that lands between the driver's two looks at a stage in flight is reused, not prompted over -------------------------------
reset_fake; unit t44
script t44 develop.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Q?"}'
stub_start t44; run_loop t44; stub_stop
check_result t44 "race: first run parks" 2 PARKED
assert_ok "race: the dev was prompted" test -e "$(st t44)/develop.json.sent"
rm -f "$(st t44)/park.json" "$(st t44)/develop.json"   # resumed: the stage is in flight, the verdict not there yet
printf '%s\n' "$DEV_DONE" >"$FIX/t44-verdict.json"
export SHIP_LOOP_AFTER_LOOKUP="$TESTS_DIR/fixtures/ship/landverdict" LANDVERDICT_NAME=develop.json LANDVERDICT_SRC="$FIX/t44-verdict.json"
script t44 review-r1.json "$REV_OK"
stub_start t44; run_loop t44; stub_stop
unset SHIP_LOOP_AFTER_LOOKUP LANDVERDICT_NAME LANDVERDICT_SRC
check_result t44 "race: verdict landed during the lookup" 0 READY
assert_eq "race: develop was prompted once" "1" "$(wc -l <"$(st t44)/develop.json.sent" | tr -d ' ')"
assert_contains "race: the landed verdict was reused" "$(cat "$(st t44)/loop.log")" "reusing develop.json"
assert_not_contains "race: and never deleted for a new prompt" "$(cat "$(st t44)/loop.log")" "prompting again"

# --- 45: a restarted LIMIT park in develop continues the same run: clock kept, new dev takes over -----------------------------------------
reset_fake; unit t45b
mkdir -p "$(st t45b)"
cat >"$(st t45b)/park.json" <<PARK
{"status":"BLOCKED","stage":"develop","agent":"t45b-dev","question":"it stopped","since":"2026-01-01T00:00:00Z","n":1,"file":"$(st t45b)/develop.json"}
PARK
printf '17\n' >"$(st t45b)/develop.json.clock"
script t45b develop.json "$DEV_DONE"; script t45b review-r1.json "$REV_OK"
stub_start t45b; run_loop t45b; stub_stop
check_result t45b "restarted park continues the run" 0 READY
assert_contains "restart: the new dev is told it takes over" "$(sent_to t45b t45b-dev)" "You are taking over unit t45b"
assert_eq "restart: nothing was archived" "0" "$(ls -d "$(st t45b)"/run-* 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "restart: the clock of the earlier run was carried (17 s or more)" "yes" "$([[ "$(cat "$(st t45b)/develop.json.clock")" -ge 17 ]] && echo yes || echo no)"

# --- 46: a whitespace-only change after the last review is reviewed again (the signature counts whitespace) ---------------------------------
reset_fake; unit t46
W46="$SPACE/worktrees/t46"; export GATEOK46="$FIX/gateok-t46"
printf 'if x:\nb()\n' >"$W46/p.py"; git -C "$W46" add -A; git -C "$W46" commit -qm "feat: py"; git -C "$W46" push -q origin feat-t46 2>/dev/null
GATE_CMD='test -e "$GATEOK46"'; write_cfg
script t46 develop.json "$DEV_DONE"; script t46 review-r1.json "$REV_OK"; script t46 fix-r2.json "$DEV_DONE"; script t46 review-r2.json "$REV_OK"
printf '#!/bin/sh\nprintf "if x:\\n    b()\\n" >"%s/p.py"\ntouch "%s"\ngit -C "%s" commit -qam "fix: indent"\nexit 0\n' "$W46" "$GATEOK46" "$W46" >"$FIX/scripts/t46/fix-r2.json.hook"
chmod +x "$FIX/scripts/t46/fix-r2.json.hook"
stub_start t46; run_loop t46; stub_stop
check_result t46 "whitespace-only fix" 0 READY
assert_eq "whitespace: the re-indented diff got its own review" "1" "$(starts_of t46-review-r2)"
unset GATEOK46; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 47: a CHANGES review whose stored signature matches the diff is no licence to push (and a missing sig is none either) ---------------------
reset_fake; unit t47
W47="$SPACE/worktrees/t47"; O47="$(git -C "$FIX/origin-t47.git" rev-parse refs/heads/feat-t47)"
mkdir -p "$(st t47)"
printf '%s\n' "$DEV_DONE" >"$(st t47)/develop.json"; : >"$(st t47)/develop.json.sent"
printf '%s\n' "$REV_OK" >"$(st t47)/review-r1.json"; : >"$(st t47)/review-r1.json.sent"
printf '%s\n' "$REV_CHANGES" >"$(st t47)/review-r2.json"; : >"$(st t47)/review-r2.json.sent"
git -C "$W47" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1 >"$(st t47)/review-r2.sig"
echo forged >"$(st t47)/review-r1.sig"
touch -t 202001010000 "$(st t47)"/*.json "$(st t47)"/*.sent
script t47 fix-r3.json "$DEV_DONE"; script t47 fix-r4.json "$DEV_DONE"; script t47 review-r3.json "$REV_OK"
stub_start t47; run_loop t47; stub_stop
assert_eq "CHANGES+matching sig: not READY" "2" "$RC"
assert_eq "CHANGES+matching sig: nothing pushed" "$O47" "$(git -C "$FIX/origin-t47.git" rev-parse refs/heads/feat-t47)"

# --- 48: a finalize fix resumed in round 3 is compared with the diff it started from, not with the replayed head --------------------------------
reset_fake; leak_unit t48
script t48 develop.json "$DEV_DONE"; script t48 review-r1.json "$REV_OK"
script t48 fix-r2.json "$DEV_DONE"; reword_hook t48 fix-r2.json; script t48 review-r2.json "$REV_CHANGES"
script t48 fix-r3.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"How?"}'
script t48 fix-r3.json.2 "$DEV_DONE"; churn_hook t48 fix-r3.json; script t48 review-r3.json "$REV_OK"
stub_start t48; run_loop t48
check_result t48 "resume r3: parked" 2 PARKED
printf 'Go.\n' >"$(st t48)/answer-1.md"
run_loop t48; stub_stop
check_result t48 "resume r3: answered" 0 READY
assert_eq "resume r3: the changed diff was reviewed" "1" "$(starts_of t48-review-r3)"
CFG_EXTRA=''; write_cfg

# --- 49: a git that cannot compute the signature ends the run with ERROR and pushes nothing ------------------------------------------------
reset_fake; unit t49
O49="$(git -C "$FIX/origin-t49.git" rev-parse refs/heads/feat-t49)"
mkdir -p "$FIX/shim49"; REALGIT="$(command -v git)"
printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = "--verbatim" ] && { echo "error: unknown option verbatim" >&2; exit 129; }; done\nexec "%s" "$@"\n' "$REALGIT" >"$FIX/shim49/git"; chmod +x "$FIX/shim49/git"
script t49 develop.json "$DEV_DONE"; script t49 review-r1.json "$REV_OK"
_path="$PATH"; PATH="$FIX/shim49:$PATH"
stub_start t49; run_loop t49; stub_stop
PATH="$_path"
assert_eq "old git: the run ends ERROR (exit 1)" "1" "$RC"
assert_eq "old git: nothing was pushed" "$O49" "$(git -C "$FIX/origin-t49.git" rev-parse refs/heads/feat-t49)"

# --- 50: a diff_sig that fails ends the run with its own ERROR: no JSON in a .sig/.before file, no "exited unexpectedly" ---------------------
mkdir -p "$FIX/shim50"; REALGIT50="$(command -v git)"
printf '#!/bin/sh\nif [ -e "$FLAG50" ]; then for a in "$@"; do [ "$a" = "--verbatim" ] && { echo "error: patch-id broke" >&2; exit 129; }; done; fi\nexec "%s" "$@"\n' "$REALGIT50" >"$FIX/shim50/git"; chmod +x "$FIX/shim50/git"
flag_hook() { printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$FIX/flag50-$1" >"$FIX/scripts/$1/$2.hook"; chmod +x "$FIX/scripts/$1/$2.hook"; }
_path="$PATH"
# a: it fails before the first review is prompted
reset_fake; unit t50a; : >"$FIX/flag50-t50a"
script t50a develop.json "$DEV_DONE"; script t50a review-r1.json "$REV_OK"
export FLAG50="$FIX/flag50-t50a"; PATH="$FIX/shim50:$_path"
stub_start t50a; run_loop t50a; stub_stop
PATH="$_path"
assert_eq "diff_sig a: the run ends ERROR (exit 1)" "1" "$RC"
assert_ok "diff_sig a: no signature file was written, or it holds no error JSON" bash -c '[ ! -e "$1" ] || ! grep -q "\"status\"" "$1"' _ "$(st t50a)/review-r1.sig"
assert_eq "diff_sig a: it failed at write_sig, in the review stage" "review" "$(res t50a .stage)"
assert_contains "diff_sig a: driver.err says what failed" "$(cat "$(st t50a)/driver.err")" "patch-id"
# b: it fails after the review ACCEPT (inside reviewed_diff, a command substitution)
reset_fake; unit t50b
script t50b develop.json "$DEV_DONE"; script t50b review-r1.json "$REV_OK"; flag_hook t50b review-r1.json
export FLAG50="$FIX/flag50-t50b"; PATH="$FIX/shim50:$_path"
stub_start t50b; run_loop t50b; stub_stop
PATH="$_path"
assert_eq "diff_sig b: the run ends ERROR (exit 1)" "1" "$RC"
assert_eq "diff_sig b: result.json status" "ERROR" "$(res t50b .status)"
assert_contains "diff_sig b: result.json keeps the real reason" "$(res t50b .why)" "patch-id"
assert_contains "diff_sig b: driver.err keeps the real reason" "$(cat "$(st t50b)/driver.err")" "patch-id"
assert_not_contains "diff_sig b: the exit trap did not overwrite it" "$(cat "$(st t50b)/loop.log")" "driver exited unexpectedly"
# c: it fails when a fix round records the diff it started from
reset_fake; unit t50c
script t50c develop.json "$DEV_DONE"; script t50c review-r1.json "$REV_CHANGES"; flag_hook t50c review-r1.json; script t50c fix-r2.json "$DEV_DONE"
export FLAG50="$FIX/flag50-t50c"; PATH="$FIX/shim50:$_path"
stub_start t50c; run_loop t50c; stub_stop
PATH="$_path"; unset FLAG50
assert_eq "diff_sig c: the run ends ERROR (exit 1)" "1" "$RC"
assert_contains "diff_sig c: driver.err says what failed" "$(cat "$(st t50c)/driver.err")" "patch-id"
assert_ok "diff_sig c: the run got as far as the fix round" test -e "$(st t50c)/fix-r2.findings"
assert_ok "diff_sig c: fix-r2.before is absent or holds no error JSON" bash -c '[ ! -e "$1" ] || ! grep -q "\"status\"" "$1"' _ "$(st t50c)/fix-r2.before"
assert_not_contains "diff_sig c: the exit trap did not overwrite it" "$(cat "$(st t50c)/loop.log")" "driver exited unexpectedly"

# --- 51: the final gate's signature is written when it is prompted --------------------------------------------------------------
reset_fake; unit t51
script t51 develop.json "$DEV_DONE"; script t51 review-r1.json "$REV_OK"; script t51 final-r1.json "$REV_OK"
stub_start t51; run_loop t51 --final-gate; stub_stop
check_result t51 "final sig" 0 READY
assert_ok "final sig: final-r1.sig exists" test -s "$(st t51)/final-r1.sig"
assert_eq "final sig: and equals the diff the review was shown" "$(cat "$(st t51)/review-r1.sig")" "$(cat "$(st t51)/final-r1.sig" 2>/dev/null)"

# --- 52: a restarted reviewer keeps the clock of its stage -------------------------------------------------------------------------
reset_fake; unit t52
mkdir -p "$(st t52)"
printf '%s\n' "$DEV_DONE" >"$(st t52)/develop.json"; : >"$(st t52)/develop.json.sent"
: >"$(st t52)/review-r1.json.sent"; printf '99999\n' >"$(st t52)/review-r1.json.clock"
touch -t 202001010000 "$(st t52)/develop.json" "$(st t52)/develop.json.sent" "$(st t52)/review-r1.json.sent"
run_loop t52
check_result t52 "restarted reviewer" 2 OVER-BUDGET
assert_eq "clock: the stage that ran over budget is the review" "review" "$(res t52 .stage)"

# --- 53: after a failed send a live dev is not told it is taking over ---------------------------------------------------------------
reset_fake; unit t53
script t53 develop.json "$DEV_DONE"; script t53 review-r1.json "$REV_OK"
: >"$FIX/failmux53.on"
export SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/failmux" FAILMUX_REAL="$SCRIPTS_DIR/ship/ship-mux" FAILMUX_FILE="$FIX/failmux53.on"
run_loop t53
check_result t53 "failed send: parked" 2 PARKED
unset SHIP_LOOP_MUX FAILMUX_REAL FAILMUX_FILE
printf 'Use the second option.\n' >"$(st t53)/answer-1.md"
stub_start t53; run_loop t53; stub_stop
check_result t53 "failed send: answered" 0 READY
assert_eq "failed send: the dev was not restarted" "1" "$(starts_of t53-dev)"
assert_not_contains "failed send: a live dev is not told it is taking over" "$(sent_to t53 t53-dev)" "taking over"
assert_not_contains "failed send: nor that a previous dev stopped" "$(sent_to t53 t53-dev)" "The previous dev stopped"
assert_contains "failed send: it is spoken to as the dev that was parked" "$(sent_to t53 t53-dev)" "You were parked earlier (BLOCKED):"
assert_contains "failed send: it gets the task" "$(sent_to t53 t53-dev)" "$BRIEF"
assert_contains "failed send: and the answer" "$(sent_to t53 t53-dev)" "Use the second option."

# --- 54: a revert to a diff the spec check rejected is not a diff to push -------------------------------------------------------
reset_fake; unit t54 spec
W54="$SPACE/worktrees/t54"; O54="$(git -C "$FIX/origin-t54.git" rev-parse refs/heads/feat-t54)"
export GATEOK54="$FIX/gateok-t54"; GATE_CMD='test -e "$GATEOK54"'; write_cfg
SPEC_CHG='{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"docs/spec/a.md","line":1,"summary":"the spec is wrong","fix":"change it"}],"gaps":[],"removals":[],"commits":[],"gate":"green"}'
script t54 develop.json "$DEV_DONE"; script t54 review-r1.json "$REV_OK"; script t54 spec-r1.json "$SPEC_CHG"
script t54 fix-r2.json "$DEV_DONE"; script t54 review-r2.json "$REV_OK"; script t54 spec-r2.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W54" "$W54" "$W54" >"$FIX/scripts/t54/fix-r2.json.hook"
printf '#!/bin/sh\ntouch "%s"\ngit -C "%s" revert --no-edit HEAD >/dev/null 2>&1\nexit 0\n' "$GATEOK54" "$W54" >"$FIX/scripts/t54/fix-r3.json.hook"
chmod +x "$FIX/scripts/t54"/*.hook
for _r in 3 4 5 6; do script t54 fix-r$_r.json "$DEV_DONE"; script t54 review-r$_r.json "$REV_OK"; done
stub_start t54; run_loop t54; stub_stop
check_result t54 "revert to a rejected diff" 2 STUCK
assert_eq "rejected diff: nothing was pushed" "$O54" "$(git -C "$FIX/origin-t54.git" rev-parse refs/heads/feat-t54)"
unset GATEOK54; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 55: the stub agent does not miss a prompt when a recreated .sent marker has the same inode -----------------------------------
S55="$FIX/stub55"; mkdir -p "$S55/state" "$S55/script"
printf '{"n":1}\n' >"$S55/script/x.json"; printf '1000 a\n' >"$S55/state/x.json.sent"
bash "$STUB" "$S55/state" "$S55/script" >/dev/null 2>&1 & _sp=$!
for _ in $(seq 100); do [[ -e "$S55/state/x.json" ]] && break; sleep 0.05; done
assert_ok "stub: the first prompt is answered" test -e "$S55/state/x.json"
rm -f "$S55/state/x.json"; printf '1000 b\n' >"$S55/state/x.json.sent"   # truncated in place: the same inode, one line again
for _ in $(seq 100); do [[ -e "$S55/state/x.json" ]] && break; sleep 0.05; done
assert_ok "stub: a marker that reuses the inode still counts as a new prompt" test -e "$S55/state/x.json"
kill "$_sp" 2>/dev/null; wait "$_sp" 2>/dev/null

# --- 56: mark_sent keeps a verdict that landed while the prompt went out from looking older than its prompt ------------------------------
eval "$(sed -n '/^mark_sent() {/,/^}/p;/^mtime_s() /p;/^sent_after_result() {/,/^}/p' "$LOOP")"
printf '{}\n' >"$FIX/m56.json"; touch -t 202001010000 "$FIX/m56.json"; rm -f "$FIX/m56.json.sent"
assert_ok "mark_sent: the functions were extracted from the script" declare -F mark_sent mtime_s sent_after_result
mark_sent "$FIX/m56.json"
assert_ok "mark_sent: the marker of an already written verdict is not newer than it" bash -c '[ "$1" -le 1 ]' _ "$(( $(mtime_s "$FIX/m56.json.sent") - $(mtime_s "$FIX/m56.json") ))"
assert_eq "mark_sent: so that verdict is not stale" "no" "$(sent_after_result "$FIX/m56.json" && echo yes || echo no)"
rm -f "$FIX/m56.json.sent"; : >"$FIX/m56b.json.sent"
mark_sent "$FIX/m56b.json"
assert_eq "mark_sent: a prompt without a verdict yet gets a fresh marker, one line" "1" "$(wc -l <"$FIX/m56b.json.sent" | tr -d ' ')"
unset -f mark_sent mtime_s sent_after_result

# --- 57: a verdict that is not valid JSON and not older than its prompt is not prompted over -----------------------------------------
reset_fake; unit t57
script t57 develop.json 'this is not json'
stub_start t57; run_loop t57
check_result t57 "bad verdict: first run" 1 ERROR
stub_stop
RUN_LIMIT_S=20 run_loop t57
check_result t57 "bad verdict: restarted" 1 ERROR
assert_eq "bad verdict: the dev was not prompted again" "1" "$(wc -l <"$(st t57)/develop.json.sent" | tr -d ' ')"
assert_contains "bad verdict: it is still reported as not JSON" "$(cat "$(st t57)/driver.err")" "develop.json"

# --- 58: a stale ACCEPT whose signature matches the diff is no licence to push -------------------------------------------------------
reset_fake; unit t58
W58="$SPACE/worktrees/t58"; export GATEOK58="$FIX/gateok-t58"; GATE_CMD='test -e "$GATEOK58"'; write_cfg
echo extra >"$W58/extra.txt"; git -C "$W58" add -A; git -C "$W58" commit -qm "x"
SIG58="$(git -C "$W58" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1)"
git -C "$W58" reset -q --hard HEAD~1
mkdir -p "$(st t58)"
printf '%s\n' "$DEV_DONE" >"$(st t58)/develop.json"; : >"$(st t58)/develop.json.sent"
printf '%s\n' "$REV_OK" >"$(st t58)/review-r2.json"; : >"$(st t58)/review-r2.json.sent"; echo "$SIG58" >"$(st t58)/review-r2.sig"
touch -t 202001010000 "$(st t58)/develop.json" "$(st t58)/develop.json.sent" "$(st t58)/review-r2.json"
touch -t 202002020000 "$(st t58)/review-r2.json.sent"   # prompted again after the verdict: the verdict is stale
script t58 review-r1.json "$REV_OK"; script t58 fix-r2.json "$DEV_DONE"; script t58 review-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "x"\ntouch "%s"\nexit 0\n' "$W58" "$W58" "$W58" "$GATEOK58" >"$FIX/scripts/t58/fix-r2.json.hook"
chmod +x "$FIX/scripts/t58/fix-r2.json.hook"
stub_start t58; run_loop t58; stub_stop
check_result t58 "stale accept" 0 READY
assert_eq "stale accept: the changed diff got its own review" "1" "$(starts_of t58-review-r2)"
unset GATEOK58; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 59: a diff the gate changed after the review is reviewed before it is pushed ------------------------------------------------------
reset_fake; unit t59
export GATEFLAG59="$FIX/gateflag-t59"
GATE_CMD='if [ ! -e "$GATEFLAG59" ]; then touch "$GATEFLAG59"; echo g >gate-made.txt; git add -A; git commit -qm "gate made this"; fi'; write_cfg
script t59 develop.json "$DEV_DONE"; script t59 review-r1.json "$REV_OK"; script t59 review-r2.json "$REV_OK"
stub_start t59; run_loop t59; stub_stop
check_result t59 "gate changes the diff" 0 READY
assert_eq "gate changes the diff: it was reviewed before the push" "1" "$(starts_of t59-review-r2)"
assert_eq "gate changes the diff: the push is the reviewed head" "$(git -C "$SPACE/worktrees/t59" rev-parse HEAD)" "$(git -C "$FIX/origin-t59.git" rev-parse refs/heads/feat-t59)"
unset GATEFLAG59; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 60: a revert to a diff the final gate rejected is not a diff to push -------------------------------------------------------------
reset_fake; unit t60
W60="$SPACE/worktrees/t60"; O60="$(git -C "$FIX/origin-t60.git" rev-parse refs/heads/feat-t60)"
export GATEOK60="$FIX/gateok-t60"; GATE_CMD='test -e "$GATEOK60"'; write_cfg
script t60 develop.json "$DEV_DONE"; script t60 review-r1.json "$REV_OK"; script t60 final-r1.json "$REV_CHANGES"
script t60 fix-r2.json "$DEV_DONE"; script t60 review-r2.json "$REV_OK"; script t60 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W60" "$W60" "$W60" >"$FIX/scripts/t60/fix-r2.json.hook"
printf '#!/bin/sh\ntouch "%s"\ngit -C "%s" revert --no-edit HEAD >/dev/null 2>&1\nexit 0\n' "$GATEOK60" "$W60" >"$FIX/scripts/t60/fix-r3.json.hook"
chmod +x "$FIX/scripts/t60"/*.hook
for _r in 3 4 5 6; do script t60 fix-r$_r.json "$DEV_DONE"; script t60 review-r$_r.json "$REV_OK"; done
stub_start t60; run_loop t60 --final-gate; stub_stop
check_result t60 "revert to a diff the final gate rejected" 2 STUCK
assert_eq "final rejected diff: nothing was pushed" "$O60" "$(git -C "$FIX/origin-t60.git" rev-parse refs/heads/feat-t60)"
assert_eq "final rejected diff: no review of the restored diff" "0" "$(starts_of t60-review-r3)"
unset GATEOK60; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 64: a gate commit that restores a diff the final gate rejected ends STUCK, not a storm of reviewers ------------------------------
reset_fake; unit t64
W64="$SPACE/worktrees/t64"; O64="$(git -C "$FIX/origin-t64.git" rev-parse refs/heads/feat-t64)"
export GATEFLAG64="$FIX/gateflag-t64"
GATE_CMD='if [ ! -e "$GATEFLAG64" ]; then touch "$GATEFLAG64"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t64 develop.json "$DEV_DONE"; script t64 review-r1.json "$REV_OK"; script t64 final-r1.json "$REV_CHANGES"
script t64 fix-r2.json "$DEV_DONE"; script t64 review-r2.json "$REV_OK"; script t64 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W64" "$W64" "$W64" >"$FIX/scripts/t64/fix-r2.json.hook"
chmod +x "$FIX/scripts/t64"/*.hook
for _r in 3 4 5 6 7 8; do script t64 fix-r$_r.json "$DEV_DONE"; script t64 review-r$_r.json "$REV_OK"; done
stub_start t64; run_loop t64 --final-gate; stub_stop
check_result t64 "gate restores a diff the final gate rejected" 2 STUCK
assert_eq "gate-restored rejected diff: nothing was pushed" "$O64" "$(git -C "$FIX/origin-t64.git" rev-parse refs/heads/feat-t64)"
assert_contains "gate-restored rejected diff: the dev is told the stage and gets its findings" "$(cat "$(st t64)/fix-r3.prompt.md")" "final-r1.json rejected"
assert_contains "gate-restored rejected diff: the dev prompt carries the findings text" "$(cat "$(st t64)/fix-r3.prompt.md")" "the bug"
assert_contains "gate-restored rejected diff: the prompt says it was not a fix" "$(cat "$(st t64)/fix-r3.prompt.md")" "not a fix of yours"
assert_eq "gate-restored rejected diff: the stage is the rejecting one" "final" "$(res t64 .stage)"
assert_eq "gate-restored rejected diff: rejected_by names the verdict" "final-r1.json" "$(res t64 .rejected_by)"
assert_contains "gate-restored rejected diff: the log says no dev fix made it" "$(cat "$(st t64)/loop.log")" "without a dev fix"
_rv=0; for _r in 3 4 5 6 7 8; do _rv=$((_rv + $(starts_of "t64-review-r$_r"))); done
assert_eq "gate-restored rejected diff: no reviewer storm (review rounds after the restore)" "0" "$_rv"
unset GATEFLAG64; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 65: the same for a spec rejection (REMOVE): the removals reach the dev ---------------------------------------------------------
reset_fake; unit t65 spec
W65="$SPACE/worktrees/t65"; O65="$(git -C "$FIX/origin-t65.git" rev-parse refs/heads/feat-t65)"
export GATEFLAG65="$FIX/gateflag-t65"
GATE_CMD='if [ ! -e "$GATEFLAG65" ]; then touch "$GATEFLAG65"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t65 develop.json "$DEV_DONE"; script t65 review-r1.json "$REV_OK"; script t65 spec-r1.json "$SPEC_RM_CODE"
script t65 fix-r2.json "$DEV_DONE"; script t65 review-r2.json "$REV_OK"; script t65 spec-r2.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W65" "$W65" "$W65" >"$FIX/scripts/t65/fix-r2.json.hook"
chmod +x "$FIX/scripts/t65"/*.hook
for _r in 3 4 5 6; do script t65 fix-r$_r.json "$DEV_DONE"; script t65 review-r$_r.json "$REV_OK"; script t65 spec-r$_r.json "$SPEC_OK"; done
stub_start t65; run_loop t65; stub_stop
check_result t65 "gate restores a diff the spec check rejected" 2 STUCK
assert_eq "gate-restored spec-rejected diff: nothing was pushed" "$O65" "$(git -C "$FIX/origin-t65.git" rev-parse refs/heads/feat-t65)"
assert_eq "gate-restored spec-rejected diff: the stage is spec" "spec" "$(res t65 .stage)"
assert_eq "gate-restored spec-rejected diff: rejected_by" "spec-r1.json" "$(res t65 .rejected_by)"
assert_contains "gate-restored spec-rejected diff: the dev gets the removal" "$(cat "$(st t65)/fix-r3.prompt.md")" "the --frobnicate flag"
assert_contains "gate-restored spec-rejected diff: and why there is no consumer" "$(cat "$(st t65)/fix-r3.prompt.md")" "the brief names no caller"
unset GATEFLAG65; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 66: after a gate-restored rejected diff the dev changes the code; the next review is told about the restore ---------------------
reset_fake; unit t66
W66="$SPACE/worktrees/t66"
export GATEFLAG66="$FIX/gateflag-t66"
GATE_CMD='if [ ! -e "$GATEFLAG66" ]; then touch "$GATEFLAG66"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t66 develop.json "$DEV_DONE"; script t66 review-r1.json "$REV_OK"; script t66 final-r1.json "$REV_CHANGES"
script t66 fix-r2.json "$DEV_DONE"; script t66 review-r2.json "$REV_OK"; script t66 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W66" "$W66" "$W66" >"$FIX/scripts/t66/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W66" "$W66" "$W66" >"$FIX/scripts/t66/fix-r3.json.hook"
chmod +x "$FIX/scripts/t66"/*.hook
script t66 fix-r3.json "$DEV_DONE"; script t66 review-r3.json "$REV_OK"; script t66 final-r3.json "$REV_OK"
stub_start t66; run_loop t66 --final-gate; stub_stop
check_result t66 "gate restores a rejected diff, the dev changes it" 0 READY
assert_contains "restore note: the next review is told the diff was restored" "$(cat "$(st t66)/review-r3.prompt.md")" "restored, by the gate or another change that is not a dev fix"
assert_contains "restore note: and gets the rejecting findings to check" "$(cat "$(st t66)/review-r3.prompt.md")" "the bug"
unset GATEFLAG66; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 61: a finalize fix that is continued after a park is waited for: its verdict (here another QUESTION) is read before anything is pushed --------
reset_fake; leak_unit t61
O61="$(git -C "$FIX/origin-t61.git" rev-parse refs/heads/feat-t61)"
script t61 develop.json "$DEV_DONE"; script t61 review-r1.json "$REV_OK"
script t61 fix-r2.json.1 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Reword how?"}'
script t61 fix-r2.json.2 '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"Which word?"}'
script t61 fix-r2.json.3 "$DEV_DONE"; reword_hook t61 fix-r2.json
script t61 review-r2.json "$REV_OK"
stub_start t61; run_loop t61
check_result t61 "continued fix: first park" 2 PARKED
printf 'Say clean.\n' >"$(st t61)/answer-1.md"
run_loop t61
check_result t61 "continued fix: the dev asks again" 2 PARKED
assert_eq "continued fix: parked on the dev's second question" "Which word?" "$(jq -r .question "$(st t61)/park.json")"
assert_eq "continued fix: nothing pushed while the dev asks" "$O61" "$(git -C "$FIX/origin-t61.git" rev-parse refs/heads/feat-t61)"
printf 'The leak word.\n' >"$(st t61)/answer-2.md"
run_loop t61; stub_stop
check_result t61 "continued fix: answered" 0 READY
CFG_EXTRA=''; write_cfg

# --- 62: a spec ACCEPT does not clear the final gate's rejection of the same diff ------------------------------------------------------
reset_fake; unit t62 spec
W62="$SPACE/worktrees/t62"; O62="$(git -C "$FIX/origin-t62.git" rev-parse refs/heads/feat-t62)"
export GATEOK62="$FIX/gateok-t62"; GATE_CMD='test -e "$GATEOK62"'; write_cfg
script t62 develop.json "$DEV_DONE"; script t62 review-r1.json "$REV_OK"; script t62 spec-r1.json "$SPEC_OK"; script t62 final-r1.json "$REV_CHANGES"
script t62 fix-r2.json "$DEV_DONE"; script t62 review-r2.json "$REV_OK"; script t62 spec-r2.json "$SPEC_OK"; script t62 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W62" "$W62" "$W62" >"$FIX/scripts/t62/fix-r2.json.hook"
printf '#!/bin/sh\ntouch "%s"\ngit -C "%s" revert --no-edit HEAD >/dev/null 2>&1\nexit 0\n' "$GATEOK62" "$W62" >"$FIX/scripts/t62/fix-r3.json.hook"
chmod +x "$FIX/scripts/t62"/*.hook
for _r in 3 4 5 6; do script t62 fix-r$_r.json "$DEV_DONE"; script t62 review-r$_r.json "$REV_OK"; script t62 spec-r$_r.json "$SPEC_OK"; script t62 final-r$_r.json "$REV_OK"; done
stub_start t62; run_loop t62 --final-gate; stub_stop
check_result t62 "spec accepted, final rejected, then a revert" 2 STUCK
assert_eq "per-stage reject: nothing was pushed" "$O62" "$(git -C "$FIX/origin-t62.git" rev-parse refs/heads/feat-t62)"
assert_eq "per-stage reject: the stage that rejected the diff is recorded" "final" "$(res t62 .stage)"
assert_contains "per-stage reject: and the log names the verdict" "$(cat "$(st t62)/loop.log")" "restored the diff that final-r1.json rejected"
assert_not_contains "per-stage reject: not the no-op wording" "$(cat "$(st t62)/loop.log")" "changed nothing after a CHANGES verdict"
unset GATEOK62; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 63: the lead's answer waits for the fix that is actually prompted, not for a fix that is replayed ----------------------------------
reset_fake; unit t63
script t63 develop.json "$DEV_DONE"; script t63 review-r1.json "$REV_CHANGES"; script t63 fix-r2.json "$DEV_DONE"
script t63 review-r2.json "$REV_CHANGES"; script t63 fix-r3.json "$DEV_DONE"; script t63 review-r3.json "$REV_OK"
printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$FIX/failmux63.on" >"$FIX/scripts/t63/review-r2.json.hook"; chmod +x "$FIX/scripts/t63/review-r2.json.hook"
export SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/failmux" FAILMUX_REAL="$SCRIPTS_DIR/ship/ship-mux" FAILMUX_FILE="$FIX/failmux63.on"
stub_start t63; run_loop t63; stub_stop
check_result t63 "failed send on fix-r3: parked" 2 PARKED
assert_eq "failed send on fix-r3: the park belongs to the fix" "fix" "$(jq -r .stage "$(st t63)/park.json")"
unset SHIP_LOOP_MUX FAILMUX_REAL FAILMUX_FILE; rm -f "$FIX/failmux63.on"
printf 'Use the second option.\n' >"$(st t63)/answer-1.md"
stub_start t63; run_loop t63; stub_stop
check_result t63 "failed send on fix-r3: answered" 0 READY
assert_contains "answer kept: the fix-r3 prompt carries the answer" "$(cat "$(st t63)/fix-r3.prompt.md" 2>/dev/null)" "Use the second option."
assert_contains "answer kept: and it reached the dev" "$(sent_to t63 t63-dev)" "Use the second option."

# --- 64: a fix round's budget is min(class, class * fix_fraction + fix_per_finding * F) --------------------------------------------------
# Class S is 0.02 min, fix_fraction 0.5: a round starts at 0.01 min. The fix never answers, so the round parks OVER-BUDGET.
revn() { jq -nc --argjson n "$1" '{verdict:"CHANGES",findings:[range($n)|{severity:"BLOCKING",file:"a.go",line:3,summary:("bug \(.)"),fix:"change it"}]}'; }
fix_budget() { # ref per_finding findings expected
  reset_fake; unit "$1"
  BUD_S=0.02 BUD_EXTRA="  fix_per_finding: $2"; write_cfg
  script "$1" develop.json "$DEV_DONE"; script "$1" review-r1.json "$(revn "$3")"
  stub_start "$1"; run_loop "$1"; stub_stop
  check_result "$1" "fix budget F=$3 per=$2" 2 OVER-BUDGET
  assert_eq "fix budget F=$3 per=$2: the stage" "fix" "$(jq -r .stage "$(st "$1")/budget-r1.json")"
  assert_eq "fix budget F=$3 per=$2: budget_min" "$4" "$(jq -r .budget_min "$(st "$1")/budget-r1.json")"
}
fix_budget t64a 0.001 1 0.011
fix_budget t64b 0.001 2 0.012
fix_budget t64c 0.001 3 0.013
fix_budget t64d 0.01 3 0.02      # 0.01 + 0.03 is capped at the class budget
fix_budget t64e 0 2 0.01         # fix_per_finding 0: the flat fraction, as before
# Text only (a failing gate after the rebase): F = 1
reset_fake; unit t64f
GATE_CMD='echo "gate says no"; exit 1'; BUD_S=0.02 BUD_EXTRA="  fix_per_finding: 0.001"; write_cfg
script t64f develop.json "$DEV_DONE"; script t64f review-r1.json "$REV_OK"
stub_start t64f; run_loop t64f; stub_stop
check_result t64f "fix budget, text only" 2 OVER-BUDGET
assert_eq "fix budget, text only: F is 1" "0.011" "$(jq -r .budget_min "$(st t64f)/budget-r1.json")"
GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; BUD_S=10 BUD_EXTRA=''; write_cfg

# --- 66F: every source of F reaches the fix round's budget ---------------------------------------------------------------------------
# Tiny scale (class 0.02 min, 0.001 per finding): the fix round that goes over budget is the first one, so budget = 0.01 + 0.001 F.
# Medium scale (class 0.4 min, 0.05 per finding: 0.2 + 0.05 F): an earlier fix round has to finish first.
fb_cfg() { BUD_S="$1" BUD_EXTRA="  fix_per_finding: $2"; write_cfg; } # class_min per_finding_min
fb_check() { # ref desc expected [budget file, default budget-r1.json]
  check_result "$1" "$2" 2 OVER-BUDGET
  assert_eq "$2: the stage" "fix" "$(jq -r .stage "$(st "$1")/${4:-budget-r1.json}")"
  assert_eq "$2: budget_min" "$3" "$(jq -r .budget_min "$(st "$1")/${4:-budget-r1.json}")"
}
findn() { jq -nc --argjson n "$1" '[range($n)|{severity:"BLOCKING",file:"docs/spec/a.md",line:1,summary:("finding \(.)"),fix:"fix it"}]'; }

# a: verify FAIL with 2 failures
reset_fake; unit t66a
CFG_EXTRA="stages:
  verify:
    instructions: notes/verify.md"; fb_cfg 0.02 0.001
script t66a develop.json "$DEV_DONE"
script t66a verify-r1.json '{"verdict":"FAIL","summary":"ran it","failures":[{"what":"one","evidence":"e1"},{"what":"two","evidence":"e2"}]}'
stub_start t66a; run_loop t66a; stub_stop
fb_check t66a "fix budget, verify failures F=2" 0.012
CFG_EXTRA=''

# b: spec check CHANGES with 2 findings
reset_fake; unit t66b spec; fb_cfg 0.02 0.001
script t66b develop.json "$DEV_DONE"; script t66b review-r1.json "$REV_OK"
script t66b spec-r1.json "$(jq -nc --argjson f "$(findn 2)" '{verdict:"CHANGES",findings:$f,gaps:[],removals:[],commits:[],gate:"green"}')"
stub_start t66b; run_loop t66b; stub_stop
fb_check t66b "fix budget, spec findings F=2" 0.012

# c: final gate CHANGES with 2 findings
reset_fake; unit t66c; fb_cfg 0.02 0.001
script t66c develop.json "$DEV_DONE"; script t66c review-r1.json "$REV_OK"
script t66c final-r1.json "$(jq -nc --argjson f "$(findn 2)" '{verdict:"CHANGES",findings:$f}')"
stub_start t66c; run_loop t66c --final-gate; stub_stop
fb_check t66c "fix budget, final findings F=2" 0.012

# d: spec-writer round: 1 resolved point + 1 checker finding + 1 code removal = 3
reset_fake; unit t66d spec; fb_cfg 0.02 0.001
script t66d develop.json "$DEV_DONE"; script t66d review-r1.json "$REV_OK"
script t66d spec-r1.json "$(jq -nc --argjson f "$(findn 1)" '{verdict:"GAP",findings:$f,gaps:[{where:"docs/spec/a.md:3",quotes:["silent"],question:"What?",operator_call:false}],removals:[{where:"pkg/x.go:10",kind:"code",what:"the flag",why_no_consumer:"no caller"}],commits:[],gate:"green"}')"
script t66d specwriter-r1.json "$SW_OK"
stub_start t66d; run_loop t66d; stub_stop
fb_check t66d "fix budget, spec writer round F=3" 0.013

# e: a post-accept review CHANGES with 2 findings, after a finalize fix that finished (medium scale)
reset_fake; leak_unit t66e; fb_cfg 0.4 0.05
script t66e develop.json "$DEV_DONE"; script t66e review-r1.json "$REV_OK"
script t66e fix-r2.json "$DEV_DONE"; reword_hook t66e fix-r2.json
script t66e review-r2.json "$(jq -nc --argjson f "$(findn 2)" '{verdict:"CHANGES",findings:$f}')"
stub_start t66e; run_loop t66e; stub_stop
fb_check t66e "fix budget, post-accept review F=2" 0.3
CFG_EXTRA=''; write_cfg

# f: the gate restores a diff the final gate rejected (2 findings): the round is text, F = 1, not 2
reset_fake; unit t66f
W66="$SPACE/worktrees/t66f"; export GATEFLAG66="$FIX/gateflag-t66f"
GATE_CMD='if [ ! -e "$GATEFLAG66" ]; then touch "$GATEFLAG66"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; fb_cfg 0.4 0.05
script t66f develop.json "$DEV_DONE"; script t66f review-r1.json "$REV_OK"
script t66f final-r1.json "$(jq -nc --argjson f "$(findn 2)" '{verdict:"CHANGES",findings:$f}')"
script t66f fix-r2.json "$DEV_DONE"; script t66f review-r2.json "$REV_OK"; script t66f final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W66" "$W66" "$W66" >"$FIX/scripts/t66f/fix-r2.json.hook"
chmod +x "$FIX/scripts/t66f"/*.hook
stub_start t66f; run_loop t66f --final-gate; stub_stop
fb_check t66f "fix budget, gate-restored diff F=1" 0.25
unset GATEFLAG66; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'

# g: a finalize fix round goes over budget and is extended: the resumed round keeps the count saved with it
reset_fake; unit t66g
GATE_CMD='echo "gate says no"; exit 1'; fb_cfg 0.6 0.05   # 0.3 + 0.05 F: 0.35 for the text round
script t66g develop.json "$DEV_DONE"; script t66g review-r1.json "$REV_OK"
stub_start t66g; run_loop t66g
fb_check t66g "fix budget, finalize fix round" 0.35
assert_eq "finalize fix: fix-r2.n holds the text round's count" "1" "$(cat "$(st t66g)/fix-r2.n")"
printf '3\n' >"$(st t66g)/fix-r2.n"; printf '0.05\n' >"$(st t66g)/extend"   # as if the round had answered 3 findings
run_loop t66g; stub_stop
fb_check t66g "fix budget, finalize fix round resumed with extend" 0.5 budget-r2.json   # 0.3 + 0.05 * 3 + 0.05
assert_eq "finalize fix: the resumed round rewrote fix-r2.n from the saved count" "3" "$(cat "$(st t66g)/fix-r2.n")"
GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; BUD_S=10 BUD_EXTRA=''; write_cfg

# --- 21: the script's own constraints --------------------------------------------------------------------------------------------------------------
assert_eq "C-1: no husk, forge, user path, host or model literal in ship-loop" "" "$(grep -niE 'husk|forge|/work/lab|/Users/|Users/|gopls|dolphin|sonnet|opus|haiku|fable' "$LOOP")"
assert_eq "C-2: no messaging, Monitor or watchdog in ship-loop" "" "$(grep -nE 'SendMessage|claude-link|hyper msg|Monitor|stall' "$LOOP")"
assert_eq "C-11: ship-loop does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$LOOP")"
assert_eq "AC-6: the plain spec grep is empty too" "" "$(grep -iE 'husk|forge|/work/lab|Users/' "$LOOP")"
assert_ok "bash -n passes" bash -n "$LOOP"
assert_ok "the stub agent passes bash -n" bash -n "$STUB"

stub_stop
finish
