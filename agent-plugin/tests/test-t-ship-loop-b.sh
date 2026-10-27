#!/usr/bin/env bash
# shellcheck disable=SC2034  # GATE_CMD, BUD_S, CFG_EXTRA... are read by write_cfg in lib/loop-journey.sh
# Row T (ship-loop), journeys 2 — the spec writer, finalize and the push gate, against mux/fake and the stub
# agent: spec-writer GAP (with a spec removal, and the final gate after it); every gap an operator call, then
# the writer asking the operator; finalize sending a rebase conflict and then a failing gate back to the dev
# until STUCK; a gate that restores a diff the final gate rejected (nothing pushed past the last reviewed
# head); the exit-trap/ERROR interplay; verdicts that are ERROR (CHANGES without findings, DONE without a PR).
# Also (67-73): the spec check or final gate that rejected a diff re-checks the dev's fix of it before the push; a GAP at the
# re-check goes to the spec writer, a repeat rejection ends STUCK, and a restarted driver still owes the re-check.
# The park/resume journeys are in test-t-ship-loop.sh, everything a function decides in test-t-ship-loop-fn.sh.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/loop-journey.sh"

# --- 7: spec writer: GAP + spec REMOVE -> writer -> ACCEPT, then the final gate asks for another round ------------
# Also: the writer's "what was settled" note reaches spec-r2 and is gone from spec-r3 (the ACCEPT clears it).
reset_fake; unit t7 spec
SPEC_GAP_RM="$(jq -c --argjson r "$(jq -c .removals <<<"$SPEC_RM_SPEC")" '.removals = $r' <<<"$SPEC_GAP")"
script t7 develop.json "$DEV_DONE"
for _r in 1 2 3; do script t7 review-r$_r.json "$REV_OK"; done
script t7 spec-r1.json "$SPEC_GAP_RM"; script t7 spec-r2.json "$SPEC_OK"; script t7 spec-r3.json "$SPEC_OK"
script t7 specwriter-r1.json "$SW_OK"
script t7 final-r2.json "$REV_CHANGES"; script t7 final-r3.json "$REV_OK"
script t7 fix-r2.json "$DEV_DONE"; script t7 fix-r3.json "$DEV_DONE"
stub_start t7; run_loop t7 --final-gate; stub_stop
check_result t7 "GAP -> spec writer" 0 READY
assert_eq "GAP: the spec writer ran once" "1" "$(res t7 .specwriter.runs)"
assert_eq "GAP: its commits are reported" "abc spec: settle it" "$(res t7 '.specwriter.commits[0]')"
assert_eq "GAP: the spec check ran three times and ended in ACCEPT" "ACCEPT 3" "$(res t7 '"\(.spec.verdict) \(.spec.rounds)"')"
assert_contains "GAP: the writer's prompt carries the question" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "What happens on EMPTY input?"
assert_contains "GAP: and the quoted spec text" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "the spec is silent"
assert_contains "GAP: and the rulings file" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "$SPACE/notes/decisions.md"
assert_contains "REMOVE spec: the writer is told what to delete" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "the frobnicate section"
assert_contains "REMOVE spec: with the missing consumer" "$(cat "$(st t7)/specwriter-r1.prompt.md")" "nothing consumes it"
assert_contains "GAP: the dev gets what the spec now says" "$(cat "$(st t7)/fix-r2.prompt.md")" "EMPTY input is rejected with exit 2"
assert_contains "GAP: the spec check is told what was settled" "$(cat "$(st t7)/spec-r2.prompt.md")" "EMPTY input is rejected with exit 2"
assert_contains "GAP: the spec check diffs the configured spec paths" "$(cat "$(st t7)/spec-r1.prompt.md")" "docs/spec/**"
assert_not_contains "spec_pending reset: after the ACCEPT, round 3 is not told it again" "$(cat "$(st t7)/spec-r3.prompt.md")" "EMPTY input is rejected with exit 2"
assert_eq "GAP: the final gate ran twice (the second round after its CHANGES)" "ACCEPT 2" "$(res t7 '"\(.final.verdict) \(.final.rounds)"')"
assert_eq "GAP: the writer was closed once it was WRITTEN" "t7-dev" "$(live_agents t7)"
assert_ok "GAP: the writer verdict validates" validate_verdict "$SCHEMAS_DIR/specwriter.json" "$(st t7)/specwriter-r1.json"

# --- 7b: every gap an operator call: park without a writer; the writer then asks the operator ---------------------------
reset_fake; unit t7o spec
script t7o develop.json "$DEV_DONE"; script t7o review-r1.json "$REV_OK"
script t7o spec-r1.json '{"verdict":"GAP","findings":[],"gaps":[{"where":"docs/spec/a.md:3","quotes":["silent"],"question":"A or B?","operator_call":true}],"removals":[],"commits":[],"gate":"green"}'
script t7o specwriter-r1.json '{"status":"OPERATOR","commits":[],"resolved":[],"operator_questions":[{"where":"docs/spec/a.md","question":"Pick A or B?","options":"A, B","recommendation":"A"}],"gate":""}'
stub_start t7o; run_loop t7o
check_result t7o "all gaps operator calls" 2 PARKED
assert_eq "operator: park status" "OPERATOR" "$(jq -r .status "$(st t7o)/park.json")"
assert_contains "operator: the gap is the question" "$(jq -r .question "$(st t7o)/park.json")" "A or B?"
assert_eq "operator: no writer was started" "0" "$(starts_of t7o-specwriter-r1)"
printf 'Pick B.\n' >"$(st t7o)/answer-1.md"
run_loop t7o; stub_stop
check_result t7o "the writer asks the operator" 2 PARKED
assert_eq "writer OPERATOR: park status" "OPERATOR" "$(jq -r .status "$(st t7o)/park.json")"
assert_eq "writer OPERATOR: the parked agent is the writer" "t7o-specwriter-r1" "$(jq -r .agent "$(st t7o)/park.json")"
assert_contains "writer OPERATOR: the question and recommendation are in park.json" "$(jq -r .question "$(st t7o)/park.json")" "Recommendation: A"
assert_contains "operator: the writer got the operator's answer" "$(cat "$(st t7o)/specwriter-r1.prompt.md")" "Pick B."
assert_eq "operator: the writer ran once" "1" "$(starts_of t7o-specwriter-r1)"

# --- 17: finalize: a rebase conflict, then a failing gate the dev cannot fix -> STUCK -----------------------------------
reset_fake; unit t17
W17="$SPACE/worktrees/t17"
echo "feature version" >"$W17/f.txt"; git -C "$W17" commit -qam "feat: touch f"; git -C "$W17" push -q origin feat-t17 2>/dev/null
git clone -q "$FIX/origin-t17.git" "$FIX/other-t17" 2>/dev/null
echo "main version" >"$FIX/other-t17/f.txt"; git -C "$FIX/other-t17" commit -qam "main: touch f"; git -C "$FIX/other-t17" push -q origin main 2>/dev/null
GATE_CMD='echo "gate says no"; exit 1'; write_cfg
script t17 develop.json "$DEV_DONE"; script t17 review-r1.json "$REV_OK"
script t17 fix-r2.json "$DEV_DONE"; script t17 review-r2.json "$REV_OK"; script t17 fix-r3.json "$DEV_DONE"
printf '#!/bin/sh\ngit -C "%s" rebase -X theirs origin/main >/dev/null 2>&1\ngit -C "%s" push -q --force-with-lease origin feat-t17 >/dev/null 2>&1\nexit 0\n' "$W17" "$W17" >"$FIX/scripts/t17/fix-r2.json.hook"
chmod +x "$FIX/scripts/t17/fix-r2.json.hook"
stub_start t17; run_loop t17; stub_stop
check_result t17 "rebase conflict, then a failing gate" 2 STUCK
assert_eq "gate: the stage" "finalize" "$(res t17 .stage)"
assert_contains "conflict: the dev is told the rebase failed" "$(cat "$(st t17)/fix-r2.prompt.md")" "rebasing onto origin/main failed"
assert_contains "conflict: the dev is told to run the tests its change affects" "$(cat "$(st t17)/fix-r2.prompt.md")" "finish the rebase, run the tests your change affects"
assert_not_contains "conflict: the dev is not told to run the gate" "$(cat "$(st t17)/fix-r2.prompt.md")" "run the gate"
assert_contains "conflict: and which file conflicts" "$(cat "$(st t17)/fix-r2.prompt.md")" "f.txt"
assert_eq "conflict: no rebase is left in progress" "no" "$(git -C "$W17" status | grep -q 'rebase in progress' && echo yes || echo no)"
assert_eq "conflict: the dev's resolution was reviewed (fresh reviewer, round 2)" "1" "$(starts_of t17-review-r2)"
assert_contains "gate: the dev saw the gate output" "$(cat "$(st t17)/fix-r3.prompt.md")" "gate says no"
assert_not_contains "gate: the fix prompt does not tell the dev to run the gate" "$(cat "$(st t17)/fix-r3.prompt.md")" "Commit, run the gate"
assert_contains "gate: the fix prompt tells the dev to run only the affected tests" "$(cat "$(st t17)/fix-r3.prompt.md")" "not the gate; the driver runs it"
assert_contains "gate: the finalize message lets the dev run the failing tests or the gate once" "$(cat "$(st t17)/fix-r3.prompt.md")" "run the failing tests it names, or the gate (\`echo \"gate says no\"; exit 1\`) itself once"
assert_not_contains "gate: the finalize message no longer says make the gate pass" "$(cat "$(st t17)/fix-r3.prompt.md")" "make the gate pass"
assert_contains "gate: the rule carves out a quoted gate failure" "$(cat "$(st t17)/fix-r3.prompt.md")" "when a finding quotes a gate failure"
assert_contains "gate: the fix prompt carries the rule to leave the gate to the driver" "$(cat "$(st t17)/fix-r3.prompt.md")" "Do not run it: the driver runs it itself"
assert_eq "gate: a fix that changed nothing needs no review" "0" "$(starts_of t17-review-r3)"
assert_eq "gate: the branch holds main, nothing was pushed past the dev's own commit" "0 $(git -C "$W17" rev-parse HEAD)" "$(git -C "$FIX/origin-t17.git" rev-list --count refs/heads/feat-t17..refs/heads/main) $(git -C "$FIX/origin-t17.git" rev-parse refs/heads/feat-t17)"
GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 64: a gate commit that restores a diff the final gate rejected ends STUCK, not a storm of reviewers ---------------
# Also the push gate: the final gate's CHANGES, the fix, a fresh agent per round, and nothing pushed past the last review.
reset_fake; unit t64
W64="$SPACE/worktrees/t64"; O64="$(git -C "$FIX/origin-t64.git" rev-parse refs/heads/feat-t64)"
export GATEFLAG64="$FIX/gateflag-t64"
GATE_CMD='if [ ! -e "$GATEFLAG64" ]; then touch "$GATEFLAG64"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t64 develop.json "$DEV_DONE"; script t64 review-r1.json "$REV_OK"; script t64 final-r1.json "$REV_CHANGES"
script t64 fix-r2.json "$DEV_DONE"; script t64 review-r2.json "$REV_OK"; script t64 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W64" "$W64" "$W64" >"$FIX/scripts/t64/fix-r2.json.hook"
chmod +x "$FIX/scripts/t64"/*.hook
for _r in 3 4 5 6 7 8; do script t64 fix-r$_r.json "$DEV_DONE"; script t64 review-r$_r.json "$REV_OK"; done
stub_start t64; run_loop t64 --final-gate; stub_stop
check_result t64 "gate restores a diff the final gate rejected" 2 STUCK
assert_eq "gate-restored rejected diff: nothing was pushed" "$O64" "$(git -C "$FIX/origin-t64.git" rev-parse refs/heads/feat-t64)"
assert_eq "final: a fresh final agent per round" "1 1" "$(starts_of t64-final-r1) $(starts_of t64-final-r2)"
assert_contains "final: the finding reaches the dev" "$(cat "$(st t64)/fix-r2.prompt.md")" "the bug"
assert_contains "gate-restored rejected diff: the dev is told the stage and gets its findings" "$(cat "$(st t64)/fix-r3.prompt.md")" "final-r1.json rejected"
assert_contains "gate-restored rejected diff: the dev prompt carries the findings text" "$(cat "$(st t64)/fix-r3.prompt.md")" "the bug"
assert_contains "gate-restored rejected diff: the prompt says it was not a fix" "$(cat "$(st t64)/fix-r3.prompt.md")" "not a fix of yours"
assert_eq "gate-restored rejected diff: the stage is the rejecting one" "final" "$(res t64 .stage)"
assert_eq "gate-restored rejected diff: rejected_by names the verdict" "final-r1.json" "$(res t64 .rejected_by)"
assert_contains "gate-restored rejected diff: the log says no dev fix made it" "$(cat "$(st t64)/loop.log")" "without a dev fix"
_rv=0; for _r in 3 4 5 6 7 8; do _rv=$((_rv + $(starts_of "t64-review-r$_r"))); done
assert_eq "gate-restored rejected diff: no reviewer storm (review rounds after the restore)" "0" "$_rv"
unset GATEFLAG64; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 50b: a diff_sig that fails after the review ACCEPT ends the run with its own ERROR (not the exit trap's) -------------
mkdir -p "$FIX/shim50"; REALGIT50="$(command -v git)"
printf '#!/bin/sh\nif [ -e "$FLAG50" ]; then for a in "$@"; do [ "$a" = "--verbatim" ] && { echo "error: patch-id broke" >&2; exit 129; }; done; fi\nexec "%s" "$@"\n' "$REALGIT50" >"$FIX/shim50/git"; chmod +x "$FIX/shim50/git"
reset_fake; unit t50b
script t50b develop.json "$DEV_DONE"; script t50b review-r1.json "$REV_OK"
printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$FIX/flag50-t50b" >"$FIX/scripts/t50b/review-r1.json.hook"; chmod +x "$FIX/scripts/t50b/review-r1.json.hook"
export FLAG50="$FIX/flag50-t50b"; _path="$PATH"; PATH="$FIX/shim50:$_path"
stub_start t50b; run_loop t50b; stub_stop
PATH="$_path"; unset FLAG50
assert_eq "diff_sig b: the run ends ERROR (exit 1)" "1" "$RC"
assert_eq "diff_sig b: result.json status" "ERROR" "$(res t50b .status)"
assert_contains "diff_sig b: result.json keeps the real reason" "$(res t50b .why)" "patch-id"
assert_contains "diff_sig b: driver.err keeps the real reason" "$(cat "$(st t50b)/driver.err")" "patch-id"
assert_not_contains "diff_sig b: the exit trap did not overwrite it" "$(cat "$(st t50b)/loop.log")" "driver exited unexpectedly"

# --- 67-73: the spec check or final gate that rejected a diff judges the dev's fix of it too (re-check) ---------------------------
SPEC_CHG='{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"docs/spec/a.md","line":1,"summary":"the spec is wrong","fix":"change it"}],"gaps":[],"removals":[],"commits":[],"gate":"green"}'

# --- 67: a gate-restore fix of a diff the spec check rejected is judged by the spec check before the push ----------------------
# The gate undoes the round-2 fix, so the diff is the one spec-r1 rejected; the dev fixes it again, the review is READY, and
# the spec check must see that new diff before finalize pushes.
reset_fake; unit t67 spec
W67="$SPACE/worktrees/t67"
export GATEFLAG67="$FIX/gateflag-t67"
GATE_CMD='if [ ! -e "$GATEFLAG67" ]; then touch "$GATEFLAG67"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t67 develop.json "$DEV_DONE"; script t67 review-r1.json "$REV_OK"; script t67 spec-r1.json "$SPEC_CHG"
script t67 fix-r2.json "$DEV_DONE"; script t67 review-r2.json "$REV_OK"; script t67 spec-r2.json "$SPEC_OK"
script t67 fix-r3.json "$DEV_DONE"; script t67 review-r3.json "$REV_OK"; script t67 spec-r3.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W67" "$W67" "$W67" >"$FIX/scripts/t67/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W67" "$W67" "$W67" >"$FIX/scripts/t67/fix-r3.json.hook"
chmod +x "$FIX/scripts/t67"/*.hook
stub_start t67; run_loop t67; stub_stop
check_result t67 "spec check re-checks a gate-restore fix" 0 READY
assert_eq "spec re-check: the spec check ran on the fixed diff" "1" "$(starts_of t67-spec-r3)"
assert_contains "spec re-check: it is told what it rejected" "$(cat "$(st t67)/spec-r3.prompt.md")" "the spec is wrong"
_log67="$(cat "$(st t67)/loop.log")"
assert_ok "spec re-check: after the READY review, before the push" bash -c '
  l="$1"; r=$(grep -n "round 3 review ACCEPT" <<<"$l" | head -1 | cut -d: -f1); s=$(grep -n "round 3 spec re-check" <<<"$l" | head -1 | cut -d: -f1)
  f=$(grep -n "finalized at" <<<"$l" | head -1 | cut -d: -f1); [ -n "$r" ] && [ -n "$s" ] && [ -n "$f" ] && [ "$r" -lt "$s" ] && [ "$s" -lt "$f" ]' _ "$_log67"
assert_eq "spec re-check: the spec check judged the pushed diff" "$(git -C "$W67" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1)" "$(cat "$(st t67)/spec-r3.sig")"
assert_eq "spec re-check: the push is the head" "$(git -C "$W67" rev-parse HEAD)" "$(git -C "$FIX/origin-t67.git" rev-parse refs/heads/feat-t67)"
unset GATEFLAG67; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 68: the same for the final gate -------------------------------------------------------------------------------------------
reset_fake; unit t68
W68="$SPACE/worktrees/t68"
export GATEFLAG68="$FIX/gateflag-t68"
GATE_CMD='if [ ! -e "$GATEFLAG68" ]; then touch "$GATEFLAG68"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t68 develop.json "$DEV_DONE"; script t68 review-r1.json "$REV_OK"; script t68 final-r1.json "$REV_CHANGES"
script t68 fix-r2.json "$DEV_DONE"; script t68 review-r2.json "$REV_OK"; script t68 final-r2.json "$REV_OK"
script t68 fix-r3.json "$DEV_DONE"; script t68 review-r3.json "$REV_OK"; script t68 final-r3.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W68" "$W68" "$W68" >"$FIX/scripts/t68/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W68" "$W68" "$W68" >"$FIX/scripts/t68/fix-r3.json.hook"
chmod +x "$FIX/scripts/t68"/*.hook
stub_start t68; run_loop t68 --final-gate; stub_stop
check_result t68 "final gate re-checks a gate-restore fix" 0 READY
assert_eq "final re-check: the final gate ran on the fixed diff" "1" "$(starts_of t68-final-r3)"
assert_contains "final re-check: it is told what it rejected" "$(cat "$(st t68)/final-r3.prompt.md")" "the bug"
assert_eq "final re-check: the final gate judged the pushed diff" "$(git -C "$W68" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1)" "$(cat "$(st t68)/final-r3.sig")"
assert_eq "final re-check: the push is the head" "$(git -C "$W68" rev-parse HEAD)" "$(git -C "$FIX/origin-t68.git" rev-parse refs/heads/feat-t68)"
unset GATEFLAG68; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 69: a repeat rejection by the re-run stage goes back to the dev and ends STUCK under the cycle cap ----------------------
reset_fake; unit t69 spec
W69="$SPACE/worktrees/t69"; O69="$(git -C "$FIX/origin-t69.git" rev-parse refs/heads/feat-t69)"
export GATEFLAG69="$FIX/gateflag-t69"
GATE_CMD='if [ ! -e "$GATEFLAG69" ]; then touch "$GATEFLAG69"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t69 develop.json "$DEV_DONE"; script t69 review-r1.json "$REV_OK"; script t69 spec-r1.json "$SPEC_CHG"
script t69 fix-r2.json "$DEV_DONE"; script t69 review-r2.json "$REV_OK"; script t69 spec-r2.json "$SPEC_OK"
for _r in 3 4; do
  script t69 fix-r$_r.json "$DEV_DONE"; script t69 review-r$_r.json "$REV_OK"; script t69 spec-r$_r.json "$SPEC_CHG"
  printf '#!/bin/sh\necho %s >"%s/again%s.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$_r" "$W69" "$_r" "$W69" "$W69" >"$FIX/scripts/t69/fix-r$_r.json.hook"
done
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W69" "$W69" "$W69" >"$FIX/scripts/t69/fix-r2.json.hook"
chmod +x "$FIX/scripts/t69"/*.hook
stub_start t69; run_loop t69; stub_stop
check_result t69 "the re-run stage rejects again" 2 STUCK
assert_eq "repeat rejection: nothing was pushed" "$O69" "$(git -C "$FIX/origin-t69.git" rev-parse refs/heads/feat-t69)"
assert_eq "repeat rejection: the stage is spec" "spec" "$(res t69 .stage)"
assert_eq "repeat rejection: rejected_by names the re-run verdict" "spec-r4.json" "$(res t69 .rejected_by)"
assert_eq "repeat rejection: the dev was sent back after the first re-check" "1" "$(starts_of t69-spec-r3)"
assert_contains "repeat rejection: the dev prompt carries the re-check's findings" "$(cat "$(st t69)/fix-r4.prompt.md")" "the spec is wrong"
unset GATEFLAG69; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 70: no spec or final re-run when only the code review rejected the fixed diff -------------------------------------------
reset_fake; unit t70 spec
W70="$SPACE/worktrees/t70"
export GATEFLAG70="$FIX/gateflag-t70"
GATE_CMD='if [ ! -e "$GATEFLAG70" ]; then touch "$GATEFLAG70"; echo g >gate-made.txt; git add -A; git commit -qm "gate made this"; fi'; write_cfg
script t70 develop.json "$DEV_DONE"; script t70 review-r1.json "$REV_OK"; script t70 spec-r1.json "$SPEC_OK"; script t70 final-r1.json "$REV_OK"
script t70 review-r2.json "$REV_CHANGES"; script t70 fix-r3.json "$DEV_DONE"; script t70 review-r3.json "$REV_OK"
printf '#!/bin/sh\necho more >"%s/more.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: more"\nexit 0\n' "$W70" "$W70" "$W70" >"$FIX/scripts/t70/fix-r3.json.hook"
chmod +x "$FIX/scripts/t70"/*.hook
stub_start t70; run_loop t70 --final-gate; stub_stop
check_result t70 "code review alone rejects in finalize" 0 READY
_n70=0; for _r in 2 3 4; do _n70=$((_n70 + $(starts_of "t70-spec-r$_r") + $(starts_of "t70-final-r$_r"))); done
assert_eq "code review only: no spec or final stage ran after the first accept" "0" "$_n70"
unset GATEFLAG70; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 71: a GAP from the spec re-check goes to the spec writer, not to the dev ---------------------------------------------------
reset_fake; unit t71 spec
W71="$SPACE/worktrees/t71"
export GATEFLAG71="$FIX/gateflag-t71"
GATE_CMD='if [ ! -e "$GATEFLAG71" ]; then touch "$GATEFLAG71"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t71 develop.json "$DEV_DONE"; script t71 review-r1.json "$REV_OK"; script t71 spec-r1.json "$SPEC_CHG"
script t71 fix-r2.json "$DEV_DONE"; script t71 review-r2.json "$REV_OK"; script t71 spec-r2.json "$SPEC_OK"
script t71 fix-r3.json "$DEV_DONE"; script t71 review-r3.json "$REV_OK"; script t71 spec-r3.json "$SPEC_GAP"
script t71 specwriter-r3.json "$SW_OK"; script t71 review-r4.json "$REV_OK"; script t71 spec-r4.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W71" "$W71" "$W71" >"$FIX/scripts/t71/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W71" "$W71" "$W71" >"$FIX/scripts/t71/fix-r3.json.hook"
printf '#!/bin/sh\necho settled >>"%s/docs/spec/a.md"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "spec: settle it"\nexit 0\n' "$W71" "$W71" "$W71" >"$FIX/scripts/t71/specwriter-r3.json.hook"
chmod +x "$FIX/scripts/t71"/*.hook
stub_start t71; run_loop t71; stub_stop
check_result t71 "spec re-check answers GAP" 0 READY
assert_eq "GAP re-check: the spec writer ran once" "1" "$(starts_of t71-specwriter-r3)"
assert_contains "GAP re-check: the writer's prompt carries the question" "$(cat "$(st t71)/specwriter-r3.prompt.md")" "What happens on EMPTY input?"
assert_ok "GAP re-check: no fix round was spent on the gap" test ! -e "$(st t71)/fix-r4.json.sent"
assert_eq "GAP re-check: the new diff was reviewed and re-checked" "1 1" "$(starts_of t71-review-r4) $(starts_of t71-spec-r4)"
assert_eq "GAP re-check: the spec check judged the pushed diff" "$(git -C "$W71" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1)" "$(cat "$(st t71)/spec-r4.sig")"
assert_eq "GAP re-check: the push is the head" "$(git -C "$W71" rev-parse HEAD)" "$(git -C "$FIX/origin-t71.git" rev-parse refs/heads/feat-t71)"
unset GATEFLAG71; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 71b: a spec re-check whose every gap is an operator call parks, and the answer reaches the spec writer, not the dev ------------
reset_fake; unit t71b spec
W71B="$SPACE/worktrees/t71b"
export GATEFLAG71B="$FIX/gateflag-t71b"
GATE_CMD='if [ ! -e "$GATEFLAG71B" ]; then touch "$GATEFLAG71B"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
SPEC_GAP_OP='{"verdict":"GAP","findings":[],"gaps":[{"where":"docs/spec/a.md:3","quotes":["the spec is silent"],"question":"Pick A or B?","operator_call":true}],"removals":[],"commits":[],"gate":"green"}'
script t71b develop.json "$DEV_DONE"; script t71b review-r1.json "$REV_OK"; script t71b spec-r1.json "$SPEC_CHG"
script t71b fix-r2.json "$DEV_DONE"; script t71b review-r2.json "$REV_OK"; script t71b spec-r2.json "$SPEC_OK"
script t71b fix-r3.json "$DEV_DONE"; script t71b review-r3.json "$REV_OK"; script t71b spec-r3.json "$SPEC_GAP_OP"
script t71b specwriter-r3.json "$SW_OK"; script t71b review-r4.json "$REV_OK"; script t71b spec-r4.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W71B" "$W71B" "$W71B" >"$FIX/scripts/t71b/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W71B" "$W71B" "$W71B" >"$FIX/scripts/t71b/fix-r3.json.hook"
printf '#!/bin/sh\necho settled >>"%s/docs/spec/a.md"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "spec: settle it"\nexit 0\n' "$W71B" "$W71B" "$W71B" >"$FIX/scripts/t71b/specwriter-r3.json.hook"
chmod +x "$FIX/scripts/t71b"/*.hook
stub_start t71b; run_loop t71b
check_result t71b "operator-call gap at the re-check parks" 2 PARKED
assert_eq "operator re-check: park status" "OPERATOR" "$(jq -r .status "$(st t71b)/park.json")"
assert_eq "operator re-check: no writer yet" "0" "$(starts_of t71b-specwriter-r3)"
printf 'Pick B.\n' >"$(st t71b)/answer-1.md"
run_loop t71b; stub_stop
check_result t71b "operator-call gap at the re-check, answered" 0 READY
assert_eq "operator re-check: the writer ran once" "1" "$(starts_of t71b-specwriter-r3)"
assert_contains "operator re-check: ...and got the operator's answer" "$(cat "$(st t71b)/specwriter-r3.prompt.md")" "Pick B."
assert_ok "operator re-check: no fix round was spent on the gap, before or after the park" test ! -e "$(st t71b)/fix-r4.json.sent"
assert_eq "operator re-check: the new diff was reviewed and re-checked" "1 1" "$(starts_of t71b-review-r4) $(starts_of t71b-spec-r4)"
assert_eq "operator re-check: the push is the head" "$(git -C "$W71B" rev-parse HEAD)" "$(git -C "$FIX/origin-t71b.git" rev-parse refs/heads/feat-t71b)"
unset GATEFLAG71B; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 72: a driver that dies before the re-check still owes it, and what it rejected, when it is restarted -------------------------------------------------
reset_fake; unit t72 spec
W72="$SPACE/worktrees/t72"
export GATEFLAG72="$FIX/gateflag-t72"
GATE_CMD='if [ ! -e "$GATEFLAG72" ]; then touch "$GATEFLAG72"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t72 develop.json "$DEV_DONE"; script t72 review-r1.json "$REV_OK"; script t72 spec-r1.json "$SPEC_CHG"
script t72 fix-r2.json "$DEV_DONE"; script t72 review-r2.json "$REV_OK"; script t72 spec-r2.json "$SPEC_OK"
script t72 fix-r3.json "$DEV_DONE"; script t72 spec-r3.json "$SPEC_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W72" "$W72" "$W72" >"$FIX/scripts/t72/fix-r2.json.hook"
printf '#!/bin/sh\necho again >"%s/again.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$W72" "$W72" "$W72" >"$FIX/scripts/t72/fix-r3.json.hook"
chmod +x "$FIX/scripts/t72"/*.hook
stub_start t72
bash "$LOOP" --ref t72 --worktree "$W72" --branch feat-t72 --brief "$BRIEF" --class S >/dev/null 2>"$FIX/err-t72.log" &
DRV=$!
for _ in $(seq 2400); do [[ -e "$(st t72)/review-r3.json.sent" ]] && break; sleep 0.05; done
assert_ok "re-check restart: the driver reached the post-fix review" test -e "$(st t72)/review-r3.json.sent"
kill -9 "$DRV" 2>/dev/null; wait "$DRV" 2>/dev/null
assert_ok "re-check restart: nothing was finalized yet" test ! -e "$(st t72)/finalize.json"
script t72 review-r3.json "$REV_OK"
run_loop t72; stub_stop
check_result t72 "restart at the spec re-check" 0 READY
assert_contains "re-check restart: the restarted driver took the spec check's verdict before the push" "$(cat "$(st t72)/loop.log")" "round 3 spec re-check of the fixed diff: ACCEPT"
assert_eq "re-check restart: the owed spec check ran once, after the restart" "1" "$(starts_of t72-spec-r3)"
assert_contains "re-check restart: it was told what the spec check rejected" "$(cat "$(st t72)/spec-r3.prompt.md")" "the spec is wrong"
assert_eq "re-check restart: the spec check judged the pushed diff" "$(git -C "$W72" diff -U0 --no-color origin/main...HEAD | git patch-id --verbatim | cut -d' ' -f1)" "$(cat "$(st t72)/spec-r3.sig")"
assert_eq "re-check restart: the push is the head" "$(git -C "$W72" rev-parse HEAD)" "$(git -C "$FIX/origin-t72.git" rev-parse refs/heads/feat-t72)"
unset GATEFLAG72; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 73: the final gate rejecting the fixed diff again ends STUCK under the cycle cap ----------------------------------------
reset_fake; unit t73
W73="$SPACE/worktrees/t73"; O73="$(git -C "$FIX/origin-t73.git" rev-parse refs/heads/feat-t73)"
export GATEFLAG73="$FIX/gateflag-t73"
GATE_CMD='if [ ! -e "$GATEFLAG73" ]; then touch "$GATEFLAG73"; git revert --no-edit HEAD >/dev/null 2>&1; fi'; write_cfg
script t73 develop.json "$DEV_DONE"; script t73 review-r1.json "$REV_OK"; script t73 final-r1.json "$REV_CHANGES"
script t73 fix-r2.json "$DEV_DONE"; script t73 review-r2.json "$REV_OK"; script t73 final-r2.json "$REV_OK"
printf '#!/bin/sh\necho extra >"%s/extra.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: extra"\nexit 0\n' "$W73" "$W73" "$W73" >"$FIX/scripts/t73/fix-r2.json.hook"
for _r in 3 4; do
  script t73 fix-r$_r.json "$DEV_DONE"; script t73 review-r$_r.json "$REV_OK"; script t73 final-r$_r.json "$REV_CHANGES"
  printf '#!/bin/sh\necho %s >"%s/again%s.txt"\ngit -C "%s" add -A\ngit -C "%s" commit -qm "fix: again"\nexit 0\n' "$_r" "$W73" "$_r" "$W73" "$W73" >"$FIX/scripts/t73/fix-r$_r.json.hook"
done
chmod +x "$FIX/scripts/t73"/*.hook
stub_start t73; run_loop t73 --final-gate; stub_stop
check_result t73 "the final gate rejects the fixed diff again" 2 STUCK
assert_eq "final repeat rejection: nothing was pushed" "$O73" "$(git -C "$FIX/origin-t73.git" rev-parse refs/heads/feat-t73)"
assert_eq "final repeat rejection: the stage is final" "final" "$(res t73 .stage)"
assert_eq "final repeat rejection: rejected_by names the re-run verdict" "final-r4.json" "$(res t73 .rejected_by)"
assert_contains "final repeat rejection: the dev prompt carries the re-check's findings" "$(cat "$(st t73)/fix-r4.prompt.md")" "the bug"
unset GATEFLAG73; GATE_CMD='echo gate-ran >> "$SHIP_TEST_GATELOG"'; write_cfg

# --- 11: verdicts the driver refuses (CHANGES with no findings, DONE without a PR) -----------------------------------------------------------------
# mutation 11c: drop the `[[ "$RV_N" -gt 0 ]] || die_error` after a review (4 sites: rounds, review_gate, spec, final); 11d: drop the `[[ -n "$PR" ]] || die_error` after develop
reset_fake; unit t11c
script t11c develop.json "$DEV_DONE"
script t11c review-r1.json '{"verdict":"CHANGES","findings":[]}'
stub_start t11c; RUN_LIMIT_S=20 run_loop t11c; stub_stop
check_result t11c "CHANGES without findings" 1 ERROR
assert_contains "CHANGES without findings: driver.err names the verdict" "$(cat "$(st t11c)/driver.err")" "review-r1.json is CHANGES with no findings"
reset_fake; unit t11d
script t11d develop.json '{"status":"DONE","pr":null,"head":null,"summary":"no PR"}'
stub_start t11d; RUN_LIMIT_S=20 run_loop t11d; stub_stop
check_result t11d "DONE without a PR" 1 ERROR
assert_contains "DONE without a PR: driver.err says the dev must open the PR" "$(cat "$(st t11d)/driver.err")" "names no pr"

reset_fake; unit t11s spec
script t11s develop.json "$DEV_DONE"; script t11s review-r1.json "$REV_OK"
script t11s spec-r1.json '{"verdict":"CHANGES","findings":[],"gaps":[],"removals":[],"commits":[],"gate":"green"}'
stub_start t11s; RUN_LIMIT_S=20 run_loop t11s; stub_stop
check_result t11s "spec CHANGES without findings" 1 ERROR
assert_contains "spec CHANGES without findings: driver.err names the verdict" "$(cat "$(st t11s)/driver.err")" "spec-r1.json is CHANGES with no findings"
reset_fake; unit t11f
script t11f develop.json "$DEV_DONE"; script t11f review-r1.json "$REV_OK"
script t11f final-r1.json '{"verdict":"CHANGES","findings":[]}'
stub_start t11f; RUN_LIMIT_S=20 run_loop t11f --final-gate; stub_stop
check_result t11f "final CHANGES without findings" 1 ERROR
assert_contains "final CHANGES without findings: driver.err names the verdict" "$(cat "$(st t11f)/driver.err")" "final-r1.json is CHANGES with no findings"
# the review after a finalize rebase conflict (review_gate, the PR changed after the last accept)
reset_fake; unit t11g
W11G="$SPACE/worktrees/t11g"
echo "feature version" >"$W11G/f.txt"; git -C "$W11G" commit -qam "feat: touch f"; git -C "$W11G" push -q origin feat-t11g 2>/dev/null
git clone -q "$FIX/origin-t11g.git" "$FIX/other-t11g" 2>/dev/null
echo "main version" >"$FIX/other-t11g/f.txt"; git -C "$FIX/other-t11g" commit -qam "main: touch f"; git -C "$FIX/other-t11g" push -q origin main 2>/dev/null
script t11g develop.json "$DEV_DONE"; script t11g review-r1.json "$REV_OK"; script t11g fix-r2.json "$DEV_DONE"
script t11g review-r2.json '{"verdict":"CHANGES","findings":[]}'
printf '#!/bin/sh\ngit -C "%s" rebase -X theirs origin/main >/dev/null 2>&1\ngit -C "%s" push -q --force-with-lease origin feat-t11g >/dev/null 2>&1\nexit 0\n' "$W11G" "$W11G" >"$FIX/scripts/t11g/fix-r2.json.hook"
chmod +x "$FIX/scripts/t11g/fix-r2.json.hook"
stub_start t11g; RUN_LIMIT_S=20 run_loop t11g; stub_stop
check_result t11g "post-rebase review CHANGES without findings" 1 ERROR
assert_contains "post-rebase review CHANGES without findings: driver.err names the verdict" "$(cat "$(st t11g)/driver.err")" "review-r2.json is CHANGES with no findings"

stub_stop
finish
