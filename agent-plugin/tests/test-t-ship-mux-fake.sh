#!/usr/bin/env bash
# Row T (ship-mux) — the dispatcher scripts/ship/ship-mux against mux/fake: the
# shared backend contract, the ownership record, close cascades, group close
# rules, record write failures, exit codes, the fake's call log and scripted
# answers, the unknown backend, and the C-11 pattern. What the fake backend does
# by itself (scripted answers, exit codes) is called as `bash $FAKE_BE` directly;
# ship-mux is spawned only where the dispatcher's own logic is the subject. The
# ship_lock properties (dead, old, foreign and live owners, contention) are in
# test-t-ship-lock.sh; only the dispatcher's use of the lock is here.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
source "$TESTS_DIR/lib/mux-contract.sh"
set +eu
set +o pipefail

MUX_BIN="$SCRIPTS_DIR/ship/ship-mux"
FAKE_BE="$SCRIPTS_DIR/ship/mux/fake"
# Each part below runs in its own space and fake backend (stream_init), in parallel with the others; par_wait
# replays their TAP lines in order. A dispatcher call costs ~0.5-1 s (about 40 processes), so the parts overlap.
stream_init() { # <name> — a fresh space "proj", fake dir and log of its own, under $FIX/<name>
  STREAM_DIR="$FIX/$1"
  SPACE="$STREAM_DIR/proj"
  make_bare_space "$SPACE"
  mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
  PROJECT="$SPACE/.hyper/ship.yml"
  export SHIP_SPACE_ROOT="$SPACE"
  export SHIP_MUX_FAKE_DIR="$STREAM_DIR/fake"
  export SHIP_MUX_FAKE_LOG="$STREAM_DIR/fake.log"
  export SHIP_MUX_TEST=1
  printf 'mux: fake\n' > "$PROJECT"   # no gate: ship-mux must not need one
  WT="$SPACE/worktrees/wt"
}
PAR_PIDS=(); PAR_NAMES=(); PAR_DOGS=()
# par <name> <function> — run a part in a subshell with counters of its own
par() {   # a part that ends without printing its "# part done" line crashed or timed out
  local n="$1" pid; shift
  ( _n=0; _fail=0; stream_init "$n"; "$@"; echo "# part $n done" ) >"$FIX/par.$n.out" 2>&1 & pid=$!
  ( sleep "${PART_MAX_S:-300}"; pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 & PAR_DOGS+=($!)
  PAR_PIDS+=("$pid"); PAR_NAMES+=("$n")
}
# par_wait — wait for the parts and replay their lines as this shell's own results, in start order
par_wait() {
  local i line
  for i in "${!PAR_NAMES[@]}"; do
    wait "${PAR_PIDS[$i]}" || fail "part ${PAR_NAMES[$i]} exited $?"
    kill "${PAR_DOGS[$i]}" 2>/dev/null
    grep -q "^# part ${PAR_NAMES[$i]} done$" "$FIX/par.${PAR_NAMES[$i]}.out" || fail "part ${PAR_NAMES[$i]} did not finish (crashed or timed out)"
    while IFS= read -r line; do
      case "$line" in
        "not ok "*) fail "${line#not ok * - }" ;;
        "ok "*) pass "${line#ok * - }" ;;
        "1.."*|"# part "*" done") ;;
        *) echo "$line" ;;
      esac
    done <"$FIX/par.${PAR_NAMES[$i]}.out"
  done
}
stream_init main

# Load the config once and let every ship-mux call inherit it (SHIP_CONFIG_JSON),
# as the scripts of one run do; the sections that need another backend override
# `mux` in that JSON (with_mux) instead of editing ship.yml and reloading.
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"
reload_cfg() { unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load; }
reload_cfg

BASE_CFG="$SHIP_CONFIG_JSON"
# with_mux <backend> <cmd...> — run cmd with the loaded config naming another backend (no config reload).
with_mux() { local m="$1"; shift; SHIP_CONFIG_JSON="$(jq -c --arg m "$m" '.mux = $m' <<<"$BASE_CFG")" "$@"; }
# run_mux <args> — one ship-mux spawn; sets OUT (stdout), ERR (stderr) and RC.
run_mux() { OUT="$(cd "$WT" && bash "$MUX_BIN" "$@" 2>"$STREAM_DIR/m.err")"; RC=$?; ERR="$(cat "$STREAM_DIR/m.err")"; }
# fk <args> / fk_rc <args> — the fake backend itself, no dispatcher.
fk() { bash "$FAKE_BE" "$@" 2>/dev/null; }
fk_rc() { bash "$FAKE_BE" "$@" >/dev/null 2>&1; echo $?; }
mux_contract_direct() { bash "$FAKE_BE" "$@"; }
mux() { (cd "$WT" && bash "$MUX_BIN" "$@" 2>/dev/null); }
mux_rc() { (cd "$WT" && bash "$MUX_BIN" "$@" >/dev/null 2>&1); echo $?; }
# shellcheck disable=SC2069
mux_err() { (cd "$WT" && bash "$MUX_BIN" "$@" 2>&1 >/dev/null); }
log_lines() { [[ -f "$SHIP_MUX_FAKE_LOG" ]] && wc -l <"$SHIP_MUX_FAKE_LOG" | tr -d ' ' || echo 0; }
closes_of() { jq -s --arg a "$1" '[.[] | select(.verb == "close" and (.args | index($a)))] | length' "$SHIP_MUX_FAKE_LOG" 2>/dev/null || echo 0; }
log_has() { jq -e --arg v "$1" --arg a "$2" 'select(.verb == $v and (.args | index($a)))' "$SHIP_MUX_FAKE_LOG" >/dev/null 2>&1; }
rec() { cat "$SPACE/notes/loops/$1/mux.json"; }
ids_of() { rec "$1" | jq -r '[.created[].id] | sort | join(" ")'; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/notes" "$SPACE/.hyper/ship-mux.json" "$SPACE/.hyper"/ship-mux.*lock; }
vanish() { rm -f "$SHIP_MUX_FAKE_DIR/state/$1.json"; }
start_agent() { mux start --ref "$1" --space "$2" --name "${3:-dev}" --harness claude --cwd "$WT"; }

make_plug() { # a copy of the plugin's ship scripts that can hold backends of its own
  PLUG="$STREAM_DIR/plugin"
  mkdir -p "$PLUG/scripts/ship/mux" "$PLUG/skills/ship"
  cp "$SCRIPTS_DIR/ship/ship-mux" "$SCRIPTS_DIR/ship/lib.sh" "$PLUG/scripts/ship/"
  cp "$SCRIPTS_DIR/hyper-require-lib.sh" "$PLUG/scripts/"
  cp "$PLUGIN_DIR/skills/ship/defaults.yml" "$PLUG/skills/ship/"
}

part_contract() {
  # 1: the shared contract (the happy path runs on the fake directly, refusals through ship-mux) -----------
  reset_fake
  # shellcheck disable=SC2034  # read by mux_contract
  mux_contract_vanish() { vanish "$1"; }
  mux_contract_exit_agent() { echo gone > "$SHIP_MUX_FAKE_DIR/status/$1"; }
  # the backend file itself: a backend refuses to close a group that still has children (contract rows)
  MUX_CONTRACT_BACKEND=(bash "$FAKE_BE")
  mux_contract contract "$WT"
  unset MUX_CONTRACT_BACKEND

}

part_records() {
  # 2: open: idempotency, the record, warnings ---------------------------------------
  reset_fake
  o1="$(mux open --ref u1 --cwd "$WT" --label unit-one)"
  assert_eq "open prints space, pane and group" "space pane group" "$(jq -r 'keys_unsorted | join(" ")' <<<"$o1")"
  assert_eq "the record holds the space and the pane once each" "2" "$(rec u1 | jq '.created | length')"
  assert_eq "the record names the backend" "fake" "$(rec u1 | jq -r .backend)"
  SP="$(jq -r .space <<<"$o1")"; PN="$(jq -r .pane <<<"$o1")"; G="$(jq -r .group <<<"$o1")"
  assert_eq "the pane entry points at its space and is the root" "$SP true" "$(rec u1 | jq -r '.created[] | select(.kind == "pane") | "\(.space) \(.root)"')"
  assert_eq "the space entry names its group and its cwd" "$G $WT" "$(rec u1 | jq -r '.created[] | select(.kind == "space") | "\(.group) \(.cwd)"')"
  assert_eq "the group is named after the project" "group-proj-units" "$G"
  assert_eq "open passes --group to the backend" "proj-units" "$(jq -r 'select(.verb == "open") | .args | .[index("--group") + 1]' "$SHIP_MUX_FAKE_LOG" | head -n 1)"
  assert_eq "the group record keeps the id, name and created flag" "proj-units true" "$(jq -r --arg g "$G" '.groups[$g] | "\(.name) \(.created)"' "$SPACE/.hyper/ship-mux.json")"
  assert_eq "the group record has no space list (the records are the truth)" "null" "$(jq -c --arg g "$G" '.groups[$g].spaces' "$SPACE/.hyper/ship-mux.json")"
  run_mux open --ref u1 --cwd "$WT"
  assert_eq "open with the same cwd does not warn" "" "$ERR"
  run_mux open --ref u1 --cwd /somewhere/else
  assert_contains "open with another cwd warns on stderr" "$ERR" "already open with cwd"
  assert_eq "...and still returns the existing space (idempotent open: the contract also asserts it)" "$o1" "$OUT"
  assert_eq "...and keeps the first cwd on record" "$WT" "$(rec u1 | jq -r '.created[] | select(.kind == "space") | .cwd')"

  # 3: round trip with scripted answers (the fake's own behaviour, called directly) -------------------
  st="$(mux start --ref u1 --space "$SP" --name dev-1 --harness pi --cwd "$WT" -- --model x --verbose)"
  AG="$(jq -r .agent <<<"$st")"; APN="$(jq -r .pane <<<"$st")"
  assert_eq "start records the agent (with its pane) and the pane" "4" "$(rec u1 | jq '.created | length')"
  assert_eq "the agent entry carries its pane" "$APN" "$(rec u1 | jq -r --arg a "$AG" '.created[] | select(.id == $a) | .pane')"
  assert_eq "start forwards the harness args after --" '["--model","x","--verbose"]' \
    "$(jq -c 'select(.verb == "start") | .args | .[index("--") + 1:]' "$SHIP_MUX_FAKE_LOG")"
  assert_eq "status defaults to idle" "idle" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  printf 'working\nidle\n' > "$SHIP_MUX_FAKE_DIR/status/dev-1"
  assert_eq "scripted status by name: first line" "working" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  assert_eq "scripted status by name: then the next" "idle" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  assert_eq "scripted status keeps the last line" "idle" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  printf 'blocked\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "scripted status by id wins" "blocked" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  assert_eq "ship-mux passes a backend's exit 4 through (wait on a blocked agent)" "4" "$(mux_rc wait --ref u1 --to "$AG" --until idle --timeout-ms 10)"
  assert_eq "wait --until idle times out with exit 4 while blocked" "4" "$(fk_rc wait --ref u1 --to "$AG" --until idle --timeout-ms 10)"
  printf 'working\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "wait --until working is reached" "0" "$(fk_rc wait --ref u1 --to "$AG" --until working --timeout-ms 10)"
  assert_eq "wait --until gone on a live agent exits 4" "4" "$(fk_rc wait --ref u1 --to "$AG" --until gone --timeout-ms 10)"
  assert_eq "send --wait-ms exits 0 when the agent starts working" "0" "$(fk_rc send --ref u1 --to "$AG" --text go --wait-ms 50)"
  printf 'idle\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "send --wait-ms exits 4 when the agent never starts working" "4" "$(fk_rc send --ref u1 --to "$AG" --text go2 --wait-ms 50)"
  printf 'line1\nline2\nline3\n' > "$SHIP_MUX_FAKE_DIR/read/dev-1"
  assert_eq "read prints the scripted screen, then what was sent" "line1
line2
line3
go
go2" "$(fk read --ref u1 --to "$AG")"
  assert_eq "read --lines keeps the last N" "go2" "$(fk read --ref u1 --to "$AG" --lines 1)"
  assert_eq "read by pane id shows the agent's screen" "go2" "$(fk read --ref u1 --to "$APN" --lines 1)"
  fk run --ref u1 --pane "$PN" -- echo hello world >/dev/null
  assert_eq "run appends the command to the pane's screen" '$ echo hello world' "$(fk read --ref u1 --to "$PN")"
  assert_eq "ship-mux resolves the recorded agent name (park.json's agent) to its id" "go2" "$(mux read --ref u1 --to dev-1 --lines 1)"
  fk send --ref u1 --to "$AG" --keys enter,ctrl+d >/dev/null
  assert_eq "sent text and keys are recorded for assertions" "go
go2
<keys:enter,ctrl+d>" "$(cat "$SHIP_MUX_FAKE_DIR/sent/$AG")"
  fk send --ref u1 --to "$AG" --keys up,down >/dev/null
  assert_eq "send --keys accepts up and down" "<keys:up,down>" "$(tail -n 1 "$SHIP_MUX_FAKE_DIR/sent/$AG")"
  mux send --ref u1 --to dev-1 --text --to >/dev/null
  assert_eq "a --text value that reads --to is not taken for the target" "--to" "$(tail -n 1 "$SHIP_MUX_FAKE_DIR/sent/$AG")"
  mux send --ref u1 --text --to --to dev-1 >/dev/null
  assert_eq "...even when the real --to follows it" "--to" "$(tail -n 1 "$SHIP_MUX_FAKE_DIR/sent/$AG")"
  printf 'sleeping\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "an unknown scripted state is an error (status)" "1" "$(fk_rc status --ref u1 --to "$AG")"
  assert_eq "an unknown scripted state is an error (wait)" "1" "$(fk_rc wait --ref u1 --to "$AG" --until idle --timeout-ms 5)"
  assert_eq "an unknown scripted state is an error (list)" "1" "$(fk_rc list --ref u1 --ids "[\"$AG\"]")"
  rm -f "$SHIP_MUX_FAKE_DIR/status/$AG" "$SHIP_MUX_FAKE_DIR/status/dev-1"
  assert_eq "status of a pane id: the dispatcher refuses (3)" "3" "$(mux_rc status --ref u1 --to "$PN")"
  assert_eq "status of a pane id: the fake itself exits 1" "1" "$(fk_rc status --ref u1 --to "$PN")"
  echo gone > "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "gone is a scripted state: status says gone (0)" "gone" "$(fk status --ref u1 --to "$AG" | jq -r .state)"
  assert_eq "wait --until gone returns 0 for a scripted gone state" "0" "$(fk_rc wait --ref u1 --to "$AG" --until gone --timeout-ms 5)"
  rm -f "$SHIP_MUX_FAKE_DIR/status/$AG"
  assert_eq "wait --until gone on a live pane exits 4" "4" "$(fk_rc wait --ref u1 --to "$PN" --until gone --timeout-ms 5)"
  assert_eq "send to a pane id is an error" "1" "$(fk_rc send --ref u1 --to "$PN" --text x)"
  assert_eq "...even when the pane is an agent's" "1" "$(fk_rc send --ref u1 --to "$APN" --text x)"

  # 4: refusals make no backend call (the verbs run/send/read/status/wait share one arm of the dispatcher;
  #    which id counts as recorded is _entry's job) --------------------------------------------------
  n_before="$(log_lines)"
  run_mux close --ref u1 --id agent-999
  assert_eq "close of an unrecorded id: refused with exit 3" "3" "$RC"
  assert_contains "...and the refusal says why" "$ERR" "not recorded"
  run_mux read --ref u1 --to agent-999
  assert_eq "read of an unrecorded id: refused with exit 3 (the run/send/read/status/wait arm)" "3" "$RC"
  run_mux read --ref u2 --to "$AG"
  assert_eq "read of another ref's agent: refused with exit 3" "3" "$RC"
  run_mux close --ref u1 --id "$PN"
  assert_eq "close of a root pane: refused with exit 3" "3" "$RC"
  assert_contains "...and the refusal says to close the space" "$ERR" "close the space"
  assert_eq "...and none of them reached the backend" "$n_before" "$(log_lines)"

  # 5: close cascades. Pane -> its agents, an agent the backend lost, and the space -> the record empty are
  #    asserted by the contract (section 1) through this same dispatcher; here: the dispatcher itself closes an
  #    agent's pane (the fake would do it anyway), a space the backend lost, and the fake's answer for a gone id.
  PS="$(printf '%s %s' "$PN" "$SP" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')"
  assert_eq "close of a recorded agent exits 0" "0" "$(mux_rc close --ref u1 --id "$AG")"
  assert_eq "...the dispatcher closed the agent's pane on the backend too" "yes" "$(log_has close "$APN" && echo yes || echo no)"
  assert_eq "...and both entries left the record" "$PS" "$(ids_of u1)"
  b="$(mux open --ref lost --cwd "$WT")"; vanish "$(jq -r .space <<<"$b")"
  assert_eq "close of a space the backend lost exits 0" "0" "$(mux_rc close --ref lost --id "$(jq -r .space <<<"$b")")"
  assert_eq "...and the record is empty" "0" "$(rec lost | jq '.created | length')"
  assert_eq "the fake answers 5 for a gone id" "5" "$(fk_rc close --ref lost --id agent-nope)"

  # 6: list shows both names ----------------------------------------------------------------
  reset_fake
  LONG="a-very-long-unit-label-that-the-backend-shortens"
  mux open --ref nm --cwd "$WT" --label "$LONG" >/dev/null
  l="$(mux list --ref nm)"
  assert_eq "list name is the caller's name" "$LONG" "$(jq -r '[.[] | select(.kind == "space")] | first | .name' <<<"$l")"
  assert_eq "list backend_name is the backend's, shortened" "${LONG:0:24}" "$(jq -r '[.[] | select(.kind == "space")] | first | .backend_name' <<<"$l")"
  assert_eq "the dispatcher handed the recorded ids to the backend" "yes" \
    "$(jq -e 'select(.verb == "list") | .args | index("--ids")' "$SHIP_MUX_FAKE_LOG" >/dev/null && echo yes || echo no)"

  # 15: a name shared by several recorded agents is refused, not guessed or reported as missing (one spawn;
  #     the record is seeded, the refusal comes before any backend call) ------------------------------------
  mkdir -p "$SPACE/notes/loops/twin"
  jq -nc '{backend: "fake", created: [{id: "space-1", kind: "space"}, {id: "agent-1", kind: "agent", name: "dup", space: "space-1"}, {id: "agent-2", kind: "agent", name: "dup", space: "space-1"}]}' > "$SPACE/notes/loops/twin/mux.json"
  run_mux read --ref twin --to dup
  assert_contains "two agents with one name: --to names the count" "$ERR" "--to 'dup' names 2 recorded agents; use an id (ship-mux list)"
  assert_eq "...and exits 3" "3" "$RC"
}

part_groups() {
  # 7: group close, computed from the records. _group_has_spaces and _close_ok are the dispatcher's own
  #    functions, cut out of the script and called on fixtures below; the closing itself runs through it. The
  #    "no space left" and "pre-existing group" outcomes are also in the contract (section 1). ----------------
  reset_fake
  a="$(mux open --ref ga --cwd "$WT")"
  G="$(jq -r .group <<<"$a")"
  assert_eq "the backend itself refuses to close a group with children (1)" "1" "$(fk_rc close --ref ga --id "$G")"
  BASE_CLOSES="$(closes_of "$G")"   # that direct call is in the log; the dispatcher must add none
  run_mux close --ref ga --id "$G"
  assert_eq "group close with a space left exits 3" "3" "$RC"
  assert_contains "...and the refusal points at the records" "$ERR" "notes/loops"
  assert_eq "...with no close of the group on the backend" "$BASE_CLOSES" "$(closes_of "$G")"
  # the space goes (its close is the contract's), then the group may close -- unless the backend renamed it
  fk close --ref ga --id "$(jq -r .space <<<"$a")" >/dev/null
  echo '{"backend":"fake","created":[]}' > "$SPACE/notes/loops/ga/mux.json"
  echo "someone-elses-group" > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
  run_mux close --ref ga --id "$G"
  assert_eq "group close is refused when the backend reports another name for the id" "3" "$RC"
  assert_contains "...and says so" "$ERR" "now named"
  assert_eq "...with no close on the backend" "$BASE_CLOSES" "$(closes_of "$G")"
  echo "proj-units" > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
  assert_eq "group close of an empty ship-created group exits 0" "0" "$(mux_rc close --ref ga --id "$G")"
  assert_eq "the backend saw the group close" "$((BASE_CLOSES + 1))" "$(closes_of "$G")"
  assert_eq "the group leaves the record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"
  assert_eq "the ops lock is released" "no" "$([[ -e "$SPACE/.hyper/ship-mux.ops.lock" ]] && echo yes || echo no)"

  # a group that already existed is never closed
  reset_fake
  mkdir -p "$SHIP_MUX_FAKE_DIR/groups"; echo proj-units > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
  a="$(mux open --ref gp --cwd "$WT")"
  G="$(jq -r .group <<<"$a")"
  assert_eq "a pre-existing group is recorded as not ship-created" "false" "$(jq -r --arg g "$G" '.groups[$g].created' "$SPACE/.hyper/ship-mux.json")"
  mux close --ref gp --id "$(jq -r .space <<<"$a")" >/dev/null   # no space left: only "not created by ship" can refuse
  run_mux close --ref gp --id "$G"
  assert_eq "group close of a pre-existing group exits 3" "3" "$RC"
  assert_contains "...and says it was not created by ship" "$ERR" "not created by ship"
  assert_eq "...with no close on the backend" "no" "$(log_has close "$G" && echo yes || echo no)"

  # a group the backend lost is dropped from the record (closing it is not needed)
  reset_fake
  a="$(mux open --ref gr --cwd "$WT")"; G="$(jq -r .group <<<"$a")"
  fk close --ref gr --id "$(jq -r .space <<<"$a")" >/dev/null; echo '{"backend":"fake","created":[]}' > "$SPACE/notes/loops/gr/mux.json"
  rm -f "$SHIP_MUX_FAKE_DIR/groups/proj-units"
  assert_eq "group close of a group the backend lost exits 0" "0" "$(mux_rc close --ref gr --id "$G")"
  assert_eq "...and drops it from the record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"

  # _group_has_spaces on fixtures: a space in the group (any ref's record), none, another group's, an agent only,
  # a record that does not parse (counts as holding one, names the file)
  { sed -n '/^_bad_file=""/,/^}/p' "$MUX_BIN"; } > "$FIX/ghs.sh"
  ghs() { # ghs <case> <group> — prints "rc bad"; fixture dirs under $FIX/ghs/<case>
    bash -c 'root="$1"; source "$2"; _group_has_spaces "$3"; echo "$? ${_bad_file#$root/}"' _ "$FIX/ghs/$1" "$FIX/ghs.sh" "$2"
  }
  mkdir -p "$FIX/ghs/none/notes/loops" "$FIX/ghs/one/notes/loops/x" "$FIX/ghs/two/notes/loops/x" "$FIX/ghs/two/notes/loops/y" "$FIX/ghs/bad/notes/loops/x" "$FIX/ghs/bad/notes/loops/y"
  jq -nc '{created: [{id: "s1", kind: "space", group: "g1"}]}' > "$FIX/ghs/one/notes/loops/x/mux.json"
  jq -nc '{created: [{id: "a1", kind: "agent", group: "g1"}]}' > "$FIX/ghs/two/notes/loops/x/mux.json"
  jq -nc '{created: [{id: "s9", kind: "space", group: "g1"}]}' > "$FIX/ghs/two/notes/loops/y/mux.json"
  echo '{not json' > "$FIX/ghs/bad/notes/loops/x/mux.json"
  jq -nc '{created: []}' > "$FIX/ghs/bad/notes/loops/y/mux.json"
  assert_eq "_group_has_spaces: no records: none (1)" "1 " "$(ghs none g1)"
  assert_eq "_group_has_spaces: a space in the group: held (0)" "0 " "$(ghs one g1)"
  assert_eq "_group_has_spaces: ...but not in another group (1)" "1 " "$(ghs one g2)"
  assert_eq "_group_has_spaces: an agent does not count, a space in a second record does (0)" "0 " "$(ghs two g1)"
  assert_eq "_group_has_spaces: a record that does not parse counts as holding one and is named" "0 notes/loops/x/mux.json" "$(ghs bad g1)"
  # _close_ok: the backend's 5 (not found) is a close, anything else keeps its message and code
  { sed -n '/^_close_ok() {/,/^}/p' "$MUX_BIN"; } > "$FIX/cok.sh"
  cok() { RC_BE="$1" bash -c 'f_ref=r; source "$1"; _be() { echo "backend said: boom" >&2; return "$RC_BE"; }; _close_ok some-id; echo "rc=$?"' _ "$FIX/cok.sh" 2>&1; }
  assert_eq "_close_ok: backend 5 is closed (0), and its message is dropped" "rc=0" "$(cok 5)"
  assert_eq "_close_ok: backend 0 is closed (0)" "rc=0" "$(cok 0 | grep -v boom)"
  assert_eq "_close_ok: any other failure keeps its message and its code" "backend said: boom
rc=1" "$(cok 1)"

  # 8: record write failures roll back what was created ------------------------------------------
  reset_fake
  mkdir -p "$SPACE"; : > "$SPACE/notes"   # notes is a file: no record can be written
  run_mux open --ref rb --cwd "$WT"
  assert_eq "open exits 1 when the record cannot be written" "1" "$RC"
  assert_eq "...the space it created was closed again" "0" "$(find "$SHIP_MUX_FAKE_DIR/state" -name '*.json' | wc -l | tr -d ' ')"
  assert_eq "...and so was the group it created" "0" "$(ls "$SHIP_MUX_FAKE_DIR/groups" | wc -l | tr -d ' ')"
  assert_eq "...and the group record holds nothing" "{}" "$(jq -c '.groups // {}' "$SPACE/.hyper/ship-mux.json" 2>/dev/null || echo '{}')"
  rm -f "$SPACE/notes"
  a="$(mux open --ref rb2 --cwd "$WT")"; SP2="$(jq -r .space <<<"$a")"
  # a record write that fails with the lock free (the lock is taken at once): mv of mux.json fails
  mkdir -p "$FIX/shim"
  printf '#!/bin/sh\ncase "$*" in *mux.json*) exit 1;; esac\nexec "%s" "$@"\n' "$(command -v mv)" > "$FIX/shim/mv"; chmod +x "$FIX/shim/mv"
  run_mux_shim() { PATH="$FIX/shim:$PATH" run_mux "$@"; }
  run_mux_shim start --ref rb2 --space "$SP2" --name x --harness claude --cwd "$WT"
  assert_eq "start exits 1 when the record cannot be written" "1" "$RC"
  assert_contains "...and says it could not record the agent" "$ERR" "could not record the new agent"
  assert_eq "...and leaves no agent behind" "0" "$(grep -l '"kind":"agent"' "$SHIP_MUX_FAKE_DIR"/state/*.json 2>/dev/null | wc -l | tr -d ' ')"

  # a rollback close that fails names the orphan
  make_plug
  printf '#!/usr/bin/env bash\n[[ "$1" == close ]] && exit 1\nexec bash "%s" "$@"\n' "$FAKE_BE" > "$PLUG/scripts/ship/mux/flaky"
  reset_fake
  : > "$SPACE/notes"
  e="$(with_mux flaky bash -c 'cd "$1" && bash "$2" open --ref orp --cwd "$1" 2>&1 >/dev/null; echo "rc=$?"' _ "$WT" "$PLUG/scripts/ship/ship-mux")"
  assert_contains "open still exits 1 when the rollback close fails" "$e" "rc=1"
  assert_contains "...and names the orphan on stderr" "$e" "orphaned"
  assert_contains "...with its id" "$e" "'space-"
  rm -f "$SPACE/notes"

}

part_locks() {
  make_plug
  # 9: the dispatcher's use of the lock (ship_lock itself: test-t-ship-lock.sh) ------------------------
  reset_fake
  mkdir -p "$SPACE/notes/loops/lk"
  dead=999999; while kill -0 "$dead" 2>/dev/null; do dead=$((dead + 1)); done
  echo "$dead@$(hostname)" > "$SPACE/notes/loops/lk/mux.json.lock"
  assert_eq "open takes over a record lock whose owner died, and releases it" "0 no" \
    "$(mux_rc open --ref lk --cwd "$WT") $([[ -e "$SPACE/notes/loops/lk/mux.json.lock" ]] && echo yes || echo no)"
  # a live owner: _lock gives up at once with SHIP_MUX_LOCK_TRIES=0 (no wait) and says who holds it
  { printf 'source "%s/ship/lib.sh"\n' "$SCRIPTS_DIR"; sed -n '/^_held=()/,/^rec_default=/p' "$MUX_BIN" | sed '$d'; } > "$FIX/locks.sh"
  mkdir -p "$FIX/lk"
  echo "$$@$(hostname)" > "$FIX/lk/f.json.lock"
  out="$(SHIP_MUX_LOCK_TRIES=0 bash -c 'source "$1"; _lock "$2/f.json"; echo "rc=$?"; echo "held=${#_held[@]}"' _ "$FIX/locks.sh" "$FIX/lk" 2>&1)"
  assert_contains "_lock gives up on a live owner (1) and names it" "$out" "held by $$@$(hostname)"
  assert_contains "...rc 1 and nothing held" "$out" "rc=1
held=0"
  assert_eq "...and the live owner's lock is untouched" "$$@$(hostname)" "$(cat "$FIX/lk/f.json.lock")"
  rm -f "$FIX/lk/f.json.lock"
  # unlock and the exit trap leave a lock that was taken over alone
  out="$(bash -c 'source "$1"; _lock "$2/f.json"; echo "other@elsewhere" > "$2/f.json.lock"; _unlock; [[ -f "$2/f.json.lock" ]] && cat "$2/f.json.lock"' _ "$FIX/locks.sh" "$FIX/lk")"
  assert_eq "_unlock leaves a lock whose owner changed (taken over)" "other@elsewhere" "$out"
  rm -rf "$FIX/lk/f.json.lock"
  out="$(bash -c 'source "$1"; _lock "$2/f.json"; echo "other@elsewhere" > "$2/f.json.lock"' _ "$FIX/locks.sh" "$FIX/lk"; cat "$FIX/lk/f.json.lock" 2>/dev/null)"
  assert_eq "the exit trap leaves a lock whose owner changed" "other@elsewhere" "$out"
  rm -rf "$FIX/lk/f.json.lock"
  out="$(bash -c 'source "$1"; _lock "$2/f.json"; _unlock; [[ -e "$2/f.json.lock" ]] && echo held || echo released' _ "$FIX/locks.sh" "$FIX/lk")"
  assert_eq "_unlock removes a lock that is still ours" "released" "$out"
  # concurrent opens: unique ids, valid records
  reset_fake
  for i in 1 2 3 4 5 6; do (cd "$WT" && bash "$MUX_BIN" open --ref "par$i" --cwd "$WT" >/dev/null 2>"$FIX/par$i.err"; echo $? >"$FIX/par$i.rc") & done
  wait
  assert_eq "...every one exited 0 (a lock timeout would lose a space)" "0 6" "$(cat "$FIX"/par[1-6].rc | sort -u | tr -d '\n') $(cat "$FIX"/par[1-6].rc | wc -l | tr -d ' ')"
  assert_eq "six parallel opens made six distinct spaces" "6" "$(cat "$SPACE"/notes/loops/par*/mux.json | jq -r '.created[] | select(.kind == "space") | .id' | sort -u | wc -l | tr -d ' ')"
  assert_eq "...in one group, still recorded" "1" "$(jq '.groups | length' "$SPACE/.hyper/ship-mux.json")"
  assert_eq "the fake's counter issued 12 unique ids" "12" "$(cat "$SPACE"/notes/loops/par*/mux.json | jq -r '.created[].id' | sort -u | wc -l | tr -d ' ')"

  # 10: exit codes of the dispatcher and of a backend (one of each class: 2 and 3 become 1, others pass) -----
  printf '#!/usr/bin/env bash\nexit "${SHIP_TEST_RC:?}"\n' > "$PLUG/scripts/ship/mux/rc"
  assert_eq "a backend exit 2 becomes 1" "1" "$(with_mux rc bash -c 'cd "$1" && SHIP_TEST_RC=2 bash "$2" check >/dev/null 2>&1; echo $?' _ "$WT" "$PLUG/scripts/ship/ship-mux")"
  assert_eq "a backend exit 3 becomes 1" "1" "$(with_mux rc bash -c 'cd "$1" && SHIP_TEST_RC=3 bash "$2" check >/dev/null 2>&1; echo $?' _ "$WT" "$PLUG/scripts/ship/ship-mux")"
  assert_eq "a backend exit 99 passes through" "99" "$(with_mux rc bash -c 'cd "$1" && SHIP_TEST_RC=99 bash "$2" check >/dev/null 2>&1; echo $?' _ "$WT" "$PLUG/scripts/ship/ship-mux")"
  assert_eq "a backend exit 4 passes through" "4" "$(with_mux rc bash -c 'cd "$1" && SHIP_TEST_RC=4 bash "$2" check >/dev/null 2>&1; echo $?' _ "$WT" "$PLUG/scripts/ship/ship-mux")"

  # 11: the call log -----------------------------------------------------------------------------
  reset_fake
  mux open --ref lg --cwd "$WT" >/dev/null
  mux list --ref lg >/dev/null
  echo "unplugged" > "$SHIP_MUX_FAKE_DIR/check-fail"
  run_mux check
  assert_eq "check surfaces the backend's failure (1)" "1" "$RC"
  assert_contains "...with its message" "$ERR" "unplugged"
  rm -f "$SHIP_MUX_FAKE_DIR/check-fail"
  assert_eq "every backend call is one valid JSON line" "3" "$(jq -c 'select(.verb != null and (.args | type == "array"))' "$SHIP_MUX_FAKE_LOG" | wc -l | tr -d ' ')"
  assert_eq "the verbs are logged in order" "open list check" "$(jq -r .verb "$SHIP_MUX_FAKE_LOG" | tr '\n' ' ' | sed 's/ $//')"
  assert_eq "the fake refuses to run without its log" "1" "$( (unset SHIP_MUX_FAKE_LOG; fk_rc check) )"

  # 12: unknown backend ---------------------------------------------------------------------------
  with_mux nosuch run_mux open --ref r --cwd /
  assert_eq "unknown mux exits 1" "1" "$RC"
  assert_contains "...naming the value" "$ERR" "nosuch"
  assert_eq "a path-like mux value is refused" "1" "$(with_mux ../fake mux_rc check)"
  assert_eq "the mux is read from the project config when nothing is inherited" "0" "$( (unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; mux_rc check) )"

  # 13: usage errors (one per class; the others share their parser) ----------------------------------
  assert_eq "no verb exits 2" "2" "$(mux_rc)"
  assert_eq "unknown verb exits 2" "2" "$(mux_rc nope)"
  assert_eq "an unknown flag exits 2" "2" "$(mux_rc list --ref r --bogus 1)"
  assert_eq "run without a command exits 2" "2" "$(mux_rc run --ref r --pane p)"
  assert_eq "open without --cwd exits 2" "2" "$(mux_rc open --ref r)"
  assert_eq "an unsafe ref exits 2" "2" "$(mux_rc list --ref ../x)"
  assert_eq "wait with a bad --until exits 2" "2" "$(mux_rc wait --ref r --to a --until sleeping --timeout-ms 1)"
  assert_eq "send needs --ref (design table)" "2" "$(mux_rc send --to a --text x)"
  help="$(bash "$MUX_BIN" --help)"
  assert_contains "--help prints the interface doc" "$help" "Ownership record"
  assert_not_contains "--help stops before the code" "$help" "set -euo"

}

par contract part_contract
par records part_records
par groups part_groups
par locks part_locks

# 14: the C-11 pattern ---------------------------------------------------------------------------------
re="$(herdr_invocation_re)"
h=herd; h+=r
for t in "$h status" "x $h --no-focus pane list" "command -v $h" "$h agent list" "echo \"$h pane\"" "type -p $h" "which $h" "$h --x y worktree open" "(cd x; $h tab list)"; do
  assert_eq "C-11 flags: $t" "1" "$(grep -cE "$re" <<<"$t")"
done
for t in "$h is the only real backend" "the $h stub" "foo/$h agent list" "see the $h docs" "$h-mode.md" "Run the $h skill" "${h}s agent"; do
  assert_eq "C-11 allows prose: $t" "0" "$(grep -cE "$re" <<<"$t")"
done

par_wait

finish
