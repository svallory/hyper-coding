#!/usr/bin/env bash
# Row T (ship step skills) — the ship, unit, land, kickoff and auto skills: size
# limits, plugin paths that exist, no multiplexer command, no project or model
# literals; and the mechanics of hyper:auto (ship-auto) against a fixture rulings
# file: papiro questions JSON, and a reply applied to the statuses.

REAL_HOME="$HOME"
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SKILLS="$PLUGIN_DIR/skills"
AUTO="$SCRIPTS_DIR/ship/ship-auto"
names="ship unit land kickoff auto"

# --- layout, frontmatter, sizes ---------------------------------------------------------
for n in $names; do
  f="$SKILLS/$n/SKILL.md"
  assert_ok "skills/$n/SKILL.md exists" test -f "$f"
  assert_eq "skills/$n frontmatter name is its directory" "$n" "$(sed -n '2s/^name: *//p' "$f")"
  assert_eq "skills/$n has a description" "description" "$(sed -n '3s/^\(description\):.*/\1/p' "$f")"
  limit=8192; [[ "$n" == ship ]] && limit=14336
  size="$(wc -c < "$f" | tr -d ' ')"
  if [[ "$size" -lt "$limit" ]]; then pass "skills/$n/SKILL.md is under $limit bytes ($size)"; else fail "skills/$n/SKILL.md is $size bytes (limit $limit)"; fi
done

# --- every ${CLAUDE_PLUGIN_ROOT} path exists ---------------------------------------------
missing="" deferred=""
for n in $names; do
  while read -r rel; do
    [[ -n "$rel" ]] || continue
    if [[ -e "$PLUGIN_DIR/$rel" ]]; then continue; fi
    case "$rel" in
      scripts/ship/ship-unit) deferred="$rel" ;;   # its own unit; checked once it is on the branch
      *) missing="$missing $n:$rel" ;;
    esac
  done < <(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[A-Za-z0-9._/-]+' "$SKILLS/$n/SKILL.md" | sed 's|^${CLAUDE_PLUGIN_ROOT}/||; s|[./]*$||' | sort -u)
done
assert_eq "every \${CLAUDE_PLUGIN_ROOT} path in the five skills exists" "" "$missing"
if [[ -n "$deferred" ]]; then
  skip "scripts/ship/ship-unit exists" "not on this branch yet (separate unit):$deferred"
else
  assert_ok "scripts/ship/ship-unit is executable" test -x "$PLUGIN_DIR/scripts/ship/ship-unit"
fi
for s in ship-auto ship-config ship-land ship-mux; do
  assert_ok "scripts/ship/$s is executable" test -x "$SCRIPTS_DIR/ship/$s"
done

# --- C-11, C-1, C-2 over these skills -----------------------------------------------------
files="$AUTO"; for n in $names; do files="$files $SKILLS/$n/SKILL.md"; done
# shellcheck disable=SC2086
mux_cmd="$(grep -nE '(^|[^A-Za-z-])herdr +(-[^ ]+ +)*(agent|api|channel|completion|config|integration|machine|notification|pane|server|session|status|tab|update|workspace|worktree)\b|(command -v|type -p|which|hash) +herdr' $files)"
assert_eq "no skill or ship-auto calls a multiplexer command (C-11)" "" "$mux_cmd"
# shellcheck disable=SC2086
assert_eq "no skill or ship-auto mentions the multiplexer by name" "" "$(grep -niE 'herdr' $files)"
# shellcheck disable=SC2086
assert_eq "no project, host or model literal in the skills and ship-auto (C-1)" "" \
  "$(grep -nE 'husk|forge|/work/|/Users/|sonnet|opus|haiku|fable' $files)"
# shellcheck disable=SC2086
assert_eq "no messaging, Monitor or watchdog in the skills and ship-auto (C-2)" "" \
  "$(grep -nE 'SendMessage|claude-link|hyper msg|Monitor|stall' $files)"
# shellcheck disable=SC2086
assert_eq "no bead id or bd command in the skills" "" "$(grep -nE 'hyper-[a-z0-9]+\.[0-9]|\bbd [a-z]' $files)"

# --- ship carries what the design puts in it ---------------------------------------------
ship="$(cat "$SKILLS/ship/SKILL.md")"
assert_contains "ship has the lead rules table" "$ship" "## Lead rules"
for k in "Chain of command" "Never read code" "Answer questions yourself" "Consumer gate first" "Rulings, not hypotheses" "Spec decision is a ruling" "Respect the slots" "You only merge" "Limits are not yours"; do
  assert_contains "ship lead rule: $k" "$ship" "| $k |"
done
assert_contains "chain of command names the devs never asking the operator" "$ship" "never ask the operator"
assert_contains "never-read-code delegates to a subagent" "$ship" "Explore"
assert_contains "slots rule names hosts.<h>.slots" "$ship" 'hosts.<h>.slots'
for k in "Changes a contract" "Crosses components" "request is ambiguous" "A bug fix" "A mechanical change" "An internal refactor"; do
  assert_contains "ship heuristic cell: $k" "$ship" "$k"
done
assert_contains "ship records the spec decision as a ruling" "$ship" "Spec decision is a ruling"
assert_contains "ship has the consumer gate" "$ship" "## Consumer gate"
assert_contains "ship has the sequence" "$ship" "## Sequence"
assert_eq "ship has six peer-lead lines" "6" "$(awk '/^## Peer leads/{f=1;next} /^## /{f=0} f && /^- /{c++} END{print c+0}' "$SKILLS/ship/SKILL.md")"
assert_contains "ship has red flags" "$ship" "## Red flags"
assert_eq "ship has no remote-machine red flag" "0" "$(grep -ciE 'remote machine' "$SKILLS/ship/SKILL.md")"
unit="$(cat "$SKILLS/unit/SKILL.md")"
assert_contains "unit runs in the background" "$unit" "run_in_background: true"
assert_contains "unit looks through ship-mux read" "$unit" "ship-mux read"
for k in QUESTION BLOCKED DIALOG OPERATOR LIMIT OVER-BUDGET STUCK ERROR READY; do
  assert_contains "unit's exit table covers $k" "$unit" "$k"
done
assert_contains "land covers --abandon" "$(cat "$SKILLS/land/SKILL.md")" "--abandon"
assert_contains "kickoff covers the beads tracker" "$(cat "$SKILLS/kickoff/SKILL.md")" "beads"
assert_contains "kickoff keeps the first wave within slots" "$(cat "$SKILLS/kickoff/SKILL.md")" "slots"

# --- hyper:auto: ship-auto against a fixture ----------------------------------------------
space="$FIX/space"
mkdir -p "$space/notes"
export SHIP_SPACE_ROOT="$space"
rf="$space/notes/decisions.md"
cat > "$rf" <<'EOT'
# Decisions

## D1 — Use the existing queue
Ruling: reuse it.
Reason: already there.
By: lead
Status: binding

## D2 — An older auto ruling
Ruling: before auto was on.
Reason: older.
Alternatives: other
By: lead-auto
Status: pending-review
EOT
out="$("$AUTO" next --rulings "$rf" 2>&1)"
assert_eq "next is max + 1" "3" "$out"
"$AUTO" on --rulings "$rf" > "$FIX/on.out" 2>&1
assert_eq "on records first_ruling" "D3" "$(jq -r '.first_ruling' "$space/notes/auto.json")"
assert_ok "on records since" jq -e '.since | length > 0' "$space/notes/auto.json"

cat >> "$rf" <<'EOT'

## D3 — Spec needed for the sync seam
Ruling: yes, spec PR first.
Reason: adds a wire event, which is a contract change.
Alternatives: skip the spec and document in the PR | write the spec after the code
By: lead-auto
Status: pending-review

## D4 — Retry count for flaky fetch
Ruling: three retries,
  with a one second pause.
Reason: matches the other callers.
By: lead-auto
Status: pending-review

## D5 — Name of the new flag
Ruling: --dry-run
Reason: matches the existing flags.
Alternatives: --preview
By: lead-auto
Status: pending-review

## D6 — Operator decision recorded
Ruling: ship it.
Reason: told so.
By: operator
Status: binding
EOT

q="$FIX/q.json"
"$AUTO" questions --rulings "$rf" --out "$q"; rc=$?
assert_eq "questions exits 0" "0" "$rc"
assert_ok "questions output is JSON" jq -e . "$q"
assert_eq "one question per pending auto ruling in scope (3, not the older one, not binding ones)" "3" \
  "$(jq '[.groups[].questions[]] | length' "$q")"
assert_eq "question ids are D<n>" "D3 D4 D5" "$(jq -r '[.groups[].questions[].id] | join(" ")' "$q")"
assert_eq "every question is suggested 'keep'" "3" "$(jq '[.groups[].questions[] | select(.suggested == "keep")] | length' "$q")"
assert_eq "the suggested value is one of the options" "true" \
  "$(jq '[.groups[].questions[] | . as $x | any($x.options[]; .value == $x.suggested)] | all' "$q")"
assert_eq "every question has at least 2 options" "true" "$(jq '[.groups[].questions[] | (.options | length) >= 2] | all' "$q")"
assert_eq "option values are unique per question" "true" \
  "$(jq '[.groups[].questions[] | ([.options[].value] | length) == ([.options[].value] | unique | length)] | all' "$q")"
assert_eq "labels stay under 33 characters" "0" "$(jq '[.groups[].questions[].options[] | select((.label | length) > 32)] | length' "$q")"
assert_eq "D3 has keep + 2 alternatives" "keep alt-1 alt-2" "$(jq -r '.groups[].questions[] | select(.id == "D3") | [.options[].value] | join(" ")' "$q")"
assert_eq "D4 (no alternatives) gets an overturn option" "keep overturn" "$(jq -r '.groups[].questions[] | select(.id == "D4") | [.options[].value] | join(" ")' "$q")"
assert_eq "the summary is the reason" "adds a wire event, which is a contract change." "$(jq -r '.groups[].questions[] | select(.id == "D3") | .summary' "$q")"
assert_eq "a ruling continued on the next line is joined" "three retries, with a one second pause." \
  "$(jq -r '.groups[].questions[] | select(.id == "D4") | .options[0].description' "$q")"
assert_eq "top level has title and groups" "true" "$(jq '(.title | length > 0) and (.groups | length > 0)' "$q")"

# papiro's own builder accepts it, when papiro is installed on this machine.
build="${PAPIRO_BUILD:-}"
if [[ -z "$build" ]]; then
  for c in "$REAL_HOME"/.claude/plugins/cache/*/papiro/*/skills/papiro/scripts/build.mjs; do
    [[ -f "$c" ]] && build="$c"
  done
fi
runner=""; command -v bun >/dev/null 2>&1 && runner=bun; [[ -z "$runner" ]] && command -v node >/dev/null 2>&1 && runner=node
if [[ -z "$build" || -z "$runner" ]]; then
  skip "papiro build.mjs accepts the questions JSON" "papiro or bun/node is not installed here; shape was validated with jq above"
else
  if berr="$("$runner" "$build" "$q" "$FIX/q.html" 2>&1)"; then pass "papiro build.mjs accepts the questions JSON"; else fail "papiro build.mjs rejects the questions JSON: $berr"; fi
  assert_ok "papiro wrote the page" test -s "$FIX/q.html"
fi

assert_fails "questions exits 3 when nothing is pending" bash -c "SHIP_SPACE_ROOT='$space' '$AUTO' questions --rulings '$FIX/none.md'"

# apply a papiro-shaped reply: D3 takes alternative 2, D4 is overturned with a note, D5 is left alone.
reply="$FIX/reply.txt"
cat > "$reply" <<'EOT'
Auto rulings review: 2 changed, 1 note, 1 as suggested.
- D3 Spec needed for the sync seam: Alternative 2 (suggested: Keep the ruling).
- D4 Retry count for flaky fetch: Something else (suggested: Keep the ruling). Note: no retries, fail fast
EOT
cp "$rf" "$FIX/decisions.before"
fu="$("$AUTO" apply "$reply" --rulings "$rf")"; rc=$?
assert_eq "apply exits 0" "0" "$rc"
status_of() { awk -v t="## D$1 " 'index($0, t) == 1 {f=1; next} /^## D/ {f=0} f && /^Status:/ {sub(/^Status: */, ""); print; exit}' "$rf"; }
assert_eq "D3 is overturned by D7" "overturned (by D7)" "$(status_of 3)"
assert_eq "D4 is overturned by D8" "overturned (by D8)" "$(status_of 4)"
assert_eq "D5 (left on its suggestion) is confirmed" "confirmed" "$(status_of 5)"
assert_eq "the older auto ruling is untouched" "pending-review" "$(status_of 2)"
assert_eq "a binding ruling is untouched" "binding" "$(status_of 6)"
assert_eq "D7 carries the chosen alternative" "write the spec after the code" \
  "$(awk '/^## D7 /{f=1;next} /^## /{f=0} f && /^Ruling:/{sub(/^Ruling: */,""); print}' "$rf")"
assert_eq "D7 is By: operator" "operator" "$(awk '/^## D7 /{f=1;next} /^## /{f=0} f && /^By:/{sub(/^By: */,""); print}' "$rf")"
assert_eq "D7 is binding" "binding" "$(status_of 7)"
assert_eq "D8 carries the operator's note" "no retries, fail fast" \
  "$(awk '/^## D8 /{f=1;next} /^## /{f=0} f && /^Ruling:/{sub(/^Ruling: */,""); print}' "$rf")"
assert_contains "a follow-up line for D3" "$fu" "FOLLOW-UP D3 -> D7: write the spec after the code"
assert_contains "a follow-up line for D4" "$fu" "FOLLOW-UP D4 -> D8: no retries, fail fast"
assert_eq "no follow-up for the confirmed one" "0" "$(printf '%s\n' "$fu" | grep 'FOLLOW-UP' | grep -c 'D5')"
assert_fails "apply removes notes/auto.json" test -e "$space/notes/auto.json"
assert_eq "apply changed nothing else in the old entries" "" \
  "$(diff <(grep -vE '^Status:' "$FIX/decisions.before") <(head -n "$(wc -l < "$FIX/decisions.before")" "$rf" | grep -vE '^Status:'))"

# the markdown fallback: D<n>: <new answer>, D<n>: ok
cat > "$rf" <<'EOT'
## D1 — First
Ruling: a
Reason: r
By: lead-auto
Status: pending-review

## D2 — Second
Ruling: b
Reason: r
By: lead-auto
Status: pending-review

## D3 — Third
Ruling: c
Reason: r
By: lead-auto
Status: pending-review
EOT
printf 'D1: ok\nD2: use b2 instead\n' > "$reply"
fu="$("$AUTO" apply "$reply" --rulings "$rf")"
assert_eq "fallback: D1 confirmed" "confirmed" "$(status_of 1)"
assert_eq "fallback: D2 overturned by D4" "overturned (by D4)" "$(status_of 2)"
assert_eq "fallback: D3 (not named) confirmed" "confirmed" "$(status_of 3)"
assert_contains "fallback: follow-up carries the new answer" "$fu" "FOLLOW-UP D2 -> D4: use b2 instead"

# all as suggested
cat > "$rf" <<'EOT'
## D1 — First
Ruling: a
Reason: r
By: lead-auto
Status: pending-review
EOT
printf 'Auto rulings review: all 1 as suggested.\n' | "$AUTO" apply - --rulings "$rf" > /dev/null
assert_eq "all as suggested: confirmed" "confirmed" "$(status_of 1)"

assert_fails "apply with nothing pending exits non-zero" "$AUTO" apply "$reply" --rulings "$rf"
assert_eq "apply with nothing pending exits 3" "3" "$("$AUTO" apply "$reply" --rulings "$rf" >/dev/null 2>&1; echo $?)"
assert_eq "no subcommand is a usage error" "64" "$("$AUTO" >/dev/null 2>&1; echo $?)"

# --- ship-auto: reply validation (nothing is written for a bad reply) ----------------------
fresh() {
  cat > "$rf" <<'EOT'
# Decisions

## D1 — Cache layer
Ruling: use the in-process cache.
Reason: smallest change.
Alternatives: memcached | redis
By: lead-auto
Status: pending-review

## D2 — Keep the ruling format
Ruling: keep it as is.
Reason: nobody reads it.
By: lead-auto
Status: pending-review

## D3 — Third
Ruling: c
Reason: r
By: lead-auto
Status: pending-review
EOT
  rm -f "$space/notes/auto.json"
}
apply_reply() { printf '%s\n' "$1" > "$FIX/r.txt"; "$AUTO" apply "$FIX/r.txt" --rulings "$rf" > "$FIX/apply.out" 2> "$FIX/apply.err"; echo $?; }
unchanged() { [[ "$(cat "$rf")" == "$(cat "$FIX/frozen")" ]] && echo yes || echo no; }

fresh; cp "$rf" "$FIX/frozen"
assert_eq "title text does not decide the answer: 'Alternative 1 for the cache' + Something else is an overturn" "0" \
  "$(apply_reply '- D1 Alternative 1 for the cache: Something else (suggested: Keep the ruling). Note: use neither')"
assert_eq "  ... recorded as overturned, with the note, not memcached" "overturned (by D4)" "$(status_of 1)"
assert_eq "  ... the new ruling is the note" "use neither" "$(awk '/^## D4 /{f=1;next} /^## /{f=0} f && /^Ruling:/{sub(/^Ruling: */,""); print}' "$rf")"
fresh
assert_eq "'Keep the ruling format' + Overturn is an overturn" "0" \
  "$(apply_reply '- D2 Keep the ruling format: Overturn (suggested: Keep the ruling). Note: change it')"
assert_eq "  ... recorded as overturned, not confirmed" "overturned (by D4)" "$(status_of 2)"
fresh; cp "$rf" "$FIX/frozen"
assert_eq "an unknown id (D33) fails the reply" "1" "$(apply_reply '- D33 Nope: Keep the ruling')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
assert_contains "  ... the bad line is listed" "$(cat "$FIX/apply.err")" "D33"
assert_eq "a line with no colon ('D2 looks fine to me') fails" "1" "$(apply_reply 'D2 looks fine to me')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
assert_eq "an unrecognised answer fails" "1" "$(apply_reply '- D1 Cache layer: Maybe')"
assert_eq "an Alternative out of range fails" "1" "$(apply_reply '- D1 Cache layer: Alternative 3')"
assert_eq "an Alternative on a ruling without alternatives fails" "1" "$(apply_reply '- D3 Third: Alternative 1')"
assert_eq "a ruling answered twice fails" "1" "$(apply_reply "$(printf -- '- D1 Cache layer: Keep the ruling\n- D1 Cache layer: Overturn')")"
assert_eq "one bad line among good ones fails the lot" "1" "$(apply_reply "$(printf -- '- D1 Cache layer: Alternative 1\n- D2 Keep the ruling format: Maybe')")"
assert_eq "  ... nothing written (D1 not overturned)" "yes" "$(unchanged)"
assert_eq "  ... every bad line is listed" "2" "$(printf -- '- D9 x: Keep the ruling\n- D8 y: Keep the ruling\n' > "$FIX/r.txt"; "$AUTO" apply "$FIX/r.txt" --rulings "$rf" 2>&1 | grep -c 'not a pending')"
assert_eq "an empty fallback answer fails" "1" "$(apply_reply 'D1:')"
awk '/^## D1 /{f=1} /^## D2 /{f=0} f && /^Status:/{print "Status: confirmed"; next} {print}' "$rf" > "$FIX/d1done.md"; cp "$FIX/d1done.md" "$rf"; cp "$rf" "$FIX/frozen"
assert_eq "a ruling that is not pending (D1 already confirmed) fails" "1" "$(apply_reply 'D1: ok')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
fresh
assert_eq "fallback 'D1: Keep the ruling' is a confirm" "0" "$(apply_reply 'D1: Keep the ruling')"
assert_eq "  ... confirmed" "confirmed" "$(status_of 1)"
assert_eq "  ... and D2, D3 (not named) are confirmed too" "confirmed confirmed" "$(status_of 2) $(status_of 3)"
fresh
assert_eq "papiro 'Keep the ruling' with a note is a confirm" "0" "$(apply_reply '- D2 Keep the ruling format: Keep the ruling (suggested: Keep the ruling). Note: but tell the docs team')"
assert_eq "  ... confirmed" "confirmed" "$(status_of 2)"
assert_contains "  ... the note is printed for the lead" "$(cat "$FIX/apply.out")" "NOTE D2: but tell the docs team"
fresh
assert_eq "title containing ': ' still parses" "0" "$(apply_reply '- D1 Cache layer: which one: Alternative 2 (suggested: Keep the ruling).')"
assert_eq "  ... took alternative 2 (redis)" "redis" "$(awk '/^## D4 /{f=1;next} /^## /{f=0} f && /^Ruling:/{sub(/^Ruling: */,""); print}' "$rf")"

# --- ship-auto: a trailing heading, CRLF, on twice, default path, --markdown, usage -------------
fresh
printf '\n## Notes\nStatus: scratch\nsome text\n' >> "$rf"
apply_reply 'D1: ok' >/dev/null
assert_eq "a '## Notes' heading after the last ruling is not part of it (Status line untouched)" "Status: scratch" "$(grep -n '^Status: scratch' "$rf" | cut -d: -f2-)"
assert_eq "  ... D3 (the last ruling) is confirmed, not mangled" "confirmed" "$(status_of 3)"
fresh
printf '\n## Notes\nStatus: pending-review\nBy: lead-auto\n' >> "$rf"
assert_eq "  ... the heading is not read as a ruling: 3 questions" "3" "$("$AUTO" questions --rulings "$rf" | jq '[.groups[].questions[]] | length')"
fresh
sed 's/$/\r/' "$rf" > "$FIX/crlf.md"; cp "$FIX/crlf.md" "$rf"
assert_eq "CRLF file: three pending rulings are found" "3" "$("$AUTO" questions --rulings "$rf" | jq '[.groups[].questions[]] | length')"
assert_eq "CRLF file: alternatives have no stray CR" "memcached" "$("$AUTO" questions --rulings "$rf" | jq -r '.groups[].questions[0].options[1].description')"
apply_reply 'D1: ok' >/dev/null
assert_eq "CRLF file: D1 confirmed" "confirmed" "$(status_of 1 | tr -d '\r')"
assert_eq "CRLF file: line endings kept on the Status line" "Status: confirmed" "$(grep '^Status: confirmed' "$rf" | head -n 1 | tr -d '\r')"
assert_ok "CRLF file: the Status line still ends in CR" grep -q $'^Status: confirmed\r$' "$rf"

rm -f "$space/notes/auto.json"; fresh
"$AUTO" on --rulings "$rf" >/dev/null 2>&1
first="$(jq -r .first_ruling "$space/notes/auto.json")"
printf '\n## D4 — later\nRuling: x\nBy: lead-auto\nStatus: pending-review\n' >> "$rf"
"$AUTO" on --rulings "$rf" > "$FIX/on2.out" 2>/dev/null
assert_eq "on twice keeps first_ruling" "$first" "$(jq -r .first_ruling "$space/notes/auto.json")"
assert_eq "on twice prints the existing file" "$first" "$(jq -r .first_ruling "$FIX/on2.out")"

fresh
md="$("$AUTO" questions --markdown --rulings "$rf")"
assert_contains "markdown list names D1" "$md" "### D1 — Cache layer"
assert_contains "markdown list shows the alternatives" "$md" "memcached | redis"
assert_contains "markdown list says how to reply" "$md" 'D<n>: <new answer>'
assert_eq "markdown list covers all three" "3" "$(printf '%s\n' "$md" | grep -c '^### D')"

# the default rulings path comes from ship-config; a failing config is an error, not a guess
if command -v yq >/dev/null 2>&1 && yq --version 2>&1 | grep -q mikefarah; then
  assert_eq "no --rulings: the configured default path is read" "3" "$("$AUTO" questions | jq '[.groups[].questions[]] | length')"
  mkdir -p "$space/.hyper"; printf 'rulings: [broken\n' > "$space/.hyper/ship.yml"
  assert_eq "no --rulings and a broken config: exit 1" "1" "$("$AUTO" questions >/dev/null 2>&1; echo $?)"
  rm -f "$space/.hyper/ship.yml"
else
  skip "ship-auto reads the default rulings path through ship-config" "mikefarah yq v4 is not installed here"
fi

assert_eq "an unexpected argument is a usage error (64)" "64" "$("$AUTO" next extra >/dev/null 2>&1; echo $?)"
assert_eq "an unknown option is a usage error (64)" "64" "$("$AUTO" next --nope >/dev/null 2>&1; echo $?)"
assert_eq "--out outside questions is a usage error (64)" "64" "$("$AUTO" next --out x >/dev/null 2>&1; echo $?)"
assert_eq "an unknown subcommand is a usage error (64)" "64" "$("$AUTO" frob >/dev/null 2>&1; echo $?)"

# --- ship-auto: a reply that is not one of the two shapes is refused ------------------------
fresh; cp "$rf" "$FIX/frozen"
assert_eq "garbage text is refused" "1" "$(apply_reply 'thanks, looks good!')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
assert_contains "  ... the message shows the expected shape" "$(cat "$FIX/apply.err")" "D<n>: <new answer>"
assert_eq "an empty reply is refused" "1" "$(apply_reply '')"
assert_eq "a blank-lines reply is refused" "1" "$(apply_reply "$(printf '\n  \n')")"
assert_eq "a header naming the wrong sheet is refused" "1" "$(apply_reply 'zsh triage: all 3 as suggested.')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
assert_eq "the right header with a changed count but no lines is refused" "1" "$(apply_reply 'Auto rulings review: 2 changed, 1 as suggested.')"
assert_eq "  ... nothing written" "yes" "$(unchanged)"
assert_eq "the one-line all-as-suggested header is accepted" "0" "$(apply_reply 'Auto rulings review: all 3 as suggested.')"
assert_eq "  ... and confirms all three" "confirmed confirmed confirmed" "$(status_of 1) $(status_of 2) $(status_of 3)"
fresh
assert_eq "the header after leading blank lines is accepted" "0" "$(apply_reply "$(printf '\nAuto rulings review: all 3 as suggested.')")"

finish
