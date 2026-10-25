#!/usr/bin/env bash
# Shared mux backend contract (C-13). Source it from a backend's test after
# tests/helpers.sh; it defines mux_contract and runs nothing by itself.
#
#   source "$TESTS_DIR/lib/mux-contract.sh"
#   mux() { ...run scripts/ship/ship-mux with the backend under test...; }
#   mux_contract <ref-prefix> <cwd>
#
# `mux` must run ship-mux inside a configured space with the backend selected
# (mux: <name>) and the backend's own environment set up. Every id comes from
# the backend's own output, and each case uses a ref of its own so a backend
# that leaks state between refs fails. Optional: MUX_CONTRACT_AGENT_ARGS, an
# array of arguments for the agent's harness after `--` (default: none).
#
# Cases: check; open shape and idempotency; start/send/read/status/wait round
# trip; list; close of recorded ids; refusal of an unrecorded id (exit 3); usage
# errors (exit 2); a clean `list` once everything is closed.

# _mc_json <desc> <json> <jq -e filter>
_mc_json() {
  if jq -e "$3" >/dev/null 2>&1 <<<"$2"; then pass "$1"; else fail "$1 (got: $2)"; fi
}

mux_contract() {
  local prefix="$1" cwd="$2" ref="$1-a" ref2="$1-b" out rc
  local sp pn ag apn unrelated

  assert_ok "contract: check succeeds" mux check

  # open: shape and idempotency
  out="$(mux open --ref "$ref" --cwd "$cwd" --label "$ref")"
  _mc_json "contract: open prints space and pane ids" "$out" '(.space | type == "string" and length > 0) and (.pane | type == "string" and length > 0)'
  sp="$(jq -r .space <<<"$out")"; pn="$(jq -r .pane <<<"$out")"
  assert_eq "contract: open is idempotent per ref" "$out" "$(mux open --ref "$ref" --cwd "$cwd" --label "$ref")"
  assert_ok "contract: wait --until ready on the opened pane" mux wait --to "$pn" --until ready --timeout-ms 5000
  assert_ok "contract: run a command in the pane" mux run --ref "$ref" --pane "$pn" -- true

  # start and the round trip
  out="$(mux start --ref "$ref" --space "$sp" --name "$ref-dev" --harness claude --cwd "$cwd" -- ${MUX_CONTRACT_AGENT_ARGS[@]+"${MUX_CONTRACT_AGENT_ARGS[@]}"})"
  _mc_json "contract: start prints agent and pane ids" "$out" '(.agent | type == "string" and length > 0) and (.pane | type == "string" and length > 0)'
  ag="$(jq -r .agent <<<"$out")"; apn="$(jq -r .pane <<<"$out")"
  out="$(mux status --to "$ag")"
  _mc_json "contract: status of a live agent" "$out" '.state | IN("working","idle","blocked")'
  assert_ok "contract: wait --until ready on the agent" mux wait --to "$ag" --until ready --timeout-ms 5000
  assert_ok "contract: send --text" mux send --to "$ag" --text "hello"
  assert_ok "contract: send --text with --wait-ms" mux send --to "$ag" --text "again" --wait-ms 50
  assert_ok "contract: send --keys" mux send --to "$ag" --keys enter,esc,ctrl+c,ctrl+d
  assert_ok "contract: read the agent's screen" mux read --to "$ag"
  assert_ok "contract: read the last lines of the pane" mux read --to "$apn" --lines 5
  assert_fails "contract: wait --until gone times out on a live agent" mux wait --to "$ag" --until gone --timeout-ms 100
  out="$(mux list --ref "$ref")"
  _mc_json "contract: list holds the space, the panes and the agent" "$out" \
    'map(.kind) as $k | ($k | index("space")) != null and ($k | index("pane")) != null and ($k | index("agent")) != null'
  _mc_json "contract: list entries have id, kind, name, state" "$out" 'all(.[]; has("id") and has("kind") and has("name") and has("state"))'

  # refusals and usage errors
  unrelated="$(mux open --ref "$ref2" --cwd "$cwd" | jq -r .space)"
  mux close --ref "$ref" --id "$unrelated" >/dev/null 2>&1; rc=$?
  assert_eq "contract: close of another ref's id exits 3" "3" "$rc"
  mux close --ref "$ref" --id "never-recorded-$prefix" >/dev/null 2>&1; rc=$?
  assert_eq "contract: close of an unrecorded id exits 3" "3" "$rc"
  mux bogus >/dev/null 2>&1; rc=$?
  assert_eq "contract: unknown verb exits 2" "2" "$rc"
  mux close --id x >/dev/null 2>&1; rc=$?
  assert_eq "contract: close without --ref exits 2" "2" "$rc"
  mux send --to "$ag" --keys enter,f13 >/dev/null 2>&1; rc=$?
  assert_eq "contract: send with an unknown key exits 2" "2" "$rc"
  mux send --to "$ag" --text a --keys enter >/dev/null 2>&1; rc=$?
  assert_eq "contract: send with --text and --keys exits 2" "2" "$rc"
  mux start --ref "$ref" --space "$sp" --name n --harness emacs --cwd "$cwd" >/dev/null 2>&1; rc=$?
  assert_eq "contract: start with an unknown harness exits 2" "2" "$rc"

  # close a recorded agent: it is gone, the rest stays
  assert_ok "contract: close a recorded agent" mux close --ref "$ref" --id "$ag"
  _mc_json "contract: status of a closed agent is gone" "$(mux status --to "$ag")" '.state == "gone"'
  assert_ok "contract: wait --until gone after close" mux wait --to "$ag" --until gone --timeout-ms 5000
  _mc_json "contract: list no longer holds the agent" "$(mux list --ref "$ref")" 'all(.[]; .kind != "agent")'
  mux close --ref "$ref" --id "$ag" >/dev/null 2>&1; rc=$?
  assert_eq "contract: closing it again exits 3 (no longer recorded)" "3" "$rc"

  # closing the space leaves nothing of the ref
  assert_ok "contract: close the space" mux close --ref "$ref" --id "$sp"
  assert_eq "contract: list is empty once the space is closed" "[]" "$(mux list --ref "$ref" | jq -c .)"
  assert_ok "contract: close the other ref's space" mux close --ref "$ref2" --id "$unrelated"
  assert_eq "contract: the other ref's list is empty too" "[]" "$(mux list --ref "$ref2" | jq -c .)"
}
