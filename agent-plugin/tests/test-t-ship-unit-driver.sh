#!/usr/bin/env bash
# Row T (ship-unit + the real ship-loop) — the pieces the stub-driver tests cannot show:
# ship-loop keeps ship-unit's files when it archives an earlier run, a parked unit resumes
# to READY, and slots count a real driver. The multiplexer is mux/fake, the agents are
# tests/fixtures/ship/stub-agent, wt is a stub; no real multiplexer, claude, pi, ssh or
# network is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
UNIT="$SHIP_DIR/ship-unit"
STUB="$TESTS_DIR/fixtures/ship/stub-agent"

SPACE="$FIX/proj"
G="$SPACE/.git"
REMOTE="$FIX/remote.git"
export FIX
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake" SHIP_MUX_FAKE_LOG="$FIX/fake.log" SHIP_MUX_TEST=1
export SHIP_UNIT_POLL_S=0.1 SHIP_POLL_S=0.05 SHIP_IDLE_GRACE_S=3600
export STUB_G="$G" STUB_SPACE="$SPACE"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS SHIP_LOOP_BIN SHIP_CONFIG_FILE

git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$FIX/seed" 2>/dev/null
echo base > "$FIX/seed/base.txt"
git -C "$FIX/seed" add base.txt
git -C "$FIX/seed" commit -q -m base
git -C "$FIX/seed" branch -M main
git -C "$FIX/seed" push -q origin main
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main
git clone -q --bare "$REMOTE" "$G"
git -C "$G" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git -C "$G" fetch -q origin
mkdir -p "$SPACE/worktrees" "$SPACE/.hyper" "$SPACE/notes/loops" "$HOME/.claude" "$FIX/bin"
git -C "$G" worktree add -q "$SPACE/worktrees/main" main
printf '{"enabledPlugins":{}}\n' >"$HOME/.claude/settings.json"
printf 'mux: fake\ngate: "true"\nhosts:\n  local:\n    slots: 1\n' > "$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief.md"
echo "# brief" > "$BRIEF"
for c in claude pi gh; do printf '#!/bin/sh\nexit 0\n' >"$FIX/bin/$c"; chmod +x "$FIX/bin/$c"; done
# wt: the new worktree starts one commit ahead of main, as a dev's would.
cat > "$FIX/bin/wt" <<'STUB'
#!/usr/bin/env bash
br="${*: -1}"
git -C "$STUB_G" worktree add -q -b "$br" "$STUB_SPACE/worktrees/$br" main || exit 1
echo change > "$STUB_SPACE/worktrees/$br/feat.txt"
git -C "$STUB_SPACE/worktrees/$br" add feat.txt
git -C "$STUB_SPACE/worktrees/$br" -c user.name=t -c user.email=t@t commit -q -m "feat: the change"
STUB
chmod +x "$FIX/bin/wt"
export PATH="$FIX/bin:$PATH"

(
  n=0
  while :; do
    total=0
    [[ -f "$SHIP_MUX_FAKE_LOG" ]] && total="$(wc -l < "$SHIP_MUX_FAKE_LOG" | tr -d ' ')"
    while [[ $n -lt $total ]]; do
      n=$((n + 1))
      line="$(sed -n "${n}p" "$SHIP_MUX_FAKE_LOG")"
      if [[ "$(jq -r .verb <<<"$line")" == run ]]; then
        bash -c "$(jq -r '.args[-1]' <<<"$line")" >> "$FIX/pane.out" 2>&1 &
      fi
    done
    sleep 0.05
  done
) &
PANES=$!
STUBS=""
trap 'kill $PANES $STUBS 2>/dev/null' EXIT

unit() { bash "$UNIT" "$@" 2>"$FIX/unit.err" >"$FIX/unit.out"; echo $?; }
loops() { echo "$SPACE/notes/loops/$1"; }
script_dir() { mkdir -p "$FIX/scripts/$1"; }
script() { printf '%s\n' "$3" > "$FIX/scripts/$1/$2"; }
agent() { bash "$STUB" "$(loops "$1")" "$FIX/scripts/$1" >/dev/null 2>&1 & STUBS="$STUBS $!"; }
wait_for() { # timeout-seconds command...
  local t="$1" i=0; shift
  while ! "$@" 2>/dev/null; do
    sleep 0.1; i=$((i + 1))
    [[ $i -lt $((t * 10)) ]] || return 1
  done
}
has_pid() { [[ -s "$(loops "$1")/driver.pid" ]]; }

DEV_Q='{"status":"QUESTION","pr":null,"head":"","summary":"s","question":"which helper?"}'
DEV_DONE='{"status":"DONE","pr":7,"head":"abc1234","summary":"done, gate green"}'
REV_OK='{"verdict":"ACCEPT","findings":[]}'

# 1: run -> park -> resume -> READY, through ship-loop's archive of the earlier run ------------
script_dir r1
printf '%s\n' "$DEV_Q" > "$FIX/scripts/r1/develop.json.1"
printf '%s\n' "$DEV_DONE" > "$FIX/scripts/r1/develop.json.2"
script r1 review-r1.json "$REV_OK"
mkdir -p "$(loops r1)"
agent r1
assert_eq "run: the dev asks a question, the unit parks (2)" "2" "$(unit run r1 --brief "$BRIEF" --class S)"
D="$(loops r1)"
assert_eq "parked: result.json says PARKED" "PARKED" "$(jq -r .status "$D/result.json")"
assert_eq "parked: driver.exit holds 2" "2" "$(cat "$D/driver.exit")"
echo "use the helper in lib/" > "$FIX/answer.md"
rc="$(unit resume r1 --answer "$FIX/answer.md")"
assert_eq "resume --answer: the unit goes on to READY (0)" "0" "$rc"
assert_eq "...result.json says READY" "READY" "$(jq -r .status "$D/result.json")"
assert_eq "...the PR number came through" "7" "$(jq -r .pr "$D/result.json")"
assert_eq "driver.exit holds 0 after the resume" "0" "$(cat "$D/driver.exit")"
assert_eq "unit.json is still in the state dir" "yes" "$([[ -f "$D/unit.json" ]] && echo yes)"
assert_eq "...nothing was archived" "" "$(cd "$D" && ls run-*/unit.json run-*/driver.exit 2>/dev/null)"
assert_eq "answer-1.md was kept for the dev" "use the helper in lib/" "$(cat "$D/answer-1.md")"
bash "$UNIT" list > "$FIX/list.out" 2>&1
assert_contains "list still shows the unit, READY" "$(grep '^r1 ' "$FIX/list.out")" "READY"
assert_eq "wait on the finished unit returns 0" "0" "$(unit wait r1)"

# 2: slots with a real driver ---------------------------------------------------------------------
script_dir r2
mkdir -p "$(loops r2)"
agent r2     # no develop.json yet: the dev "is still working"
( bash "$UNIT" run r2 --brief "$BRIEF" --class S >"$FIX/r2.out" 2>"$FIX/r2.err"; echo $? > "$FIX/r2.rc" ) &
assert_eq "the real driver of r2 is up" "yes" "$(wait_for 60 has_pid r2 && echo yes)"
script_dir r3
# a refusal is immediate: if it is not, r3 got a driver, so kill it and fail instead of hanging
( bash "$UNIT" run r3 --brief "$BRIEF" --class S 2>"$FIX/unit.err" >"$FIX/unit.out"; echo $? > "$FIX/r3.rc" ) &
R3=$!
wait_for 20 test -s "$FIX/r3.rc" || { kill "$R3" 2>/dev/null; pkill -f "ship-loop.*r3" 2>/dev/null; echo "none (still running)" > "$FIX/r3.rc"; }
rc="$(cat "$FIX/r3.rc")"
assert_eq "slots=1: a second run is refused while r2's driver runs (3)" "3" "$rc"
assert_contains "...naming the host and r2" "$(cat "$FIX/unit.err")" "host local is full: 1 of 1 slots in use (r2)"
assert_eq "...no worktree for r3" "" "$([[ -e "$SPACE/worktrees/r3" ]] && echo r3)"
assert_contains "list shows r2 RUNNING" "$(bash "$UNIT" list | grep '^r2 ')" "RUNNING"
printf '%s\n' "$DEV_DONE" > "$FIX/scripts/r2/develop.json"
script r2 review-r1.json "$REV_OK"
assert_eq "r2 finishes" "yes" "$(wait_for 90 test -s "$FIX/r2.rc" && echo yes)"
assert_eq "...READY (0)" "0" "$(cat "$FIX/r2.rc")"
finish
