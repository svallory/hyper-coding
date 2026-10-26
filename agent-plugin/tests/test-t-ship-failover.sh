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
#   reactive       (1)-(6): a limit seen on an agent's screen is recorded, the agent stopped, STATUS.md written and the stage
#                  restarted on the next model with the takeover prompt; see the section below

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
# Every driver run is bounded, so a mutant that never finishes fails (124) instead of hanging the suite.
TMO=()
if command -v timeout >/dev/null 2>&1; then TMO=(timeout 120); elif command -v gtimeout >/dev/null 2>&1; then TMO=(gtimeout 120); fi
run_loop() {
  local ref="$1"; shift
  OUT="$("${TMO[@]}" bash "$LOOP" --ref "$ref" --worktree "$SPACE/worktrees/$ref" --branch "feat-$ref" --brief "$BRIEF" --class S "$@" 2>"$FIX/err-$ref.log")"
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

# --- reactive failover (T-15) ---------------------------------------------------------------------------
# A limit seen on an agent's screen: the agent is stopped, STATUS.md is written, and the same stage restarts
# on the next model with the takeover prompt. The limit text is put on the agent's screen right after its first prompt
# is sent (fixtures/ship/limitmux: the driver only looks at the newest lines); closing the pane drops it, so a
# successor starts clean. `claude -p` and `pi -p` are stubs.

export SHIP_FAILOVER_STOP_MS=100
export SHIP_SUMMARY_TIMEOUT_S=60
export LIMITMUX_REAL="$SCRIPTS_DIR/ship/ship-mux" SHIP_LOOP_MUX="$TESTS_DIR/fixtures/ship/limitmux"

# `claude -p` stub: records its arguments and stdin; the mode (from $FIX/summarizer.mode) is
#   ok       a valid note
#   fail     exit 1, no note
#   hang     never returns
#   badexit  a valid note, but exit 1
#   quote    a valid note whose text quotes the provider's limit wording
cat >"$FIX/bin/claude" <<'EOF'
#!/bin/sh
case " $* " in *" -p "*) ;; *) exit 0 ;; esac
echo "$*" >>"$FIX_DIR/claude-p.args"
cat >>"$FIX_DIR/claude-p.stdin"
mode="$(cat "$FIX_DIR/summarizer.mode" 2>/dev/null)"
case "$mode" in
  fail) echo "boom" >&2; exit 1 ;;
  hang) exec sleep 120 ;;
  custom)
    printf '## Done\nThe agent saw a zzz-custom-limit message today.\n\n## In progress\nNothing.\n\n## Next steps\n1. Finish.\n\n## Open questions\nNone.\n'
    exit 0 ;;
  quote)
    printf 'Here is the note.\n\n## Done\nThe agent saw "You'"'"'ve hit your Sonnet limit" and then "Error: 429 Too Many Requests".\n\n## In progress\nThe rate limit exceeded handler.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
    exit 0 ;;
esac
printf 'Here is the note.\n\n## Done\nWrote the parser.\n\n## In progress\nHalf of the tests.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
[ "$mode" = badexit ] && exit 1
exit 0
EOF
chmod +x "$FIX/bin/claude"
# `pi -p` stub (the pi summariser): records its arguments, prints a valid note.
cat >"$FIX/bin/pi" <<'EOF'
#!/bin/sh
case " $* " in *" -p "*) ;; *) exit 0 ;; esac
echo "$*" >>"$FIX_DIR/pi-p.args"
printf '## Done\nWrote the parser.\n\n## In progress\nHalf of the tests.\n\n## Next steps\n1. Finish the tests.\n\n## Open questions\nNone.\n'
EOF
chmod +x "$FIX/bin/pi"
export FIX_DIR="$FIX"
printf 'ok\n' >"$FIX/summarizer.mode"
# A fixed session id, so the test can put a transcript where the driver will look for it.
SESSION_ID=11111111-2222-3333-4444-555555555555
printf '#!/bin/sh\necho %s\n' "$SESSION_ID" >"$FIX/bin/uuidgen"; chmod +x "$FIX/bin/uuidgen"
mkdir -p "$HOME/.claude/projects/proj"
printf '{"type":"user"}\n' >"$HOME/.claude/projects/proj/$SESSION_ID.jsonl"

rwrite_cfg() { write_cfg "$1"; } # dev list; the default limit patterns apply
# runit <ref> — a unit whose dev does not answer until it is told to (see answer_after_takeover); the reviewer does.
runit() {
  unit "$1"
  rm -f "$FIX/scripts/$1/develop.json"
}
GATE_PID=""
# answer_after_takeover <ref> <verdict file> <json> — the stub agent may answer <file> once some agent has been
# sent the takeover prompt (polls for the condition; gives up after about a minute).
answer_after_takeover() {
  (
    n=0
    while [[ $n -lt 1200 ]]; do
      if grep -qs 'taking over' "$SHIP_MUX_FAKE_DIR"/sent/* 2>/dev/null; then
        printf '%s\n' "$3" >"$FIX/scripts/$1/$2.1.tmp" && mv "$FIX/scripts/$1/$2.1.tmp" "$FIX/scripts/$1/$2.1"
        exit 0
      fi
      n=$((n + 1)); sleep 0.05
    done
  ) &
  GATE_PID=$!
}
# answer_after_screen <ref> <verdict file> <json> <text> — the stub agent may answer <file> once <text> has been on
# a pane's screen and the driver has read the screens six more times (so the driver has looked at it).
answer_after_screen() {
  (
    n=0; seen=-1
    while [[ $n -lt 1200 ]]; do
      if [[ $seen -lt 0 ]]; then
        if grep -qs -e "$4" "$SHIP_MUX_FAKE_DIR"/screen/* 2>/dev/null; then seen="$(grep -c '"verb":"read"' "$SHIP_MUX_FAKE_LOG")"; fi
      elif [[ "$(grep -c '"verb":"read"' "$SHIP_MUX_FAKE_LOG")" -ge $((seen + 6)) ]]; then
        printf '%s\n' "$3" >"$FIX/scripts/$1/$2.1.tmp" && mv "$FIX/scripts/$1/$2.1.tmp" "$FIX/scripts/$1/$2.1"
        exit 0
      fi
      n=$((n + 1)); sleep 0.05
    done
  ) &
  GATE_PID=$!
}
# write_after_takeover <ref> <verdict file name> <json> — writes the verdict itself (the stub's counter for that file
# is past it) once some agent was sent the takeover prompt and the stage is marked as prompted.
write_after_takeover() {
  (
    n=0
    while [[ $n -lt 1200 ]]; do
      if grep -qs 'taking over' "$SHIP_MUX_FAKE_DIR"/sent/* 2>/dev/null && [[ -s "$(st "$1")/$2.sent" ]]; then
        printf '%s\n' "$3" >"$(st "$1")/$2.tmp" && mv "$(st "$1")/$2.tmp" "$(st "$1")/$2"
        exit 0
      fi
      n=$((n + 1)); sleep 0.05
    done
  ) &
  GATE_PID=$!
}
gate_stop() { [[ -z "$GATE_PID" ]] || { kill "$GATE_PID" 2>/dev/null; wait "$GATE_PID" 2>/dev/null; GATE_PID=""; }; }
# limit_screen <agent name> <text> — what the agent's pane shows
limit_screen() { mkdir -p "$SHIP_MUX_FAKE_DIR/after-send"; printf '%s\n' "$2" >"$SHIP_MUX_FAKE_DIR/after-send/$1"; }
# blocked_screen <agent name> <text> — the same, but the agent is also reported as blocked (a dialog)
blocked_screen() { limit_screen "$1" "$2"; mkdir -p "$SHIP_MUX_FAKE_DIR/after-send-status"; echo blocked >"$SHIP_MUX_FAKE_DIR/after-send-status/$1"; }
# next_screen <agent name> <file> — after the agent is replaced, its successor's pane shows <file>
next_screen() { mkdir -p "$SHIP_MUX_FAKE_DIR/after-send-next"; printf '@%s\n' "$2" >"$SHIP_MUX_FAKE_DIR/after-send-next/$1"; }
sum_cfg() { printf 'failover:\n  summarizer: [%s]\n' "$1" >>"$PROJECT"; } # after rwrite_cfg
sent_all() { cat "$SHIP_MUX_FAKE_DIR/sent/$(jq -r .id "$(st "$1")/agents/$2.json")" 2>/dev/null; }
# dev_fcount_of <ref> — failover files of the dev only (an account limit also makes the reviewer skip its claude entry)
dev_fcount_of() { jq -s --arg a "$1-dev" '[.[] | select(.agent == $a)] | length' "$(st "$1")"/failover-*.json 2>/dev/null || echo 0; }
fcount_of() { ls "$(st "$1")"/failover-*.json 2>/dev/null | wc -l | tr -d ' '; }
r_run() { # ref — gate, stub, driver, with a dump on failure
  stub_start "$1"; run_loop "$1"; stub_stop; gate_stop
  [[ "$RC" == "${2:-0}" ]] || dump "$1"
}
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"

# (1) The dev on [sonnet, zai/glm-5.3] hits a Sonnet limit: STATUS.md has the four sections, the pi agent is given the
# takeover prompt with STATUS.md and the brief, the unit ends READY with one failover.
reset_fake; no_quota; runit r1
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r1-dev "You've hit your Sonnet limit · resets 4pm"
answer_after_takeover r1 develop.json "$DEV_DONE"
r_run r1
assert_eq "(1) reactive: READY" 0 "$RC"
assert_eq "(1) result.json status" READY "$(jq -r .status "$(st r1)/result.json")"
assert_eq "(1) result.json failovers is 1" 1 "$(jq -r .failovers "$(st r1)/result.json")"
assert_ok "(1) result.json matches the schema" validate_verdict "$SCHEMAS_DIR/result.json" "$(st r1)/result.json"
assert_eq "(1) one failover file" 1 "$(fcount_of r1)"
F1="$(st r1)/failover-1.json"
assert_ok "(1) failover-1 matches the failover schema" validate_verdict "$SCHEMAS_DIR/failover.json" "$F1"
assert_eq "(1) failover-1: reason, stage, agent" "limit develop r1-dev" "$(jq -r '"\(.reason) \(.stage) \(.agent)"' "$F1")"
assert_eq "(1) failover-1: from sonnet to the pi entry" "sonnet zai/glm-5.3" "$(jq -r '"\(.from) \(.to)"' "$F1")"
assert_eq "(1) failover-1: a named model is a model limit" model "$(jq -r .limit_kind "$F1")"
assert_contains "(1) failover-1: the matched screen text" "$(jq -r .matched "$F1")" "Sonnet limit"
assert_eq "(1) failover-1: the summariser" haiku "$(jq -r .summarizer "$F1")"
assert_eq "(1) failover-1: names STATUS.md" "$(st r1)/STATUS.md" "$(jq -r .status_md "$F1")"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do
  assert_contains "(1) STATUS.md has '$sec'" "$(cat "$(st r1)/STATUS.md")" "$sec"
done
assert_eq "(1) STATUS.md starts at the first section (the summariser's preface is dropped)" "## Done" "$(head -n 1 "$(st r1)/STATUS.md")"
assert_eq "(1) the summariser ran headless on haiku" 1 "$(grep -c -e '-p --model haiku' "$FIX/claude-p.args")"
CP="$(cat "$FIX/claude-p.args")"
assert_contains "(1) the summariser has no MCP (strict config)" "$CP" "--strict-mcp-config"
assert_contains "(1) the summariser runs under the role settings" "$CP" "--settings"
assert_contains "(1) the summariser has the Read tool only" "$CP" "--tools Read"
assert_not_contains "(1) the summariser has no Bash" "$CP" "Bash"
assert_contains "(1) the summariser keeps no session" "$CP" "--no-session-persistence"
assert_not_contains "(1) the summariser is not told to write anywhere" "$(cat "$FIX/claude-p.stdin")" "--output"
assert_contains "(1) the summariser was told where the transcript is" "$(cat "$FIX/claude-p.stdin")" "$HOME/.claude/projects/proj/$SESSION_ID.jsonl"
assert_contains "(1) the summariser was told the worktree" "$(cat "$FIX/claude-p.stdin")" "$SPACE/worktrees/r1"
assert_eq "(1) the dev was started twice" 2 "$(starts_of r1-dev)"
assert_eq "(1) the second start is the pi entry" "zai/glm-5.3" "$(jq -r .model "$(st r1)/agents/r1-dev.json")"
assert_eq "(1) as a pi agent" pi "$(jq -r .harness "$(st r1)/agents/r1-dev.json")"
TK="$(sent_all r1 r1-dev)"
assert_eq "(1) the pi agent got exactly one prompt" 1 "$(grep -c 'taking over' <<<"$TK")"
assert_contains "(1) the takeover prompt names STATUS.md" "$TK" "$(st r1)/STATUS.md"
assert_contains "(1) the takeover prompt names the brief" "$TK" "$BRIEF"
assert_contains "(1) the takeover prompt carries the stage prompt (the verdict file to write)" "$TK" "$(st r1)/develop.json"
assert_contains "(1) the takeover prompt says who replaced whom" "$TK" "sonnet was replaced by zai/glm-5.3"
assert_eq "(1) the takeover prompt does not trip the pi limit pattern" "" \
  "$(jq -Rr --arg re '(?i)^[^[:alnum:]+>-]*((((api |provider |http )?error:?|✗)\\s*(429\\s*)?|429\\s*)((too many requests|status code( 429)?)\\s*([.!]|:.*|[({\\[].*)?\\s*$|resource_exhausted)|(((api |provider |http )?error:?|✗)\\s*)?(429\\b.*rate_limit_error|429\\b.{0,30}rate.?limit|\\{"error":\\{"code":"?(1302|1308)\\b|(rate|usage) limit (has been )?(reached|exceeded|hit)( for .*)?\\s*[.!]?\\s*$|quota (has been )?exceeded([.!,:]|\\s*$|\\sfor\\s)|(you )?exceeded (your|the) (current )?(quota|rate limit|usage limit)([.!,:]|\\s*$)))' 'select(test($re))' <<<"$TK")"
OLD="$(grep -l '/exit' "$SHIP_MUX_FAKE_DIR"/sent/* | head -n 1)"
assert_contains "(1) the limited claude agent got esc" "$(cat "$OLD")" "<keys:esc>"
assert_contains "(1) the limited claude agent got /exit" "$(cat "$OLD")" "/exit"
assert_eq "(1) the stage's prompt marker was cleared on replacement: one line" 1 "$(wc -l <"$(st r1)/develop.json.sent" | tr -d ' ')"
assert_eq "(1) develop.json carries failovers" 1 "$(jq -r .failovers "$(st r1)/develop.json")"
assert_eq "(1) the reviewer's verdict carries 0" 0 "$(jq -r '.failovers // "none"' "$(st r1)/review-r1.json")"
assert_eq "(1) loop.log has one FAILOVER limit line" 1 "$(grep -c 'FAILOVER limit develop' "$(st r1)/loop.log")"
assert_eq "(1) limited.json: the model, not the account" "sonnet" "$(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) limited.json: no account entry" null "$(jq -r '.accounts // null' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) limited.json: until is in the future (cooldown)" true "$(jq -r --argjson n "$(date +%s)" '.models.sonnet.until > $n' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(1) the limited agent's pane was closed: one live agent named r1-dev" r1-dev \
  "$(jq -rs '[.[] | select(.kind == "agent") | .name] | join(" ")' "$SHIP_MUX_FAKE_DIR"/state/*.json)"
assert_eq "(1) the PR branch was pushed after the failover" "$(git -C "$SPACE/worktrees/r1" rev-parse HEAD)" "$(git -C "$FIX/origin-r1.git" rev-parse refs/heads/feat-r1)"

# (5) A second unit started after (1) skips sonnet preflight, through limited.json, and starts on pi.
reset_fake; unit r5
rwrite_cfg '[sonnet, zai/glm-5.3]'
r_run r5
assert_eq "(5) the second unit is READY" 0 "$RC"
assert_eq "(5) its dev started on the pi entry" "zai/glm-5.3" "$(jq -r .model "$(st r5)/agents/r5-dev.json")"
assert_eq "(5) it was started once" 1 "$(starts_of r5-dev)"
assert_eq "(5) failover-1: a preflight skip of sonnet, a model limit" "preflight sonnet model" \
  "$(jq -r '"\(.reason) \(.from) \(.limit_kind)"' "$(st r5)/failover-1.json")"
assert_eq "(5) result.json counts it" 1 "$(jq -r .failovers "$(st r5)/result.json")"

# (2) Only [sonnet]: the list is exhausted, the unit parks LIMIT (exit 2) with resets_at from the snapshot.
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"
reset_fake; no_quota; runit r2
rwrite_cfg '[sonnet]'
snap 40 94 60 7200   # below the 95% threshold: preflight starts the dev; the limit hits later
limit_screen r2-dev "You've hit your limit · resets 4pm"
r_run r2 2
assert_eq "(2) exit 2" 2 "$RC"
assert_eq "(2) result.json status PARKED" PARKED "$(jq -r .status "$(st r2)/result.json")"
assert_eq "(2) park.json status LIMIT" LIMIT "$(jq -r .status "$(st r2)/park.json")"
assert_eq "(2) park.json names the stage and the agent" "develop r2-dev" "$(jq -r '"\(.stage) \(.agent)"' "$(st r2)/park.json")"
assert_eq "(2) park.json resets_at is the snapshot's (the fullest window)" \
  "$(jq -nr --argjson t "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" '$t | todate')" \
  "$(jq -r .resets_at "$(st r2)/park.json")"
assert_ok "(2) park.json matches the park schema" validate_verdict "$SCHEMAS_DIR/park.json" "$(st r2)/park.json"
assert_eq "(2) a plain limit is an account limit in limited.json, until = resets_at" \
  "$(jq -r .rate_limits.seven_day.resets_at "$SHIP_QUOTA_DIR/claude-default.json")" "$(jq -r '.accounts.default.until' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(2) the dev was started once and left alone (no keys sent)" "1 0" "$(starts_of r2-dev) $(cat "$SHIP_MUX_FAKE_DIR/sent/$(jq -r .id "$(st r2)/agents/r2-dev.json")" 2>/dev/null | grep -c keys)"
assert_eq "(2) no failover file, no summariser" "0 absent" "$(fcount_of r2) $([[ -e "$FIX/claude-p.args" ]] && echo present || echo absent)"
rm -f "$FIX/claude-p.args" "$FIX/claude-p.stdin"

# (3) The summariser itself is limited (the account is the one limited, so haiku is skipped): the git-facts STATUS.md.
reset_fake; no_quota; runit r3
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r3-dev "You've hit your limit · resets 4pm"
answer_after_takeover r3 develop.json "$DEV_DONE"
r_run r3
assert_eq "(3) READY" 0 "$RC"
S3="$(cat "$(st r3)/STATUS.md")"
assert_contains "(3) STATUS.md says the transcript was not summarised" "$S3" "transcript not summarised"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do assert_contains "(3) STATUS.md has '$sec'" "$S3" "$sec"; done
assert_contains "(3) STATUS.md lists the commit from git" "$S3" "feat: the change"
assert_contains "(3) STATUS.md lists the changed file" "$S3" "feat.txt"
assert_eq "(3) the summariser's skip is not a failover (only the dev's and the reviewer's preflight files exist)" "r3-dev r3-review-r1" \
  "$(jq -rs '[.[].agent] | unique | join(" ")' "$(st r3)"/failover-*.json)"
assert_eq "(3) no failover file is for the summariser's model" 0 "$(jq -s '[.[] | select(.from == "haiku" or .to == "haiku")] | length' "$(st r3)"/failover-*.json)"
assert_eq "(3) no summariser ran" absent "$([[ -e "$FIX/claude-p.args" ]] && echo present || echo absent)"
assert_eq "(3) failover-1: no summariser recorded, an account limit" "null account" "$(jq -r '"\(.summarizer) \(.limit_kind)"' "$(st r3)/failover-1.json")"
assert_eq "(3) limited.json: the account" default "$(jq -r '.accounts | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(3) the pi agent still got the takeover prompt" 1 "$(sent_all r3 r3-dev | grep -c 'taking over')"
# uncommitted work shows up under In progress
reset_fake; no_quota; runit r3b
rwrite_cfg '[sonnet, zai/glm-5.3]'
echo wip >"$SPACE/worktrees/r3b/half-done.txt"
limit_screen r3b-dev "You've hit your limit · resets 4pm"
answer_after_takeover r3b develop.json "$DEV_DONE"
r_run r3b
assert_contains "(3) uncommitted files are listed" "$(cat "$(st r3b)/STATUS.md")" "half-done.txt"
rm -f "$SPACE/worktrees/r3b/half-done.txt"

# (3b) A summariser that fails, and one that never returns, give the same fallback.
for mode in fail hang badexit; do
  reset_fake; no_quota; runit "r3$mode"
  rwrite_cfg '[sonnet, zai/glm-5.3]'
  printf '%s\n' "$mode" >"$FIX/summarizer.mode"
  limit_screen "r3$mode-dev" "You've hit your Sonnet limit"
  answer_after_takeover "r3$mode" develop.json "$DEV_DONE"
  if [[ "$mode" == hang ]]; then export SHIP_SUMMARY_TIMEOUT_S=1; fi
  r_run "r3$mode"
  export SHIP_SUMMARY_TIMEOUT_S=60
  assert_eq "(3b, $mode) READY" 0 "$RC"
  assert_contains "(3b, $mode) git-facts STATUS.md" "$(cat "$(st "r3$mode")/STATUS.md")" "transcript not summarised"
  assert_eq "(3b, $mode) failover-1 records no summariser" null "$(jq -r .summarizer "$(st "r3$mode")/failover-1.json")"
done
printf 'ok\n' >"$FIX/summarizer.mode"

# (4) An Opus limit skips only opus: the dev goes opus -> sonnet; limited.json names the model, not the account.
reset_fake; no_quota; runit r4
rwrite_cfg '[opus, sonnet, zai/glm-5.3]'
limit_screen r4-dev "You've hit your Opus limit · resets 4pm"
answer_after_takeover r4 develop.json "$DEV_DONE"
r_run r4
assert_eq "(4) READY" 0 "$RC"
assert_eq "(4) failover-1: opus -> sonnet, a model limit" "opus sonnet model" "$(jq -r '"\(.from) \(.to) \(.limit_kind)"' "$(st r4)/failover-1.json")"
assert_eq "(4) the dev restarted on sonnet" sonnet "$(jq -r .model "$(st r4)/agents/r4-dev.json")"
assert_eq "(4) as a claude agent" claude "$(jq -r .harness "$(st r4)/agents/r4-dev.json")"
assert_eq "(4) limited.json holds opus only" "opus" "$(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(4) limited.json holds no account" null "$(jq -r '.accounts // null' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(4) the summariser (haiku) was usable and used" haiku "$(jq -r .summarizer "$(st r4)/failover-1.json")"
cfg dev '["sonnet","opus","zai/glm-5.3"]'
STATE="$FIX/state-a"; fclear
pick --dry dev
assert_eq "(4) afterwards a walk skips opus only (sonnet first)" sonnet "$PICK_MODEL"
cfg dev '["opus","sonnet"]'
pick dev
assert_eq "(4) a walk over [opus, sonnet] skips opus, picks sonnet" "sonnet 1" "$PICK_MODEL $(fcount)"
fclear; unset STATE SHIP_CONFIG_JSON

# (6) A reviewer (a fresh agent per stage) fails over too: its verdict carries the count.
reset_fake; no_quota; unit r6
rwrite_cfg '[sonnet]'
limit_screen r6-review-r1 "You've hit your Opus limit"
rm -f "$FIX/scripts/r6/review-r1.json"
answer_after_takeover r6 review-r1.json "$REV_OK"
r_run r6
assert_eq "(6) READY" 0 "$RC"
assert_eq "(6) the reviewer failed over from opus to its pi entry" "limit review opus prov/reviewer" \
  "$(jq -r '"\(.reason) \(.stage) \(.from) \(.to)"' "$(st r6)/failover-1.json")"
assert_eq "(6) review-r1.json carries failovers 1" 1 "$(jq -r .failovers "$(st r6)/review-r1.json")"
assert_eq "(6) result.json counts it" 1 "$(jq -r .failovers "$(st r6)/result.json")"
assert_eq "(6) the dev's verdict carries 0" 0 "$(jq -r '.failovers // 0' "$(st r6)/develop.json")"

# (7) Claude shows its limit as a dialog, which reads as blocked: it still fails over (not a DIALOG park).
reset_fake; no_quota; runit r7
rwrite_cfg '[sonnet, zai/glm-5.3]'
blocked_screen r7-dev "You've hit your Sonnet limit · resets 4pm"
answer_after_takeover r7 develop.json "$DEV_DONE"
r_run r7
assert_eq "(7) a limit shown as a blocked dialog: READY" 0 "$RC"
assert_eq "(7) it failed over once, reason limit" "1 limit" "$(fcount_of r7) $(jq -r .reason "$(st r7)/failover-1.json")"
assert_eq "(7) no DIALOG park was written" absent "$([[ -e "$(st r7)/park.json" ]] && echo present || echo absent)"

# (8) The limit wording is matched case-insensitively and its word is lowercased: an Opus limit in capitals is a model limit.
reset_fake; no_quota; runit r8
rwrite_cfg '[opus, zai/glm-5.3]'
limit_screen r8-dev "YOU'VE HIT YOUR OPUS LIMIT"
answer_after_takeover r8 develop.json "$DEV_DONE"
r_run r8
assert_eq "(8) READY" 0 "$RC"
assert_eq "(8) a model limit on opus (not the account, not sonnet)" "model opus" "$(jq -r .limit_kind "$(st r8)/failover-1.json") $(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(8) limited.json holds no account" null "$(jq -r '.accounts // null' "$SHIP_QUOTA_DIR/limited.json")"

# (9) "weekly" names a window, not a model: an account limit.
reset_fake; no_quota; runit r9
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r9-dev "You've hit your weekly limit · resets Fri"
answer_after_takeover r9 develop.json "$DEV_DONE"
r_run r9
assert_eq "(9) READY" 0 "$RC"
assert_eq "(9) an account limit" "account default" "$(jq -r .limit_kind "$(st r9)/failover-1.json") $(jq -r '.accounts | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(9) limited.json holds no model" null "$(jq -r '.models // null' "$SHIP_QUOTA_DIR/limited.json")"

# (10) A pi agent whose screen only has code and findings that look like a limit does not fail over.
reset_fake; no_quota; runit r10
rwrite_cfg '[zai/glm-5.3, prov/second]'
limit_screen r10-dev "the finding at ship-loop:429 and src/x.sh:429: handler
// retry on a rate limit
usage limit docs"
answer_after_screen r10 develop.json "$DEV_DONE" "ship-loop:429"
r_run r10
assert_eq "(10) READY" 0 "$RC"
assert_eq "(10) no failover, one start" "0 1" "$(fcount_of r10) $(starts_of r10-dev)"
# ... and the real thing does
reset_fake; no_quota; runit r10b
rwrite_cfg '[zai/glm-5.3, prov/second]'
limit_screen r10b-dev "Error: 429 Too Many Requests"
answer_after_takeover r10b develop.json "$DEV_DONE"
r_run r10b
assert_eq "(10b) READY" 0 "$RC"
assert_eq "(10b) pi failed over to pi" "zai/glm-5.3 prov/second model" "$(jq -r '"\(.from) \(.to) \(.limit_kind)"' "$(st r10b)/failover-1.json")"

# (11) A summariser that quotes the limit wording does not make the successor fail over again: STATUS.md is scrubbed.
reset_fake; no_quota; runit r11
rwrite_cfg '[sonnet, zai/glm-5.3, prov/second]'
printf 'quote\n' >"$FIX/summarizer.mode"
limit_screen r11-dev "You've hit your Sonnet limit"
next_screen r11-dev "$(st r11)/STATUS.md"
answer_after_screen r11 develop.json "$DEV_DONE" "## Done"
r_run r11
printf 'ok\n' >"$FIX/summarizer.mode"
assert_eq "(11) READY" 0 "$RC"
assert_eq "(11) one failover only (the successor read STATUS.md and kept going)" 1 "$(fcount_of r11)"
S11="$(cat "$(st r11)/STATUS.md")"
assert_not_contains "(11) STATUS.md has no limit sentence" "$S11" "hit your"
assert_not_contains "(11) STATUS.md has no 429 line" "$S11" "429"
assert_not_contains "(11) STATUS.md has no 'rate limit' line" "$S11" "rate limit"
assert_contains "(11) the removed lines are marked" "$S11" "[line removed"
assert_contains "(11) the other sections survive" "$S11" "Finish the tests"
for sec in "## Done" "## In progress" "## Next steps" "## Open questions"; do assert_contains "(11) STATUS.md has '$sec'" "$S11" "$sec"; done

# (12) A failover in a fix round records the real stage and round, and the verdicts count their own.
reset_fake; no_quota; unit r12
rwrite_cfg '[sonnet, zai/glm-5.3]'
printf '%s\n' '{"verdict":"CHANGES","findings":[{"severity":"BLOCKING","file":"a.go","line":3,"summary":"the bug","fix":"change it"}]}' >"$FIX/scripts/r12/review-r1.json"
printf '%s\n' "$REV_OK" >"$FIX/scripts/r12/review-r2.json"
limit_screen r12-dev "You've hit your Sonnet limit"
# the first prompt (develop) gets no limit text; the second one (the fix round) does
mv "$SHIP_MUX_FAKE_DIR/after-send/r12-dev" "$SHIP_MUX_FAKE_DIR/after-send/r12-dev.2"
answer_after_takeover r12 fix-r2.json "$DEV_DONE"
r_run r12
assert_eq "(12) READY" 0 "$RC"
assert_eq "(12) one failover file" 1 "$(fcount_of r12)"
assert_eq "(12) it names the fix stage and round 2" "fix 2" "$(jq -r '"\(.stage) \(.round)"' "$(st r12)/failover-1.json")"
assert_eq "(12) fix-r2.json counts it" 1 "$(jq -r .failovers "$(st r12)/fix-r2.json")"
assert_eq "(12) develop.json does not" 0 "$(jq -r '.failovers // 0' "$(st r12)/develop.json")"
assert_eq "(12) result.json counts every failover file" 1 "$(jq -r .failovers "$(st r12)/result.json")"

# (13) The summariser can be a pi model: read-only, no session, no --approve.
reset_fake; no_quota; runit r13
rwrite_cfg '[sonnet, prov/second]'
sum_cfg 'zai/glm-5.3'
rm -f "$FIX/pi-p.args"
limit_screen r13-dev "You've hit your Sonnet limit"
answer_after_takeover r13 develop.json "$DEV_DONE"
r_run r13
assert_eq "(13) READY" 0 "$RC"
assert_eq "(13) the summariser is the pi model" zai/glm-5.3 "$(jq -r .summarizer "$(st r13)/failover-1.json")"
PA="$(cat "$FIX/pi-p.args" 2>/dev/null)"
assert_contains "(13) pi summariser: --no-session" "$PA" "--no-session"
assert_contains "(13) pi summariser: read tool only" "$PA" "--tools read"
assert_not_contains "(13) pi summariser: no --approve" "$PA" "--approve"
assert_not_contains "(13) pi summariser: no write tools" "$PA" "bash"

# (14) A limit while the old pane cannot be closed: no second agent is started.
reset_fake; no_quota; runit r14
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r14-dev "You've hit your Sonnet limit"
mkdir -p "$SHIP_MUX_FAKE_DIR/close-fail"; : >"$SHIP_MUX_FAKE_DIR/close-fail/r14-dev"
r_run r14 2
assert_eq "(14) the unit parks (exit 2)" 2 "$RC"
assert_eq "(14) the dev was started once, no second agent with its name" 1 "$(starts_of r14-dev)"
assert_eq "(14) no successor was prompted" 0 "$(sent_all r14 r14-dev | grep -c 'taking over')"

# (15) A failover is an agent replacement: the successor gets the takeover text, the stage prompt, then the lead's answer again.
reset_fake; no_quota; unit r15
rm -f "$FIX/scripts/r15/develop.json"
printf '%s\n' '{"status":"QUESTION","pr":null,"head":null,"summary":"stuck","question":"Should EMPTY input fail?"}' >"$FIX/scripts/r15/develop.json.1"
rwrite_cfg '[sonnet, zai/glm-5.3]'
stub_start r15; run_loop r15
assert_eq "(15) the dev parks a QUESTION (exit 2)" 2 "$RC"
printf 'No: EMPTY input exits 2.\n' >"$(st r15)/answer-1.md"
limit_screen r15-dev "You've hit your Sonnet limit"
mv "$SHIP_MUX_FAKE_DIR/after-send/r15-dev" "$SHIP_MUX_FAKE_DIR/after-send/r15-dev.2"   # shown after the answer is delivered
write_after_takeover r15 develop.json "$DEV_DONE"
run_loop r15; stub_stop; gate_stop
[[ "$RC" == 0 ]] || dump r15
assert_eq "(15) READY after the answer and a failover" 0 "$RC"
TK15="$(sent_all r15 r15-dev)"
P_TAKE="${TK15%%taking over*}"; P_STAGE="${TK15%%The task you were handed follows*}"; P_ANS="${TK15%%No: EMPTY input exits 2.*}"
assert_contains "(15) the successor's prompt carries the takeover text" "$TK15" "taking over"
assert_contains "(15) ... the stage prompt" "$TK15" "$(st r15)/develop.json"
assert_contains "(15) ... and the lead's answer again" "$TK15" "No: EMPTY input exits 2."
assert_eq "(15) order: takeover text, then the stage prompt, then the answer" true \
  "$([[ ${#P_TAKE} -lt ${#P_STAGE} && ${#P_STAGE} -lt ${#P_ANS} ]] && echo true || echo false)"

# (16) The budget already used is not reset by a failover: the clock keeps counting.
reset_fake; no_quota; runit r16
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r16-dev "You've hit your Sonnet limit"
mkdir -p "$SHIP_MUX_FAKE_DIR/after-send-delay"; echo 4 >"$SHIP_MUX_FAKE_DIR/after-send-delay/r16-dev"
answer_after_takeover r16 develop.json "$DEV_DONE"
r_run r16
assert_eq "(16) READY" 0 "$RC"
assert_contains "(16) the log says the used time stays counted" "$(cat "$(st r16)/loop.log")" "used before the failover stay counted"
USED="$(grep -o 'budget: [0-9]*s used' "$(st r16)/loop.log" | head -n 1 | tr -dc '0-9')"
assert_eq "(16) at least 3s were used before the failover" true "$([[ -n "$USED" && "$USED" -ge 3 ]] && echo true || echo false)"
if [[ -s "$(st r16)/develop.json.clock" ]]; then
  assert_eq "(16) the clock after the failover is not below the time used before it" true \
    "$([[ "$(cat "$(st r16)/develop.json.clock")" -ge "$USED" ]] && echo true || echo false)"
fi

# (17) Quoted limit wording is not a limit: the default patterns are anchored to the start of a line.
CL_RE="$(sed -n "s/^    claude: '\(.*\)'$/\1/p" "$SCRIPTS_DIR/../skills/ship/defaults.yml")"
PI_RE="$(sed -n "s/^    pi: '\(.*\)'$/\1/p" "$SCRIPTS_DIR/../skills/ship/defaults.yml")"
NB="$(printf '\302\240')"   # a no-break space
REAL_CL="  ⎿ ${NB}You've hit your weekly limit · resets Oct 24, 4pm (America/Sao_Paulo)"   # the line Claude Code prints
m() { jq -Rn --arg re "$1" --arg l "$2" '$l | test($re)'; }
for l in "You've hit your Sonnet limit · resets 4pm" "You’ve hit your limit" "│ You've hit your weekly limit" "● YOU'VE HIT YOUR OPUS LIMIT" "You've hit your limit ∙ resets 4pm" "You've hit your limit" "  You've hit your weekly limit" "$REAL_CL"; do
  assert_eq "claude pattern fires on: $l" true "$(m "$CL_RE" "$l")"
done
# shellcheck disable=SC1111  # curly quotes are test data
for l in "Summary: limit_hit now matches \"You've hit your weekly limit\" and more" "+ You've hit your Sonnet limit" "│ + You've hit your Sonnet limit" "- You've hit your limit" "> You've hit your limit" "\"You've hit your weekly limit\" in the output" "12 + You've hit your limit" \
  "  You've hit your weekly limit fails over…" "You've hit your weekly limit. What do you want to do?" "“You've hit your limit”" "‘You’ve hit your limit’" "│ x You've hit your limit" "You've hit your limit and then more" "You've hit your limit · resumes"; do
  assert_eq "claude pattern ignores: $l" false "$(m "$CL_RE" "$l")"
done
for l in "Error: 429 Too Many Requests" "429 status code (no body)" "Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}" "Error: RESOURCE_EXHAUSTED: quota" "429 RESOURCE_EXHAUSTED: Resource has been exhausted" "Error: 429 RESOURCE_EXHAUSTED: Resource has been exhausted" "✗ too many requests" "Error: Too Many Requests" "429 Too Many Requests" "{\"error\":{\"code\":\"1302\",\"message\":\"Rate limit reached for requests\"}}" "{\"error\":{\"code\":1308,\"message\":\"x\"}}" "Usage limit reached for 5 hour" "Rate limit reached" "You exceeded your current quota, please check your plan" "Error: You exceeded your current quota" "│ Error: 429 status code" "error: status code 429"; do
  assert_eq "pi pattern fires on: $l" true "$(m "$PI_RE" "$l")"
done
for l in "retry with backoff when the API answers 429 Too Many Requests" "ship-loop:429" "src/x.sh:429: handler" "// retry on a rate limit" "- Error: 429 Too Many Requests" "+ Rate limit reached" "the code 1302 means something" "> RESOURCE_EXHAUSTED" \
  "Too many requests are retried" "too many requests" "RESOURCE_EXHAUSTED handling" "resource_exhausted" "status code" "status code 429 is retried" "Error handling: too many requests" "Handles RESOURCE_EXHAUSTED: Resource has been exhausted" \
  "rate limit reached errors are now retried with backoff" "quota exceeded is mapped to a retryable error" "429 status code handling added" "Error: Too Many Requests is now retried" "usage limit reached is logged"; do
  assert_eq "pi pattern ignores: $l" false "$(m "$PI_RE" "$l")"
done

# (18) V1: a pi dev idle after a summary quoting a 429 does not fail over.
reset_fake; no_quota; runit r18
rwrite_cfg '[zai/glm-5.3, prov/second]'
limit_screen r18-dev "Summary: added retry with backoff when the API answers 429 Too Many Requests"
answer_after_screen r18 develop.json "$DEV_DONE" "retry with backoff"
r_run r18
assert_eq "(18) V1: READY, no failover, one start" "0 0 1" "$RC $(fcount_of r18) $(starts_of r18-dev)"
# V3: a claude dev idle after a summary quoting the weekly wording records nothing
reset_fake; no_quota; runit r19
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r19-dev "Summary: limit_hit now matches \"You've hit your weekly limit\" and the
\"You've hit your weekly limit\" wording in the output is fine"
answer_after_screen r19 develop.json "$DEV_DONE" "limit_hit now matches"
r_run r19
assert_eq "(19) V3: READY, no failover, one start" "0 0 1" "$RC $(fcount_of r19) $(starts_of r19-dev)"
assert_eq "(19) V3: limited.json was not written" absent "$([[ -e "$SHIP_QUOTA_DIR/limited.json" ]] && echo present || echo absent)"
# B1: a wrapped line that starts with the wording, indented, is not the real message
reset_fake; no_quota; runit r22
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r22-dev "  You've hit your weekly limit fails over the unit when the
  You've hit your weekly limit is quoted in prose"
answer_after_screen r22 develop.json "$DEV_DONE" "fails over the unit"
r_run r22
assert_eq "(22) B1: READY, no failover, one start" "0 0 1" "$RC $(fcount_of r22) $(starts_of r22-dev)"
assert_eq "(22) B1: limited.json was not written" absent "$([[ -e "$SHIP_QUOTA_DIR/limited.json" ]] && echo present || echo absent)"
# V2: a claude dev blocked on an edit dialog whose diff has the wording parks DIALOG, no failover
reset_fake; no_quota; runit r20
rwrite_cfg '[sonnet, zai/glm-5.3]'
blocked_screen r20-dev "Edit file src/x.sh?
│ + You've hit your Sonnet limit
│ - old line"
r_run r20 2
assert_eq "(20) V2: parked DIALOG, no failover" "2 DIALOG 0" "$RC $(jq -r .status "$(st r20)/park.json") $(fcount_of r20)"
assert_eq "(20) V2: limited.json was not written" absent "$([[ -e "$SHIP_QUOTA_DIR/limited.json" ]] && echo present || echo absent)"

# (23) An invalid limits regex fails loudly at config load, naming the key.
reset_fake; unit r23
rwrite_cfg '[sonnet]'
printf 'limits:\n  patterns:\n    pi: "(unclosed"\n' >>"$PROJECT"
run_loop r23
assert_eq "(23) exit 1" 1 "$RC"
assert_contains "(23) the message names the key" "$(cat "$FIX/err-r23.log")" "limits.patterns.pi"
assert_contains "(23) and says it is not a valid regex" "$(cat "$FIX/err-r23.log")" "not a valid regex"
rwrite_cfg '[sonnet]'

# (24) The exact line Claude Code prints (indented, a glyph, a no-break space), idle and in the blocked dialog: both fail over.
reset_fake; no_quota; runit r24
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r24-dev "$REAL_CL"
answer_after_takeover r24 develop.json "$DEV_DONE"
r_run r24
assert_eq "(24) idle: READY after one account failover" "0 1 account" "$RC $(dev_fcount_of r24) $(jq -r .limit_kind "$(st r24)/failover-1.json")"
reset_fake; no_quota; runit r25
rwrite_cfg '[sonnet, zai/glm-5.3]'
blocked_screen r25-dev "$REAL_CL

What do you want to do?
❯ 1. Stop and wait for limit to reset
  2. Upgrade your plan"
answer_after_takeover r25 develop.json "$DEV_DONE"
r_run r25
assert_eq "(25) blocked dialog: READY after one account failover" "0 1 account" "$RC $(dev_fcount_of r25) $(jq -r .limit_kind "$(st r25)/failover-1.json")"
assert_eq "(25) no DIALOG park" absent "$([[ -e "$(st r25)/park.json" ]] && echo present || echo absent)"

# (26) STATUS.md is also scrubbed with the configured patterns, unanchored.
reset_fake; no_quota; runit r26
rwrite_cfg '[sonnet, zai/glm-5.3]'
printf 'limits:\n  patterns:\n    claude: "(?i)^zzz-custom-limit"\n' >>"$PROJECT"
printf 'custom\n' >"$FIX/summarizer.mode"
limit_screen r26-dev "zzz-custom-limit"
answer_after_takeover r26 develop.json "$DEV_DONE"
r_run r26
printf 'ok\n' >"$FIX/summarizer.mode"
assert_eq "(26) READY, one failover" "0 1" "$RC $(dev_fcount_of r26)"
assert_not_contains "(26) the configured wording is scrubbed from mid-line" "$(cat "$(st r26)/STATUS.md")" "zzz-custom-limit"
rwrite_cfg '[sonnet]'

# (27) A reviewer fails over; the diff changes before the successor's ACCEPT. That ACCEPT is not used to push:
# another review of the new diff is needed.
reset_fake; no_quota; unit r27
rwrite_cfg '[sonnet]'
limit_screen r27-review-r1 "You've hit your Opus limit"
rm -f "$FIX/scripts/r27/review-r1.json"
printf '%s\n' "$REV_OK" >"$FIX/scripts/r27/review-r2.json"
(
  n=0
  while [[ $n -lt 1200 ]]; do
    if grep -qs 'taking over' "$SHIP_MUX_FAKE_DIR"/sent/* 2>/dev/null && [[ -s "$(st r27)/review-r1.json.sent" ]]; then
      echo more >>"$SPACE/worktrees/r27/feat.txt"; git -C "$SPACE/worktrees/r27" commit -qam "feat: more"
      printf '%s\n' "$REV_OK" >"$(st r27)/review-r1.json.tmp" && mv "$(st r27)/review-r1.json.tmp" "$(st r27)/review-r1.json"
      exit 0
    fi
    n=$((n + 1)); sleep 0.05
  done
) &
GATE_PID=$!
r_run r27
assert_eq "(27) the unit finished READY" 0 "$RC"
assert_eq "(27) the old ACCEPT was not trusted: a second reviewer ran" 1 "$(starts_of r27-review-r2)"
assert_eq "(27) the pushed head is the reviewed one (after review 2)" "$(git -C "$SPACE/worktrees/r27" rev-parse HEAD)" "$(git -C "$FIX/origin-r27.git" rev-parse refs/heads/feat-r27)"

# (21) A limit on another model than the agent runs on is recorded; this agent keeps going.
reset_fake; no_quota; runit r21
rwrite_cfg '[sonnet, zai/glm-5.3]'
limit_screen r21-dev "You've hit your Opus limit · resets 4pm"
answer_after_screen r21 develop.json "$DEV_DONE" "Opus limit"
r_run r21
assert_eq "(21) READY, no failover of the dev, one start" "0 0 1" "$RC $(jq -s '[.[] | select(.agent == "r21-dev")] | length' "$(st r21)"/failover-*.json 2>/dev/null || echo 0) $(starts_of r21-dev)"
assert_eq "(21) opus is recorded in limited.json" opus "$(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "(21) no account is recorded" null "$(jq -r '.accounts // null' "$SHIP_QUOTA_DIR/limited.json")"

# --- limited.json: locking, records, clear -----------------------------------------------------------------
SAVED_Q="$SHIP_QUOTA_DIR"; export SHIP_QUOTA_DIR="$FIX/quota-lock"; rm -rf "$SHIP_QUOTA_DIR"; mkdir -p "$SHIP_QUOTA_DIR"
FARU=99999999999
jq -nc --argjson u "$FARU" '{accounts: {acct1: {until: $u}}, models: {m1: {until: $u}}}' >"$SHIP_QUOTA_DIR/limited.json"
ship_limit_record model m2 "$FARU"; ship_limit_record account acct2 "$FARU"
assert_eq "ship_limit_record keeps the other entries (models)" "m1,m2" "$(jq -r '.models | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "ship_limit_record keeps the other entries (accounts)" "acct1,acct2" "$(jq -r '.accounts | keys | join(",")' "$SHIP_QUOTA_DIR/limited.json")"
LPIDS=()
for i in 1 2 3 4 5 6 7 8; do ship_limit_record model "par$i" "$FARU" & LPIDS+=($!); done
LFAIL=0; for pid in "${LPIDS[@]}"; do wait "$pid" || LFAIL=$((LFAIL + 1)); done
assert_eq "8 parallel writers: every call succeeded" 0 "$LFAIL"
assert_eq "8 parallel writers: every entry is there" 10 "$(jq -r '.models | length' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "the lock is released" absent "$([[ -e "$SHIP_QUOTA_DIR/limited.json.lock" ]] && echo present || echo absent)"
# the race: 32 writers x 20 entries each, every one must survive
rm -f "$SHIP_QUOTA_DIR/limited.json"
RACE_OUT="$FIX/race.out"; : >"$RACE_OUT"
LPIDS=()
for w in $(seq 1 32); do
  ( for k in $(seq 1 20); do ship_limit_record model "w${w}k${k}" "$FARU" || echo "fail $w $k" >>"$RACE_OUT"; done ) & LPIDS+=($!)
done
for pid in "${LPIDS[@]}"; do wait "$pid"; done
assert_eq "race, 32 writers x 20: no call failed" "" "$(cat "$RACE_OUT")"
assert_eq "race, 32 writers x 20: all 640 entries are kept" 640 "$(jq -r '.models | length' "$SHIP_QUOTA_DIR/limited.json")"
# the lock itself: exactly one winner per round, on the file primitive
WON="$FIX/won"; rm -rf "$WON"; mkdir -p "$WON"
for round in $(seq 1 40); do
  LPIDS=()
  for w in 1 2 3 4 5 6 7 8; do ( if ship_lock "$FIX/rlock.$round" 0; then
        echo "$w" >"$WON/$round.$w"
        # the winner stays alive until the 7 others have tried: a dead owner's lock is taken over
        for _ in $(seq 1 200); do set -- "$WON"/t"$round".*; [[ -e "$1" && $# -ge 7 ]] && break; sleep 0.05; done
      else :; fi
      : >"$WON/t$round.$w" ) & LPIDS+=($!); done
  for pid in "${LPIDS[@]}"; do wait "$pid"; done
done
WCNT=0 WROUNDS=0
for round in $(seq 1 40); do set -- "$WON/$round".*; if [[ -e "$1" ]]; then WROUNDS=$((WROUNDS + 1)); WCNT=$((WCNT + $#)); fi; done
assert_eq "ship_lock: one winner in each of 40 contended rounds" "40 40" "$WROUNDS $WCNT"
rm -f "$FIX"/rlock.*
# takeover of a dead owner's lock by 8 concurrent waiters, with pauses injected at the race windows:
# never two holders at once, every waiter gets its turn, nothing is left behind (no lock, no .break)
LKT="$FIX/tk"; rm -rf "$LKT"; mkdir -p "$LKT"
LKBAD=0 LKGOT=0 LKLEFT=0
for round in $(seq 1 12); do
  rm -f "$LKT"/*
  echo "99999999@$(hostname)" >"$LKT/lock"
  LPIDS=()
  for w in 1 2 3 4 5 6 7 8; do
    (
      SHIP_LOCK_TEST_PAUSE=40 ship_lock "$LKT/lock" 60 || { echo "gave-up $w" >>"$LKT/bad"; exit 0; }
      if ( set -C; echo "$w" >"$LKT/inside" ) 2>/dev/null; then sleep 0.02; rm -f "$LKT/inside"; else echo "overlap $w" >>"$LKT/bad"; fi
      echo "$w" >>"$LKT/got"
      ship_unlock "$LKT/lock"
    ) & LPIDS+=($!)
  done
  for pid in "${LPIDS[@]}"; do wait "$pid"; done
  [[ ! -s "$LKT/bad" ]] || LKBAD=$((LKBAD + 1))
  [[ "$(wc -l <"$LKT/got" 2>/dev/null | tr -d ' ')" == 8 ]] && LKGOT=$((LKGOT + 1))
  [[ ! -e "$LKT/lock" && ! -e "$LKT/lock.break" && ! -e "$LKT/inside" ]] || LKLEFT=$((LKLEFT + 1))
done
assert_eq "takeover race, 12 rounds x 8 waiters: never two holders, nobody gave up" 0 "$LKBAD"
assert_eq "takeover race: every waiter got its turn in every round" 12 "$LKGOT"
assert_eq "takeover race: no lock, .break or marker left behind" 0 "$LKLEFT"
# a .break left by a dead process does not wedge the takeover
rm -f "$LKT"/*; echo "99999999@$(hostname)" >"$LKT/lock"; echo "99999998@$(hostname)" >"$LKT/lock.break"
assert_ok "a dead process's .break is cleared and the takeover goes on" ship_lock "$LKT/lock" 10
ship_unlock "$LKT/lock"
assert_eq "no lock or .break left after that" "absent absent" "$([[ -e "$LKT/lock" ]] && echo present || echo absent) $([[ -e "$LKT/lock.break" ]] && echo present || echo absent)"
# a dead owner AND a dead .break, with the pause only before the .break removal: the stale .break is re-read
# before it is removed, so a fresh one made by another waiter is never deleted (no overlap)
cat >"$LKT/w3.sh" <<'W3'
source "$1"; L="$2"; LOG="$3"
for k in 1; do
  ship_lock "$L" 20 120 || { echo "TIMEOUT $BASHPID" >>"$LOG"; exit 1; }
  echo "in $BASHPID" >>"$LOG"; sleep "0.0$((RANDOM % 3))"; echo "out $BASHPID" >>"$LOG"
  ship_unlock "$L"
done
W3
LKOV=0 LKTMO=0 LKLEFT3=0
for round in $(seq 1 40); do
  rm -f "$LKT/lock" "$LKT/lock.break" "$LKT/log"; : >"$LKT/log"
  (exit 0) & LKDEAD=$!; wait "$LKDEAD"
  echo "$LKDEAD@$(hostname)" >"$LKT/lock"; echo "$LKDEAD@$(hostname)" >"$LKT/lock.break"
  LPIDS=()
  for w in 1 2 3 4 5 6 7 8; do SHIP_LOCK_TEST_PAUSE=40 bash "$LKT/w3.sh" "$SCRIPTS_DIR/ship/lib.sh" "$LKT/lock" "$LKT/log" & LPIDS+=($!); done
  for pid in "${LPIDS[@]}"; do wait "$pid"; done
  [[ "$(awk '$1=="in"{d++; if(d>1)o++} $1=="out"{d--} END{print o+0}' "$LKT/log")" == 0 ]] || LKOV=$((LKOV + 1))
  grep -q TIMEOUT "$LKT/log" && LKTMO=$((LKTMO + 1))
  [[ ! -e "$LKT/lock" && ! -e "$LKT/lock.break" ]] || LKLEFT3=$((LKLEFT3 + 1))
done
assert_eq "dead owner + dead .break, pause before the .break re-read: no overlap in 40 rounds" "0 0 0" "$LKOV $LKTMO $LKLEFT3"
# a directory left by an old mkdir lock is removed
rm -f "$LKT"/*; mkdir "$LKT/lock"
assert_ok "an old mkdir lock directory is replaced" ship_lock "$LKT/lock" 10
ship_unlock "$LKT/lock"
# a lock whose owner is dead on this host is taken over at once; a live one, however old, is not
echo "99999999@$(hostname)" >"$FIX/dl"
assert_ok "ship_lock takes over a dead owner's lock" ship_lock "$FIX/dl" 0
ship_unlock "$FIX/dl"; assert_eq "ship_unlock releases our own lock" absent "$([[ -e "$FIX/dl" ]] && echo present || echo absent)"
sleep 30 & LIVEP=$!
echo "$LIVEP@$(hostname)" >"$FIX/ll"; touch -t 200001010000 "$FIX/ll"
assert_eq "ship_lock does not take a live local owner's lock, however old" 1 "$(ship_lock "$FIX/ll" 0 1; echo $?)"
kill "$LIVEP" 2>/dev/null; wait "$LIVEP" 2>/dev/null
# a foreign lock is stale only past stale_s; ship_unlock leaves a lock that is not ours
echo "1@elsewhere" >"$FIX/fl"
assert_eq "a young foreign lock is kept" 1 "$(ship_lock "$FIX/fl" 0 600; echo $?)"
ship_unlock "$FIX/fl"; assert_eq "ship_unlock leaves a lock that is not ours" present "$([[ -e "$FIX/fl" ]] && echo present || echo absent)"
touch -t 200001010000 "$FIX/fl"
assert_ok "an old foreign lock is taken over" ship_lock "$FIX/fl" 0 60
rm -f "$FIX/fl" "$FIX/ll"
# a stale lock does not block the writer
echo "1@elsewhere" >"$SHIP_QUOTA_DIR/limited.json.lock"; touch -t 200001010000 "$SHIP_QUOTA_DIR/limited.json.lock"
ship_limit_record model after-stale "$FARU"
assert_eq "a stale lock does not block the writer" true "$(jq -r '.models | has("after-stale")' "$SHIP_QUOTA_DIR/limited.json")"
ship_limit_record model par1 "$FARU"; ship_limit_record model par2 "$FARU"; ship_limit_record model m1 "$FARU"; ship_limit_record account acct1 "$FARU"
ship_limit_clear par1; ship_limit_clear acct1
assert_eq "ship_limit_clear removes a model" false "$(jq -r '.models | has("par1")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "ship_limit_clear removes an account" false "$(jq -r '.accounts | has("acct1")' "$SHIP_QUOTA_DIR/limited.json")"
assert_eq "ship_limit_clear keeps the rest" true "$(jq -r '.models | has("par2") and has("m1")' "$SHIP_QUOTA_DIR/limited.json")"
# the lead's command
bash "$LOOP" --clear-limit m1; CRC=$?
assert_eq "ship-loop --clear-limit exits 0" 0 "$CRC"
assert_eq "ship-loop --clear-limit removed the entry" false "$(jq -r '.models | has("m1")' "$SHIP_QUOTA_DIR/limited.json")"
CLR="$(bash "$LOOP" --clear-limit nothing-here)"; CRC=$?
assert_eq "ship-loop --clear-limit of an unknown name exits 0" 0 "$CRC"
assert_contains "ship-loop --clear-limit says an unknown name was not marked" "$CLR" "was not marked limited"
SHIP_QUOTA_DIR="$SAVED_Q"; export SHIP_QUOTA_DIR

no_quota
unset SHIP_LOOP_MUX LIMITMUX_REAL FIX_DIR SHIP_FAILOVER_STOP_MS SHIP_SUMMARY_TIMEOUT_S
rm -f "$FIX/bin/uuidgen"

# --- constraints --------------------------------------------------------------------------------------

assert_ok "the tap passes bash -n" bash -n "$TAP"
assert_eq "C-1: no husk, forge, user path or host literal in the tap" "" "$(grep -niE 'husk|forge|/work/|/Users/' "$TAP")"
assert_eq "C-11: the tap does not call the multiplexer CLI" "" "$(grep -nE "$(herdr_invocation_re)" "$TAP")"
REAL_AFTER="$(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.cache/hyper is unchanged" "$REAL_BEFORE" "$REAL_AFTER"
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac

stub_stop
finish
