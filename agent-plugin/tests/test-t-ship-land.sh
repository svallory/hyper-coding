#!/usr/bin/env bash
# Row T (ship-land, ship-retire) — landing a unit and tearing it down, against a
# local bare remote, a stub gh and wt, and mux/fake. No real multiplexer or
# GitHub is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
LAND="$SHIP_DIR/ship-land"
RETIRE="$SHIP_DIR/ship-retire"
MUXBIN="$SHIP_DIR/ship-mux"

SPACE="$FIX/proj"
REMOTE="$FIX/remote.git"
G="$SPACE/.git"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_LAND_SETTLE_SEC=0
export SHIP_RETIRE_POLL=0.2
export GH_LOG="$FIX/gh.log" WT_LOG="$FIX/wt.log" GATE_LOG="$FIX/gate.log" ONLAND_LOG="$FIX/onland.log"
export STUB_REMOTE="$REMOTE" STUB_G="$G" STUB_SPACE="$SPACE"

# --- git fixture: bare remote, a bare space clone, base worktree ----------------------
git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$FIX/seed" 2>/dev/null
echo base > "$FIX/seed/base.txt"
git -C "$FIX/seed" add base.txt
git -C "$FIX/seed" commit -q -m "chore: base"
git -C "$FIX/seed" branch -M main
git -C "$FIX/seed" push -q origin main
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main
# every ref update that reaches the remote is logged (the queued-rerun cases assert it stays empty)
cat > "$REMOTE/hooks/update" <<'HOOK'
#!/bin/sh
echo "$1" >> "$(dirname "$0")/../push.log"
HOOK
chmod +x "$REMOTE/hooks/update"
git clone -q --bare "$REMOTE" "$G"
git -C "$G" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git -C "$G" fetch -q origin
mkdir -p "$SPACE/worktrees" "$SPACE/.hyper" "$SPACE/notes/loops"
git -C "$G" worktree add -q "$SPACE/worktrees/main" main
git clone -q "$REMOTE" "$FIX/other" 2>/dev/null

# --- stubs --------------------------------------------------------------------------
mkdir -p "$FIX/bin"
cat > "$FIX/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "$PWD :: $*" >> "$GH_LOG"
case "$1 $2" in
  "pr list")
    # like gh: only open PRs are listed. A merged one is not.
    b="$(git branch --show-current)"
    if git -C "$STUB_REMOTE" merge-base --is-ancestor "refs/heads/$b" refs/heads/main 2>/dev/null; then echo ""; else printf '%s\n' "${GH_PR:-}"; fi ;;
  "pr view")
    # `pr view <number|branch> --json ... -q .number|.state`
    b="$(git branch --show-current)"
    if [[ -e "$STUB_REMOTE/merged-$b" ]] || git -C "$STUB_REMOTE" merge-base --is-ancestor "refs/heads/$b" refs/heads/main 2>/dev/null; then st=MERGED; else st=OPEN; fi
    case "$*" in
      *"-q .number"*) printf '%s\n' "${GH_PR:?gh stub: GH_PR not set}" ;;
      *autoMergeRequest*)
        # GH_AUTOMERGE: an OPEN PR with auto-merge enabled
        am=null; [[ -z "${GH_AUTOMERGE:-}" || "$st" != OPEN ]] || am='{"enabledBy":{"login":"op"},"mergeMethod":"REBASE"}'
        printf '{"state":"%s","autoMergeRequest":%s,"mergeStateStatus":"%s","url":"https://github.com/acme/stub/pull/%s"}\n' "$st" "$am" "${GH_MSS:-CLEAN}" "${GH_PR:-1}" ;;
      *headRefOid*)
        # GH_HEADOID_FAIL: only this query fails
        [[ -z "${GH_HEADOID_FAIL:-}" ]] || { echo "gh: HTTP 502 (stub)" >&2; exit 1; }
        # the head the PR was merged at (kept in the marker); GH_HEAD_OID overrides
        if [[ -n "${GH_HEAD_OID:-}" ]]; then echo "$GH_HEAD_OID"
        elif [[ -s "$STUB_REMOTE/merged-$b" ]]; then cat "$STUB_REMOTE/merged-$b"
        else git -C "$STUB_REMOTE" rev-parse "refs/heads/$b"; fi ;;
      *) echo "$st" ;;
    esac ;;
  "pr merge")
    [[ -z "${GH_MERGE_FAIL:-}" ]] || { echo "gh: merge failed" >&2; exit 1; }
    b="$(git branch --show-current)"
    # GH_MERGE_QUEUE: gh accepts the merge but the PR stays open (auto-merge, a merge queue)
    [[ -z "${GH_MERGE_QUEUE:-}" ]] || exit 0
    git -C "$STUB_REMOTE" update-ref refs/heads/main "$(git -C "$STUB_REMOTE" rev-parse "refs/heads/$b")"
    git -C "$STUB_REMOTE" rev-parse "refs/heads/$b" > "$STUB_REMOTE/merged-$b"
    # GH_MERGE_FAIL_AFTER: the merge happens, then gh errors (it cannot delete a branch a worktree holds)
    if [[ -n "${GH_MERGE_FAIL_AFTER:-}" ]]; then echo "gh: failed to delete local branch" >&2; exit 1; fi
;;
  "api graphql")
    # GH_QUEUE: an OPEN PR in the merge queue (gh pr view has no field for it)
    # GH_GQL_FAIL: the query fails; GH_GQL_NOFIELD: a GHES without isInMergeQueue
    [[ -z "${GH_GQL_FAIL:-}" ]] || { echo "gh: HTTP 502 (stub graphql)" >&2; exit 1; }
    [[ -z "${GH_GQL_NOFIELD:-}" ]] || { echo "gh: GraphQL: Field 'isInMergeQueue' doesn't exist on type 'PullRequest'" >&2; exit 1; }
    b="$(git branch --show-current)"
    if [[ -n "${GH_QUEUE:-}" && ! -e "$STUB_REMOTE/merged-$b" ]]; then echo true; else echo false; fi ;;
  *) echo "gh stub: unexpected $*" >&2; exit 1 ;;
esac
STUB
cat > "$FIX/bin/wt" <<'STUB'
#!/usr/bin/env bash
echo "$PWD :: $*" >> "$WT_LOG"
[[ "$1" == remove ]] || exit 1
[[ -z "${WT_FAIL:-}" ]] || { echo "wt: refusing" >&2; exit 1; }
shift
d=0; [[ "$1" == -D ]] && { d=1; shift; }
# wt takes a branch: find the worktree that holds it (the branch need not equal the ref)
wtp="$(git -C "$STUB_G" worktree list --porcelain | awk -v b="refs/heads/$1" '$1 == "worktree" { p = substr($0, 10) } $1 == "branch" && $2 == b { print p; exit }')"
[[ -n "$wtp" ]] || exit 1
git -C "$STUB_G" worktree remove --force "$wtp" || exit 1
[[ $d -eq 0 ]] || git -C "$STUB_G" branch -D "$1" >/dev/null
STUB
chmod +x "$FIX/bin/gh" "$FIX/bin/wt"
export PATH="$FIX/bin:$PATH"

# The config is loaded once and inherited by every call (SHIP_CONFIG_JSON), as in
# one real run; each edit of ship.yml reloads it. This keeps yq out of the loop.
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
reload_cfg() { unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load; }
write_cfg() {
  printf 'mux: fake\ngate: "echo gated >> %s"\n%s' "$GATE_LOG" "${1:-}" > "$SPACE/.hyper/ship.yml"
  reload_cfg
}
raw_cfg() { printf '%s' "$1" > "$SPACE/.hyper/ship.yml"; reload_cfg; }
write_cfg

# A reaper stands in for agents that quit when told to: any agent that has been
# sent something disappears, unless $FIX/noreap exists.
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

land() { bash "$LAND" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }
mux() { bash "$MUXBIN" "$@" 2>/dev/null; }
log_count() { jq -c --arg v "$1" 'select(.verb == $v)' "$SHIP_MUX_FAKE_LOG" 2>/dev/null | wc -l | tr -d ' '; }
log_closed() { jq -e --arg id "$1" 'select(.verb == "close" and (.args | index($id)))' "$SHIP_MUX_FAKE_LOG" >/dev/null 2>&1; }
gate_runs() { [[ -f "$GATE_LOG" ]] && wc -l <"$GATE_LOG" | tr -d ' ' || echo 0; }
merges() { grep -c 'pr merge' "$GH_LOG" 2>/dev/null || true; }
advance_main() {
  git -C "$FIX/other" pull -q --ff-only origin main
  echo "$1" > "$FIX/other/$1.txt"
  git -C "$FIX/other" add "$1.txt"
  git -C "$FIX/other" commit -q -m "chore: main moves ($1)"
  git -C "$FIX/other" push -q origin main
}

# mk_unit <ref> <pr> [status] — worktree + branch + commit + pushed branch, a
# READY result.json, a unit space with two agents and one extra pane.
# Sets U_SPACE U_PANE U_A1 U_A2 U_P3 (ids).
mk_unit() {
  local ref="$1" pr="$2" st="${3:-READY}" wt="$SPACE/worktrees/$1" s a1 a2
  git -C "$G" fetch -q origin
  git -C "$G" worktree add -q -b "$ref" "$wt" origin/main
  echo "$ref" > "$wt/$ref.txt"
  git -C "$wt" add "$ref.txt"
  git -C "$wt" commit -q -m "feat: $ref"
  git -C "$wt" push -q origin "$ref"
  mkdir -p "$SPACE/notes/loops/$ref"
  jq -n --arg r "$ref" --arg w "$wt" --arg st "$st" --argjson pr "$pr" \
    '{ref: $r, pr: $pr, stage: "finalize", status: $st, rounds: [], spec: {verdict: "NOT_RUN", rounds: 0},
      final: {verdict: "NOT_RUN", rounds: 0}, specwriter: {runs: 0, commits: []}, finalize: null,
      failovers: 0, host: "local", worktree: $w}' > "$SPACE/notes/loops/$ref/result.json"
  s="$(mux open --ref "$ref" --cwd "$wt" --label "$ref")"
  U_SPACE="$(jq -r .space <<<"$s")"; U_PANE="$(jq -r .pane <<<"$s")"
  a1="$(mux start --ref "$ref" --space "$U_SPACE" --name dev --harness claude --cwd "$wt")"
  a2="$(mux start --ref "$ref" --space "$U_SPACE" --name review --harness pi --cwd "$wt")"
  U_A1="$(jq -r .agent <<<"$a1")"; U_A2="$(jq -r .agent <<<"$a2")"
  U_P3="$(jq -r .pane <<<"$a2")"; U_AP1="$(jq -r .pane <<<"$a1")"
}
sent_file() { echo "$SHIP_MUX_FAKE_DIR/sent/$1"; }
state_exists() { [[ -f "$SHIP_MUX_FAKE_DIR/state/$1.json" ]]; }

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

# 2: landing the last unit closes the empty, ship-created group -----------------------
advance_main two
rc="$(land u2)"
assert_eq "land u2 exits 0" "0" "$rc"
assert_eq "{task} falls back to the ref" "u2-102-u2" "$(tail -n 1 "$ONLAND_LOG")"
assert_eq "the empty ship-created group was closed" "no" "$([[ -f "$SHIP_MUX_FAKE_DIR/groups/proj-units" ]] && echo yes || echo no)"
assert_eq "...and dropped from the group record" "{}" "$(jq -c .groups "$SPACE/.hyper/ship-mux.json")"
assert_contains "stdout says the group closed" "$(cat "$FIX/land.out")" "units group $G1 closed"

# a record without a harness (older record) falls back to ctrl+d twice
mk_unit u2b 120
jq '(.created[] | select(.kind == "agent")) |= del(.harness)' "$SPACE/notes/loops/u2b/mux.json" > "$FIX/m.json" && mv "$FIX/m.json" "$SPACE/notes/loops/u2b/mux.json"
assert_eq "abandon with harness-less records exits 0" "0" "$(land u2b --abandon)"
assert_eq "...the agent got ctrl+d twice" "<keys:ctrl+d,ctrl+d>" "$(cat "$(sent_file "$U_A1")")"

# 3: a group ship did not create is never closed ---------------------------------------
rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/.hyper/ship-mux.json"
mkdir -p "$SHIP_MUX_FAKE_DIR/groups"; echo proj-units > "$SHIP_MUX_FAKE_DIR/groups/proj-units"
write_cfg
mk_unit u3 103
advance_main three
rc="$(land u3)"
assert_eq "land u3 exits 0" "0" "$rc"
assert_eq "a pre-existing group stays" "yes" "$([[ -f "$SHIP_MUX_FAKE_DIR/groups/proj-units" ]] && echo yes || echo no)"
assert_eq "...ship never asked to close it" "0" "$(jq -c 'select(.verb == "close" and (.args | index("group-proj-units")))' "$SHIP_MUX_FAKE_LOG" | wc -l | tr -d ' ')"

# 4: refusals --------------------------------------------------------------------------
mk_unit u4 104 PARKED
runs0="$(gate_runs)"; m0="$(merges)"; : > "$SHIP_MUX_FAKE_LOG"
rc="$(land u4)"
assert_eq "a non-READY unit is refused (3)" "3" "$rc"
assert_contains "...with the status named" "$(cat "$FIX/land.err")" "PARKED"
assert_eq "...no gate, no merge" "$runs0/$m0" "$(gate_runs)/$(merges)"
assert_eq "...no multiplexer call" "0" "$(wc -l <"$SHIP_MUX_FAKE_LOG" | tr -d ' ')"
assert_eq "...the worktree stays" "yes" "$([[ -d "$SPACE/worktrees/u4" ]] && echo yes || echo no)"
rc="$(land u4 --force)"
assert_eq "--force lands a non-READY unit" "0" "$rc"

# an empty branch
git -C "$G" fetch -q origin
git -C "$G" worktree add -q -b u5 "$SPACE/worktrees/u5" origin/main
mkdir -p "$SPACE/notes/loops/u5"
jq -n --arg w "$SPACE/worktrees/u5" '{ref: "u5", pr: 105, stage: "finalize", status: "READY", rounds: [], spec: {verdict: "NOT_RUN", rounds: 0}, final: {verdict: "NOT_RUN", rounds: 0}, specwriter: {runs: 0, commits: []}, finalize: null, failovers: 0, host: "local", worktree: $w}' > "$SPACE/notes/loops/u5/result.json"
m0="$(merges)"
rc="$(land u5)"
assert_eq "a branch with no commits is refused (3)" "3" "$rc"
assert_eq "...no merge" "$m0" "$(merges)"

# a rebase that drops a commit: the same patch is already on main
mk_unit u6 106
w6="$SPACE/worktrees/u6"
echo u6 > "$FIX/other/u6.txt"
git -C "$FIX/other" pull -q --ff-only origin main
git -C "$FIX/other" add u6.txt
git -C "$FIX/other" commit -q -m "feat: u6 (cherry-picked elsewhere)"
git -C "$FIX/other" push -q origin main
before="$(git -C "$w6" rev-parse HEAD)"
m0="$(merges)"; runs0="$(gate_runs)"
rc="$(land u6)"
assert_eq "a rebase that drops a commit is refused (3)" "3" "$rc"
assert_contains "...saying so" "$(cat "$FIX/land.err")" "dropped commits"
assert_eq "...the branch is back where it was" "$before" "$(git -C "$w6" rev-parse HEAD)"
assert_eq "...no gate, no merge" "$runs0/$m0" "$(gate_runs)/$(merges)"
assert_eq "...the lock is released" "no" "$([[ -e "$SPACE/.hyper/ship-land.lock" ]] && echo yes || echo no)"

# uncommitted changes
mk_unit u7 107
echo dirty >> "$SPACE/worktrees/u7/u7.txt"
rc="$(land u7)"
assert_eq "uncommitted changes are refused (3)" "3" "$rc"

# 5: failures after the checks ---------------------------------------------------------
git -C "$SPACE/worktrees/u7" checkout -q -- u7.txt
raw_cfg 'mux: fake
gate: "echo failing gate; exit 1"
'
m0="$(merges)"; remote_before="$(git -C "$REMOTE" rev-parse u7)"
advance_main four
rc="$(land u7)"
assert_eq "a failing gate exits 1" "1" "$rc"
assert_contains "...and shows its tail" "$(cat "$FIX/land.err")" "failing gate"
assert_eq "...nothing was pushed" "$remote_before" "$(git -C "$REMOTE" rev-parse u7)"
assert_eq "...no merge" "$m0" "$(merges)"
assert_eq "...the worktree stays" "yes" "$([[ -d "$SPACE/worktrees/u7" ]] && echo yes || echo no)"
raw_cfg 'mux: fake
'
rc="$(land u7)"
assert_eq "no gate configured: landing fails (1), naming the key" "1" "$rc"
assert_contains "...naming gate" "$(cat "$FIX/land.err")" "gate"
write_cfg
rc="$(GH_MERGE_FAIL=1 land u7)"
assert_eq "a failed merge exits 1 and keeps the unit" "1" "$rc"
assert_contains "...a merge that did not happen fails loudly, naming the PR" "$(cat "$FIX/land.err")" "gh pr merge"
assert_eq "...the worktree stays" "yes" "$([[ -d "$SPACE/worktrees/u7" ]] && echo yes || echo no)"

# gh exits non-zero but the PR shows MERGED: the land succeeds and the remote branch is deleted with git
mk_unit u7b 117
rc="$(GH_MERGE_FAIL_AFTER=1 land u7b)"
assert_eq "gh erroring after a good merge: the land succeeds" "0" "$rc"
assert_contains "...with a warning" "$(cat "$FIX/land.err")" "the PR is merged"
assert_eq "...the remote branch was deleted with git" "" "$(git -C "$REMOTE" for-each-ref refs/heads/u7b)"
assert_eq "...the unit was torn down" "no" "$([[ -d "$SPACE/worktrees/u7b" ]] && echo yes || echo no)"

# a failing on_land command stops the land before the teardown; the rerun resumes
write_cfg 'on_land: ["exit 7"]
'
rc="$(land u7)"
assert_eq "a failing on_land command exits 1" "1" "$rc"
assert_contains "...naming the command" "$(cat "$FIX/land.err")" "on_land command failed: exit 7"
assert_eq "...the teardown has not run" "yes" "$([[ -d "$SPACE/worktrees/u7" ]] && echo yes || echo no)"
write_cfg
assert_eq "...and the rerun (PR already merged) finishes the unit" "0" "$(land u7)"
assert_eq "...torn down" "no" "$([[ -d "$SPACE/worktrees/u7" ]] && echo yes || echo no)"

# 6: the PR number falls back to gh -------------------------------------------------------
mk_unit u8 108
jq '.pr = null' "$SPACE/notes/loops/u8/result.json" > "$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/u8/result.json"
rc="$(GH_PR=808 land u8)"
assert_eq "a null pr in result.json is looked up with gh" "0" "$rc"
assert_contains "...and that number is merged" "$(grep 'pr merge' "$GH_LOG" | tail -n 1)" "pr merge 808"

# 7: --abandon ---------------------------------------------------------------------------
mk_unit u9 109 PARKED; U9_A1=$U_A1; U9_SPACE=$U_SPACE
m0="$(merges)"; runs0="$(gate_runs)"; push0="$(git -C "$REMOTE" rev-parse u9)"
raw_cfg 'mux: fake
'   # no gate: abandon must not need one
rc="$(land u9 --abandon)"
assert_eq "--abandon exits 0 on a non-READY unit, without a gate configured" "0" "$rc"
assert_eq "--abandon does not merge or gate" "$runs0/$m0" "$(gate_runs)/$(merges)"
assert_eq "--abandon does not push" "$push0" "$(git -C "$REMOTE" rev-parse u9)"
assert_ok "--abandon stopped the agents" test -e "$(sent_file "$U9_A1")"
assert_eq "--abandon closed the space" "no" "$(state_exists "$U9_SPACE" && echo yes || echo no)"
assert_eq "--abandon removed the worktree, keeping the branch (no -D)" "no yes" \
  "$([[ -d "$SPACE/worktrees/u9" ]] && echo yes || echo no) $(git -C "$G" rev-parse -q --verify refs/heads/u9 >/dev/null && echo yes || echo no)"
assert_contains "...wt without -D" "$(tail -n 1 "$WT_LOG")" "remove u9"
assert_eq "--abandon moved the loop dir" "yes" "$([[ -d "$SPACE/notes/loops/.done/u9" ]] && echo yes || echo no)"
mk_unit u10 110 PARKED
rc="$(land u10 --abandon --force)"
assert_eq "--abandon --force exits 0" "0" "$rc"
assert_contains "...and deletes the branch (wt remove -D)" "$(tail -n 1 "$WT_LOG")" "remove -D u10"
assert_eq "...the branch is gone" "no" "$(git -C "$G" rev-parse -q --verify refs/heads/u10 >/dev/null && echo yes || echo no)"
rc="$(land nonesuch --abandon)"
assert_eq "--abandon on an unknown ref is an error (1)" "1" "$rc"
write_cfg

# 7b: branch cleanup after a verified merge -------------------------------------------------
branch_exists() { git -C "$G" rev-parse -q --verify "refs/heads/$1" >/dev/null && echo yes || echo no; }
# squash-merged, branch head == PR head: deleted
write_cfg 'merge_method: squash
'
mk_unit bc1 401
advance_main bc-one
rc="$(land bc1)"
assert_eq "squash land: exit 0" "0" "$rc"
assert_contains "...wt remove -D" "$(tail -n 1 "$WT_LOG")" "remove -D bc1"
assert_eq "...the branch is deleted" "no" "$(branch_exists bc1)"
# the PR head differs from the branch head (the stub reports another SHA, as after a
# push from elsewhere): kept, both SHAs printed
mk_unit bc2 402
advance_main bc-two
bc2_pr_sha="$(printf 'f%.0s' {1..40})"
rc="$(GH_HEAD_OID=$bc2_pr_sha land bc2)"
bc2_local="$(git -C "$G" rev-parse refs/heads/bc2 2>/dev/null)"
assert_eq "branch differing from the PR head: exit 0" "0" "$rc"
assert_eq "...the branch is kept" "yes" "$(branch_exists bc2)"
assert_eq "...the worktree is gone" "no" "$([[ -d "$SPACE/worktrees/bc2" ]] && echo yes || echo no)"
assert_contains "...wt without -D" "$(tail -n 1 "$WT_LOG")" "remove bc2"
assert_contains "...the message prints the branch SHA" "$(cat "$FIX/land.err")" "$bc2_local"
assert_contains "...and the PR SHA" "$(cat "$FIX/land.err")" "$bc2_pr_sha"
# a PR still OPEN after the merge call stops the land before the teardown is reached:
# nothing is torn down, the branch and worktree are kept
mk_unit bc3 403
advance_main bc-three
rc="$(GH_MERGE_QUEUE=1 land bc3)"
assert_eq "PR not MERGED: exit 1" "1" "$rc"
assert_eq "...the branch is kept" "yes" "$(branch_exists bc3)"
assert_eq "...and so is the worktree" "yes" "$([[ -d "$SPACE/worktrees/bc3" ]] && echo yes || echo no)"
bash "$LAND" bc3 --abandon --force >/dev/null 2>&1
# only the headRefOid query fails: the teardown cannot verify, keeps the branch, says why
mk_unit bc5 405
advance_main bc-five
rc="$(GH_HEADOID_FAIL=1 land bc5)"
assert_eq "unreadable PR head: exit 0" "0" "$rc"
assert_eq "...the branch is kept" "yes" "$(branch_exists bc5)"
assert_contains "...wt without -D" "$(tail -n 1 "$WT_LOG")" "remove bc5"
assert_contains "...the message says the head could not be read" "$(cat "$FIX/land.err")" "could not read the head of merged #405"
assert_contains "...with the gh error" "$(cat "$FIX/land.err")" "HTTP 502"
# the branch name differs from the ref
mk_unit bc6 406
git -C "$SPACE/worktrees/bc6" branch -m bc6-renamed
advance_main bc-six
rc="$(land bc6)"
assert_eq "branch name differs from the ref: exit 0" "0" "$rc"
assert_contains "...wt remove -D by branch name" "$(tail -n 1 "$WT_LOG")" "remove -D bc6-renamed"
assert_eq "...the branch is deleted" "no" "$(branch_exists bc6-renamed)"
assert_eq "...the worktree is gone" "no" "$([[ -d "$SPACE/worktrees/bc6" ]] && echo yes || echo no)"
# --abandon without --force: unchanged
mk_unit bc4 404 PARKED
rc="$(land bc4 --abandon)"
assert_eq "--abandon: exit 0" "0" "$rc"
assert_contains "...wt without -D" "$(tail -n 1 "$WT_LOG")" "remove bc4"
assert_eq "...the branch is kept" "yes" "$(branch_exists bc4)"
write_cfg

# a result.json that does not match the schema is refused
mk_unit u13 113
jq 'del(.rounds)' "$SPACE/notes/loops/u13/result.json" > "$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/u13/result.json"
m0="$(merges)"
assert_eq "a result.json that fails the schema is refused (3)" "3" "$(land u13)"
assert_contains "...naming the missing key" "$(cat "$FIX/land.err")" "rounds"
assert_eq "...no merge" "$m0" "$(merges)"
assert_eq "...--force lands it with a warning" "0" "$(land u13 --force)"
assert_contains "...warning on stderr" "$(cat "$FIX/land.err")" "does not match the result schema"

# a merged PR is found by gh pr view even though gh pr list shows only open ones
mk_unit u8b 188
jq '.pr = null' "$SPACE/notes/loops/u8b/result.json" > "$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/u8b/result.json"
git -C "$REMOTE" update-ref refs/heads/main "$(git -C "$REMOTE" rev-parse refs/heads/u8b)"
m0="$(merges)"
rc="$(GH_PR=909 land u8b)"
assert_eq "a null pr whose PR is already merged is looked up (gh pr view) and finished" "0" "$rc"
assert_eq "...without merging again" "$m0" "$(merges)"

# no PR at all (neither open nor merged): the message does not say "open"
mk_unit u8c 189
jq '.pr = null' "$SPACE/notes/loops/u8c/result.json" > "$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/u8c/result.json"
assert_eq "a null pr with no PR for the branch: exit 1" "1" "$(land u8c)"
assert_contains "...says there is no PR (not 'no open PR')" "$(cat "$FIX/land.err")" "no PR for branch u8c"

# 8: usage -------------------------------------------------------------------------------
assert_eq "no ref is a usage error (2)" "2" "$(land)"
assert_eq "an unknown flag is a usage error (2)" "2" "$(land u1 --bogus)"
assert_eq "a bad ref is a usage error (2)" "2" "$(land '../x')"

# 9: the lock ---------------------------------------------------------------------------
mk_unit u11 111
advance_main five
sleep 30 & HOLDER=$!
echo "$HOLDER@$(hostname)" > "$SPACE/.hyper/ship-land.lock"
( bash "$LAND" u11 >"$FIX/l11.out" 2>&1; echo $? >"$FIX/l11.rc" ) &
LANDER=$!
sleep 2
assert_eq "a live lock holder makes land wait" "no" "$([[ -f "$FIX/l11.rc" ]] && echo yes || echo no)"
assert_contains "...and says so" "$(cat "$FIX/l11.out")" "waiting for another land"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
wait "$LANDER"
assert_eq "when the holder dies, land takes the lock over and lands" "0" "$(cat "$FIX/l11.rc")"
mk_unit u12 112
advance_main six
echo "$HOLDER@$(hostname)" > "$SPACE/.hyper/ship-land.lock"
assert_eq "a lock left by a dead process is taken over" "0" "$(land u12)"

# 10: ship-retire ----------------------------------------------------------------------
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
touch "$FIX/noreap"
retire --ref r1 --harness codex --timeout 3 "$RA" >/dev/null
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
assert_eq "an agent that will not stop: exit 4 after the timeout" "4" "$(retire --ref r1 --harness claude --timeout 3 "$RA")"
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

# 11: review fixes -------------------------------------------------------------------
# Units that earlier sections left unlanded still hold records in the group.
fresh_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG" "$SPACE/.hyper/ship-mux.json" "$SPACE"/notes/loops/u[0-9]* "$SPACE/notes/loops/r1"; }
exists_word() { [[ -e "$1" ]] && echo yes || echo no; }

# A land whose ship-mux can be told to skip or fail a close: a copy of the scripts
# next to a wrapper (ship-land and ship-retire find ship-mux beside themselves).
W2="$FIX/wland"; mkdir -p "$W2"
cp "$LAND" "$RETIRE" "$SHIP_DIR/lib.sh" "$SHIP_DIR/lib-host.sh" "$W2/"
cat > "$W2/ship-mux" <<WRAP
#!/usr/bin/env bash
if [[ "\$1" == close && -n "\${WRAP_LEAVE:-}" && " \$* " == *" \$WRAP_LEAVE "* ]]; then exit 0; fi
if [[ "\$1" == close && -n "\${WRAP_FAIL:-}" && " \$* " == *" \$WRAP_FAIL "* ]]; then exit 1; fi
if [[ "\$1" == close && -n "\${WRAP_FAILAFTER:-}" && " \$* " == *" \$WRAP_FAILAFTER "* ]]; then bash "$MUXBIN" "\$@"; exit 1; fi
exec bash "$MUXBIN" "\$@"
WRAP
chmod +x "$W2/ship-mux"
wland() { SHIP_PLUGIN_ROOT="$PLUGIN_DIR" bash "$W2/ship-land" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }

# a close that leaves the space alive: ship-mux list catches it, the unit is kept
fresh_fake; write_cfg
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

# a failed space close
fresh_fake
mk_unit u21 121; P21=$U_SPACE
advance_main eight
rc="$(WRAP_FAIL=$P21 wland u21)"
assert_eq "a failed space close: exit 1" "1" "$rc"
assert_contains "...naming the pane" "$(cat "$FIX/land.err")" "could not close space $P21"
assert_eq "...the worktree and the loop dir are kept" "yes yes" "$(exists_word "$SPACE/worktrees/u21") $(exists_word "$SPACE/notes/loops/u21")"
assert_eq "...abandon finishes the job" "0" "$(land u21 --abandon)"

# a close that reports failure although the id is gone: still a failed teardown
fresh_fake
mk_unit u21b 121; S21=$U_SPACE
advance_main eight-b
rc="$(WRAP_FAILAFTER=$S21 wland u21b)"
assert_eq "a close that exits 1 (even if the id is gone): exit 1" "1" "$rc"
assert_eq "...the worktree and the loop dir are kept" "yes yes" "$(exists_word "$SPACE/worktrees/u21b") $(exists_word "$SPACE/notes/loops/u21b")"
assert_eq "...abandon finishes the job" "0" "$(land u21b --abandon)"

# a failed wt remove
fresh_fake
mk_unit u22 122
advance_main nine
runs0="$(gate_runs)"
rc="$(WT_FAIL=1 land u22)"
assert_eq "a failed wt remove: exit 1" "1" "$rc"
assert_contains "...saying so" "$(cat "$FIX/land.err")" "wt remove -D u22 failed"
assert_eq "...the worktree and the loop dir are kept" "yes yes" "$(exists_word "$SPACE/worktrees/u22") $(exists_word "$SPACE/notes/loops/u22")"
rc="$(land u22)"
assert_eq "...and the rerun finishes the teardown without a second merge" "0 $((runs0 + 1))" "$rc $(gate_runs)"
assert_contains "...the rerun ran wt remove -D" "$(tail -n 1 "$WT_LOG")" "remove -D u22"
assert_eq "...and the branch is gone" "no" "$(git -C "$G" rev-parse -q --verify refs/heads/u22 >/dev/null && echo yes || echo no)"

# the units group: a backend that refuses is a warning, and the next land retries
fresh_fake
mk_unit u23 123
advance_main ten
printf '{"kind":"space","group":"proj-units","ref":"operator"}' > "$SHIP_MUX_FAKE_DIR/state/space-999.json"
rc="$(land u23)"
assert_eq "a group the backend refuses to close does not fail a merged land" "0" "$rc"
assert_contains "...it warns" "$(cat "$FIX/land.err")" "could not close units group"
assert_eq "...the unit is torn down" "no" "$(exists_word "$SPACE/worktrees/u23")"
assert_eq "...the group is still on the backend and in the record" "yes true" \
  "$(exists_word "$SHIP_MUX_FAKE_DIR/groups/proj-units") $(jq -r '.groups | to_entries[0].value.created' "$SPACE/.hyper/ship-mux.json")"
rm -f "$SHIP_MUX_FAKE_DIR/state/space-999.json"
mk_unit u24 124
advance_main eleven
assert_eq "the next land retries it" "0" "$(land u24)"
assert_eq "...and the group is closed and dropped from the record" "no {}" \
  "$(exists_word "$SHIP_MUX_FAKE_DIR/groups/proj-units") $(jq -c .groups "$SPACE/.hyper/ship-mux.json")"

# abandon on a detached HEAD removes the worktree by path
fresh_fake
mk_unit u25 125 PARKED
git -C "$SPACE/worktrees/u25" checkout -q --detach
rc="$(land u25 --abandon)"
assert_eq "abandon on a detached HEAD: exit 0" "0" "$rc"
assert_eq "...the worktree is removed" "no" "$(exists_word "$SPACE/worktrees/u25")"
assert_eq "...the loop dir moved" "yes" "$(exists_word "$SPACE/notes/loops/.done/u25")"
mk_unit u26 126 PARKED
mkdir -p "$FIX/plain"
jq --arg w "$FIX/plain" '.worktree = $w' "$SPACE/notes/loops/u26/result.json" > "$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/u26/result.json"
rc="$(land u26 --abandon)"
assert_eq "...a worktree that cannot be removed fails (1)" "1" "$rc"
assert_eq "...before the loop dir moves" "yes" "$(exists_word "$SPACE/notes/loops/u26")"
git -C "$G" worktree remove --force "$SPACE/worktrees/u26"

# the lock
mk_unit u27 127
advance_main twelve
: > "$SPACE/.hyper/ship-land.lock"; touch -t 202001010000 "$SPACE/.hyper/ship-land.lock"
assert_eq "an ownerless lock older than 120 s is taken over" "0" "$(land u27)"
mk_unit u28 128
advance_main thirteen
echo "1@otherhost" > "$SPACE/.hyper/ship-land.lock"
touch -t 202001010000 "$SPACE/.hyper/ship-land.lock"
assert_eq "a foreign-host lock older than 120 s is taken over" "0" "$(land u28)"
mk_unit u29 129
echo "1@otherhost" > "$SPACE/.hyper/ship-land.lock"
rc="$(SHIP_LAND_LOCK_WAIT_SEC=2 land u29)"
assert_eq "a young foreign lock is waited for, then land gives up (1)" "1" "$rc"
assert_contains "...saying what it waited for" "$(cat "$FIX/land.err")" "gave up waiting"
assert_eq "...and does not remove a lock that is not its own" "yes" "$(exists_word "$SPACE/.hyper/ship-land.lock")"
rm -rf "$SPACE/.hyper/ship-land.lock"
git -C "$G" worktree remove --force "$SPACE/worktrees/u29"

# the lease: a commit pushed to the PR branch from elsewhere is never overwritten
fresh_fake
mk_unit u30 130
git clone -q "$REMOTE" "$FIX/elsewhere" 2>/dev/null
git -C "$FIX/elsewhere" checkout -q u30
echo late > "$FIX/elsewhere/late.txt"; git -C "$FIX/elsewhere" add late.txt
git -C "$FIX/elsewhere" commit -q -m "fix: late commit on the PR branch"
git -C "$FIX/elsewhere" push -q origin u30
m0="$(merges)"
rc="$(land u30)"
assert_eq "a late commit on the remote PR branch refuses the push (1)" "1" "$rc"
assert_contains "...saying so" "$(cat "$FIX/land.err")" "push of u30 failed"
assert_eq "...the late commit is still the remote head" "fix: late commit on the PR branch" "$(git -C "$REMOTE" log -1 --format=%s u30)"
assert_eq "...nothing was merged" "$m0" "$(merges)"
assert_eq "...and the lock is released" "no" "$(exists_word "$SPACE/.hyper/ship-land.lock")"

# a malformed record is reported, never a bare jq exit code
fresh_fake
mk_unit u31 131 PARKED
printf '{"backend":"fake","created":[' > "$SPACE/notes/loops/u31/mux.json"
rc="$(land u31 --abandon)"
assert_eq "abandon with a truncated mux.json: exit 1" "1" "$rc"
assert_contains "...with a message naming the file" "$(cat "$FIX/land.err")" "mux.json is not a valid mux record"
assert_eq "...nothing was removed" "yes yes" "$(exists_word "$SPACE/worktrees/u31") $(exists_word "$SPACE/notes/loops/u31")"
mk_unit u32 132
advance_main fourteen
printf '{"backend":"fake","created":[' > "$SPACE/notes/loops/u32/mux.json"
m0="$(merges)"
rc="$(land u32)"
assert_eq "land with a truncated mux.json is refused before the merge (1)" "1" "$rc"
assert_eq "...no merge" "$m0" "$(merges)"
git -C "$G" worktree remove --force "$SPACE/worktrees/u31"
git -C "$G" worktree remove --force "$SPACE/worktrees/u32"

# on_land runs each command exactly once across a failed teardown and its rerun
CNT="$FIX/count.log"; rm -f "$CNT"
fresh_fake
write_cfg 'on_land: ["echo first >> '"$CNT"'", "echo second-{ref}-{task} >> '"$CNT"'"]
'
mk_unit u40 140
advance_main fifteen
rc="$(WT_FAIL=1 land u40 --task T-40)"
assert_eq "run 1 fails at the worktree removal" "1" "$rc"
assert_eq "...both on_land commands ran once" "first second-u40-T-40" "$(tr '\n' ' ' <"$CNT" | sed 's/ $//')"
assert_eq "...and are on the done list" "2" "$(wc -l <"$SPACE/notes/loops/u40/on_land.done" | tr -d ' ')"
rc="$(land u40 --task T-40)"
assert_eq "the rerun completes" "0" "$rc"
assert_eq "...and no on_land command ran twice" "first second-u40-T-40" "$(tr '\n' ' ' <"$CNT" | sed 's/ $//')"
# a failing command stops the list; the rerun resumes at it
rm -f "$CNT" "$FIX/ok"
write_cfg 'on_land: ["echo one >> '"$CNT"'", "test -f '"$FIX"'/ok && echo two >> '"$CNT"'", "echo three >> '"$CNT"'"]
'
mk_unit u41 141
advance_main sixteen
rc="$(land u41)"
assert_eq "an on_land command that fails stops the list (1)" "1" "$rc"
assert_eq "...only the first ran" "one" "$(tr '\n' ' ' <"$CNT" | sed 's/ $//')"
assert_eq "...the unit is not torn down" "yes" "$(exists_word "$SPACE/worktrees/u41")"
touch "$FIX/ok"
rc="$(land u41)"
assert_eq "after the fix the rerun resumes at the failed command" "0" "$rc"
assert_eq "...each command ran exactly once" "one two three" "$(tr '\n' ' ' <"$CNT" | sed 's/ $//')"
write_cfg

# 12: nothing in the new files names the space -------------------------------------------
# The pattern is built from pieces so this file does not contain the names itself.
names="$(printf '%s|%s|%s|%s' "hu""sk" "for""ge" "/wo""rk/" "/Us""ers/")"
assert_eq "no space-specific name or absolute path in the scripts" "0" \
  "$(grep -ciE "$names" "$LAND" "$RETIRE" | awk -F: '{s += $2} END {print s + 0}')"

# --host: on_land runs on the lead, never over ssh ------------------------------------------
# The "host" is this machine: the fake ssh runs the remote command here (marked with
# SHIP_FAKE_REMOTE=1) from a home of its own, so an on_land that ran over ssh would log
# "remote". The real rsync copies the scripts and mirrors the unit back (the same paths).
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

# a failing on_land stops before the teardown; the rerun resumes at it, then tears down
rm -f "$CNT"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo one-${SHIP_FAKE_REMOTE:-lead} >> '"$CNT"'", "test -f '"$FIX"'/hok && echo two-${SHIP_FAKE_REMOTE:-lead} >> '"$CNT"'"]'
mk_unit hl2 202
advance_main host-two
rc="$(land hl2 --host box)"
assert_eq "host land with a failing on_land: 1" "1" "$rc"
assert_contains "...it names the command" "$(cat "$FIX/land.err")" "on_land command failed"
assert_contains "...and the rerun command with --host" "$(cat "$FIX/land.err")" "ship-land hl2 --host box"
assert_eq "...the PR is merged and the unit is not torn down" "yes" "$([[ -d "$SPACE/notes/loops/hl2" && -d "$SPACE/worktrees/hl2" ]] && echo yes)"
assert_eq "...only the first command ran" "one-lead" "$(cat "$CNT")"
assert_eq "...the teardown phase has not run" "0" "$(grep -c 'phase.*finish' "$SSH_LOG")"
touch "$FIX/hok"
rc="$(land hl2 --host box)"
assert_eq "the rerun resumes at on_land and lands: 0" "0" "$rc"
assert_eq "...each on_land command ran once, on the lead" "one-lead two-lead" "$(tr '\n' ' ' <"$CNT" | sed 's/ $//')"
assert_eq "...the PR was not merged twice" "1" "$(grep -c 'pr merge 202' "$GH_LOG")"
assert_eq "...the teardown ran" "yes" "$([[ -d "$SPACE/notes/loops/.done/hl2" && ! -d "$SPACE/worktrees/hl2" ]] && echo yes)"
assert_eq "...and no on_land bookkeeping is left behind" "" "$(compgen -G "$SPACE/notes/loops/*on_land*" || true)"

# --- review rulings: saved task, validation first, MERGED required, abandon, resume ---------
hcnt() { tr '\n' ' ' <"$CNT" | sed 's/ $//'; }
state_files() { compgen -G "$SPACE/notes/loops/$1.*" || true; }

# --phase is internal
assert_eq "--phase without SHIP_UNIT_INTERNAL: usage (2)" "2" "$(env -u SHIP_UNIT_INTERNAL bash "$LAND" hl1 --phase merge >/dev/null 2>&1; echo $?)"
assert_eq "--phase with a bad value: 2" "2" "$(SHIP_UNIT_INTERNAL=1 bash "$LAND" hl1 --phase bogus >/dev/null 2>&1; echo $?)"

# on_land is validated before anything is merged
rm -f "$CNT"; : > "$SSH_LOG"
write_cfg 'hosts:
  box:
    ssh: fakehost
on_land: "not-a-list"
'
mk_unit hl7 307
advance_main host-seven
rc="$(land hl7 --host box)"
assert_eq "host land with an invalid on_land: 1" "1" "$rc"
assert_contains "...says so" "$(cat "$FIX/land.err")" "on_land must be a list"
assert_eq "...before any merge" "0" "$(grep -c 'pr merge 307' "$GH_LOG")"
assert_eq "...and before the host was asked to land" "0" "$(grep -c 'phase' "$SSH_LOG")"
bash "$LAND" hl7 --abandon >/dev/null 2>&1

# a rerun reuses the saved task; a different --task is refused
rm -f "$CNT" "$FIX/hok"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo {ref}-{task} >> '"$CNT"'", "test -f '"$FIX"'/hok && echo {task}-second >> '"$CNT"'"]'
mk_unit hl5 305
advance_main host-five
rc="$(land hl5 --host box --task T-5)"
assert_eq "host land (task T-5) with a failing on_land: 1" "1" "$rc"
assert_contains "...the rerun hint carries the task" "$(cat "$FIX/land.err")" "ship-land hl5 --host box --task T-5"
assert_eq "...the task is saved on the lead" "T-5" "$(cat "$SPACE/notes/loops/hl5.land.task")"
rc="$(land hl5 --host box --task T-6)"
assert_eq "a rerun with another --task: 2" "2" "$rc"
assert_contains "...naming the saved one" "$(cat "$FIX/land.err")" "T-5"
touch "$FIX/hok"
rc="$(land hl5 --host box)"
assert_eq "a rerun without --task lands: 0" "0" "$rc"
assert_eq "...it used the saved task, and the first command did not rerun" "hl5-T-5 T-5-second" "$(hcnt)"
assert_eq "...no land state is left on the lead" "" "$(state_files hl5)"

# the same for a local land
rm -f "$CNT" "$FIX/hok"
fresh_fake
write_cfg 'on_land: ["echo {task} >> '"$CNT"'", "test -f '"$FIX"'/hok && echo {task}-second >> '"$CNT"'"]
'
mk_unit hl6 306
advance_main host-six
rc="$(land hl6 --task T-6)"
assert_eq "local land (task T-6) with a failing on_land: 1" "1" "$rc"
assert_contains "...the rerun hint carries the task" "$(cat "$FIX/land.err")" "ship-land hl6 --task T-6"
assert_eq "a local rerun with another --task: 2" "2" "$(land hl6 --task X)"
touch "$FIX/hok"
assert_eq "a local rerun without --task lands: 0" "0" "$(land hl6)"
assert_eq "...with the saved task" "T-6 T-6-second" "$(hcnt)"

# a finish phase that fails: the rerun does not run on_land again
rm -f "$CNT"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo {ref} >> '"$CNT"'"]'
mk_unit hl4 304
advance_main host-four
rc="$(WT_FAIL=1 land hl4 --host box)"
assert_eq "host land whose teardown fails: 1" "1" "$rc"
assert_eq "...on_land ran once" "hl4" "$(hcnt)"
assert_eq "...and its record stays on the lead" "yes" "$([[ -f "$SPACE/notes/loops/hl4.on_land.done" ]] && echo yes)"
rc="$(land hl4 --host box)"
assert_eq "the rerun finishes: 0" "0" "$rc"
assert_eq "...without running on_land again" "hl4" "$(hcnt)"
assert_contains "...it says the command was done" "$(cat "$FIX/land.out")" "already done"
assert_eq "...the record is gone" "" "$(state_files hl4)"

# --abandon --host removes the on_land record
mk_unit hl3 303 PARKED
echo "303 1 echo x" > "$SPACE/notes/loops/hl3.on_land.done"
echo T-3 > "$SPACE/notes/loops/hl3.land.task"
rc="$(land hl3 --abandon --host box)"
assert_eq "abandon --host: 0" "0" "$rc"
assert_eq "...removes the lead's on_land record and task" "" "$(state_files hl3)"

# the PR must be MERGED before on_land and the teardown
rm -f "$CNT"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo {ref} >> '"$CNT"'"]'
mk_unit hl8 308
advance_main host-eight
rc="$(GH_MERGE_QUEUE=1 land hl8 --host box)"
assert_eq "host land while the PR stays OPEN after the merge call: 1" "1" "$rc"
assert_contains "...says it is not merged yet" "$(cat "$FIX/land.err")" "not merged yet"
assert_eq "...on_land did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
assert_eq "...nor the teardown" "0" "$(grep -c 'phase.*finish' "$SSH_LOG")"
assert_eq "--phase finish refuses an unmerged PR (3)" "3" "$(SHIP_UNIT_INTERNAL=1 bash "$LAND" hl8 --phase finish >/dev/null 2>&1; echo $?)"
bash "$LAND" hl8 --abandon --force >/dev/null 2>&1
rm -f "$CNT"
fresh_fake
write_cfg 'on_land: ["echo {ref} >> '"$CNT"'"]
'
mk_unit hl9 309
advance_main host-nine
rc="$(GH_MERGE_QUEUE=1 land hl9)"
assert_eq "local land while the PR stays OPEN: 1" "1" "$rc"
assert_eq "...on_land did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
assert_contains "...says it is not merged yet" "$(cat "$FIX/land.err")" "not merged yet"
bash "$LAND" hl9 --abandon --force >/dev/null 2>&1

# a rerun while the PR is queued to merge is refused before anything is touched
queued_rerun_check() { # <label> <ref> <env var> <land args...>
  local label="$1" r="$2" knob="$3" head_before remote_before g0 m0 rc
  shift 3
  # main moves first, so a rebase (and then a push) would change the branch
  QN=$((${QN:-0} + 1)); advance_main "queued-check-$QN"
  : > "$GH_LOG"; : > "$REMOTE/push.log"
  head_before="$(git -C "$SPACE/worktrees/$r" rev-parse HEAD)"
  remote_before="$(git -C "$REMOTE" rev-parse "refs/heads/$r")"
  g0="$(gate_runs)"; m0="$(merges)"
  rc="$(env "$knob=1" bash "$LAND" "$r" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?)"
  assert_eq "$label: exit 3" "3" "$rc"
  assert_contains "...says the PR is queued to merge" "$(cat "$FIX/land.err")" "queued to merge"
  assert_contains "...says to rerun once MERGED" "$(cat "$FIX/land.err")" "once it is MERGED"
  assert_contains "...and how to cancel auto-merge for a re-land" "$(cat "$FIX/land.err")" "cancel auto-merge"
  assert_eq "...no merge call" "$m0" "$(merges)"
  assert_eq "...no gate run" "$g0" "$(gate_runs)"
  assert_eq "...no rebase (the local head is unchanged)" "$head_before" "$(git -C "$SPACE/worktrees/$r" rev-parse HEAD)"
  assert_eq "...no push (the remote branch is unchanged)" "$remote_before" "$(git -C "$REMOTE" rev-parse "refs/heads/$r")"
  assert_eq "...no ref update reached the remote (hook log empty)" "" "$(cat "$REMOTE/push.log")"
  assert_contains "...the message names the merge state (auto-merge case) or the queue" "$(cat "$FIX/land.err")" "$([[ "$knob" == GH_QUEUE ]] && echo "merge queue" || echo "merge state")"
}
rm -f "$CNT"
fresh_fake
write_cfg 'on_land: ["echo {ref}-{pr} >> '"$CNT"'"]
'
mk_unit q1 501
advance_main queue-one
rc="$(GH_MERGE_QUEUE=1 land q1)"
assert_eq "first land with a merge queue: the PR stays open, exit 1" "1" "$rc"
queued_rerun_check "rerun while auto-merge is enabled" q1 GH_AUTOMERGE
queued_rerun_check "rerun while in the merge queue" q1 GH_QUEUE
assert_eq "...the unit is kept" "yes" "$([[ -d "$SPACE/worktrees/q1" ]] && echo yes || echo no)"
assert_eq "...on_land did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
# the PR is merged (by the queue): the rerun lands normally, with no merge call
touch "$REMOTE/merged-q1"
git -C "$REMOTE" update-ref refs/heads/main "$(git -C "$REMOTE" rev-parse refs/heads/q1)"
m0="$(merges)"
rc="$(GH_AUTOMERGE=1 GH_QUEUE=1 land q1)"
assert_eq "rerun once the PR is MERGED: 0" "0" "$rc"
assert_eq "...no merge call" "$m0" "$(merges)"
assert_eq "...on_land ran" "q1-501" "$(hcnt)"
assert_eq "...the worktree was torn down" "no" "$([[ -d "$SPACE/worktrees/q1" ]] && echo yes || echo no)"
# a PR merged outside this ship-land (no land state was ever saved) is finished the same way
rm -f "$CNT"
mk_unit q2 502
advance_main queue-two
touch "$REMOTE/merged-q2"
git -C "$REMOTE" update-ref refs/heads/main "$(git -C "$REMOTE" rev-parse refs/heads/q2)"
assert_eq "...no saved land state before" "" "$(state_files q2)"
rc="$(land q2)"
assert_eq "a PR merged elsewhere, never recorded by ship-land: 0" "0" "$rc"
assert_eq "...on_land ran once" "q2-502" "$(hcnt)"
assert_eq "...the worktree was torn down" "no" "$([[ -d "$SPACE/worktrees/q2" ]] && echo yes || echo no)"
# host mode: the host's merge phase refuses, before any push, and nothing runs on the lead
rm -f "$CNT"; : > "$SSH_LOG"
fresh_fake
hcfg '["echo {ref} >> '"$CNT"'"]'
mk_unit q3 503
advance_main queue-three
rc="$(GH_MERGE_QUEUE=1 land q3 --host box)"
assert_eq "host land with a merge queue: the PR stays open, exit 1" "1" "$rc"
queued_rerun_check "host rerun while auto-merge is enabled" q3 GH_AUTOMERGE --host box
assert_eq "...the host's merge phase ran" "2" "$(grep -c 'phase.*merge' "$SSH_LOG")"
assert_eq "...no teardown phase" "0" "$(grep -c 'phase.*finish' "$SSH_LOG")"
assert_eq "...on_land did not run" "" "$([[ -s "$CNT" ]] && echo ran)"
queued_rerun_check "host rerun while in the merge queue" q3 GH_QUEUE --host box
touch "$REMOTE/merged-q3"
git -C "$REMOTE" update-ref refs/heads/main "$(git -C "$REMOTE" rev-parse refs/heads/q3)"
rc="$(GH_AUTOMERGE=1 land q3 --host box)"
assert_eq "host rerun once the PR is MERGED: 0" "0" "$rc"
assert_eq "...on_land ran" "q3" "$(hcnt)"
assert_eq "...the teardown ran on the host" "1" "$(grep -c 'phase.*finish' "$SSH_LOG")"

# the merge-queue query fails: the land goes on, with a warning, never silently
rm -f "$CNT"
fresh_fake
write_cfg 'on_land: ["echo {ref}-{pr} >> '"$CNT"'"]
'
mk_unit q4 504
advance_main queue-four
rc="$(GH_GQL_FAIL=1 land q4)"
assert_eq "merge-queue query failing: the land goes on (0)" "0" "$rc"
assert_contains "...warns on stderr that the check was skipped" "$(cat "$FIX/land.err")" "merge-queue check skipped"
assert_contains "...with gh's exit code" "$(cat "$FIX/land.err")" "exit 1"
assert_contains "...and gh's error text" "$(cat "$FIX/land.err")" "HTTP 502 (stub graphql)"
mk_unit q5 505
advance_main queue-five
rc="$(GH_GQL_NOFIELD=1 land q5)"
assert_eq "no isInMergeQueue field (older GHES): the land goes on (0)" "0" "$rc"
assert_eq "...without a warning" "0" "$(grep -c 'merge-queue check skipped' "$FIX/land.err" || true)"
# auto-merge set but the PR is BEHIND: the refusal names the merge state
mk_unit q6 506
advance_main queue-six
rc="$(GH_MERGE_QUEUE=1 land q6)"
queued_rerun_check "rerun with auto-merge set on a BEHIND PR" q6 GH_AUTOMERGE
rc="$(GH_MSS=BEHIND GH_AUTOMERGE=1 land q6)"
assert_eq "...a BEHIND PR with auto-merge is refused (3)" "3" "$rc"
assert_contains "...the refusal names the merge state" "$(cat "$FIX/land.err")" "merge state BEHIND"
bash "$LAND" q6 --abandon --force >/dev/null 2>&1

# a lost connection: the hint carries --task
: > "$FIX/ssh.lost"
hcfg '[]'
mk_unit hl10 310
rc="$(land hl10 --host box --task T-10)"
rm -f "$FIX/ssh.lost"
assert_eq "host land with the connection lost: 1" "1" "$rc"
assert_contains "...the hint carries --task" "$(cat "$FIX/land.err")" "Rerun 'ship-land hl10 --host box --task T-10'"
bash "$LAND" hl10 --abandon --force >/dev/null 2>&1

# an entry without the PR number (written before PR #99) is not accepted
rm -f "$CNT"
fresh_fake
hcfg '["echo {ref}-{pr} >> '"$CNT"'", "echo second >> '"$CNT"'"]'
mk_unit hl11 311
advance_main host-eleven
echo "1 echo hl11-311 >> $CNT" > "$SPACE/notes/loops/hl11.on_land.done"
rc="$(land hl11 --host box)"
assert_eq "an old-format done list: 0" "0" "$rc"
assert_eq "...is no longer honoured: the command it lists runs again" "hl11-311 second" "$(hcnt)"

# a host-mode land deletes the branch on the host side
rm -f "$CNT"
fresh_fake
hcfg '["true"]'
mk_unit hl12 312
advance_main host-twelve
rc="$(land hl12 --host box)"
assert_eq "host land: 0" "0" "$rc"
assert_contains "...the host's teardown ran wt remove -D" "$(tail -n 1 "$WT_LOG")" "remove -D hl12"
assert_eq "...the branch is deleted" "no" "$(git -C "$G" rev-parse -q --verify refs/heads/hl12 >/dev/null && echo yes || echo no)"
mk_unit hl13 313
advance_main host-thirteen
rc="$(GH_HEAD_OID=$(printf 'e%.0s' {1..40}) land hl13 --host box)"
assert_eq "host land with a differing PR head: 0" "0" "$rc"
assert_eq "...the branch is kept" "yes" "$(git -C "$G" rev-parse -q --verify refs/heads/hl13 >/dev/null && echo yes || echo no)"
PATH="$OLDPATH"

finish
