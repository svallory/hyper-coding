#!/usr/bin/env bash
# shellcheck disable=SC2034  # globals read by the lifted helpers
# Row T (ship failover), journeys. HOME is a temp dir (helpers.sh) and every quota file lives under $FIX, so the real
# ~/.cache is never touched. Each case here needs a whole unit run (the driver, the fake multiplexer, a stub agent);
# everything that one function can decide (pick_model, the quota tap, the limit patterns, limit_word,
# limit_hit, failover_on_limit, write_status, scrub_status, stamp_failovers, the budget clock across a
# failover) is in test-t-ship-failover-fn.sh, and ship_lock / ship_limit_record in test-t-ship-lock.sh.
#
# Journeys (6 driver runs):
#   f1  preflight swap     the same 97% snapshot sends the dev (and the reviewer) to pi; two preflight failovers
#   f2  LIMIT park         a list with nothing usable parks LIMIT (exit 2) with resets_at; f2b the unit resumes
#                          once the quota is back
#   r1  reactive failover  a limit seen on the dev's screen: recorded, agent stopped, STATUS.md written, the stage
#                          restarted on the next model with the takeover prompt, READY with one failover
#   r2  nothing to fail    over to: the unit parks LIMIT with resets_at from the snapshot
#   r25 a limit inside a blocked dialog fails over (an account limit), no DIALOG park

REAL_HOME="$HOME"
_mt() { if [[ -e "$1" ]]; then stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; else echo absent; fi; }
REAL_BEFORE="$(_mt "$REAL_HOME/.cache/hyper")"

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
LOOP="$SCRIPTS_DIR/ship/ship-loop"
STUB="$TESTS_DIR/fixtures/ship/stub-agent"
SCHEMAS_DIR="$SCRIPTS_DIR/ship/schemas"
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"

export SHIP_QUOTA_DIR="$FIX/quota"
unset CLAUDE_CONFIG_DIR SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
mkdir -p "$SHIP_QUOTA_DIR"

ts() { echo $(( $(date +%s) + $1 )); }                           # epoch seconds, offset from now
iso() { jq -nr --argjson t "$(ts "$1")" '$t | todate'; }          # ISO-8601 UTC, offset from now
# snap <five pct|-> <seven pct|-> <age s> <resets in s> [account] — an account snapshot, written as the tap does.
snap() {
  local acct="${5:-default}"
  jq -nc --arg a "$acct" --arg at "$(iso "-$3")" --arg f "$1" --arg s "$2" --argjson r "$(ts "$4")" '
    def w($k; $p): if $p == "-" then {} else {($k): {used_percentage: ($p | tonumber), resets_at: $r}} end;
    {account: $a, at: $at, rate_limits: (w("five_hour"; $f) + w("seven_day"; $s))}' >"$SHIP_QUOTA_DIR/claude-$acct.json"
}
no_quota() { rm -f "$SHIP_QUOTA_DIR"/*.json; }

SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/notes" "$HOME/.claude" "$FIX/bin" "$FIX/scripts"
PROJECT="$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief.md"
printf '# Brief\n\nDo the thing.\n' >"$BRIEF"
printf '{"enabledPlugins":{}}\n' >"$HOME/.claude/settings.json"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_POLL_S=0.05
export SHIP_IDLE_GRACE_S=3600
for c in claude pi gh; do printf '#!/bin/sh\nexit 0\n' >"$FIX/bin/$c"; chmod +x "$FIX/bin/$c"; done
export PATH="$FIX/bin:$PATH"
unset STATE   # the driver sets its own

write_cfg() { # dev model list (YAML flow) [review model list]
  cat >"$PROJECT" <<EOF
mux: fake
gate: 'true'
budgets:
  S: 10
models:
  dev: $1
  review: ${2:-[opus, prov/reviewer]}
roles:
  dev:
    pi_skills: []
    pi_extensions: []
  review:
    pi_skills: []
    pi_extensions: []
EOF
}
DEV_DONE='{"status":"DONE","pr":7,"head":"abc1234","summary":"done, gate green"}'
REV_OK='{"verdict":"ACCEPT","findings":[]}'
unit() {
  local ref="$1" w="$SPACE/worktrees/$1" o="$FIX/origin-$1.git"
  git init -q --bare "$o"
  git clone -q "$o" "$w" 2>/dev/null
  echo base >"$w/f.txt"; git -C "$w" add -A; git -C "$w" commit -qm "base"; git -C "$w" push -q -u origin main 2>/dev/null
  git -C "$w" checkout -q -b "feat-$ref"
  echo change >"$w/feat.txt"; git -C "$w" add -A; git -C "$w" commit -qm "feat: the change"
  git -C "$w" push -q -u origin "feat-$ref" 2>/dev/null
  mkdir -p "$FIX/scripts/$ref"
  printf '%s\n' "$DEV_DONE" >"$FIX/scripts/$ref/develop.json"
  printf '%s\n' "$REV_OK" >"$FIX/scripts/$ref/review-r1.json"
}
STUB_PID=""
stub_start() { bash "$STUB" "$SPACE/notes/loops/$1" "$FIX/scripts/$1" >/dev/null 2>&1 & STUB_PID=$!; }
stub_stop() { [[ -z "$STUB_PID" ]] || { kill "$STUB_PID" 2>/dev/null; wait "$STUB_PID" 2>/dev/null; STUB_PID=""; }; }
RC="" OUT=""
# Every driver run is bounded, so a mutant that never finishes fails (124) instead of hanging the suite.
TMO=()
if command -v timeout >/dev/null 2>&1; then TMO=(timeout 30); elif command -v gtimeout >/dev/null 2>&1; then TMO=(gtimeout 30); fi
run_loop() {
  local ref="$1"; shift
  OUT="$("${TMO[@]}" bash "$LOOP" --ref "$ref" --worktree "$SPACE/worktrees/$ref" --branch "feat-$ref" --brief "$BRIEF" --class S "$@" 2>"$FIX/err-$ref.log")"
  RC=$?
}
st() { echo "$SPACE/notes/loops/$1"; }
starts_of() { jq -s --arg n "$1" '[.[] | select(.verb == "start" and (.args | index($n)))] | length' "$SHIP_MUX_FAKE_LOG"; }
dump() { echo "# driver.err: $(cat "$(st "$1")/driver.err" 2>/dev/null)" >&2; tail -n 15 "$(st "$1")/loop.log" 2>/dev/null | sed 's/^/# loop.log: /' >&2; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG"; }

# 97% seven_day: the dev goes to pi, two preflight failovers are logged, the unit is READY.
reset_fake; unit f1
write_cfg '[sonnet, opus, zai/glm-5.3]'
snap - 97 60 3600
stub_start f1; run_loop f1; stub_stop
[[ "$RC" == 0 ]] || dump f1
assert_eq "driver, 97% seven_day: the unit is READY (exit 0)" 0 "$RC"
assert_eq "driver: result.json status READY" READY "$(jq -r .status "$(st f1)/result.json")"
_START="$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep f1-dev | head -n 1)"
assert_contains "driver: the dev starts on the pi entry" "$_START" 'zai/glm-5.3'
assert_contains "driver: as a pi agent" "$_START" '"pi"'
assert_eq "driver: the dev was started once" 1 "$(starts_of f1-dev)"
assert_eq "driver: agents/<name>.json records the pi model" zai/glm-5.3 "$(jq -r .model "$(st f1)/agents/f1-dev.json")"
assert_eq "driver: two preflight failovers for the dev" 2 "$(jq -s '[.[] | select(.agent == "f1-dev")] | length' "$(st f1)"/failover-*.json)"
assert_eq "driver: failover-1 sonnet -> opus" "sonnet opus develop" "$(jq -r '"\(.from) \(.to) \(.stage)"' "$(st f1)/failover-1.json")"
assert_eq "driver: failover-2 opus -> pi" "opus zai/glm-5.3 develop" "$(jq -r '"\(.from) \(.to) \(.stage)"' "$(st f1)/failover-2.json")"
assert_eq "driver: every failover says preflight" "preflight" "$(jq -r '.reason' "$(st f1)"/failover-*.json | sort -u)"
assert_eq "driver: the reviewer's start skipped opus too (one more failover) and used its pi entry" "1 prov/reviewer" \
  "$(jq -s '[.[] | select(.agent == "f1-review-r1")] | length' "$(st f1)"/failover-*.json) $(jq -r .model "$(st f1)/agents/f1-review-r1.json")"
assert_eq "driver: the reviewer's failover names its stage and round" "review 1" \
  "$(jq -rs '[.[] | select(.agent == "f1-review-r1")][0] | "\(.stage) \(.round)"' "$(st f1)"/failover-*.json)"
assert_ok "driver: the failover files match the schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$(st f1)/failover-2.json"
assert_eq "driver: loop.log has two FAILOVER lines for the dev" 2 "$(grep -c 'FAILOVER preflight develop' "$(st f1)/loop.log")"

# A dev list with nothing usable (the same snapshot) parks LIMIT, exit 2, resets_at set.
reset_fake; unit f2
write_cfg '[sonnet]'
snap - 97 60 3600
stub_start f2; run_loop f2; stub_stop
assert_eq "driver, every dev entry skipped: exit 2" 2 "$RC"
assert_eq "driver: result.json status PARKED" PARKED "$(jq -r .status "$(st f2)/result.json")"
assert_eq "driver: park.json status LIMIT" LIMIT "$(jq -r .status "$(st f2)/park.json")"
assert_eq "driver: park.json stage" develop "$(jq -r .stage "$(st f2)/park.json")"
assert_eq "driver: park.json names the agent that did not start" f2-dev "$(jq -r .agent "$(st f2)/park.json")"
assert_eq "driver: park.json carries resets_at (ISO)" "$(jq -nr --argjson t "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" '$t | todate')" \
  "$(jq -r .resets_at "$(st f2)/park.json")"
assert_ok "driver: park.json matches the park schema" validate_verdict "$SCHEMAS_DIR/park.json" "$(st f2)/park.json"
assert_eq "driver: no agent was started" 0 "$(starts_of f2-dev)"
assert_eq "driver: one failover file for the one skipped entry" 1 "$(ls "$(st f2)"/failover-*.json | wc -l | tr -d ' ')"
assert_eq "driver: stdout carries the park" LIMIT "$(jq -r .park.status <<<"$OUT")"

# Resume once the quota is back (the snapshot is gone): the same unit starts and finishes.
no_quota
stub_start f2; run_loop f2; stub_stop
[[ "$RC" == 0 ]] || dump f2
assert_eq "driver, resumed with the quota back: READY" 0 "$RC"
assert_eq "driver: the dev started on the first model this time" 1 "$(starts_of f2-dev)"
assert_contains "driver: on sonnet" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep f2-dev | head -n 1)" '"sonnet"'

export SHIP_FAILOVER_STOP_MS=100
export SHIP_SUMMARY_TIMEOUT_S=60
export LIMITMUX_REAL="$SCRIPTS_DIR/ship/ship-mux" SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/limitmux"

# `claude -p` stub (the summariser): records its arguments and prints a valid note.
cat >"$FIX/bin/claude" <<'STUBEND'
#!/bin/sh
case " $* " in *" -p "*) ;; *) exit 0 ;; esac
echo "$*" >>"$FIX_DIR/claude-p.args"
cat >>"$FIX_DIR/claude-p.stdin"
printf 'Here is the note.\n\n## Done\nWrote the parser.\n\n## In progress\nHalf of the tests.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
STUBEND
chmod +x "$FIX/bin/claude"
export FIX_DIR="$FIX"
# A fixed session id, so the test can put a transcript where the driver will look for it.
SESSION_ID=11111111-2222-3333-4444-555555555555
printf '#!/bin/sh\necho %s\n' "$SESSION_ID" >"$FIX/bin/uuidgen"; chmod +x "$FIX/bin/uuidgen"
mkdir -p "$HOME/.claude/projects/proj"
printf '{"type":"user"}\n' >"$HOME/.claude/projects/proj/$SESSION_ID.jsonl"

rwrite_cfg() { write_cfg "$1"; } # dev list; the default limit patterns apply
# runit <ref> — a unit whose dev does not answer until it is told to (see answer_after_takeover); the reviewer does.
runit() {
  unit "$1"
  rm -f "$FIX/scripts/$1/develop.json"
}
GATE_PID=""
# answer_after_takeover <ref> <verdict file> <json> — the stub agent may answer <file> once some agent has been
# sent the takeover prompt (polls for the condition; gives up after about 15 s).
answer_after_takeover() {
  (
    n=0
    while [[ $n -lt 300 ]]; do
      if grep -qs 'taking over' "$SHIP_MUX_FAKE_DIR"/sent/* 2>/dev/null; then
        printf '%s\n' "$3" >"$FIX/scripts/$1/$2.1.tmp" && mv "$FIX/scripts/$1/$2.1.tmp" "$FIX/scripts/$1/$2.1"
        exit 0
      fi
      n=$((n + 1)); sleep 0.05
    done
  ) &
  GATE_PID=$!
}
gate_stop() { [[ -z "$GATE_PID" ]] || { kill "$GATE_PID" 2>/dev/null; wait "$GATE_PID" 2>/dev/null; GATE_PID=""; }; }
# limit_screen <agent name> <text> — what the agent's pane shows
limit_screen() { mkdir -p "$SHIP_MUX_FAKE_DIR/after-send"; printf '%s\n' "$2" >"$SHIP_MUX_FAKE_DIR/after-send/$1"; }
# blocked_screen <agent name> <text> — the same, but the agent is also reported as blocked (a dialog)
blocked_screen() { limit_screen "$1" "$2"; mkdir -p "$SHIP_MUX_FAKE_DIR/after-send-status"; echo blocked >"$SHIP_MUX_FAKE_DIR/after-send-status/$1"; }
sent_all() { cat "$SHIP_MUX_FAKE_DIR/sent/$(jq -r .id "$(st "$1")/agents/$2.json")" 2>/dev/null; }
# dev_fcount_of <ref> — failover files of the dev only (an account limit also makes the reviewer skip its claude entry)
dev_fcount_of() { jq -s --arg a "$1-dev" '[.[] | select(.agent == $a)] | length' "$(st "$1")"/failover-*.json 2>/dev/null || echo 0; }
fcount_of() { ls "$(st "$1")"/failover-*.json 2>/dev/null | wc -l | tr -d ' '; }
r_run() { # ref — gate, stub, driver, with a dump on failure
  stub_start "$1"; run_loop "$1"; stub_stop; gate_stop
  [[ "$RC" == "${2:-0}" ]] || dump "$1"
}
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"

# (1) The dev on [sonnet, zai/glm-5.3] hits a Sonnet limit: STATUS.md has the four sections, the pi agent is given the
# takeover prompt with STATUS.md and the brief, the unit ends READY with one failover.
reset_fake; no_quota; runit r1
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r1-dev "You've hit your Sonnet limit · resets 4pm"
answer_after_takeover r1 develop.json "$DEV_DONE"
r_run r1
assert_eq "(1) reactive: READY" 0 "$RC"
assert_eq "(1) result.json status" READY "$(jq -r .status "$(st r1)/result.json")"
assert_eq "(1) result.json failovers is 1" 1 "$(jq -r .failovers "$(st r1)/result.json")"
assert_ok "(1) result.json matches the schema" validate_verdict "$SCHEMAS_DIR/result.json" "$(st r1)/result.json"
assert_eq "(1) one failover file" 1 "$(fcount_of r1)"
F1="$(st r1)/failover-1.json"
assert_ok "(1) failover-1 matches the failover schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$F1"
assert_eq "(1) failover-1: reason, stage, agent" "limit develop r1-dev" "$(jq -r '"\(.reason) \(.stage) \(.agent)"' "$F1")"
assert_eq "(1) failover-1: from sonnet to the pi entry" "sonnet zai/glm-5.3" "$(jq -r '"\(.from) \(.to)"' "$F1")"
assert_eq "(1) failover-1: a named model is a model limit" model "$(jq -r .limit_kind "$F1")"
assert_contains "(1) failover-1: the matched screen text" "$(jq -r .matched "$F1")" "Sonnet limit"
assert_eq "(1) failover-1: the summariser" haiku "$(jq -r .summarizer "$F1")"
assert_eq "(1) failover-1: names STATUS.md" "$(st r1)/STATUS.md" "$(jq -r .status_md "$F1")"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do
  assert_contains "(1) STATUS.md has '$sec'" "$(cat "$(st r1)/STATUS.md")" "$sec"
done
assert_eq "(1) STATUS.md starts at the first section (the summariser's preface is dropped)" "## Done" "$(head -n 1 "$(st r1)/STATUS.md")"
assert_eq "(1) the summariser ran headless on haiku" 1 "$(grep -c -e '-p --model haiku' "$FIX/claude-p.args")"
assert_eq "(1) the dev was started twice" 2 "$(starts_of r1-dev)"
assert_eq "(1) the second start is the pi entry" "zai/glm-5.3" "$(jq -r .model "$(st r1)/agents/r1-dev.json")"
assert_eq "(1) as a pi agent" pi "$(jq -r .harness "$(st r1)/agents/r1-dev.json")"
TK="$(sent_all r1 r1-dev)"
assert_eq "(1) the pi agent got exactly one prompt" 1 "$(grep -c 'taking over' <<<"$TK")"
assert_contains "(1) the takeover prompt names STATUS.md" "$TK" "$(st r1)/STATUS.md"
assert_contains "(1) the takeover prompt names the brief" "$TK" "$BRIEF"
assert_contains "(1) the takeover prompt carries the stage prompt (the verdict file to write)" "$TK" "$(st r1)/develop.json"
assert_contains "(1) the takeover prompt says who replaced whom" "$TK" "sonnet was replaced by zai/glm-5.3"
OLD="$(grep -l '/exit' "$SHIP_MUX_FAKE_DIR"/sent/* | head -n 1)"
assert_contains "(1) the limited claude agent got esc" "$(cat "$OLD")" "<keys:esc>"
assert_contains "(1) the limited claude agent got /exit" "$(cat "$OLD")" "/exit"
assert_eq "(1) the stage's prompt marker was cleared on replacement: one line" 1 "$(wc -l <"$(st r1)/develop.json.sent" | tr -d ' ')"
assert_eq "(1) develop.json carries failovers" 1 "$(jq -r .failovers "$(st r1)/develop.json")"
assert_eq "(1) the reviewer's verdict carries 0" 0 "$(jq -r '.failovers // "none"' "$(st r1)/review-r1.json")"
assert_eq "(1) loop.log has one FAILOVER limit line" 1 "$(grep -c 'FAILOVER limit develop' "$(st r1)/loop.log")"
assert_eq "(1) limited.json: the model, not the account" "sonnet" "$(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) limited.json: no account entry" null "$(jq -r '.accounts // null' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) limited.json: until is in the future (cooldown)" true "$(jq -r --argjson n "$(date +%s)" '.models.sonnet.until > $n' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) the limited agent's pane was closed: one live agent named r1-dev" r1-dev \
  "$(jq -rs '[.[] | select(.kind == "agent") | .name] | join(" ")' "$SHIP_MUX_FAKE_DIR"/state/*.json)"
assert_eq "(1) the PR branch was pushed after the failover" "$(git -C "$SPACE/worktrees/r1" rev-parse HEAD)" "$(git -C "$FIX/origin-r1.git" rev-parse refs/heads/feat-r1)"

# (2) Only [sonnet]: the list is exhausted, the unit parks LIMIT (exit 2) with resets_at from the snapshot.
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"
reset_fake; no_quota; runit r2
rwrite_cfg '[sonnet]'
snap 40 94 60 7200   # below the 95% threshold: preflight starts the dev; the limit hits later
limit_screen r2-dev "You've hit your limit · resets 4pm"
r_run r2 2
assert_eq "(2) exit 2" 2 "$RC"
assert_eq "(2) result.json status PARKED" PARKED "$(jq -r .status "$(st r2)/result.json")"
assert_eq "(2) park.json status LIMIT" LIMIT "$(jq -r .status "$(st r2)/park.json")"
assert_eq "(2) park.json names the stage and the agent" "develop r2-dev" "$(jq -r '"\(.stage) \(.agent)"' "$(st r2)/park.json")"
assert_eq "(2) park.json resets_at is the snapshot's (the fullest window)" \
  "$(jq -nr --argjson t "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" '$t | todate')" \
  "$(jq -r .resets_at "$(st r2)/park.json")"
assert_ok "(2) park.json matches the park schema" validate_verdict "$SCHEMAS_DIR/park.json" "$(st r2)/park.json"
assert_eq "(2) a plain limit is an account limit in limited.json, until = resets_at" \
  "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$(jq -r '.accounts.default.until' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(2) the dev was started once and left alone (no keys sent)" "1 0" "$(starts_of r2-dev) $(cat "$SHIP_MUX_FAKE_DIR/sent/$(jq -r .id "$(st r2)/agents/r2-dev.json")" 2>/dev/null | grep -c keys)"
assert_eq "(2) no failover file, no summariser" "0 absent" "$(fcount_of r2) $([[ -e "$FIX/claude-p.args" ]] && echo present || echo absent)"
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"

# (25) The exact line Claude Code prints (indented, a glyph, a no-break space) in the blocked dialog: it fails over as an
# account limit and is not parked as a DIALOG.
NB="$(printf '\302\240')"   # a no-break space
REAL_CL="  ⎿ ${NB}You've hit your weekly limit · resets Oct 24, 4pm (America/Sao_Paulo)"
reset_fake; no_quota; runit r25
rwrite_cfg '[sonnet, zai/glm-5.3]'
blocked_screen r25-dev "$REAL_CL

What do you want to do?
❯ 1. Stop and wait for limit to reset
  2. Upgrade your plan"
answer_after_takeover r25 develop.json "$DEV_DONE"
r_run r25
assert_eq "(25) blocked dialog: READY after one account failover" "0 1 account" "$RC $(dev_fcount_of r25) $(jq -r .limit_kind "$(st r25)/failover-1.json")"
assert_eq "(25) no DIALOG park" absent "$([[ -e "$(st r25)/park.json" ]] && echo present || echo absent)"

no_quota
unset SHIP_LOOP_MUX LIMITMUX_REAL FIX_DIR SHIP_FAILOVER_STOP_MS SHIP_SUMMARY_TIMEOUT_S
rm -f "$FIX/bin/uuidgen"

REAL_AFTER="$(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.cache/hyper is unchanged" "$REAL_BEFORE" "$REAL_AFTER"
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac

stub_stop
finish
