#!/usr/bin/env bash
# Row T (ship-mux) — the dispatcher scripts/ship/ship-mux against mux/fake: the
# shared backend contract, the ownership record, close cascades, group close
# rules, record write failures, locks, exit codes, the fake's call log and
# scripted answers, the unknown backend, and the C-11 pattern.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
source "$TESTS_DIR/lib/mux-contract.sh"
set +eu
set +o pipefail

MUX_BIN="$SCRIPTS_DIR/ship/ship-mux"
FAKE_BE="$SCRIPTS_DIR/ship/mux/fake"
SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
PROJECT="$SPACE/.hyper/ship.yml"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
printf 'mux: fake\n' > "$PROJECT"   # no gate: ship-mux must not need one
WT="$SPACE/worktrees/wt"

# Load the config once and let every ship-mux call inherit it (SHIP_CONFIG_JSON),
# as the scripts of one run do; the sections that edit ship.yml reload it.
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"
reload_cfg() { unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load; }
reload_cfg

mux() { (cd "$WT" && bash "$MUX_BIN" "$@" 2>/dev/null); }
mux_rc() { (cd "$WT" && bash "$MUX_BIN" "$@" >/dev/null 2>&1); echo $?; }
# shellcheck disable=SC2069
mux_err() { (cd "$WT" && bash "$MUX_BIN" "$@" 2>&1 >/dev/null); }
log_lines() { [[ -f "$SHIP_MUX_FAKE_LOG" ]] && wc -l <"$SHIP_MUX_FAKE_LOG" | tr -d ' ' || echo 0; }
log_has() { jq -e --arg v "$1" --arg a "$2" 'select(.verb == $v and (.args | index($a)))' "$SHIP_MUX_FAKE_LOG" >/dev/null 2>&1; }
rec() { cat "$SPACE/notes/loops/$1/mux.json"; }
ids_of() { rec "$1" | jq -r '[.created[].id] | sort | join(" ")'; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/notes" "$SPACE/.hyper/ship-mux.json" "$SPACE/.hyper"/ship-mux.*lock; }
vanish() { rm -f "$SHIP_MUX_FAKE_DIR/state/$1.json"; }
start_agent() { mux start --ref "$1" --space "$2" --name "${3:-dev}" --harness claude --cwd "$WT"; }

# 1: the shared contract --------------------------------------------------------
reset_fake
# shellcheck disable=SC2034  # read by mux_contract
MUX_CONTRACT_BACKEND=(bash "$FAKE_BE")
mux_contract_vanish() { vanish "$1"; }
mux_contract_exit_agent() { echo gone > "$SHIP_MUX_FAKE_DIR/status/$1"; }
mux_contract contract "$WT"
unset MUX_CONTRACT_BACKEND

# 2: open: idempotency, the record, warnings ---------------------------------------
reset_fake
o1="$(mux open --ref u1 --cwd "$WT" --label unit-one)"
o2="$(mux open --ref u1 --cwd "$WT" --label unit-one)"
assert_eq "open twice returns the same ids" "$o1" "$o2"
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
w="$(mux_err open --ref u1 --cwd /somewhere/else)"
assert_contains "open with another cwd warns on stderr" "$w" "already open with cwd"
assert_eq "...and still returns the existing space" "$o1" "$(mux open --ref u1 --cwd /somewhere/else)"
assert_eq "...and keeps the first cwd on record" "$WT" "$(rec u1 | jq -r '.created[] | select(.kind == "space") | .cwd')"
assert_eq "open with the same cwd does not warn" "" "$(mux_err open --ref u1 --cwd "$WT")"

# 3: round trip with scripted answers ------------------------------------------------
st="$(mux start --ref u1 --space "$SP" --name dev-1 --harness pi --cwd "$WT" -- --model x --verbose)"
AG="$(jq -r .agent <<<"$st")"; APN="$(jq -r .pane <<<"$st")"
assert_eq "start records the agent (with its pane) and the pane" "4" "$(rec u1 | jq '.created | length')"
assert_eq "the agent entry carries its pane" "$APN" "$(rec u1 | jq -r --arg a "$AG" '.created[] | select(.id == $a) | .pane')"
assert_eq "start forwards the harness args after --" '["--model","x","--verbose"]' \
  "$(jq -c 'select(.verb == "start") | .args | .[index("--") + 1:]' "$SHIP_MUX_FAKE_LOG")"
assert_eq "status defaults to idle" "idle" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
printf 'working\nidle\n' > "$SHIP_MUX_FAKE_DIR/status/dev-1"
assert_eq "scripted status by name: first line" "working" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
assert_eq "scripted status by name: then the next" "idle" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
assert_eq "scripted status keeps the last line" "idle" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
printf 'blocked\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "scripted status by id wins" "blocked" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
assert_eq "wait --until idle times out with exit 4 while blocked" "4" "$(mux_rc wait --ref u1 --to "$AG" --until idle --timeout-ms 10)"
printf 'working\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_ok "wait --until working is reached" mux wait --ref u1 --to "$AG" --until working --timeout-ms 10
assert_eq "wait --until gone on a live agent exits 4" "4" "$(mux_rc wait --ref u1 --to "$AG" --until gone --timeout-ms 10)"
assert_eq "send --wait-ms exits 0 when the agent starts working" "0" "$(mux_rc send --ref u1 --to "$AG" --text go --wait-ms 50)"
printf 'idle\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "send --wait-ms exits 4 when the agent never starts working" "4" "$(mux_rc send --ref u1 --to "$AG" --text go2 --wait-ms 50)"
printf 'line1\nline2\nline3\n' > "$SHIP_MUX_FAKE_DIR/read/dev-1"
assert_eq "read prints the scripted screen, then what was sent" "line1
line2
line3
go
go2" "$(mux read --ref u1 --to "$AG")"
assert_eq "read --lines keeps the last N" "go2" "$(mux read --ref u1 --to "$AG" --lines 1)"
assert_eq "read by pane id shows the agent's screen" "go2" "$(mux read --ref u1 --to "$APN" --lines 1)"
mux run --ref u1 --pane "$PN" -- echo hello world >/dev/null
assert_eq "run appends the command to the pane's screen" '$ echo hello world' "$(mux read --ref u1 --to "$PN")"
mux send --ref u1 --to "$AG" --keys enter,ctrl+d >/dev/null
assert_eq "sent text and keys are recorded for assertions" "go
go2
<keys:enter,ctrl+d>" "$(cat "$SHIP_MUX_FAKE_DIR/sent/$AG")"
printf 'sleeping\n' > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "an unknown scripted state is an error (status)" "1" "$(mux_rc status --ref u1 --to "$AG")"
assert_eq "an unknown scripted state is an error (wait)" "1" "$(mux_rc wait --ref u1 --to "$AG" --until idle --timeout-ms 5)"
assert_eq "an unknown scripted state is an error (list)" "1" "$(mux_rc list --ref u1)"
rm -f "$SHIP_MUX_FAKE_DIR/status/$AG" "$SHIP_MUX_FAKE_DIR/status/dev-1"
assert_eq "status of a pane id: the dispatcher refuses (3)" "3" "$(mux_rc status --ref u1 --to "$PN")"
assert_eq "status of a pane id: the fake itself exits 1" "1" "$(bash "$FAKE_BE" status --ref u1 --to "$PN" >/dev/null 2>&1; echo $?)"
echo gone > "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "gone is a scripted state: status says gone (0)" "gone" "$(mux status --ref u1 --to "$AG" | jq -r .state)"
assert_ok "wait --until gone returns 0 for a scripted gone state" mux wait --ref u1 --to "$AG" --until gone --timeout-ms 5
rm -f "$SHIP_MUX_FAKE_DIR/status/$AG"
assert_eq "wait --until gone on a live pane exits 4" "4" "$(mux_rc wait --ref u1 --to "$PN" --until gone --timeout-ms 5)"
assert_eq "send to a pane id is an error" "1" "$(mux_rc send --ref u1 --to "$PN" --text x)"
assert_eq "...even when the pane is recorded (agent pane)" "1" "$(mux_rc send --ref u1 --to "$APN" --text x)"

# 4: refusals make no backend call -----------------------------------------------------
n_before="$(log_lines)"
for args in "close --ref u1 --id agent-999" "read --ref u1 --to agent-999" "send --ref u1 --to agent-999 --text x" \
            "status --ref u1 --to agent-999" "wait --ref u1 --to agent-999 --until ready --timeout-ms 5" \
            "run --ref u1 --pane pane-999 -- true" "close --ref u2 --id $SP" "read --ref u2 --to $AG" "close --ref u1 --id $PN"; do
  assert_eq "refused with exit 3: $args" "3" "$(mux_rc $args)"
done
assert_eq "...and none of them reached the backend" "$n_before" "$(log_lines)"
assert_contains "the refusal says why" "$(mux_err close --ref u1 --id agent-999)" "not recorded"
assert_contains "the root pane refusal says to close the space" "$(mux_err close --ref u1 --id "$PN")" "close the space"

# 5: close cascades ---------------------------------------------------------------------
assert_eq "close of a recorded agent exits 0" "0" "$(mux_rc close --ref u1 --id "$AG")"
assert_eq "closing the agent also closed its pane on the backend" "yes" "$(log_has close "$APN" && echo yes || echo no)"
assert_eq "both entries left the record" "$(printf '%s %s' "$PN" "$SP" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" "$(ids_of u1)"
assert_eq "the closed agent is no longer addressable (3)" "3" "$(mux_rc status --ref u1 --to "$AG")"
# a pane takes its agents
a2="$(start_agent u1 "$SP" two)"; AG2="$(jq -r .agent <<<"$a2")"; AP2="$(jq -r .pane <<<"$a2")"
assert_eq "close of an agent's pane exits 0" "0" "$(mux_rc close --ref u1 --id "$AP2")"
assert_eq "...and drops the agent from the record" "$(printf '%s %s' "$PN" "$SP" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" "$(ids_of u1)"
assert_eq "...and the backend lost the agent with its pane" "[]" "$(mux list --ref u1 | jq -c --arg a "$AG2" '[.[] | select(.id == $a)]')"
# an id the backend lost: exit 5 maps to 0 and the entry goes
a3="$(start_agent u1 "$SP" three)"; AG3="$(jq -r .agent <<<"$a3")"; AP3="$(jq -r .pane <<<"$a3")"
vanish "$AG3"; vanish "$AP3"
assert_eq "close of an agent the backend lost exits 0" "0" "$(mux_rc close --ref u1 --id "$AG3")"
assert_eq "...and both entries left the record" "$(printf '%s %s' "$PN" "$SP" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" "$(ids_of u1)"
assert_eq "the fake answers 5 for a gone id" "5" "$(bash "$FAKE_BE" close --ref u1 --id agent-nope >/dev/null 2>&1; echo $?)"
a4="$(start_agent u1 "$SP" four)"; AP4="$(jq -r .pane <<<"$a4")"; vanish "$AP4"
assert_eq "close of a pane the backend lost exits 0" "0" "$(mux_rc close --ref u1 --id "$AP4")"
# a space takes everything recorded under it
start_agent u1 "$SP" five >/dev/null
assert_eq "close of the space exits 0" "0" "$(mux_rc close --ref u1 --id "$SP")"
assert_eq "the record is empty after the space closes" "0" "$(rec u1 | jq '.created | length')"
assert_eq "list is empty after the space closes" "[]" "$(mux list --ref u1 | jq -c .)"
# a space the backend lost
b="$(mux open --ref lost --cwd "$WT")"; vanish "$(jq -r .space <<<"$b")"
assert_eq "close of a space the backend lost exits 0" "0" "$(mux_rc close --ref lost --id "$(jq -r .space <<<"$b")")"
assert_eq "...and the record is empty" "0" "$(rec lost | jq '.created | length')"

# 6: list shows both names ----------------------------------------------------------------
reset_fake
LONG="a-very-long-unit-label-that-the-backend-shortens"
mux open --ref nm --cwd "$WT" --label "$LONG" >/dev/null
l="$(mux list --ref nm)"
assert_eq "list name is the caller's name" "$LONG" "$(jq -r '[.[] | select(.kind == "space")] | first | .name' <<<"$l")"
assert_eq "list backend_name is the backend's, shortened" "${LONG:0:24}" "$(jq -r '[.[] | select(.kind == "space")] | first | .backend_name' <<<"$l")"
assert_eq "the dispatcher handed the recorded ids to the backend" "yes" \
  "$(jq -e 'select(.verb == "list") | .args | index("--ids")' "$SHIP_MUX_FAKE_LOG" >/dev/null && echo yes || echo no)"

# 7: group close computed from the records ------------------------------------------------
reset_fake
a="$(mux open --ref ga --cwd "$WT")"
b="$(mux open --ref gb --cwd "$WT")"
G="$(jq -r .group <<<"$a")"
assert_eq "both refs share one group" "$G" "$(jq -r .group <<<"$b")"
n_before="$(log_lines)"
assert_eq "group close with spaces left exits 3" "3" "$(mux_rc close --ref ga --id "$G")"
mux close --ref ga --id "$(jq -r .space <<<"$a")" >/dev/null
assert_eq "still refused while the other ref's space is recorded" "3" "$(mux_rc close --ref ga --id "$G")"
assert_eq "...with no close of the group on the backend" "no" "$(log_has close "$G" && echo yes || echo no)"
# a space recorded in a third ref that the group file never heard of still counts
mkdir -p "$SPACE/notes/loops/third"
jq -nc --arg g "$G" '{backend: "fake", created: [{id: "space-x", kind: "space", name: "t", group: $g}]}' > "$SPACE/notes/loops/third/mux.json"
mux close --ref gb --id "$(jq -r .space <<<"$b")" >/dev/null
assert_eq "a space recorded only in a ref's mux.json keeps the group open" "3" "$(mux_rc close --ref gb --id "$G")"
assert_contains "...and the refusal points at the records" "$(mux_err close --ref gb --id "$G")" "notes/loops"
rm -rf "$SPACE/notes/loops/third"
assert_eq "group close of an empty ship-created group exits 0" "0" "$(mux_rc close --ref gb --id "$G")"
assert_eq "the backend saw the group close" "yes" "$(log_has close "$G" && echo yes || echo no)"
assert_eq "the group leaves the record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"
assert_eq "a second group close exits 3" "3" "$(mux_rc close --ref gb --id "$G")"

# 7a: a mux.json that does not parse counts as holding spaces
reset_fake
a="$(mux open --ref gj --cwd "$WT")"; G="$(jq -r .group <<<"$a")"
mux close --ref gj --id "$(jq -r .space <<<"$a")" >/dev/null
mkdir -p "$SPACE/notes/loops/broken"; echo '{not json' > "$SPACE/notes/loops/broken/mux.json"
assert_eq "group close is refused when a record does not parse" "3" "$(mux_rc close --ref gj --id "$G")"
assert_contains "...naming the file" "$(mux_err close --ref gj --id "$G")" "broken/mux.json"
assert_eq "...with no close on the backend" "no" "$(log_has close "$G" && echo yes || echo no)"
rm -rf "$SPACE/notes/loops/broken"
assert_eq "...and it closes once the record is gone" "0" "$(mux_rc close --ref gj --id "$G")"
assert_eq "the group record is gone before the lock is released" "no" "$([[ -e "$SPACE/.hyper/ship-mux.ops.lock" ]] && echo yes || echo no)"

# 7b: a group that already existed is never closed -------------------------------------------
reset_fake
mkdir -p "$SHIP_MUX_FAKE_DIR/groups"; echo proj-units > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
a="$(mux open --ref gp --cwd "$WT")"
G="$(jq -r .group <<<"$a")"
assert_eq "a pre-existing group is recorded as not ship-created" "false" "$(jq -r --arg g "$G" '.groups[$g].created' "$SPACE/.hyper/ship-mux.json")"
mux close --ref gp --id "$(jq -r .space <<<"$a")" >/dev/null
n_before="$(log_lines)"
assert_eq "group close of a pre-existing group exits 3" "3" "$(mux_rc close --ref gp --id "$G")"
assert_contains "...and says it was not created by ship" "$(mux_err close --ref gp --id "$G")" "not created by ship"
assert_eq "...with no close on the backend" "no" "$(log_has close "$G" && echo yes || echo no)"

# 7c: a group renamed or gone on the backend ---------------------------------------------------
reset_fake
a="$(mux open --ref gr --cwd "$WT")"; G="$(jq -r .group <<<"$a")"
mux close --ref gr --id "$(jq -r .space <<<"$a")" >/dev/null
echo "someone-elses-group" > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
assert_eq "group close is refused when the backend reports another name for the id" "3" "$(mux_rc close --ref gr --id "$G")"
assert_contains "...and says so" "$(mux_err close --ref gr --id "$G")" "now named"
assert_eq "...with no close on the backend" "no" "$(log_has close "$G" && echo yes || echo no)"
rm -f "$SHIP_MUX_FAKE_DIR/groups/proj-units"
assert_eq "group close of a group the backend lost exits 0" "0" "$(mux_rc close --ref gr --id "$G")"
assert_eq "...and drops it from the record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"
# the backend refuses a group with children even if asked directly
reset_fake
a="$(mux open --ref gc --cwd "$WT")"; G="$(jq -r .group <<<"$a")"
assert_eq "the backend itself refuses to close a group with children" "1" "$(bash "$FAKE_BE" close --ref gc --id "$G" >/dev/null 2>&1; echo $?)"

# 8: record write failures roll back what was created ------------------------------------------
reset_fake
mkdir -p "$SPACE"; : > "$SPACE/notes"   # notes is a file: no record can be written
assert_eq "open exits 1 when the record cannot be written" "1" "$(mux_rc open --ref rb --cwd "$WT")"
assert_eq "...the space it created was closed again" "0" "$(find "$SHIP_MUX_FAKE_DIR/state" -name '*.json' | wc -l | tr -d ' ')"
assert_eq "...and so was the group it created" "0" "$(ls "$SHIP_MUX_FAKE_DIR/groups" | wc -l | tr -d ' ')"
assert_eq "...and the group record holds nothing" "{}" "$(jq -c '.groups // {}' "$SPACE/.hyper/ship-mux.json" 2>/dev/null || echo '{}')"
rm -f "$SPACE/notes"
a="$(mux open --ref rb2 --cwd "$WT")"; SP2="$(jq -r .space <<<"$a")"
if [[ "$(id -u)" != 0 ]]; then
  chmod a-w "$SPACE/notes/loops/rb2"
  assert_eq "start exits 1 when the record cannot be written" "1" "$(SHIP_MUX_LOCK_TRIES=2 mux_rc start --ref rb2 --space "$SP2" --name x --harness claude --cwd "$WT")"
  chmod u+w "$SPACE/notes/loops/rb2"
  assert_eq "...and leaves no agent behind" "0" "$(grep -l '"kind":"agent"' "$SHIP_MUX_FAKE_DIR"/state/*.json 2>/dev/null | wc -l | tr -d ' ')"
else
  skip "start rollback needs a non-root user" root
fi
assert_eq "start into an unrecorded space exits 3" "3" "$(mux_rc start --ref rb2 --space space-404 --name x --harness claude --cwd "$WT")"
n_before="$(log_lines)"
assert_eq "...and into a pane exits 3" "3" "$(mux_rc start --ref rb2 --space "$(jq -r .pane <<<"$a")" --name x --harness claude --cwd "$WT")"
assert_eq "...with no backend call" "$n_before" "$(log_lines)"

# 8b: a rollback close that fails names the orphan
PLUG="$FIX/plugin"
mkdir -p "$PLUG/scripts/ship/mux" "$PLUG/skills/ship"
cp "$SCRIPTS_DIR/ship/ship-mux" "$SCRIPTS_DIR/ship/lib.sh" "$PLUG/scripts/ship/"
cp "$SCRIPTS_DIR/hyper-require-lib.sh" "$PLUG/scripts/"
cp "$PLUGIN_DIR/skills/ship/defaults.yml" "$PLUG/skills/ship/"
printf '#!/usr/bin/env bash\n[[ "$1" == close ]] && exit 1\nexec bash "%s" "$@"\n' "$FAKE_BE" > "$PLUG/scripts/ship/mux/flaky"
printf 'mux: flaky\n' > "$PROJECT"; reload_cfg
reset_fake
: > "$SPACE/notes"
e="$(cd "$WT" && bash "$PLUG/scripts/ship/ship-mux" open --ref orp --cwd "$WT" 2>&1 >/dev/null; echo "rc=$?")"
assert_contains "open still exits 1 when the rollback close fails" "$e" "rc=1"
assert_contains "...and names the orphan on stderr" "$e" "orphaned"
assert_contains "...with its id" "$e" "'space-"
rm -f "$SPACE/notes"
printf 'mux: fake\n' > "$PROJECT"; reload_cfg

# 9: locks --------------------------------------------------------------------------------------
reset_fake
mkdir -p "$SPACE/notes/loops/lk"
dead=999999; while kill -0 "$dead" 2>/dev/null; do dead=$((dead + 1)); done
echo "$dead@$(hostname)" > "$SPACE/notes/loops/lk/mux.json.lock"
start_s=$SECONDS
assert_eq "a lock whose owner died on this host is taken over" "0" "$(mux_rc open --ref lk --cwd "$WT")"
assert_eq "...without waiting for a timeout" "1" "$([[ $((SECONDS - start_s)) -lt 5 ]] && echo 1 || echo 0)"
assert_eq "...and the lock is released" "no" "$([[ -e "$SPACE/notes/loops/lk/mux.json.lock" ]] && echo yes || echo no)"
echo "4242@some-other-host" > "$SPACE/.hyper/ship-mux.json.lock"
touch -t 200001010000 "$SPACE/.hyper/ship-mux.json.lock"
assert_eq "a lock older than 120 s is taken over (owner on another host)" "0" "$(mux_rc open --ref lk2 --cwd "$WT")"
assert_eq "an old lock without an owner file is taken over" "0" "$(: > "$SPACE/.hyper/ship-mux.ops.lock"; touch -t 200001010000 "$SPACE/.hyper/ship-mux.ops.lock"; mux_rc open --ref lk3 --cwd "$WT")"
# a live owner is never taken over, however old the lock
reset_fake
sleep 60 & LIVE=$!
mkdir -p "$SPACE/notes/loops/lv"
echo "$LIVE@$(hostname)" > "$SPACE/notes/loops/lv/mux.json.lock"
touch -t 200001010000 "$SPACE/notes/loops/lv/mux.json.lock"
assert_eq "a live, aged owner on this host is not taken over (open times out, 1)" "1" "$(SHIP_MUX_LOCK_TRIES=3 mux_rc open --ref lv --cwd "$WT")"
assert_eq "...and its lock is untouched" "$LIVE@$(hostname)" "$(cat "$SPACE/notes/loops/lv/mux.json.lock")"
kill "$LIVE" 2>/dev/null; wait "$LIVE" 2>/dev/null
assert_eq "once that owner is dead the lock is taken over" "0" "$(mux_rc open --ref lv --cwd "$WT")"
# unlock and the exit trap leave a lock that was taken over alone
{ printf 'source "%s/scripts/ship/lib.sh"\n' "$PLUG"; sed -n '/^_held=()/,/^rec_default=/p' "$MUX_BIN" | sed '$d'; } > "$FIX/locks.sh"
mkdir -p "$FIX/lk"
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

# 10: exit codes of the dispatcher and of a backend ---------------------------------------------
printf '#!/usr/bin/env bash\nexit "${SHIP_TEST_RC:?}"\n' > "$PLUG/scripts/ship/mux/rc"
printf 'mux: rc\n' > "$PROJECT"; reload_cfg
for rc in 2 3; do
  assert_eq "a backend exit $rc becomes 1" "1" "$(cd "$WT" && SHIP_TEST_RC=$rc bash "$PLUG/scripts/ship/ship-mux" check >/dev/null 2>&1; echo $?)"
done
for rc in 4 99; do
  assert_eq "a backend exit $rc passes through" "$rc" "$(cd "$WT" && SHIP_TEST_RC=$rc bash "$PLUG/scripts/ship/ship-mux" check >/dev/null 2>&1; echo $?)"
done
printf 'mux: fake\n' > "$PROJECT"; reload_cfg

# 11: the call log -----------------------------------------------------------------------------
reset_fake
mux open --ref lg --cwd "$WT" >/dev/null
mux check
mux list --ref lg >/dev/null
assert_eq "every backend call is one valid JSON line" "3" "$(jq -c 'select(.verb != null and (.args | type == "array"))' "$SHIP_MUX_FAKE_LOG" | wc -l | tr -d ' ')"
assert_eq "the verbs are logged in order" "open check list" "$(jq -r .verb "$SHIP_MUX_FAKE_LOG" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "the fake refuses to run without its log" "1" "$( (unset SHIP_MUX_FAKE_LOG; cd "$WT" && bash "$MUX_BIN" check >/dev/null 2>&1; echo $?) )"
echo "unplugged" > "$SHIP_MUX_FAKE_DIR/check-fail"
assert_eq "check surfaces the backend's failure" "1" "$(mux_rc check)"
rm -f "$SHIP_MUX_FAKE_DIR/check-fail"

# 12: unknown backend and config errors ---------------------------------------------------------
printf 'mux: nosuch\n' > "$PROJECT"; reload_cfg
assert_eq "unknown mux exits 1" "1" "$(mux_rc check)"
assert_contains "...naming the value" "$(mux_err check)" "nosuch"
for v in "check" "open --ref r --cwd /" "list --ref r"; do
  assert_eq "unknown mux exits 1 for: $v" "1" "$(mux_rc $v)"
done
printf 'mux: ../fake\n' > "$PROJECT"; reload_cfg
assert_eq "a path-like mux value is refused" "1" "$(mux_rc check)"
printf 'mux: fake\n: not yaml [\n' > "$PROJECT"; reload_cfg 2>/dev/null
assert_eq "a malformed config exits 1" "1" "$(mux_rc check)"
printf 'mux: fake\n' > "$PROJECT"; reload_cfg
assert_eq "the mux is picked up again from config" "0" "$(mux_rc check)"
assert_eq "no gate is set in the config" "0" "$(grep -c '^gate' "$PROJECT")"

# 13: usage errors ---------------------------------------------------------------------------------
assert_eq "no verb exits 2" "2" "$(mux_rc)"
assert_eq "unknown verb exits 2" "2" "$(mux_rc nope)"
assert_eq "open without --cwd exits 2" "2" "$(mux_rc open --ref r)"
assert_eq "an unsafe ref exits 2" "2" "$(mux_rc list --ref ../x)"
assert_eq "an unknown flag exits 2" "2" "$(mux_rc list --ref r --bogus 1)"
assert_eq "wait with a bad --until exits 2" "2" "$(mux_rc wait --ref r --to a --until sleeping --timeout-ms 1)"
assert_eq "send needs --ref (design table)" "2" "$(mux_rc send --to a --text x)"
assert_eq "read needs --ref" "2" "$(mux_rc read --to a)"
assert_eq "run without a command exits 2" "2" "$(mux_rc run --ref r --pane p)"
assert_contains "--help prints the interface doc" "$(bash "$MUX_BIN" --help)" "Ownership record"
assert_not_contains "--help stops before the code" "$(bash "$MUX_BIN" --help)" "set -euo"

# 14: the C-11 pattern ---------------------------------------------------------------------------------
re="$(herdr_invocation_re)"
h=herd; h+=r
for t in "$h status" "x $h --no-focus pane list" "command -v $h" "$h agent list" "echo \"$h pane\"" "type -p $h" "which $h" "$h --x y worktree open" "(cd x; $h tab list)"; do
  assert_eq "C-11 flags: $t" "1" "$(grep -cE "$re" <<<"$t")"
done
for t in "$h is the only real backend" "the $h stub" "foo/$h agent list" "see the $h docs" "$h-mode.md" "Run the $h skill" "${h}s agent"; do
  assert_eq "C-11 allows prose: $t" "0" "$(grep -cE "$re" <<<"$t")"
done

finish
