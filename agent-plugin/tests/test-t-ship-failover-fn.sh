#!/usr/bin/env bash
# shellcheck disable=SC2034  # globals read by the lifted functions
# Row T (ship failover), function level: preflight routing (pick_model), the quota tap, the limit
# patterns, and the reactive-failover functions of ship-loop, one at a time. No driver run, no
# multiplexer, no stub agent: the driver's functions are lifted out of scripts/ship/ship-loop with
# `loop_fn` (the script is sourced; its main guard keeps the driver from running) and called against a scripted `mux`.
# The journeys that need a whole unit (preflight swap, LIMIT park and restart, reactive failover with
# takeover, limit with nothing to fail over to, limit inside a blocked dialog) stay in
# test-t-ship-failover.sh.
#
# Cases:
#   pick_model     a 97% seven_day snapshot skips both claude entries of
#                  [sonnet, opus, zai/glm-5.3] and picks pi (two preflight failover files);
#                  a stale snapshot, a resets_at in the past, no snapshot and a snapshot of
#                  another account skip nothing; pi is never skipped (C-15); limited.json;
#                  every entry skipped -> 2 with PICK_RESETS_AT; --dry writes nothing
#   quota tap      the original status-line command's output is printed unchanged; the snapshot
#                  is written only when rate_limits is present
#   patterns       the default limit patterns: what fires, what is only quoted; the takeover prompt
#                  does not trip the pi pattern; limit_word; limit_hit
#   reactive       failover_on_limit (kind, key, restart, takeover text, failing close, other model,
#                  park), stamp_failovers, write_status (summariser argv, failure modes, git facts),
#                  scrub_status, await_file keeping the budget clock across a failover
#
# Every group names the break it catches in a "mutation" comment where it is not a plain move.

REAL_HOME="$HOME"
_mt() { if [[ -e "$1" ]]; then stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; else echo absent; fi; }
REAL_BEFORE="$(_mt "$REAL_HOME/.cache/hyper")"

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

TAP="$SCRIPTS_DIR/ship/ship-quota-tap"
SCHEMAS_DIR="$SCRIPTS_DIR/ship/schemas"
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"

export SHIP_QUOTA_DIR="$FIX/quota"
unset CLAUDE_CONFIG_DIR SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
mkdir -p "$SHIP_QUOTA_DIR"

ts() { echo $(( $(date +%s) + $1 )); }                           # epoch seconds, offset from now
iso() { jq -nr --argjson t "$(ts "$1")" '$t | todate'; }          # ISO-8601 UTC, offset from now
# snap <five pct|-> <seven pct|-> <age s> <resets in s> [account] — an account snapshot, written as the tap does.
snap() {
  local acct="${5:-default}"
  jq -nc --arg a "$acct" --arg at "$(iso "-$3")" --arg f "$1" --arg s "$2" --argjson r "$(ts "$4")" '
    def w($k; $p): if $p == "-" then {} else {($k): {used_percentage: ($p | tonumber), resets_at: $r}} end;
    {account: $a, at: $at, rate_limits: (w("five_hour"; $f) + w("seven_day"; $s))}' >"$SHIP_QUOTA_DIR/claude-$acct.json"
}
no_quota() { rm -f "$SHIP_QUOTA_DIR"/*.json; }
cfg() { # models JSON for one list: cfg <key> <json list> [threshold] [max age]
  SHIP_CONFIG_JSON="$(jq -nc --arg k "$1" --argjson l "$2" --argjson t "${3:-95}" --argjson a "${4:-30}" \
    '{models: {($k): $l}, quota: {threshold_pct: $t, max_age_min: $a}}')"
  export SHIP_CONFIG_JSON
}

# --- pick_model ----------------------------------------------------------------------------------------

STATE="$FIX/state-a"; mkdir -p "$STATE"; export STATE
fcount() { ls "$STATE"/failover-*.json 2>/dev/null | wc -l | tr -d ' '; }
fclear() { rm -f "$STATE"/failover-*.json; }
# pick <key> [agent] [stage] [round] — runs pick_model in this shell; log lines go to $FIX/pick.log
pick() { PICK_RC=0; pick_model "$@" 2>>"$FIX/pick.log" || PICK_RC=$?; }

LIST='["sonnet","opus","zai/glm-5.3"]'
cfg dev "$LIST"
snap - 97 60 3600
fclear; pick dev t1-dev develop
assert_eq "97% seven_day: pick_model returns 0" 0 "$PICK_RC"
assert_eq "97% seven_day: both claude entries are skipped, pi starts" "zai/glm-5.3" "$PICK_MODEL"
assert_eq "97% seven_day: two preflight failover files" 2 "$(fcount)"
assert_eq "failover-1: from sonnet" sonnet "$(jq -r .from "$STATE/failover-1.json")"
assert_eq "failover-1: to opus" opus "$(jq -r .to "$STATE/failover-1.json")"
assert_eq "failover-2: from opus" opus "$(jq -r .from "$STATE/failover-2.json")"
assert_eq "failover-2: to the pi entry" zai/glm-5.3 "$(jq -r .to "$STATE/failover-2.json")"
assert_eq "failover-1: reason preflight" preflight "$(jq -r .reason "$STATE/failover-1.json")"
assert_eq "failover-2: reason preflight" preflight "$(jq -r .reason "$STATE/failover-2.json")"
assert_eq "failover-1: stage, round and agent" "develop 0 t1-dev" \
  "$(jq -r '"\(.stage) \(.round) \(.agent)"' "$STATE/failover-1.json")"
assert_eq "failover-1: the quota block carries the percentage" 97 "$(jq -r .quota.seven_day "$STATE/failover-1.json")"
assert_eq "failover-1: the quota block carries resets_at" "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" \
  "$(jq -r .quota.resets_at "$STATE/failover-1.json")"
assert_eq "failover-1/2: a quota hit is an account limit" "account account" "$(jq -r .limit_kind "$STATE/failover-1.json") $(jq -r .limit_kind "$STATE/failover-2.json")"
assert_ok "failover-1 matches the failover schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$STATE/failover-1.json"
assert_ok "failover-2 matches the failover schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$STATE/failover-2.json"
assert_eq "two FAILOVER log lines" 2 "$(grep -c 'FAILOVER preflight develop' "$FIX/pick.log")"

# a second walk numbers on from the first
pick dev t1-dev develop
assert_eq "a second walk adds files (4)" 4 "$(fcount)"

# agent name suffix and --dry
fclear; pick --dry dev
assert_eq "--dry: still picks the pi entry" "zai/glm-5.3" "$PICK_MODEL"
assert_eq "--dry: writes no failover file" 0 "$(fcount)"

# five_hour alone, and the threshold is inclusive
snap 95 10 60 3600
fclear; pick dev; assert_eq "five_hour exactly at the threshold skips claude" "zai/glm-5.3" "$PICK_MODEL"
snap 94 94 60 3600
fclear; pick dev; assert_eq "just below the threshold skips nothing" sonnet "$PICK_MODEL"
assert_eq "below the threshold: no failover file" 0 "$(fcount)"
cfg dev "$LIST" 90
snap 91 10 60 3600
fclear; pick dev; assert_eq "quota.threshold_pct is honoured" "zai/glm-5.3" "$PICK_MODEL"
cfg dev "$LIST"

# stale snapshot
snap - 97 3600 3600
fclear; pick dev
assert_eq "stale snapshot (60 min old, max 30): nothing skipped" sonnet "$PICK_MODEL"
assert_eq "stale snapshot: no failover file" 0 "$(fcount)"
cfg dev "$LIST" 95 120
fclear; pick dev
assert_eq "quota.max_age_min is honoured: the same snapshot is fresh at 120" "zai/glm-5.3" "$PICK_MODEL"
cfg dev "$LIST"

# resets_at in the past
snap - 97 60 -60
fclear; pick dev
assert_eq "resets_at in the past: nothing skipped" sonnet "$PICK_MODEL"
assert_eq "resets_at in the past: no failover file" 0 "$(fcount)"
# one window hit but already reset, the other fine
jq -c --argjson r "$(ts 3600)" '.rate_limits.five_hour = {used_percentage: 50, resets_at: $r}' "$SHIP_QUOTA_DIR/claude-default.json" >"$FIX/s.json" \
  && mv "$FIX/s.json" "$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "a hit window that already reset does not count" sonnet "$PICK_MODEL"

# no resets_at at all: cannot tell it is in the future, so no skip
jq -c 'del(.rate_limits.seven_day.resets_at)' "$SHIP_QUOTA_DIR/claude-default.json" >"$FIX/s.json" && mv "$FIX/s.json" "$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "a window without resets_at is not skipped" sonnet "$PICK_MODEL"

# resets_at as ISO and as milliseconds
snap - 97 60 3600
jq -c --arg r "$(iso 3600)" '.rate_limits.seven_day.resets_at = $r' "$SHIP_QUOTA_DIR/claude-default.json" >"$FIX/s.json" && mv "$FIX/s.json" "$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "an ISO resets_at works" "zai/glm-5.3" "$PICK_MODEL"
jq -c --argjson r "$(( $(ts 3600) * 1000 ))" '.rate_limits.seven_day.resets_at = $r' "$SHIP_QUOTA_DIR/claude-default.json" >"$FIX/s.json" && mv "$FIX/s.json" "$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "a millisecond resets_at works" "zai/glm-5.3" "$PICK_MODEL"

# no snapshot, empty snapshot, garbage snapshot
no_quota
fclear; pick dev
assert_eq "no snapshot: nothing skipped" sonnet "$PICK_MODEL"
assert_eq "no snapshot: no failover file" 0 "$(fcount)"
: >"$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "empty snapshot: nothing skipped" sonnet "$PICK_MODEL"
printf 'not json' >"$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "garbage snapshot: nothing skipped" sonnet "$PICK_MODEL"
printf '{"account":"default","at":"yesterday","rate_limits":{"seven_day":{"used_percentage":99,"resets_at":1}}}' >"$SHIP_QUOTA_DIR/claude-default.json"
fclear; pick dev; assert_eq "unreadable snapshot time: nothing skipped" sonnet "$PICK_MODEL"
no_quota

# a snapshot of another account does not apply
snap - 99 60 3600 other
fclear; pick dev; assert_eq "another account's snapshot is ignored" sonnet "$PICK_MODEL"
CLAUDE_CONFIG_DIR="/some/where/.claude-alt" snap - 99 60 3600 "_some_where_.claude-alt"
CLAUDE_CONFIG_DIR="/some/where/.claude-alt"; export CLAUDE_CONFIG_DIR
fclear; pick dev
assert_eq "CLAUDE_CONFIG_DIR names the account (sanitised) and its snapshot applies" "zai/glm-5.3" "$PICK_MODEL"
assert_eq "the account name is the sanitised config dir" "_some_where_.claude-alt" "$(ship_quota_account)"
unset CLAUDE_CONFIG_DIR
assert_eq "no CLAUDE_CONFIG_DIR: the account is default" default "$(ship_quota_account)"
no_quota

# pi is never skipped (C-15): not by a snapshot, not by limited.json
snap 100 100 60 3600
jq -nc --argjson u "$(ts 3600)" '{accounts: {default: {until: $u}}, models: {"zai/glm-5.3": {until: $u}, "glm": {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
cfg dev '["zai/glm-5.3"]'
fclear; pick dev
assert_eq "C-15: a lone pi entry is picked with a 100% snapshot and limited.json" "zai/glm-5.3" "$PICK_MODEL"
assert_eq "C-15: and no failover file is written" 0 "$(fcount)"
cfg dev '["glm/x","sonnet"]'
fclear; pick dev
assert_eq "C-15: a pi entry first in the list is picked" "glm/x" "$PICK_MODEL"
cfg dev "$LIST"
no_quota

# every entry skipped -> 2
snap - 97 60 3600
cfg dev '["sonnet","opus"]'
fclear; pick dev t2-dev develop
assert_eq "every entry skipped: returns 2" 2 "$PICK_RC"
assert_eq "every entry skipped: PICK_MODEL is empty" "" "$PICK_MODEL"
assert_eq "every entry skipped: a failover file per entry" 2 "$(fcount)"
assert_eq "every entry skipped: the last one has nothing to go to" "" "$(jq -r .to "$STATE/failover-2.json")"
assert_ok "every entry skipped: the last record matches the schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$STATE/failover-2.json"
assert_eq "every entry skipped: PICK_RESETS_AT is the window's reset" "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$PICK_RESETS_AT"
fclear; pick --dry dev
assert_eq "--dry: also returns 2 when nothing is usable" 2 "$PICK_RC"
assert_eq "--dry exhausted: writes nothing" 0 "$(fcount)"
no_quota

# limited.json: by model, by account, expired, ISO
cfg dev "$LIST"
jq -nc --argjson u "$(ts 3600)" '{models: {opus: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
fclear; pick dev
assert_eq "limited.json: sonnet is still used when only opus is limited" sonnet "$PICK_MODEL"
cfg dev '["opus","sonnet"]'
fclear; pick dev
assert_eq "limited.json: only the limited model is skipped" sonnet "$PICK_MODEL"
assert_eq "limited.json: one failover file" 1 "$(fcount)"
assert_eq "limited.json: it names the skipped model" opus "$(jq -r .from "$STATE/failover-1.json")"
assert_eq "limited.json: a model entry is a model limit" model "$(jq -r .limit_kind "$STATE/failover-1.json")"
assert_eq "limited.json: it has no quota block" null "$(jq -r '.quota // null' "$STATE/failover-1.json")"
assert_ok "limited.json: the record matches the schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$STATE/failover-1.json"
cfg dev "$LIST"
jq -nc --arg u "$(iso 3600)" '{accounts: {default: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
fclear; pick dev
assert_eq "limited.json: a limited account skips every claude entry (ISO until)" "zai/glm-5.3" "$PICK_MODEL"
assert_eq "limited.json: two failover files" 2 "$(fcount)"
assert_eq "limited.json: an account entry is an account limit" "account account" "$(jq -r .limit_kind "$STATE/failover-1.json") $(jq -r .limit_kind "$STATE/failover-2.json")"
cfg dev '["sonnet","opus"]'
fclear; pick dev
assert_eq "limited.json: exhausted list returns 2" 2 "$PICK_RC"
assert_eq "limited.json: PICK_RESETS_AT is the until" "$(jq -r '.accounts.default.until' "$SHIP_QUOTA_DIR/limited.json" | jq -R 'fromdateiso8601' )" "$PICK_RESETS_AT"
cfg dev "$LIST"
jq -nc --argjson u "$(ts -60)" '{accounts: {default: {until: $u}}, models: {sonnet: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
fclear; pick dev; assert_eq "limited.json: an expired until skips nothing" sonnet "$PICK_MODEL"
jq -nc --argjson u "$(ts 3600)" '{accounts: {elsewhere: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
fclear; pick dev; assert_eq "limited.json: another account is ignored" sonnet "$PICK_MODEL"
printf 'garbage' >"$SHIP_QUOTA_DIR/limited.json"
fclear; pick dev; assert_eq "limited.json: garbage skips nothing" sonnet "$PICK_MODEL"
no_quota

# the snapshot and limited.json combine: limited.json wins the reason, the rest still walks
snap - 97 60 3600
jq -nc --argjson u "$(ts 7200)" '{models: {sonnet: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
cfg dev '["sonnet","opus"]'
fclear; pick dev
assert_eq "both sources: exhausted" 2 "$PICK_RC"
assert_eq "both sources: the earliest moment an entry is usable again wins" "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$PICK_RESETS_AT"
no_quota

# errors
cfg dev '[]'
fclear; pick dev; assert_eq "an empty list is an error (1)" 1 "$PICK_RC"
cfg dev "$LIST"
pick nosuchlist; assert_eq "an unknown list is an error (1)" 1 "$PICK_RC"
pick; assert_eq "no list key is an error (1)" 1 "$PICK_RC"

# nothing is written without a state dir
unset STATE
snap - 97 60 3600
pick dev; assert_eq "without STATE the walk still picks" "zai/glm-5.3" "$PICK_MODEL"
no_quota
STATE="$FIX/state-a"; export STATE

# --- the quota tap ------------------------------------------------------------------------------------
HELP_OUT="$(bash "$TAP" --help </dev/null 2>&1)"; HELP_RC=$?
assert_eq "tap --help exits 0 without reading stdin" 0 "$HELP_RC"
assert_contains "tap --help prints the header comment" "$HELP_OUT" "ship-quota-tap — Claude Code status-line command"
assert_contains "tap -h prints the usage too" "$(bash "$TAP" -h </dev/null 2>&1)" "Usage"

# A fixture original status-line command: reads stdin, prints a line with ANSI and a trailing blank line.
cat >"$FIX/orig.sh" <<'EOF'
#!/bin/sh
in="$(cat)"
printf '\033[1mmodel:\033[0m %s | in=%s\n\n' "${ORIG_TAG:-x}" "$(printf '%s' "$in" | wc -c | tr -d ' ')"
exit "${ORIG_RC:-0}"
EOF
chmod +x "$FIX/orig.sh"
WITH='{"model":{"id":"opus"},"rate_limits":{"five_hour":{"used_percentage":41.5,"resets_at":1893456000},"seven_day":{"used_percentage":90,"resets_at":1893999999}}}'
WITHOUT='{"model":{"id":"opus"},"workspace":{"current_dir":"/x"}}'
tap() { printf '%s' "$1" | bash "$TAP" "${@:2}"; }

printf '%s' "$WITHOUT" | sh "$FIX/orig.sh" >"$FIX/want-without.out"
tap "$WITHOUT" --original "$FIX/orig.sh" >"$FIX/got.out"; TAP_RC=$?
assert_eq "tap: the original's output is printed unchanged (no rate_limits)" 0 "$(cmp -s "$FIX/want-without.out" "$FIX/got.out"; echo $?)"
assert_eq "tap: exit 0 when the original exits 0" 0 "$TAP_RC"
assert_eq "tap: no rate_limits, no snapshot written" "absent" "$([[ -e "$SHIP_QUOTA_DIR/claude-default.json" ]] && echo present || echo absent)"
assert_eq "tap: no stray temp file either" 0 "$(ls -A "$SHIP_QUOTA_DIR" | wc -l | tr -d ' ')"

printf '%s' "$WITH" | sh "$FIX/orig.sh" >"$FIX/want-with.out"
tap "$WITH" --original "$FIX/orig.sh" >"$FIX/got.out"
assert_eq "tap: the original's output is printed unchanged (with rate_limits)" 0 "$(cmp -s "$FIX/want-with.out" "$FIX/got.out"; echo $?)"
assert_eq "tap: the original saw the whole stdin" "in=$(printf '%s' "$WITH" | wc -c | tr -d ' ')" "$(sed -n 's/.*\(in=[0-9]*\).*/\1/p' "$FIX/got.out")"
assert_ok "tap: rate_limits present, snapshot written" test -s "$SHIP_QUOTA_DIR/claude-default.json"
assert_eq "tap: snapshot account" default "$(jq -r .account "$SHIP_QUOTA_DIR/claude-default.json")"
assert_eq "tap: snapshot keeps rate_limits as given" "$(jq -cS .rate_limits <<<"$WITH")" "$(jq -cS .rate_limits "$SHIP_QUOTA_DIR/claude-default.json")"
assert_eq "tap: snapshot holds only account, at and rate_limits" '["account","at","rate_limits"]' "$(jq -c 'keys' "$SHIP_QUOTA_DIR/claude-default.json")"
assert_eq "tap: snapshot time is now (within a minute)" true \
  "$(jq -r --argjson n "$(date +%s)" '((.at | fromdateiso8601) as $t | ($n - $t) >= 0 and ($n - $t) < 60)' "$SHIP_QUOTA_DIR/claude-default.json")"
assert_eq "tap: no temp file is left behind" 1 "$(ls -A "$SHIP_QUOTA_DIR" | wc -l | tr -d ' ')"

# A later status line without rate_limits leaves the snapshot alone.
cp "$SHIP_QUOTA_DIR/claude-default.json" "$FIX/snap.keep"
tap "$WITHOUT" --original "$FIX/orig.sh" >/dev/null
assert_eq "tap: a later payload without rate_limits leaves the snapshot untouched" 0 "$(cmp -s "$FIX/snap.keep" "$SHIP_QUOTA_DIR/claude-default.json"; echo $?)"
tap '{"rate_limits":null}' --original "$FIX/orig.sh" >/dev/null
assert_eq "tap: rate_limits null counts as absent" 0 "$(cmp -s "$FIX/snap.keep" "$SHIP_QUOTA_DIR/claude-default.json"; echo $?)"

# The original gets exactly the bytes, including trailing newlines, and its exit status comes back.
printf '%s\n\n' "$WITH" | bash "$TAP" --original 'cat' >"$FIX/got.out"
printf '%s\n\n' "$WITH" >"$FIX/want.out"
assert_eq "tap: stdin reaches the original byte for byte (trailing newlines kept)" 0 "$(cmp -s "$FIX/want.out" "$FIX/got.out"; echo $?)"
ORIG_RC=3 tap "$WITHOUT" --original "$FIX/orig.sh" >/dev/null; TAP_RC=$?
assert_eq "tap: the original's exit status is the tap's" 3 "$TAP_RC"
assert_eq "tap: an original given as a shell string with quotes" "it's|a b" "$(tap "$WITHOUT" --original "printf '%s|%s' \"it's\" 'a b'")"

# Not JSON, empty, no original.
assert_eq "tap: non-JSON stdin passes through" "raw text" "$(tap 'raw text' --original 'cat')"
assert_eq "tap: empty stdin is fine" "" "$(printf '' | bash "$TAP" --original 'cat')"
assert_eq "tap: without --original it prints nothing" "" "$(tap "$WITH")"
tap "$WITH" >/dev/null; TAP_RC=$?
assert_eq "tap: without --original it exits 0" 0 "$TAP_RC"

# Account naming and an unwritable quota dir.
rm -f "$SHIP_QUOTA_DIR"/*.json
CLAUDE_CONFIG_DIR="$FIX/cfg dir/.claude" tap "$WITH" --original 'echo ok' >/dev/null
assert_eq "tap: CLAUDE_CONFIG_DIR picks the snapshot name (sanitised)" 1 "$(ls "$SHIP_QUOTA_DIR"/claude-*.json | wc -l | tr -d ' ')"
_acct="$(CLAUDE_CONFIG_DIR="$FIX/cfg dir/.claude" ship_quota_account)"
assert_ok "tap: the file is claude-<account>.json" test -s "$SHIP_QUOTA_DIR/claude-$_acct.json"
assert_eq "tap: the account has no slash or space" "" "$(printf '%s' "$_acct" | tr -d 'A-Za-z0-9._-')"
printf 'x' >"$FIX/not-a-dir"
assert_eq "tap: an unwritable quota dir does not change the output" "ok" "$(SHIP_QUOTA_DIR="$FIX/not-a-dir/q" tap "$WITH" --original 'echo ok')"
# The default dir is under HOME.
(unset SHIP_QUOTA_DIR; tap "$WITH" --original 'true')
assert_ok "tap: the default quota dir is ~/.cache/hyper/quota" test -s "$HOME/.cache/hyper/quota/claude-default.json"

# Round trip: what the tap wrote is what pick_model reads.
rm -f "$SHIP_QUOTA_DIR"/*.json
FUTURE="$(ts 7200)"
tap "$(jq -c --argjson r "$FUTURE" '.rate_limits.seven_day.resets_at = $r | .rate_limits.seven_day.used_percentage = 97' <<<"$WITH")" >/dev/null
cfg dev "$LIST"; fclear; pick dev
assert_eq "round trip: a tapped 97% snapshot makes pick_model skip claude" "zai/glm-5.3" "$PICK_MODEL"
rm -f "$SHIP_QUOTA_DIR"/*.json

# --- the limit patterns ---------------------------------------------------------------------------------
# Quoted limit wording is not a limit: the default patterns are anchored to the start of a line.
CL_RE="$(sed -n "s/^    claude: '\(.*\)'$/\1/p" "$SCRIPTS_DIR/../skills/ship/defaults.yml" | head -n 1)"
AUTH_RE="$(sed -n "s/^    claude: '\(.*\)'$/\1/p" "$SCRIPTS_DIR/../skills/ship/defaults.yml" | tail -n 1)"
PI_RE="$(sed -n "s/^    pi: '\(.*\)'$/\1/p" "$SCRIPTS_DIR/../skills/ship/defaults.yml")"
NB="$(printf '\302\240')"   # a no-break space
REAL_CL="  ⎿ ${NB}You've hit your weekly limit · resets Oct 24, 4pm (America/Sao_Paulo)"   # the line Claude Code prints
m() { jq -Rn --arg re "$1" --arg l "$2" '$l | test($re)'; }
for l in "You've hit your Sonnet limit · resets 4pm" "You’ve hit your limit" "│ You've hit your weekly limit" "● YOU'VE HIT YOUR OPUS LIMIT" "You've hit your limit ∙ resets 4pm" "You've hit your limit" "  You've hit your weekly limit" "$REAL_CL"; do
  assert_eq "claude pattern fires on: $l" true "$(m "$CL_RE" "$l")"
done
# shellcheck disable=SC1111  # curly quotes are test data
for l in "Summary: limit_hit now matches \"You've hit your weekly limit\" and more" "+ You've hit your Sonnet limit" "│ + You've hit your Sonnet limit" "- You've hit your limit" "> You've hit your limit" "\"You've hit your weekly limit\" in the output" "12 + You've hit your limit" \
  "  You've hit your weekly limit fails over…" "You've hit your weekly limit. What do you want to do?" "“You've hit your limit”" "‘You’ve hit your limit’" "│ x You've hit your limit" "You've hit your limit and then more" "You've hit your limit · resumes" \
  "\"You've hit your weekly limit\" wording in the output is fine" "  You've hit your weekly limit fails over the unit when the" "  You've hit your weekly limit is quoted in prose"; do
  assert_eq "claude pattern ignores: $l" false "$(m "$CL_RE" "$l")"
done
for l in "Error: 429 Too Many Requests" "429 status code (no body)" "Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}" "Error: RESOURCE_EXHAUSTED: quota" "429 RESOURCE_EXHAUSTED: Resource has been exhausted" "Error: 429 RESOURCE_EXHAUSTED: Resource has been exhausted" "✗ too many requests" "Error: Too Many Requests" "429 Too Many Requests" "{\"error\":{\"code\":\"1302\",\"message\":\"Rate limit reached for requests\"}}" "{\"error\":{\"code\":1308,\"message\":\"x\"}}" "Usage limit reached for 5 hour" "Rate limit reached" "You exceeded your current quota, please check your plan" "Error: You exceeded your current quota" "│ Error: 429 status code" "error: status code 429"; do
  assert_eq "pi pattern fires on: $l" true "$(m "$PI_RE" "$l")"
done
for l in "retry with backoff when the API answers 429 Too Many Requests" "ship-loop:429" "src/x.sh:429: handler" "// retry on a rate limit" "- Error: 429 Too Many Requests" "+ Rate limit reached" "the code 1302 means something" "> RESOURCE_EXHAUSTED" \
  "Too many requests are retried" "too many requests" "RESOURCE_EXHAUSTED handling" "resource_exhausted" "status code" "status code 429 is retried" "Error handling: too many requests" "Handles RESOURCE_EXHAUSTED: Resource has been exhausted" \
  "rate limit reached errors are now retried with backoff" "quota exceeded is mapped to a retryable error" "429 status code handling added" "Error: Too Many Requests is now retried" "usage limit reached is logged" \
  "Summary: added retry with backoff when the API answers 429 Too Many Requests" "the finding at ship-loop:429 and src/x.sh:429: handler" "usage limit docs"; do
  assert_eq "pi pattern ignores: $l" false "$(m "$PI_RE" "$l")"
done

# The login-expired pattern: whole-line Claude Code messages only; text that merely mentions a login never matches, and no
# usage-limit text does either (and the limit pattern ignores login text).
for l in "OAuth token revoked · Please run /login" "Login expired · Please run /login" "  ⎿ ${NB}Login expired · Please run /login" "● OAuth token revoked · Please run /login" "Not logged in · Please run /login" \
  "Please run /login" "please run /login." "OAuth token has expired · Please run /login" "Invalid API key · Please run /login" "Session expired · Please run /login" "OAuth token revoked" "Login expired" "│ Login expired · Please run /login │"; do
  assert_eq "auth pattern fires on: $l" true "$(m "$AUTH_RE" "$l")"
done
for l in "You've hit your weekly limit · resets Oct 24, 4pm" "Error: 429 Too Many Requests" "I added a login page and a /login route" "Please run /login again after the deploy, then retry the test suite" "The login expired handler returns 401" \
  "- Login expired · Please run /login" "+ OAuth token revoked · Please run /login" "> Please run /login" "\"Login expired · Please run /login\" is the message" "src/auth.sh: login expired" "Login expired · Please run /login and then more text" \
  "the OAuth token revoked path is covered" "Logged in as me@example.com" "Run /login to authenticate"; do
  assert_eq "auth pattern ignores: $l" false "$(m "$AUTH_RE" "$l")"
done
assert_eq "limit pattern ignores a login message" false "$(m "$CL_RE" "Login expired · Please run /login")"

# --- the loop's functions --------------------------------------------------------------------------------
# The rest lifts ship-loop's own functions (loop_fn) and runs them against a scripted mux, a scratch state
# directory and one temp repo. loop-journey.sh brings the unit-space fixtures; it replaces the quota dir
# below, so everything above this line has already run.
source "$TESTS_DIR/lib/loop-journey.sh"
SHIP_DIR="$SCRIPTS_DIR/ship"
PROMPTS="$SHIP_DIR/prompts"
SCHEMAS="$SHIP_DIR/schemas"
ROLE_BIN="$SHIP_DIR/ship-role"
export SHIP_QUOTA_DIR="$FIX/quota-fo"; mkdir -p "$SHIP_QUOTA_DIR"

newstate() { STATE="$(mktemp -d "$FIX/st.XXXXXX")"; mkdir -p "$STATE/agents"; LOG="$STATE/loop.log"; : >"$LOG"; }
log() { printf '%s\n' "$*" >>"$LOG"; }
die_error() { echo "DIE: $1"; exit 9; }
park() { echo "PARK $1|$2|$3|resets=$6"; exit 9; }
sx() { ( "$@" ) 2>&1; echo "rc=$?"; }
MUXLOG="$FIX/mux.log"
MUX_SCREEN='' MUX_CLOSE_RC=0
mux() {
  printf '%s\n' "$*" >>"$MUXLOG"
  case "$1" in
    read) printf '%s\n' "$MUX_SCREEN" ;;
    close) return "$MUX_CLOSE_RC" ;;
  esac
  return 0
}
mux_reset() { : >"$MUXLOG"; MUX_SCREEN='' MUX_CLOSE_RC=0; }

REF=fo BRANCH=feat-fo BASE=main CLASS=S PR=7 WT="$SPACE/worktrees/fo" SPACE_ID=sp1
POLL_S=0 LIMIT_LINES=25 STOP_MS=100 SUMMARY_TIMEOUT_S=60 CUR_ROUND=0 STAGE=develop
SHIP_CONFIG_JSON='{}'
unit fo
newstate
loop_fn agent_harness limit_hit auth_hit limit_word stamp_failovers stop_agent scrub_status git_facts_status write_status \
  failover_on_limit await_file render check_verdict cfg valid_json write_json

# limit_word — the word of "hit your <word> limit", lower case, empty for a plain limit.
# mutation: limit_word loses its tr 'A-Z' 'a-z' -> "OPUS" stays upper case
assert_eq "limit_word: a model" sonnet "$(limit_word "You've hit your Sonnet limit · resets 4pm")"
assert_eq "limit_word: upper case is lowered" opus "$(limit_word "YOU'VE HIT YOUR OPUS LIMIT")"
assert_eq "limit_word: a window" weekly "$(limit_word "You've hit your weekly limit · resets Fri")"
assert_eq "limit_word: the real Claude Code line" weekly "$(limit_word "$REAL_CL")"
assert_eq "limit_word: a plain limit has no word" "" "$(limit_word "You've hit your limit · resets 4pm")"
assert_eq "limit_word: a hyphenated window" five-hour "$(limit_word "You've hit your five-hour limit")"
assert_eq "limit_word: pi text has none" "" "$(limit_word "Error: 429 Too Many Requests")"

# limit_hit — the matching line of the newest LIMIT_LINES of the agent's screen, cleaned
# mutation: limit_hit reads --lines "$LIMIT_LINES" -> the whole scrollback
SHIP_CONFIG_JSON="$(jq -nc --arg c "$CL_RE" --arg p "$PI_RE" '{limits: {patterns: {claude: $c, pi: $p}}}')"
mkagent() { # name model harness [key]
  jq -nc --arg n "$1" --arg m "$2" --arg h "$3" --arg k "${4:-dev}" '{name:$n, role:"dev", models_key:$k, model:$m, harness:$h, session:"11111111-2222-3333-4444-555555555555", id:"id-\($n)"}' >"$STATE/agents/$1.json"
}
mkagent hc sonnet claude; mkagent hp zai/glm-5.3 pi
mux_reset; MUX_SCREEN="some output
$REAL_CL"
assert_contains "limit_hit: claude's real limit line is returned, cleaned of its glyph" "$(limit_hit hc id-hc)" "You've hit your weekly limit"
assert_contains "limit_hit: it asked for the newest LIMIT_LINES lines only" "$(cat "$MUXLOG")" "--lines 25"
MUX_SCREEN="Summary: limit_hit now matches \"You've hit your weekly limit\" and the
\"You've hit your weekly limit\" wording in the output is fine"
assert_fails "limit_hit: a summary quoting the weekly wording is not a limit (r19)" limit_hit hc id-hc
MUX_SCREEN="  You've hit your weekly limit fails over the unit when the
  You've hit your weekly limit is quoted in prose"
assert_fails "limit_hit: a wrapped indented quotation is not a limit (r22)" limit_hit hc id-hc
MUX_SCREEN="Summary: added retry with backoff when the API answers 429 Too Many Requests"
assert_fails "limit_hit: pi quoting a 429 is not a limit (r18)" limit_hit hp id-hp
MUX_SCREEN="the finding at ship-loop:429 and src/x.sh:429: handler
// retry on a rate limit
usage limit docs"
assert_fails "limit_hit: pi code and findings that look like a limit are not one (r10)" limit_hit hp id-hp
MUX_SCREEN="Error: 429 Too Many Requests"
assert_eq "limit_hit: pi's real 429 is a limit (r10b)" "Error: 429 Too Many Requests" "$(limit_hit hp id-hp)"
MUX_SCREEN="Edit file src/x.sh?
│ + You've hit your Sonnet limit
│ - old line"
assert_fails "limit_hit: the wording inside an edit dialog's diff is not a limit (r20)" limit_hit hc id-hc
MUX_SCREEN="You've hit your Sonnet limit"
SAVED_CFG="$SHIP_CONFIG_JSON"; SHIP_CONFIG_JSON='{}'
assert_fails "limit_hit: a harness without a pattern never matches" limit_hit hc id-hc
SHIP_CONFIG_JSON="$SAVED_CFG"

# auth_hit — the matching login-expired line of the newest LIMIT_LINES of the agent's screen, cleaned
SHIP_CONFIG_JSON="$(jq -nc --arg a "$AUTH_RE" '{auth: {patterns: {claude: $a}}}')"
mux_reset; MUX_SCREEN="some output
  ⎿ ${NB}OAuth token revoked · Please run /login"
assert_eq "auth_hit: claude's login line is returned, cleaned of its glyph" "OAuth token revoked · Please run /login" "$(auth_hit hc id-hc)"
assert_contains "auth_hit: it asked for the newest LIMIT_LINES lines only" "$(cat "$MUXLOG")" "--lines 25"
MUX_SCREEN="Summary: the login expired handler is fixed
Please run /login again after the deploy, then retry"
assert_fails "auth_hit: prose about a login is not an expired login" auth_hit hc id-hc
MUX_SCREEN="You've hit your weekly limit · resets Fri 4pm"
assert_fails "auth_hit: a usage limit is not an expired login" auth_hit hc id-hc
MUX_SCREEN="Login expired · Please run /login"
assert_fails "auth_hit: a pi agent (no pattern) never matches" auth_hit hp id-hp
SHIP_CONFIG_JSON='{}'
assert_fails "auth_hit: no pattern configured never matches" auth_hit hc id-hc
SHIP_CONFIG_JSON="$SAVED_CFG"

# the takeover prompt must not trip the pi pattern (it names a rate/usage allowance): rendered from the real template
TKP="$(render takeover stage_prompt="do the thing" answer="" worktree="$WT" status_file="$STATE/STATUS.md" brief="$BRIEF" from=sonnet to=zai/glm-5.3)"
# jq test() with ^ anchors on the whole string, so the check runs per line, as limit_hit does
TKP_PI="$(printf '%s\n' "$TKP" | jq -Rr --arg re "$PI_RE" 'select(test($re))')"
TKP_PI_POS="$(printf '%s\n' "$TKP" "Error: 429 Too Many Requests" | jq -Rr --arg re "$PI_RE" 'select(test($re))')"
assert_eq "takeover prompt: no line trips the pi pattern (positive control: a 429 line appended does)" "|Error: 429 Too Many Requests" "$TKP_PI|$TKP_PI_POS"
mux_reset; MUX_SCREEN="$TKP"
assert_fails "takeover prompt: limit_hit on a pi agent does not see a limit in it" limit_hit hp id-hp
MUX_SCREEN="$TKP
Error: 429 Too Many Requests"
assert_eq "takeover prompt: limit_hit on a pi agent still sees a real 429 below it" "Error: 429 Too Many Requests" "$(limit_hit hp id-hp)"
MUX_SCREEN="$TKP"
assert_fails "takeover prompt: limit_hit on a claude agent does not see a limit in it" limit_hit hc id-hc

# limits.patterns validation now lives in ship_config_load (one jq pass); covered by test-t-ship-config-validate.sh

# stamp_failovers — the verdict carries the number of failover-N.json of this agent, stage and round
# mutation: stamp_failovers drops the `.round == $r` filter
newstate
echo '{"agent":"a","stage":"develop","round":0}' >"$STATE/failover-1.json"
echo '{"agent":"a","stage":"fix","round":2}' >"$STATE/failover-2.json"
echo '{"agent":"b","stage":"develop","round":0}' >"$STATE/failover-3.json"
echo '{"agent":"a","stage":"fix","round":2}' >"$STATE/failover-4.json"
echo '{"agent":"a","stage":"fix","round":3}' >"$STATE/failover-5.json"
stamp() { printf '{"status":"DONE"}\n' >"$STATE/v.json"; stamp_failovers "$1" "$STATE/v.json" "$2" "$3"; jq -r '.failovers' "$STATE/v.json"; }
assert_eq "stamp_failovers: develop round 0 of agent a counts 1" 1 "$(stamp a develop 0)"
assert_eq "stamp_failovers: fix round 2 counts its own two" 2 "$(stamp a fix 2)"
assert_eq "stamp_failovers: another agent's file is not counted" 1 "$(stamp b develop 0)"
assert_eq "stamp_failovers: no match stamps 0" 0 "$(stamp a review 1)"
printf 'not json' >"$STATE/v.json"; stamp_failovers a "$STATE/v.json" develop 0
assert_eq "stamp_failovers: a verdict that is not JSON is left as it was, no temp file" "not json absent" "$(cat "$STATE/v.json") $([[ -e "$STATE/v.json.tmp" ]] && echo present || echo absent)"

# scrub_status — a line quoting a limit message is replaced; configured patterns scrub without their anchor
# mutation: the configured-pattern sub("^\\^"; "") removed -> the mid-line custom wording survives
newstate
cat >"$STATE/STATUS.md" <<'S'
## Done
The agent saw "You've hit your Sonnet limit" and then "Error: 429 Too Many Requests".
It also saw a zzz-custom-limit message today.
And a zzz-plain-limit one.
Quota exceeded for the project.
## In progress
The rate limit exceeded handler.
## Next steps
1. Finish the tests.
S
SHIP_CONFIG_JSON='{}'; cp "$STATE/STATUS.md" "$STATE/STATUS.orig"
scrub_status; S="$(cat "$STATE/STATUS.md")"
assert_not_contains "scrub_status: the limit sentence is gone" "$S" "hit your"
assert_not_contains "scrub_status: the 429 line is gone" "$S" "429"
assert_not_contains "scrub_status: the 'rate limit exceeded' line is gone" "$S" "rate limit"
assert_not_contains "scrub_status: the quota line is gone" "$S" "Quota exceeded"
assert_contains "scrub_status: the removed lines are marked" "$S" "[line removed"
assert_contains "scrub_status: an unrelated line survives" "$S" "Finish the tests"
assert_contains "scrub_status: without a configured pattern the custom wording survives (control)" "$S" "zzz-custom-limit"
assert_eq "scrub_status: the four section headings survive" 3 "$(grep -c '^## ' <<<"$S")"
cp "$STATE/STATUS.orig" "$STATE/STATUS.md"
SHIP_CONFIG_JSON='{"limits":{"patterns":{"claude":"(?i)^zzz-custom-limit"}}}'
scrub_status
assert_not_contains "scrub_status: a configured pattern scrubs mid-line (r26)" "$(cat "$STATE/STATUS.md")" "zzz-custom-limit"
SHIP_CONFIG_JSON='{"limits":{"patterns":{"claude":"^zzz-plain-limit"}}}'; cp "$STATE/STATUS.orig" "$STATE/STATUS.md"; scrub_status
assert_not_contains "scrub_status: a configured pattern without a flag prefix scrubs mid-line too" "$(cat "$STATE/STATUS.md")" "zzz-plain-limit"
rm -f "$STATE/STATUS.md"; scrub_status 2>/dev/null
assert_contains "scrub_status: a missing STATUS.md is logged, not fatal" "$(cat "$LOG")" "could not scrub STATUS.md"

# git_facts_status — STATUS.md from git alone
# mutation: git_facts_status lists `git status --short` -> `git status` of another dir (dirty file missing)
newstate
git_facts_status fo-dev develop
G="$(cat "$STATE/STATUS.md")"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do assert_contains "git_facts_status: has '$sec'" "$G" "$sec"; done
assert_contains "git_facts_status: the next steps leave the gate to the driver" "$G" "the driver runs the gate"
assert_contains "git_facts_status: says the transcript was not summarised" "$G" "transcript not summarised"
assert_contains "git_facts_status: lists the commit ahead of origin/main" "$G" "feat: the change"
assert_contains "git_facts_status: lists the changed file in the diffstat" "$G" "feat.txt"
assert_contains "git_facts_status: a clean tree says so" "$G" "No uncommitted changes"
echo wip >"$WT/half-done.txt"
git_facts_status fo-dev develop
assert_contains "git_facts_status: uncommitted files are listed (r3b)" "$(cat "$STATE/STATUS.md")" "half-done.txt"
rm -f "$WT/half-done.txt"

# write_status — the summariser: argv, failure modes, scrub. claude -p and pi -p are stubs that record their argv.
cat >"$FIX/bin/claude" <<'S'
#!/bin/sh
case " $* " in *" -p "*) ;; *) exit 0 ;; esac
echo "$*" >>"$FIX_DIR/claude-p.args"
cat >>"$FIX_DIR/claude-p.stdin"
case "$(cat "$FIX_DIR/summarizer.mode" 2>/dev/null)" in
  fail) echo "boom" >&2; exit 1 ;;
  hang) exec sleep 8 ;;
  custom) printf '## Done\nThe agent saw a zzz-custom-limit message today.\n\n## In progress\nNothing.\n\n## Next steps\n1. Finish.\n\n## Open questions\nNone.\n'; exit 0 ;;
  quote) printf 'Here is the note.\n\n## Done\nThe agent saw "You'"'"'ve hit your Sonnet limit" and then "Error: 429 Too Many Requests".\n\n## In progress\nThe rate limit exceeded handler.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'; exit 0 ;;
  badexit) printf '## Done\nx\n\n## In progress\nx\n\n## Next steps\nx\n\n## Open questions\nx\n'; exit 1 ;;
esac
printf 'Here is the note.\n\n## Done\nWrote the parser.\n\n## In progress\nHalf of the tests.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
S
cat >"$FIX/bin/pi" <<'S'
#!/bin/sh
case " $* " in *" -p "*) ;; *) exit 0 ;; esac
echo "$*" >>"$FIX_DIR/pi-p.args"
printf '## Done\nWrote the parser.\n\n## In progress\nHalf of the tests.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
S
chmod +x "$FIX/bin/claude" "$FIX/bin/pi"
export FIX_DIR="$FIX"
SID=11111111-2222-3333-4444-555555555555
mkdir -p "$HOME/.claude/projects/proj"; printf '{"type":"user"}\n' >"$HOME/.claude/projects/proj/$SID.jsonl"
sumcfg() { SHIP_CONFIG_JSON="$(jq -nc --argjson s "$1" '{failover: {summarizer: $s}}')"; }
ws() { # mode [summarizers] — one write_status call in a fresh state dir
  newstate; printf '%s\n' "$1" >"$FIX/summarizer.mode"; rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin" "$FIX/pi-p.args"
  sumcfg "${2:-[\"haiku\"]}"
  write_status fo-dev develop "${3:-claude}" "${4:-$SID}" 2>/dev/null
}
ws ok
assert_eq "write_status ok: the summariser model is recorded" haiku "$SUM_MODEL"
assert_eq "write_status ok: STATUS.md starts at the first section (the preface is dropped)" "## Done" "$(head -n 1 "$STATE/STATUS.md")"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do assert_contains "write_status ok: STATUS.md has '$sec'" "$(cat "$STATE/STATUS.md")" "$sec"; done
CP="$(cat "$FIX/claude-p.args")"; CS="$(cat "$FIX/claude-p.stdin")"
# mutation: write_status passes --tools Read -> --tools Read,Bash (or drops --no-session-persistence)
assert_contains "summariser argv (claude): headless on the picked model" "$CP" "-p --model haiku"
assert_contains "summariser argv (claude): no MCP (strict config)" "$CP" "--strict-mcp-config"
assert_contains "summariser argv (claude): under the role settings" "$CP" "--settings"
assert_contains "summariser argv (claude): the Read tool only" "$CP" "--tools Read"
assert_not_contains "summariser argv (claude): no Bash" "$CP" "Bash"
assert_contains "summariser argv (claude): keeps no session" "$CP" "--no-session-persistence"
assert_not_contains "summariser prompt: not told to write anywhere" "$CS" "--output"
assert_contains "summariser prompt: told where the transcript is" "$CS" "$HOME/.claude/projects/proj/$SID.jsonl"
assert_contains "summariser prompt: told the worktree" "$CS" "$WT"
# the failure modes all give the git-facts note and no summariser (r3fail / r3badexit)
for mode in fail badexit; do
  ws "$mode"
  assert_eq "write_status $mode: no summariser recorded" "" "$SUM_MODEL"
  assert_contains "write_status $mode: git-facts STATUS.md" "$(cat "$STATE/STATUS.md")" "transcript not summarised"
done
# a summariser that never returns is killed at SUMMARY_TIMEOUT_S (0 here: no wait); the stub only sleeps 8 s, so a
# timeout that stopped working fails the elapsed check instead of hanging
# mutation: write_status loses `kill "$pid"` in the timeout branch -> the call waits for the stub (8 s)
SUMMARY_TIMEOUT_S=0; SECONDS=0; ws hang; HANG_S=$SECONDS; SUMMARY_TIMEOUT_S=60
assert_eq "write_status hang: git-facts STATUS.md, no summariser" "" "$SUM_MODEL"
assert_contains "write_status hang: git-facts STATUS.md" "$(cat "$STATE/STATUS.md")" "transcript not summarised"
assert_eq "write_status hang: the summariser was killed, not waited for (under 5 s)" true "$([[ $HANG_S -lt 5 ]] && echo true || echo false)"
# quoting the limit: the note is scrubbed before the successor reads it (r11)
ws quote
S="$(cat "$STATE/STATUS.md")"
assert_eq "write_status quote: the summariser still counts as used" haiku "$SUM_MODEL"
assert_not_contains "write_status quote: no limit sentence" "$S" "hit your"
assert_not_contains "write_status quote: no 429 line" "$S" "429"
assert_not_contains "write_status quote: no 'rate limit' line" "$S" "rate limit"
assert_contains "write_status quote: the removed lines are marked" "$S" "[line removed"
assert_contains "write_status quote: the other sections survive" "$S" "Finish the tests"
# a pi summariser: read-only, no session, no --approve (r13)
ws ok '["zai/glm-5.3"]'
PA="$(cat "$FIX/pi-p.args")"
assert_eq "write_status pi: the summariser model is recorded" zai/glm-5.3 "$SUM_MODEL"
assert_contains "summariser argv (pi): --no-session" "$PA" "--no-session"
assert_contains "summariser argv (pi): the read tool only" "$PA" "--tools read"
assert_not_contains "summariser argv (pi): no --approve" "$PA" "--approve"
assert_not_contains "summariser argv (pi): no write tools" "$PA" "bash"
# no usable summariser: an empty list, and an account that is limited (haiku is claude) -> git facts, nothing run (r3)
ws ok '[]'
assert_eq "write_status, no summariser configured: git facts, none run" " absent" "$SUM_MODEL $([[ -e "$FIX/claude-p.args" ]] && echo present || echo absent)"
jq -nc --argjson u "$(ts 3600)" '{accounts: {default: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
ws ok
assert_eq "write_status, account limited: git facts, no summariser ran" " absent" "$SUM_MODEL $([[ -e "$FIX/claude-p.args" ]] && echo present || echo absent)"
assert_contains "write_status, account limited: STATUS.md is the git-facts note" "$(cat "$STATE/STATUS.md")" "transcript not summarised"
assert_eq "write_status, account limited: the summariser's skip is not a failover (--dry writes nothing)" 0 "$(ls "$STATE"/failover-*.json 2>/dev/null | wc -l | tr -d ' ')"
rm -f "$SHIP_QUOTA_DIR/limited.json"
# the configured pattern scrubs the summariser's note too (r26)
newstate; printf 'custom\n' >"$FIX/summarizer.mode"
SHIP_CONFIG_JSON='{"failover":{"summarizer":["haiku"]},"limits":{"patterns":{"claude":"(?i)^zzz-custom-limit"}}}'
write_status fo-dev develop claude "$SID" 2>/dev/null
assert_not_contains "write_status: a configured pattern scrubs the summariser's note mid-line" "$(cat "$STATE/STATUS.md")" "zzz-custom-limit"
SHIP_CONFIG_JSON="$SAVED_CFG"

# failover_on_limit — kind and key of the limit, the pick, the stop, the record, the takeover text.
# write_status, start_agent, send_prompt and mark_sent are scripted here (write_status is tested above, the
# starts are the driver's); stop_agent, pick_model, ship_limit_record and check_verdict are the real ones.
write_status() { SUM_MODEL=haiku; printf '## Done\nx\n\n## In progress\nx\n\n## Next steps\nx\n\n## Open questions\nx\n' >"$STATE/STATUS.md"; }
N_START=0 SA_ARGS="" SENT=""
start_agent() { N_START=$((N_START + 1)); SA_ARGS="$*"; A_ID=new-id; }
send_prompt() { SENT="$2"; }
mark_sent() { : >"$1.sent"; }
fo_new() { # name model harness key [round] [stage] — a fresh state dir, an agent, an empty quota dir, a two-entry list
  newstate; mux_reset; N_START=0 SA_ARGS="" SENT="" FO_ID="" FAIL_WHY=""
  rm -f "$SHIP_QUOTA_DIR"/*.json; mkdir -p "$STATE/agents"
  mkagent "$1" "$2" "$3" "$4"
  CUR_ROUND="${5:-0}"; STAGE="${6:-develop}"
  VF="$STATE/${STAGE}.json"; printf 'stage prompt body\n' >"${VF%.json}.prompt.md"
  FO_RC=0
}
lim_models() { jq -r '(.models // {}) | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json" 2>/dev/null; }
lim_accts() { jq -r '(.accounts // {}) | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json" 2>/dev/null; }
models() { SHIP_CONFIG_JSON="$(jq -nc --argjson l "$1" '{models: {dev: $l, review: $l}}')"; }

# a Sonnet limit on a sonnet agent (r1, r5): a model limit; the dev restarts on the next entry
# mutation: failover_on_limit stops recording the limit (ship_limit_record) -> the second walk does not skip sonnet
models '["sonnet","zai/glm-5.3"]'; fo_new d sonnet claude dev
failover_on_limit d develop "$VF" "You've hit your Sonnet limit · resets 4pm" id-d || FO_RC=$?
F="$STATE/failover-1.json"
assert_eq "failover (sonnet limit): returns 0 and the successor id is set" "0 new-id" "$FO_RC $FO_ID"
assert_eq "failover (sonnet limit): reason, stage, agent" "limit develop d" "$(jq -r '"\(.reason) \(.stage) \(.agent)"' "$F")"
assert_eq "failover (sonnet limit): from sonnet to the pi entry, a model limit" "sonnet zai/glm-5.3 model" "$(jq -r '"\(.from) \(.to) \(.limit_kind)"' "$F")"
assert_contains "failover (sonnet limit): the matched screen text" "$(jq -r .matched "$F")" "Sonnet limit"
assert_eq "failover (sonnet limit): the summariser is recorded" haiku "$(jq -r .summarizer "$F")"
assert_eq "failover (sonnet limit): names STATUS.md" "$STATE/STATUS.md" "$(jq -r .status_md "$F")"
assert_ok "failover (sonnet limit): the record matches the failover schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$F"
assert_eq "failover (sonnet limit): limited.json names the model, not the account" "sonnet | " "$(lim_models) | $(lim_accts)"
assert_eq "failover (sonnet limit): the cooldown puts until in the future" true "$(jq -r --argjson n "$(date +%s)" '.models.sonnet.until > $n' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "failover (sonnet limit): the old agent got esc, then /exit, then its pane was closed" "esc /exit close" \
  "$(grep -c -e '--keys esc' "$MUXLOG" | sed 's/1/esc/') $(grep -c -e '--text /exit' "$MUXLOG" | sed 's/1/\/exit/') $(grep -c '^close' "$MUXLOG" | sed 's/1/close/')"
assert_eq "failover (sonnet limit): the successor was started once on the pi entry" "1 true" "$N_START $([[ "$SA_ARGS" == "d dev dev zai/glm-5.3" ]] && echo true || echo false)"
assert_eq "failover (sonnet limit): the stage's prompt marker was cleared and set again" "absent present" "$([[ -e "$VF" ]] && echo present || echo absent) $([[ -e "$VF.sent" ]] && echo present || echo absent)"
TKT="$(cat "$STATE/develop.takeover.md")"
assert_contains "takeover text: says who replaced whom" "$TKT" "sonnet was replaced by zai/glm-5.3"
assert_contains "takeover text: names STATUS.md" "$TKT" "$STATE/STATUS.md"
assert_contains "takeover text: names the brief" "$TKT" "$BRIEF"
assert_contains "takeover text: carries the stage prompt" "$TKT" "stage prompt body"
assert_eq "failover (sonnet limit): the successor is sent exactly the takeover file" "$TKT" "$SENT"
assert_eq "failover (sonnet limit): the successor's first preflight walk now skips sonnet" "zai/glm-5.3" "$(PICK_AFTER=""; pick_model --dry dev >/dev/null 2>&1; echo "$PICK_MODEL")"

# the lead answered the old agent: takeover text, then the stage prompt, then the answer (r15)
fo_new d sonnet claude dev
printf 'No: EMPTY input exits 2.\n' >"$VF.answer"
failover_on_limit d develop "$VF" "You've hit your Sonnet limit" id-d
TK="$(cat "$STATE/develop.takeover.md")"
P_TAKE="${TK%%taking over*}"; P_STAGE="${TK%%The task you were handed follows*}"; P_ANS="${TK%%No: EMPTY input exits 2.*}"
assert_contains "takeover composition: has the takeover text" "$TK" "taking over"
assert_contains "takeover composition: has the stage prompt" "$TK" "stage prompt body"
assert_contains "takeover composition: has the lead's answer again" "$TK" "No: EMPTY input exits 2."
assert_eq "takeover composition: order is takeover text, stage prompt, answer" true "$([[ ${#P_TAKE} -lt ${#P_STAGE} && ${#P_STAGE} -lt ${#P_ANS} ]] && echo true || echo false)"

# the account limits: a window word, a plain limit, the real Claude line (r9, r24)
for t in "You've hit your weekly limit · resets Fri" "You've hit your limit · resets 4pm" "$REAL_CL"; do
  fo_new d sonnet claude dev
  failover_on_limit d develop "$VF" "$t" id-d
  assert_eq "failover: an account limit ($t)" "account default | " "$(jq -r .limit_kind "$STATE/failover-1.json") $(lim_accts) | $(lim_models)"
done
# an account limit carries the quota block and uses its resets_at as the cooldown end
fo_new d sonnet claude dev
snap 40 94 60 7200
failover_on_limit d develop "$VF" "You've hit your limit" id-d
assert_eq "failover (account limit): until is the snapshot's resets_at" "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$(jq -r '.accounts.default.until' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "failover (account limit): the record carries the quota percentages" 94 "$(jq -r .quota.seven_day "$STATE/failover-1.json")"

# an Opus limit on an opus agent, shouted (r4, r8): a model limit on opus only; the walk goes on to sonnet
models '["opus","sonnet","zai/glm-5.3"]'; fo_new d opus claude dev
failover_on_limit d develop "$VF" "YOU'VE HIT YOUR OPUS LIMIT" id-d
assert_eq "failover (opus limit): opus -> sonnet, a model limit on opus only" "opus sonnet model opus | " \
  "$(jq -r '"\(.from) \(.to) \(.limit_kind)"' "$STATE/failover-1.json") $(lim_models) | $(lim_accts)"
assert_eq "failover (opus limit): afterwards a walk over [opus, sonnet] skips opus and picks sonnet" "sonnet" "$(models '["opus","sonnet"]'; pick_model --dry dev >/dev/null 2>&1; echo "$PICK_MODEL")"

# a limit on another model than the agent runs on (r21): recorded, no stop, no start, no failover file, rc 3
models '["sonnet","zai/glm-5.3"]'; fo_new d sonnet claude dev
failover_on_limit d develop "$VF" "You've hit your Opus limit · resets 4pm" id-d || FO_RC=$?
assert_eq "failover (other model): returns 3, opus recorded, no account" "3 opus | " "$FO_RC $(lim_models) | $(lim_accts)"
assert_eq "failover (other model): nothing was stopped or started, no failover file" "0 0 0" "$(wc -l <"$MUXLOG" | tr -d ' ') $N_START $(ls "$STATE"/failover-*.json 2>/dev/null | wc -l | tr -d ' ')"

# a pi agent: a model limit on its own entry, pi to pi (r10b); ctrl+d stops it instead of /exit
models '["zai/glm-5.3","prov/second"]'; fo_new p zai/glm-5.3 pi dev
failover_on_limit p develop "$VF" "Error: 429 Too Many Requests" id-p
assert_eq "failover (pi): pi -> pi, a model limit" "zai/glm-5.3 prov/second model" "$(jq -r '"\(.from) \(.to) \(.limit_kind)"' "$STATE/failover-1.json")"
assert_eq "failover (pi): stopped with ctrl+d, no /exit" "1 0" "$(grep -c -e '--keys ctrl+d' "$MUXLOG") $(grep -c -e '--text /exit' "$MUXLOG")"

# the old pane cannot be closed (r14): returns 1 with FAIL_WHY, no second agent, no takeover
models '["sonnet","zai/glm-5.3"]'; fo_new d sonnet claude dev
MUX_CLOSE_RC=1
failover_on_limit d develop "$VF" "You've hit your Sonnet limit" id-d || FO_RC=$?
assert_eq "failover (close fails): returns 1, no successor, nothing sent, no failover file" "1 0 absent 0" "$FO_RC $N_START $([[ -n "$SENT" ]] && echo sent || echo absent) $(ls "$STATE"/failover-*.json 2>/dev/null | wc -l | tr -d ' ')"
assert_contains "failover (close fails): FAIL_WHY says which agent" "$FAIL_WHY" "could not close d to replace it"

# a failover in a fix round records the real stage and round (r12) and the verdict gets the count
models '["sonnet","zai/glm-5.3"]'; fo_new d sonnet claude dev 2 fix
failover_on_limit d fix "$VF" "You've hit your Sonnet limit" id-d
assert_eq "failover (fix round): the record names the stage and round 2" "fix 2" "$(jq -r '"\(.stage) \(.round)"' "$STATE/failover-1.json")"
printf '{"status":"DONE"}\n' >"$VF"; stamp_failovers d "$VF" fix 2
assert_eq "failover (fix round): stamp_failovers puts the count on the fix verdict" 1 "$(jq -r .failovers "$VF")"

# a reviewer fails over too (r6): its own models key, stage review
models '["sonnet"]'; SHIP_CONFIG_JSON="$(jq -c '.models.review = ["opus","prov/reviewer"]' <<<"$SHIP_CONFIG_JSON")"
fo_new rv opus claude review 1 review
failover_on_limit rv review "$VF" "You've hit your Opus limit" id-rv
assert_eq "failover (reviewer): limit review opus -> prov/reviewer" "limit review opus prov/reviewer" "$(jq -r '"\(.reason) \(.stage) \(.from) \(.to)"' "$STATE/failover-1.json")"

# nothing to fail over to (r2): parks LIMIT with resets_at, nothing stopped or started
models '["sonnet"]'; fo_new d sonnet claude dev
snap 40 94 60 7200
OUTP="$(sx failover_on_limit d develop "$VF" "You've hit your limit · resets 4pm" id-d)"
assert_contains "failover (nothing left): parks LIMIT for the stage and agent" "$OUTP" "PARK LIMIT|develop|d|"
assert_contains "failover (nothing left): resets_at is the snapshot's, as ISO" "$OUTP" "resets=$(jq -nr --argjson t "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" '$t | todate')"
assert_eq "failover (nothing left): the agent was left alone (no keys sent)" 0 "$(wc -l <"$MUXLOG" | tr -d ' ')"
assert_eq "failover (nothing left): the account limit is recorded until the reset" "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$(jq -r '.accounts.default.until' "$SHIP_QUOTA_DIR/limited.json")"
rm -f "$SHIP_QUOTA_DIR"/*.json

# await_file keeps the budget clock across a failover (r16): the time used before it stays counted.
# The scripted agent is idle with a limit on its screen once, then working; its verdict appears on the second state read.
# `date +%s` is scripted (one value per call, from a file: command substitution is a subshell) so the clock is exact:
#   seg 1000 | now 1030 (el 30, limit seen, failover) | new seg 2000 | now 2005 -> clock 30 + 5 = 35
# mutation: await_file `acc="$el"` after a failover -> `acc=0` (clock 5)
# mutation: await_file drops `acc="$el"` after a failover (clock 5)
# mutation: await_file drops `seg="$(date +%s)"` after a failover (the clock jumps to the scripted 1030)
date() { # only +%s is scripted; it pops the next value of $DATE_SEQ
  if [[ "${1:-}" != +%s ]]; then command date "$@"; return; fi
  head -n 1 "$DATE_SEQ"; sed -i.bak 1d "$DATE_SEQ"; rm -f "$DATE_SEQ.bak"
}
DATE_SEQ="$FIX/date.seq"
IDLE_GRACE_S=3600
aw_run() { # <seeded clock or ""> — run await_file once; sets AWRC and AW_FO (failover calls)
  newstate; AW_N=0; AW_FO=0
  printf '%s\n' 1000 1030 2000 2005 2006 2007 2008 >"$DATE_SEQ"
  if [[ -n "$1" ]]; then echo "$1" >"$STATE/develop.json.clock"; fi
  agent_state() { AW_N=$((AW_N + 1)); L_STATE=working; [[ $AW_N -ne 1 ]] || L_STATE=idle; [[ $AW_N -ne 2 ]] || echo '{"status":"DONE"}' >"$STATE/develop.json"; }
  limit_hit() { [[ ! -e "$STATE/lh.done" ]] || return 1; : >"$STATE/lh.done"; echo "You've hit your Sonnet limit"; }
  failover_on_limit() { AW_FO=$((AW_FO + 1)); FO_ID=new-id; return 0; }
  await_file d id-d "$STATE/develop.json" develop 100; AWRC=$?
}
aw_run ""
assert_eq "await_file: returns 0 once the successor writes the verdict" 0 "$AWRC"
assert_contains "await_file: the log says the time used before the failover stays counted" "$(cat "$LOG")" "budget: 30s used before the failover stay counted"
assert_eq "await_file: the clock is the time before the failover plus the time since it" 35 "$(cat "$STATE/develop.json.clock")"
aw_run 7
assert_eq "await_file: a seeded clock is the starting point (7 + 30 + 5)" 42 "$(cat "$STATE/develop.json.clock")"

# a limit on another model (rc 3, r21): await_file does not act on it, keeps polling, and does not ask again
# for the same screen line (the `ignored` dedupe) while the agent goes on and writes its verdict
# mutation: await_file `if [[ $fo -eq 3 ]]; then ignored="$hit"; ...; continue; fi` -> `:` (rc 1)
# mutation: await_file drops `ignored="$hit"` (failover_on_limit is asked on every poll)
newstate; AW_N=0; AW_FO=0; unset -f date
agent_state() { AW_N=$((AW_N + 1)); L_STATE=idle; [[ $AW_N -ne 4 ]] || echo '{"status":"DONE"}' >"$STATE/develop.json"; }
limit_hit() { echo "You've hit your Opus limit"; }
failover_on_limit() { AW_FO=$((AW_FO + 1)); return 3; }
await_file d id-d "$STATE/develop.json" develop 100; AWRC=$?
assert_eq "await_file (other model's limit): returns 0 once the agent writes its verdict" 0 "$AWRC"
assert_eq "await_file (other model's limit): the limit was offered to failover_on_limit once, not on every poll" 1 "$AW_FO"
assert_eq "await_file (other model's limit): no failover happened" "" "$(grep -c 'stay counted' "$LOG" | grep -v '^0$')"

# --- constraints ------------------------------------------------------------------------------------------

assert_ok "the tap passes bash -n" bash -n "$TAP"
assert_eq "C-1: no husk, forge, user path or host literal in the tap" "" "$(grep -niE 'husk|forge|/work/|/Users/' "$TAP")"
assert_eq "C-11: the tap does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$TAP")"
REAL_AFTER="$(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.cache/hyper is unchanged" "$REAL_BEFORE" "$REAL_AFTER"
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac

finish
