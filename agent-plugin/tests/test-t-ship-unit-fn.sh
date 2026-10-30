#!/usr/bin/env bash
# Row T (ship-unit, function level) — the decisions inside ship-unit, called directly:
# usage and argument checks, unit state and driver liveness, slot accounting, host
# selection, the wait loop's probe table and its exit-code mapping. No driver, no
# multiplexer, no ssh: ship-unit is sourced (its main guard returns before dispatch),
# probes and sleeps are stubs, and the only processes are a few real `sleep` pids that
# stand in for drivers. Whether `run`/`resume`/`wait`/`list` call these correctly is
# test-t-ship-unit.sh's job (one spawn per wiring).

# Options and state reach the sourced functions through subshell variables that the
# linter cannot see being read (ship-unit is not followed from every cwd).
# shellcheck disable=SC2034

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
UNIT="$SHIP_DIR/ship-unit"
SPACE="$FIX/proj"
mkdir -p "$SPACE/.hyper" "$SPACE/notes/loops"
export SHIP_SPACE_ROOT="$SPACE"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS SHIP_CONFIG_FILE SHIP_UNIT_INTERNAL
printf 'mux: fake\ngate: "true"\nhosts:\n  box:\n    ssh: fakehost\n    slots: 1\n  nossh:\n    slots: 1\n' > "$SPACE/.hyper/ship.yml"

# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
# shellcheck source=../scripts/ship/lib-host.sh
source "$SHIP_DIR/lib-host.sh"
ship_config_load
# shellcheck source=../scripts/ship/ship-unit
source "$UNIT"
set +eu
set +o pipefail
root="$SPACE"

# T <command...> — run in a subshell (usage/refuse/die exit); prints the exit code.
# Stdout goes to $FIX/t.out, stderr to $FIX/t.err.
wait_for() { # seconds command...
  local t="$1" i=0; shift
  while ! "$@" 2>/dev/null; do sleep 0.1; i=$((i + 1)); [[ $i -lt $((t * 10)) ]] || return 1; done
}
T() { ( "$@" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
tout() { cat "$FIX/t.out"; }
terr() { cat "$FIX/t.err"; }

SLEEPERS=""
trap 'kill $SLEEPERS 2>/dev/null' EXIT
mkdir -p "$FIX/bin"
printf '#!/usr/bin/env bash\nwhile :; do sleep 1; done\n' > "$FIX/bin/ship-loop-sleeper"
mkdir -p "$FIX/lead"
cp "$FIX/bin/ship-loop-sleeper" "$FIX/lead/ship-unit"
chmod +x "$FIX/bin/ship-loop-sleeper"
sleeper() { "$@" & SLEEPER_PID=$!; SLEEPERS="$SLEEPERS $SLEEPER_PID"; }
DEAD=99999999

NOW="$(date +%s)"
ST_SPACE="$SPACE" ST_LAUNCHED=1
# mk_state <ref> <host> [pid] [result status] — a unit directory (see test-t-ship-unit.sh).
mk_state() {
  local d="$ST_SPACE/notes/loops/$1"
  mkdir -p "$d"
  jq -n --arg r "$1" --arg h "$2" --argjson t "$ST_LAUNCHED" '{ref: $r, host: $h, branch: $r, worktree: "/nowhere", brief: "/b", class: "S", launched_at: $t}' > "$d/unit.json"
  [[ -z "${3:-}" ]] || { echo "$3" > "$d/driver.pid.tmp" && mv -f "$d/driver.pid.tmp" "$d/driver.pid"; }
  if [[ -n "${4:-}" ]]; then jq -n --arg r "$1" --arg s "$4" '{ref: $r, status: $s, stage: "finalize", failovers: 0}' > "$d/result.json"; fi
}
ld() { echo "$SPACE/notes/loops/$1"; }
rm_loops() { local d; for d in "$SPACE"/notes/loops/*; do [[ -d "$d" ]] && rm -rf "$d"; done; }
state() { unit_state "$(ld "$1")"; }

# --- check_sub / check_ref -----------------------------------------------------------------
assert_eq "check_sub: unknown subcommand: 64" "64" "$(T check_sub frob)"
assert_contains "...names it and points at --help" "$(terr)" "unknown subcommand 'frob' (try --help)"
for s in _probe _launch _resume _driver; do
  assert_eq "check_sub: $s needs SHIP_UNIT_INTERNAL: 64" "64" "$(T check_sub $s)"
  assert_contains "...$s: same message" "$(terr)" "unknown subcommand '$s'"
  assert_eq "check_sub: $s with SHIP_UNIT_INTERNAL=1: ok" "0" "$(SHIP_UNIT_INTERNAL=1 T check_sub $s)"
done
assert_eq "check_sub: SHIP_UNIT_INTERNAL=0 is not the gate" "64" "$(SHIP_UNIT_INTERNAL=0 T check_sub _probe)"
for s in run resume wait list; do assert_eq "check_sub: $s: ok" "0" "$(T check_sub $s)"; done

assert_eq "check_ref: empty: 64" "64" "$(T check_ref "")"
assert_contains "...a ref is required" "$(terr)" "a ref is required"
for r in ../x -x .x "a b" a/b 'a;b'; do
  assert_eq "check_ref: '$r': 64" "64" "$(T check_ref "$r")"
  assert_contains "...says invalid ref" "$(terr)" "invalid ref '$r'"
done
for r in a1 A.b_c-d 0 9x ship-unit.2; do assert_eq "check_ref: '$r': ok" "0" "$(T check_ref "$r")"; done

# --- run_args_check ---------------------------------------------------------------------------
mkdir -p "$FIX/work/specs d"
echo b > "$FIX/work/brief.md"
rac() { # ref brief class [max_rounds [spec_dir]]
  ( ref="$1" brief="$2" class="$3" max_rounds="${4:-}" spec_dir="${5:-}"; run_args_check; echo "$brief|$spec_dir" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?
}
assert_eq "run_args_check: complete options: ok" "0" "$(rac a1 "$FIX/work/brief.md" S)"
assert_eq "...brief and spec dir stay as given when absolute/empty" "$FIX/work/brief.md|" "$(tout)"
assert_eq "...a relative brief becomes absolute" "$(cd "$FIX/work" && pwd -P)/brief.md|" "$(cd "$FIX/work" && rac a1 brief.md M >/dev/null; tout)"
assert_eq "...a spec dir becomes absolute (physical path)" "$(cd "$FIX/work/specs d" && pwd -P)" "$(rac a1 "$FIX/work/brief.md" L 3 "$FIX/work/specs d" >/dev/null; tout | cut -d'|' -f2)"
assert_eq "run_args_check: no ref: 64" "64" "$(rac "" "$FIX/work/brief.md" S)"
assert_contains "...a ref is required" "$(terr)" "a ref is required"
assert_eq "run_args_check: bad ref: 64" "64" "$(rac ../x "$FIX/work/brief.md" S)"
assert_contains "...invalid ref" "$(terr)" "invalid ref '../x'"
assert_eq "run_args_check: no brief: 64" "64" "$(rac a1 "" S)"
assert_contains "...--brief is required" "$(terr)" "--brief is required"
for c in "" X s SM; do
  assert_eq "run_args_check: class '$c': 64" "64" "$(rac a1 "$FIX/work/brief.md" "$c")"
  assert_contains "...--class must be S, M or L" "$(terr)" "--class must be S, M or L"
done
for m in 0 -1 x 4.5 01; do
  assert_eq "run_args_check: --max-rounds '$m': 64" "64" "$(rac a1 "$FIX/work/brief.md" S "$m")"
  assert_contains "...positive integer" "$(terr)" "--max-rounds must be a positive integer"
done
assert_eq "run_args_check: --max-rounds 12: ok" "0" "$(rac a1 "$FIX/work/brief.md" S 12)"
assert_eq "run_args_check: missing brief file: 64" "64" "$(rac a1 "$FIX/none.md" S)"
assert_contains "...says it is not a file" "$(terr)" "brief $FIX/none.md is not a file"
assert_eq "run_args_check: spec dir that is not a directory: 64" "64" "$(rac a1 "$FIX/work/brief.md" S "" "$FIX/work/brief.md")"
assert_contains "...says so" "$(terr)" "is not a directory"

# --- positive_number ---------------------------------------------------------------------------
for n in 1 0.5 20.5 10 007 0.01; do assert_ok "positive_number '$n'" positive_number "$n"; done
for n in 0 0.0 "" soon -1 1e3 .5 1. "1 2" 0.00; do assert_fails "positive_number '$n' is refused" positive_number "$n"; done

# --- resume_opts_check (options, before any unit state is read) --------------------------------
echo "an answer" > "$FIX/work/ans.md"; : > "$FIX/work/empty.md"
roc() { # answer extend max_rounds
  ( ref=a1 answer="$1" extend="$2" max_rounds="$3"; resume_opts_check; echo "$answer" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?
}
assert_eq "resume_opts_check: nothing to check: ok" "0" "$(roc "" "" "")"
assert_eq "...an answer file is made absolute" "$FIX/work/ans.md" "$(cd "$FIX/work" && roc ans.md "" "" >/dev/null; tout)"
assert_eq "resume_opts_check: empty answer file: 64" "64" "$(roc "$FIX/work/empty.md" "" "")"
assert_contains "...missing or empty" "$(terr)" "answer file $FIX/work/empty.md is missing or empty"
assert_eq "resume_opts_check: missing answer file: 64" "64" "$(roc "$FIX/work/none.md" "" "")"
assert_contains "...missing or empty" "$(terr)" "answer file $FIX/work/none.md is missing or empty"
for e in soon 0 0.0 -5; do
  assert_eq "resume_opts_check: --extend '$e': 64" "64" "$(roc "" "$e" "")"
  assert_contains "...says what --extend takes" "$(terr)" "--extend takes minutes (a number above 0), got '$e'"
done
assert_eq "resume_opts_check: --extend 20.5: ok" "0" "$(roc "" 20.5 "")"
for m in 0 x -1 4.5; do
  assert_eq "resume_opts_check: --max-rounds '$m': 64" "64" "$(roc "" "" "$m")"
  assert_contains "...positive integer" "$(terr)" "--max-rounds must be a positive integer"
done
assert_eq "resume_opts_check: bad ref: 64" "64" "$( ( ref="x y"; resume_opts_check ) >/dev/null 2>&1; echo $?)"

# --- resume_args_check (against the unit's own files) -----------------------------------------
rc_d="$(ld rc1)"
fresh_rc() { rm -rf "$rc_d"; mkdir -p "$rc_d"; echo '{"ref":"rc1","host":"local","launched_at":1,"max_rounds":3}' > "$rc_d/unit.json"; }
rac2() { # answer extend max_rounds [models, space separated]
  ( d="$rc_d" ref=rc1 answer="$1" extend="$2" max_rounds="$3"; read -ra models <<<"${4:-}"; resume_args_check; echo "n=$n" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?
}
park() { jq -nc --arg s "$1" --argjson n "$2" '{status: $s, stage: "develop", n: $n}' > "$rc_d/park.json"; }
fresh_rc
assert_eq "resume_args_check: nothing to hand over: ok" "0" "$(rac2 "" "" "")"
assert_eq "...no park number" "n=" "$(tout)"
assert_eq "--answer without a park.json: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...says nothing is waiting" "$(terr)" "rc1 is not parked (no park.json); nothing is waiting for an answer"
assert_eq "--answer with an empty file here: internal failure (70)" "70" "$(rac2 "$FIX/work/empty.md" "" "")"
assert_contains "...says missing or empty" "$(terr)" "is missing or empty"
park LIMIT 1
assert_eq "--answer on a LIMIT park: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...usage limit" "$(terr)" "parked on a usage limit"
assert_eq "...but a LIMIT park resumes without an answer" "0" "$(rac2 "" "" "")"
park DIALOG 1
assert_eq "--answer on a DIALOG park: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...dialog" "$(terr)" "parked on a dialog"
park QUESTION 3
assert_eq "--answer on a QUESTION park: ok" "0" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_eq "...n is the park's number (3)" "n=3" "$(tout)"
park QUESTION 12
rac2 "$FIX/work/ans.md" "" "" >/dev/null
assert_eq "...n has more than one digit (12)" "n=12" "$(tout)"
jq -c 'del(.n)' "$rc_d/park.json" > "$FIX/p.json" && cp "$FIX/p.json" "$rc_d/park.json"
assert_eq "a park without a number: internal failure (70)" "70" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...no park number" "$(terr)" "has no park number"
jq -nc '{status: "QUESTION", n: "x"}' > "$rc_d/park.json"
assert_eq "a park number that is not a number: 70" "70" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...no park number" "$(terr)" "has no park number"
# --extend
assert_eq "--extend without an over-budget stage: refused (3)" "3" "$(rac2 "" 10 "")"
assert_contains "...nothing to extend" "$(terr)" "rc1 has no stage over budget; nothing to extend"
echo '{}' > "$rc_d/budget-r1.json"
assert_eq "--extend with budget-r1.json: ok" "0" "$(rac2 "" 10 "")"
touch "$rc_d/budget-r1.json.handled"
assert_eq "--extend when that budget was handled: refused (3)" "3" "$(rac2 "" 10 "")"
echo '{}' > "$rc_d/budget-r2.json"
assert_eq "--extend with an older handled and a newer open budget: ok" "0" "$(rac2 "" 10 "")"
touch "$rc_d/budget-r2.json.handled"; rm -f "$rc_d/budget-r1.json.handled"
assert_eq "--extend with an open one before a handled one: ok" "0" "$(rac2 "" 10 "")"
for e in soon 0 0.0; do
  assert_eq "resume_args_check: --extend '$e': 64" "64" "$(rac2 "" "$e" "")"
done
assert_contains "...says what --extend takes" "$(terr)" "--extend takes minutes"
# --max-rounds (the unit has 3)
for m in 3 2 1; do
  assert_eq "--max-rounds $m on a unit with 3: 64" "64" "$(rac2 "" "" "$m")"
  assert_contains "...names the current limit" "$(terr)" "must be above the unit's current limit (3)"
done
for m in 0 -1 x 4.5; do
  assert_eq "--max-rounds '$m': 64" "64" "$(rac2 "" "" "$m")"
  assert_contains "...positive integer" "$(terr)" "--max-rounds must be a positive integer"
done
assert_eq "--max-rounds 4 on a unit with 3: ok" "0" "$(rac2 "" "" 4)"
jq -c '.max_rounds = 4' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "the unit's own limit is the floor (4 refused)" "64" "$(rac2 "" "" 4)"
assert_eq "...5 is accepted" "0" "$(rac2 "" "" 5)"
jq -c 'del(.max_rounds)' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "no recorded limit: the config default (3) is the floor (3 refused)" "64" "$(rac2 "" "" 3)"
assert_contains "...named" "$(terr)" "current limit (3)"
assert_eq "...4 is accepted" "0" "$(rac2 "" "" 4)"
jq -c '.max_rounds = "many"' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "an unreadable recorded limit: internal failure (70)" "70" "$(rac2 "" "" 9)"
assert_contains "...cannot tell" "$(terr)" "cannot tell rc1's current round limit"
# nothing is written by a check
fresh_rc; park QUESTION 1; before="$(find "$rc_d" -type f | sort | xargs cat | md5sum 2>/dev/null || find "$rc_d" -type f | sort | xargs cat | md5)"
rac2 "$FIX/work/ans.md" 10 9 >/dev/null
assert_eq "resume_args_check writes nothing, whatever it says" "$before" "$(find "$rc_d" -type f | sort | xargs cat | md5sum 2>/dev/null || find "$rc_d" -type f | sort | xargs cat | md5)"

# --- resume_args_check on a STUCK unit (hyper-qzo, hyper-hiu) ---------------------------------
# result <status> [rounds_limit] — the unit's last word, written now (after its launched_at of 1).
stuck_result() {
  if [[ -n "${2:-}" ]]; then jq -nc --arg s "$1" --argjson l "$2" '{ref: "rc1", status: $s, stage: "review", rounds_limit: $l}' > "$rc_d/result.json"
  else jq -nc --arg s "$1" '{ref: "rc1", status: $s, stage: "finalize"}' > "$rc_d/result.json"; fi
}
set_limit() { jq -c --argjson n "$1" '.max_rounds = $n' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"; }
md5dir() { find "$rc_d" -type f | sort | xargs cat | md5sum 2>/dev/null || find "$rc_d" -type f | sort | xargs cat | md5; }

# ran out of rounds (limit 3, stopped at 3)
fresh_rc; stuck_result STUCK 3
assert_eq "STUCK on rounds: bare resume refused (3)" "3" "$(rac2 "" "" "")"
assert_contains "...names the limit it stopped at" "$(terr)" "rc1 is STUCK on its round limit (3)"
assert_contains "...names --max-rounds above it" "$(terr)" "--max-rounds N (above 3)"
assert_contains "...names --answer" "$(terr)" "--answer FILE"
assert_contains "...and abandoning" "$(terr)" "or abandon it"
assert_eq "STUCK on rounds: --model alone refused (3)" "3" "$(rac2 "" "" "" "dev=opus")"
assert_contains "...names --max-rounds" "$(terr)" "--max-rounds N (above 3)"
assert_eq "STUCK on rounds: two --model values, no --max-rounds: refused (3)" "3" "$(rac2 "" "" "" "dev=opus review=sonnet")"
assert_eq "STUCK on rounds: --answer alone refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...names --max-rounds" "$(terr)" "--max-rounds N (above 3)"
assert_eq "STUCK on rounds: --answer and --model, no --max-rounds: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "" "dev=opus")"
assert_eq "STUCK on rounds: --max-rounds 4: ok" "0" "$(rac2 "" "" 4)"
assert_eq "...no note number without an answer" "n=" "$(tout)"
assert_eq "STUCK on rounds: --max-rounds 4 with --model: ok" "0" "$(rac2 "" "" 4 "dev=opus")"
assert_eq "STUCK on rounds: --max-rounds 9 with --answer: ok" "0" "$(rac2 "$FIX/work/ans.md" "" 9)"
assert_eq "...the note takes number 1" "n=1" "$(tout)"
assert_eq "STUCK on rounds: --max-rounds 3 (not above the limit): 64" "64" "$(rac2 "" "" 3)"
assert_contains "...the usage error, not the refusal" "$(terr)" "must be above the unit's current limit (3)"
assert_eq "STUCK on rounds: --max-rounds 2: 64" "64" "$(rac2 "$FIX/work/ans.md" "" 2)"
assert_eq "STUCK on rounds: --max-rounds x: 64" "64" "$(rac2 "" "" x)"
assert_eq "STUCK on rounds: --extend with nothing over budget: refused (3)" "3" "$(rac2 "" 10 4)"
assert_contains "...says nothing to extend" "$(terr)" "no stage over budget"
echo '{}' > "$rc_d/budget-r2.json"
assert_eq "STUCK on rounds: --extend alone, a stage over budget: refused (3)" "3" "$(rac2 "" 10 "")"
assert_contains "...for the rounds" "$(terr)" "STUCK on its round limit (3)"
assert_eq "STUCK on rounds: --extend with --max-rounds 4: ok" "0" "$(rac2 "" 10 4)"
rm -f "$rc_d/budget-r2.json"
# the note's number skips the parks and notes already there
touch "$rc_d/park-1.json" "$rc_d/answer-2.md"
assert_eq "the note number skips park-1.json and answer-2.md" "0" "$(rac2 "$FIX/work/ans.md" "" 5)"
assert_eq "...it is 3" "n=3" "$(tout)"
rm -f "$rc_d/park-1.json" "$rc_d/answer-2.md"
assert_eq "STUCK on rounds: an empty answer file is still an internal failure (70)" "70" "$(rac2 "$FIX/work/empty.md" "" 5)"
# the limit was raised since (a resume that then ended another way): the stop point no longer binds
set_limit 5
assert_eq "limit already raised past the stop point (5 > 3): bare resume ok" "0" "$(rac2 "" "" "")"
assert_eq "...--model alone ok" "0" "$(rac2 "" "" "" "dev=opus")"
assert_eq "...--max-rounds 5 is still refused (64)" "64" "$(rac2 "" "" 5)"
set_limit 3
# the refusals write nothing
before="$(md5dir)"
rac2 "$FIX/work/ans.md" "" "" "dev=opus" >/dev/null; rac2 "" "" "" >/dev/null; rac2 "" 10 4 >/dev/null
assert_eq "STUCK on rounds: refusing writes nothing" "$before" "$(md5dir)"
assert_eq "STUCK on rounds: accepting writes nothing either" "$before" "$(rac2 "$FIX/work/ans.md" "" 6 >/dev/null; md5dir)"
# no recorded limit: the config default (3) applies
jq -c 'del(.max_rounds)' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "STUCK on rounds, no recorded limit: bare refused (3)" "3" "$(rac2 "" "" "")"
assert_eq "...--max-rounds 4 ok" "0" "$(rac2 "" "" 4)"
jq -c '.max_rounds = "many"' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "STUCK with an unreadable recorded limit: internal failure (70)" "70" "$(rac2 "" "" "")"
set_limit 3

# stuck for another reason (finalize failures, cycle caps): no rounds_limit
fresh_rc; stuck_result STUCK
assert_eq "STUCK, other reason: bare resume refused (3)" "3" "$(rac2 "" "" "")"
assert_contains "...says it is STUCK" "$(terr)" "rc1 is STUCK; resume it with"
assert_contains "...lists --max-rounds above the limit" "$(terr)" "--max-rounds N (above 3)"
assert_contains "...--answer" "$(terr)" "--answer FILE (a note to the dev)"
assert_contains "...--model" "$(terr)" "--model STAGE=M"
assert_contains "...and abandoning" "$(terr)" "or abandon it"
assert_eq "STUCK, other reason: --model alone: ok (today's behaviour)" "0" "$(rac2 "" "" "" "dev=opus")"
assert_eq "STUCK, other reason: --answer alone: ok, no park needed" "0" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_eq "...the note takes number 1" "n=1" "$(tout)"
assert_eq "STUCK, other reason: --max-rounds 4: ok" "0" "$(rac2 "" "" 4)"
assert_eq "STUCK, other reason: --max-rounds 3: 64" "64" "$(rac2 "" "" 3)"
assert_eq "STUCK, other reason: --answer, --model and --max-rounds: ok" "0" "$(rac2 "$FIX/work/ans.md" "" 4 "dev=opus")"
assert_eq "STUCK, other reason: --extend with nothing over budget: refused (3)" "3" "$(rac2 "" 10 "")"
assert_contains "...says nothing to extend" "$(terr)" "no stage over budget"
assert_eq "STUCK, other reason: an empty answer file: internal failure (70)" "70" "$(rac2 "$FIX/work/empty.md" "" "")"
# a rounds_limit that is not a limit is not one
jq -nc '{status: "STUCK", rounds_limit: "x"}' > "$rc_d/result.json"
assert_eq "STUCK with a garbled rounds_limit counts as another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
jq -nc '{status: "STUCK", rounds_limit: 0}' > "$rc_d/result.json"
assert_eq "...so does rounds_limit 0" "0" "$(rac2 "" "" "" "dev=opus")"
assert_eq "...and a bare resume is refused (3)" "3" "$(rac2 "" "" "")"

# a result from before ship-loop wrote rounds_limit: judged by its rounds against the unit's limit (3)
old_result() { # stage lastround [extra jq filter]
  jq -nc --arg st "$1" --argjson r "$2" '{ref: "rc1", status: "STUCK", stage: $st, rounds: [range(1; $r + 1) | {round: ., verdict: "CHANGES", findings: 1}]}' > "$rc_d/result.json"
}
fresh_rc; old_result review 3
assert_eq "old STUCK result, 3 rounds of 3: bare resume refused (3)" "3" "$(rac2 "" "" "")"
assert_contains "...as STUCK on its round limit, inferred" "$(terr)" "STUCK on its round limit (3)"
assert_eq "old STUCK result, 3 rounds of 3: --model alone refused (3)" "3" "$(rac2 "" "" "" "dev=opus")"
assert_contains "...names --max-rounds" "$(terr)" "--max-rounds N (above 3)"
assert_eq "old STUCK result, 3 rounds of 3: --answer alone refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_eq "old STUCK result, 3 rounds of 3: --max-rounds 4 ok" "0" "$(rac2 "" "" 4)"
assert_eq "old STUCK result, 3 rounds of 3: --max-rounds 4 with --answer ok" "0" "$(rac2 "$FIX/work/ans.md" "" 4)"
old_result verify 3
assert_eq "...stopped at verify: also on rounds (3)" "3" "$(rac2 "" "" "" "dev=opus")"
assert_contains "...inferred" "$(terr)" "round limit (3)"
old_result review 2
assert_eq "old STUCK result, 2 rounds of 3: another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
assert_eq "...bare resume still refused (3)" "3" "$(rac2 "" "" "")"
assert_contains "...as a plain STUCK" "$(terr)" "rc1 is STUCK; resume it with"
old_result finalize 3
assert_eq "old STUCK result in finalize, 3 rounds: another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
old_result review 4
assert_eq "old STUCK result, more rounds than the limit: on rounds (3)" "3" "$(rac2 "" "" "" "dev=opus")"
fresh_rc; set_limit 5; old_result review 3
assert_eq "old STUCK result, 3 rounds, unit limit since raised to 5: another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
old_result review 5
assert_eq "...5 rounds of 5: on rounds, --max-rounds 5 is below the line (64)" "64" "$(rac2 "" "" 5)"
assert_eq "...--max-rounds 6 ok" "0" "$(rac2 "" "" 6)"
fresh_rc; jq -c 'del(.max_rounds)' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"; old_result review 3
assert_eq "old STUCK result, no recorded limit: the config default (3) is used (3)" "3" "$(rac2 "" "" "" "dev=opus")"
assert_contains "...on rounds" "$(terr)" "round limit (3)"
fresh_rc; jq -nc '{ref: "rc1", status: "STUCK", stage: "review"}' > "$rc_d/result.json"
assert_eq "old STUCK result with no rounds at all: another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
jq -nc '{ref: "rc1", status: "STUCK", stage: "review", rounds: "many"}' > "$rc_d/result.json"
assert_eq "...rounds that is not a list: another reason: --model ok" "0" "$(rac2 "" "" "" "dev=opus")"
fresh_rc; old_result review 3; before="$(md5dir)"; rac2 "" "" "" "dev=opus" >/dev/null
assert_eq "...the inference writes nothing" "$before" "$(md5dir)"

# units that are not STUCK are unaffected, whatever rounds_limit says
for st in READY ERROR PARKED OVER-BUDGET; do
  fresh_rc; stuck_result "$st" 3
  assert_eq "$st (rounds_limit 3): bare resume ok" "0" "$(rac2 "" "" "")"
  assert_eq "$st: --model alone ok" "0" "$(rac2 "" "" "" "dev=opus")"
  assert_eq "$st: --max-rounds 4 ok" "0" "$(rac2 "" "" 4)"
  assert_eq "$st: --answer with no park: still refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
  assert_contains "...says nothing is waiting" "$(terr)" "rc1 is not parked (no park.json); nothing is waiting for an answer"
done
fresh_rc
assert_eq "no result.json: bare resume ok" "0" "$(rac2 "" "" "")"
assert_eq "no result.json: --answer with no park: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
echo '{not json' > "$rc_d/result.json"
assert_eq "an unreadable result.json is not STUCK: bare resume ok" "0" "$(rac2 "" "" "")"
: > "$rc_d/result.json"
assert_eq "an empty result.json is not STUCK: bare resume ok" "0" "$(rac2 "" "" "")"
# a STUCK result older than the last launch is history
fresh_rc; stuck_result STUCK 3
jq -c '.launched_at = 4102444800' "$rc_d/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$rc_d/unit.json"
assert_eq "a STUCK result older than the unit's last launch is ignored: bare resume ok" "0" "$(rac2 "" "" "")"
assert_eq "...--answer with no park: refused (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...as for any unit with no park" "$(terr)" "not parked"
# a park beats a STUCK result: the answer is for the park
fresh_rc; stuck_result STUCK 3; park QUESTION 2
assert_eq "park.json present beside a STUCK result: --answer answers the park" "0" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_eq "...n is the park's" "n=2" "$(tout)"
assert_eq "...a bare resume is not refused" "0" "$(rac2 "" "" "")"
park LIMIT 2
assert_eq "...a LIMIT park still refuses --answer (3)" "3" "$(rac2 "$FIX/work/ans.md" "" "")"
assert_contains "...usage limit" "$(terr)" "parked on a usage limit"

rm -rf "$rc_d"

# --- driver_proc_ok -----------------------------------------------------------------------------
sleeper "$FIX/bin/ship-loop-sleeper"; P_LOOP=$SLEEPER_PID
sleeper bash "$FIX/lead/ship-unit" _driver myref; P_DRV=$SLEEPER_PID
sleeper bash "$FIX/lead/ship-unit" wait myref; P_WAIT=$SLEEPER_PID
sleeper sleep 120; P_OTHER=$SLEEPER_PID
# the children have exec'd once ps shows their final command lines
cmd_is() { [[ "$(ps -o command= -p "$1" 2>/dev/null)" == *"$2"* ]]; }
wait_for 10 cmd_is "$P_LOOP" ship-loop-sleeper
wait_for 10 cmd_is "$P_DRV" "_driver myref"
wait_for 10 cmd_is "$P_WAIT" "wait myref"
wait_for 10 cmd_is "$P_OTHER" "sleep 120"
assert_ok "driver_proc_ok: a ship-loop process is a driver" driver_proc_ok "$P_LOOP" myref
assert_ok "driver_proc_ok: 'ship-unit _driver <ref>' of that ref is a driver" driver_proc_ok "$P_DRV" myref
assert_fails "driver_proc_ok: ...but not for another ref" driver_proc_ok "$P_DRV" otherref
assert_fails "driver_proc_ok: the lead's 'ship-unit wait' is not a driver" driver_proc_ok "$P_WAIT" myref
assert_fails "driver_proc_ok: a recycled pid (some other live process) is not" driver_proc_ok "$P_OTHER" myref
assert_fails "driver_proc_ok: a dead pid is not" driver_proc_ok "$DEAD" myref

# --- unit_state ---------------------------------------------------------------------------------
rm_loops
assert_eq "unit_state: no unit.json: missing" "missing" "$(unit_state "$(ld none)")"
mk_state s1 local; echo 0 > "$(ld s1)/driver.exit"
assert_eq "unit_state: driver.exit 0" "exit 0" "$(state s1)"
echo 2 > "$(ld s1)/driver.exit"; assert_eq "unit_state: driver.exit 2" "exit 2" "$(state s1)"
printf '77\n' > "$(ld s1)/driver.exit"; assert_eq "unit_state: driver.exit 77 is passed on" "exit 77" "$(state s1)"
: > "$(ld s1)/driver.exit"; assert_eq "unit_state: an empty driver.exit says nothing (no pid, long ago: dead)" "dead" "$(state s1)"
mk_state s2 local "$P_LOOP" READY; echo 1 > "$(ld s2)/driver.exit"
assert_eq "unit_state: driver.exit wins over a live pid" "exit 1" "$(state s2)"
mk_state s3 local "$P_LOOP"
assert_eq "unit_state: a live driver pid: running" "running" "$(state s3)"
mk_state s4 local "$DEAD"
assert_eq "unit_state: a dead pid, launched long ago: dead" "dead" "$(state s4)"
ST_LAUNCHED=$NOW mk_state s5 local "$DEAD"
assert_eq "unit_state: a dead pid just after the launch: dead (a dead pid frees the slot at once)" "dead" "$(state s5)"
ST_LAUNCHED=$NOW mk_state s6 local
assert_eq "unit_state: no pid yet, launched a moment ago: starting" "starting" "$(state s6)"
ST_LAUNCHED=$(( NOW - 3600 )) mk_state s7 local
assert_eq "unit_state: no pid, grace period over: dead" "dead" "$(state s7)"
NOW=$(date +%s)
ST_LAUNCHED=$(( NOW - 50 )) mk_state s7b local
ST_LAUNCHED=$(( NOW - 70 )) mk_state s7c local
assert_eq "unit_state: grace is 60 s (50 s ago: starting)" "starting" "$(state s7b)"
assert_eq "unit_state: ...(70 s ago: dead)" "dead" "$(state s7c)"
ST_LAUNCHED=$NOW mk_state s8 local; : > "$(ld s8)/driver.pid"
assert_eq "unit_state: an empty driver.pid within grace: starting, never dead" "starting" "$(state s8)"
ST_LAUNCHED=$(( NOW - 3600 )) mk_state s9 local; : > "$(ld s9)/driver.pid"
assert_eq "unit_state: an empty driver.pid long after the launch: dead" "dead" "$(state s9)"
ST_LAUNCHED=$NOW mk_state s10 local; echo "not a pid" > "$(ld s10)/driver.pid"
assert_eq "unit_state: a driver.pid that is not a number is not a pid (dead)" "dead" "$(state s10)"
ST_LAUNCHED=$NOW jq -c 'del(.launched_at)' "$(ld s6)/unit.json" > "$FIX/u.json"; cp "$FIX/u.json" "$(ld s6)/unit.json"
assert_eq "unit_state: no launched_at: dead, not starting" "dead" "$(state s6)"
# the fallback table: the driver is gone and left no exit code, a result since the launch says how it ended
for s in "READY:exit 0" "ERROR:exit 1" "OVER-BUDGET:exit 2" "PARKED:exit 2" "STUCK:exit 2" "LIMIT:exit 2"; do
  st="${s%%:*}"; want="${s#*:}"
  rm -rf "$(ld fb)"; mk_state fb local "$DEAD" "$st"
  assert_eq "unit_state: dead driver, no driver.exit, result $st: $want" "$want" "$(state fb)"
done
rm -rf "$(ld fb)"; mk_state fb local "$DEAD"; echo '{}' > "$(ld fb)/result.json"
assert_eq "unit_state: a result without a status: dead" "dead" "$(state fb)"
echo 'not json' > "$(ld fb)/result.json"
assert_eq "unit_state: an unreadable result: dead" "dead" "$(state fb)"
rm -rf "$(ld fb)"; ST_LAUNCHED=$(( NOW + 3600 )) mk_state fb local "$DEAD" READY
assert_eq "unit_state: a result older than the launch says nothing about this run: dead" "dead" "$(state fb)"
rm -rf "$(ld fb)"; mk_state fb local "$P_OTHER" READY
assert_eq "unit_state: a recycled pid does not make the unit running (READY result: exit 0)" "exit 0" "$(state fb)"
rm -rf "$(ld fb)"; mk_state fb local "$P_WAIT" READY
assert_eq "unit_state: a pid running 'ship-unit wait' is not the driver (exit 0)" "exit 0" "$(state fb)"
assert_ok "unit_live: running" unit_live "$(ld s3)"
assert_ok "unit_live: starting" unit_live "$(ld s8)"
assert_fails "unit_live: dead" unit_live "$(ld s4)"
assert_fails "unit_live: finished" unit_live "$(ld s1)"
assert_fails "unit_live: missing" unit_live "$(ld none)"

# a pid file that flips between empty and whole is never read as dead (5 reads while it flips)
rm_loops
ST_LAUNCHED=$NOW mk_state flip1 local
( for _ in $(seq 1 200); do : > "$(ld flip1)/driver.pid"; echo "$P_LOOP" > "$(ld flip1)/driver.pid"; done ) &
FLIPPER=$!
dead_seen=0
for _ in 1 2 3 4 5; do [[ "$(state flip1)" != dead ]] || dead_seen=$((dead_seen + 1)); done
wait "$FLIPPER" 2>/dev/null
assert_eq "a pid file that is empty for an instant never reads as dead (5 reads)" "0" "$dead_seen"

# --- live_units / check_free ---------------------------------------------------------------------
rm_loops
host_name=local slots=""
mk_state busy1 local "$P_LOOP"
mk_state busy2 local "$P_LOOP"
mk_state fin local "$P_LOOP"; echo 0 > "$(ld fin)/driver.exit"
mk_state gone local "$DEAD"
ST_LAUNCHED=$NOW mk_state strt local
mk_state onbox box "$P_LOOP"
ST_LAUNCHED=$(( NOW - 3600 )) mk_state oldstrt local
mkdir -p "$SPACE/notes/loops/.done/old"
assert_eq "live_units: live and starting local units; not finished, dead, old-starting, other host, .done" "busy1 busy2 strt" "$(live_units | tr '\n' ' ' | sed 's/ $//')"
assert_eq "live_units: the ref given is left out" "busy2 strt" "$(live_units busy1 | tr '\n' ' ' | sed 's/ $//')"
host_name=box
assert_eq "live_units: another host's units are counted for that host" "onbox" "$(live_units | tr '\n' ' ' | sed 's/ $//')"
host_name=local
rm_loops
cf() { ( root="$SPACE" host_name="${2:-local}" slots="${3:-}"; check_free "$1" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
mk_state busy1 local "$P_LOOP"
assert_eq "check_free: one live unit at slots=2 (the config default): ok" "0" "$(cf new1)"
mk_state busy2 local "$P_LOOP"
assert_eq "check_free: two live units at slots=2: refused (3)" "3" "$(cf new1)"
assert_contains "...names the host and the slots" "$(terr)" "refused: host local is full: 2 of 2 slots in use (busy1 busy2)"
assert_eq "check_free: a ref whose own driver is live: refused (3)" "3" "$(cf busy1)"
rm_loops; mk_state mine local; mk_state o1 local "$P_LOOP"
assert_eq "check_free: resume with one other live unit at slots=2: ok" "0" "$(cf mine)"
mk_state o2 local "$P_LOOP"
assert_eq "check_free: two OTHER live units at slots=2: refused (3)" "3" "$(cf mine)"
rm -rf "$(ld o2)"; echo "$P_LOOP" > "$(ld mine)/driver.pid"
assert_eq "check_free: the ref's own driver is running: refused (3)" "3" "$(cf mine)"
assert_contains "...pointing at wait" "$(terr)" "the driver of mine is already running on local; use 'ship-unit wait mine'"
rm_loops
mk_state d1 local "$DEAD"; mk_state d2 local "$DEAD"
assert_eq "check_free: dead pids free their slots" "0" "$(cf new1)"
mk_state r1 local "$P_OTHER"; mk_state r2 local "$P_OTHER"
assert_eq "check_free: recycled pids (live, not ours) free their slots" "0" "$(cf new1)"
mk_state w1 local "$P_WAIT"; mk_state w2 local "$P_WAIT"
assert_eq "check_free: the lead's 'ship-unit wait' processes are not drivers" "0" "$(cf new1)"
rm_loops
mk_state f1 local "$P_LOOP"; echo 0 > "$(ld f1)/driver.exit"; mk_state f2 local "$P_LOOP"; echo 0 > "$(ld f2)/driver.exit"
assert_eq "check_free: units with driver.exit do not count" "0" "$(cf new1)"
rm_loops
ST_LAUNCHED=$NOW mk_state st1 local; ST_LAUNCHED=$NOW mk_state st2 local
assert_eq "check_free: two units launched a moment ago with no pid fill the slots (3)" "3" "$(cf new1)"
assert_contains "...named in the refusal" "$(terr)" "st1 st2"
rm_loops
ST_LAUNCHED=$NOW mk_state em1 local; : > "$(ld em1)/driver.pid"; ST_LAUNCHED=$NOW mk_state em2 local; : > "$(ld em2)/driver.pid"
assert_eq "check_free: two units with an empty driver.pid within grace fill the slots (3)" "3" "$(cf new1)"
rm_loops
ST_LAUNCHED=$(( NOW - 3600 )) mk_state st1 local; ST_LAUNCHED=$(( NOW - 3600 )) mk_state st2 local
assert_eq "check_free: ...but not once the grace period has passed" "0" "$(cf new1)"
rm_loops
mk_state bx1 box "$P_LOOP"; mk_state bx2 box "$P_LOOP"
assert_eq "check_free: two live units of host box do not fill the local host" "0" "$(cf new1)"
assert_eq "check_free: host box (slots=1) with a live unit: refused (3)" "3" "$(cf new1 box)"
assert_contains "...names box" "$(terr)" "host box is full: 2 of 1 slots in use (bx1 bx2)"
rm_loops
assert_eq "check_free: host box, nothing live: ok" "0" "$(cf new1 box)"
assert_eq "check_free: slots given by the caller win (1 slot, 1 live)" "3" "$( mk_state a1 local "$P_LOOP"; cf new1 local 1)"
assert_eq "check_free: a host with no slots anywhere: internal failure (70)" "70" "$(cf new1 nowhere)"
assert_contains "...says which setting" "$(terr)" "host 'nowhere' has no usable hosts.nowhere.slots in the ship config"
assert_eq "check_free: slots that are not a number fall back to the config" "0" "$(rm_loops; cf new1 local abc)"
rm_loops

# --- select_host / host_slots ---------------------------------------------------------------------
SYNCS=0
sh_call() { ( ship_host_sync() { echo sync >> "$FIX/sync.log"; return "${SYNC_RC:-0}"; }; select_host "$@"; echo "$HNAME|$HTARGET|$need_sync" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
: > "$FIX/sync.log"
assert_eq "select_host local: ok" "0" "$(sh_call local)"
assert_eq "...no target, no sync" "local||0" "$(tout)"
assert_eq "...nothing was synced" "0" "$(wc -l < "$FIX/sync.log" | tr -d ' ')"
assert_eq "select_host '' means local" "local||0" "$(sh_call "" >/dev/null; tout)"
assert_eq "select_host box: ok" "0" "$(sh_call box)"
assert_eq "...target from the config, synced once" "box|fakehost|0 1" "$(tout) $(wc -l < "$FIX/sync.log" | tr -d ' ')"
assert_eq "select_host nossh: internal failure (70)" "70" "$(sh_call nossh)"
assert_contains "...no ssh destination" "$(terr)" "host 'nossh' has no ssh destination"
assert_eq "select_host nowhere: 70" "70" "$(sh_call nowhere)"
assert_contains "...no ssh destination" "$(terr)" "host 'nowhere' has no ssh destination"
assert_eq "select_host box, sync fails: 70" "70" "$(SYNC_RC=1 sh_call box)"
assert_contains "...could not copy the scripts" "$(terr)" "could not copy the ship scripts to box (fakehost)"
assert_eq "select_host box soft, sync fails: ok, the wait loop syncs later" "0" "$(SYNC_RC=1 sh_call box soft)"
assert_eq "...need_sync is set" "box|fakehost|1" "$(tout)"
hs() { ( HNAME="$1"; host_slots ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
assert_eq "host_slots box: ok" "0" "$(hs box)"
assert_eq "...1" "1" "$(tout)"
assert_eq "host_slots local: the config default" "2" "$(hs local >/dev/null; tout)"
assert_eq "host_slots nowhere: 70" "70" "$(hs nowhere)"
assert_contains "...says which setting" "$(terr)" "host 'nowhere' has no usable hosts.nowhere.slots"

# --- next_delay -----------------------------------------------------------------------------------
assert_eq "next_delay doubles" "0.2" "$(next_delay 0.1)"
assert_eq "...1 -> 2" "2" "$(next_delay 1)"
assert_eq "...is capped (default 30)" "30" "$(next_delay 20)"
assert_eq "...stays at the cap" "30" "$(next_delay 30)"
assert_eq "...cap from SHIP_UNIT_BACKOFF_MAX_S" "0.5" "$( BACKOFF_MAX_S=0.5; next_delay 0.4)"

# --- probe_ref / unit_exec ---------------------------------------------------------------------------
pr() { # unit_exec output, rc
  ( UE_OUT="$1" UE_RC="$2"; unit_exec() { printf '%b' "$UE_OUT"; return "$UE_RC"; }; probe_ref r1; echo "rc=$? PROBE=$PROBE" ) 2>&1
}
assert_eq "probe_ref: the state is the last line for the ref" "rc=0 PROBE=running" "$(pr 'ship-unit-probe: r1 starting\nship-unit-probe: r1 running\n' 0)"
assert_eq "probe_ref: login noise and another ref's line are ignored" "rc=0 PROBE=exit 2" "$(pr 'Last login: Sat\nship-unit-probe: bogus dead\nship-unit-probe: r1 exit 2\n' 0)"
assert_eq "probe_ref: a failing call gives its code and no state" "rc=255 PROBE=" "$(pr 'ship-unit-probe: r1 running\n' 255)"
assert_eq "probe_ref: no line for the ref: empty state, ok" "rc=0 PROBE=" "$(pr 'noise\n' 0)"
ue() { # rc sequence, sync rc  -> "rc|runs|syncs"
  ( HTARGET=fakehost HNAME=box; RUNS=0; SYNCS=0; read -r -a rcs <<<"$1"; SRC="${2:-0}"
    ship_host_run() { local r="${rcs[$RUNS]:-0}"; RUNS=$((RUNS + 1)); return "$r"; }
    ship_host_sync() { SYNCS=$((SYNCS + 1)); return "$SRC"; }
    unit_exec _probe r1; echo "$?|$RUNS|$SYNCS" ) 2>/dev/null
}
assert_eq "unit_exec on a host: ok" "0|1|0" "$(ue "0")"
assert_eq "...a host failing with another code keeps it, no resync" "3|1|0" "$(ue "3")"
assert_eq "...exit 127 (the cache is gone): resync once, run again" "0|2|1" "$(ue "127 0")"
assert_eq "...127 twice: the second code is returned, one resync only" "127|2|1" "$(ue "127 127")"
assert_eq "...127 and the resync fails: 70" "70|1|1" "$(ue "127 0" 1)"
assert_eq "unit_exec locally runs ship-unit itself (no ssh)" "yes" "$( ( HTARGET="" HNAME=local; ship_host_run() { echo ssh; }; out="$(unit_exec nothing-such 2>/dev/null)"; [[ "$out" != ssh ]] && echo yes ) )"

wdo() { wd "$@" >/dev/null; tout; }
# --- wait_driver: the probe table ---------------------------------------------------------------------
# probes: a list of "rc:state" consumed one per probe; sleep is a counter. A run that
# polls more than 60 times is a runaway: it stops itself with 97 and the test fails.
wd() { # "<probes>" [HTARGET] [RECONNECT_SEC] [need_sync]  -> "DRIVER_RC|probes used|sleeps"; stderr in t.err
  ( HTARGET="${2:-}" HNAME=box ref=r1 RECONNECT_SEC="${3:-900}" need_sync="${4:-0}"
    IFS=';' read -r -a PL <<<"$1"; I=0; SL=0
    probe_ref() { local e="${PL[$I]:-99:probe list exhausted}"; I=$((I + 1)); PROBE="${e#*:}"; return "${e%%:*}"; }
    sleep() { SL=$((SL + 1)); if [[ $SL -gt 60 ]]; then echo RUNAWAY >&2; exit 97; fi; }
    ship_host_sync() { return 0; }
    wait_driver r1; echo "$DRIVER_RC|$I|$SL" ) >"$FIX/t.out" 2>"$FIX/t.err"
  echo $?
}
for c in 0 1 2; do
  assert_eq "wait_driver: exit $c returns it" "0" "$(wd "0:exit $c")"
  assert_eq "...DRIVER_RC=$c after one probe, no sleep" "$c|1|0" "$(tout)"
done
assert_eq "wait_driver: exit 77: ship-unit's own failure" "70|1|0" "$(wdo "0:exit 77")"
assert_contains "...says the code" "$(terr)" "the driver of r1 exited with code 77"
assert_eq "wait_driver: blocks while running, returns at the exit (2)" "2|3|2" "$(wdo "0:running;0:running;0:exit 2")"
assert_eq "wait_driver: starting counts as running" "0|3|2" "$(wdo "0:starting;0:running;0:exit 0")"
assert_eq "wait_driver: dead once is not a verdict (then READY)" "0|3|2" "$(wdo "0:dead;0:running;0:exit 0")"
assert_eq "wait_driver: dead twice in a row is" "70|2|1" "$(wdo "0:dead;0:dead")"
assert_contains "...says the driver left no exit code or result" "$(terr)" "the driver of r1 is not running on box and left no exit code or result; see notes/loops/r1/loop.log"
assert_eq "wait_driver: dead, running, dead is still not a verdict" "0|4|3" "$(wdo "0:dead;0:running;0:dead;0:exit 0")"
assert_eq "wait_driver: dead, running, dead, dead is" "70|4|3" "$(wdo "0:dead;0:running;0:dead;0:dead")"
assert_eq "wait_driver: missing: 70" "70|1|0" "$(wdo "0:missing")"
assert_contains "...no unit" "$(terr)" "box has no unit r1"
assert_eq "wait_driver: an unknown answer: 70" "70|1|0" "$(wdo "0:levitating")"
assert_contains "...named" "$(terr)" "unexpected probe answer 'levitating'"
assert_eq "wait_driver: a probe failing locally (not ssh): 70" "70|1|0" "$(wdo "1:")"
assert_contains "...says the code" "$(terr)" "probing the driver of r1 on box failed (exit 1)"
assert_eq "wait_driver: ssh down, then back: reconnects and reads the exit (0)" "0|3|2" "$(wdo "255:;255:;0:exit 0" fakehost)"
assert_eq "...the loss is announced once, the reconnect once" "1 1" "$(grep -c 'lost the connection to box (ssh exit 255)' "$FIX/t.err") $(grep -c 'reconnected to box' "$FIX/t.err")"
assert_eq "wait_driver: ssh down past the window: 75" "75|1|0" "$(wdo "255:;255:;255:" fakehost 0)"
assert_contains "...gave up, and 'wait' reattaches" "$(terr)" "gave up reconnecting to box after 0s; the driver keeps running there: 'ship-unit wait r1' reattaches"
assert_eq "wait_driver: a host failing with a non-ssh code: 70" "70|1|0" "$(wdo "3:" fakehost)"
assert_contains "...says the code" "$(terr)" "probing the driver of r1 on box failed (exit 3)"
assert_eq "wait_driver: a loss after a good probe is a fresh loss; with a 0 s window it gives up at once" "75|2|1" "$(wdo "0:running;255:;255:" fakehost 0)"
assert_eq "wait_driver: a probe stub that never ends is stopped by the guard (97)" "97" "$(wd "0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running;0:running")"
assert_eq "wait_driver: need_sync with a target: syncs, then probes (0)" "0|1|0" "$(wdo "0:exit 0" fakehost 900 1)"

# --- finish_unit / launch_failed -----------------------------------------------------------------------
mkdir -p "$SPACE/notes/loops/fu1"
echo '{"status":"READY","pr":7}' > "$SPACE/notes/loops/fu1/result.json"
fu() { ( root="$SPACE" HTARGET="" DRIVER_RC="$1"; finish_unit "${2:-fu1}" ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
for c in 0 1 2 70 75; do assert_eq "finish_unit: DRIVER_RC=$c exits $c" "$c" "$(fu $c)"; done
assert_contains "...and prints result.json" "$(tout)" '"status":"READY"'
assert_eq "finish_unit: no DRIVER_RC: 70" "70" "$(fu "")"
assert_eq "finish_unit: a DRIVER_RC that is not a number: 70" "70" "$(fu x)"
assert_eq "finish_unit: a unit without a result prints nothing" "" "$(fu 1 nores >/dev/null; tout)"
assert_eq "finish_unit: ...and still exits with the code" "1" "$(fu 1 nores)"
fh() { ( root="$SPACE" HTARGET=fakehost HNAME=box DRIVER_RC="$1" RECONNECT_SEC=0 POLL_S=0
         sleep() { :; }; pull_state() { [[ -n "${PULL_OK:-}" ]]; }; finish_unit fu1 ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
assert_eq "finish_unit on a host, the mirror cannot be made: 75" "75" "$(fh 0)"
assert_contains "...says the host holds the state" "$(terr)" "could not copy notes/loops/fu1 back from box; the driver finished with 0, the host holds the state: 'ship-unit wait fu1' copies it"
assert_eq "finish_unit on a host, the mirror works: the driver's code" "2" "$(PULL_OK=1 fh 2)"
assert_eq "finish_unit on a host, connection already lost (75): no mirror attempted, 75" "75" "$(fh 75)"
lf() { ( HTARGET="${3:-}" HNAME=box; launch_failed "$1" r1 ) >"$FIX/t.out" 2>"$FIX/t.err"; echo $?; }
for c in 3 64 70; do assert_eq "launch_failed: $c is passed on" "$c" "$(lf $c)"; done
assert_eq "launch_failed: ssh lost on a host: 75" "75" "$(lf 255 r1 fakehost)"
assert_contains "...says the driver may be running" "$(terr)" "lost the connection to box while starting r1 (ssh exit 255); the driver may be running: 'ship-unit wait r1' reattaches"
assert_eq "launch_failed: 255 on the local host is not a lost connection: 70" "70" "$(lf 255)"
assert_eq "launch_failed: any other code: 70" "70" "$(lf 1)"
assert_contains "...names the code" "$(terr)" "starting r1 on box failed (exit 1)"

finish
