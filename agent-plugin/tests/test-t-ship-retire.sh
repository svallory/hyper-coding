#!/usr/bin/env bash
# shellcheck disable=SC2034  # SPACE and friends are read by ship-mux / ship-retire through the environment
# Row T (ship-retire) — stopping one agent the way its harness expects, over mux/fake: the keys each harness
# gets, an agent that is already gone, the refusals, the escalation and the timeout. Moved out of
# test-t-ship-land.sh (its section 10) unchanged except the waits: SHIP_RETIRE_POLL is 0.1 and the two
# --timeout 3 runs are 1 and 2. No real multiplexer is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
RETIRE="$SHIP_DIR/ship-retire"
MUXBIN="$SHIP_DIR/ship-mux"
SPACE="$FIX/proj"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_RETIRE_POLL=0.1
mkdir -p "$SPACE/.hyper" "$SPACE/notes/loops"
printf 'mux: fake\n' > "$SPACE/.hyper/ship.yml"
# The config is loaded once and inherited by every call, as in one real run.
# shellcheck source=../../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
ship_config_load

# A reaper stands in for agents that quit when told to: any agent that has been sent something
# disappears, unless $FIX/noreap exists.
(
  while :; do
    if [[ ! -e "$FIX/noreap" ]]; then
      for s in "$SHIP_MUX_FAKE_DIR"/sent/*; do
        [[ -e "$s" ]] || continue
        rm -f "$SHIP_MUX_FAKE_DIR/state/${s##*/}.json"
      done
    fi
    sleep 0.1
  done
) &
REAPER=$!
trap 'kill $REAPER 2>/dev/null' EXIT

mux() { bash "$MUXBIN" "$@" 2>/dev/null; }
sent_file() { echo "$SHIP_MUX_FAKE_DIR/sent/$1"; }
state_exists() { [[ -f "$SHIP_MUX_FAKE_DIR/state/$1.json" ]]; }

reset_mux() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/notes/loops/r1" "$SPACE/.hyper/ship-mux.json"; }
mk_agent() { # harness -> RA RP
  local s a
  s="$(mux open --ref r1 --cwd "$FIX" --label r1)"
  a="$(mux start --ref r1 --space "$(jq -r .space <<<"$s")" --name "a-$1" --harness "$1" --cwd "$FIX")"
  RA="$(jq -r .agent <<<"$a")"; RP="$(jq -r .pane <<<"$a")"
}
retire() { bash "$RETIRE" "$@" 2>"$FIX/ret.err" >"$FIX/ret.out"; echo $?; }
reset_mux
mk_agent claude
assert_eq "retire a claude agent: exit 0" "0" "$(retire --ref r1 --harness claude "$RA")"
assert_eq "...it was told /exit" "/exit" "$(cat "$(sent_file "$RA")")"
assert_eq "...and its pane closed with it" "no" "$(state_exists "$RP" && echo yes || echo no)"
assert_eq "...and it is off the record" "0" "$(jq '[.created[] | select(.id == "'"$RA"'" or .id == "'"$RP"'")] | length' "$SPACE/notes/loops/r1/mux.json")"
reset_mux
mk_agent pi
retire --ref r1 --harness pi "$RA" >/dev/null
assert_eq "a pi agent is sent ctrl+d, never a prompt" "<keys:ctrl+d>" "$(cat "$(sent_file "$RA")")"
reset_mux
mk_agent claude
retire --ref r1 "$RA" >/dev/null
assert_eq "an agent whose record names no harness is sent ctrl+d twice" "<keys:ctrl+d,ctrl+d>" "$(cat "$(sent_file "$RA")")"
reset_mux
mk_agent claude
touch "$FIX/noreap"
retire --ref r1 --harness codex --timeout 1 "$RA" >/dev/null
assert_eq "a codex agent is sent ctrl+c twice before escalation" "<keys:ctrl+c> <keys:ctrl+c>" "$(head -n 2 "$(sent_file "$RA")" | tr '\n' ' ' | sed 's/ $//')"
rm -f "$FIX/noreap"
reset_mux
mk_agent claude
rm -f "$SHIP_MUX_FAKE_DIR/state/$RA.json"
assert_eq "an agent that is already gone: exit 0" "0" "$(retire --ref r1 --harness claude "$RA")"
assert_eq "...nothing was sent to it" "no" "$([[ -e "$(sent_file "$RA")" ]] && echo yes || echo no)"
assert_eq "...its pane was still closed" "no" "$(state_exists "$RP" && echo yes || echo no)"
assert_eq "a pane id (not an agent) is refused (3)" "3" "$(retire --ref r1 --harness claude "$RP")"
assert_eq "an id not recorded for the ref is refused (3)" "3" "$(retire --ref r1 agent-999)"
assert_eq "a missing --ref is a usage error (2)" "2" "$(retire agent-1)"
assert_eq "a bad --harness is a usage error (2)" "2" "$(retire --ref r1 --harness bash agent-1)"
reset_mux
mk_agent claude
touch "$FIX/noreap"
assert_eq "an agent that will not stop: exit 4 after the timeout" "4" "$(retire --ref r1 --harness claude --timeout 2 "$RA")"
assert_contains "...it was escalated (esc, ctrl+c) before giving up" "$(cat "$(sent_file "$RA")")" "<keys:esc>"
assert_eq "...and its pane is left open" "yes" "$(state_exists "$RP" && echo yes || echo no)"
rm -f "$FIX/noreap"

# send exits 5 (the id vanished after status): not an error, the agent is closed
reset_mux
mk_agent claude
W="$FIX/wrapped"; rm -rf "$W"; mkdir -p "$W"
cp "$RETIRE" "$W/ship-retire"
cat > "$W/ship-mux" <<WRAP
#!/usr/bin/env bash
if [[ "\$1" == send ]]; then rm -f "$SHIP_MUX_FAKE_DIR/state/$RA.json"; fi
exec bash "$MUXBIN" "\$@"
WRAP
chmod +x "$W/ship-mux"
rc="$(SHIP_PLUGIN_ROOT="$PLUGIN_DIR" bash "$W/ship-retire" --ref r1 --harness claude "$RA" >/dev/null 2>&1; echo $?)"
assert_eq "send exiting 5 (target vanished) is treated as gone: exit 0" "0" "$rc"
assert_eq "...the pane was closed" "no" "$(state_exists "$RP" && echo yes || echo no)"
assert_eq "...and the record is clean" "0" "$(jq '[.created[] | select(.kind != "space" and .root != true)] | length' "$SPACE/notes/loops/r1/mux.json")"
# status scripted "gone" (process exited, id still there)
reset_mux
mk_agent claude
printf 'gone\n' > "$SHIP_MUX_FAKE_DIR/status/$RA"
assert_eq "state gone with exit 0 is treated as gone: exit 0, nothing sent" "0 no" "$(retire --ref r1 --harness claude "$RA") $([[ -e "$(sent_file "$RA")" ]] && echo yes || echo no)"

finish
