#!/usr/bin/env bash
# Row T (ship failover) — preflight routing and the quota tap. HOME is a temp dir
# (helpers.sh) and every quota file lives under $FIX, so the real ~/.cache is never touched.
#
# Cases:
#   pick_model     a 97% seven_day snapshot skips both claude entries of
#                  [sonnet, opus, zai/glm-5.3] and picks pi (two preflight failover files);
#                  a stale snapshot, a resets_at in the past, no snapshot and a snapshot of
#                  another account skip nothing; pi is never skipped (C-15); limited.json;
#                  every entry skipped -> 2 with PICK_RESETS_AT; --dry writes nothing
#   ship-loop      the same snapshot sends a unit to pi; a list with nothing usable parks
#                  LIMIT (exit 2) with resets_at, and the unit resumes once the quota is back
#   quota tap      the original status-line command's output is printed unchanged; the snapshot
#                  is written only when rate_limits is present
# Reactive failover (a limit seen while a stage runs) is tested with its own task.

REAL_HOME="$HOME"
_mt() { if [[ -e "$1" ]]; then stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; else echo absent; fi; }
REAL_BEFORE="$(_mt "$REAL_HOME/.cache/hyper")"

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

LOOP="$SCRIPTS_DIR/ship/ship-loop"
TAP="$SCRIPTS_DIR/ship/ship-quota-tap"
STUB="$TESTS_DIR/fixtures/ship/stub-agent"
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

# --- ship-loop ----------------------------------------------------------------------------------------

SPACE="$FIX/proj"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/notes" "$HOME/.claude" "$FIX/bin" "$FIX/scripts"
PROJECT="$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief.md"
printf '# Brief\n\nDo the thing.\n' >"$BRIEF"
printf '{"enabledPlugins":{}}\n' >"$HOME/.claude/settings.json"
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake"
export SHIP_MUX_FAKE_LOG="$FIX/fake.log"
export SHIP_MUX_TEST=1
export SHIP_POLL_S=0.05
export SHIP_IDLE_GRACE_S=3600
for c in claude pi gh; do printf '#!/bin/sh\nexit 0\n' >"$FIX/bin/$c"; chmod +x "$FIX/bin/$c"; done
export PATH="$FIX/bin:$PATH"
unset STATE   # the driver sets its own

write_cfg() { # dev model list (YAML flow) [review model list]
  cat >"$PROJECT" <<EOF
mux: fake
gate: 'true'
budgets:
  S: 10
models:
  dev: $1
  review: ${2:-[opus, prov/reviewer]}
roles:
  dev:
    pi_skills: []
    pi_extensions: []
  review:
    pi_skills: []
    pi_extensions: []
EOF
}
DEV_DONE='{"status":"DONE","pr":7,"head":"abc1234","summary":"done, gate green"}'
REV_OK='{"verdict":"ACCEPT","findings":[]}'
unit() {
  local ref="$1" w="$SPACE/worktrees/$1" o="$FIX/origin-$1.git"
  git init -q --bare "$o"
  git clone -q "$o" "$w" 2>/dev/null
  echo base >"$w/f.txt"; git -C "$w" add -A; git -C "$w" commit -qm "base"; git -C "$w" push -q -u origin main 2>/dev/null
  git -C "$w" checkout -q -b "feat-$ref"
  echo change >"$w/feat.txt"; git -C "$w" add -A; git -C "$w" commit -qm "feat: the change"
  git -C "$w" push -q -u origin "feat-$ref" 2>/dev/null
  mkdir -p "$FIX/scripts/$ref"
  printf '%s\n' "$DEV_DONE" >"$FIX/scripts/$ref/develop.json"
  printf '%s\n' "$REV_OK" >"$FIX/scripts/$ref/review-r1.json"
}
STUB_PID=""
stub_start() { bash "$STUB" "$SPACE/notes/loops/$1" "$FIX/scripts/$1" >/dev/null 2>&1 & STUB_PID=$!; }
stub_stop() { [[ -z "$STUB_PID" ]] || { kill "$STUB_PID" 2>/dev/null; wait "$STUB_PID" 2>/dev/null; STUB_PID=""; }; }
RC="" OUT=""
run_loop() {
  local ref="$1"; shift
  OUT="$(bash "$LOOP" --ref "$ref" --worktree "$SPACE/worktrees/$ref" --branch "feat-$ref" --brief "$BRIEF" --class S "$@" 2>"$FIX/err-$ref.log")"
  RC=$?
}
st() { echo "$SPACE/notes/loops/$1"; }
starts_of() { jq -s --arg n "$1" '[.[] | select(.verb == "start" and (.args | index($n)))] | length' "$SHIP_MUX_FAKE_LOG"; }
dump() { echo "# driver.err: $(cat "$(st "$1")/driver.err" 2>/dev/null)" >&2; tail -n 15 "$(st "$1")/loop.log" 2>/dev/null | sed 's/^/# loop.log: /' >&2; }
reset_fake() { rm -rf "$SHIP_MUX_FAKE_DIR" "$SHIP_MUX_FAKE_LOG"; }

# 97% seven_day: the dev goes to pi, two preflight failovers are logged, the unit is READY.
reset_fake; unit f1
write_cfg '[sonnet, opus, zai/glm-5.3]'
snap - 97 60 3600
stub_start f1; run_loop f1; stub_stop
[[ "$RC" == 0 ]] || dump f1
assert_eq "driver, 97% seven_day: the unit is READY (exit 0)" 0 "$RC"
assert_eq "driver: result.json status READY" READY "$(jq -r .status "$(st f1)/result.json")"
_START="$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep f1-dev | head -n 1)"
assert_contains "driver: the dev starts on the pi entry" "$_START" 'zai/glm-5.3'
assert_contains "driver: as a pi agent" "$_START" '"pi"'
assert_eq "driver: the dev was started once" 1 "$(starts_of f1-dev)"
assert_eq "driver: agents/<name>.json records the pi model" zai/glm-5.3 "$(jq -r .model "$(st f1)/agents/f1-dev.json")"
assert_eq "driver: two preflight failovers for the dev" 2 "$(jq -s '[.[] | select(.agent == "f1-dev")] | length' "$(st f1)"/failover-*.json)"
assert_eq "driver: failover-1 sonnet -> opus" "sonnet opus develop" "$(jq -r '"\(.from) \(.to) \(.stage)"' "$(st f1)/failover-1.json")"
assert_eq "driver: failover-2 opus -> pi" "opus zai/glm-5.3 develop" "$(jq -r '"\(.from) \(.to) \(.stage)"' "$(st f1)/failover-2.json")"
assert_eq "driver: every failover says preflight" "preflight" "$(jq -r '.reason' "$(st f1)"/failover-*.json | sort -u)"
assert_eq "driver: the reviewer's start skipped opus too (one more failover) and used its pi entry" "1 prov/reviewer" \
  "$(jq -s '[.[] | select(.agent == "f1-review-r1")] | length' "$(st f1)"/failover-*.json) $(jq -r .model "$(st f1)/agents/f1-review-r1.json")"
assert_eq "driver: the reviewer's failover names its stage and round" "review 1" \
  "$(jq -rs '[.[] | select(.agent == "f1-review-r1")][0] | "\(.stage) \(.round)"' "$(st f1)"/failover-*.json)"
assert_ok "driver: the failover files match the schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$(st f1)/failover-2.json"
assert_eq "driver: loop.log has two FAILOVER lines for the dev" 2 "$(grep -c 'FAILOVER preflight develop' "$(st f1)/loop.log")"

# A dev list with nothing usable (the same snapshot) parks LIMIT, exit 2, resets_at set.
reset_fake; unit f2
write_cfg '[sonnet]'
snap - 97 60 3600
stub_start f2; run_loop f2; stub_stop
assert_eq "driver, every dev entry skipped: exit 2" 2 "$RC"
assert_eq "driver: result.json status PARKED" PARKED "$(jq -r .status "$(st f2)/result.json")"
assert_eq "driver: park.json status LIMIT" LIMIT "$(jq -r .status "$(st f2)/park.json")"
assert_eq "driver: park.json stage" develop "$(jq -r .stage "$(st f2)/park.json")"
assert_eq "driver: park.json names the agent that did not start" f2-dev "$(jq -r .agent "$(st f2)/park.json")"
assert_eq "driver: park.json carries resets_at (ISO)" "$(jq -nr --argjson t "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" '$t | todate')" \
  "$(jq -r .resets_at "$(st f2)/park.json")"
assert_ok "driver: park.json matches the park schema" validate_verdict "$SCHEMAS_DIR/park.json" "$(st f2)/park.json"
assert_eq "driver: no agent was started" 0 "$(starts_of f2-dev)"
assert_eq "driver: one failover file for the one skipped entry" 1 "$(ls "$(st f2)"/failover-*.json | wc -l | tr -d ' ')"
assert_eq "driver: stdout carries the park" LIMIT "$(jq -r .park.status <<<"$OUT")"

# Resume once the quota is back (the snapshot is gone): the same unit starts and finishes.
no_quota
stub_start f2; run_loop f2; stub_stop
[[ "$RC" == 0 ]] || dump f2
assert_eq "driver, resumed with the quota back: READY" 0 "$RC"
assert_eq "driver: the dev started on the first model this time" 1 "$(starts_of f2-dev)"
assert_contains "driver: on sonnet" "$(grep '"start"' "$SHIP_MUX_FAKE_LOG" | grep f2-dev | head -n 1)" '"sonnet"'

# No snapshot at all: the first model, no failover files, no FAILOVER log line.
reset_fake; unit f3
write_cfg '[sonnet, opus, zai/glm-5.3]'
no_quota
stub_start f3; run_loop f3; stub_stop
assert_eq "driver, no snapshot: READY" 0 "$RC"
assert_eq "driver, no snapshot: no failover files" 0 "$(ls "$(st f3)"/failover-*.json 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "driver, no snapshot: sonnet" sonnet "$(jq -r .model "$(st f3)/agents/f3-dev.json")"

# A stale snapshot skips nothing in the driver either.
reset_fake; unit f4
snap - 97 7200 3600
stub_start f4; run_loop f4; stub_stop
assert_eq "driver, stale snapshot: READY" 0 "$RC"
assert_eq "driver, stale snapshot: no failover files" 0 "$(ls "$(st f4)"/failover-*.json 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "driver, stale snapshot: sonnet" sonnet "$(jq -r .model "$(st f4)/agents/f4-dev.json")"
no_quota

# --- constraints --------------------------------------------------------------------------------------

assert_ok "the tap passes bash -n" bash -n "$TAP"
assert_eq "C-1: no husk, forge, user path or host literal in the tap" "" "$(grep -niE 'husk|forge|/work/|/Users/' "$TAP")"
assert_eq "C-11: the tap does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$TAP")"
REAL_AFTER="$(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.cache/hyper is unchanged" "$REAL_BEFORE" "$REAL_AFTER"
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac

stub_stop
finish
