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

mux_contract() {
  local prefix="$1" cwd="$2" ref="$1-a" ref2="$1-b" harness="${MUX_CONTRACT_HARNESS:-claude}"
  local id out rc sp pn g g2 ag apn ag2 apn2 ag3 apn3 ag4 unrelated unrelated_pn l created marker sent
  local grecord="${SHIP_SPACE_ROOT:-}/.hyper/ship-mux.json"

  assert_ok "contract: check succeeds" mux check

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
  assert_ok "contract: wait --until ready on the opened pane" mux wait --ref "$ref" --to "$pn" --until ready --timeout-ms 5000
  marker="MARKER_${prefix}_run"
  assert_ok "contract: run a command in the pane" mux run --ref "$ref" --pane "$pn" -- echo "$marker"
  assert_contains "contract: run's output shows up in read" "$(mux read --ref "$ref" --to "$pn")" "$marker"

  # start and the round trip
  out="$(mux start --ref "$ref" --space "$sp" --name "$ref-dev" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
  _mc_json "contract: start prints agent and pane ids" "$out" '(.agent | type == "string" and length > 0) and (.pane | type == "string" and length > 0)'
  ag="$(jq -r .agent <<<"$out")"; apn="$(jq -r .pane <<<"$out")"
  out="$(mux status --ref "$ref" --to "$ag")"
  _mc_json "contract: status of a live agent is a known state" "$out" '.state | IN("working","idle","blocked")'
  assert_eq "contract: status reports the agent's pane" "$apn" "$(jq -r .pane <<<"$out")"
  assert_eq "contract: status reports the agent's space" "$sp" "$(jq -r .space <<<"$out")"
  assert_ok "contract: wait --until ready on the agent" mux wait --ref "$ref" --to "$ag" --until ready --timeout-ms 5000
  sent="SENT_${prefix}_text"
  assert_ok "contract: send --text" mux send --ref "$ref" --to "$ag" --text "$sent"
  assert_contains "contract: sent text shows up in read --to <agent>" "$(mux read --ref "$ref" --to "$ag")" "$sent"
  assert_ok "contract: send --keys" mux send --ref "$ref" --to "$ag" --keys enter,esc,ctrl+c,ctrl+d
  assert_ok "contract: read the last lines of the pane" mux read --ref "$ref" --to "$apn" --lines 5
  mux wait --ref "$ref" --to "$ag" --until gone --timeout-ms 100 >/dev/null 2>&1; rc=$?
  assert_eq "contract: wait --until gone on a live agent times out (4)" "4" "$rc"
  if [[ "$(mux status --ref "$ref" --to "$ag" | jq -r .state)" == idle ]]; then
    mux wait --ref "$ref" --to "$ag" --until working --timeout-ms 100 >/dev/null 2>&1; rc=$?
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
  mux close --ref "$ref" --id "$unrelated" >/dev/null 2>&1; rc=$?
  assert_eq "contract: close of another ref's space exits 3" "3" "$rc"
  mux close --ref "$ref" --id "never-recorded-$prefix" >/dev/null 2>&1; rc=$?
  assert_eq "contract: close of an unrecorded id exits 3" "3" "$rc"
  mux wait --ref "$ref" --to "never-recorded-$prefix" --until ready --timeout-ms 10 >/dev/null 2>&1; rc=$?
  assert_eq "contract: wait on an unrecorded id exits 3" "3" "$rc"
  mux read --ref "$ref" --to "$unrelated_pn" >/dev/null 2>&1; rc=$?
  assert_eq "contract: read of another ref's pane exits 3" "3" "$rc"
  mux run --ref "$ref" --pane "$unrelated_pn" -- true >/dev/null 2>&1; rc=$?
  assert_eq "contract: run in another ref's pane exits 3" "3" "$rc"
  mux send --ref "$ref" --to never-recorded --text x >/dev/null 2>&1; rc=$?
  assert_eq "contract: send to an unrecorded id exits 3" "3" "$rc"
  mux status --ref "$ref" --to never-recorded >/dev/null 2>&1; rc=$?
  assert_eq "contract: status of an unrecorded id exits 3" "3" "$rc"
  mux close --ref "$ref" --id "$pn" >/dev/null 2>&1; rc=$?
  assert_eq "contract: closing a space's root pane exits 3" "3" "$rc"
  assert_ok "contract: ...and the space is still there" mux wait --ref "$ref" --to "$pn" --until ready --timeout-ms 5000
  mux send --ref "$ref" --to "$apn" --text x >/dev/null 2>&1; rc=$?
  assert_eq "contract: send to a pane id is an error (1)" "1" "$rc"
  mux bogus >/dev/null 2>&1; rc=$?
  assert_eq "contract: unknown verb exits 2" "2" "$rc"
  mux close --id x >/dev/null 2>&1; rc=$?
  assert_eq "contract: close without --ref exits 2" "2" "$rc"
  mux send --ref "$ref" --to "$ag" >/dev/null 2>&1; rc=$?
  assert_eq "contract: send without --text or --keys exits 2" "2" "$rc"
  mux send --to "$ag" --text x >/dev/null 2>&1; rc=$?
  assert_eq "contract: send without --ref exits 2" "2" "$rc"
  mux send --ref "$ref" --to "$ag" --keys enter,f13 >/dev/null 2>&1; rc=$?
  assert_eq "contract: send with an unknown key exits 2" "2" "$rc"
  mux send --ref "$ref" --to "$ag" --text a --keys enter >/dev/null 2>&1; rc=$?
  assert_eq "contract: send with --text and --keys exits 2" "2" "$rc"
  mux start --ref "$ref" --space "$sp" --name n --harness emacs --cwd "$cwd" >/dev/null 2>&1; rc=$?
  assert_eq "contract: start with an unknown harness exits 2" "2" "$rc"

  # closing an agent takes its pane
  assert_ok "contract: close a recorded agent" mux close --ref "$ref" --id "$ag"
  _mc_json "contract: status of a closed agent is gone" "$(mux status --ref "$ref" --to "$ag" 2>/dev/null || echo '{"state":"refused"}')" '.state == "gone" or .state == "refused"'
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

  # an id the backend lost behind ship-mux's back
  if declare -F mux_contract_vanish >/dev/null; then
    out="$(mux start --ref "$ref" --space "$sp" --name "$ref-three" --harness "$harness" --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
    ag3="$(jq -r .agent <<<"$out")"; apn3="$(jq -r .pane <<<"$out")"
    mux_contract_vanish "$ag3"
    mux_contract_vanish "$apn3"
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
    if [[ ${#MUX_CONTRACT_BACKEND[@]} -gt 0 ]]; then
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
