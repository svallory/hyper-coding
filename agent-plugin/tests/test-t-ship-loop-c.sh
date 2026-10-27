#!/usr/bin/env bash
# shellcheck disable=SC2034  # GATE_CMD, BUD_S, CFG_EXTRA... are read by write_cfg in lib/loop-journey.sh
# Row T (ship-loop), journeys 3 — the finalize re-check: the spec check or final gate that rejected a diff judges the
# dev's fix of it before the push; a GAP at the re-check goes to the spec writer, a repeat rejection ends STUCK, a
# restarted driver still owes the re-check, and a fresh run does not inherit one owed by an earlier run (67-74).
# The spec writer, finalize and push gate journeys are in test-t-ship-loop-b.sh, the park/resume journeys in
# test-t-ship-loop.sh, everything a function decides in test-t-ship-loop-fn.sh.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/loop-journey.sh"

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

# --- 74: a re-check owed by an earlier run is not owed by a fresh run (no develop.json: the old state is archived first) -------
# mutation: read recheck / recheck.prior before the previous run is archived (top of main) instead of just before `FR=$ACC_R`
reset_fake; unit t74
mkdir -p "$(st t74)"; printf 'final\n' >"$(st t74)/recheck"; printf 'an old rejection\n' >"$(st t74)/recheck.prior"
script t74 develop.json "$DEV_DONE"; script t74 review-r1.json "$REV_OK"
stub_start t74; RUN_LIMIT_S=30 run_loop t74; stub_stop
check_result t74 "a fresh run ignores the previous run's owed re-check" 0 READY
assert_eq "stale re-check: no final gate was started" "0" "$(starts_of t74-final-r1)"

stub_stop
finish
