#!/usr/bin/env bash
# Row T (ship-mux) — the dispatcher scripts/ship/ship-mux against mux/fake: the
# shared backend contract, the ownership record, group close rules, the fake's
# call log and scripted answers, and the unknown-backend error.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
source "$TESTS_DIR/lib/mux-contract.sh"
set +eu
set +o pipefail

MUX_BIN="$SCRIPTS_DIR/ship/ship-mux"
SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
PROJECT="$SPACE/.hyper/ship.yml"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
printf 'mux: fake\n' > "$PROJECT"   # no gate: ship-mux must not need one

mux() { (cd "$SPACE/worktrees/wt" && bash "$MUX_BIN" "$@" 2>/dev/null); }
mux_rc() { (cd "$SPACE/worktrees/wt" && bash "$MUX_BIN" "$@" >/dev/null 2>&1); echo $?; }
# shellcheck disable=SC2069
mux_err() { (cd "$SPACE/worktrees/wt" && bash "$MUX_BIN" "$@" 2>&1 >/dev/null); }
log_lines() { [[ -f "$SHIP_MUX_FAKE_LOG" ]] && wc -l <"$SHIP_MUX_FAKE_LOG" | tr -d ' ' || echo 0; }
log_has() { jq -e --arg v "$1" --arg a "$2" 'select(.verb == $v and (.args | index($a)))' "$SHIP_MUX_FAKE_LOG" >/dev/null 2>&1; }
rec() { cat "$SPACE/notes/loops/$1/mux.json"; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/notes" "$SPACE/.hyper/ship-mux.json"; }

# 1: the shared contract --------------------------------------------------------
reset_fake
mux_contract contract "$SPACE/worktrees/wt"

# 2: open idempotency and the ownership record ------------------------------------
reset_fake
o1="$(mux open --ref u1 --cwd "$SPACE/worktrees/wt" --label unit-one)"
o2="$(mux open --ref u1 --cwd "$SPACE/worktrees/wt" --label unit-one)"
assert_eq "open twice returns the same ids" "$o1" "$o2"
assert_eq "open prints space, pane and group" "space pane group" "$(jq -r 'keys_unsorted | join(" ")' <<<"$o1")"
assert_eq "the record holds the space and the pane once each" "2" "$(rec u1 | jq '.created | length')"
assert_eq "the record names the backend" "fake" "$(rec u1 | jq -r .backend)"
assert_eq "the pane entry points at its space" "$(jq -r .space <<<"$o1")" "$(rec u1 | jq -r '.created[] | select(.kind == "pane") | .space')"
assert_eq "the group is named after the project" "group-proj-units" "$(jq -r .group <<<"$o1")"
assert_eq "open passes --group to the backend" "proj-units" "$(jq -r 'select(.verb == "open") | .args | .[index("--group") + 1]' "$SHIP_MUX_FAKE_LOG" | head -n 1)"

# 3: start/send/read/status/wait round trip with scripted answers -------------------
SP="$(jq -r .space <<<"$o1")"
st="$(mux start --ref u1 --space "$SP" --name dev-1 --harness pi --cwd "$SPACE/worktrees/wt" -- --model x --verbose)"
AG="$(jq -r .agent <<<"$st")"; APN="$(jq -r .pane <<<"$st")"
assert_eq "start records the agent and its pane" "4" "$(rec u1 | jq '.created | length')"
assert_eq "start forwards the harness args after --" '["--model","x","--verbose"]' \
  "$(jq -c 'select(.verb == "start") | .args | .[index("--") + 1:]' "$SHIP_MUX_FAKE_LOG")"
assert_eq "status defaults to idle" "idle" "$(mux status --to "$AG" | jq -r .state)"
printf 'working\nidle\n' > "$SHIP_MUX_FAKE_DIR/status/dev-1"
assert_eq "scripted status by name: first line" "working" "$(mux status --to "$AG" | jq -r .state)"
assert_eq "scripted status by name: then the next" "idle" "$(mux status --to "$AG" | jq -r .state)"
assert_eq "scripted status keeps the last line" "idle" "$(mux status --to "$AG" | jq -r .state)"
printf 'blocked\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "scripted status by id wins" "blocked" "$(mux status --to "$AG" | jq -r .state)"
assert_eq "status reports the pane and space" "$APN $SP" "$(mux status --to "$AG" | jq -r '"\(.pane) \(.space)"')"
assert_eq "wait --until idle times out with exit 1 while blocked" "1" "$(mux_rc wait --to "$AG" --until idle --timeout-ms 10)"
printf 'working\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_ok "wait --until working is reached" mux wait --to "$AG" --until working --timeout-ms 10
assert_ok "wait --until ready is reached while the agent exists" mux wait --to "$AG" --until ready --timeout-ms 10
assert_eq "wait --until gone on a live agent exits 1" "1" "$(mux_rc wait --to "$AG" --until gone --timeout-ms 10)"
printf 'line1\nline2\nline3\n' > "$SHIP_MUX_FAKE_DIR/read/dev-1"
assert_eq "read prints the scripted screen" "line1
line2
line3" "$(mux read --to "$AG")"
assert_eq "read --lines keeps the last N" "line3" "$(mux read --to "$AG" --lines 1)"
assert_eq "read by pane id finds the agent's screen" "line3" "$(mux read --to "$APN" --lines 1)"
assert_eq "read with nothing scripted is empty" "" "$(mux read --to "$(jq -r .pane <<<"$o1")")"
mux send --to "$AG" --text "do the thing" >/dev/null
mux send --to "$AG" --keys enter,ctrl+d >/dev/null
assert_eq "send --text and --keys reach the backend" "do the thing
<keys:enter,ctrl+d>" "$(cat "$SHIP_MUX_FAKE_DIR/sent/$AG")"

# 4: close of a recorded id; close of an unrecorded id ------------------------------
n_before="$(log_lines)"
assert_eq "close of a recorded agent exits 0" "0" "$(mux_rc close --ref u1 --id "$AG")"
assert_eq "the backend saw that close" "$((n_before + 1))" "$(log_lines)"
assert_eq "the agent leaves the record" "0" "$(rec u1 | jq --arg id "$AG" '[.created[] | select(.id == $id)] | length')"
assert_eq "a closed agent is gone" "gone" "$(mux status --to "$AG" | jq -r .state)"
assert_ok "wait --until gone after close" mux wait --to "$AG" --until gone --timeout-ms 10
n_before="$(log_lines)"
assert_eq "close of an unrecorded id exits 3" "3" "$(mux_rc close --ref u1 --id agent-999)"
assert_eq "...and makes no backend call" "$n_before" "$(log_lines)"
assert_contains "...and says why on stderr" "$(mux_err close --ref u1 --id agent-999)" "not recorded"
assert_eq "an id recorded for another ref is refused" "3" "$(mux_rc close --ref u2 --id "$SP")"
assert_eq "close of an already closed id exits 3" "3" "$(mux_rc close --ref u1 --id "$AG")"
assert_eq "...with the backend still untouched" "$n_before" "$(log_lines)"

# 5: group close only when ship created it and it is empty --------------------------
reset_fake
a="$(mux open --ref ga --cwd "$SPACE/worktrees/wt")"
b="$(mux open --ref gb --cwd "$SPACE/worktrees/wt")"
G="$(jq -r .group <<<"$a")"
assert_eq "both refs share one group" "$G" "$(jq -r .group <<<"$b")"
assert_eq "the group record is ship-created" "true" "$(jq -r --arg g "$G" '.groups[$g].created' "$SPACE/.hyper/ship-mux.json")"
assert_eq "the group record lists both spaces" "2" "$(jq -r --arg g "$G" '.groups[$g].spaces | length' "$SPACE/.hyper/ship-mux.json")"
n_before="$(log_lines)"
assert_eq "group close with spaces left exits 3" "3" "$(mux_rc close --ref ga --id "$G")"
assert_eq "...with no backend call" "$n_before" "$(log_lines)"
mux close --ref ga --id "$(jq -r .space <<<"$a")" >/dev/null
assert_eq "still refused while the other space remains" "3" "$(mux_rc close --ref ga --id "$G")"
mux close --ref gb --id "$(jq -r .space <<<"$b")" >/dev/null
assert_eq "the group record is empty now" "0" "$(jq -r --arg g "$G" '.groups[$g].spaces | length' "$SPACE/.hyper/ship-mux.json")"
assert_eq "group close of an empty ship-created group exits 0" "0" "$(mux_rc close --ref gb --id "$G")"
assert_eq "the backend saw the group close" "yes" "$(log_has close "$G" && echo yes || echo no)"
assert_eq "the group leaves the record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"
assert_eq "a second group close exits 3" "3" "$(mux_rc close --ref gb --id "$G")"

# 5b: a group that already existed is never closed ----------------------------------
reset_fake
mkdir -p "$SHIP_MUX_FAKE_DIR/groups"; echo preexisting > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
a="$(mux open --ref gp --cwd "$SPACE/worktrees/wt")"
G="$(jq -r .group <<<"$a")"
assert_eq "a pre-existing group is recorded as not ship-created" "false" "$(jq -r --arg g "$G" '.groups[$g].created' "$SPACE/.hyper/ship-mux.json")"
mux close --ref gp --id "$(jq -r .space <<<"$a")" >/dev/null
n_before="$(log_lines)"
assert_eq "group close of a pre-existing group exits 3" "3" "$(mux_rc close --ref gp --id "$G")"
assert_eq "...with no backend call" "$n_before" "$(log_lines)"
assert_contains "...and says it was not created by ship" "$(mux_err close --ref gp --id "$G")" "not created by ship"

# 5c: closing a space drops its panes and agents from the record --------------------
reset_fake
a="$(mux open --ref sc --cwd "$SPACE/worktrees/wt")"
mux start --ref sc --space "$(jq -r .space <<<"$a")" --name x --harness claude --cwd "$SPACE" >/dev/null
mux close --ref sc --id "$(jq -r .space <<<"$a")" >/dev/null
assert_eq "the record is empty after the space closes" "0" "$(rec sc | jq '.created | length')"
assert_eq "list is empty after the space closes" "[]" "$(mux list --ref sc | jq -c .)"

# 6: the call log ----------------------------------------------------------------------
reset_fake
mux open --ref lg --cwd "$SPACE" >/dev/null
mux check
mux list --ref lg >/dev/null
assert_eq "every backend call is one valid JSON line" "3" "$(jq -c 'select(.verb != null and (.args | type == "array"))' "$SHIP_MUX_FAKE_LOG" | wc -l | tr -d ' ')"
assert_eq "the verbs are logged in order" "open check list" "$(jq -r .verb "$SHIP_MUX_FAKE_LOG" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "the fake refuses to run without its log" "1" "$( (unset SHIP_MUX_FAKE_LOG; cd "$SPACE/worktrees/wt" && bash "$MUX_BIN" check >/dev/null 2>&1; echo $?) )"
echo "unplugged" > "$SHIP_MUX_FAKE_DIR/check-fail"
assert_eq "check surfaces the backend's failure" "1" "$(mux_rc check)"
rm -f "$SHIP_MUX_FAKE_DIR/check-fail"

# 7: unknown backend and config errors -------------------------------------------------
printf 'mux: nosuch\n' > "$PROJECT"
assert_eq "unknown mux exits 1" "1" "$(mux_rc check)"
assert_contains "...naming the value" "$(mux_err check)" "nosuch"
for v in "check" "open --ref r --cwd /" "list --ref r"; do
  assert_eq "unknown mux exits 1 for: $v" "1" "$(mux_rc $v)"
done
printf 'mux: ../fake\n' > "$PROJECT"
assert_eq "a path-like mux value is refused" "1" "$(mux_rc check)"
printf 'mux: fake\n: not yaml [\n' > "$PROJECT"
assert_eq "a malformed config exits 1" "1" "$(mux_rc check)"
printf 'mux: fake\n' > "$PROJECT"
assert_eq "the mux is picked up again from config" "0" "$(mux_rc check)"

# 8: usage errors ------------------------------------------------------------------------
assert_eq "no verb exits 2" "2" "$(mux_rc)"
assert_eq "unknown verb exits 2" "2" "$(mux_rc nope)"
assert_eq "open without --cwd exits 2" "2" "$(mux_rc open --ref r)"
assert_eq "an unsafe ref exits 2" "2" "$(mux_rc list --ref ../x)"
assert_eq "an unknown flag exits 2" "2" "$(mux_rc list --ref r --bogus 1)"
assert_eq "wait with a bad --until exits 2" "2" "$(mux_rc wait --to a --until sleeping --timeout-ms 1)"
assert_eq "run without a command exits 2" "2" "$(mux_rc run --ref r --pane p)"
assert_contains "--help prints the interface doc" "$(bash "$MUX_BIN" --help)" "Ownership record"

# 9: the dispatcher needs no gate and no hyper CLI when SHIP_SPACE_ROOT is set --------------
assert_eq "no gate is set in the config" "0" "$(grep -c '^gate' "$PROJECT")"

finish
