#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154  # the lifted driver functions read these globals; _n/_fail come from helpers.sh
# Row T (ship-loop), function level: the driver's own functions, one at a time, with no driver run, no
# multiplexer and no stub agent. They are taken from scripts/ship/ship-loop with `loop_fn` (the script is
# sourced; its main guard keeps the driver from running) and called against a scripted `mux`, a
# scratch state directory and one temp repo. (`finish` is the driver's here; the suite ends with
# finish_suite.) What needs a whole unit (the order of stages, the exit trap, the push) stays in test-t-ship-loop.sh, test-t-ship-loop-b.sh and test-t-ship-loop-c.sh.
#
# Every group names the break it catches in a "mutation" comment: the production line that, edited out
# or inverted, makes the group fail.

# shellcheck source=helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail
source "$TESTS_DIR/lib/loop-journey.sh"

SHIP_DIR="$SCRIPTS_DIR/ship"
PROMPTS="$SHIP_DIR/prompts"
SCHEMAS="$SHIP_DIR/schemas"
TRUSTFIX="$TESTS_DIR/fixtures/ship/trust"
ROLE_BIN="$SHIP_DIR/ship-role"
REAL_GIT="$(command -v git)"


# --- scripted collaborators --------------------------------------------------------------------------
# Every driver function reaches the world through log, mux, die_error, park and finish. They are replaced
# here; a stub that ends the driver (die_error, park, finish) must be called through sx (a subshell).
SN=0
newstate() { STATE="$(mktemp -d "$FIX/st.XXXXXX")"; mkdir -p "$STATE/agents"; LOG="$STATE/loop.log"; : >"$LOG"; }
log() { printf '%s\n' "$*" >>"$LOG"; }
die_error() { echo "DIE: $1"; exit 9; }
park() { echo "PARK $1|$2|$3|$4"; exit 9; }
finish() { echo "FINISH $1|$2|$3"; exit 9; }   # the driver's finish; the suite's own end is finish_suite
finish_suite() { echo "1..$_n"; rm -rf "$FIX"; [[ $_fail -eq 0 ]] && exit 0; exit 1; }
sx() { ( "$@" ) 2>&1; echo "rc=$?"; }
MUXLOG="$FIX/mux.log"
MUX_LIST='[]' MUX_STATE=idle MUX_SCREEN='' MUX_SEND_RCS='' MUX_WAIT_RC=0 MUX_CLOSE_RC=0 MUX_ON_SEND='' MUX_STATUS_RC=0
mux() {
  local verb="$1" rc
  printf '%s\n' "$*" >>"$MUXLOG"
  case "$verb" in
    list) printf '%s\n' "$MUX_LIST" ;;
    status) printf '{"state":"%s"}\n' "$MUX_STATE"; return "${MUX_STATUS_RC:-0}" ;;
    read) printf '%s\n' "$MUX_SCREEN" ;;
    start) N_START=$((N_START + 1)); printf '{"agent":"new-id"}\n' ;;
    wait) return "$MUX_WAIT_RC" ;;
    close) N_CLOSE=$((N_CLOSE + 1)); return "$MUX_CLOSE_RC" ;;
    send)
      case "$*" in *--keys*) N_KEYS=$((N_KEYS + 1)) ;; *) N_SENDS=$((N_SENDS + 1)) ;; esac
      [[ -z "$MUX_ON_SEND" ]] || eval "$MUX_ON_SEND"
      set -- $MUX_SEND_RCS; rc="${1:-0}"; [[ $# -eq 0 ]] || shift; MUX_SEND_RCS="$*"
      return "$rc" ;;
  esac
  return 0
}
N_SENDS=0 N_KEYS=0 N_CLOSE=0 N_START=0 # texts sent, key presses, closes, starts: counted without a subprocess
mux_reset() { : >"$MUXLOG"; MUX_LIST='[]' MUX_STATE=idle MUX_SCREEN='' MUX_SEND_RCS='' MUX_WAIT_RC=0 MUX_CLOSE_RC=0 MUX_ON_SEND='' MUX_STATUS_RC=0 N_SENDS=0 N_KEYS=0 N_CLOSE=0 N_START=0; }
agents_json() { jq -nc --arg n "$1" '[{kind:"agent",name:$n,id:"id-\($n)"}]'; } # name → mux list with that agent

REF=u6 BRANCH=feat-u6 BASE=main CLASS=S PR=7 BRIEF="$SPACE/notes/brief.md"
WT="$SPACE/worktrees/u6" SPACE_ID=sp1 POLL_S=0 SEND_WAIT_MS=1000 LIMIT_LINES=25 STAGE=develop CUR_ROUND=0
DEV=u6-dev KEEP_CLOCK="" TAKEOVER="" TAKEOVER_ANSWER="" RESTART_DEV="" FAIL_WHY="" SPEC_PATHS=()
SHIP_CONFIG_JSON='{}'
newstate

loop_fn offload_text rules_text model_pick aname write_json valid_json abs_in_space file_text render prompt skill_call check_verdict budget_min over_budget \
  fmt_findings fmt_failures fmt_gaps fmt_removals fmt_resolved fmt_opq jlen rmlen add_round add_dev_work takeover_text rejection_text

# --- small helpers -----------------------------------------------------------------------------------
# mutation: aname keeps ${REF:0:32-len} → ${REF:0:32}
REF="a-very-long-unit-reference-of-forty-chars"
assert_eq "aname: a long ref is cut so the whole suffix fits in 32 chars" "a-very-long-unit-refe-review-r12" "$(aname -review-r12)"
_nm="$(aname -review-r12)"; assert_eq "aname: the name is 32 chars" "32" "${#_nm}"
REF=u6
assert_eq "aname: a short ref is kept whole" "u6-dev" "$(aname -dev)"
write_json "$FIX/w.json" '{"a":1}'
assert_eq "write_json: writes the file with a newline and leaves no .tmp" "ok" "$([[ "$(cat "$FIX/w.json")" == '{"a":1}' && ! -e "$FIX/w.json.tmp" ]] && echo ok)"
printf '{"a":1}' >"$FIX/v.json"; printf 'nope' >"$FIX/v2.json"; : >"$FIX/v3.json"
assert_ok "valid_json: JSON" valid_json "$FIX/v.json"
assert_fails "valid_json: not JSON" valid_json "$FIX/v2.json"
assert_fails "valid_json: empty file" valid_json "$FIX/v3.json"
assert_fails "valid_json: missing file" valid_json "$FIX/none.json"
SPACE_ROOT=/sp
assert_eq "abs_in_space: an absolute path stays" "/x/y" "$(abs_in_space /x/y)"
assert_eq "abs_in_space: a relative path is under the space root" "/sp/notes/z" "$(abs_in_space notes/z)"
printf 'rule text\n' >"$FIX/rules.txt"
assert_eq "file_text: an unset path is empty" "" "$(file_text '')"
assert_eq "file_text: a missing file is empty and not an error" "0" "$(file_text "$FIX/none" >/dev/null; echo $?)"
assert_eq "file_text: an absolute path is read" "rule text" "$(file_text "$FIX/rules.txt")"
assert_contains "skill_call: a bare model uses the Skill tool" "$(skill_call code-review haiku)" 'Skill tool, skill "code-review"'
assert_contains "skill_call: a provider/model uses pi's slash command" "$(skill_call code-review prov/m)" "/skill:code-review"

# --- render and prompt -------------------------------------------------------------------------------
# mutation: render's pattern [a-z_]+ → [a-z]+ (test_skill, verdict_file, review_instructions keep their braces)
tpl_keys() { sed 1d "$PROMPTS/$1.md" | grep -o '{[a-z_]*}' | sort -u | tr -d '{}'; }
for t in develop rules; do
  kv=(); for k in $(tpl_keys "$t"); do kv+=("$k=<$k>"); done
  out="$(render "$t" "${kv[@]}")"
  assert_eq "render $t: every placeholder of the template is replaced" "" "$(grep -o '{[a-z_]*}' <<<"$out")"
  assert_not_contains "render $t: the placeholder comment on line 1 is not in the prompt" "$out" "placeholders:"
done
assert_eq "render: an unknown placeholder stays visible" "keep {zzz} here" "$(printf 'x\nkeep {zzz} here\n' >"$FIX/p.md"; PROMPTS="$FIX"; render p ref=1)"
PROMPTS="$FIX"; printf 'x\n{a} {b}\n' >"$FIX/q.md"
assert_eq "render: a value holding {b} is not substituted again" "{b} B" "$(render q a='{b}' b=B)"
assert_eq "render: & and backslash in a value are literal" 'a&b\n' "$(render q a='a&b\n' b= | sed 's/ $//')"
PROMPTS="$SHIP_DIR/prompts"
TEST_SKILL="$SHIP_PLUGIN_ROOT/skills/test-engineer/SKILL.md" GATE="make check" RULINGS="$SPACE/notes/decisions.md"
SPEC_PATHS_TXT="docs/spec/**" FORBIDDEN_TXT="(none configured)" FORBIDDEN_EXCLUDE_TXT=""
OFFLOAD="" RULES="$(rules_text)"
for t in develop review; do
  extra=(); std=" ref pr worktree branch base brief gate rulings spec_paths forbidden forbidden_exclude test_skill rules "
  for k in $(tpl_keys "$t"); do case "$std" in *" $k "*) ;; *) extra+=("$k=<$k>") ;; esac; done
  out="$(prompt "$t" "${extra[@]}")"
  assert_eq "prompt $t: no placeholder is left (the standard pairs cover the template)" "" "$(grep -o '{[a-z_]*}' <<<"$out")"
done
# mutation: in offload_text, drop "$OFFLOAD" / the command -v hint / "say so in your summary" from a variant;
# in rules_text (or the RULES line), stop passing offload=
OFFLOAD="RCI_HOST=forge rci"
r_on="$(rules_text)"
assert_contains "rules with offload set: the prefix wraps the command" "$r_on" "RCI_HOST=forge rci '<command>'"
assert_contains "rules with offload set: the check names the real command, past the VAR=value word" "$r_on" "command -v rci\` succeeds"
assert_not_contains "rules with offload set: the check is not on the VAR=value word" "$r_on" "command -v RCI_HOST"
assert_contains "rules with offload set: say so in your summary" "$r_on" "say so in your summary"
assert_not_contains "rules with offload set: the offload line does not mention the gate" "$(offload_text)" "gate"
OFFLOAD=""
r_off="$(rules_text)"
assert_eq "rules with offload unset: no placeholder is left" "" "$(grep -o '{offload}' <<<"$r_off")"
assert_contains "rules with offload unset: heavy commands run locally" "$r_off" "run locally"
assert_contains "rules with offload unset: say so in your summary" "$r_off" "say so in your summary"
assert_not_contains "rules with offload unset: no build-box wording" "$r_off" "command -v"
RULES="$r_off"
dev="$(prompt develop verdict_file=/v.json)"
# mutation: drop gate=$GATE / brief=$BRIEF / rules=$RULES from prompt
assert_contains "prompt develop: names the gate" "$dev" "make check"
assert_contains "prompt develop: names the brief" "$dev" "$BRIEF"
assert_contains "prompt develop: carries the rules block (test skill path)" "$dev" "$TEST_SKILL"
assert_contains "prompt develop: names the worktree and the branch" "$dev" "feat-u6"

# --- fmt_* and counters ------------------------------------------------------------------------------
# mutation: change the "[BLOCKING]" default, the ":line" part, "Fix:", "[operator call]", "Spec text:", "No consumer:" strings
cat >"$FIX/f.json" <<'J'
{"findings":[{"severity":"BLOCKING","file":"a.go","line":3,"summary":"the bug","fix":"change it"},{"file":"b.go","summary":"no line, no fix, no severity"}],
 "failures":[{"what":"it crashes","evidence":"exit 139"}],
 "gaps":[{"where":"docs/spec/a.md:3","quotes":["silent one","silent two"],"question":"What on EMPTY?","operator_call":false},{"where":"docs/spec/b.md:1","question":"Pick one","operator_call":true}],
 "removals":[{"where":"pkg/x.go:10","kind":"code","what":"the flag","why_no_consumer":"no caller"},{"where":"docs/spec/a.md:9","kind":"spec","what":"the section","why_no_consumer":"unused"}],
 "resolved":[{"where":"docs/spec/a.md#empty","question":"EMPTY input","says":"EMPTY is rejected"},{"says":"bare"}],
 "operator_questions":[{"where":"docs/spec/b.md:1","question":"Pick one","options":"A or B","recommendation":"A"},{"question":"bare"}]}
J
echo '{}' >"$FIX/e.json"
assert_eq "fmt_findings: severity, file:line, summary, fix; defaults for a bare finding" \
  $'1. [BLOCKING] a.go:3 — the bug\n   Fix: change it\n2. [BLOCKING] b.go — no line, no fix, no severity' "$(fmt_findings "$FIX/f.json")"
assert_eq "fmt_findings: nothing on a verdict without findings" "" "$(fmt_findings "$FIX/e.json")"
assert_eq "fmt_failures: what and evidence" $'1. it crashes\n   Evidence: exit 139' "$(fmt_failures "$FIX/f.json")"
assert_eq "fmt_gaps: quotes, and the [operator call] mark only on the operator's gap (mixed gaps)" \
  $'1. docs/spec/a.md:3 — What on EMPTY?\n   Spec text: silent one\n   Spec text: silent two\n2. docs/spec/b.md:1 [operator call] — Pick one' "$(fmt_gaps "$FIX/f.json")"
assert_eq "fmt_removals: code kind only" "1. pkg/x.go:10 — the flag. No consumer: no caller" "$(fmt_removals "$FIX/f.json" code)"
assert_eq "fmt_removals: spec kind only" "1. docs/spec/a.md:9 — the section. No consumer: unused" "$(fmt_removals "$FIX/f.json" spec)"
assert_eq "fmt_resolved: where, says, and the settled question when there is one" \
  $'1. docs/spec/a.md#empty: EMPTY is rejected\n   (settles: EMPTY input)\n2. ?: bare' "$(fmt_resolved "$FIX/f.json")"
assert_eq "fmt_opq: options and recommendation when given" $'1. docs/spec/b.md:1 — Pick one Options: A or B. Recommendation: A.\n2. ? — bare' "$(fmt_opq "$FIX/f.json")"
assert_eq "jlen: length of a list key" "2" "$(jlen "$FIX/f.json" findings)"
assert_eq "jlen: a missing key is 0" "0" "$(jlen "$FIX/e.json" findings)"
assert_eq "rmlen: removals of one kind" "1" "$(rmlen "$FIX/f.json" code)"
ROUNDS='[]'; add_round '{"round":1}'; add_round '{"round":2}'
assert_eq "add_round: appends in order" '[{"round":1},{"round":2}]' "$ROUNDS"
pending="P" pending_n=1
add_dev_work "$FIX/f.json" "the spec check"
assert_eq "add_dev_work: counts findings and code removals only (2 + 1)" "4" "$pending_n"
assert_contains "add_dev_work: lists the findings under who asked" "$pending" "the spec check also asks for these code changes:"
assert_contains "add_dev_work: names the code removal with its missing consumer" "$pending" "Remove it (and its tests) in this round:"$'\n'"1. pkg/x.go:10"
pending="P" pending_n=0; add_dev_work "$FIX/e.json" x
assert_eq "add_dev_work: nothing to add leaves pending alone" "P/0" "$pending/$pending_n"

# --- takeover_text and rejection_text ----------------------------------------------------------------
t="$(takeover_text)"
# mutation: takeover_text's "origin/%s..HEAD" or the git status hint
assert_contains "takeover_text: names the unit and the PR" "$t" "unit u6 (PR #7)"
assert_contains "takeover_text: opens by telling the agent it takes over" "$t" "You are taking over unit u6"
assert_contains "takeover_text: says the previous dev is gone and nothing was reset" "$t" "from a previous dev agent that is gone"
assert_contains "takeover_text: points at the brief, git status and the log against the base" "$t" "run \`git -C $WT status\`"
assert_contains "takeover_text: ...the log range is origin/<base>..HEAD" "$t" "git -C $WT log origin/main..HEAD"
PR="" ; assert_contains "takeover_text: no PR yet prints PR #?" "$(takeover_text)" "(PR #?)"; PR=7
cp "$FIX/f.json" "$FIX/spec-r1.json"; cp "$FIX/f.json" "$FIX/final-r1.json"
assert_eq "rejection_text: a final-gate verdict is only its findings" "$(fmt_findings "$FIX/f.json")" "$(rejection_text "$FIX/final-r1.json")"
assert_eq "rejection_text: a spec verdict adds gaps, code removals and spec removals (GAP/REMOVE carry no findings)" \
  "$(fmt_findings "$FIX/f.json"; fmt_gaps "$FIX/f.json"; fmt_removals "$FIX/f.json" code; fmt_removals "$FIX/f.json" spec)" "$(rejection_text "$FIX/spec-r1.json")"
echo '{"verdict":"REMOVE","removals":[{"where":"pkg/x.go:10","kind":"code","what":"the flag","why_no_consumer":"no caller"}]}' >"$FIX/spec-r2.json"
assert_contains "rejection_text: a spec REMOVE reaches the dev with the missing consumer" "$(rejection_text "$FIX/spec-r2.json")" "the flag. No consumer: no caller"

# --- check_verdict -----------------------------------------------------------------------------------
# mutation: check_verdict's `|| die_error` → `|| true`
cv() { # schema json — what check_verdict does with this file
  printf '%s\n' "$2" >"$FIX/cv.json"; sx check_verdict "$1" "$FIX/cv.json"
}
assert_eq "check_verdict: a valid develop result passes" "rc=0" "$(cv develop '{"status":"DONE","pr":7,"head":"abc1234","summary":"ok"}')"
assert_eq "check_verdict: a valid ACCEPT passes" "rc=0" "$(cv review '{"verdict":"ACCEPT","findings":[]}')"
for row in 'review|this is not json|malformed JSON' \
           'review|{"verdict":"MAYBE","findings":[]}|a verdict outside the enum' \
           'develop|{"status":"DONE","head":"abc1234","summary":"x"}|a develop result without a pr key (pr:null is an inline check in main, not the schema)'; do
  IFS='|' read -r sch js why <<<"$row"
  out="$(cv "$sch" "$js")"
  assert_contains "check_verdict: $why is an ERROR (die_error)" "$out" "DIE: cv.json is not a valid $sch result:"
  assert_contains "check_verdict: ...and ends the driver" "$out" "rc=9"
done

# --- budget_min --------------------------------------------------------------------------------------
# mutation: the fix formula (min / fix_fraction / fix_per_finding), the .extra addition, or `develop)` using budgets.check
bm() { # class fraction per_finding class_min check kind file [findings]
  CLASS="$1" SHIP_CONFIG_JSON="{\"budgets\":{\"S\":$4,\"M\":0.04,\"fix_fraction\":$2,\"fix_per_finding\":$3,\"check\":$5}}"
  budget_min "$6" "$7" ${8:+"$8"}
}
rm -f "$FIX/bm.json.extra"
assert_eq "budget_min develop: the class budget" "0.02" "$(bm S 0.5 0.001 0.02 5 develop "$FIX/bm.json")"
assert_eq "budget_min develop: class M reads its own budget" "0.04" "$(bm M 0.5 0.001 0.02 5 develop "$FIX/bm.json")"
assert_eq "budget_min check: budgets.check, whatever the class" "5" "$(bm S 0.5 0.001 0.02 5 check "$FIX/bm.json")"
# the fix rows of the old 64b/66F scenarios: class min, per-finding, findings → budget
for row in '0.02 0.001 1 0.011' '0.02 0.001 2 0.012' '0.02 0.001 3 0.013' '0.02 0.01 3 0.02' '0.02 0 2 0.01' \
           '0.2 0.025 2 0.15' '0.3 0.025 1 0.175'; do
  read -r cls per n want <<<"$row"
  assert_eq "budget_min fix: class $cls, $per per finding, F=$n → $want" "$want" "$(bm S 0.5 "$per" "$cls" 5 fix "$FIX/bm.json" "$n")"
done
assert_eq "budget_min fix: no finding count means F=1 (a problem that is only text)" "0.011" "$(bm S 0.5 0.001 0.02 5 fix "$FIX/bm.json")"
assert_eq "budget_min fix: capped at the class budget (0.01 + 0.03 > 0.02)" "0.02" "$(bm S 0.5 0.01 0.02 5 fix "$FIX/bm.json" 3)"
printf '0.025\n' >"$FIX/bm.json.extra"
assert_eq "budget_min fix: an extension (.extra) is added after the cap (0.15 + 0.075 + 0.025)" "0.25" "$(bm S 0.5 0.025 0.3 5 fix "$FIX/bm.json" 3)"
assert_eq "budget_min develop: .extra is added too" "0.045" "$(bm S 0.5 0.001 0.02 5 develop "$FIX/bm.json")"
assert_eq "budget_min check: .extra is added too" "5.025" "$(bm S 0.5 0.001 0.02 5 check "$FIX/bm.json")"
rm -f "$FIX/bm.json.extra"

# --- over_budget -------------------------------------------------------------------------------------
# mutation: the budget-r<k> numbering loop, elapsed_min rounding, the `finish 2 ... OVER-BUDGET` call
newstate; CLASS=S
out="$(sx over_budget develop u6-dev "$STATE/develop.json" 0.4 30)"
assert_contains "over_budget: ends the driver as PARKED-style exit 2 OVER-BUDGET at the stage" "$out" "FINISH 2|develop|OVER-BUDGET"
assert_eq "over_budget: budget-r1.json holds stage, agent, class, file, budget and elapsed minutes" \
  '{"verdict":"OVER-BUDGET","stage":"develop","agent":"u6-dev","class":"S","budget_min":0.4,"elapsed_min":0.5,"file":"develop.json"}' "$(jq -c . "$STATE/budget-r1.json")"
assert_ok "over_budget: the file matches the budget schema" validate_verdict "$SCHEMAS/budget.json" "$STATE/budget-r1.json"
sx over_budget fix u6-dev "$STATE/fix-r2.json" 1.5 100 >/dev/null
assert_eq "over_budget: a second overrun is budget-r2.json and r1 is kept" "fix develop" "$(jq -r .stage "$STATE/budget-r2.json") $(jq -r .stage "$STATE/budget-r1.json")"
assert_eq "over_budget: elapsed_min is rounded to 2 decimals" "1.67" "$(jq -r .elapsed_min "$STATE/budget-r2.json")"

# --- resume_budget -----------------------------------------------------------------------------------
loop_fn resume_budget
seed_budget() { # stage file — budget-r1.json as over_budget writes it
  newstate; jq -nc --arg s "$1" --arg f "$2" '{verdict:"OVER-BUDGET",stage:$s,agent:"u6-dev",class:"S",budget_min:0.4,elapsed_min:0.5,file:$f}' >"$STATE/budget-r1.json"
}
# mutation: drop the `finish 2 ... OVER-BUDGET` branch (a restart without --extend must stay over budget)
seed_budget develop develop.json
out="$(sx resume_budget)"
assert_contains "resume_budget: without an extend file the unit stays OVER-BUDGET at that stage" "$out" "FINISH 2|develop|OVER-BUDGET"
assert_eq "resume_budget: ...and the overrun is not marked handled" "no" "$([[ -e "$STATE/budget-r1.json.handled" ]] && echo yes || echo no)"
# mutation: the awk sum (a + b) → b; the mv to extend.applied; the touch .handled
printf '0.5\n' >"$STATE/extend"
out="$(sx resume_budget)"
assert_eq "resume_budget: an extension is recorded in <verdict>.extra" "0.5" "$(cat "$STATE/develop.json.extra")"
assert_eq "resume_budget: the extend file is consumed" "no/yes" "$([[ -e "$STATE/extend" ]] && echo yes || echo no)/$([[ -e "$STATE/extend.applied" ]] && echo yes || echo no)"
assert_eq "resume_budget: the overrun is marked handled, and the driver goes on" "yes/rc=0" "$([[ -e "$STATE/budget-r1.json.handled" ]] && echo yes)/$(grep rc= <<<"$out")"
out="$(sx resume_budget)"
assert_eq "resume_budget: a handled overrun does not park again" "rc=0" "$out"
seed_budget fix fix-r2.json; printf '0.025\n' >"$STATE/fix-r2.json.extra"; printf '0.025\n' >"$STATE/extend"
sx resume_budget >/dev/null
assert_eq "resume_budget: a second extension adds to the first (the budget grows, the clock is not reset)" "0.05" "$(cat "$STATE/fix-r2.json.extra")"
seed_budget develop develop.json; printf 'soon\n' >"$STATE/extend"
out="$(sx resume_budget)"
assert_contains "resume_budget: a non-number in extend is an ERROR" "$out" "DIE: extend file must hold a number of minutes (got 'soon')"

# --- mark_sent, mtime_s, sent_after_result, fresh_result -----------------------------------------------
loop_fn mtime_s mark_sent sent_after_result fresh_result
# mutation: mark_sent's `touch -r` line; sent_after_result `-gt 1` → `-gt 0` or `-gt 2`; fresh_result dropping the .sent test
M="$FIX/m"; mkdir -p "$M"
printf '{}\n' >"$M/a.json"; touch -t 202001010000 "$M/a.json"; rm -f "$M/a.json.sent"
mark_sent "$M/a.json"
assert_ok "mark_sent: the marker of an already written verdict is not newer than it" bash -c '[ "$1" -le 1 ]' _ "$(( $(mtime_s "$M/a.json.sent") - $(mtime_s "$M/a.json") ))"
assert_fails "mark_sent: so that verdict is not stale" sent_after_result "$M/a.json"
assert_ok "mark_sent: ...and it is fresh" fresh_result "$M/a.json"
: >"$M/b.json.sent"; mark_sent "$M/b.json"; mark_sent "$M/b.json"
assert_eq "mark_sent: a prompt without a verdict gets one marker line per prompt" "2" "$(wc -l <"$M/b.json.sent" | tr -d ' ')"
rm -f "$M/b.json.sent"; mark_sent "$M/b.json"
assert_eq "mark_sent: the first prompt creates the marker with one line" "1" "$(wc -l <"$M/b.json.sent" | tr -d ' ')"
stamp() { printf '{}\n' >"$M/c.json"; : >"$M/c.json.sent"; touch -t 202001010000.00 "$M/c.json"; touch -t "202001010000.0$1" "$M/c.json.sent"; } # marker seconds after the verdict
stamp 0; assert_ok "fresh_result: marker and verdict at the same second: fresh" fresh_result "$M/c.json"
stamp 1; assert_ok "fresh_result: a marker 1 s newer is still fresh (coarse file clocks)" fresh_result "$M/c.json"
assert_fails "sent_after_result: ...a 1 s gap is not 'after'" sent_after_result "$M/c.json"
stamp 2; assert_fails "fresh_result: a marker 2 s newer: the verdict is older than its prompt" fresh_result "$M/c.json"
assert_ok "sent_after_result: ...a 2 s gap is" sent_after_result "$M/c.json"
rm -f "$M/c.json.sent"; assert_fails "fresh_result: a verdict that was never prompted for is not fresh" fresh_result "$M/c.json"
assert_fails "sent_after_result: no marker, not after" sent_after_result "$M/c.json"
stamp 0; printf 'oops' >"$M/c.json"; touch -t 202001010000.00 "$M/c.json"
assert_fails "fresh_result: a verdict that is not JSON is never fresh" fresh_result "$M/c.json"
rm -f "$M/c.json"; : >"$M/c.json.sent"
assert_fails "fresh_result: a marker without a verdict is not fresh" fresh_result "$M/c.json"

# --- trust_state: the real captures, and the cases it must never answer -------------------------------
loop_fn trust_state
# mutation: any of the awk checks (n != 2, cur != 1, the blank-line checks, the footer whitelist, the numbered-line rule)
for f in medium narrow wide; do
  assert_eq "trust_state: $f capture, cursor on No" "other" "$(trust_state <"$TRUSTFIX/$f-before.txt")"
  assert_eq "trust_state: $f capture, cursor on Yes" "yes" "$(trust_state <"$TRUSTFIX/$f-after-down.txt")"
done
LAUNCH="env PATH=/usr/bin:/bin:/opt/tools/bin /home/user/.local/bin/launch-peer off claude --model haiku --permission-mode bypassPermissions --session-id 11111111-2222-4333-8444-555555555555"
assert_eq "trust_state: the echoed launch command and a rule above the header do not count" "other" "$(printf '%s\n\n%s\n' "$LAUNCH" "$(cat "$TRUSTFIX/wide-before.txt")" | trust_state)"
assert_eq "trust_state: no dialog at all" "none" "$(printf 'hello\n\n> prompt\n' | trust_state)"
assert_eq "trust_state: a trust dialog quoted with an indent is not the dialog" "none" "$(sed 's/^/      /' "$TRUSTFIX/narrow-before.txt" | trust_state)"
PERM2=$'\n ⏺ Bash command\n\n   rm -rf build\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No'
NB="$TRUSTFIX/narrow-before.txt"
assert_eq "trust_state: a trust dialog followed by a real permission prompt" "ambiguous" "$({ cat "$NB"; printf '%s\n' "$PERM2"; } | trust_state)"
assert_eq "trust_state: ...an unnumbered permission prompt too" "ambiguous" "$({ cat "$NB"; printf '\n Allow this tool?\n ❯ Allow once\n   Deny\n'; } | trust_state)"
assert_eq "trust_state: the dialog quoted twice (two headers, second with a prompt after it)" "ambiguous" "$({ cat "$NB"; printf '\n'; cat "$NB"; printf '\n Do you want to proceed?\n'; } | trust_state)"
assert_eq "trust_state: a third option (unnumbered)" "ambiguous" "$({ sed '/^   Yes, I trust this folder$/q' "$NB"; printf '   Maybe later\n'; sed '1,/^   Yes, I trust this folder$/d' "$NB"; } | trust_state)"
assert_eq "trust_state: a third option (numbered)" "ambiguous" "$({ sed '/Enter to confirm/d' "$NB"; printf '  3. Always\n\n Enter to confirm\n'; } | trust_state)"
assert_eq "trust_state: Allow... after the options" "ambiguous" "$({ cat "$NB"; printf '\n Allow all edits this session?\n'; } | trust_state)"
assert_eq "trust_state: a footer that only starts like the real one" "ambiguous" "$(sed 's/Enter to confirm.*/Enter to confirm and allow all commands/' "$NB" | trust_state)"
assert_eq "trust_state: the real footer, boxed" "other" "$(sed 's/^\( *\)\(Enter to confirm.*\)$/\1│ \2 │/' "$NB" | trust_state)"
assert_eq "trust_state: two cursors" "ambiguous" "$(sed 's/^   Yes, I trust this folder$/ ❯ Yes, I trust this folder/' "$NB" | trust_state)"
assert_eq "trust_state: no cursor" "ambiguous" "$(sed 's/^ ❯ No, exit$/   No, exit/' "$NB" | trust_state)"

# --- trust_dialog: scripted reads, no pane ---------------------------------------------------------------
loop_fn trust_dialog
# The pane is a queue of letters, one consumed per `mux read` (the last repeats): N the dialog with the cursor on
# No, Y on Yes, x a screen with no dialog, a an ambiguous dialog. Time is faked: every sleep adds a second.
NOPANE="$(cat "$TRUSTFIX/narrow-before.txt")" YESPANE="$(cat "$TRUSTFIX/narrow-after-down.txt")"
AMBPANE="$NOPANE"$'\n\n Allow this tool?'
TD_DIR="$FIX/td"; mkdir -p "$TD_DIR/agents" "$TD_DIR/markd/agents"; : >"$TD_DIR/markd/agents/a.trust"
td() { # queue [mark] — run trust_dialog; prints the keys sent and what it returned or parked
  local out
  rm -f "$TD_DIR/agents/a.trust"; STATE="$TD_DIR"; [[ -z "${2:-}" ]] || STATE="$TD_DIR/markd"
  LOG=/dev/null TRUST_WAIT_S=4 WT=/wt Q="$TD_DIR/q" KEYSV=""; printf '%s\n' "$1" >"$Q"
  out="$(
    sleep() { SECONDS=$((SECONDS + 1)); }
    park() { echo "PARK $1|$2|$3|$4 keys=[$KEYSV]"; exit 9; }
    mux() {
      case "$1" in
        read) local c rest; read -r c rest <"$Q"; [[ -z "$rest" ]] || printf '%s\n' "$rest" >"$Q"
              case "$c" in N) printf '%s\n' "$NOPANE" ;; Y) printf '%s\n' "$YESPANE" ;; a) printf '%s\n' "$AMBPANE" ;; *) echo "Welcome back" ;; esac ;;
        send) [[ "$4" != --keys ]] || KEYSV="$KEYSV$5," ;;
      esac
    }
    trust_dialog a a-id develop; rc=$?
    echo "rc=$rc keys=[$KEYSV]"
  )"
  printf '%s' "${out//$'\n'/ }"
}
# mutation: `downs -ge 2`, `gone -lt 2`, the mark test, the `none) return 1` / `ambiguous) return 1` arms
r="$(td 'N Y x x')"
assert_contains "trust_dialog: cursor on No: one down, then Enter, cleared after two blank reads" "$r" "rc=0 keys=[down,enter,]"
r="$(td 'Y x x')"
assert_contains "trust_dialog: cursor already on Yes: Enter only" "$r" "rc=0 keys=[enter,]"
r="$(td 'x')"
assert_contains "trust_dialog: no dialog on screen: returns 1 and sends nothing" "$r" "rc=1 keys=[]"
r="$(td 'a')"
assert_contains "trust_dialog: an ambiguous dialog: returns 1 and sends no key" "$r" "rc=1 keys=[]"
r="$(td 'N N N N')"
assert_contains "trust_dialog: a stuck cursor: at most two downs, no Enter, DIALOG" "$r" "PARK DIALOG|develop|a|a is showing Claude Code's workspace-trust dialog and the cursor never reached"
assert_contains "trust_dialog: ...keys sent were exactly down,down" "$r" "keys=[down,down,]"
r="$(td 'N x')"
assert_contains "trust_dialog: the dialog vanished after a down: DIALOG says so" "$r" "vanished after a down key"
assert_contains "trust_dialog: ...and Enter was never pressed" "$r" "keys=[down,]"
r="$(td 'N a')"
assert_contains "trust_dialog: the screen turned ambiguous after a down: DIALOG, no Enter" "$r" "changed to something ship cannot read safely"
r="$(td 'N Y x Y Y')"
assert_contains "trust_dialog: one blank read after Enter, then the dialog again: parked, not cleared" "$r" "after ship pressed Enter on it"
r="$(td 'N Y Y Y Y')"
assert_contains "trust_dialog: still showing after Enter: DIALOG" "$r" "PARK DIALOG|develop|a|"
r="$(td 'N' mark)"
assert_contains "trust_dialog: already answered once for this agent start: DIALOG 'again', nothing sent" "$r" "again after ship answered it once"
assert_contains "trust_dialog: ...no key at all" "$r" "keys=[]"

# --- diff_sig, write_sig on one temp repo --------------------------------------------------------------
loop_fn diff_sig write_sig
unit u6                       # the one repo: origin, a worktree on feat-u6 one commit ahead of main
newstate
g() { "$REAL_GIT" -C "$WT" "$@"; }
# mutation: diff_sig's `--verbatim`, the `[[ -z "$d" ]]` empty case, the die_error on a failed patch-id / diff
diff_sig; S1="$DSIG"
assert_eq "diff_sig: a signature is a patch-id (hex)" "yes" "$([[ "$S1" =~ ^[0-9a-f]{40}$ ]] && echo yes)"
diff_sig
assert_eq "diff_sig: the same diff has the same signature" "$S1" "$DSIG"
printf '  change\n' >"$WT/feat.txt"; g commit -qam "indent"; diff_sig; S2="$DSIG"
assert_eq "diff_sig: an indentation-only change is another diff (patch-id --verbatim)" "no" "$([[ "$S2" == "$S1" ]] && echo yes || echo no)"
g reset -q --hard HEAD~1
g checkout -q main; diff_sig; E="$DSIG"; g checkout -q feat-u6
assert_eq "diff_sig: no difference from the base is 'empty'" "empty" "$E"
SHIM="$FIX/oldgit"; mkdir -p "$SHIM"
printf '#!/bin/sh\ncase "$*" in *patch-id*) echo "usage: git patch-id" >&2; exit 129 ;; esac\nexec %s "$@"\n' "$REAL_GIT" >"$SHIM/git"; chmod +x "$SHIM/git"
out="$(PATH="$SHIM:$PATH" sx diff_sig)"
assert_contains "diff_sig: a git without patch-id --verbatim fails closed with an ERROR" "$out" "DIE: git patch-id --verbatim failed (git 2.39 or newer is required); see loop.log"
BASE=nope; out="$(sx diff_sig)"; BASE=main
assert_contains "diff_sig: a missing origin/<base> fails closed" "$out" "DIE: git diff origin/nope...HEAD failed; see loop.log"

# mutation: write_sig's freshness test (`! -e .sent` / sent_after_result), or its printf to ${1%.json}.sig
V="$STATE/review-r1.json"
write_sig "$V"
assert_eq "write_sig: a verdict not yet prompted gets the sig of the diff it is shown" "$S1" "$(cat "$STATE/review-r1.sig")"
printf '{"verdict":"ACCEPT","findings":[]}\n' >"$V"; : >"$V.sent"; touch -r "$V" "$V.sent"; printf 'OLD\n' >"$STATE/review-r1.sig"
write_sig "$V"
assert_eq "write_sig: a finished verdict that is replayed keeps the sig it was written with" "OLD" "$(cat "$STATE/review-r1.sig")"
touch -t 202001010000.03 "$V.sent"; touch -t 202001010000.00 "$V"
write_sig "$V"
assert_eq "write_sig: a verdict older than its newest prompt gets the current sig" "$S1" "$(cat "$STATE/review-r1.sig")"
BASE=nope; rm -f "$STATE/review-r2.json" "$STATE/review-r2.sig"; out="$(sx write_sig "$STATE/review-r2.json")"; BASE=main
assert_contains "write_sig: a diff_sig failure is an ERROR" "$out" "DIE: git diff origin/nope...HEAD failed"
assert_eq "write_sig: ...and no sig file (no JSON error text) was left behind" "no" "$([[ -e "$STATE/review-r2.sig" ]] && echo yes || echo no)"

# --- reviewed_diff and rejected_diff: the push invariant -----------------------------------------------
# The signature of "now" is CUR; diff_sig is a stub here, the real one was proved above.
loop_fn reviewed_diff rejected_diff
CUR="cur-sig"; diff_sig() { DSIG="$CUR"; }
vf() { # name verdict sig [nosent] — a verdict file of a stage with the signature it was shown
  printf '{"verdict":"%s","findings":[]}\n' "$2" >"$STATE/$1.json"; printf '%s\n' "$3" >"$STATE/$1.sig"
  if [[ -z "${4:-}" ]]; then : >"$STATE/$1.json.sent"; fi   # written right after the verdict: within the one-second slack
}
rv() { reviewed_diff && echo yes || echo no; }                 # note: reviewed_diff/rejected_diff set globals; no $( ) for REJECTED_BY
rj() { rejected_diff && echo yes || echo no; }
cl() { rm -f "$STATE"/*.json "$STATE"/*.sent "$STATE"/*.sig; }
# mutation: reviewed_diff's ACCEPT test, the sig comparison, `rejected_diff && return 1`, fresh_result
vf review-r1 ACCEPT "$CUR";                       assert_eq "reviewed_diff: an ACCEPT that was shown this diff" yes "$(rv)"
cl; vf review-r1 CHANGES "$CUR";                  assert_eq "reviewed_diff: CHANGES with a matching sig is not a READY review" no "$(rv)"
cl; vf review-r1 ACCEPT forged;                   assert_eq "reviewed_diff: a forged or foreign signature is not trusted" no "$(rv)"
cl; vf review-r1 ACCEPT old-sig;                  assert_eq "reviewed_diff: an ACCEPT of an older diff is stale (the diff changed after it)" no "$(rv)"
cl; vf review-r1 ACCEPT "$CUR" nosent;            assert_eq "reviewed_diff: a verdict never prompted for (no marker) does not count" no "$(rv)"
cl; vf final-r1 ACCEPT "$CUR";                    assert_eq "reviewed_diff: a final-gate ACCEPT of this diff counts" yes "$(rv)"
cl; vf review-r1 ACCEPT "$CUR"; vf spec-r1 CHANGES "$CUR"
assert_eq "reviewed_diff: a spec rejection of this exact diff beats the code review's ACCEPT" no "$(rv)"
vf spec-r1 ACCEPT "$CUR";                         assert_eq "reviewed_diff: ...an ACCEPT from the spec check does not" yes "$(rv)"
cl;                                               assert_eq "reviewed_diff: no review at all" no "$(rv)"
# mutation: rejected_diff's per-stage newest (-gt), the numeric guard, the `!= ACCEPT` test, the stage list (spec final)
assert_eq "rejected_diff: no spec or final verdicts: not rejected" no "$(rj)"
vf spec-r1 CHANGES "$CUR"; rejected_diff; by="$REJECTED_BY"
assert_eq "rejected_diff: a spec CHANGES on this diff rejects it, and names the file" "spec-r1.json" "$by"
vf spec-r2 ACCEPT "$CUR";                         assert_eq "rejected_diff: the newest verdict of the stage wins (r2 ACCEPT after r1 CHANGES)" no "$(rj)"
cl; vf spec-r2 CHANGES "$CUR"; vf spec-r10 ACCEPT "$CUR"
assert_eq "rejected_diff: rounds compare as numbers (r10 is newer than r2)" no "$(rj)"
cl; vf spec-r1 ACCEPT "$CUR"; vf final-r1 CHANGES "$CUR"; rejected_diff; by="$REJECTED_BY"
assert_eq "rejected_diff: the spec check's ACCEPT does not clear the final gate's rejection (decided per stage)" "final-r1.json" "$by"
cl; vf spec-r1 CHANGES other-sig;                 assert_eq "rejected_diff: a rejection of another diff does not count" no "$(rj)"
cl; vf spec-r1 CHANGES "$CUR" nosent;             assert_eq "rejected_diff: a verdict that is not fresh does not count" no "$(rj)"
cl; vf review-r1 CHANGES "$CUR";                  assert_eq "rejected_diff: the code review is not a stage here (it rejects nothing sticky)" no "$(rj)"

# --- forbidden_scan ------------------------------------------------------------------------------------
loop_fn forbidden_scan
sc() { SHIP_CONFIG_JSON="$1"; forbidden_scan; echo "rc=$?"; }
# mutation: the +/+++ line filter, the exclude glob test, `rc=1` on a bad regex, the `[[ "$pats" != "[]" ]]` early return
printf 'fine\nleaked SECRETWORD here\n' >"$WT/leak.txt"; mkdir -p "$WT/docs"; printf 'SECRETWORD in docs\n' >"$WT/docs/n.md"
g add -A; g commit -qm "add leak"
assert_eq "forbidden_scan: no patterns configured: nothing, rc 0" "rc=0" "$(sc '{}')"
assert_eq "forbidden_scan: each offending added line, with its file and the pattern; clean lines are not shown" \
  $'docs/n.md: SECRETWORD in docs (matches SECRETWORD)\nleak.txt: leaked SECRETWORD here (matches SECRETWORD)\nrc=0' "$(sc '{"scan":{"forbidden":["SECRETWORD"]}}')"
assert_eq "forbidden_scan: scan.exclude skips matching files" $'leak.txt: leaked SECRETWORD here (matches SECRETWORD)\nrc=0' "$(sc '{"scan":{"forbidden":["SECRETWORD"],"exclude":["docs/*"]}}')"
assert_contains "forbidden_scan: an invalid regex returns 1" "$(sc '{"scan":{"forbidden":["("]}}')" "rc=1"
assert_eq "forbidden_scan: diff headers are not added lines (a pattern matching the file name finds the content line only)" $'leak.txt: leaked SECRETWORD here (matches leak)\nrc=0' "$(sc '{"scan":{"forbidden":["leak"]}}')"
assert_eq "forbidden_scan: a pattern that matches nothing prints nothing" "rc=0" "$(sc '{"scan":{"forbidden":["NOPE"]}}')"
g reset -q --hard HEAD~1

# --- send_prompt -----------------------------------------------------------------------------------------
loop_fn agent_lookup agent_state send_prompt
sp() { # [name] — send_prompt with the scripted mux; prints rc and the counters
  send_prompt id1 "hello" "$@"; local rc=$?; echo "rc=$rc sends=$N_SENDS keys=$N_KEYS"
}
# mutation: the `rc -ne 4` exclusion, the retry loop `1 2 3`, the blocked branch, the `mux wait ... working`
newstate; mux_reset
assert_eq "send_prompt: a send that works is one send, no key" "rc=0 sends=1 keys=0" "$(sp)"
mux_reset; MUX_SEND_RCS="1"; r="$(sp)"
assert_eq "send_prompt: a failed send returns 1 (the caller parks BLOCKED)" "rc=1 sends=1 keys=0" "$r"
mux_reset; MUX_SEND_RCS="1"; sp >/dev/null
assert_contains "send_prompt: ...and says so in loop.log" "$(cat "$LOG")" "send to id1 failed (exit 1)"
mux_reset; MUX_SEND_RCS="4"
assert_eq "send_prompt: a turn that did not start gets Enter, and one working wait is enough" "rc=0 sends=1 keys=1" "$(sp)"
mux_reset; MUX_SEND_RCS="4"; MUX_WAIT_RC=1
assert_eq "send_prompt: a turn that never starts: three Enters, then 1" "rc=1 sends=1 keys=3" "$(sp)"
mux_reset; MUX_SEND_RCS="1"; MUX_STATE=idle
assert_eq "send_prompt: a failed send to an idle named agent is just a failure" "rc=1 sends=1 keys=0" "$(sp u6-dev)"
mux_reset; MUX_SEND_RCS="4"; MUX_STATE=blocked
assert_eq "send_prompt: a turn that did not start is not a blocked dialog, even for a named agent in a blocked pane" "rc=0 sends=1 keys=1" "$(sp u6-dev)"
mux_reset; MUX_STATUS_RC=5; MUX_STATE=working
agent_state id1; assert_eq "agent_state: ship-mux status exit 5 means gone" "gone" "$L_STATE"
mux_reset; MUX_STATUS_RC=3
assert_contains "agent_state: any other status failure is an ERROR" "$(sx agent_state id1)" "DIE: ship-mux status id1 failed (exit 3); see loop.log"
trust_dialog() { return 0; }
mux_reset; MUX_SEND_RCS="1 0"; MUX_STATE=blocked
assert_eq "send_prompt: blocked on the trust dialog: it is cleared and the same text is sent again" "rc=0 sends=2 keys=0" "$(sp u6-dev)"
trust_dialog() { return 1; }
mux_reset; MUX_SEND_RCS="1"; MUX_STATE=blocked; MUX_SCREEN="Do you want to proceed?"
out="$( ( sp u6-dev ) 2>&1 )"
assert_contains "send_prompt: blocked on any other dialog: parks DIALOG with the screen" "$out" "PARK DIALOG|develop|u6-dev|u6-dev is blocked on a dialog and cannot take the prompt."
assert_contains "send_prompt: ...the question carries what the pane shows" "$out" "Screen: Do you want to proceed?"
loop_fn trust_dialog   # the real one again

# --- await_file ------------------------------------------------------------------------------------------
loop_fn limit_hit agent_harness await_file step_failed
AW() { # budget_min — await_file for develop.json of u6-dev; prints rc and FAIL_WHY, or what ended the driver
  await_file u6-dev id1 "$STATE/develop.json" develop "$1"; echo "rc=$? why=$FAIL_WHY sends=$N_SENDS"
}
# mutation: the clock seed `acc="$(cat "$file.clock")"`, `el -gt lim`, the nudge cap `-ge 2`, the `gone`/`blocked` arms
newstate; over_budget() { echo "OVER $1 $2 $4 $5"; exit 9; }
printf '30\n' >"$STATE/develop.json.clock"; mux_reset; MUX_STATE=working
out="$( ( laps=0; sleep() { if ((++laps > 3)); then echo NO-OVER; exit 9; fi; }; AW 0.4 ) 2>&1 )"
assert_contains "await_file: a carried clock of 30 s is over a 0.4 min budget at once" "$out" "OVER develop u6-dev 0.4 3"
printf '1\n' >"$STATE/develop.json.clock"; mux_reset; MUX_STATE=gone
assert_eq "await_file: time before a park is not counted: a 1 s clock is within 0.4 min; the gone agent ends the wait" "rc=1 why=u6-dev is gone sends=0" "$(AW 0.4)"
assert_eq "await_file: the clock file is rewritten with the elapsed seconds (>= the carried 1)" "yes" "$([[ "$(cat "$STATE/develop.json.clock")" -ge 1 ]] && echo yes)"
rm -f "$STATE/develop.json.clock" "$STATE/develop.json"; mux_reset; MUX_STATE=working
sleep() { printf '{"status":"DONE"}\n' >"$STATE/develop.json"; }
assert_eq "await_file: a valid verdict that shows up while the agent works: 0" "rc=0 why= sends=0" "$(AW 5)"
assert_eq "await_file: the clock file is written on the first lap, from zero" "yes" "$([[ -s "$STATE/develop.json.clock" ]] && echo yes)"
rm -f "$STATE/develop.json"; mux_reset; MUX_STATE=idle; IDLE_GRACE_S=0; unset -f sleep
assert_eq "await_file: an idle agent is nudged twice (two sends), then the wait fails" "rc=1 why=u6-dev stopped without writing develop.json sends=2" "$(AW 5)"
IDLE_GRACE_S=3600
rm -f "$STATE/develop.json"; printf 'not json' >"$STATE/develop.json"; mux_reset; MUX_STATE=idle
assert_eq "await_file: an idle agent whose file is not JSON: rc 2" "rc=2 why=develop.json is not valid JSON sends=0" "$(AW 5)"
rm -f "$STATE/develop.json"; mux_reset; MUX_STATE=blocked; MUX_SCREEN="Allow it?"
assert_contains "await_file: a blocked agent without limit text parks DIALOG" "$( ( AW 5 ) 2>&1 )" "PARK DIALOG|develop|u6-dev|u6-dev is blocked on a dialog. Answer it in its pane"
unset -f over_budget; loop_fn over_budget
FAIL_WHY="x is not valid JSON"
assert_contains "step_failed: rc 2 (not JSON) is an ERROR" "$( ( step_failed develop u6-dev f 2 ) 2>&1 )" "DIE: x is not valid JSON"
assert_contains "step_failed: any other failure parks BLOCKED with the reason and the way out" "$( ( step_failed develop u6-dev f 1 ) 2>&1 )" "PARK BLOCKED|develop|u6-dev|x is not valid JSON. See loop.log; write answer-<n>.md"

# --- run_step ---------------------------------------------------------------------------------------------
loop_fn run_step stamp_failovers
RS() { # prints what run_step did: rc, sends, and the marker's line count
  run_step u6-dev "$STATE/develop.json" "TEXT" 5 develop; local rc=$?
  echo "rc=$rc sends=$N_SENDS marks=$(wc -l <"$STATE/develop.json.sent" 2>/dev/null | tr -d ' ')"
}
agent_writes() { MUX_ON_SEND="printf '{\"status\":\"DONE\",\"pr\":7}\\n' >'$STATE/develop.json'"; }
# mutation: the second fresh_result (after the lookup), the reattach condition, `rm -f $file $file.answer`, the .sent removal on a failed send
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; agent_writes
r="$(RS)"
assert_eq "run_step: a first prompt is sent once, and marked" "rc=0 sends=1 marks=1" "$r"
assert_eq "run_step: the prompt text is kept next to the verdict" "TEXT" "$(cat "$STATE/develop.prompt.md")"
assert_eq "run_step: the verdict is stamped with its failover count" "0" "$(jq -r .failovers "$STATE/develop.json")"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"
printf '#!/bin/sh\nprintf "{\\"status\\":\\"DONE\\"}\\n" >"$1"; : >"$1.sent"; touch -r "$1" "$1.sent"\n' >"$FIX/landed.sh"; chmod +x "$FIX/landed.sh"
SHIP_LOOP_AFTER_LOOKUP="$FIX/landed.sh"; r="$(RS)"; unset SHIP_LOOP_AFTER_LOOKUP
assert_eq "run_step: a verdict that lands between the lookup and the decision is picked up, not prompted over" "rc=0 sends=0 marks=0" "$r"
assert_contains "run_step: ...and the log says it was reused" "$(cat "$LOG")" "reusing develop.json"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; agent_writes
printf '{"status":"OLD"}\n' >"$STATE/develop.json"; : >"$STATE/develop.json.sent"; touch -t 202001010000.00 "$STATE/develop.json"
r="$(RS)"
assert_eq "run_step: a verdict older than its prompt is dropped and the agent is prompted again" "rc=0 sends=1 marks=1" "$r"
assert_contains "run_step: ...and the log says why" "$(cat "$LOG")" "develop.json is older than its prompt; prompting again"
assert_eq "run_step: ...the old verdict is gone, the new one is read" "DONE" "$(jq -r .status "$STATE/develop.json")"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; MUX_STATE=working
( sleep() { printf '{"status":"DONE"}\n' >"$STATE/develop.json"; }; : >"$STATE/develop.json.sent"; r="$(RS)"; echo "$r" >"$STATE/r" ) 
assert_eq "run_step: a marker without a verdict and a live agent: reattach, no new prompt" "rc=0 sends=0 marks=0" "$(<"$STATE/r")"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; MUX_STATE=gone; MUX_SEND_RCS="1"
: >"$STATE/develop.json.sent"; touch -t 202001010000.00 "$STATE/develop.json.sent"
out="$( ( RS ) 2>&1 )"
assert_contains "run_step: a prompt that cannot be sent parks BLOCKED" "$out" "PARK BLOCKED|develop|u6-dev|could not prompt u6-dev"
assert_eq "run_step: ...and the stale marker is removed, so a restart prompts again" "no" "$([[ -e "$STATE/develop.json.sent" ]] && echo yes || echo no)"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; MUX_SEND_RCS="1"
printf '{"status":"OLD"}\n' >"$STATE/develop.json"; : >"$STATE/develop.json.sent"; touch -t 202001010000.00 "$STATE/develop.json"; printf 'a\n' >"$STATE/develop.json.answer"
out="$( ( RS ) 2>&1 )"
assert_eq "run_step: a stale verdict and its kept answer are removed before the new prompt, even when it cannot be sent" "no/no" "$([[ -e "$STATE/develop.json" ]] && echo yes || echo no)/$([[ -e "$STATE/develop.json.answer" ]] && echo yes || echo no)"
newstate; mux_reset; MUX_LIST="$(agents_json u6-dev)"; MUX_STATE=idle
printf 'this is not json' >"$STATE/develop.json"; : >"$STATE/develop.json.sent"; touch -r "$STATE/develop.json" "$STATE/develop.json.sent"
out="$( ( RS; true ) 2>&1 )"
assert_contains "run_step: a bad verdict that is not older than its prompt is not prompted over: ERROR" "$out" "DIE: develop.json is not valid JSON"
mux_reset; MUX_LIST='[]'

assert_contains "run_step: no such agent is an ERROR" "$( ( RS ) 2>&1 )" "DIE: agent u6-dev is not running"

# --- fresh_step ---------------------------------------------------------------------------------------------
loop_fn fresh_step
# start_agent, run_step and close_agent are the collaborators here (they have their own groups)
FS_LOG=""
start_agent() { FS_LOG="$FS_LOG start:$1:$2:$3"; return "${START_RC:-0}"; }
run_step() { FS_LOG="$FS_LOG run:$1"; [[ -z "$RUN_WRITES" ]] || printf '%s\n' "$RUN_WRITES" >"$2"; }
close_agent() { FS_LOG="$FS_LOG close:$1"; }
FSJ='{"verdict":"ACCEPT","findings":[]}' RUN_WRITES="$FSJ" START_RC=0
fs() { FS_LOG=""; KEEP_CLOCK=""; fresh_step u6-review-r1 review review "$STATE/review-r1.json" T review 5 review "$@"; echo "rc=$? [${FS_LOG# }] keepclock=${KEEP_CLOCK##*/}"; }
# mutation: the first fresh_result test, the `keep` guards, `rm -f $file $file.sent`, the `-e .clock` KEEP_CLOCK, start_agent's `|| die_error`
newstate; mux_reset
printf '%s\n' "$FSJ" >"$STATE/review-r1.json"; : >"$STATE/review-r1.json.sent"; touch -r "$STATE/review-r1.json" "$STATE/review-r1.json.sent"
assert_eq "fresh_step: a finished stage is reused, its agent closed, nothing started" "rc=0 [close:u6-review-r1] keepclock=" "$(fs)"
assert_eq "fresh_step: ...with keep the agent stays" "rc=0 [] keepclock=" "$(fs keep)"
printf 'not json' >"$STATE/review-r1.json"; touch -r "$STATE/review-r1.json" "$STATE/review-r1.json.sent"; MUX_LIST="$(agents_json u6-review-r1)"; MUX_STATE=idle
assert_eq "fresh_step: a live agent for an unfinished stage is not restarted, only run" "rc=0 [run:u6-review-r1 close:u6-review-r1] keepclock=" "$(fs)"
MUX_LIST='[]'; printf 'old' >"$STATE/review-r1.json"
r="$(fs)"
assert_eq "fresh_step: no agent: one is started for this stage, its stale verdict and marker removed, then run" "rc=0 [start:u6-review-r1:review:review run:u6-review-r1 close:u6-review-r1] keepclock=" "$r"
newstate; : >"$STATE/review-r1.json.clock"; : >"$STATE/review-r1.json.sent"; MUX_LIST="$(agents_json u6-review-r1)"; MUX_STATE=gone
assert_eq "fresh_step: an agent that is gone is replaced, and the clock already used stays counted" "rc=0 [start:u6-review-r1:review:review run:u6-review-r1 close:u6-review-r1] keepclock=review-r1.json" "$(fs)"
assert_eq "fresh_step: ...the old marker was removed" "no" "$([[ -e "$STATE/review-r1.json.sent" ]] && echo yes || echo no)"
START_RC=1; MUX_LIST='[]'
assert_contains "fresh_step: an agent that cannot start is an ERROR" "$( ( fs ) 2>&1 )" "DIE: could not start u6-review-r1; see loop.log"
START_RC=0; RUN_WRITES='{"verdict":"MAYBE","findings":[]}'; MUX_LIST="$(agents_json u6-review-r1)"; MUX_STATE=idle
assert_contains "fresh_step: the verdict a stage leaves is checked against its schema" "$( ( fs ) 2>&1 )" "DIE: review-r1.json is not a valid review result"
RUN_WRITES="$FSJ"
loop_fn start_agent run_step close_agent

# --- start_agent ---------------------------------------------------------------------------------------------
# start_agent calls ship-role (the real one prints the harness's flags), mux start, and trust_dialog (claude only).
newstate; SPACE_ID=sp1
mkdir -p "$HOME"/.agents/skills/{code-review,arch-review}; touch "$HOME"/.agents/skills/{code-review,arch-review}/SKILL.md # the review role's pi skills
TD_CALLS=""; trust_dialog() { TD_CALLS="$TD_CALLS $1"; return 0; }
new_uuid() { echo "00000000-0000-4000-8000-000000000001"; }
mux_start_args() { grep -a '^start ' "$MUXLOG" | tail -n 1; }
SA() { mux_reset; MUX_LIST='[]'; TD_CALLS=""; start_agent "$@"; echo "rc=$? A_ID=$A_ID td=[${TD_CALLS# }]"; }
# mutation: the harness branches (claude --session-id/--permission-mode vs pi --approve/--session-dir), `rm -f .trust`, the old-agent close, the LIMIT park
out="$(SA u6-dev dev dev haiku)"   # (ship-role is the real one for the two argv checks, a stub elsewhere)
assert_eq "start_agent claude: the new agent id is kept and the trust dialog is looked at once" "rc=0 A_ID=new-id td=[u6-dev]" "$out"
a="$(mux_start_args)"
assert_contains "start_agent claude: mux start names space, name, harness and cwd" "$a" "start --space sp1 --name u6-dev --harness claude --cwd $WT --"
assert_contains "start_agent claude: model and bypass mode, session id" "$a" "--model haiku --permission-mode bypassPermissions"
assert_contains "start_agent claude: ...the session id is the one the driver made" "$a" "--session-id 00000000-0000-4000-8000-000000000001"
assert_contains "start_agent claude: MCP is limited to the role's own config (--strict-mcp-config from ship-role)" "$a" "--strict-mcp-config"
assert_not_contains "start_agent claude: no pi flags" "$a" "--approve"
assert_eq "start_agent claude: the agent file records role, model, harness and session" "dev haiku claude 00000000-0000-4000-8000-000000000001 new-id" "$(jq -r '"\(.role) \(.model) \(.harness) \(.session) \(.id)"' "$STATE/agents/u6-dev.json")"
out="$(SA u6-review-r1 review review prov/model:high)"
a="$(mux_start_args)"
assert_eq "start_agent pi: no trust dialog is looked at" "rc=0 A_ID=new-id td=[]" "$out"
assert_contains "start_agent pi: harness pi, model with thinking suffix, --approve" "$a" "--harness pi --cwd $WT -- --model prov/model:high --approve"
assert_contains "start_agent pi: one session directory per agent under pi-sessions" "$a" "--session-dir $STATE/pi-sessions/u6-review-r1-00000000-0000-4000-8000-000000000001"
assert_contains "start_agent pi: the role flags from ship-role reach the argv (MCP off)" "$a" "--no-mcp"
assert_eq "start_agent pi: the agent file records the pi harness" "pi" "$(jq -r .harness "$STATE/agents/u6-review-r1.json")"
assert_not_contains "start_agent pi: no claude flags" "$a" "--session-id"
assert_not_contains "start_agent pi: ...nor the permission mode" "$a" "--permission-mode"
assert_eq "start_agent pi: the session directory exists" "yes" "$([[ -d "$STATE/pi-sessions/u6-review-r1-00000000-0000-4000-8000-000000000001" ]] && echo yes)"
printf '#!/bin/sh\necho --role-flag\n' >"$FIX/role-stub"; chmod +x "$FIX/role-stub"; ROLE_BIN="$FIX/role-stub"
: >"$STATE/agents/u6-dev.trust"; mux_reset; MUX_LIST='[]'; start_agent u6-dev dev dev haiku >/dev/null
assert_eq "start_agent: a new start forgets that the trust dialog was answered for the old one" "no" "$([[ -e "$STATE/agents/u6-dev.trust" ]] && echo yes || echo no)"
mux_reset; MUX_LIST="$(agents_json u6-dev)"; start_agent u6-dev dev dev haiku >/dev/null
assert_eq "start_agent: a leftover agent of the same name is closed before the new one starts" "1" "$N_CLOSE"
mux_reset; MUX_LIST="$(agents_json u6-dev)"; MUX_CLOSE_RC=1; start_agent u6-dev dev dev haiku; rc=$?
assert_eq "start_agent: ...and when it cannot be closed, no second agent is started" "1/0" "$rc/$N_START"
assert_contains "start_agent: ...and the log says the old one could not be closed" "$(cat "$LOG")" "could not close the old u6-dev (id-u6-dev); not starting another"
mux_reset; MUX_LIST="$(agents_json u6-dev)"; start_agent u6-dev dev dev haiku; rc=$?
assert_eq "start_agent: ...nor when it is still listed after the close" "1/0" "$rc/$N_START"
pick_model() { PICK_MODEL="" PICK_RESETS_AT=""; return 2; }
mux_reset; MUX_LIST='[]'
assert_contains "start_agent: nothing usable in the model list parks LIMIT" "$( ( start_agent u6-dev dev dev ) 2>&1 )" "PARK LIMIT|develop|u6-dev|every model for dev is limited"
pick_model() { PICK_MODEL="picked"; return 0; }
mux_reset; MUX_LIST='[]'; start_agent u6-dev dev dev >/dev/null
assert_contains "start_agent: without a model, the first usable one of the list is used" "$(mux_start_args)" "--model picked"
unset -f pick_model new_uuid trust_dialog; source "$SHIP_DIR/lib.sh"; loop_fn trust_dialog new_uuid

# --- resume_park ----------------------------------------------------------------------------------------------
loop_fn resume_park resume_restart
SENT=""; send_prompt() { SENT="$SENT<$3|$2>"; return "${SEND_RC:-0}"; }   # id text name stage → recorded, nothing is sent
seed_park() { # status [n] [file] [agent] — park.json as park() writes it (a relative file is inside the new state dir)
  local f="${3:-}"
  newstate; mux_reset; case "$f" in ""|/*) ;; *) f="$STATE/$f" ;; esac
  jq -nc --arg st "$1" --argjson n "${2:-1}" --arg f "$f" --arg a "${4:-u6-dev}" \
    '{status:$st,stage:"develop",agent:$a,question:"Q?",since:"t",n:$n,file:$f}' >"$STATE/park.json"
  MUX_LIST="$(agents_json "${4:-u6-dev}")"; MUX_STATE=idle; SENT=""
}
RP() { SENT=""; resume_park; echo "rc=$? sent=${SENT:-none} tk=[${TAKEOVER_ANSWER//$'\n'/ }]"; }
parked() { [[ -e "$STATE/park.json" ]] && echo parked || echo resumed; }
# mutation: the `-s "$ans"` tests, the `park-$n` numbering (answer-$n.md), the OPERATOR branch, the TAKEOVER wording, the gone-agent branch
seed_park QUESTION 1 "$FIX/pk-develop.json"; DEV=u6-dev
out="$( sx RP )"
assert_contains "resume_park: a QUESTION with no answer stays PARKED (nothing sent)" "$out" "FINISH 2|develop|PARKED"
assert_eq "resume_park: ...and park.json is still there" "parked" "$(parked)"
printf 'OLD answer\n' >"$STATE/answer-1.md"; jq -c '.n = 2' "$STATE/park.json" >"$STATE/p.tmp" && mv "$STATE/p.tmp" "$STATE/park.json"
out="$( sx RP )"
assert_contains "resume_park: an answer to an older park (answer-1.md for park 2) is not delivered" "$out" "FINISH 2|develop|PARKED"
assert_not_contains "resume_park: ...and the old text is not sent to the agent" "$out" "OLD answer"
printf '{"status":"QUESTION"}\n' >"$FIX/pk-develop.json"; : >"$FIX/pk-develop.json.sent"; printf 'Use option B\n' >"$STATE/answer-2.md"
out="$(RP)"
assert_contains "resume_park: the answer is sent to the parked agent as 'Answer from the lead to your QUESTION'" "$out" "sent=<u6-dev|Answer from the lead to your QUESTION:"$'\n'"Use option B"
assert_eq "resume_park: ...the park is resolved (park-2.json, no park.json)" "resumed/yes" "$(parked)/$([[ -e "$STATE/park-2.json" ]] && echo yes)"
assert_eq "resume_park: ...the stale verdict was removed so the agent's next answer is fresh" "no" "$([[ -e "$FIX/pk-develop.json" ]] && echo yes || echo no)"
assert_contains "resume_park: ...and the answer is kept next to the verdict for a successor" "$(cat "$FIX/pk-develop.json.answer")" "Use option B"
assert_eq "resume_park: ...and the prompt is marked sent" "yes" "$([[ -e "$FIX/pk-develop.json.sent" ]] && echo yes)"
rm -f "$FIX/pk-develop.json.answer" "$FIX/pk-develop.json.sent"
seed_park QUESTION 1 "$FIX/pk-develop.json"; : >"$FIX/pk-develop.json.sent"; printf 'A\n' >"$STATE/answer-1.md"; SEND_RC=1
assert_contains "resume_park: an answer that cannot be delivered is an ERROR" "$( sx RP )" "DIE: could not deliver answer-1.md to u6-dev"
SEND_RC=0
seed_park OPERATOR 1 "$FIX/pk-sw.json" u6-spec; : >"$FIX/pk-sw.json.operator"
out="$( sx RP )"
assert_contains "resume_park: an OPERATOR park waits for the operator's answer" "$out" "FINISH 2|develop|PARKED"
assert_contains "resume_park: ...it logs which file it waits for" "$(cat "$LOG")" "still parked (OPERATOR): waiting for $STATE/answer-1.md"
seed_park OPERATOR 1 "$FIX/pk-sw.json" u6-spec; : >"$FIX/pk-sw.json.operator"; MUX_LIST='[]'
assert_contains "resume_park: an OPERATOR park whose agent is gone still waits for the operator (it is not restarted)" "$( sx RP )" "FINISH 2|develop|PARKED"
seed_park BLOCKED 1 "$FIX/pk-develop.json"; MUX_LIST='[]'
out="$(RP)"
assert_eq "resume_park: the parked agent is gone: the stage is restarted, nothing sent, park resolved" "rc=0 sent=none tk=[]/resumed" "$out/$(parked)"
# a replaced dev that was never prompted for the stage gets the answer in its first prompt (R8, 53)
seed_park BLOCKED 1 "$FIX/pk-new.json"; printf 'Do X\n' >"$STATE/answer-1.md"; rm -f "$FIX/pk-new.json.sent"
TAKEOVER=1; out="$(RP)"
assert_eq "resume_park: a replaced dev: nothing is sent now, the answer waits for its first prompt" "none" "$(sed -E 's/.*sent=([^ ]*) .*/\1/' <<<"$out")"
assert_contains "resume_park: ...worded as the previous dev's stop" "$out" "tk=[The previous dev stopped with this (BLOCKED): Q? The lead answers: Do X]"
seed_park BLOCKED 1 "$FIX/pk-new.json"; printf 'Do X\n' >"$STATE/answer-1.md"; TAKEOVER=""
assert_contains "resume_park: a live dev whose prompt never went out is spoken to as itself ('parked earlier')" "$(RP)" "tk=[You were parked earlier (BLOCKED): Q? The lead answers: Do X]"
seed_park BLOCKED 1 "$FIX/pk-new.json"; TAKEOVER=1
assert_contains "resume_park: a replaced dev and no answer yet: PARKED" "$( sx RP )" "FINISH 2|develop|PARKED"
TAKEOVER=""
seed_park DIALOG; MUX_STATE=blocked
assert_contains "resume_park: a DIALOG park with the agent still blocked stays PARKED" "$( sx RP )" "FINISH 2|develop|PARKED"
seed_park DIALOG; MUX_STATE=idle
assert_eq "resume_park: a DIALOG park resumes once the agent is no longer blocked" "rc=0 sent=none tk=[]/resumed" "$(RP)/$(parked)"
seed_park LIMIT
assert_eq "resume_park: a LIMIT park resumes at once" "rc=0 sent=none tk=[]/resumed" "$(RP)/$(parked)"
newstate; assert_eq "resume_park: no park.json: nothing to do" "rc=0 sent=none tk=[]" "$(RP)"

# --- resume_restart -------------------------------------------------------------------------------------------
RR() { RESTART_DEV="" KEEP_CLOCK=""; resume_restart; echo "rc=$? closes=$N_CLOSE dev=${RESTART_DEV:-no} keep=${KEEP_CLOCK##*/} $(parked)"; }
# mutation: the case arms (LIMIT; BLOCKED without answer), `rm -f $file $file.sent`, RESTART_DEV, KEEP_CLOCK, the mv to park-$n
seed_park LIMIT 1 develop.json; printf '{}' >"$STATE/develop.json"; : >"$STATE/develop.json.sent"; printf '20\n' >"$STATE/develop.json.clock"
assert_eq "resume_restart: a LIMIT park closes the agent, restarts the dev stage, keeps the clock" "rc=0 closes=1 dev=1 keep=develop.json resumed" "$(RR)"
assert_eq "resume_restart: ...the verdict and its marker are gone, the clock stays" "no/no/yes" "$([[ -e "$STATE/develop.json" ]] && echo yes || echo no)/$([[ -e "$STATE/develop.json.sent" ]] && echo yes || echo no)/$([[ -e "$STATE/develop.json.clock" ]] && echo yes)"
assert_eq "resume_restart: ...the park is resolved as park-1.json" "yes" "$([[ -e "$STATE/park-1.json" ]] && echo yes)"
seed_park BLOCKED 1 fix-r2.json u6-review-r1
assert_eq "resume_restart: a BLOCKED park the lead left without an answer restarts the stage; a non-dev agent does not restart the dev" "rc=0 closes=1 dev=no keep=fix-r2.json resumed" "$(RR)"
seed_park BLOCKED 1 fix-r2.json; printf 'A\n' >"$STATE/answer-1.md"
assert_eq "resume_restart: ...with an answer, nothing is restarted (resume_park delivers it)" "rc=0 closes=0 dev=no keep= parked" "$(RR)"
seed_park QUESTION; assert_eq "resume_restart: a QUESTION park is left to resume_park" "rc=0 closes=0 dev=no keep= parked" "$(RR)"
newstate; mux_reset; assert_eq "resume_restart: no park.json: nothing" "rc=0 closes=0 dev=no keep= resumed" "$(RR)"
loop_fn send_prompt

# --- model_pick and --model overrides -----------------------------------------------------------------------
# mutation: model_pick's `"$STAGE" "$CUR_ROUND"` arguments; (lib) ship_models_override's stage check
STAGE=review CUR_ROUND=2
pick_model() { PICK_ARGS="$*"; PICK_MODEL=m; }
model_pick dev u6-dev
assert_eq "model_pick: asks pick_model for the list, the agent, the current stage and round" "dev u6-dev review 2" "$PICK_ARGS"
STAGE=develop CUR_ROUND=0; unset -f pick_model; source "$SHIP_DIR/lib.sh"
write_cfg; unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load   # the one real config load of this file
BASE_CFG="$SHIP_CONFIG_JSON" BASE_LAY="$SHIP_CONFIG_LAYERS"
model_pick dev u6-dev
assert_eq "model_pick: without an override, the first model of the stage's list (the defaults)" "sonnet" "$PICK_MODEL"
ship_models_override "dev=prov/m:high,opus"; model_pick dev u6-dev
assert_eq "model_pick: a --model override replaces the stage's list; its first entry is picked" "prov/m:high" "$PICK_MODEL"
assert_fails "ship_models_override: an unknown stage is refused (exit 1 in the driver)" ship_models_override "nostage=sonnet"
assert_fails "ship_models_override: a value without = is refused" ship_models_override "dev"

# --- usage_exit, argument checks and preflight (no unit) -------------------------------------------------------
loop_fn usage_exit preflight
# mutation: usage_exit's exit code / prefix; the `case "$CLASS"`, the required-flag loop, preflight's need/gate/mux/model checks
out="$(sx usage_exit "bad thing")"
assert_eq "usage_exit: prints 'ship-loop: <message>' and exits 1" $'ship-loop: bad thing\nrc=1' "$out"
LB() { SHIP_CONFIG_JSON="$BASE_CFG" SHIP_CONFIG_LAYERS="$BASE_LAY" bash "$LOOP" "$@" 2>&1; echo "rc=$?"; } # the driver itself (config passed in), ending in its argument checks
assert_eq "driver: an unknown argument" $'ship-loop: unknown argument: --bogus\nrc=1' "$(LB --bogus)"
# a missing flag is reported by the flag the operator typed (--worktree), not by the shell variable (WT)
assert_eq "driver: --worktree is required once --ref is given" $'ship-loop: --worktree is required\nrc=1' "$(LB --ref r)"
for _row in "ref:--worktree /w --branch b --brief /b --class S" "branch:--ref r --worktree /w --brief /b --class S" "brief:--ref r --worktree /w --branch b --class S" "class:--ref r --worktree /w --branch b --brief /b"; do
  # shellcheck disable=SC2086  # the row is a word list on purpose
  assert_eq "driver: a missing --${_row%%:*} is reported by that flag" "ship-loop: --${_row%%:*} is required"$'\nrc=1' "$(LB ${_row#*:})"
done
assert_eq "driver: a class outside S, M, L" $'ship-loop: --class must be S, M or L\nrc=1' "$(LB --ref r --worktree /w --branch b --brief /b --class Q)"
assert_eq "driver: class M and L are accepted (the next check is the worktree)" $'ship-loop: worktree /w is not a directory\nrc=1/ship-loop: worktree /w is not a directory\nrc=1' "$(LB --ref r --worktree /w --branch b --brief /b --class M)/$(LB --ref r --worktree /w --branch b --brief /b --class L)"
assert_contains "driver: a --model for an unknown stage is refused (with a valid worktree and brief)" "$(LB --ref r --worktree "$FIX" --branch b --brief "$FIX/mux-check" --class S --model nostage=x)" "unknown stage"
assert_contains "driver: ...with rc 1" "$(LB --ref r --worktree "$FIX" --branch b --brief "$FIX/mux-check" --class S --model nostage=x)" "rc=1"
printf '#!/bin/sh\n[ "$1" = check ] && exit "${MUXRC:-0}"\nexit 0\n' >"$FIX/mux-check"; chmod +x "$FIX/mux-check"
pf() { # commands to hide — preflight with those missing from PATH, on $PF_CFG
  { (
    HIDE=" $* "; MUX="$FIX/mux-check"; SHIP_CONFIG_JSON="$PF_CFG" SHIP_CONFIG_LAYERS="$BASE_LAY"
    command() { if [[ "$1" == -v ]]; then case "$HIDE" in *" $2 "*) return 1 ;; esac; fi; builtin command "$@"; }
    preflight
  ) 2>&1; echo "rc=$?"; }
}
PF_CFG="$(jq -c '.gate = "true"' <<<"$BASE_CFG")"
assert_eq "preflight: a complete setup" $'preflight: ok\nrc=0' "$(pf)"
r="$(pf gh)"
assert_contains "preflight: no gh" "$r" "preflight: gh not found on PATH"
assert_contains "preflight: ...fails" "$r" $'preflight: failed\nrc=1'
assert_contains "preflight: a Claude model needs claude" "$(pf claude)" "preflight: claude not found on PATH (needed by model sonnet)"
PF_CFG="$(jq -c '.gate = "true" | .models.dev = ["prov/m"]' <<<"$BASE_CFG")"
assert_contains "preflight: a pi model needs pi" "$(pf pi)" "preflight: pi not found on PATH (needed by model prov/m)"
PF_CFG="$(jq -c '.gate = "true"' <<<"$BASE_CFG")"
assert_contains "preflight: no hyper, and no SHIP_SPACE_ROOT to stand in for it" "$(SHIP_SPACE_ROOT='' pf hyper)" "preflight: hyper not found on PATH (or set SHIP_SPACE_ROOT)"
assert_contains "preflight: a mux that fails its own check" "$(MUXRC=1 pf)" $'preflight: failed\nrc=1'
PF_CFG="$(jq -c '.gate = ""' <<<"$BASE_CFG")"
assert_contains "preflight: a config without a gate" "$(pf)" "gate must be a non-empty string"

# --- spec_required --------------------------------------------------------------------------------------------
loop_fn spec_touched spec_required
newstate
# mutation: spec_touched's pathspec, spec_required's `Spec: required` grep (case, leading blanks)
SPEC_PATHS=('docs/spec/**'); BRIEF="$FIX/b1.md"
printf '# Brief\n\nDo it.\n' >"$BRIEF"
assert_fails "spec_required: no spec path touched and the brief says nothing" spec_required
printf '# Brief\n  spec: Required\n' >"$BRIEF"
assert_ok "spec_required: the brief says 'Spec: required' (any case, indented)" spec_required
printf '# Brief\nSpec: none\n' >"$BRIEF"
assert_fails "spec_required: 'Spec: none' is not 'required'" spec_required
mkdir -p "$WT/docs/spec"; printf 'x\n' >"$WT/docs/spec/a.md"; g add -A; g commit -qm "spec"
assert_ok "spec_required: a diff that touches a spec path needs the check (no brief line needed)" spec_required
SPEC_PATHS=(); assert_fails "spec_touched: no spec paths configured: never" spec_touched
g reset -q --hard HEAD~1; SPEC_PATHS=()
BRIEF="$SPACE/notes/brief.md"

# --- spec_write -----------------------------------------------------------------------------------------------------
loop_fn spec_write
SHIP_CONFIG_JSON='{"budgets":{"check":5}}'; SW_RUNS=0 SW_COMMITS='[]' ROUNDS='[]'
prompt() { printf '%s\n' "$@" >"$STATE/prompt.args"; echo PROMPT; }
SW_RESULT=""
fresh_step() { SW_STEP="$1|$4"; [[ -z "$SW_RESULT" ]] || printf '%s\n' "$SW_RESULT" >"$4"; }
close_agent() { SW_CLOSED="$1"; }
park_result() { echo "PARK_RESULT $2|$3|$4|$5"; exit 9; }
gapj() { jq -nc --argjson g "$1" --argjson rm "${2:-[]}" --argjson f "${3:-[]}" '{verdict:"GAP",findings:$f,gaps:$g,removals:$rm,commits:[],gate:"green"}'; }
OPG='{"where":"docs/spec/b.md:1","quotes":["q"],"question":"Pick one","operator_call":true}'
NOG='{"where":"docs/spec/a.md:3","quotes":["silent"],"question":"What on EMPTY?","operator_call":false}'
SW_OK='{"status":"WRITTEN","commits":["abc spec: settle it"],"resolved":[{"where":"docs/spec/a.md#empty","question":"EMPTY input","says":"EMPTY is rejected"}],"operator_questions":[],"gate":"green"}'
swargs() { grep -a "^$1=" "$STATE/prompt.args" | head -n 1; }
# mutation: the operator-only branch (nop == ngaps, no spec removals), the .operator marker, the "nothing resolved" test, add_dev_work/pending wiring
newstate; gapj "[$OPG]" >"$STATE/spec-r1.json"
out="$(sx spec_write 'spec check' "$STATE/spec-r1.json" 1)"
assert_contains "spec_write: every gap an operator call: no writer, the unit parks OPERATOR" "$out" "PARK OPERATOR|specwriter|u6-specwriter-r1|Every gap is an operator call; no writer was started."
assert_eq "spec_write: ...the park number is saved in <writer>.json.operator" "1" "$(cat "$STATE/specwriter-r1.json.operator")"
printf '1\n' >"$STATE/specwriter-r1.json.operator"; : >"$STATE/answer-1.md"
assert_contains "spec_write: the operator's answer file must not be empty" "$(sx spec_write 'spec check' "$STATE/spec-r1.json" 1)" "DIE: specwriter-r1 waits on the operator but answer-1.md is empty"
printf 'Choose B\n' >"$STATE/answer-1.md"; SW_RESULT="$SW_OK"
( spec_write 'spec check' "$STATE/spec-r1.json" 1 ) >/dev/null 2>&1
assert_contains "spec_write: with the operator's answer, the writer is told to record the ruling" "$(swargs extra)" "extra=The operator has ruled on the gaps marked [operator call]:"
assert_contains "spec_write: ...with the answer text" "$(<"$STATE/prompt.args")" "Choose B"
newstate; gapj "[$OPG,$NOG]" >"$STATE/spec-r1.json"; SW_RESULT="$SW_OK"
( spec_write 'spec check' "$STATE/spec-r1.json" 1 ) >/dev/null 2>&1
assert_contains "spec_write: mixed gaps: the writer is told to leave the operator's alone" "$(swargs extra)" "extra=Gaps marked [operator call] wait on the operator: do not write text for them"
assert_contains "spec_write: ...and the gaps are listed with the operator mark" "$(<"$STATE/prompt.args")" "[operator call] — Pick one"
newstate; gapj "[$OPG]" '[{"where":"docs/spec/a.md:9","kind":"spec","what":"the section","why_no_consumer":"unused"}]' >"$STATE/spec-r1.json"; SW_RESULT="$SW_OK"
( spec_write 'spec check' "$STATE/spec-r1.json" 1 ) >/dev/null 2>&1
assert_contains "spec_write: operator gaps plus a spec removal still start the writer (removals are not the operator's)" "$(swargs extra)" "extra=Gaps marked [operator call] wait"
assert_contains "spec_write: ...the removal is handed over" "$(<"$STATE/prompt.args")" "the section. No consumer: unused"
newstate; gapj "[$NOG]" '[]' '[{"severity":"BLOCKING","file":"a.go","line":1,"summary":"bug","fix":"fix it"}]' >"$STATE/spec-r1.json"
SW_RESULT="$SW_OK"; SW_RUNS=0 SW_COMMITS='[]' ROUNDS='[]' pending_n=0 pending="" SW_CLOSED=""
spec_write 'spec check' "$STATE/spec-r1.json" 1
assert_eq "spec_write: the writer runs under its own name and file" "u6-specwriter-r1|$STATE/specwriter-r1.json" "$SW_STEP"
assert_contains "spec_write: ...no gap and no removal says (none)" "$(swargs gaps)" "gaps=1. docs/spec/a.md:3"
assert_eq "spec_write: the writer's agent is closed afterwards" "u6-specwriter-r1" "$SW_CLOSED"
assert_eq "spec_write: counts the run and records the commits" "1 [\"abc spec: settle it\"]" "$SW_RUNS $SW_COMMITS"
assert_eq "spec_write: the round is recorded" '[{"round":1,"verdict":"SPECWRITER-WRITTEN","resolved":1,"specCommits":1}]' "$(jq -c . <<<"$ROUNDS")"
assert_contains "spec_write: the dev is told what the spec now says" "$pending" "The spec changed under this PR: the spec check found problems"
assert_contains "spec_write: ...with the resolved text" "$pending" "1. docs/spec/a.md#empty: EMPTY is rejected"
assert_contains "spec_write: ...and the checker's own findings ride along" "$pending" "the spec check also asks for these code changes:"
assert_eq "spec_write: pending_n = resolved points + findings (1 + 1)" "2" "$pending_n"
assert_contains "spec_write: the next review is told to check the new text first" "$spec_pending" "Check the new text first"
newstate; gapj "[$NOG]" >"$STATE/spec-r1.json"; SW_RESULT='{"status":"WRITTEN","commits":[],"resolved":[],"operator_questions":[],"gate":"green"}'
assert_contains "spec_write: WRITTEN with nothing resolved is an ERROR" "$(sx spec_write 'spec check' "$STATE/spec-r1.json" 1)" "DIE: specwriter-r1.json is WRITTEN with nothing resolved"
SW_RESULT='{"status":"OPERATOR","commits":[],"resolved":[],"operator_questions":[{"where":"docs/spec/b.md:1","question":"Pick one","options":"A or B","recommendation":"A"}],"gate":"green"}'
assert_contains "spec_write: a writer that hands back OPERATOR parks the unit with its questions and recommendation" "$(sx spec_write 'spec check' "$STATE/spec-r1.json" 1)" "PARK_RESULT OPERATOR|specwriter|u6-specwriter-r1|1. docs/spec/b.md:1 — Pick one Options: A or B. Recommendation: A."
unset -f prompt fresh_step close_agent park_result; loop_fn prompt fresh_step close_agent

# --- fix_round and review_gate ---------------------------------------------------------------------------------
loop_fn fix_round review_gate route_spec_rejection fresh_result valid_json mark_sent sent_after_result mtime_s
# fix_round: run_step, check_verdict, dev_ok, diff_sig, budget_min, prompt and takeover_text are the collaborators
prompt() { printf 'PROMPT[%s]' "$*"; }
takeover_text() { printf 'TAKEOVER-TEXT'; }
run_step() { RS_TEXT="$2|$3"; RS_ARGS="$1 $4 stage=$STAGE round=$CUR_ROUND"; }
check_verdict() { :; }
dev_ok() { :; }
budget_min() { echo 7; }
diff_sig() { DSIG="${CUR:-sig0}"; }
FIX_SRC=review CUR=sig0
FRT() { # round findings n — fix_round; prints the text run_step got, then TAKEOVER state
  RS_TEXT=""; fix_round "$@"; echo "$RS_TEXT"; echo "tk=[$TAKEOVER] tka=[$TAKEOVER_ANSWER]"
}
# mutation: `if ! fresh_result "$f"` (always true / always false), the TAKEOVER and TAKEOVER_ANSWER clears, the
# "Continue from there." line, the .before written once (-e .sent && -s .before), the .findings/.src/.n files
newstate; TAKEOVER=1; TAKEOVER_ANSWER="ANSWER-TEXT"
out="$(FRT 1 "F1" 2 2>/dev/null)"
PR1="PROMPT[fix round=1 pending=F1 verdict_file=$STATE/fix-r1.json]"
assert_eq "fix_round: a takeover text, the stage prompt and the lead's answer go out in one prompt" \
  "$STATE/fix-r1.json|TAKEOVER-TEXT"$'\n\n'"$PR1"$'\n\n'"ANSWER-TEXT"$'\nContinue from there.\ntk=[] tka=[]' "$out"
TAKEOVER=1 TAKEOVER_ANSWER="ANSWER-TEXT"; RS_TEXT=""; fix_round 1 "F1" 2 2>/dev/null
assert_eq "fix_round: ...and both are cleared once used (in this shell)" "tk=[] tka=[]" "tk=[$TAKEOVER] tka=[$TAKEOVER_ANSWER]"
assert_eq "fix_round: the round's findings, source and count are kept for a resume" "F1/review/2" "$(cat "$STATE/fix-r1.findings")/$(cat "$STATE/fix-r1.src")/$(cat "$STATE/fix-r1.n")"
assert_eq "fix_round: run_step gets the dev, the budget (budget_min) and the fix stage" "u6-dev 7 stage=fix round=1" "$RS_ARGS"
assert_eq "fix_round: the diff the dev was prompted on is recorded" "sig0" "$(cat "$STATE/fix-r1.before")"
newstate; printf '{"status":"DONE"}\n' >"$STATE/fix-r2.json"; : >"$STATE/fix-r2.json.sent"; touch -r "$STATE/fix-r2.json" "$STATE/fix-r2.json.sent"
TAKEOVER=1 TAKEOVER_ANSWER="ANSWER-TEXT"; RS_TEXT=""; fix_round 2 "F2" 1 2>/dev/null
assert_eq "fix_round: a fix that is already in is replayed, not prompted: no takeover text, no answer" "$STATE/fix-r2.json|PROMPT[fix round=2 pending=F2 verdict_file=$STATE/fix-r2.json]" "$RS_TEXT"
assert_eq "fix_round: ...and they wait for the step that is prompted" "tk=[1] tka=[ANSWER-TEXT]" "tk=[$TAKEOVER] tka=[$TAKEOVER_ANSWER]"
newstate; TAKEOVER="" TAKEOVER_ANSWER=""; printf 'old-sig\n' >"$STATE/fix-r3.before"; : >"$STATE/fix-r3.json.sent"; CUR=new-sig
fix_round 3 "F3" 1 2>/dev/null
assert_eq "fix_round: a resumed fix (marker and .before present) keeps the first .before" "old-sig" "$(cat "$STATE/fix-r3.before")"
rm -f "$STATE/fix-r3.json.sent"; fix_round 3 "F3" 1 2>/dev/null
assert_eq "fix_round: ...but a fix not yet prompted records the diff as it is now" "new-sig" "$(cat "$STATE/fix-r3.before")"
unset CUR

# review_gate: fix_round, diff_sig, rejected_diff, reviewed_diff, rejection_text, do_review and finish are stubs.
# The "world" is one variable, CUR (the diff signature now); each fix_round call records itself and moves CUR to NEXT.
fix_round() { GC="$GC|r$1[src=$FIX_SRC n=$3]<<$2>>"; printf '%s\n' "$BEFORE" >"$STATE/fix-r$1.before"; CUR="$NEXT"; }
rejected_diff() { REJECTED_BY=""; [[ "$CUR" == "$REJ" ]] || return 1; REJECTED_BY=spec-r1.json; }
reviewed_diff() { [[ "$CUR" == "$OKSIG" ]]; }
rejection_text() { printf 'REJTEXT(%s)' "$(basename "$1")"; }
# the re-check collaborators: recheck_diff (scripted: RD_FIX makes its first call send the dev back to fix), set_recheck
# (records its arguments in SR) and spec_route (SPEC_ROUTED makes it take the diff once, recording SRT)
RD=0 RD_FIX="" SR="" SRT="" SPEC_ROUTED=""
recheck_diff() { RD=$((RD + 1)); if [[ -n "$RD_FIX" && $RD -eq 1 ]]; then NEED_FIX="RECHECK-FIX" NEED_FIX_N=1; FIX_SRC=gate; return 1; fi; return 0; }
set_recheck() { SR="$1|$2"; }
spec_route() { [[ -n "$SPEC_ROUTED" ]] || return 1; SRT="$1|$2"; SPEC_ROUTED=""; CUR=ok; return 0; }
do_review() { echo "REVIEWED"; exit 9; }
RG() { # prints the fix_round calls and the log (or what finish ended with)
  newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; BEFORE="${BEFORE:-b0}"
  ( review_gate; echo "return gc=$GC" ) 2>&1; cat "$LOG"
}
# mutation: the "restored the diff" note and its cycles count, `cycles -ge MAX` → STUCK (stage from REJECTED_BY),
# the "changed nothing" branch (only after a review verdict), the gate branch's wording / FIX_SRC=gate / GATE_PRIOR
NEED_FIX="F" NEED_FIX_N=2 FIX_SRC=review BEFORE=b0 CUR=cur REJ=bad NEXT=bad OKSIG=ok
# first fix restores the rejected diff, the second one makes an accepted diff
fix_round() { GC="$GC|r$1[src=$FIX_SRC n=$3]<<$2>>"; printf '%s\n' "$BEFORE" >"$STATE/fix-r$1.before"; if [[ $1 -eq 1 ]]; then CUR=bad; else CUR=ok; fi; }
out="$(RG)"
assert_contains "review_gate: a fix that restores a diff a stage rejected is logged and counted" "$out" "round 1: the fix restored the diff that spec-r1.json rejected (1 of 3)"
assert_contains "review_gate: ...the dev is told in the next round (the restored note)" "$out" "|r2[src=review n=2]<<F"$'\n'"(Your last attempt restored the diff that spec-r1.json rejected. Change the code, or stop with QUESTION and say why not.)>>"
assert_contains "review_gate: ...and an accepted diff after the second fix ends the gate" "$out" "return gc="
NEED_FIX="F" NEED_FIX_N=1 FIX_SRC=review
newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=1; CUR=cur
out="$( ( review_gate ) 2>&1 )"
assert_contains "review_gate: a restored rejected diff at max_rounds ends STUCK, naming the stage that rejected it" "$out" "FINISH 2|spec|STUCK"
# a fix that changes nothing after a CHANGES verdict
fix_round() { GC="$GC|r$1[src=$FIX_SRC]<<$2>>"; printf 'same\n' >"$STATE/fix-r$1.before"; if [[ $1 -eq 1 ]]; then CUR=same; else CUR=ok; fi; }
rejected_diff() { REJECTED_BY=""; return 1; }
diff_sig() { DSIG="$CUR"; }
NEED_FIX="F" NEED_FIX_N=1 FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=cur
out="$( ( review_gate; echo "return gc=$GC" ) 2>&1; cat "$LOG" )"
assert_contains "review_gate: a fix after a CHANGES verdict that left the diff as it was is a failed round" "$out" "round 1: the fix changed nothing after a CHANGES verdict (1 of 3)"
assert_contains "review_gate: ...the dev is told so" "$out" "(Your last attempt changed nothing in the diff. Change the code, or stop with QUESTION and say why not.)>>"
NEED_FIX="F" NEED_FIX_N=1 FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=1; CUR=cur
assert_contains "review_gate: ...and at max_rounds it ends STUCK on review" "$( ( review_gate ) 2>&1 )" "FINISH 2|review|STUCK"
NEED_FIX="F" NEED_FIX_N=1 FIX_SRC=gate; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=cur
out="$( ( review_gate; echo "return gc=$GC" ) 2>&1; cat "$LOG" )"
assert_not_contains "review_gate: a fix for a gate-restored diff that changes nothing is not counted as a failed round" "$out" "changed nothing"
# no fix pending: the diff was restored by something that is not a dev fix
fix_round() { GC="$GC|r$1[src=$FIX_SRC n=$3]<<$2>>"; printf 'b\n' >"$STATE/fix-r$1.before"; CUR=ok; }
rejected_diff() { REJECTED_BY=""; [[ "$CUR" == "$REJ" ]] || return 1; REJECTED_BY=spec-r1.json; }
NEED_FIX="" NEED_FIX_N=1 FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=bad
out="$( ( review_gate; echo "return gc=$GC" ) 2>&1; cat "$LOG" )"
assert_contains "review_gate: a rejected diff restored without a dev fix is logged and counted" "$out" "the diff changed without a dev fix and is the one spec-r1.json rejected (1 of 3)"
assert_contains "review_gate: ...the dev gets it back worded as 'not a fix of yours', with the rejection text" "$out" "|r1[src=gate n=1]<<The diff now in the PR is the one spec-r1.json rejected. The gate, a rebase or a commit outside your fixes (not a fix of yours) restored it, so the change that answered these has been undone. Address them again in the code, or stop with QUESTION and say why not:"$'\n'"REJTEXT(spec-r1.json)>>"
NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=1; CUR=bad
assert_contains "review_gate: ...and at max_rounds that is STUCK too" "$( ( review_gate ) 2>&1 )" "FINISH 2|spec|STUCK"
NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=ok
assert_eq "review_gate: nothing pending and the diff already reviewed: returns at once" "return gc=" "$( ( review_gate; echo "return gc=$GC" ) 2>&1 )"
NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=fresh
assert_contains "review_gate: a diff nobody reviewed (not rejected either) goes to a new review" "$( ( review_gate ) 2>&1 )" "REVIEWED"
# The re-check wiring (D4). mutation: drop `recheck_diff && return 0` (the first), `continue` after a failed re-check,
# the set_recheck call in the restore branch, its stage (${REJECTED_BY%%-r*}), the spec_route call and its `continue`
fix_round() { GC="$GC|r$1[src=$FIX_SRC n=$3]<<$2>>"; printf 'b\n' >"$STATE/fix-r$1.before"; CUR=ok; }
rejected_diff() { REJECTED_BY=""; [[ "$CUR" == "$REJ" ]] || return 1; REJECTED_BY="${REJBY:-spec-r1.json}"; }
REJ=bad OKSIG=ok
RD=0 RD_FIX=1; NEED_FIX="" NEED_FIX_N=1 FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=ok
out="$( ( review_gate; echo "return gc=$GC rd=$RD" ) 2>&1 )"
assert_contains "review_gate: a re-check that rejects (FIX_SRC=gate) sends the dev to fix, with the stage's findings" "$out" "|r1[src=gate n=1]<<RECHECK-FIX>>"
assert_contains "review_gate: ...and the gate settles once the re-check accepts the fixed diff (two re-check calls)" "$out" "return gc=|r1[src=gate n=1]<<RECHECK-FIX>> rd=2"
RD=0 RD_FIX=""; NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=ok
assert_eq "review_gate: a re-check that accepts lets a reviewed diff through with no fix" "return gc= rd=1" "$( ( review_gate; echo "return gc=$GC rd=$RD" ) 2>&1 )"
for by in spec-r1.json final-r2.json; do
  REJBY="$by"; SR=""; NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=bad
  out="$( ( review_gate; echo "SR=$SR" ) 2>&1 )"
  assert_contains "review_gate: the restore branch owes a re-check to ${by%%-r*} (the stage that rejected the diff)" "$out" "SR=${by%%-r*}|The PR was restored, by the gate or another change that is not a dev fix, to the diff that ${by%%-r*} rejected."
done
REJBY=""
# a restored spec rejection that no writer has handled goes to the spec writer, with the verdict file and its round
SPEC_ROUTED=1 SRT=""; NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=bad
out="$( ( review_gate; echo "SRT=$SRT gc=$GC" ) 2>&1; cat "$LOG" )"
assert_contains "review_gate: a spec rejection with nothing handled yet goes to spec_route (file, round)" "$out" "SRT=$STATE/spec-r1.json|1 gc="
assert_not_contains "review_gate: ...and no fix round is spent on it" "$out" "r1[src="
assert_not_contains "review_gate: ...nor does it count as a restored-diff cycle" "$out" "(1 of 3)"
assert_contains "review_gate: ...and the log says it went to the spec writer" "$out" "left to the spec writer; routed there, not to the dev"
# a spec writer that already WRITTEN for that round is not run again: the old restore path (to the dev) applies
SPEC_ROUTED=1 SRT=""; NEED_FIX="" FIX_SRC=review; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=bad
printf '{"status":"WRITTEN"}\n' >"$STATE/specwriter-r1.json"
out="$( ( review_gate; echo "SRT=$SRT gc=$GC" ) 2>&1 )"
assert_contains "review_gate: a round whose spec writer already finished goes to the dev instead" "$out" "SRT= gc=|r1[src=gate n=1]"
SPEC_ROUTED=""
# the same on a replayed dev fix (a resumed driver continues fix round N over a diff the spec check already GAP'd)
fix_round() { GC="$GC|r$1[src=$FIX_SRC n=$3]<<$2>>"; printf 'b\n' >"$STATE/fix-r$1.before"; CUR=bad; }
SPEC_ROUTED=1 SRT=""; NEED_FIX="F" NEED_FIX_N=1 FIX_SRC=gate; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=cur
out="$( ( review_gate; echo "SRT=$SRT gc=$GC" ) 2>&1; cat "$LOG" )"
assert_contains "review_gate: a dev fix that leaves a diff the spec check GAP'd goes to spec_route" "$out" "SRT=$STATE/spec-r1.json|1 gc=|r1[src=gate n=1]<<F>>"
assert_not_contains "review_gate: ...and is not counted as a restored diff or sent back to the dev" "$out" "restored the diff"
SPEC_ROUTED=""; NEED_FIX="F" FIX_SRC=gate; newstate; GC=""; FR=0 cycles=0 guard=0 GATE_PRIOR=""; MAX=3; CUR=cur
assert_contains "review_gate: a fix that restores a rejected diff no route takes still counts and goes back to the dev" "$( ( review_gate ) 2>&1; cat "$LOG" )" "round 1: the fix restored the diff that spec-r1.json rejected (1 of 3)"

# spec_route (real): GAP and spec-text REMOVE go to the writer, the rest does not. spec_write is a stub.
loop_fn spec_route jlen rmlen fmt_removals
spec_write() { SW="$1|$2|$3"; pending="WRITER-NOTE"; pending_n=2; spec_pending="WRITER-SAID"; }
SRV() { # verdict-json -> prints rc, writer call, set_recheck, NEED_FIX
  newstate; printf '%s\n' "$1" >"$STATE/spec-r4.json"; SW="" SR="" NEED_FIX="" NEED_FIX_N=0 FIX_SRC=review GATE_PRIOR=""
  spec_route "$STATE/spec-r4.json" 4; echo "rc=$? sw=${SW#*|} sr=$SR nf=[$NEED_FIX] n=$NEED_FIX_N src=$FIX_SRC gp=[$GATE_PRIOR] pend=[$pending]"
}
G1='{"where":"d:1","quotes":["q"],"question":"Q","operator_call":false}'
out="$(SRV "{\"verdict\":\"GAP\",\"findings\":[],\"gaps\":[$G1],\"removals\":[]}")"
assert_eq "spec_route: a GAP-only verdict goes to the writer, is owed a re-check told what the writer settled, and spends no fix" "rc=0 sw=SPEC|4 sr=spec|WRITER-SAID nf=[] n=0 src=review gp=[WRITER-SAID] pend=[]" "$(sed "s#/[^ ]*/spec-r4.json#SPEC#" <<<"$out")"
out="$(SRV "{\"verdict\":\"GAP\",\"findings\":[{\"severity\":\"BLOCKING\",\"file\":\"a\",\"line\":1,\"summary\":\"s\",\"fix\":\"f\"}],\"gaps\":[$G1],\"removals\":[]}")"
assert_contains "spec_route: a GAP with findings also sends the dev the writer's note (FIX_SRC=gate)" "$out" "nf=[WRITER-NOTE] n=2 src=gate"
out="$(SRV '{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"d:9","kind":"spec","what":"x","why_no_consumer":"y"}]}')"
assert_contains "spec_route: a REMOVE with spec-text removals goes to the writer" "$out" "rc=0 sw="
out="$(SRV '{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"a.go:9","kind":"code","what":"x","why_no_consumer":"y"}]}')"
assert_contains "spec_route: a REMOVE with only code removals stays with the dev (rc 1, writer not run)" "$out" "rc=1 sw= sr= nf=[]"
out="$(SRV '{"verdict":"CHANGES","findings":[],"gaps":[],"removals":[]}')"
assert_contains "spec_route: any other verdict stays with the dev" "$out" "rc=1 sw="
newstate; printf '{"verdict":"GAP","gaps":[],"removals":[]}\n' >"$STATE/final-r4.json"; SW=""
spec_route "$STATE/final-r4.json" 4; assert_eq "spec_route: only the spec check's file is routed (final-r4 is not)" "1|" "$?|$SW"
unset -f spec_write

# rechecked_diff (real) and finalize_try's push check
loop_fn rechecked_diff fresh_result valid_json sent_after_result mtime_s
diff_sig() { DSIG="${CUR:-sig0}"; }
spec_required() { return 0; }
RCV() { # RECHECK verdict-sig verdict -> rc of rechecked_diff
  newstate; RECHECK="$1"
  if [[ -n "$2" ]]; then printf '{"verdict":"%s"}\n' "$3" >"$STATE/spec-r2.json"; : >"$STATE/spec-r2.json.sent"; touch -r "$STATE/spec-r2.json" "$STATE/spec-r2.json.sent"; printf '%s\n' "$2" >"$STATE/spec-r2.sig"; fi
  rechecked_diff; echo $?
}
CUR=sigA
assert_eq "rechecked_diff: nothing owed: true" "0" "$(RCV '' '' '')"
assert_eq "rechecked_diff: owed, a fresh ACCEPT on exactly this diff: true" "0" "$(RCV spec sigA ACCEPT)"
assert_eq "rechecked_diff: owed, the ACCEPT was for another diff (sig mismatch): false" "1" "$(RCV spec sigB ACCEPT)"
assert_eq "rechecked_diff: owed, the verdict on this diff is a rejection: false" "1" "$(RCV spec sigA GAP)"
assert_eq "rechecked_diff: owed, no verdict at all: false" "1" "$(RCV spec '' '')"
spec_required() { return 1; }
assert_eq "rechecked_diff: a spec re-check owed but the spec not required: true" "0" "$(RCV spec '' '')"
assert_eq "rechecked_diff: ...which does not excuse the final gate" "1" "$(RCV final '' '')"
spec_required() { return 0; }

# finalize_clean_tree (real git): tool-made changes are restored, the dev's own uncommitted work is named and kept
# (mutation: drop the touched-by-the-unit test, or restore every dirty file)
loop_fn finalize_clean_tree
CT() { # builds origin/main + a unit branch that commits "unit.txt" and "lock with space.json"; prints nothing
  local r="$FIX/ct.$RANDOM"; mkdir -p "$r"; git -C "$r" init -q -b main; git -C "$r" config user.email t@t; git -C "$r" config user.name t
  printf 'a\n' >"$r/lock.json"; printf 'a\n' >"$r/tool noise.txt"; printf 'a\n' >"$r/gone.txt"; printf 'a\n' >"$r/old.txt"; printf 'a\n' >"$r/unit.txt"; printf 'a\n' >"$r/lock with space.json"
  git -C "$r" add -A; git -C "$r" commit -qm base; git -C "$r" update-ref refs/remotes/origin/main HEAD
  git -C "$r" checkout -qb unit; printf 'b\n' >"$r/unit.txt"; printf 'b\n' >"$r/lock with space.json"; git -C "$r" commit -qam unit
  echo "$r"
}
newstate; WT="$(CT)"; BRANCH=unit BASE=main FIN_MSG=""
printf 'x\n' >"$WT/lock.json"; printf 'x\n' >"$WT/tool noise.txt"; rm "$WT/gone.txt"; printf 'u\n' >"$WT/untracked.txt"
finalize_clean_tree; rc=$?
assert_eq "finalize_clean_tree: only tool-made changes (edited, deleted, path with a space): returns 0" "0|" "$rc|$FIN_MSG"
assert_eq "finalize_clean_tree: ...the tracked files are back at HEAD (an untracked file is left alone)" "|?? untracked.txt" "$(git -C "$WT" status --porcelain --untracked-files=no)|$(git -C "$WT" status --porcelain | tr '\n' ' ' | sed 's/ $//')"
assert_contains "finalize_clean_tree: ...and the log names them" "$(cat "$LOG")" "tool noise.txt"
assert_contains "finalize_clean_tree: ...including the deleted one" "$(cat "$LOG")" "gone.txt"
newstate; WT="$(CT)"; FIN_MSG=""
printf 'dev\n' >"$WT/unit.txt"; printf 'x\n' >"$WT/lock.json"
finalize_clean_tree; rc=$?
assert_eq "finalize_clean_tree: a file the unit's commits touch is dirty: returns 1" "1" "$rc"
assert_contains "finalize_clean_tree: ...FIN_MSG names it" "$FIN_MSG" "unit.txt"
assert_not_contains "finalize_clean_tree: ...and not the tool-made one, which was restored" "$FIN_MSG" "lock.json"
assert_eq "finalize_clean_tree: ...the dev's edit is kept" "dev" "$(cat "$WT/unit.txt")"
assert_eq "finalize_clean_tree: ...the tool-made file is back" "a" "$(cat "$WT/lock.json")"
newstate; WT="$(CT)"; FIN_MSG=""
printf 'again\n' >"$WT/lock with space.json"; git -C "$WT" add "lock with space.json"
finalize_clean_tree; rc=$?
assert_eq "finalize_clean_tree: a staged change to a file with a space the unit changed: returns 1, named whole, kept" "1|again" "$rc|$(cat "$WT/lock with space.json")"
assert_contains "finalize_clean_tree: ...FIN_MSG names the path with its space" "$FIN_MSG" "lock with space.json"
newstate; WT="$(CT)"; FIN_MSG=""
git -C "$WT" mv old.txt new.txt
finalize_clean_tree; rc=$?
assert_eq "finalize_clean_tree: a file staged as new (a rename) is not provably a tool's: returns 1, kept" "1|A  new.txt" "$rc|$(git -C "$WT" status --porcelain | grep new.txt)"
assert_contains "finalize_clean_tree: ...FIN_MSG names it" "$FIN_MSG" "new.txt"
newstate; WT="$(CT)"; FIN_MSG=""
finalize_clean_tree; rc=$?
assert_eq "finalize_clean_tree: a clean tree: returns 0, no message, nothing logged" "0||0" "$rc|$FIN_MSG|$(wc -c <"$LOG" | tr -d ' ')"

# fail closed: no origin/$BASE means nothing is restored and the driver errors (mutation: pipe the diff into tr again)
newstate; WT="$(CT)"; FIN_MSG=""; printf 'x\n' >"$WT/lock.json"; git -C "$WT" update-ref -d refs/remotes/origin/main
out="$( ( finalize_clean_tree ) 2>&1 )"; rc=$?
assert_eq "finalize_clean_tree: origin/\$BASE missing: the driver errors (die_error), nothing restored" "9|x" "$rc|$(cat "$WT/lock.json")"
assert_contains "finalize_clean_tree: ...and says which diff failed" "$out" "DIE: git diff origin/main...HEAD failed"
# never discard silently: what is restored is first saved as a patch, and the log names it
newstate; WT="$(CT)"; FIN_MSG=""; printf 'forgot\n' >"$WT/tool noise.txt"; printf '\000bin\n' >"$WT/lock.json"
finalize_clean_tree; rc=$?
pf="$(ls "$STATE"/finalize-restored-*.patch 2>/dev/null | head -1)"
assert_eq "finalize_clean_tree: restored files leave a patch in the state dir, and the log names it" "0|yes" "$rc|$([[ -s "$pf" ]] && grep -qF "$pf" "$LOG" && echo yes || echo no)"
assert_eq "finalize_clean_tree: ...the tree is restored" "a" "$(cat "$WT/tool noise.txt")"
git -C "$WT" apply "$pf"; rc=$?
assert_eq "finalize_clean_tree: ...and git apply of the patch brings both changes back (binary one too)" "0|forgot|1" "$rc|$(cat "$WT/tool noise.txt")|$(cmp -s "$WT/lock.json" <(printf '\000bin\n') && echo 1 || echo 0)"
newstate; WT="$(CT)"; FIN_MSG=""; finalize_clean_tree
assert_eq "finalize_clean_tree: a clean tree writes no patch" "0" "$(ls "$STATE"/finalize-restored-*.patch 2>/dev/null | wc -l | tr -d ' ')"

# finalize_try with reviewed_diff true and rechecked_diff false: returns 2 and pushes nothing (mutation: drop `|| ! rechecked_diff`)
loop_fn finalize_try finalize_clean_tree
git() { case "$*" in *rev-list*) echo 1;; *push*) echo PUSHED >>"$STATE/pushlog";; *rev-parse*) echo abc;; esac; return 0; }
forbidden_scan() { :; }
write_json() { echo "$2" >"$1"; }
reviewed_diff() { return 0; }
rechecked_diff() { return "$RC_RC"; }
WT="$FIX" BRANCH=b BASE=main GATE=true
newstate; RC_RC=1; finalize_try >/dev/null 2>&1; rc=$?
assert_eq "finalize_try: a READY review but the owed re-check not accepted: returns 2, nothing pushed" "2|no" "$rc|$([[ -e "$STATE/pushlog" ]] && echo yes || echo no)"
newstate; RC_RC=0; finalize_try >/dev/null 2>&1; rc=$?
assert_eq "finalize_try: with both READYs it pushes and returns 0" "0|yes" "$rc|$([[ -e "$STATE/pushlog" ]] && echo yes || echo no)"
# a forbidden hit in the diff to push: rc 1, the dev is told the file and the rule, nothing is pushed (mutation: skip the `-n "$hits"` branch)
forbidden_scan() { echo "leak.txt: leaked SECRETWORD here (matches SECRETWORD)"; }
newstate; RC_RC=0; FIN_MSG=""; finalize_try >/dev/null 2>&1; rc=$?
assert_eq "finalize_try: a forbidden hit returns 1 and pushes nothing" "1|no" "$rc|$([[ -e "$STATE/pushlog" ]] && echo yes || echo no)"
assert_contains "finalize_try: a forbidden hit names the rule" "$FIN_MSG" "added lines match scan.forbidden"
assert_contains "finalize_try: ...and the offending file and line" "$FIN_MSG" "leak.txt: leaked SECRETWORD here"
assert_contains "finalize_try: a forbidden hit tells the dev to run the tests its change affects" "$FIN_MSG" "in a commit, run the tests your change affects"
assert_not_contains "finalize_try: ...and not to run the gate" "$FIN_MSG" "run the gate"
unset -f git forbidden_scan write_json diff_sig spec_required rechecked_diff reviewed_diff recheck_diff set_recheck spec_route
unset -f fix_round rejected_diff reviewed_diff rejection_text do_review prompt takeover_text run_step check_verdict dev_ok budget_min diff_sig
unset CUR REJ NEXT OKSIG BEFORE GC

# --- the stub agent and the script's own constraints ---------------------------------------------------------------
# mutation (stub): the inode+first-line identity in stub-agent; (script): add a forbidden word, a Monitor call or a bash syntax error
S55="$FIX/stub55"; mkdir -p "$S55/state" "$S55/script"
printf '{"n":1}\n' >"$S55/script/x.json"; printf '1000 a\n' >"$S55/state/x.json.sent"
bash "$STUB" "$S55/state" "$S55/script" >/dev/null 2>&1 & _sp=$!
_dl=$((SECONDS + 3)); while [[ ! -e "$S55/state/x.json" && $SECONDS -lt $_dl ]]; do sleep 0.05; done
assert_ok "stub: the first prompt is answered" test -e "$S55/state/x.json"
rm -f "$S55/state/x.json"; printf '1000 b\n' >"$S55/state/x.json.sent"   # truncated in place: the same inode, one line again
_dl=$((SECONDS + 3)); while [[ ! -e "$S55/state/x.json" && $SECONDS -lt $_dl ]]; do sleep 0.05; done
assert_ok "stub: a marker that reuses the inode still counts as a new prompt" test -e "$S55/state/x.json"
kill "$_sp" 2>/dev/null; wait "$_sp" 2>/dev/null
assert_eq "C-1: no husk, forge, user path, host or model literal in ship-loop" "" "$(grep -niE 'husk|forge|/work/lab|/Users/|Users/|gopls|dolphin|sonnet|opus|haiku|fable' "$LOOP")"
assert_eq "C-2: no messaging, Monitor or watchdog in ship-loop" "" "$(grep -nE 'SendMessage|claude-link|hyper msg|Monitor|stall' "$LOOP")"
assert_eq "C-11: ship-loop does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$LOOP")"
assert_eq "AC-6: the plain spec grep is empty too" "" "$(grep -iE 'husk|forge|/work/lab|Users/' "$LOOP")"
assert_ok "bash -n passes" bash -n "$LOOP"
assert_ok "the stub agent passes bash -n" bash -n "$STUB"
assert_ok "the shared journey harness passes bash -n" bash -n "$TESTS_DIR/lib/loop-journey.sh"

finish_suite
