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


  # 6: the backend's logic against a scripted herdr stub. It runs only with SHIP_MUX_TEST
  # unset and the stub first on PATH, so it can never reach a real server. Under
  # /bin/bash (3.2 on macOS) on purpose.
  HSTUB="$FIX/hstub"; HD="$FIX/hd"; mkdir -p "$HSTUB" "$HD/resp"
  cat > "$HSTUB/herdr" <<'STUB'
#!/bin/bash
# Scripted herdr: logs argv; answers from $STUB_DIR/resp/<arg1>_<arg2>[.N].{out,err,rc}.
# A numbered answer is used once, in order, before the plain one.
D="$STUB_DIR"
echo "$*" >> "$D/log"
base="$D/resp/${1}_${2}"
pick=""
for n in 1 2 3 4 5 6; do
  if [ -e "$base.$n.rc" ]; then pick="$base.$n"; break; fi
done
once=0
if [ -n "$pick" ]; then once=1; else pick="$base"; fi
[ -f "$pick.out" ] && cat "$pick.out"
[ -f "$pick.err" ] && cat "$pick.err" >&2
rc=0
[ -f "$pick.rc" ] && rc="$(cat "$pick.rc")"
if [ "$once" = 1 ]; then rm -f "$pick".out "$pick".err "$pick".rc; fi
exit "$rc"
STUB
  chmod +x "$HSTUB/herdr"
  # hset <arg1_arg2[.N]> <rc> <stdout> [stderr]
  hset() { printf '%s' "$3" > "$HD/resp/$1.out"; printf '%s' "${4:-}" > "$HD/resp/$1.err"; printf '%s' "$2" > "$HD/resp/$1.rc"; }
  hreset() { rm -rf "$HD"; mkdir -p "$HD/resp"; }
  hb() { env -u SHIP_MUX_TEST HERDR_ENV=1 STUB_DIR="$HD" PATH="$HSTUB:$PATH" SHIP_MUX_LAUNCH_PEER= /bin/bash "$BE" "$@"; }
  hlog() { cat "$HD/log" 2>/dev/null; }
  NF() { printf '{"error":{"code":"%s","message":"m"}}' "$1"; }
  PANES1='{"result":{"panes":[{"pane_id":"w1:p1","tab_id":"w1:t1","label":null}]}}'

  hreset; hset tab_get 0 '{}'; hset pane_list 0 "$PANES1"; hset pane_split 0 '{"result":{"pane":{"pane_id":"w1:p2"}}}'; hset agent_start 0 '{}'
  out="$(hb start --ref r --space w1:t1 --name Dev.One --harness pi --cwd /tmp 2>/dev/null)"; rc=$?
  assert_eq "stub: start under /bin/bash (no mapfile) exits 0" "0" "$rc"
  assert_eq "stub: start returns <hname>@<pane>" "w1:p2" "$(jq -r .pane <<<"$out")"
  assert_contains "stub: the agent id carries its pane" "$(jq -r .agent <<<"$out")" "@w1:p2"
  legal='.agent | sub("@.*";"") | test("^[a-z][a-z0-9_-]{0,31}$") | if . then 1 else 0 end'
  assert_eq "stub: the Herdr name is legal and at most 32 chars" "1" "$(jq -r "$legal" <<<"$out")"

  # 2: a failed pane list is an error (1), not "not found" (5)
  hreset; hset tab_get 0 '{}'; hset pane_list 1 '' "$(NF internal)"
  hb start --ref r --space w1:t1 --name d --harness pi --cwd /tmp >/dev/null 2>&1; rc=$?
  assert_eq "stub: start with a failing pane list exits 1" "1" "$rc"
  # 4: bad JSON from herdr is an error (1), not jq's exit 5
  hreset; hset tab_get 0 '{}'; hset pane_list 0 "$PANES1"; hset pane_split 0 'not json at all'
  hb start --ref r --space w1:t1 --name d --harness pi --cwd /tmp >/dev/null 2>&1; rc=$?
  assert_eq "stub: unparsable herdr output exits 1, never 5" "1" "$rc"
  hreset; hset workspace_list 0 'garbage'
  hb open --ref r --cwd /tmp --group g >/dev/null 2>&1; rc=$?
  assert_eq "stub: open on unparsable output exits 1" "1" "$rc"

  # 5: a blocked start keeps the pane and succeeds; a real failure closes it
  hreset; hset tab_get 0 '{}'; hset pane_list 0 "$PANES1"; hset pane_split 0 '{"result":{"pane":{"pane_id":"w1:p2"}}}'
  hset agent_start 1 '' "$(NF agent_not_ready)"
  out="$(hb start --ref r --space w1:t1 --name d --harness claude --cwd /tmp 2>/dev/null)"; rc=$?
  assert_eq "stub: agent_not_ready is a successful start" "0" "$rc"
  assert_contains "stub: ...with the id returned" "$out" '"agent"'
  assert_not_contains "stub: ...and the pane is not closed" "$(hlog)" "pane close"
  hset agent_start 1 '' "$(NF workspace_trust_blocked)"
  hb start --ref r --space w1:t1 --name d --harness claude --cwd /tmp >/dev/null 2>&1; rc=$?
  assert_eq "stub: workspace_trust_blocked is a successful start" "0" "$rc"
  hset agent_start 1 '' "$(NF boom)"
  hb start --ref r --space w1:t1 --name d --harness claude --cwd /tmp >/dev/null 2>&1; rc=$?
  assert_eq "stub: another start failure exits 1" "1" "$rc"
  assert_contains "stub: ...and closes the pane it split" "$(hlog)" "pane close w1:p2"

  # 6: working also accepts unknown (the status mapping); send --wait-ms accepts blocked and unknown
  hreset; hset agent_get 0 '{"result":{"agent":{"pane_id":"w1:p2","agent_status":"idle"}}}'; hset agent_wait 0 '{}'
  hb wait --ref r --to n-1@w1:p2 --until working --timeout-ms 1000 >/dev/null 2>&1; rc=$?
  assert_eq "stub: wait --until working exits 0" "0" "$rc"
  assert_contains "stub: ...and waits for working or unknown" "$(hlog)" "agent wait n-1 --until working --until unknown"
  hreset; hset agent_get 0 '{"result":{"agent":{"pane_id":"w1:p2","agent_status":"idle"}}}'; hset agent_prompt 0 '{}'
  hb send --ref r --to n-1@w1:p2 --text hi --wait-ms 5000 >/dev/null 2>&1
  assert_contains "stub: send --wait-ms accepts working, blocked or unknown" "$(hlog)" "--until working --until blocked --until unknown --timeout 5000"

  # 7: the Enter retries stay inside the --wait-ms budget
  hreset; hset agent_get 0 '{"result":{"agent":{"pane_id":"w1:p2","agent_status":"idle"}}}'
  hset agent_prompt 1 '' "$(NF agent_prompt_stalled)"; hset agent_send-keys 0 '{}'; hset agent_wait 1 '' "$(NF timeout)"
  hb send --ref r --to n-1@w1:p2 --text hi --wait-ms 5000 >/dev/null 2>&1; rc=$?
  assert_eq "stub: a send that never starts working exits 4" "4" "$rc"
  assert_eq "stub: no Enter wait outlasts the budget" "0" "$(hlog | grep 'agent wait' | sed -E 's/.*--timeout ([0-9]+).*/\1/' | awk '$1 > 5000 {n++} END {print n + 0}')"
  hreset; hset agent_get 0 '{"result":{"agent":{"pane_id":"w1:p2","agent_status":"idle"}}}'
  hset agent_prompt 1 '' "$(NF agent_prompt_stalled)"; hset agent_send-keys 0 '{}'
  hb send --ref r --to n-1@w1:p2 --text hi --wait-ms 0 >/dev/null 2>&1; rc=$?
  assert_eq "stub: with no budget left it exits 4" "4" "$rc"
  assert_not_contains "stub: ...without pressing Enter" "$(hlog)" "send-keys"

  # 8: open finds a tab still labelled with the ref when no pane is marked
  hreset; hset workspace_list 0 '{"result":{"workspaces":[{"workspace_id":"w1","label":"g"}]}}'
  hset pane_list 0 "$PANES1"; hset tab_list 0 '{"result":{"tabs":[{"tab_id":"w1:t1","label":"r"}]}}'; hset pane_rename 0 '{}'
  out="$(hb open --ref r --cwd /tmp --group g 2>/dev/null)"; rc=$?
  assert_eq "stub: open exits 0" "0" "$rc"
  assert_eq "stub: open reuses the tab labelled with the ref" "w1:t1" "$(jq -r .space <<<"$out")"
  assert_not_contains "stub: ...and creates no tab" "$(hlog)" "tab create"
  assert_contains "stub: ...and marks its root pane" "$(hlog)" "pane rename w1:p1 ship:r"

  # 9: close and list resolve the agent's current pane first
  hreset; hset agent_get 0 '{"result":{"agent":{"pane_id":"w1:p9"}}}'; hset pane_close 0 '{}'
  hb close --ref r --id n-1@w1:p2 >/dev/null 2>&1; rc=$?
  assert_eq "stub: close of an agent exits 0" "0" "$rc"
  assert_contains "stub: ...closing the pane it is in now" "$(hlog)" "pane close w1:p9"
  hreset; hset agent_get 1 '' "$(NF agent_not_found)"; hset pane_close 0 '{}'
  hb close --ref r --id n-1@w1:p2 >/dev/null 2>&1
  assert_contains "stub: an unknown name falls back to the pane in the id" "$(hlog)" "pane close w1:p2"
  hreset; hset workspace_list 0 '{"result":{"workspaces":[]}}'; hset tab_list 0 '{"result":{"tabs":[]}}'; hset pane_list 0 '{"result":{"panes":[]}}'
  hset agent_list 0 '{"result":{"agents":[{"name":"n-1","pane_id":"w1:p9","agent_status":"working"}]}}'
  out="$(hb list --ref r --ids '["n-1@w1:p2"]' 2>/dev/null)"
  assert_eq "stub: list finds an agent that moved panes" "working" "$(jq -r '.[0].state' <<<"$out")"

  # 10: SHIP_MUX_LAUNCH_PEER
  hreset; hset tab_get 0 '{}'; hset pane_list 0 "$PANES1"; hset pane_split 0 '{"result":{"pane":{"pane_id":"w1:p2"}}}'; hset agent_start 0 '{}'
  err="$(env -u SHIP_MUX_TEST HERDR_ENV=1 STUB_DIR="$HD" PATH="$HSTUB:$PATH" SHIP_MUX_LAUNCH_PEER=no-such-peer-xyz /bin/bash "$BE" start --ref r --space w1:t1 --name d --harness claude --cwd /tmp 2>&1 >/dev/null)"
  assert_contains "stub: an unrunnable SHIP_MUX_LAUNCH_PEER warns" "$err" "SHIP_MUX_LAUNCH_PEER"
  assert_contains "stub: ...and claude starts without it" "$(hlog)" "agent start"
  hreset; hset tab_get 0 '{}'; hset pane_list 0 "$PANES1"; hset pane_split 0 '{"result":{"pane":{"pane_id":"w1:p2"}}}'; hset pane_run 0 '{}'
  hset agent_get 0 '{"result":{"agent":{"agent":"claude"}}}'; hset agent_rename 0 '{}'; hset agent_wait 0 '{}'; hset pane_wait-output 0 '{}'
  printf '#!/bin/sh\nexit 0\n' > "$HSTUB/my-peer"; chmod +x "$HSTUB/my-peer"
  env -u SHIP_MUX_TEST HERDR_ENV=1 STUB_DIR="$HD" PATH="$HSTUB:$PATH" SHIP_MUX_LAUNCH_PEER=my-peer /bin/bash "$BE" start --ref r --space w1:t1 --name d --harness claude --cwd /tmp >/dev/null 2>&1; rc=$?
  assert_eq "stub: a launch-peer name found on PATH is used (exit 0)" "0" "$rc"
  assert_contains "stub: ...resolved to its path" "$(hlog)" "$HSTUB/my-peer off claude"
  assert_not_contains "stub: the real herdr was never involved" "$(hlog)" "server"

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
# shellcheck disable=SC2034  # read by mux_contract
MUX_CONTRACT_HARNESS=claude
# shellcheck disable=SC2034  # read by mux_contract
MUX_CONTRACT_AGENT_ARGS=(--model haiku --permission-mode bypassPermissions)
# shellcheck disable=SC2034  # read by mux_contract
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
