#!/usr/bin/env bash
# shellcheck disable=SC2034  # GATE_CMD, BUD_S, CFG_EXTRA... are read by write_cfg in lib/loop-journey.sh
# Row T (ship-loop), journeys 2 — the spec writer, finalize and the push gate, against mux/fake and the stub
# agent: spec-writer GAP (with a spec removal, and the final gate after it); every gap an operator call, then
# the writer asking the operator; finalize sending a rebase conflict and then a failing gate back to the dev
# until STUCK; a gate that restores a diff the final gate rejected (nothing pushed past the last reviewed
# head); the exit-trap/ERROR interplay; verdicts that are ERROR (CHANGES without findings, DONE without a PR).
# The re-check journeys (67-74) are in test-t-ship-loop-c.sh; the park/resume journeys are in test-t-ship-loop.sh,
# everything a function decides in test-t-ship-loop-fn.sh.

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
