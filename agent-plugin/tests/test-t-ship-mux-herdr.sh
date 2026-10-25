#!/usr/bin/env bash
# Row T (ship-mux, Herdr backend) — scripts/ship/mux/herdr.
#
# Default run: the D202 guard only. Under SHIP_MUX_TEST=1 every verb exits 99 before
# anything else, with a fail-loud `herdr` stub first on PATH that must never run,
# whether the backend is called directly or through ship-mux. Also: `check`'s
# own failure modes (they never need a server) and the lint of the file.
#
# Live run (manual, never in CI): SHIP_MUX_HERDR_LIVE=1 with HERDR_ENV=1 and
# SHIP_MUX_TEST unset, from inside Herdr, runs the shared contract against the
# real server in a workspace of a unique name, with a real claude agent (haiku), and
# closes only what it created.

REAL_HOME="$HOME"
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
source "$TESTS_DIR/lib/mux-contract.sh"
set +eu
set +o pipefail

BE="$SCRIPTS_DIR/ship/mux/herdr"
MUX_BIN="$SCRIPTS_DIR/ship/ship-mux"

if [[ "${SHIP_MUX_HERDR_LIVE:-}" != 1 ]]; then
  export SHIP_MUX_TEST=1

  # A herdr that records that it ran and fails; first on PATH for everything below.
  STUB="$FIX/stub"; mkdir -p "$STUB"
  printf '#!/bin/sh\necho "herdr stub reached: $*" >> "%s/reached"\nexit 77\n' "$FIX" > "$STUB/herdr"
  chmod +x "$STUB/herdr"
  export PATH="$STUB:$PATH"
  export HERDR_ENV=1

  assert_ok "the backend is valid bash" bash -n "$BE"
  assert_eq "the backend is executable" "yes" "$([[ -x "$BE" ]] && echo yes || echo no)"

  # 1: every verb, direct
  for v in check open run start send read status wait close list bogus; do
    bash "$BE" "$v" --ref r --cwd /tmp --pane p --space s --name n --harness pi --to a --text t \
      --id i --until idle --timeout-ms 1 --ids '[]' -- true >"$FIX/out" 2>"$FIX/err"
    assert_eq "direct: $v exits 99" "99" "$?"
    assert_eq "direct: $v prints nothing on stdout" "" "$(cat "$FIX/out")"
    assert_contains "direct: $v says why" "$(cat "$FIX/err")" "SHIP_MUX_TEST"
  done
  bash "$BE" >/dev/null 2>&1
  assert_eq "direct: no verb at all still exits 99" "99" "$?"

  # 2: through ship-mux (needs a space for the verbs that read the record)
  SPACE="$FIX/proj"
  make_bare_space "$SPACE"
  mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
  printf 'mux: herdr\n' > "$SPACE/.hyper/ship.yml"
  export SHIP_SPACE_ROOT="$SPACE"
  WT="$SPACE/worktrees/wt"
  mux_rc() { (cd "$WT" && bash "$MUX_BIN" "$@" >/dev/null 2>&1); echo $?; }
  assert_eq "ship-mux check passes 99 through" "99" "$(mux_rc check)"
  assert_eq "ship-mux open passes 99 through" "99" "$(mux_rc open --ref g1 --cwd "$WT")"
  assert_eq "ship-mux list (nothing recorded) passes 99 through" "99" "$(mux_rc list --ref g1)"
  assert_eq "...and nothing was recorded" "no" "$([[ -e "$SPACE/notes/loops/g1/mux.json" ]] && echo yes || echo no)"
  assert_eq "ship-mux refuses an unrecorded close before the backend (3)" "3" "$(mux_rc close --ref g1 --id w1)"
  assert_eq "ship-mux refuses an unrecorded read before the backend (3)" "3" "$(mux_rc read --ref g1 --to a)"

  # 3: the stub was never reached
  assert_eq "the herdr stub was never reached" "no" "$([[ -e "$FIX/reached" ]] && echo yes || echo no)"

  # 4: check's own failure modes, with the guard off (check never calls the CLI)
  SHIM="$FIX/shim"; mkdir -p "$SHIM"
  BASH_BIN="$(command -v bash)"
  for t in mktemp rm cat jq; do ln -s "$(command -v "$t")" "$SHIM/$t"; done
  run_check() { env -u SHIP_MUX_TEST "$@" "$BASH_BIN" "$BE" check 2>&1; }
  out="$(run_check -u HERDR_ENV PATH="$STUB:$PATH")"; rc=$?
  assert_eq "check outside Herdr exits 1" "1" "$rc"
  assert_contains "...and says HERDR_ENV" "$out" "HERDR_ENV"
  out="$(run_check HERDR_ENV=0 PATH="$STUB:$PATH")"; rc=$?
  assert_eq "check with HERDR_ENV=0 exits 1" "1" "$rc"
  out="$(run_check HERDR_ENV=1 PATH="$SHIM")"; rc=$?
  assert_eq "check without herdr on PATH exits 1" "1" "$rc"
  assert_contains "...and says so" "$out" "not on PATH"
  out="$(run_check HERDR_ENV=1 PATH="$STUB:$SHIM")"; rc=$?
  assert_eq "check inside Herdr with the CLI present exits 0" "0" "$rc"
  assert_eq "check never calls the CLI" "no" "$([[ -e "$FIX/reached" ]] && echo yes || echo no)"
  out="$(env -u SHIP_MUX_TEST HERDR_ENV=1 PATH="$STUB:$PATH" bash "$MUX_BIN" check 2>&1 >/dev/null)"; rc=$?
  assert_eq "ship-mux check reaches the backend's check (0)" "0" "$rc"

  # 5: keep the repo free of the hyper space
  assert_eq "no space paths or tracker ids in the backend" "0" "$(grep -cE '/work/|notes/specs|hyper-[a-z0-9]+\.[0-9]|/Users/' "$BE")"
  if command -v shellcheck >/dev/null 2>&1; then
    assert_ok "shellcheck (warning) is clean" shellcheck --severity=warning "$BE"
  else
    skip "shellcheck (warning) is clean" "shellcheck not installed"
  fi
  finish
  exit
fi

# --- live run ---------------------------------------------------------------------------
unset SHIP_MUX_TEST
[[ "${HERDR_ENV:-}" == 1 ]] || { echo "live run needs HERDR_ENV=1 (run it inside Herdr)" >&2; exit 1; }
export HOME="$REAL_HOME"
UNIQ="ship-mux-contract-$$-$(date +%s)"
SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt"
printf 'mux: herdr\nunits_group: %s\n' "$UNIQ" > "$SPACE/.hyper/ship.yml"
export SHIP_SPACE_ROOT="$SPACE"
WT="$SPACE/worktrees/wt"

mux() { (cd "$WT" && bash "$MUX_BIN" "$@" 2>/dev/null); }
# A real claude in the plugin's own (trusted) checkout, on the cheapest model: it
# survives the single ctrl+c / ctrl+d the contract sends, and costs one short reply.
MUX_CONTRACT_HARNESS=claude
MUX_CONTRACT_AGENT_ARGS=(--model haiku --permission-mode bypassPermissions)
MUX_CONTRACT_BACKEND=(bash "$BE")
# Make an agent exit while its id stays recorded (used by contracts that support it).
mux_contract_exit_agent() {
  mux send --ref "${MUX_CONTRACT_REF:-live-a}" --to "$1" --text "/exit" >/dev/null 2>&1
  mux wait --ref "${MUX_CONTRACT_REF:-live-a}" --to "$1" --until gone --timeout-ms 30000 >/dev/null 2>&1
}
mux_contract live "$PLUGIN_DIR"

# Close only what this run created: the group workspace of the unique name, through
# the backend (it refuses while the group still has tabs).
leftover="$(jq -r --arg n "$UNIQ" '[.groups | to_entries[] | select(.value.name == $n) | .key][0] // empty' "$SPACE/.hyper/ship-mux.json" 2>/dev/null)"
if [[ -z "$leftover" ]]; then
  pass "no workspace of this run is left on record"
elif bash "$BE" list --ref live-z --ids "[\"$leftover\"]" | jq -e 'length == 0' >/dev/null; then
  pass "the group workspace is gone"
else
  fail "the contract left its workspace $leftover open"
  bash "$BE" close --ref live-z --id "$leftover" >/dev/null 2>&1
fi
finish
