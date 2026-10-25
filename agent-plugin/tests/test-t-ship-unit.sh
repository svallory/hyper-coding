#!/usr/bin/env bash
# Row T (ship-unit, ship-land --host) — starting, resuming, waiting for and listing
# units, locally and on a host. The multiplexer is mux/fake; ssh, rsync, wt and the
# driver are stubs. A host is this same machine: the stub ssh runs the remote command
# in a shell under $HOME and the stub rsync copies, so the scripts really run from the
# synced ~/.cache copy. No real multiplexer, ssh or network is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
UNIT="$SHIP_DIR/ship-unit"
LAND="$SHIP_DIR/ship-land"

SPACE="$FIX/proj"
G="$SPACE/.git"
REMOTE="$FIX/remote.git"
export FIX
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_UNIT_POLL_S=0.2
export SHIP_LOOP_BIN="$FIX/bin/loop-stub"
export WT_LOG="$FIX/wt.log" SSH_LOG="$FIX/ssh.log" RSYNC_LOG="$FIX/rsync.log"
export STUB_G="$G" STUB_SPACE="$SPACE"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS

# --- fixture: a bare space repo with a main branch ----------------------------------------
git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$FIX/seed" 2>/dev/null
echo base > "$FIX/seed/base.txt"
git -C "$FIX/seed" add base.txt
git -C "$FIX/seed" commit -q -m "chore: base"
git -C "$FIX/seed" branch -M main
git -C "$FIX/seed" push -q origin main
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main
git clone -q --bare "$REMOTE" "$G"
git -C "$G" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git -C "$G" fetch -q origin
mkdir -p "$SPACE/worktrees" "$SPACE/.hyper" "$SPACE/notes/loops" "$SPACE/notes/specs/feat"
git -C "$G" worktree add -q "$SPACE/worktrees/main" main
echo "# rulings" > "$SPACE/notes/decisions.md"
echo "# spec" > "$SPACE/notes/specs/feat/design.md"
printf 'mux: fake\ngate: "true"\nhosts:\n  forge:\n    ssh: fakehost\n    slots: 1\n  nossh:\n    slots: 1\n' > "$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief-a.md"
echo "# brief" > "$BRIEF"
# The local side loads the config once and its children inherit it, as in one real run
# (this keeps yq out of the loop). The stub ssh drops it, so the "host" loads its own.
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
ship_config_load

# --- stubs ---------------------------------------------------------------------------------
mkdir -p "$FIX/bin"
cat > "$FIX/bin/wt" <<'STUB'
#!/usr/bin/env bash
echo "$PWD :: $*" >> "$WT_LOG"
[[ "$1" == switch ]] || exit 1
br="${*: -1}"
git -C "$STUB_G" worktree add -q -b "$br" "$STUB_SPACE/worktrees/$br" main
STUB
# ssh: drop the connection once ($FIX/ssh.drop), or always ($FIX/ssh.down); else run the
# command under a shell in $HOME, as a remote login shell would.
cat > "$FIX/bin/ssh" <<'STUB'
#!/usr/bin/env bash
echo "ssh $*" >> "$SSH_LOG"
while [[ "$1" == -o ]]; do shift 2; done
shift   # the destination
if [[ -e "$FIX/ssh.down" ]]; then exit 255; fi
if [[ -e "$FIX/ssh.drop" && "$*" == *_probe* ]]; then rm -f "$FIX/ssh.drop"; exit 255; fi
cd "$HOME" || exit 255
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
cmd="$*"
exec bash -c "${cmd/#bash -lc /bash -c }"
STUB
# rsync: archive copies only. A "host:path" argument is a path on this machine, relative
# to $HOME when it is not absolute; copying a path onto itself does nothing.
cat > "$FIX/bin/rsync" <<'STUB'
#!/usr/bin/env bash
echo "rsync $*" >> "$RSYNC_LOG"
if [[ -e "$FIX/ssh.down" ]]; then exit 255; fi
args=()
for a in "$@"; do case "$a" in -*) ;; *) args+=("$a") ;; esac; done
fix() { local x="$1"; case "$x" in /*) ;; *:*) x="${x#*:}"; case "$x" in /*) ;; *) x="$HOME/$x" ;; esac ;; esac; printf '%s' "$x"; }
src="$(fix "${args[0]}")"; dst="$(fix "${args[1]}")"
if [[ -d "$src" ]]; then
  [[ "$(cd "$src" && pwd -P)" != "$(mkdir -p "$dst" && cd "$dst" && pwd -P)" ]] || exit 0
  cp -R "${src%/}/." "$dst/"
else
  [[ "$src" -ef "$dst" ]] && exit 0
  case "$dst" in */) mkdir -p "$dst" ;; esac
  cp "$src" "$dst"
fi
STUB
# The driver: behaviour per ref from $FIX/mode.<ref>; every start's arguments are kept.
cat > "$FIX/bin/loop-stub" <<'STUB'
#!/usr/bin/env bash
ref=""
for ((i = 1; i <= $#; i++)); do [[ "${!i}" == --ref ]] && { j=$((i + 1)); ref="${!j}"; }; done
n=$(ls "$FIX"/loopargs."$ref".* 2>/dev/null | wc -l | tr -d ' ')
printf '%s\n' "$@" > "$FIX/loopargs.$ref.$((n + 1))"
D="$SHIP_SPACE_ROOT/notes/loops/$ref"
echo $$ > "$D/driver.pid"
result() { jq -nc --arg r "$ref" --arg s "$1" --arg h "${SHIP_HOST:-local}" '{ref: $r, pr: 7, stage: "finalize", status: $s, failovers: 0, host: $h}' > "$D/result.json"; cat "$D/result.json"; }
ready() { result READY; exit 0; }
case "$(cat "$FIX/mode.$ref")" in
  ready) ready ;;
  error) exit 1 ;;
  park)
    if [[ -s "$D/answer-1.md" ]]; then ready; fi
    echo '{"status":"QUESTION","stage":"develop","agent":"a","question":"q","since":"t","n":1,"file":""}' > "$D/park.json"
    result PARKED; exit 2 ;;
  over)
    if [[ -s "$D/extend" ]]; then mv "$D/extend" "$D/extend.applied"; touch "$D/budget-r1.json.handled"; ready; fi
    echo '{"verdict":"OVER-BUDGET","stage":"develop","agent":"a","class":"S","budget_min":15,"elapsed_min":16,"file":"develop.json"}' > "$D/budget-r1.json"
    result OVER-BUDGET; exit 2 ;;
  slow) sleep 1.5; result PARKED; exit 2 ;;
esac
STUB
chmod +x "$FIX/bin/wt" "$FIX/bin/ssh" "$FIX/bin/rsync" "$FIX/bin/loop-stub"
export PATH="$FIX/bin:$PATH"

# A pane stands in for the multiplexer: every `run` the fake records is executed once.
(
  n=0
  while :; do
    total=0
    [[ -f "$SHIP_MUX_FAKE_LOG" ]] && total="$(wc -l < "$SHIP_MUX_FAKE_LOG" | tr -d ' ')"
    while [[ $n -lt $total ]]; do
      n=$((n + 1))
      line="$(sed -n "${n}p" "$SHIP_MUX_FAKE_LOG")"
      if [[ "$(jq -r .verb <<<"$line")" == run ]]; then
        cmd="$(jq -r '.args[-1]' <<<"$line")"
        bash -c "$cmd" >> "$FIX/pane.out" 2>&1 &
      fi
    done
    sleep 0.1
  done
) &
PANES=$!
SLEEPERS=""
cleanup() { kill "$PANES" $SLEEPERS 2>/dev/null; }
trap cleanup EXIT

unit() { bash "$UNIT" "$@" 2>"$FIX/unit.err" >"$FIX/unit.out"; echo $?; }
err() { cat "$FIX/unit.err"; }
out() { cat "$FIX/unit.out"; }
mode() { printf '%s' "$2" > "$FIX/mode.$1"; }
loops() { echo "$SPACE/notes/loops/$1"; }
mux_count() { jq -c --arg v "$1" 'select(.verb == $v)' "$SHIP_MUX_FAKE_LOG" 2>/dev/null | wc -l | tr -d ' '; }
# sleeper — a live "driver" pid for a unit; sets SLEEPER_PID.
sleeper() { sleep 120 & SLEEPER_PID=$!; SLEEPERS="$SLEEPERS $SLEEPER_PID"; }
# mk_state <ref> <host> [pid] [result status] [stage] [failovers] — a unit directory.
mk_state() {
  local d; d="$(loops "$1")"
  mkdir -p "$d"
  jq -n --arg r "$1" --arg h "$2" '{ref: $r, host: $h, branch: $r, worktree: "/nowhere", brief: "/b", class: "S", launched_at: 1}' > "$d/unit.json"
  [[ -z "${3:-}" ]] || echo "$3" > "$d/driver.pid"
  if [[ -n "${4:-}" ]]; then
    jq -n --arg r "$1" --arg s "$4" --arg st "${5:-finalize}" --argjson f "${6:-0}" '{ref: $r, status: $s, stage: $st, failovers: $f}' > "$d/result.json"
  fi
}

# 1: usage ------------------------------------------------------------------------------------
assert_eq "no subcommand: usage, exit 64" "64" "$(unit)"
assert_eq "unknown subcommand: 64" "64" "$(unit frob)"
assert_eq "run without a ref: 64" "64" "$(unit run --brief "$BRIEF" --class S)"
assert_eq "run without a brief: 64" "64" "$(unit run a1 --class S)"
assert_eq "run with a bad class: 64" "64" "$(unit run a1 --brief "$BRIEF" --class X)"
assert_eq "run with a bad ref: 64" "64" "$(unit run ../x --brief "$BRIEF" --class S)"
assert_eq "run with a missing brief: 64" "64" "$(unit run a1 --brief "$FIX/none.md" --class S)"
assert_eq "run with a bad --max-rounds: 64" "64" "$(unit run a1 --brief "$BRIEF" --class S --max-rounds 0)"
assert_eq "run with a bad model override: 1" "1" "$(unit run a1 --brief "$BRIEF" --class S --model nostage=opus)"
assert_eq "resume of an unknown unit: 1" "1" "$(unit resume ghost)"
assert_eq "wait for an unknown unit: 1" "1" "$(unit wait ghost)"
assert_eq "no worktree was made by any of those" "main" "$(cd "$SPACE/worktrees" && echo *)"

# 2: a local run returns the driver's exit code ----------------------------------------------
mode l1 ready
rc="$(unit run l1 --brief "$BRIEF" --class S --max-rounds 2 --final-gate --model dev=sonnet)"
assert_eq "local run: READY exits 0" "0" "$rc"
assert_contains "wt created the worktree from the base" "$(cat "$WT_LOG")" "$SPACE :: switch -c --no-cd -b main l1"
assert_eq "the worktree exists" "yes" "$([[ -d "$SPACE/worktrees/l1" ]] && echo yes)"
assert_contains "result.json is printed" "$(out)" '"status":"READY"'
assert_eq "one ship-mux open" "1" "$(mux_count open)"
assert_eq "one ship-mux run" "1" "$(mux_count run)"
assert_contains "the driver ran in the unit pane (via _driver)" "$(jq -r 'select(.verb == "run") | .args[-1]' "$SHIP_MUX_FAKE_LOG" | head -n 1)" "_driver l1"
assert_eq "driver.exit holds 0" "0" "$(cat "$(loops l1)/driver.exit")"
assert_eq "unit.json records the local host" "local" "$(jq -r .host "$(loops l1)/unit.json")"
assert_eq "unit.json records the branch" "l1" "$(jq -r .branch "$(loops l1)/unit.json")"
assert_eq "unit.json records the worktree" "$SPACE/worktrees/l1" "$(jq -r .worktree "$(loops l1)/unit.json")"
args1="$(cat "$FIX/loopargs.l1.1")"
assert_contains "driver got --ref" "$args1" "l1"
assert_contains "driver got --worktree" "$args1" "$SPACE/worktrees/l1"
assert_contains "driver got --brief" "$args1" "$BRIEF"
assert_contains "driver got --max-rounds" "$args1" "--max-rounds"
assert_contains "driver got --final-gate" "$args1" "--final-gate"
assert_contains "driver got --model dev=sonnet" "$args1" "dev=sonnet"
assert_eq "the driver saw host local" "local" "$(jq -r .host "$(loops l1)/result.json")"

mode l2 park
rc="$(unit run l2 --brief "$BRIEF" --class M --branch feat-two)"
assert_eq "local run: a parked unit exits 2" "2" "$rc"
assert_eq "--branch names the worktree branch" "yes" "$([[ -d "$SPACE/worktrees/feat-two" ]] && echo yes)"
mode l3 error
assert_eq "local run: an ERROR driver exits 1" "1" "$(unit run l3 --brief "$BRIEF" --class S)"
assert_eq "...recorded in driver.exit" "1" "$(cat "$(loops l3)/driver.exit")"

# 3: resume writes the handoff files ----------------------------------------------------------
echo "use the existing helper" > "$FIX/answer.md"
assert_eq "resume --answer without a park: refused (3)" "3" "$(unit resume l1 --answer "$FIX/answer.md")"
assert_eq "...and wrote nothing" "answer-*" "$(cd "$(loops l1)" && echo answer-*)"
assert_eq "resume --extend without an over-budget stage: refused (3)" "3" "$(unit resume l1 --extend 10)"
assert_eq "...and wrote nothing" "" "$([[ -e "$(loops l1)/extend" ]] && echo extend)"
rm -f "$FIX/ssh.drop"
rc="$(unit resume l2 --answer "$FIX/answer.md" --model dev=sonnet,haiku)"
assert_eq "resume with an answer: the unit now ends READY (exit 0)" "0" "$rc"
assert_eq "answer-1.md holds the answer (park.json's n)" "use the existing helper" "$(cat "$(loops l2)/answer-1.md")"
assert_eq "models.override got the line" "dev=sonnet,haiku" "$(cat "$(loops l2)/models.override")"
assert_eq "the driver was started a second time" "2" "$(ls "$FIX"/loopargs.l2.* | wc -l | tr -d ' ')"
assert_eq "...with the same arguments as the first start" "$(cat "$FIX/loopargs.l2.1")" "$(cat "$FIX/loopargs.l2.2")"
assert_eq "driver.exit was rewritten" "0" "$(cat "$(loops l2)/driver.exit")"

mode l4 over
assert_eq "an over-budget unit exits 2" "2" "$(unit run l4 --brief "$BRIEF" --class S)"
assert_eq "resume --extend 20.5 continues it" "0" "$(unit resume l4 --extend 20.5)"
assert_eq "extend holds the minutes (the stub moved it to extend.applied)" "20.5" "$(cat "$(loops l4)/extend.applied")"
assert_eq "resume --extend with a bad number: 64" "64" "$(unit resume l4 --extend soon)"
assert_eq "resume --model with a bad stage: 1" "1" "$(unit resume l4 --model nostage=opus)"
assert_eq "resume --answer with an empty file: 64" "64" "$(: > "$FIX/empty.md"; unit resume l2 --answer "$FIX/empty.md")"
mode l4 ready
assert_eq "resume with nothing to hand over just restarts the driver" "0" "$(unit resume l4)"
assert_eq "...which was started a third time" "3" "$(ls "$FIX"/loopargs.l4.* | wc -l | tr -d ' ')"
mode l5 park
unit run l5 --brief "$BRIEF" --class S >/dev/null
assert_eq "resume with two --model options" "0" "$(unit resume l5 --answer "$FIX/answer.md" --model dev=sonnet --model review=opus)"
assert_eq "...both model lines are there" "dev=sonnet|review=opus" "$(paste -sd'|' "$(loops l5)/models.override")"

# 4: slots ------------------------------------------------------------------------------------
sleeper; S1=$SLEEPER_PID; sleeper; S2=$SLEEPER_PID
mk_state busy1 local "$S1"
mk_state busy2 local "$S2"
mode full1 ready
before_open="$(mux_count open)"
rc="$(unit run full1 --brief "$BRIEF" --class S)"
assert_eq "full slots: refused (3)" "3" "$rc"
assert_contains "...with a message naming the host and the slots" "$(err)" "host local is full: 2 of 2 slots"
assert_contains "...and the units in use" "$(err)" "busy1"
assert_eq "...no worktree was created" "" "$([[ -e "$SPACE/worktrees/full1" ]] && echo full1)"
assert_eq "...and no space was opened" "$before_open" "$(mux_count open)"
kill "$S2" 2>/dev/null; wait "$S2" 2>/dev/null
assert_eq "a dead driver.pid frees its slot" "0" "$(unit run full1 --brief "$BRIEF" --class S)"
kill "$S1" 2>/dev/null; wait "$S1" 2>/dev/null
mk_state forgeunit forge "$$"   # another host's unit (this shell's pid is alive) does not count here
sleeper; S3=$SLEEPER_PID
mk_state busy3 local "$S3"
sleeper; S4=$SLEEPER_PID
mk_state busy4 local "$S4"
mode full2 ready
assert_eq "units of other hosts do not count (still full by two local drivers)" "3" "$(unit run full2 --brief "$BRIEF" --class S)"
kill "$S3" "$S4" 2>/dev/null; wait "$S3" "$S4" 2>/dev/null
rm -rf "$(loops forgeunit)"
mode again ready
sleeper; S8=$SLEEPER_PID
mk_state again local "$S8"
assert_eq "run refuses a unit whose driver is already running" "3" "$(unit run again --brief "$BRIEF" --class S)"
kill "$S8" 2>/dev/null; wait "$S8" 2>/dev/null
assert_contains "...pointing at wait" "$(err)" "ship-unit wait again"

# 5: a host run survives one killed ssh and returns the remote code ----------------------------
VER="$(jq -r .version "$PLUGIN_DIR/.claude-plugin/plugin.json")"
CACHE="$HOME/.cache/hyper/ship/$VER"
mode h1 slow
: > "$FIX/ssh.drop"
: > "$SSH_LOG"; : > "$RSYNC_LOG"
rc="$(unit run h1 --brief "$BRIEF" --class S --host forge --spec-dir "$SPACE/notes/specs/feat")"
assert_eq "host run: returns the remote driver's code (2) after one ssh drop" "2" "$rc"
assert_contains "...it reported the lost connection" "$(err)" "lost the connection to forge"
assert_contains "...and the reconnect" "$(err)" "reconnected to forge"
assert_eq "...the drop was consumed" "" "$([[ -e "$FIX/ssh.drop" ]] && echo left)"
assert_eq "scripts were synced to the versioned cache" "yes" "$([[ -x "$CACHE/scripts/ship/ship-unit" ]] && echo yes)"
assert_eq "...with the plugin layout (hyper-require-lib.sh)" "yes" "$([[ -f "$CACHE/scripts/hyper-require-lib.sh" ]] && echo yes)"
assert_eq "...and the defaults file" "yes" "$([[ -f "$CACHE/skills/ship/defaults.yml" ]] && echo yes)"
assert_contains "rsync copied scripts/ship/" "$(cat "$RSYNC_LOG")" "$SHIP_DIR/ fakehost:.cache/hyper/ship/$VER/scripts/ship/"
assert_contains "rsync copied the brief to the same path" "$(cat "$RSYNC_LOG")" "$BRIEF fakehost:$BRIEF"
assert_contains "rsync copied the rulings file" "$(cat "$RSYNC_LOG")" "$SPACE/notes/decisions.md fakehost:$SPACE/notes/decisions.md"
assert_contains "rsync copied the spec dir" "$(cat "$RSYNC_LOG")" "$SPACE/notes/specs/feat/ fakehost:$SPACE/notes/specs/feat/"
assert_contains "rsync mirrored notes/loops/h1 back" "$(cat "$RSYNC_LOG")" "fakehost:$SPACE/notes/loops/h1/"
assert_contains "SHIP_SPACE_ROOT went over ssh" "$(cat "$SSH_LOG")" "SHIP_SPACE_ROOT"
assert_eq "more than one probe was needed" "yes" "$([[ "$(grep -c '_probe' "$SSH_LOG")" -ge 2 ]] && echo yes)"
assert_contains "the driver was started from the synced cache copy" "$(jq -r 'select(.verb == "run") | .args[-1]' "$SHIP_MUX_FAKE_LOG" | tail -n 1)" "$CACHE/scripts/ship/ship-unit"
assert_eq "unit.json records host forge" "forge" "$(jq -r .host "$(loops h1)/unit.json")"
assert_eq "...and the spec dir" "$SPACE/notes/specs/feat" "$(jq -r .spec_dir "$(loops h1)/unit.json")"
assert_eq "the driver saw SHIP_HOST=forge" "forge" "$(jq -r .host "$(loops h1)/result.json")"

# a host unit is counted against that host's slots (forge has 1)
sleeper; S5=$SLEEPER_PID
mk_state hbusy forge "$S5"
mode h2 ready
assert_eq "host slots: forge is full with one live unit (3)" "3" "$(unit run h2 --brief "$BRIEF" --class S --host forge)"
assert_contains "...the message names forge" "$(err)" "host forge is full: 1 of 1 slots"
kill "$S5" 2>/dev/null; wait "$S5" 2>/dev/null
rm -rf "$(loops hbusy)"

mode h3 ready
assert_eq "host run: READY exits 0" "0" "$(unit run h3 --brief "$BRIEF" --class S --host forge)"
assert_eq "host without an ssh destination: 1" "1" "$(unit run h4 --brief "$BRIEF" --class S --host nossh)"
assert_contains "...with a message" "$(err)" "no ssh destination"
assert_eq "an unknown host: 1" "1" "$(unit run h4 --brief "$BRIEF" --class S --host nowhere)"

# the host stays unreachable: give up, but say the driver keeps running
mode h5 slow
rc="$(: > "$FIX/ssh.down"; SHIP_UNIT_RECONNECT_SEC=1 unit run h5 --brief "$BRIEF" --class S --host forge)"
assert_eq "host down at start: 1" "1" "$rc"
rm -f "$FIX/ssh.down"
# a host that goes away while waiting
mk_state hgone forge "" "" # unit.json only
rc="$(: > "$FIX/ssh.down"; SHIP_UNIT_RECONNECT_SEC=1 unit wait hgone)"
assert_eq "wait: a host that stays down is given up on (1)" "1" "$rc"
assert_contains "...saying that wait reattaches" "$(err)" "ship-unit wait hgone"
rm -f "$FIX/ssh.down"

# resume on a host: the answer goes over, the host restarts the driver
mode h6 park
assert_eq "host run: parked exits 2" "2" "$(unit run h6 --brief "$BRIEF" --class S --host forge)"
: > "$RSYNC_LOG"
assert_eq "host resume --answer: READY (0)" "0" "$(unit resume h6 --answer "$FIX/answer.md")"
assert_contains "the answer was staged for the host" "$(cat "$RSYNC_LOG")" "notes/loops/h6/.resume-answer"
assert_eq "answer-1.md is on the host side" "use the existing helper" "$(cat "$(loops h6)/answer-1.md")"
assert_eq "the staging file is gone after the host used it" "" "$([[ -e "$(loops h6)/.resume-answer" ]] && echo left)"

# 6: wait ---------------------------------------------------------------------------------------
assert_eq "wait on a finished unit returns its code at once" "0" "$(unit wait l1)"
assert_contains "...and prints result.json" "$(out)" '"status":"READY"'
mk_state dead1 local 99999999
assert_eq "wait on a dead driver without an exit code: 1" "1" "$(unit wait dead1)"
assert_contains "...says so" "$(err)" "left no exit code"
sleeper; S6=$SLEEPER_PID
mk_state wait1 local "$S6"
( sleep 1; echo 2 > "$(loops wait1)/driver.exit" ) &
assert_eq "wait on a live driver blocks until driver.exit appears (2)" "2" "$(unit wait wait1)"
kill "$S6" 2>/dev/null; wait "$S6" 2>/dev/null

# 7: list ---------------------------------------------------------------------------------------
for d in "$SPACE"/notes/loops/*; do [[ -d "$d" ]] && rm -rf "$d"; done
mkdir -p "$SPACE/notes/loops/.done/old"
sleeper; S7=$SLEEPER_PID
mk_state ready1 local "" READY finalize 0
mk_state parked1 local "" PARKED develop 0
mk_state failed1 local "" READY finalize 2
: > "$(loops failed1)/failover-1.json"
mk_state deadpid1 local 99999999
mk_state running1 local "$S7"
echo x > "$(loops running1)/review-r1.prompt.md"
mk_state remote1 forge "" READY finalize 0
line() { grep "^$1 " "$FIX/unit.out"; }
assert_eq "list exits 0" "0" "$(unit list)"
assert_contains "list has a header" "$(out)" "REF"
assert_contains "READY unit" "$(line ready1)" "READY"
assert_contains "READY unit: stage" "$(line ready1)" "finalize"
assert_contains "READY unit: driver not alive" "$(line ready1)" " no"
assert_contains "PARKED unit" "$(line parked1)" "PARKED"
assert_contains "PARKED unit: stage" "$(line parked1)" "develop"
assert_contains "failed-over unit: READY" "$(line failed1)" "READY"
assert_eq "failed-over unit: failovers column is 2" "2" "$(line failed1 | awk '{print $5}')"
assert_eq "READY unit: failovers column is 0" "0" "$(line ready1 | awk '{print $5}')"
assert_contains "dead-pid unit is DEAD" "$(line deadpid1)" "DEAD"
assert_contains "dead-pid unit: not alive" "$(line deadpid1)" " no"
assert_contains "live driver is RUNNING" "$(line running1)" "RUNNING"
assert_contains "RUNNING: stage from the newest prompt" "$(line running1)" "review-r1"
assert_contains "RUNNING: alive" "$(line running1)" " yes"
assert_contains "host column" "$(line remote1)" "forge"
assert_eq "age column is a duration" "yes" "$([[ "$(line ready1 | awk '{print $6}')" =~ ^[0-9]+[mhd]$ ]] && echo yes)"
assert_not_contains ".done is not listed" "$(out)" "old"
kill "$S7" 2>/dev/null; wait "$S7" 2>/dev/null
for d in "$SPACE"/notes/loops/*; do [[ -d "$d" ]] && rm -rf "$d"; done
unit list >/dev/null
assert_contains "list with no units says so" "$(out)" "(no units)"

# 8: ship-land --host ---------------------------------------------------------------------------
mk_unit_land() { mk_state "$1" forge "" "$2"; }
mk_unit_land j1 PARKED
: > "$SSH_LOG"; : > "$RSYNC_LOG"
land() { bash "$LAND" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }
assert_eq "land --host: the remote refusal (not READY, 3) is the exit code" "3" "$(land j1 --host forge)"
assert_contains "...the remote refused" "$(cat "$FIX/land.err")" "refused"
assert_contains "...it ran over ssh" "$(cat "$SSH_LOG")" "ship-land"
assert_contains "...from the synced cache" "$(cat "$SSH_LOG")" ".cache/hyper/ship/$VER/scripts/ship/ship-land"
assert_contains "...with the space root exported" "$(cat "$SSH_LOG")" "SHIP_SPACE_ROOT"
assert_contains "...and the scripts were rsynced first" "$(cat "$RSYNC_LOG")" "fakehost:.cache/hyper/ship/$VER/scripts/ship/"
assert_contains "...and notes/loops/j1 was mirrored back" "$(cat "$RSYNC_LOG")" "fakehost:$SPACE/notes/loops/j1/"
assert_eq "land --host forwards --force and --task (exit follows the remote)" "3" "$(land j1 --host forge --task T-1 2>/dev/null)"
assert_contains "...the flags reached ssh" "$(grep ship-land "$SSH_LOG" | tail -n 1)" 'task\ T-1'

: > "$RSYNC_LOG"
assert_eq "land --abandon --host: 0" "0" "$(land j1 --abandon --host forge)"
assert_contains "...the abandon flag reached the host" "$(cat "$SSH_LOG")" "--abandon"
assert_eq "...the loop dir moved to .done" "yes" "$([[ -d "$SPACE/notes/loops/.done/j1" && ! -d "$(loops j1)" ]] && echo yes)"
assert_contains "...and .done/j1 was mirrored back" "$(cat "$RSYNC_LOG")" "fakehost:$SPACE/notes/loops/.done/j1/"
assert_eq "--host local lands locally (the remote path is not used)" "1" "$(: > "$SSH_LOG"; land nothing --abandon --host local; )"
assert_eq "...no ssh call" "0" "$(wc -l < "$SSH_LOG" | tr -d ' ')"
assert_eq "land --host without an ssh destination: 1" "1" "$(land j1 --host nossh)"
assert_contains "...says so" "$(cat "$FIX/land.err")" "no ssh destination"
mk_unit_land j2 READY
assert_eq "land --host with the host down: 1" "1" "$(: > "$FIX/ssh.down"; land j2 --host forge)"
assert_eq "land --host: missing remote unit follows the remote exit (1)" "1" "$(rm -f "$FIX/ssh.down"; land absent --abandon --host forge)"
assert_contains "...the remote said so" "$(cat "$FIX/land.err")" "nothing to abandon"
assert_eq "land with a bad --host: 2" "2" "$(land j2 --host '../x')"
assert_eq "land --host needs a value: 2" "2" "$(land j2 --host)"

finish
