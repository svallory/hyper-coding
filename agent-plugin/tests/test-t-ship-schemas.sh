#!/usr/bin/env bash
# Row T (ship-schemas) — verdict schemas, validate_verdict in lib.sh, and the
# agent prompts (no project or host literals in them).

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
SCHEMAS="$SHIP_DIR/schemas"
PROMPTS="$SHIP_DIR/prompts"
source "$SHIP_DIR/lib.sh"

D="$FIX/verdicts"
mkdir -p "$D"

# ok_case <schema> <name> <json>   — validates
# bad_case <schema> <name> <json> <expected stderr fragment>
ok_case() {
  printf '%s' "$3" > "$D/$1-$2.json"
  assert_ok "$1: $2 is valid" validate_verdict "$SCHEMAS/$1.json" "$D/$1-$2.json"
}
bad_case() {
  printf '%s' "$3" > "$D/$1-$2.json"
  assert_eq "$1: $2 is rejected with rc 1" "1" "$(validate_verdict "$SCHEMAS/$1.json" "$D/$1-$2.json" 2>/dev/null; echo $?)"
  assert_contains "$1: $2 names the problem" "$(validate_verdict "$SCHEMAS/$1.json" "$D/$1-$2.json" 2>&1)" "$4"
}

# every schema parses
for s in develop verify review spec specwriter budget failover park result; do
  assert_ok "schema $s.json is valid JSON" jq -e . "$SCHEMAS/$s.json"
done

# develop (also fix-rN and finalize)
ok_case develop is-done '{"status":"DONE","pr":12,"head":"abc1234","summary":"did it","failovers":0}'
ok_case develop question-no-pr '{"status":"QUESTION","pr":null,"head":null,"summary":"s","question":"which?"}'
bad_case develop enum '{"status":"FINISHED","pr":1,"head":"a","summary":"s"}' '$.status:'
bad_case develop missing '{"status":"DONE","pr":1,"head":"a"}' '$: missing required key summary'
bad_case develop no-pr '{"status":"DONE","head":"a","summary":"s"}' '$: missing required key pr'
bad_case develop type '{"status":"DONE","head":"a","summary":"s","pr":"12"}' '$.pr:'
bad_case develop float '{"status":"DONE","head":"a","summary":"s","pr":1.5}' '$.pr:'

# verify
ok_case verify pass '{"verdict":"PASS","summary":"ok"}'
ok_case verify fail '{"verdict":"FAIL","summary":"s","failures":[{"what":"exit 0 on error","evidence":"ran x"}]}'
bad_case verify enum '{"verdict":"ACCEPT","summary":"s"}' '$.verdict:'
bad_case verify nested '{"verdict":"FAIL","summary":"s","failures":[{"what":"w"}]}' '$.failures[0]: missing required key evidence'

# review (also final)
ok_case review accept '{"verdict":"ACCEPT","findings":[]}'
ok_case review changes '{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"a.sh","line":3,"summary":"s","fix":"f"},{"severity":"NOTE","file":"b.sh","summary":"s","fix":"f"}]}'
bad_case review enum '{"verdict":"GAP","findings":[]}' '$.verdict:'
bad_case review severity '{"verdict":"CHANGES","findings":[{"severity":"MAJOR","file":"a","summary":"s","fix":"f"}]}' '$.findings[0].severity:'
bad_case review findings-type '{"verdict":"CHANGES","findings":"none"}' '$.findings:'
bad_case review two-values '{"verdict":"ACCEPT","findings":[]} {"verdict":"CHANGES","findings":[]}' 'expected exactly one JSON value'
bad_case review null-file 'null' '$: expected object, got null'
bad_case review false-file 'false' '$: expected object, got boolean'
bad_case review no-findings '{"verdict":"ACCEPT"}' '$: missing required key findings'

# spec (REMOVE + removals[])
ok_case spec accept '{"verdict":"ACCEPT","findings":[],"gaps":[],"removals":[],"commits":[],"gate":"ok"}'
ok_case spec remove '{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"d.md:4","kind":"spec","what":"the flag","why_no_consumer":"none named"}],"commits":[],"gate":"ok"}'
ok_case spec gap '{"verdict":"GAP","findings":[],"gaps":[{"where":"d.md","quotes":["a","b"],"question":"q","operator_call":false}],"removals":[],"commits":[],"gate":"ok"}'
bad_case spec enum '{"verdict":"MAYBE","findings":[],"gaps":[],"removals":[],"commits":[],"gate":"g"}' '$.verdict:'
bad_case spec removal-kind '{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"w","kind":"docs","what":"x","why_no_consumer":"y"}],"commits":[],"gate":"g"}' '$.removals[0].kind:'
bad_case spec removal-missing '{"verdict":"REMOVE","findings":[],"gaps":[],"removals":[{"where":"w","kind":"code","what":"x"}],"commits":[],"gate":"g"}' '$.removals[0]: missing required key why_no_consumer'
bad_case spec gap-bool '{"verdict":"GAP","findings":[],"gaps":[{"where":"w","quotes":[],"question":"q","operator_call":"yes"}],"removals":[],"commits":[],"gate":"g"}' '$.gaps[0].operator_call:'
bad_case spec no-removals '{"verdict":"ACCEPT","findings":[],"gaps":[],"commits":[],"gate":"g"}' '$: missing required key removals'
bad_case spec no-gate '{"verdict":"ACCEPT","findings":[],"gaps":[],"removals":[],"commits":[]}' '$: missing required key gate'

# specwriter
ok_case specwriter written '{"status":"WRITTEN","commits":["abc docs(design): x"],"resolved":[{"where":"d.md","question":"q","says":"s"}],"operator_questions":[]}'
ok_case specwriter operator '{"status":"OPERATOR","commits":[],"resolved":[],"operator_questions":[{"where":"w","question":"q","options":"a or b","recommendation":"a"}]}'
bad_case specwriter enum '{"status":"DONE","commits":[],"resolved":[],"operator_questions":[]}' '$.status:'
bad_case specwriter resolved '{"status":"WRITTEN","commits":[],"resolved":[{"where":"w"}],"operator_questions":[]}' '$.resolved[0]: missing required key question'

# budget (driver-written)
ok_case budget over '{"verdict":"OVER-BUDGET","stage":"develop","agent":"u-dev","class":"M","budget_min":45,"elapsed_min":47.5}'
bad_case budget class '{"verdict":"OVER-BUDGET","stage":"develop","agent":"a","class":"XL","budget_min":45,"elapsed_min":50}' '$.class:'
bad_case budget verdict '{"verdict":"READY","stage":"develop","agent":"a","class":"S","budget_min":1,"elapsed_min":2}' '$.verdict:'
bad_case budget number '{"verdict":"OVER-BUDGET","stage":"develop","agent":"a","class":"S","budget_min":"15","elapsed_min":20}' '$.budget_min:'

# failover (driver-written)
ok_case failover limit '{"stage":"review","round":2,"agent":"u-review-r2","from":"opus","to":"sonnet","reason":"limit","limit_kind":"model","matched":"hit your Opus limit","quota":{"five_hour":97,"seven_day":40,"resets_at":"2026-10-24T20:00:00Z"},"summarizer":"haiku","status_md":"STATUS.md","at":"2026-10-24T18:00:00Z"}'
ok_case failover preflight '{"stage":"dev","round":1,"agent":"a","from":"opus","to":"sonnet","reason":"preflight","limit_kind":null,"matched":null,"summarizer":null,"status_md":null,"at":"t"}'
bad_case failover reason '{"stage":"dev","round":1,"agent":"a","from":"x","to":"y","reason":"tired","limit_kind":null,"matched":null,"summarizer":null,"status_md":null,"at":"t"}' '$.reason:'
bad_case failover kind '{"stage":"dev","round":1,"agent":"a","from":"x","to":"y","reason":"limit","limit_kind":"plan","matched":"m","summarizer":null,"status_md":null,"at":"t"}' '$.limit_kind:'
bad_case failover no-matched '{"stage":"dev","round":1,"agent":"a","from":"x","to":"y","reason":"limit","limit_kind":"account","summarizer":null,"status_md":null,"at":"t"}' '$: missing required key matched'
bad_case failover missing '{"stage":"dev","round":1,"agent":"a","from":"x","reason":"limit","limit_kind":"account","matched":"m","summarizer":null,"status_md":null,"at":"t"}' '$: missing required key to'

# park (driver-written)
ok_case park question '{"status":"QUESTION","stage":"develop","agent":"u-dev","question":"q?","since":"2026-10-24T18:00:00Z"}'
ok_case park limit '{"status":"LIMIT","stage":"review","agent":"a","question":"all models limited","since":"t","resets_at":"2026-10-25T00:00:00Z"}'
bad_case park enum '{"status":"DONE","stage":"s","agent":"a","question":"q","since":"t"}' '$.status:'
bad_case park missing '{"status":"BLOCKED","stage":"s","agent":"a","since":"t"}' '$: missing required key question'

# result (driver-written)
ok_case result ready '{"ref":"u","pr":7,"stage":"done","status":"READY","rounds":[{"round":1,"verdict":"ACCEPT"}],"spec":{"verdict":"SKIP","rounds":0},"final":{"verdict":"NOT_RUN","rounds":0},"specwriter":{"runs":0,"commits":[]},"finalize":{},"failovers":0,"host":"local","worktree":"/w"}'
ok_case result null-pr '{"ref":"u","pr":null,"stage":"develop","status":"PARKED","rounds":[],"spec":{"verdict":"SKIP","rounds":0},"final":{"verdict":"NOT_RUN","rounds":0},"specwriter":{"runs":0,"commits":[]},"finalize":null,"host":"local","worktree":"/w"}'
bad_case result status '{"ref":"u","pr":1,"stage":"done","status":"DONE","rounds":[],"spec":{"verdict":"SKIP","rounds":0},"final":{"verdict":"NOT_RUN","rounds":0},"specwriter":{"runs":0,"commits":[]},"finalize":{},"host":"local","worktree":"/w"}' '$.status:'
bad_case result spec '{"ref":"u","pr":1,"stage":"done","status":"READY","rounds":[],"spec":{"verdict":"MAYBE","rounds":0},"final":{"verdict":"NOT_RUN","rounds":0},"specwriter":{"runs":0,"commits":[]},"finalize":{},"host":"l","worktree":"/w"}' '$.spec.verdict:'
bad_case result rounds '{"ref":"u","pr":1,"stage":"done","status":"READY","rounds":{},"spec":{"verdict":"SKIP","rounds":0},"final":{"verdict":"NOT_RUN","rounds":0},"specwriter":{"runs":0,"commits":[]},"finalize":{},"host":"local","worktree":"/w"}' '$.rounds:'
bad_case result no-host '{"ref":"u","pr":1,"stage":"done","status":"READY","rounds":[]}' '$: missing required key host'

# validate_verdict edge cases
printf 'not json' > "$D/garbage.json"
assert_eq "invalid JSON file returns 2" "2" "$(validate_verdict "$SCHEMAS/review.json" "$D/garbage.json" 2>/dev/null; echo $?)"
assert_contains "invalid JSON file is named" "$(validate_verdict "$SCHEMAS/review.json" "$D/garbage.json" 2>&1)" "not valid JSON"
assert_eq "missing file returns 2" "2" "$(validate_verdict "$SCHEMAS/review.json" "$D/nope.json" 2>/dev/null; echo $?)"
assert_eq "missing schema returns 2" "2" "$(validate_verdict "$SCHEMAS/nope.json" "$D/garbage.json" 2>/dev/null; echo $?)"
assert_eq "no arguments returns 2" "2" "$(validate_verdict 2>/dev/null; echo $?)"
printf '[]' > "$D/array.json"
assert_fails "a top-level array is rejected" validate_verdict "$SCHEMAS/review.json" "$D/array.json" 2>/dev/null
printf '"ACCEPT"' > "$D/string.json"
assert_fails "a top-level string is rejected" validate_verdict "$SCHEMAS/review.json" "$D/string.json" 2>/dev/null
printf '{"verdict":"ACCEPT","findings":[],"extra":{"x":1}}' > "$D/extra.json"
assert_ok "unnamed keys are allowed" validate_verdict "$SCHEMAS/review.json" "$D/extra.json"
printf '{"verdict":"CHANGES","findings":[{"severity":"X","file":1,"summary":"s","fix":"f"}]}' > "$D/multi.json"
n="$(validate_verdict "$SCHEMAS/review.json" "$D/multi.json" 2>&1 | grep -c 'does not match')"
assert_eq "every problem is reported, one per line" "2" "$n"

# prompts: present, and free of project/host literals (C-1) --------------------
for p in develop fix verify review spec specwriter final takeover summarize rules; do
  assert_ok "prompt $p.md exists and is not empty" test -s "$PROMPTS/$p.md"
done
leaks="$(grep -inE 'husk|forge|gopls|Dolphin|herdr' "$PROMPTS"/*.md)"
assert_eq "no husk/host literals in the prompts" "" "$leaks"
for ph in gate base spec_paths rulings verify_instructions; do
  assert_ok "a prompt uses {$ph}" grep -qF "{$ph}" "$PROMPTS"/*.md
done
assert_contains "spec prompt can ask for REMOVE" "$(cat "$PROMPTS/spec.md")" "REMOVE"
assert_contains "spec prompt ties removals to the brief's Consumers" "$(cat "$PROMPTS/spec.md")" "Consumers"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do
  assert_contains "summarize.md has $sec" "$(cat "$PROMPTS/summarize.md")" "$sec"
done
assert_contains "takeover.md points at STATUS" "$(cat "$PROMPTS/takeover.md")" "{status_file}"

# prompts and schemas name no model either
leaks="$(grep -inE 'sonnet|opus|haiku|fable' "$PROMPTS"/*.md "$SCHEMAS"/*.json)"
assert_eq "no model names in prompts and schemas" "" "$leaks"

# each prompt's example JSON, filled with realistic values, validates ------------
# example_of <prompt> — the example line, first enum alternative picked, ints filled
example_of() {
  python3 -I - "$PROMPTS/$1.md" <<'PY'
import re, sys
for line in open(sys.argv[1]):
    if line.startswith('{"'):
        line = re.sub(r'"([A-Za-z_-]+(?:\|[A-Za-z_-]+)+)"', lambda m: '"' + m.group(1).split('|')[0] + '"', line)
        line = re.sub(r'<int[^>]*>', '3', line)
        line = re.sub(r'<true[^>]*>', 'false', line)
        line = line.replace('{pr}', '7')
        print(line.strip())
        break
PY
}
for pair in develop:develop fix:develop verify:verify review:review final:review spec:spec specwriter:specwriter; do
  pr="${pair%%:*}"; sc="${pair##*:}"
  example_of "$pr" > "$D/example-$pr.json"
  assert_ok "prompt $pr.md example parses" jq -e . "$D/example-$pr.json"
  assert_ok "prompt $pr.md example validates against $sc.json" validate_verdict "$SCHEMAS/$sc.json" "$D/example-$pr.json"
done
assert_contains "fix.md example carries pr" "$(cat "$D/example-fix.json")" '"pr":7'
for p in rules develop fix verify review spec specwriter final takeover summarize; do
  assert_contains "prompt $p.md starts with a placeholder comment" "$(head -n 1 "$PROMPTS/$p.md")" "<!--"
done

# lib.sh stays free of host/model literals (same rule as the config test)
leaks="$(grep -niE 'husk|forge|/work/lab|/Users/|sonnet|opus|haiku|fable' "$SHIP_DIR/lib.sh")"
assert_eq "no husk/host/model literals in lib.sh" "" "$leaks"

finish
