#!/usr/bin/env bash
# Row T (ship-land) — the journeys only: landing a unit end to end against a local bare remote, a stub gh
# and wt, and mux/fake. Every decision that does not need a whole land (the gates, the rebase checks, the
# PR lookups, branch cleanup, the queue refusals, task and on_land bookkeeping, teardown edge cases) is
# in test-t-ship-land-fn.sh; ship-retire is in test-t-ship-retire.sh. No real multiplexer or GitHub.
#
# Runs of ship-land (10): u1, u20 x2, bc1, u29, u41 x2, q1 x2, hl1.
# Coverage map: notes/specs/ship-tests/plan.md section 2.3; the survivor of each dropped case is named there.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/land-fixture.sh"
start_reaper
# 1: the happy path, with a second unit keeping the group alive ------------------------
write_cfg 'on_land: ["echo {ref}-{pr}-{task} >> '"$ONLAND_LOG"'"]
'
mk_unit u1 101; U1_SPACE=$U_SPACE U1_PANE=$U_PANE U1_A1=$U_A1 U1_A2=$U_A2 U1_P3=$U_P3 U1_AP1=$U_AP1
mk_unit u2 102; U2_SPACE=$U_SPACE U2_A1=$U_A1 U2_A2=$U_A2
G1="$(jq -r '.created[] | select(.kind == "space") | .group' "$SPACE/notes/loops/u1/mux.json")"
advance_main one
rm -f "$SHIP_MUX_FAKE_LOG"
rc="$(land u1 --task T-9)"
assert_eq "land u1 exits 0" "0" "$rc"
assert_eq "the gate ran once" "1" "$(gate_runs)"
assert_contains "gh merged the PR with the configured method (rebase)" "$(grep 'pr merge' "$GH_LOG")" "pr merge 101 --rebase"
assert_contains "gh ran inside the unit worktree" "$(grep 'pr merge' "$GH_LOG")" "$SPACE/worktrees/u1 ::"
assert_eq "the unit branch is on the remote main" "feat: u1" "$(git -C "$REMOTE" log -1 --format=%s main)"
assert_contains "main moved underneath and the unit was rebased on it" "$(git -C "$REMOTE" log --format=%s main)" "chore: main moves (one)"
assert_eq "the base worktree was fast-forwarded" "feat: u1" "$(git -C "$SPACE/worktrees/main" log -1 --format=%s)"
assert_eq "on_land ran with {ref}, {pr} and {task} replaced" "u1-101-T-9" "$(cat "$ONLAND_LOG")"
assert_eq "the lock is released" "no" "$([[ -e "$SPACE/.hyper/ship-land.lock" ]] && echo yes || echo no)"
assert_contains "stdout says what landed" "$(cat "$FIX/land.out")" "u1 landed"
assert_contains "stdout says the remote branch was deleted" "$(cat "$FIX/land.out")" "remote branch u1 deleted"
assert_contains "stdout says the unit space was closed" "$(cat "$FIX/land.out")" "unit space $U1_SPACE closed"
# teardown
assert_eq "the claude agent got /exit (harness from the record)" "/exit" "$(cat "$(sent_file "$U1_A1")" 2>/dev/null)"
assert_eq "the pi agent got a single ctrl+d" "<keys:ctrl+d>" "$(cat "$(sent_file "$U1_A2")" 2>/dev/null)"
assert_eq "u2's agents were not touched" "no" "$([[ -e "$(sent_file "$U2_A1")" || -e "$(sent_file "$U2_A2")" ]] && echo yes || echo no)"
assert_ok "the extra pane was closed" log_closed "$U1_P3"
assert_eq "the first agent's pane is gone from the backend" "no" "$(state_exists "$U1_AP1" && echo yes || echo no)"
assert_ok "the unit space was closed" log_closed "$U1_SPACE"
assert_eq "the root pane was never closed on its own" "no" "$(log_closed "$U1_PANE" && jq -e --arg id "$U1_PANE" 'select(.verb == "close" and (.args | index($id)))' "$SHIP_MUX_FAKE_LOG" >/dev/null 2>&1 && echo yes || echo no)"
assert_eq "nothing of u1 is left on the backend" "" "$(for i in $U1_SPACE $U1_PANE $U1_A1 $U1_A2 $U1_P3; do state_exists "$i" && echo yes; done | head -n 1)"
assert_eq "u2's space is still open" "yes" "$(state_exists "$U2_SPACE" && echo yes || echo no)"
assert_eq "the units group was kept (u2 still in it)" "yes" "$([[ -f "$SHIP_MUX_FAKE_DIR/groups/proj-units" ]] && echo yes || echo no)"
assert_eq "no group close reached the backend" "0" "$(jq -c --arg g "$G1" 'select(.verb == "close" and (.args | index($g)))' "$SHIP_MUX_FAKE_LOG" | wc -l | tr -d ' ')"
assert_eq "the worktree is gone" "no" "$([[ -d "$SPACE/worktrees/u1" ]] && echo yes || echo no)"
assert_contains "wt ran from the space root, with -D (verified merge)" "$(cat "$WT_LOG")" "$SPACE :: remove -D u1"
assert_eq "the loop dir moved to .done" "yes" "$([[ -f "$SPACE/notes/loops/.done/u1/result.json" && ! -d "$SPACE/notes/loops/u1" ]] && echo yes || echo no)"

# u20: a close that leaves the space alive. A land whose ship-mux can be told to skip a close: a copy of the
# scripts next to a wrapper (ship-land and ship-retire find ship-mux beside themselves).
fresh_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/.hyper/ship-mux.json" "$SPACE"/notes/loops/u[0-9]* "$SPACE/notes/loops/r1"; }
W2="$FIX/wland"; mkdir -p "$W2"
cp "$LAND" "$RETIRE" "$SHIP_DIR/lib.sh" "$SHIP_DIR/lib-host.sh" "$W2/"
cat > "$W2/ship-mux" <<WRAP
#!/usr/bin/env bash
if [[ "\$1" == close && -n "\${WRAP_LEAVE:-}" && " \$* " == *" \$WRAP_LEAVE "* ]]; then exit 0; fi
exec bash "$MUXBIN" "\$@"
WRAP
chmod +x "$W2/ship-mux"
wland() { SHIP_PLUGIN_ROOT="$PLUGIN_DIR" bash "$W2/ship-land" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }

# a close that leaves the space alive: ship-mux list catches it, the unit is kept
fresh_fake; rm -f "$ONLAND_LOG"
write_cfg 'on_land: ["echo {ref}-{pr} >> '"$ONLAND_LOG"'"]
'
mk_unit u20 120; S20=$U_SPACE
advance_main seven
runs0="$(gate_runs)"; m0="$(merges)"
rc="$(WRAP_LEAVE=$S20 wland u20)"
assert_eq "a close that leaves an id alive: exit 1" "1" "$rc"
assert_contains "...ship-mux list is what says so" "$(cat "$FIX/land.err")" "still holds"
assert_contains "...and the message names the way out" "$(cat "$FIX/land.err")" "--abandon"
assert_eq "...the worktree and the loop dir are kept" "yes yes" "$(exists_word "$SPACE/worktrees/u20") $(exists_word "$SPACE/notes/loops/u20")"
assert_eq "...the PR was merged by then" "feat: u20" "$(git -C "$REMOTE" log -1 --format=%s main)"
# the natural recovery: rerun. The PR is merged, so no rebase, gate, push or merge.
rc="$(land u20)"
assert_eq "rerun after a failed teardown: exit 0" "0" "$rc"
assert_contains "...it skips to teardown" "$(cat "$FIX/land.out")" "already merged"
assert_eq "...without gating or merging again" "$((runs0 + 1))/$((m0 + 1))" "$(gate_runs)/$(merges)"
assert_eq "...and the unit is torn down" "no no" "$(exists_word "$SPACE/worktrees/u20") $(exists_word "$SPACE/notes/loops/u20")"
assert_eq "...on_land ran once across the failed land and its rerun (the PR was merged by the first)" "u20-120" "$(cat "$ONLAND_LOG")"
assert_contains "...and the rerun says it was already done" "$(cat "$FIX/land.out")" "already done"


# bc1: branch cleanup after a verified merge, squash method actually used ------------------------
write_cfg 'merge_method: squash
'
mk_unit bc1 401
advance_main bc-one
rc="$(land bc1)"
assert_eq "squash land: exit 0" "0" "$rc"
assert_contains "gh merged with the configured method (squash)" "$(grep 'pr merge 401' "$GH_LOG")" "pr merge 401 --squash"
assert_contains "...wt remove -D (the branch head is the PR head)" "$(tail -n 1 "$WT_LOG")" "remove -D bc1"
assert_eq "...the branch is deleted" "no" "$(git -C "$G" rev-parse -q --verify refs/heads/bc1 >/dev/null && echo yes || echo no)"
write_cfg

# u29: a young lock held by another host: land waits, says so, gives up (1) and leaves the lock alone ---
mk_unit u29 129
echo "1@otherhost" > "$SPACE/.hyper/ship-land.lock"
m0="$(merges)"
rc="$(SHIP_LAND_LOCK_WAIT_SEC=0 land u29)"
assert_eq "a young foreign lock is waited for, then land gives up (1)" "1" "$rc"
assert_contains "...it said it was waiting" "$(cat "$FIX/land.out")" "waiting for another land in this space (1@otherhost)"
assert_contains "...saying what it gave up on" "$(cat "$FIX/land.err")" "gave up waiting for the land lock"
assert_eq "...and does not remove a lock that is not its own" "yes" "$(exists_word "$SPACE/.hyper/ship-land.lock")"
assert_eq "...nothing was merged" "$m0" "$(merges)"
rm -f "$SPACE/.hyper/ship-land.lock"
git -C "$G" worktree remove --force "$SPACE/worktrees/u29"

hcnt() { tr '\n' ' ' <"$CNT" | sed 's/ $//'; }

# u41: a failing on_land command stops the list before the teardown; the rerun resumes at it ------------
CNT="$FIX/count.log"; rm -f "$CNT" "$FIX/ok"
fresh_fake
write_cfg 'on_land: ["echo one >> '"$CNT"'", "test -f '"$FIX"'/ok && echo two >> '"$CNT"'", "echo three >> '"$CNT"'"]
'
mk_unit u41 141
advance_main sixteen
rc="$(land u41)"
assert_eq "an on_land command that fails stops the list (1)" "1" "$rc"
assert_contains "...naming the command" "$(cat "$FIX/land.err")" "on_land command failed: test -f"
assert_eq "...only the first ran" "one" "$(hcnt)"
assert_eq "...the unit is not torn down" "yes" "$(exists_word "$SPACE/worktrees/u41")"
touch "$FIX/ok"
rc="$(land u41)"
assert_eq "after the fix the rerun resumes at the failed command" "0" "$rc"
assert_eq "...each command ran exactly once" "one two three" "$(hcnt)"
write_cfg

# q1: the merge call leaves the PR open (merge queue); a rerun while it is queued is refused ---------
# queued_rerun_check <label> <ref> <env var>: main moves first, so a rebase (and then a push) would change the branch
queued_rerun_check() {
  local label="$1" r="$2" knob="$3" head_before remote_before g0 m0 rc
  advance_main "queued-check-$r"
  : > "$GH_LOG"; : > "$REMOTE/push.log"
  head_before="$(git -C "$SPACE/worktrees/$r" rev-parse HEAD)"
  remote_before="$(git -C "$REMOTE" rev-parse "refs/heads/$r")"
  g0="$(gate_runs)"; m0="$(merges)"
  rc="$(env "$knob=1" bash "$LAND" "$r" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?)"
  assert_eq "$label: exit 3" "3" "$rc"
  assert_contains "...says the PR is queued to merge" "$(cat "$FIX/land.err")" "queued to merge (it is in the merge queue)"
  assert_contains "...says to rerun once MERGED" "$(cat "$FIX/land.err")" "once it is MERGED"
  assert_contains "...and how to cancel auto-merge for a re-land" "$(cat "$FIX/land.err")" "cancel auto-merge"
  assert_eq "...no merge call" "$m0" "$(merges)"
  assert_eq "...no gate run" "$g0" "$(gate_runs)"
  assert_eq "...no rebase (the local head is unchanged)" "$head_before" "$(git -C "$SPACE/worktrees/$r" rev-parse HEAD)"
  assert_eq "...no push (the remote branch is unchanged)" "$remote_before" "$(git -C "$REMOTE" rev-parse "refs/heads/$r")"
  assert_eq "...no ref update reached the remote (hook log empty)" "" "$(cat "$REMOTE/push.log")"
}
rm -f "$CNT"
fresh_fake
write_cfg 'on_land: ["echo {ref}-{pr} >> '"$CNT"'"]
'
mk_unit q1 501
advance_main queue-one
rc="$(GH_MERGE_QUEUE=1 land q1)"
assert_eq "first land with a merge queue: the PR stays open, exit 1" "1" "$rc"
assert_contains "...says it is not merged yet" "$(cat "$FIX/land.err")" "not merged yet"
assert_eq "...on_land did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
assert_eq "...the branch is kept" "yes" "$(git -C "$G" rev-parse -q --verify refs/heads/q1 >/dev/null && echo yes || echo no)"
assert_eq "...and so is the worktree" "yes" "$(exists_word "$SPACE/worktrees/q1")"
queued_rerun_check "rerun while in the merge queue" q1 GH_QUEUE
assert_eq "...the unit is kept" "yes" "$(exists_word "$SPACE/worktrees/q1")"
assert_eq "...on_land still did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
bash "$LAND" q1 --abandon --force >/dev/null 2>&1

# hl1: --host: on_land runs on the lead, never over ssh --------------------------------------------
# The "host" is this machine: the fake ssh runs the remote command here (marked with SHIP_FAKE_REMOTE=1) from a
# home of its own, so an on_land that ran over ssh would log "remote". The real rsync copies the scripts and
# mirrors the unit back (the same paths), so this case needs GNU rsync 3.
if rsync_is_gnu3; then
mkdir -p "$FIX/hbin"
cat > "$FIX/hbin/ssh" <<'STUB'
#!/bin/bash
echo "ssh $*" >> "$SSH_LOG"
while [[ "$1" == -o ]]; do shift 2; done
shift
cmd="$*"
cd "$HOME" || exit 255
[[ ! -e "$FIX/ssh.lost" || "$cmd" != *phase* ]] || exit 255
export SHIP_FAKE_REMOTE=1 SHIP_LAND_LOCK="$FIX/host-land.lock"
exec /bin/bash -c "${cmd/#bash -lc /bash -c }"
STUB
chmod +x "$FIX/hbin/ssh"
export FIX SSH_LOG="$FIX/hostssh.log"
OLDPATH="$PATH"; PATH="$FIX/hbin:$PATH"
hcfg() { write_cfg 'hosts:
  box:
    ssh: fakehost
on_land: '"$1"'
'; }

CNT="$FIX/hcount.log"; rm -f "$CNT" "$FIX/hok"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo {ref}-{pr}-{task}-${SHIP_FAKE_REMOTE:-lead} >> '"$CNT"'"]'
mk_unit hl1 201
advance_main host-one
rc="$(land hl1 --host box --task T-7)"
assert_eq "land --host: 0" "0" "$rc"
assert_eq "on_land ran on the lead, not over ssh, with {ref} {pr} {task} replaced" "hl1-201-T-7-lead" "$(cat "$CNT")"
assert_eq "...the host did the merge phase" "1" "$(grep -c 'phase.*merge' "$SSH_LOG")"
assert_eq "...and the teardown phase" "1" "$(grep -c 'phase.*finish' "$SSH_LOG")"
assert_eq "...the PR was merged once" "1" "$(grep -c 'pr merge 201' "$GH_LOG")"
assert_eq "...the unit was torn down and moved to .done" "yes" "$([[ -d "$SPACE/notes/loops/.done/hl1" && ! -d "$SPACE/notes/loops/hl1" ]] && echo yes)"
assert_eq "...no on_land bookkeeping is left behind" "" "$(compgen -G "$SPACE/notes/loops/*on_land*" || true)"
PATH="$OLDPATH"
else
  skip "land --host: on_land on the lead, merge and finish phases on the host" "rsync on PATH is not GNU 3.x (openrsync)"
fi

finish
