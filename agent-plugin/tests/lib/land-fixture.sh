#!/usr/bin/env bash
# shellcheck disable=SC2034  # globals read by the test files that source this one
# Shared fixture for test-t-ship-land.sh and test-t-ship-land-fn.sh: a bare remote, a bare space clone with a
# base worktree, a stub gh and wt, mux/fake, and the helpers that build a unit and run ship-land. Source it
# after helpers.sh. Nothing real is touched (no multiplexer, no GitHub).
#
# Builds once per file: one remote, one space. Cases add a branch and a worktree each; they never rebuild it.

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
# shellcheck source=../../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
reload_cfg() { unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load; }
write_cfg() {
  printf 'mux: fake\ngate: "echo gated >> %s"\n%s' "$GATE_LOG" "${1:-}" > "$SPACE/.hyper/ship.yml"
  reload_cfg
}
raw_cfg() { printf '%s' "$1" > "$SPACE/.hyper/ship.yml"; reload_cfg; }
write_cfg

# start_reaper — stands in for agents that quit when told to: any agent that has been sent something
# disappears, unless $FIX/noreap exists. Stopped when the file ends.
start_reaper() {
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
}

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

# mk_unit_git <ref> <pr> [status] [commits] — mk_unit without the multiplexer (no unit space, no mux.json):
# a worktree, a branch with <commits> commits (default 1, 0 = an empty branch), the pushed branch and a result.json.
mk_unit_git() {
  local ref="$1" pr="$2" st="${3:-READY}" n="${4:-1}" wt="$SPACE/worktrees/$1" i
  git -C "$G" fetch -q origin
  git -C "$G" worktree add -q -b "$ref" "$wt" origin/main
  for ((i = 1; i <= n; i++)); do
    echo "$ref $i" > "$wt/$ref-$i.txt"
    git -C "$wt" add "$ref-$i.txt"
    git -C "$wt" commit -q -m "feat: $ref"
  done
  [[ $n -eq 0 ]] || git -C "$wt" push -q origin "$ref"
  mkdir -p "$SPACE/notes/loops/$ref"
  jq -n --arg r "$ref" --arg w "$wt" --arg st "$st" --argjson pr "$pr" \
    '{ref: $r, pr: $pr, stage: "finalize", status: $st, rounds: [], spec: {verdict: "NOT_RUN", rounds: 0},
      final: {verdict: "NOT_RUN", rounds: 0}, specwriter: {runs: 0, commits: []}, finalize: null,
      failovers: 0, host: "local", worktree: $w}' > "$SPACE/notes/loops/$ref/result.json"
}
exists_word() { [[ -e "$1" ]] && echo yes || echo no; }
