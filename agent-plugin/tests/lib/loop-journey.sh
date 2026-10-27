#!/usr/bin/env bash
# shellcheck disable=SC2034  # globals are read by the test files that source this one
# Shared harness for the ship-loop tests (journeys and function tests): the unit-space fixtures, the
# stub agent, the bounded driver run and the result checks, extracted unchanged from
# test-t-ship-loop.sh. Source it after helpers.sh (it needs $FIX, $SCRIPTS_DIR, $TESTS_DIR and the
# assert_* helpers) and after `set +eu; set +o pipefail`.


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

# loop_fn <name>... — define the named functions of ship-loop here. The script has a main guard, so it is sourced (in a
# subshell, once per shell) and its function text kept; each call evals the named ones out of that text. Calling it
# again for a name brings back the real function after a test replaced it with a stub.
LOOP_DECLS=""
loop_fn() {
  # shellcheck disable=SC1090  # $LOOP is the ship-loop under test
  [[ -n "$LOOP_DECLS" ]] || LOOP_DECLS="$( set +eu; set +o pipefail; source "$LOOP"; declare -f )"
  eval "$(awk -v names="$*" '
    BEGIN { n = split(names, a, " "); for (i = 1; i <= n; i++) want[a[i]] = 1 }
    !act && match($0, /^[a-z_0-9]+ \(\) $/) {
      nm = substr($0, 1, RLENGTH - 4)
      if (!(nm in want)) next
      print; act = 1; seen[nm] = 1; next
    }
    act { print; if ($0 ~ /^\}/) act = 0 }
    END { for (k in want) if (!(k in seen)) print "fail \"loop_fn: " k " is not defined in ship-loop\"" }' <<<"$LOOP_DECLS")"
}
