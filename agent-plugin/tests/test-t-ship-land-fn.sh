#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034,SC2154  # ship-land is sourced by variable; the sourced functions read globals set per case
# Row T (ship-land), function level and refusal level: the decisions ship-land makes, one at a time,
# without a whole land. Three kinds of case:
#   1. the functions of scripts/ship/ship-land, sourced (it has a main guard) and called in a subshell with the
#      globals the main body would have set: decide_branch_cleanup, decide_queued, resolve_task,
#      save_land_state, clear_land_state, load_on_land, run_on_land, check_rec, teardown (with a stub
#      ship-mux and ship-retire that log their arguments);
#   2. the script itself on a git-only unit (a worktree, a branch, a stub gh and wt, no multiplexer): the
#      gates and refusals before a merge, the PR lookups, the merge error paths, the lease, the usage table;
#   3. --host before the host is reached, over a stub ssh and rsync (no real rsync needed).
# The journeys (a whole land and teardown, the rerun, the queue, the lock message, on_land, --host over
# real rsync) are in test-t-ship-land.sh.
#
# Every group names its mutation: the production line that, edited out or inverted, makes the group fail.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/land-fixture.sh"

errof() { cat "$FIX/land.err"; }
outof() { cat "$FIX/land.out"; }
branch_exists() { git -C "$G" rev-parse -q --verify "refs/heads/$1" >/dev/null && echo yes || echo no; }

# --- a copy of the scripts whose ship-mux and ship-retire only log their calls --------------------------
W3="$FIX/w3"; mkdir -p "$W3"
cp "$LAND" "$SHIP_DIR/lib.sh" "$SHIP_DIR/lib-host.sh" "$W3/"
MUXLOG="$FIX/w3.mux.log"
cat > "$W3/ship-mux" <<WRAP
#!/usr/bin/env bash
echo "\$*" >> "$MUXLOG"
if [[ "\$1" == list ]]; then echo '[]'; fi
WRAP
cp "$W3/ship-mux" "$W3/ship-retire"
chmod +x "$W3/ship-mux" "$W3/ship-retire"
wl() { SHIP_PLUGIN_ROOT="$PLUGIN_DIR" bash "$W3/ship-land" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }
mux_calls() { if [[ -s "$MUXLOG" ]]; then wc -l <"$MUXLOG" | tr -d ' '; else echo 0; fi; }

# ===== 1. functions ====================================================================================
# decide_branch_cleanup <abandon> <force> <merged_seen> <local_sha> <pr_sha> <pr_rc> -> delete|keep (+ reason on stderr)
# mutation: invert any test in decide_branch_cleanup, or drop the "-n $local_sha" guard (row 9)
dbc_row() { # <label> <expected> <stderr needle or ""> <args...>
  local label="$1" want="$2" needle="$3" got
  shift 3
  got="$( source "$LAND"; branch=feat-x pr=77; decide_branch_cleanup "$@" 2>"$FIX/dbc.err" )"
  assert_eq "decide_branch_cleanup: $label" "$want" "$got"
  if [[ -n "$needle" ]]; then assert_contains "...it says why: $needle" "$(cat "$FIX/dbc.err")" "$needle"
  else assert_eq "...silently" "" "$(cat "$FIX/dbc.err")"; fi
}
SHA_A=$(printf 'a%.0s' {1..40}); SHA_F=$(printf 'f%.0s' {1..40})
dbc_row "abandon without --force keeps the branch" keep "" 1 0 0 "" "" 0
dbc_row "abandon with --force deletes it" delete "" 1 1 0 "" "" 0
dbc_row "abandon --force deletes it even if a merge was seen" delete "" 1 1 1 "$SHA_A" "$SHA_F" 0
dbc_row "a land that did not see the PR merged keeps it" keep "" 0 0 0 "$SHA_A" "$SHA_A" 0
dbc_row "branch head equals the merged PR head: deleted" delete "" 0 0 1 "$SHA_A" "$SHA_A" 0
dbc_row "branch head differs from the PR head: kept, both SHAs printed" keep "is not the head of merged #77 ($SHA_F)" 0 0 1 "$SHA_A" "$SHA_F" 0
assert_contains "...and the branch's own SHA" "$(cat "$FIX/dbc.err")" "keeping branch feat-x: its head ($SHA_A)"
dbc_row "the PR head could not be read: kept, gh's error text shown" keep "could not read the head of merged #77 (gh pr view exit 22: HTTP 502 (stub))" 0 0 1 "$SHA_A" "HTTP 502 (stub)" 22
dbc_row "the PR head could not be read and gh said nothing" keep "gh pr view exit 1: no output)" 0 0 1 "$SHA_A" "" 1
dbc_row "no local head (rev-parse failed) never matches an empty PR head" keep "its head (unknown) is not the head of merged #77 (unknown)" 0 0 1 "" "" 0

# decide_queued <pr_json> <gq_rc> <gq_out> <gq_err> -> the reason the OPEN PR is queued (nothing when it is not)
# mutation: drop the autoMergeRequest branch, the isInMergeQueue == true test, or the GHES "doesn't exist" check
dq_row() { # <label> <expected stdout> <stderr needle or ""> <pr_json> <gq_rc> <gq_out> <gq_err>
  local label="$1" want="$2" needle="$3" got
  shift 3
  got="$( source "$LAND"; pr=77; decide_queued "$@" 2>"$FIX/dq.err" )"
  assert_eq "decide_queued: $label" "$want" "$got"
  if [[ -n "$needle" ]]; then assert_contains "...warns: $needle" "$(cat "$FIX/dq.err")" "$needle"
  else assert_eq "...silently" "" "$(cat "$FIX/dq.err")"; fi
}
PRJ_PLAIN='{"state":"OPEN","autoMergeRequest":null,"mergeStateStatus":"CLEAN","url":"https://github.com/acme/stub/pull/77"}'
PRJ_AUTO='{"state":"OPEN","autoMergeRequest":{"enabledBy":{"login":"op"},"mergeMethod":"REBASE"},"mergeStateStatus":"BEHIND","url":"https://github.com/acme/stub/pull/77"}'
PRJ_NOURL='{"state":"OPEN","autoMergeRequest":null,"mergeStateStatus":"CLEAN","url":"not-a-url"}'
dq_row "auto-merge set: names the merge state (BEHIND may never merge)" "auto-merge is set (merge state BEHIND; if it is BEHIND or BLOCKED it may never merge)" "" "$PRJ_AUTO" skip "" ""
dq_row "auto-merge wins over the queue query" "auto-merge is set (merge state BEHIND; if it is BEHIND or BLOCKED it may never merge)" "" "$PRJ_AUTO" 0 true ""
dq_row "in the merge queue" "it is in the merge queue" "" "$PRJ_PLAIN" 0 true ""
dq_row "not in the merge queue" "" "" "$PRJ_PLAIN" 0 false ""
dq_row "an empty answer is not a queue" "" "" "$PRJ_PLAIN" 0 "" ""
dq_row "the query fails: the land goes on, with gh's exit code and text" "" "merge-queue check skipped for #77: gh api graphql failed (exit 1): gh: HTTP 502 (stub graphql)" "$PRJ_PLAIN" 1 "" "gh: HTTP 502 (stub graphql)"
dq_row "a GHES without the field: nothing to say" "" "" "$PRJ_PLAIN" 1 "" "gh: GraphQL: Field 'isInMergeQueue' doesn't exist on type 'PullRequest'"
dq_row "a failure that names the field but is not 'does not exist' still warns" "" "merge-queue check skipped for #77" "$PRJ_PLAIN" 1 "" "gh: isInMergeQueue timed out"
dq_row "a 'does not exist' failure about something else still warns" "" "merge-queue check skipped for #77" "$PRJ_PLAIN" 1 "" "gh: repository doesn't exist"
dq_row "owner/repo unreadable from the PR url: warns, names the url" "" "could not read owner/repo from the PR url 'not-a-url'" "$PRJ_NOURL" skip "" ""

# resolve_task <prefix> — {task} is the saved one; a different --task is refused (2); without either, the ref
# mutation: drop the saved-task branch, the mismatch test, or the ref fallback
RT="$FIX/rt"; mkdir -p "$RT"
rt_run() { # <saved or ""> <task or ""> -> "task|rc" ; stderr in $FIX/rt.err
  rm -f "$RT/x.land.task"; [[ -z "$1" ]] || printf '%s\n' "$1" >"$RT/x.land.task"
  ( source "$LAND"; ref=u9 task="$2"; resolve_task "$RT/x."; echo "task=$task" ) 2>"$FIX/rt.err"
  echo "rc=$?"
}
assert_eq "resolve_task: nothing saved, no --task: the ref" "task=u9 rc=0" "$(rt_run "" "" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "resolve_task: nothing saved, --task X: X" "task=X rc=0" "$(rt_run "" X | tr '\n' ' ' | sed 's/ $//')"
assert_eq "resolve_task: a saved task is reused" "task=T-5 rc=0" "$(rt_run T-5 "" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "resolve_task: the same --task as the saved one is fine" "task=T-5 rc=0" "$(rt_run T-5 T-5 | tr '\n' ' ' | sed 's/ $//')"
assert_eq "resolve_task: another --task is a usage error (2)" "rc=2" "$(rt_run T-5 T-6 | tr '\n' ' ' | sed 's/ $//')"
assert_contains "...naming both tasks and the way out" "$(cat "$FIX/rt.err")" "--task T-6 differs from the task saved at the first land of u9 (T-5); rerun with --task T-5 or without --task"

# save_land_state / clear_land_state — <prefix>land.task, land.pr and on_land.done
# mutation: save the wrong value to either file, or leave one of the three files in clear
LS="$FIX/ls"; mkdir -p "$LS"
( source "$LAND"; task=T-3 pr=303; save_land_state "$LS/u3." )
assert_eq "save_land_state: the task" "T-3" "$(cat "$LS/u3.land.task")"
assert_eq "save_land_state: the PR number" "303" "$(cat "$LS/u3.land.pr")"
echo "303 1 echo x" > "$LS/u3.on_land.done"; echo keep > "$LS/u4.land.task"; echo keep > "$LS/u3.mux.json"
( source "$LAND"; clear_land_state "$LS/u3." )
assert_eq "clear_land_state: removes task, PR and the done list, nothing else" "u3.mux.json u4.land.task" "$(cd "$LS" && ls | tr '\n' ' ' | sed 's/ $//')"
( source "$LAND"; task=T-3 pr=303; save_land_state "$LS/deep/er/u5." )
assert_eq "save_land_state creates the directory" "T-3" "$(cat "$LS/deep/er/u5.land.task")"

# load_on_land — the on_land list from the config, checked
# mutation: drop the array check, or the default for a missing key
lo_run() { # <ship.yml tail> -> "<on_land json>|rc"
  raw_cfg "$1"
  ( source "$LAND"; load_on_land; printf '%s' "$(jq -c . <<<"$on_land")" ) 2>"$FIX/lo.err"
  echo "|rc=$?"
}
assert_eq "load_on_land: a list" '["echo a","echo b"]|rc=0' "$(lo_run 'mux: fake
on_land: ["echo a", "echo b"]
')"
assert_eq "load_on_land: no on_land key: an empty list" "[]|rc=0" "$(lo_run 'mux: fake
')"
assert_eq "load_on_land: a string is refused (1)" "|rc=1" "$(lo_run 'mux: fake
on_land: "not-a-list"
')"
assert_contains "...saying on_land must be a list" "$(cat "$FIX/lo.err")" "on_land must be a list of commands"
write_cfg

# run_on_land <prefix> <rerun command> — each command once, recorded as "<pr> <index> <text>"
# mutation: skip the done check, record before the command ran, drop {ref}/{pr}/{task}, accept an entry without the PR number
ro_run() { # <on_land json> -> rc ; output in $FIX/ro.out/.err
  ( source "$LAND"; ref=u1 pr=101 task=T-1 root="$RO_ROOT" on_land="$1"; run_on_land "$RO/u1." "ship-land u1 --task T-1" ) >"$FIX/ro.out" 2>"$FIX/ro.err"
  echo $?
}
RO="$FIX/ro"; RO_ROOT="$FIX/ro-root"; mkdir -p "$RO" "$RO_ROOT"
rm -f "$RO/u1.on_land.done"
assert_eq "run_on_land: runs each command in the space root, placeholders replaced" "0" "$(ro_run '["pwd >> out.log", "echo {ref}-{pr}-{task} >> out.log"]')"
assert_eq "...output" "$RO_ROOT u1-101-T-1" "$(tr '\n' ' ' <"$RO_ROOT/out.log" | sed 's/ $//')"
assert_eq "...each success is recorded with the PR number and its index" "101 1 pwd >> out.log|101 2 echo {ref}-{pr}-{task} >> out.log" "$(sed 's/{ref}/{ref}/' "$RO/u1.on_land.done" | sed 's/{pr}/{pr}/' | tr '\n' '|' | sed 's/|$//' | sed 's/u1-101-T-1/{ref}-{pr}-{task}/')"
rm -f "$RO_ROOT/out.log"
assert_eq "...a rerun with the same list runs nothing" "0" "$(ro_run '["pwd >> out.log", "echo {ref}-{pr}-{task} >> out.log"]')"
assert_eq "...(nothing ran again)" "no" "$(exists_word "$RO_ROOT/out.log")"
assert_contains "...and says so" "$(cat "$FIX/ro.out")" "on_land: already done: pwd >> out.log"
rm -f "$RO/u1.on_land.done" "$RO_ROOT/out.log"
assert_eq "a failing command stops the list (1)" "1" "$(ro_run '["echo one >> out.log", "exit 7", "echo three >> out.log"]')"
assert_contains "...it names the command" "$(cat "$FIX/ro.err")" "on_land command failed: exit 7"
assert_contains "...and the rerun command, and that the teardown has not run" "$(cat "$FIX/ro.err")" "rerun 'ship-land u1 --task T-1' to resume from that command (the teardown has not run)"
assert_eq "...only the first command ran and is recorded" "one|101 1 echo one >> out.log" "$(tr '\n' '|' <"$RO_ROOT/out.log" | sed 's/|$//')|$(cat "$RO/u1.on_land.done")"
rm -f "$RO/u1.on_land.done" "$RO_ROOT/out.log"
printf '%s\n' "1 echo old >> out.log" > "$RO/u1.on_land.done"   # the format before the PR number was recorded
assert_eq "an entry without the PR number is not honoured" "0" "$(ro_run '["echo old >> out.log"]')"
assert_eq "...the command ran" "old" "$(cat "$RO_ROOT/out.log")"
rm -f "$RO/u1.on_land.done" "$RO_ROOT/out.log"
printf '%s\n' "100 1 echo x >> out.log" > "$RO/u1.on_land.done"   # the same command of another PR
assert_eq "an entry of another PR does not skip the command" "0" "$(ro_run '["echo x >> out.log"]')"
assert_eq "...it ran" "x" "$(cat "$RO_ROOT/out.log")"
rm -f "$RO/u1.on_land.done" "$RO_ROOT/out.log"
assert_eq "an empty command is skipped but counts for the index" "0" "$(ro_run '["", "echo b >> out.log"]')"
assert_eq "...(index 2)" "101 2 echo b >> out.log" "$(cat "$RO/u1.on_land.done")"
assert_eq "an empty list runs nothing and succeeds" "0" "$(ro_run '[]')"

# check_rec — a malformed mux.json is reported, never a bare jq exit code
# mutation: drop the type test, or the "|| fail"
CR="$FIX/cr"; mkdir -p "$CR"
cr_run() { ( source "$LAND"; ref=u1 rec="$CR/mux.json"; check_rec ) 2>"$FIX/cr.err"; echo $?; }
rm -f "$CR/mux.json"
assert_eq "check_rec: no record is fine" "0" "$(cr_run)"
echo '{"backend":"fake","created":[]}' >"$CR/mux.json"
assert_eq "check_rec: a valid record is fine" "0" "$(cr_run)"
printf '{"backend":"fake","created":[' >"$CR/mux.json"
assert_eq "check_rec: a truncated record fails (1)" "1" "$(cr_run)"
assert_contains "...naming the file and the way out" "$(cat "$FIX/cr.err")" "$CR/mux.json is not a valid mux record (truncated or edited?); fix or remove it, then rerun ship-land u1 (or --abandon)"
echo '{"created":"x"}' >"$CR/mux.json"
assert_eq "check_rec: created that is not a list fails (1)" "1" "$(cr_run)"

# teardown — stub ship-mux and ship-retire that log their arguments; wt and gh are functions in the subshell
# mutation: swap the order of the closes, drop the root-pane filter, the created==true group filter, the
# "bad=1" of a failed close, the list check, the harness argument, or the "wt remove" failure test
TD="$FIX/td"; mkdir -p "$TD"
cat > "$TD/ship-mux" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$TD/mux.log"
id=""; prev=""; for a in "\$@"; do [[ "\$prev" == --id ]] && id="\$a"; prev="\$a"; done
case "\$1" in
  close) [[ ! -f "$TD/close.msg.\$id" ]] || cat "$TD/close.msg.\$id"
         [[ ! -f "$TD/close.rc.\$id" ]] || exit "\$(cat "$TD/close.rc.\$id")" ;;
  list) [[ -f "$TD/list.json" ]] && cat "$TD/list.json" || echo '[]'
        [[ ! -f "$TD/list.rc" ]] || exit "\$(cat "$TD/list.rc")" ;;
esac
exit 0
STUB
cat > "$TD/ship-retire" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$TD/retire.log"
[[ ! -f "$TD/retire.rc" ]] || exit "\$(cat "$TD/retire.rc")"
exit 0
STUB
chmod +x "$TD/ship-mux" "$TD/ship-retire"
git init -q "$TD/wt"
git -C "$TD/wt" commit -q --allow-empty -m "chore: tip"
git -C "$TD/wt" branch -M feat
git -C "$TD/wt" branch bc6-renamed
TIP="$(git -C "$TD/wt" rev-parse HEAD)"
td_reset() {
  rm -rf "$TD/root" "$TD"/*.log "$TD"/close.* "$TD"/list.* "$TD"/retire.rc "$TD"/wt.fail "$TD"/gh.*
  mkdir -p "$TD/root/notes/loops/r1" "$TD/root/.hyper"
  cat > "$TD/root/notes/loops/r1/mux.json" <<'JSON'
{"backend":"fake","created":[
 {"kind":"space","id":"S1","group":"g-units"},
 {"kind":"pane","id":"P0","root":true},
 {"kind":"pane","id":"P1"},
 {"kind":"agent","id":"A1","harness":"claude"},
 {"kind":"agent","id":"A2"}]}
JSON
  echo '{"groups":{"g-units":{"created":true},"g-pre":{"created":false}}}' >"$TD/root/.hyper/ship-mux.json"
}
td() { # <assignments evaluated in the subshell> -> rc; stdout/stderr in $FIX/td.out/.err
  (
    source "$LAND"
    ref=r1 root="$TD/root" loop_dir="$TD/root/notes/loops/r1" rec="$TD/root/notes/loops/r1/mux.json"
    wt_path="$TD/wt" branch=feat abandon=0 force=0 merged_seen=0 pr=77
    MUX="$TD/ship-mux" RETIRE="$TD/ship-retire"
    wt() { echo "wt $*" >>"$TD/wt.log"; [[ ! -e "$TD/wt.fail" ]] || { echo "wt: refusing" >&2; return 1; }; }
    gh() { if [[ -f "$TD/gh.rc" ]]; then echo "HTTP 502 (stub)"; return "$(cat "$TD/gh.rc")"; fi; cat "$TD/gh.out"; }
    eval "$1"
    teardown
  ) >"$FIX/td.out" 2>"$FIX/td.err"
  echo $?
}
mlog() { tr '\n' '|' <"$TD/mux.log" 2>/dev/null | sed 's/|$//'; }
td_reset
assert_eq "teardown: exit 0" "0" "$(td "")"
assert_eq "...each recorded agent retired, the harness passed when the record has one" "--ref r1 --harness claude A1|--ref r1 A2" "$(tr '\n' '|' <"$TD/retire.log" | sed 's/|$//')"
assert_eq "...panes, then the space, then the list check, then only the group ship created (never the root pane)" \
  "close --ref r1 --id P1|close --ref r1 --id S1|list --ref r1|close --ref r1 --id g-units" "$(mlog)"
assert_contains "...says what it closed" "$(cat "$FIX/td.out")" "pane P1 closed"
assert_contains "...the space" "$(cat "$FIX/td.out")" "unit space S1 closed"
assert_contains "...and the group" "$(cat "$FIX/td.out")" "units group g-units closed"
assert_eq "...an unmerged, non-abandon land keeps the branch: wt without -D, by branch name" "wt remove feat" "$(cat "$TD/wt.log")"
assert_eq "...the loop dir moved to .done" "yes no" "$(exists_word "$TD/root/notes/loops/.done/r1/mux.json") $(exists_word "$TD/root/notes/loops/r1")"
td_reset; mkdir -p "$TD/root/notes/loops/.done/r1"
assert_eq "teardown with a .done/<ref> already there: exit 0" "0" "$(td "")"
assert_eq "...the loop dir moved beside it under a stamped name" "yes" "$([[ -n "$(compgen -G "$TD/root/notes/loops/.done/r1.[0-9]*")" ]] && echo yes || echo no)"

td_reset; echo 3 >"$TD/close.rc.g-units"; echo "ship-mux: refused: others use it" >"$TD/close.msg.g-units"
assert_eq "a group the backend refuses (3): exit 0" "0" "$(td "")"
assert_contains "...kept, with the backend's reason" "$(cat "$FIX/td.out")" "units group g-units kept (others use it)"
assert_eq "...the worktree was still removed" "wt remove feat" "$(cat "$TD/wt.log")"
td_reset; echo 1 >"$TD/close.rc.g-units"; echo "boom" >"$TD/close.msg.g-units"
assert_eq "a group close that fails (1): exit 0" "0" "$(td "")"
assert_contains "...a warning, retried by the next land" "$(cat "$FIX/td.err")" "warning: could not close units group g-units (ship-mux exit 1): boom; the next land retries"
td_reset; echo '{"groups":{"g-pre":{"created":false}}}' >"$TD/root/.hyper/ship-mux.json"
td "" >/dev/null
assert_eq "a group ship did not create is never closed" "close --ref r1 --id P1|close --ref r1 --id S1|list --ref r1" "$(mlog)"
td_reset; rm -f "$TD/root/.hyper/ship-mux.json"
assert_eq "no group record: exit 0" "0" "$(td "")"

td_reset; echo '{"backend":"fake","created":[{"kind":"agent","id":"A3","harness":"codex"},{"kind":"agent","id":"A4","harness":"pi"}]}' >"$TD/root/notes/loops/r1/mux.json"
td "" >/dev/null
assert_eq "teardown passes codex and pi as the harness" "--ref r1 --harness codex A3|--ref r1 --harness pi A4" "$(tr '\n' '|' <"$TD/retire.log" | sed 's/|$//')"
td_reset; echo '{"backend":"fake","created":[{"kind":"agent","id":"A5","harness":"bash"}]}' >"$TD/root/notes/loops/r1/mux.json"
td "" >/dev/null
assert_eq "...an unknown harness in the record is not passed on" "--ref r1 A5" "$(cat "$TD/retire.log")"

td_reset; echo 4 >"$TD/retire.rc"
assert_eq "a retire that exits 4: teardown goes on (0)" "0" "$(td "")"
assert_contains "...with a warning naming the exit code" "$(cat "$FIX/td.err")" "warning: ship-retire A1 exited 4; closing its pane regardless"
assert_eq "...and the panes were still closed" "close --ref r1 --id P1|close --ref r1 --id S1|list --ref r1|close --ref r1 --id g-units" "$(mlog)"

td_reset; echo 1 >"$TD/close.rc.P1"
assert_eq "a failed pane close: exit 1" "1" "$(td "")"
assert_contains "...naming the pane and the exit code" "$(cat "$FIX/td.err")" "could not close pane P1 (ship-mux exit 1)"
assert_contains "...and the way out" "$(cat "$FIX/td.err")" "teardown incomplete; the worktree and notes/loops/r1 are kept. Fix the cause and rerun 'ship-land r1'"
assert_eq "...nothing after the checks ran (no group close, no wt)" "no yes" "$(exists_word "$TD/wt.log") $(exists_word "$TD/root/notes/loops/r1/mux.json")"
td_reset; echo 1 >"$TD/close.rc.S1"
assert_eq "a failed space close: exit 1" "1" "$(td "")"
assert_contains "...naming the space" "$(cat "$FIX/td.err")" "could not close space S1 (ship-mux exit 1)"
assert_eq "...the worktree and the loop dir are kept" "no yes" "$(exists_word "$TD/wt.log") $(exists_word "$TD/root/notes/loops/r1/mux.json")"
td_reset; echo '["agent-1"]' >"$TD/list.json"
assert_eq "an id the backend still lists after the closes: exit 1" "1" "$(td "")"
assert_contains "...the list is what says so" "$(cat "$FIX/td.err")" 'the multiplexer still holds: ["agent-1"]'
assert_eq "...the worktree is kept" "no" "$(exists_word "$TD/wt.log")"
td_reset; echo 2 >"$TD/list.rc"
assert_eq "a list that fails: exit 1" "1" "$(td "")"
assert_contains "...naming the exit code" "$(cat "$FIX/td.err")" "ship-mux list failed (exit 2)"

# the worktree: which branch is deleted with it
td_reset
assert_eq "abandon --force: wt remove -D" "0 wt remove -D feat" "$(td 'abandon=1 force=1') $(cat "$TD/wt.log")"
td_reset
assert_eq "abandon without --force: wt remove" "0 wt remove feat" "$(td 'abandon=1') $(cat "$TD/wt.log")"
td_reset; echo "$TIP" >"$TD/gh.out"
assert_eq "merged, the branch is exactly what the PR merged: wt remove -D" "0 wt remove -D feat" "$(td 'merged_seen=1') $(cat "$TD/wt.log")"
td_reset; echo "$TIP" >"$TD/gh.out"
assert_eq "merged, the branch name differs from the ref: wt gets the branch name" "0 wt remove -D bc6-renamed" "$(td 'merged_seen=1 branch=bc6-renamed') $(cat "$TD/wt.log")"
td_reset; printf 'e%.0s' {1..40} >"$TD/gh.out"
assert_eq "merged, the PR head differs: wt remove, no -D" "0 wt remove feat" "$(td 'merged_seen=1') $(cat "$TD/wt.log")"
assert_contains "...with both SHAs printed" "$(cat "$FIX/td.err")" "keeping branch feat: its head ($TIP) is not the head of merged #77 ($(printf 'e%.0s' {1..40}))"
td_reset; echo 22 >"$TD/gh.rc"
assert_eq "merged, gh cannot read the PR head: wt remove, no -D" "0 wt remove feat" "$(td 'merged_seen=1') $(cat "$TD/wt.log")"
assert_contains "...saying so, with gh's error" "$(cat "$FIX/td.err")" "could not read the head of merged #77 (gh pr view exit 22: HTTP 502 (stub))"
td_reset; touch "$TD/wt.fail"
assert_eq "a failed wt remove: exit 1" "1" "$(td 'merged_seen=1')"
assert_contains "...saying so" "$(cat "$FIX/td.err")" "wt remove feat failed; the worktree is kept"
assert_eq "...the loop dir stays for the rerun" "yes" "$(exists_word "$TD/root/notes/loops/r1/mux.json")"
td_reset; rm -f "$TD/root/notes/loops/r1/mux.json"
assert_eq "no mux record: no retire, no pane or space close, the unit is still torn down" "0 no wt remove feat" "$(td "") $(exists_word "$TD/retire.log") $(cat "$TD/wt.log")"

# a detached HEAD has no branch for wt: removed by path; a directory that is not a worktree is kept
td_reset; git -C "$TD/wt" worktree add -q --detach "$TD/wt-det"
assert_eq "detached HEAD: exit 0" "0" "$(td 'wt_path="$TD/wt-det" branch=""')"
assert_contains "...removed by path" "$(cat "$FIX/td.out")" "worktree $TD/wt-det removed (detached HEAD; its branch, if any, is untouched)"
assert_eq "...the directory is gone and wt was not asked" "no no" "$(exists_word "$TD/wt-det") $(exists_word "$TD/wt.log")"
# a real repo, not a bare directory: a main working tree is a directory git refuses to remove, on any git
# version (outside a repo, older git prints the option name and ship-land reports "not a git worktree" instead)
td_reset; mkdir -p "$TD/plain"; git init -q "$TD/plain"
assert_eq "a worktree directory that git cannot remove: exit 1" "1" "$(td 'wt_path="$TD/plain" branch=""')"
assert_contains "...kept, and says so" "$(cat "$FIX/td.err")" "could not remove the detached worktree $TD/plain; it is kept"
assert_eq "...before the loop dir moves" "yes" "$(exists_word "$TD/root/notes/loops/r1/mux.json")"

# ===== 2. the script on a git-only unit ================================================================
# These runs stop before the merge (refusals), or are the cheapest run that reaches the line they test.
# mutation per group: the named refusal or message removed from ship-land
write_cfg
gate_state() { echo "$(gate_runs)/$(merges)"; }

# the status gate: a non-READY unit is refused, nothing is touched; --force lands it
mk_unit_git p1 601 PARKED
printf '{"backend":"fake","created":[{"kind":"agent","id":"agent-1","harness":"claude"}]}' >"$SPACE/notes/loops/p1/mux.json"
s0="$(gate_state)"; : >"$MUXLOG"
assert_eq "a non-READY unit is refused (3)" "3" "$(wl p1)"
assert_contains "...with the status named" "$(errof)" "p1 is not READY (result.json status: PARKED)"
assert_eq "...no gate, no merge" "$s0" "$(gate_state)"
assert_eq "...no multiplexer call" "0" "$(mux_calls)"
assert_eq "...the worktree stays" "yes" "$(exists_word "$SPACE/worktrees/p1")"
assert_eq "--force lands a non-READY unit" "0" "$(wl p1 --force)"
assert_eq "...it was merged" "feat: p1" "$(git -C "$REMOTE" log -1 --format=%s main)"

# a result.json that fails the schema: refused naming the key; --force continues with a warning
mk_unit_git i1 613
jq 'del(.rounds)' "$SPACE/notes/loops/i1/result.json" >"$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/i1/result.json"
s0="$(gate_state)"
assert_eq "a result.json that fails the schema is refused (3)" "3" "$(wl i1)"
assert_contains "...naming the missing key" "$(errof)" "rounds"
assert_eq "...no merge" "$s0" "$(gate_state)"
assert_eq "...--force lands it" "0" "$(wl i1 --force)"
assert_contains "...with a warning on stderr" "$(errof)" "does not match the result schema; continuing (--force)"

# the checks before the rebase
mk_unit_git e1 602 READY 0
assert_eq "a branch with no commits is refused (3)" "3" "$(wl e1)"
assert_contains "...saying so" "$(errof)" "branch e1 has no commits on top of origin/main"
mk_unit_git z1 605
echo dirty >>"$SPACE/worktrees/z1/z1-1.txt"
assert_eq "uncommitted changes are refused (3)" "3" "$(wl z1)"
assert_contains "...naming the worktree" "$(errof)" "$SPACE/worktrees/z1 has uncommitted changes"

# a rebase that drops a commit (the same patch is already on main): refused, the branch put back
mk_unit_git d1 604
git -C "$FIX/other" pull -q --ff-only origin main
echo "d1 1" >"$FIX/other/d1-1.txt"; git -C "$FIX/other" add d1-1.txt
git -C "$FIX/other" commit -q -m "feat: d1 (cherry-picked elsewhere)"; git -C "$FIX/other" push -q origin main
before="$(git -C "$SPACE/worktrees/d1" rev-parse HEAD)"; s0="$(gate_state)"
assert_eq "a rebase that drops a commit is refused (3)" "3" "$(wl d1)"
assert_contains "...saying so" "$(errof)" "rebase dropped commits (1 before, 0 after); the branch is unchanged"
assert_eq "...the branch is back where it was" "$before" "$(git -C "$SPACE/worktrees/d1" rev-parse HEAD)"
assert_eq "...no gate, no merge" "$s0" "$(gate_state)"
assert_eq "...the lock is released" "no" "$(exists_word "$SPACE/.hyper/ship-land.lock")"

# a failing gate: its tail is shown, nothing is pushed
mk_unit_git g1 606
raw_cfg 'mux: fake
gate: "echo failing gate; exit 1"
'
remote_before="$(git -C "$REMOTE" rev-parse g1)"; s0="$(gate_state)"
advance_main gate-fail
assert_eq "a failing gate exits 1" "1" "$(wl g1)"
assert_contains "...and shows its tail" "$(errof)" "failing gate"
assert_contains "...and says nothing was pushed" "$(errof)" "gate failed (full output: $SPACE/notes/loops/g1/land-gate.log); nothing was pushed"
assert_eq "...the remote branch is unchanged" "$remote_before" "$(git -C "$REMOTE" rev-parse g1)"
assert_eq "...no merge" "$(merges)" "$(echo "$s0" | cut -d/ -f2)"
assert_eq "...the worktree stays and the lock is released" "yes no" "$(exists_word "$SPACE/worktrees/g1") $(exists_word "$SPACE/.hyper/ship-land.lock")"
write_cfg

# no gate configured: landing fails (1) naming the key, before anything is pushed
mk_unit_git ng1 617
raw_cfg 'mux: fake
'
remote_before="$(git -C "$REMOTE" rev-parse ng1)"; s0="$(gate_state)"
assert_eq "no gate configured: landing fails (1)" "1" "$(wl ng1)"
assert_contains "...naming the key" "$(errof)" "required key 'gate' is not set"
assert_eq "...nothing pushed or merged" "$remote_before $s0" "$(git -C "$REMOTE" rev-parse ng1) $(gate_state)"
# --abandon needs no gate, never merges, gates or pushes; without --force it keeps the branch, with it deletes it
mk_unit_git ab1 618 PARKED
printf '{"backend":"fake","created":[{"kind":"agent","id":"agent-1","harness":"claude"}]}' >"$SPACE/notes/loops/ab1/mux.json"
: >"$MUXLOG"; remote_before="$(git -C "$REMOTE" rev-parse ab1)"; s0="$(gate_state)"
assert_eq "--abandon exits 0 on a non-READY unit, without a gate configured" "0" "$(wl ab1 --abandon)"
assert_eq "...no merge, no gate, no push" "$s0 $remote_before" "$(gate_state) $(git -C "$REMOTE" rev-parse ab1)"
assert_eq "...the recorded agent was retired" "yes" "$(exists_word "$MUXLOG")"
assert_eq "...the worktree is gone and the branch kept (wt without -D)" "no yes" "$(exists_word "$SPACE/worktrees/ab1") $(branch_exists ab1)"
assert_contains "...wt without -D" "$(tail -n 1 "$WT_LOG")" "remove ab1"
assert_eq "...the loop dir moved to .done" "yes" "$(exists_word "$SPACE/notes/loops/.done/ab1")"
mk_unit_git ab2 619 PARKED
assert_eq "--abandon --force exits 0" "0" "$(wl ab2 --abandon --force)"
assert_contains "...and deletes the branch (wt remove -D)" "$(tail -n 1 "$WT_LOG")" "remove -D ab2"
assert_eq "...the branch is gone" "no" "$(branch_exists ab2)"
# on_land is validated before anything is merged (the local land; the --host land is below)
raw_cfg 'mux: fake
gate: "true"
on_land: "not-a-list"
'
mk_unit_git lo1 621
m0="$(merges)"
assert_eq "a local land with an invalid on_land: 1" "1" "$(wl lo1)"
assert_contains "...says so" "$(errof)" "on_land must be a list of commands"
assert_eq "...before any merge" "$m0" "$(merges)"
write_cfg

# the merge call fails; gh errors after a good merge
mk_unit_git m1 607
advance_main merge-fail
assert_eq "a failed merge exits 1" "1" "$(GH_MERGE_FAIL=1 wl m1)"
assert_contains "...naming the PR and the branch that is pushed" "$(errof)" "gh pr merge 607 failed; m1 is pushed"
assert_eq "...the worktree stays" "yes" "$(exists_word "$SPACE/worktrees/m1")"
mk_unit_git m2 608
assert_eq "gh erroring after a good merge: the land succeeds" "0" "$(GH_MERGE_FAIL_AFTER=1 wl m2)"
assert_contains "...with a warning" "$(errof)" "gh reported an error after merging #608; the PR is merged"
assert_eq "...the remote branch was deleted with git" "" "$(git -C "$REMOTE" for-each-ref refs/heads/m2)"
assert_eq "...the unit was torn down" "no" "$(exists_word "$SPACE/worktrees/m2")"

# the PR number: result.json, else gh pr view (which also finds a merged PR)
mk_unit_git n1 609; jq '.pr = null' "$SPACE/notes/loops/n1/result.json" >"$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/n1/result.json"
assert_eq "a null pr in result.json is looked up with gh" "0" "$(GH_PR=808 wl n1)"
assert_contains "...and that number is merged" "$(grep 'pr merge' "$GH_LOG" | tail -n 1)" "pr merge 808"
mk_unit_git n2 610; jq '.pr = null' "$SPACE/notes/loops/n2/result.json" >"$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/n2/result.json"
git -C "$REMOTE" update-ref refs/heads/main "$(git -C "$REMOTE" rev-parse refs/heads/n2)"
m0="$(merges)"
assert_eq "a null pr whose PR is already merged is looked up and finished" "0" "$(GH_PR=909 wl n2)"
assert_eq "...without merging again" "$m0" "$(merges)"
mk_unit_git n3 611; jq '.pr = null' "$SPACE/notes/loops/n3/result.json" >"$FIX/r.json" && mv "$FIX/r.json" "$SPACE/notes/loops/n3/result.json"
assert_eq "a null pr with no PR for the branch: exit 1" "1" "$(wl n3)"
assert_contains "...says there is no PR (not 'no open PR')" "$(errof)" "no PR for branch n3"

# the merge-queue query fails: the land goes on, with a warning carrying gh's exit code and text
mk_unit_git q4 504
assert_eq "merge-queue query failing: the land goes on (0)" "0" "$(GH_GQL_FAIL=1 wl q4)"
assert_contains "...warns that the check was skipped, with gh's exit code and error" "$(errof)" "merge-queue check skipped for #504: gh api graphql failed (exit 1): gh: HTTP 502 (stub graphql)"

# the lease: a commit pushed to the PR branch from elsewhere is never overwritten
mk_unit_git l1 612
git clone -q "$REMOTE" "$FIX/elsewhere" 2>/dev/null
git -C "$FIX/elsewhere" checkout -q l1
echo late >"$FIX/elsewhere/late.txt"; git -C "$FIX/elsewhere" add late.txt
git -C "$FIX/elsewhere" commit -q -m "fix: late commit on the PR branch"; git -C "$FIX/elsewhere" push -q origin l1
m0="$(merges)"
assert_eq "a late commit on the remote PR branch refuses the push (1)" "1" "$(wl l1)"
assert_contains "...saying so" "$(errof)" "push of l1 failed"
assert_eq "...the late commit is still the remote head" "fix: late commit on the PR branch" "$(git -C "$REMOTE" log -1 --format=%s l1)"
assert_eq "...nothing was merged, the lock is released" "$m0 no" "$(merges) $(exists_word "$SPACE/.hyper/ship-land.lock")"

# a malformed record is reported before the merge, never a bare jq exit code
mk_unit_git c1 614; printf '{"backend":"fake","created":[' >"$SPACE/notes/loops/c1/mux.json"
m0="$(merges)"
assert_eq "land with a truncated mux.json is refused before the merge (1)" "1" "$(wl c1)"
assert_contains "...naming the file" "$(errof)" "mux.json is not a valid mux record"
assert_eq "...no merge" "$m0" "$(merges)"
mk_unit_git c2 615 PARKED; printf '{"backend":"fake","created":[' >"$SPACE/notes/loops/c2/mux.json"
assert_eq "abandon with a truncated mux.json: exit 1" "1" "$(wl c2 --abandon)"
assert_contains "...with a message naming the file" "$(errof)" "mux.json is not a valid mux record"
assert_eq "...nothing was removed" "yes yes" "$(exists_word "$SPACE/worktrees/c2") $(exists_word "$SPACE/notes/loops/c2")"

# --phase finish is internal and refuses a PR that is not merged
mk_unit_git f1 616
assert_eq "--phase finish on an unmerged PR is refused (3)" "3" "$(SHIP_UNIT_INTERNAL=1 wl f1 --phase finish)"
assert_contains "...the teardown only follows a merge" "$(errof)" "#616 is not merged (state OPEN); the teardown only follows a merge"
assert_eq "...the worktree stays" "yes" "$(exists_word "$SPACE/worktrees/f1")"

# abandon of a unit that is not there
assert_eq "--abandon on an unknown ref is an error (1)" "1" "$(wl nonesuch --abandon)"
assert_contains "...saying there is nothing to abandon" "$(errof)" "nothing to abandon: no notes/loops/nonesuch and no worktree $SPACE/worktrees/nonesuch"

# the usage table: exit 2 and the message, each before any work
usage_row() { # <message needle> <args...>
  local needle="$1" rc
  shift
  rc="$(env -u SHIP_UNIT_INTERNAL bash "$LAND" "$@" 2>"$FIX/u.err" >/dev/null; echo $?)"
  assert_eq "usage: ship-land $*: exit 2" "2" "$rc"
  assert_contains "...$needle" "$(cat "$FIX/u.err")" "$needle"
}
usage_row "a ref is required"
usage_row "unknown option --bogus" u1 --bogus
usage_row "invalid ref '../x'" '../x'
usage_row "one ref at a time" u1 u2
usage_row "invalid --task 'a b'" u1 --task 'a b'
usage_row "--task needs a value" u1 --task
usage_row "--host needs a value" u1 --host
usage_row "invalid --host '../x'" u1 --host ../x
usage_row "--task has no use with --abandon" u1 --abandon --task T
usage_row "--phase is internal" u1 --phase merge
assert_eq "usage: --phase with a bad value: exit 2" "2" "$(SHIP_UNIT_INTERNAL=1 bash "$LAND" u1 --phase bogus 2>"$FIX/u.err" >/dev/null; echo $?)"
assert_contains "...--phase needs merge or finish" "$(cat "$FIX/u.err")" "--phase needs merge or finish"

# the task saved at the first land is reused by a rerun; another --task is refused
write_cfg 'on_land: ["exit 7"]
'
mk_unit_git t1 620
advance_main task-one
assert_eq "local land (task T-6) with a failing on_land: 1" "1" "$(wl t1 --task T-6)"
assert_contains "...the rerun hint carries the task" "$(errof)" "ship-land t1 --task T-6"
assert_eq "...the task is saved in the loop dir" "T-6" "$(cat "$SPACE/notes/loops/t1/land.task")"
assert_eq "a rerun with another --task: 2" "2" "$(wl t1 --task X)"
assert_contains "...naming the saved one" "$(errof)" "differs from the task saved at the first land of t1 (T-6)"
assert_eq "a rerun without --task fails the same command again (1)" "1" "$(wl t1)"
assert_contains "...with the saved task in the rerun hint" "$(errof)" "ship-land t1 --task T-6"
write_cfg
wl t1 --abandon --force >/dev/null 2>&1

# ===== 3. --host before the host is reached, over a stub ssh and rsync ==================================
mkdir -p "$FIX/hstub"
cat > "$FIX/hstub/ssh" <<'STUB'
#!/bin/bash
echo "ssh $*" >> "$SSH_LOG"
[[ ! -e "$FIX/ssh.lost" || "$*" != *phase* ]] || exit 255
[[ ! -e "$FIX/ssh.mergerc" || "$*" != *phase*merge* ]] || exit "$(cat "$FIX/ssh.mergerc")"
exit 0
STUB
cat > "$FIX/hstub/rsync" <<'STUB'
#!/bin/bash
[[ "$1" != --version ]] || { echo "rsync  version 3.2.7  protocol version 31"; exit 0; }
exit 0
STUB
chmod +x "$FIX/hstub/ssh" "$FIX/hstub/rsync"
export FIX SSH_LOG="$FIX/hoststub.ssh.log"
OLDPATH="$PATH"; PATH="$FIX/hstub:$PATH"
hcfg() { write_cfg 'hosts:
  box:
    ssh: fakehost
on_land: '"$1"'
'; }
: >"$SSH_LOG"
hcfg '"not-a-list"'
mk_unit_git hl7 307
m0="$(merges)"
assert_eq "host land with an invalid on_land: 1" "1" "$(wl hl7 --host box)"
assert_contains "...says so" "$(errof)" "on_land must be a list of commands"
assert_eq "...before any merge" "$m0" "$(merges)"
assert_eq "...and before the host was asked to land" "0" "$(grep -c 'phase' "$SSH_LOG")"

: >"$FIX/ssh.lost"; hcfg '[]'
mk_unit_git hl10 310
assert_eq "host land with the connection lost: 1" "1" "$(wl hl10 --host box --task T-10)"
assert_contains "...the hint carries --host and --task" "$(errof)" "Rerun 'ship-land hl10 --host box --task T-10'"
assert_contains "...and says the landing may have finished" "$(errof)" "lost the connection to box (ssh exit 255); the landing may have finished or still be running there"
rm -f "$FIX/ssh.lost"

mk_unit_git hl3 303 PARKED
echo "303 1 echo x" >"$SPACE/notes/loops/hl3.on_land.done"; echo T-3 >"$SPACE/notes/loops/hl3.land.task"; echo 303 >"$SPACE/notes/loops/hl3.land.pr"
: >"$SSH_LOG"
assert_eq "abandon --host: 0" "0" "$(wl hl3 --abandon --host box)"
assert_eq "...removes the lead's on_land record, task and PR" "" "$(compgen -G "$SPACE/notes/loops/hl3.*" || true)"
assert_eq "...after asking the host to abandon it (no --phase)" "1 0" "$(grep -c -- '--abandon' "$SSH_LOG") $(grep -c 'phase' "$SSH_LOG")"

# the host's merge phase refuses (3): the lead exits with that code, runs no on_land, never asks for the teardown
: >"$SSH_LOG"; rm -f "$CNT"; echo 3 >"$FIX/ssh.mergerc"
hcfg '["echo ran >> '"$CNT"'"]'
mk_unit_git hm1 701
assert_eq "host land whose merge phase exits 3: the lead exits 3" "3" "$(wl hm1 --host box)"
assert_eq "...the host was asked for the merge phase once" "1" "$(grep -c 'phase.*merge' "$SSH_LOG")"
assert_eq "...never for the teardown" "0" "$(grep -c 'phase.*finish' "$SSH_LOG")"
assert_eq "...and on_land did not run" "no" "$(exists_word "$CNT")"
rm -f "$FIX/ssh.mergerc"

# on_land runs on the lead BEFORE the teardown phase: a failing on_land stops the host land before it
: >"$SSH_LOG"; rm -f "$CNT"
hcfg '["exit 7"]'
mk_unit_git hm2 702
echo 702 >"$SPACE/notes/loops/hm2/land.pr"   # what the host's merge phase leaves for the lead
assert_eq "host land with a failing on_land: 1" "1" "$(wl hm2 --host box --task T-2)"
assert_contains "...it names the command" "$(errof)" "on_land command failed: exit 7"
assert_contains "...and the rerun command, with --host and the task" "$(errof)" "rerun 'ship-land hm2 --host box --task T-2' to resume"
assert_eq "...the host was asked for the merge phase, not the teardown" "1 0" "$(grep -c 'phase.*merge' "$SSH_LOG") $(grep -c 'phase.*finish' "$SSH_LOG")"
assert_eq "...the lead saved the task and PR for the rerun" "T-2 702" "$(cat "$SPACE/notes/loops/hm2.land.task") $(cat "$SPACE/notes/loops/hm2.land.pr")"
PATH="$OLDPATH"
write_cfg

# the rerun hint on the host side (--phase) carries --host: the lead passes SHIP_HOST
mk_unit_git hm3 703
assert_eq "host merge phase while the PR stays OPEN after the merge call: 1" "1" "$(SHIP_UNIT_INTERNAL=1 SHIP_HOST=box GH_MERGE_QUEUE=1 wl hm3 --phase merge)"
assert_contains "...the rerun hint ends with --host <host> (the lead's SHIP_HOST)" "$(errof)" "rerun 'ship-land hm3 --task hm3 --host box' once it is merged"

# merge_method must be rebase, squash or merge
write_cfg 'merge_method: bogus
'
mk_unit_git mm1 704
remote_before="$(git -C "$REMOTE" rev-parse mm1)"; s0="$(gate_state)"
assert_eq "an unknown merge_method: exit 1" "1" "$(wl mm1)"
assert_contains "...naming the value" "$(errof)" "merge_method must be rebase, squash or merge (got 'bogus')"
assert_eq "...nothing pushed or merged" "$remote_before $s0" "$(git -C "$REMOTE" rev-parse mm1) $(gate_state)"
write_cfg

# ===== constraint: nothing in the scripts names the space ===========================================
# The pattern is built from pieces so this file does not contain the names itself.
names="$(printf '%s|%s|%s|%s' "hu""sk" "for""ge" "/wo""rk/" "/Us""ers/")"
assert_eq "no space-specific name or absolute path in the scripts" "0" \
  "$(grep -ciE "$names" "$LAND" "$RETIRE" | awk -F: '{s += $2} END {print s + 0}')"

finish
