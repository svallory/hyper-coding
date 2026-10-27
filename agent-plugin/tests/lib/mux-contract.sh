#!/usr/bin/env bash
# Shared mux backend contract (C-13). Source it from a backend's test after
# tests/helpers.sh; it defines mux_contract and runs nothing by itself.
#
#   source "$TESTS_DIR/lib/mux-contract.sh"
#   mux() { ...run scripts/ship/ship-mux with the backend under test...; }
#   mux_contract <ref-prefix> <cwd>
#
# `mux` must run ship-mux inside a configured space (SHIP_SPACE_ROOT set) with the
# backend selected (mux: <name>) and its environment set up. Every id comes from
# the backend's own output; each case uses refs of its own so a backend that
# leaks state between refs fails. Optional:
#   MUX_CONTRACT_HARNESS    harness the agents start with (default claude; a
#                           real backend's test may use pi or sh-like stand-ins)
#   MUX_CONTRACT_AGENT_ARGS array of harness arguments after `--` (default none)
#   MUX_CONTRACT_BACKEND    array: a command that runs the backend file itself
#                           (not ship-mux) with its environment, to check what
#                           ship-mux's own checks would mask: a backend refuses
#                           to close a group that still has children
#   mux_contract_exit_agent ID  function: make agent ID exit while it still exists
#                           (state gone), to check status says gone (exit 0) and
#                           wait --until gone returns 0
#   mux_contract_direct ARGS  function: run the backend file itself with ARGS (a ship-mux verb line) for the calls
#                           whose answer the dispatcher does not change; optional, default is mux
#   mux_contract_vanish ID  function: make the backend lose ID behind ship-mux's
#                           back (an agent that exited), to check close of a gone
#                           id exits 0 and drops the entry
#
# Behaviour is asserted, not shapes: run output and sent text come back through
# read, status reports the pane and space it was started in, list reports the
# ids it was given, another ref's ids never leak, wait times out (exit 4) on a
# state that is not reached, closing an agent takes its pane, closing a pane
# takes its agents, a space's root pane cannot be closed, and the units group
# closes only when ship created it and no space is left.

# _mc_json <desc> <json> <jq -e filter>
_mc_json() {
  if jq -e "$3" >/dev/null 2>&1 <<<"$2"; then pass "$1"; else fail "$1 (got: $2)"; fi
}

# _mc_ids <list json> — the ids, one per line.
_mc_ids() { jq -r '.[].id' <<<"$1"; }

# _mc_has <list json> <id> — id is listed.
_mc_has() { jq -e --arg id "$2" 'any(.[]; .id == $id)' >/dev/null 2>&1 <<<"$1"; }

# _mcd <mux args> - a call whose answer the dispatcher does not change (the happy path, and what a backend
# answers for an id it lost). A test may define mux_contract_direct to run these straight against the backend
# file, skipping ship-mux's own startup; everything that tests ship-mux's records and refusals stays on mux.
_mcd() { if declare -F mux_contract_direct >/dev/null; then mux_contract_direct "$@"; else mux "$@"; fi; }

# _mc_rcs — stdin: lines "expected exit|description|mux arguments" (no quoting: the arguments are split on
# spaces). Runs them side by side, then asserts each one's exit code, in order.
_mc_rcs() {
  local d line exp desc args i=0 n
  d="$(mktemp -d "${TMPDIR:-/tmp}/mc-rcs.XXXXXX")"
  local -a exps=() descs=()
  while IFS='|' read -r exp desc args; do
    [[ -n "$exp" ]] || continue
    exps+=("$exp"); descs+=("$desc")
    # shellcheck disable=SC2086
    ( mux $args >/dev/null 2>&1; echo $? >"$d/$i" ) &
    i=$((i + 1))
  done
  wait
  for ((n = 0; n < i; n++)); do assert_eq "contract: ${descs[$n]}" "${exps[$n]}" "$(cat "$d/$n")"; done
  rm -rf "$d"
}

mux_contract() {
  local prefix="$1" cwd="$2" ref="$1-a" ref2="$1-b" harness="${MUX_CONTRACT_HARNESS:-claude}"
  local id u out rc sp pn g g2 ag apn ag2 apn2 ag3 apn3 ag4 unrelated unrelated_pn l created marker sent
  local grecord="${SHIP_SPACE_ROOT:-}/.hyper/ship-mux.json"

  assert_ok "contract: check succeeds" _mcd check

  # open: shape, idempotency, groups
  out="$(mux open --ref "$ref" --cwd "$cwd" --label "$ref")"
  _mc_json "contract: open prints space and pane ids" "$out" '(.space | type == "string" and length > 0) and (.pane | type == "string" and length > 0)'
  sp="$(jq -r .space <<<"$out")"; pn="$(jq -r .pane <<<"$out")"; g="$(jq -r '.group // ""' <<<"$out")"
  assert_eq "contract: open is idempotent per ref" "$out" "$(mux open --ref "$ref" --cwd "$cwd" --label "$ref")"
  assert_eq "contract: open with another cwd returns the existing space" "$out" "$(mux open --ref "$ref" --cwd "$cwd/elsewhere" --label "$ref")"
  unrelated_pn=""
  out="$(mux open --ref "$ref2" --cwd "$cwd")"
  unrelated="$(jq -r .space <<<"$out")"; unrelated_pn="$(jq -r .pane <<<"$out")"; g2="$(jq -r '.group // ""' <<<"$out")"
  assert_eq "contract: another ref gets another space" "1" "$([[ -n "$unrelated" && "$unrelated" != "$sp" ]] && echo 1 || echo 0)"
  assert_eq "contract: another ref gets another root pane" "1" "$([[ -n "$unrelated_pn" && "$unrelated_pn" != "$pn" ]] && echo 1 || echo 0)"
  if [[ -n "$g" ]]; then
    assert_eq "contract: the group id is stable across opens" "$g" "$g2"
  fi

  # run and read
  assert_ok "contract: wait --until ready on the opened pane" _mcd wait --ref "$ref" --to "$pn" --until ready --timeout-ms 5000
  marker="MARKER_${prefix}_run"
  assert_ok "contract: run a command in the pane" _mcd run --ref "$ref" --pane "$pn" -- echo "$marker"
  assert_contains "contract: run's output shows up in read" "$(_mcd read --ref "$ref" --to "$pn")" "$marker"

  # start and the round trip
  out="$(mux start --ref "$ref" --space "$sp" --name "$ref-dev" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
  _mc_json "contract: start prints agent and pane ids" "$out" '(.agent | type == "string" and length > 0) and (.pane | type == "string" and length > 0)'
  ag="$(jq -r .agent <<<"$out")"; apn="$(jq -r .pane <<<"$out")"
  out="$(_mcd status --ref "$ref" --to "$ag")"
  _mc_json "contract: status of a live agent is a known state" "$out" '.state | IN("working","idle","blocked")'
  assert_eq "contract: status reports the agent's pane" "$apn" "$(jq -r .pane <<<"$out")"
  assert_eq "contract: status reports the agent's space" "$sp" "$(jq -r .space <<<"$out")"
  assert_ok "contract: wait --until ready on the agent" _mcd wait --ref "$ref" --to "$ag" --until ready --timeout-ms 5000
  sent="SENT_${prefix}_text"
  assert_ok "contract: send --text" _mcd send --ref "$ref" --to "$ag" --text "$sent"
  assert_contains "contract: sent text shows up in read --to <agent>" "$(_mcd read --ref "$ref" --to "$ag")" "$sent"
  _mcd wait --ref "$ref" --to "$ag" --until gone --timeout-ms 100 >/dev/null 2>&1; rc=$?
  assert_eq "contract: wait --until gone on a live agent times out (4)" "4" "$rc"
  # Harmless keys only: ctrl+c / ctrl+d can end a real agent, so they go last, just before the close.
  assert_ok "contract: send --keys" _mcd send --ref "$ref" --to "$ag" --keys enter,esc
  assert_ok "contract: read the last lines of the pane" _mcd read --ref "$ref" --to "$apn" --lines 5
  if [[ "$(_mcd status --ref "$ref" --to "$ag" | jq -r .state)" == idle ]]; then
    _mcd wait --ref "$ref" --to "$ag" --until working --timeout-ms 100 >/dev/null 2>&1; rc=$?
    assert_eq "contract: wait --until working on an idle agent times out (4)" "4" "$rc"
  fi
  l="$(mux list --ref "$ref")"
  for id in "$sp" "$pn" "$ag" "$apn"; do
    if _mc_has "$l" "$id"; then pass "contract: list reports $id"; else fail "contract: list reports $id (got: $l)"; fi
  done
  _mc_json "contract: list entries have id, kind, name, backend_name, state" "$l" 'all(.[]; has("id") and has("kind") and has("name") and has("backend_name") and has("state"))'
  assert_eq "contract: list names the agent as the caller did (name)" "$ref-dev" "$(jq -r '[.[] | select(.kind == "agent") | .name] | first' <<<"$l")"
  for id in "$unrelated" "$unrelated_pn"; do
    if _mc_has "$l" "$id"; then fail "contract: list --ref $ref leaks another ref's $id"; else pass "contract: list --ref $ref leaves out another ref's $id"; fi
  done

  # refusals (3) and usage errors (2)
  # None of these reaches the backend or changes a record, so they run side by side (a dispatcher call is slow).
  _mc_rcs <<EOF
3|close of another ref's space exits 3|close --ref $ref --id $unrelated
3|close of an unrecorded id exits 3|close --ref $ref --id never-recorded-$prefix
3|wait on an unrecorded id exits 3|wait --ref $ref --to never-recorded-$prefix --until ready --timeout-ms 10
3|read of another ref's pane exits 3|read --ref $ref --to $unrelated_pn
3|run in another ref's pane exits 3|run --ref $ref --pane $unrelated_pn -- true
3|send to an unrecorded id exits 3|send --ref $ref --to never-recorded --text x
3|status of an unrecorded id exits 3|status --ref $ref --to never-recorded
3|closing a space's root pane exits 3|close --ref $ref --id $pn
1|send to a pane id is an error (1)|send --ref $ref --to $apn --text x
2|unknown verb exits 2|bogus
2|close without --ref exits 2|close --id x
2|send without --text or --keys exits 2|send --ref $ref --to $ag
2|send without --ref exits 2|send --to $ag --text x
2|send with an unknown key exits 2|send --ref $ref --to $ag --keys enter,f13
2|send with --text and --keys exits 2|send --ref $ref --to $ag --text a --keys enter
3|start into another ref's space exits 3|start --ref $ref --space $unrelated --name n --harness $harness --cwd $cwd
3|start into something that is not a space exits 3|start --ref $ref --space $pn --name n --harness $harness --cwd $cwd
3|start into an unrecorded id exits 3|start --ref $ref --space never-recorded-$prefix --name n --harness $harness --cwd $cwd
2|start with an unknown harness exits 2|start --ref $ref --space $sp --name n --harness emacs --cwd $cwd
EOF
  assert_ok "contract: ...and the space is still there" _mcd wait --ref "$ref" --to "$pn" --until ready --timeout-ms 5000
  _mc_json "contract: ...and none of them started anything" "$(mux list --ref "$ref")" '[.[] | select(.kind == "agent")] | length == 1'

  assert_ok "contract: send --keys ctrl+c,ctrl+d" _mcd send --ref "$ref" --to "$ag" --keys ctrl+c,ctrl+d

  # closing an agent takes its pane
  assert_ok "contract: close a recorded agent" mux close --ref "$ref" --id "$ag"
  mux status --ref "$ref" --to "$ag" >/dev/null 2>&1; rc=$?
  assert_eq "contract: a closed agent is no longer recorded: status exits 3" "3" "$rc"
  l="$(mux list --ref "$ref")"
  if _mc_has "$l" "$ag"; then fail "contract: list no longer holds the closed agent"; else pass "contract: list no longer holds the closed agent"; fi
  if _mc_has "$l" "$apn"; then fail "contract: closing the agent took its pane"; else pass "contract: closing the agent took its pane"; fi
  mux close --ref "$ref" --id "$ag" >/dev/null 2>&1; rc=$?
  assert_eq "contract: closing it again exits 3 (no longer recorded)" "3" "$rc"

  # closing a pane takes its agents
  out="$(mux start --ref "$ref" --space "$sp" --name "$ref-two" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
  ag2="$(jq -r .agent <<<"$out")"; apn2="$(jq -r .pane <<<"$out")"
  assert_ok "contract: close an agent's pane" mux close --ref "$ref" --id "$apn2"
  l="$(mux list --ref "$ref")"
  if _mc_has "$l" "$ag2" || _mc_has "$l" "$apn2"; then fail "contract: closing a pane took the agent in it"; else pass "contract: closing a pane took the agent in it"; fi

  # status needs an agent
  mux status --ref "$ref" --to "$apn" >/dev/null 2>&1; rc=$?
  assert_eq "contract: status of a pane id exits 3" "3" "$rc"

  # an agent that exited but still exists
  if declare -F mux_contract_exit_agent >/dev/null; then
    out="$(mux start --ref "$ref" --space "$sp" --name "$ref-exit" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
    ag3="$(jq -r .agent <<<"$out")"
    mux_contract_exit_agent "$ag3"
    out="$(_mcd status --ref "$ref" --to "$ag3")"; rc=$?
    assert_eq "contract: status of an exited agent exits 0" "0" "$rc"
    _mc_json "contract: ...and says gone" "$out" '.state == "gone"'
    _mcd wait --ref "$ref" --to "$ag3" --until gone --timeout-ms 5000 >/dev/null 2>&1; rc=$?
    assert_eq "contract: wait --until gone on an exited agent returns 0" "0" "$rc"
    mux close --ref "$ref" --id "$ag3" >/dev/null 2>&1; rc=$?
    assert_eq "contract: an exited agent can be closed" "0" "$rc"
  fi

  # an id the backend lost behind ship-mux's back
  if declare -F mux_contract_vanish >/dev/null; then
    out="$(mux start --ref "$ref" --space "$sp" --name "$ref-three" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
    ag3="$(jq -r .agent <<<"$out")"; apn3="$(jq -r .pane <<<"$out")"
    mux_contract_vanish "$ag3"
    mux_contract_vanish "$apn3"
    # recorded, but the backend no longer has them: exit 5 (target gone)
    _mcd status --ref "$ref" --to "$ag3" >/dev/null 2>&1; rc=$?
    assert_eq "contract: status of a gone agent exits 5" "5" "$rc"
    _mcd read --ref "$ref" --to "$ag3" >/dev/null 2>&1; rc=$?
    assert_eq "contract: read of a gone agent exits 5" "5" "$rc"
    _mcd send --ref "$ref" --to "$ag3" --text x >/dev/null 2>&1; rc=$?
    assert_eq "contract: send to a gone agent exits 5" "5" "$rc"
    _mcd run --ref "$ref" --pane "$apn3" -- true >/dev/null 2>&1; rc=$?
    assert_eq "contract: run in a gone pane exits 5" "5" "$rc"
    for u in ready idle working; do
      _mcd wait --ref "$ref" --to "$ag3" --until "$u" --timeout-ms 5000 >/dev/null 2>&1; rc=$?
      assert_eq "contract: wait --until $u on a gone agent exits 5 at once" "5" "$rc"
    done
    _mcd wait --ref "$ref" --to "$ag3" --until gone --timeout-ms 5000 >/dev/null 2>&1; rc=$?
    assert_eq "contract: wait --until gone on a gone agent exits 0" "0" "$rc"
    assert_eq "contract: closing an id the backend lost exits 0" "0" "$(mux close --ref "$ref" --id "$ag3" >/dev/null 2>&1; echo $?)"
    l="$(mux list --ref "$ref")"
    if _mc_has "$l" "$ag3" || _mc_has "$l" "$apn3"; then fail "contract: the lost agent and its pane left the record"; else pass "contract: the lost agent and its pane left the record"; fi
    mux close --ref "$ref" --id "$ag3" >/dev/null 2>&1; rc=$?
    assert_eq "contract: ...and is refused as unrecorded afterwards" "3" "$rc"
  fi

  # an agent in the space dies with it
  out="$(mux start --ref "$ref" --space "$sp" --name "$ref-four" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
  ag4="$(jq -r .agent <<<"$out")"

  # the units group
  if [[ -n "$g" ]]; then
    mux close --ref "$ref" --id "$g" >/dev/null 2>&1; rc=$?
    assert_eq "contract: group close while spaces remain exits 3" "3" "$rc"
    if [[ -n "${MUX_CONTRACT_BACKEND[0]+x}" ]]; then
      "${MUX_CONTRACT_BACKEND[@]}" close --ref "$ref" --id "$g" >/dev/null 2>&1; rc=$?
      assert_eq "contract: the backend itself refuses a group with children (1)" "1" "$rc"
      _mc_json "contract: ...and the group is still reported" "$("${MUX_CONTRACT_BACKEND[@]}" list --ref "$ref" --ids "$(jq -nc --arg g "$g" '[$g]')")" 'any(.[]; .kind == "group")'
    fi
  fi

  # closing the space leaves nothing of the ref (the agent in it included)
  assert_ok "contract: close the space" mux close --ref "$ref" --id "$sp"
  assert_eq "contract: list is empty once the space is closed" "[]" "$(mux list --ref "$ref" | jq -c .)"
  mux status --ref "$ref" --to "$ag4" >/dev/null 2>&1; rc=$?
  assert_eq "contract: the space's agent is no longer recorded" "3" "$rc"
  assert_eq "contract: the other ref still has its space" "1" "$(_mc_has "$(mux list --ref "$ref2")" "$unrelated" && echo 1 || echo 0)"

  if [[ -n "$g" ]]; then
    mux close --ref "$ref" --id "$g" >/dev/null 2>&1; rc=$?
    assert_eq "contract: group close with another ref's space left exits 3" "3" "$rc"
  fi
  assert_ok "contract: close the other ref's space" mux close --ref "$ref2" --id "$unrelated"
  assert_eq "contract: the other ref's list is empty too" "[]" "$(mux list --ref "$ref2" | jq -c .)"
  if [[ -n "$g" && -f "$grecord" ]]; then
    created="$(jq -r --arg g "$g" '.groups[$g].created' "$grecord")"
    mux close --ref "$ref2" --id "$g" >/dev/null 2>&1; rc=$?
    if [[ "$created" == true ]]; then
      assert_eq "contract: an empty ship-created group closes (0)" "0" "$rc"
    else
      assert_eq "contract: a group ship did not create is refused (3)" "3" "$rc"
    fi
  fi
}
