#!/usr/bin/env bash
# Row T (ship lock) — ship_lock / ship_unlock (scripts/ship/lib.sh) and the quota file
# written under it, ship_limit_record / ship_limit_clear (limited.json). This is the one test
# file that may wait: the lock's contention properties need real concurrent processes, and
# SHIP_LOCK_TEST_PAUSE forces the interleavings (the number of rounds does not).
#
# Cases:
#   limited.json   record keeps the other entries; 8 parallel writers and a 16 x 4 race lose nothing;
#                  the lock is released; a stale lock does not block the writer; clear removes a model
#                  and an account and keeps the rest; ship-loop --clear-limit
#   ship_lock      one winner per contended round; takeover of a dead owner's lock by 8 waiters (perl
#                  flock path and the noclobber .break fallback): never two holders, nobody gives up,
#                  nothing left behind; the same under CPU load; a stray .break; an old mkdir lock
#   owners         dead owner on this host: taken at once; live owner: never taken however old, a waiter
#                  takes over when it dies; foreign host and ownerless: only past the stale age;
#                  ship_unlock releases only a lock that is still ours

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

LOOP="$SCRIPTS_DIR/ship/ship-loop"
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"

export SHIP_QUOTA_DIR="$FIX/quota-lock"
unset CLAUDE_CONFIG_DIR SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
mkdir -p "$SHIP_QUOTA_DIR"


# Each part runs in a subshell of its own, in parallel with the others (separate quota dir and lock files);
# par_wait replays their TAP lines in order.
PAR_PIDS=(); PAR_NAMES=()
par() { local n="$1"; shift; ( _n=0; _fail=0; "$@" ) >"$FIX/par.$n.out" 2>&1 & PAR_PIDS+=($!); PAR_NAMES+=("$n"); }
par_wait() {
  local i line
  for i in "${!PAR_NAMES[@]}"; do
    wait "${PAR_PIDS[$i]}"
    while IFS= read -r line; do
      case "$line" in
        "not ok "*) fail "${line#not ok * - }" ;;
        "ok "*) pass "${line#ok * - }" ;;
        "1.."*) ;;
        *) echo "$line" ;;
      esac
    done <"$FIX/par.${PAR_NAMES[$i]}.out"
  done
}

part_quota() {
# --- limited.json: locking, records, clear -----------------------------------------------------------------
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
# the race: 16 writers x 4 entries each, every one must survive
rm -f "$SHIP_QUOTA_DIR/limited.json"
RACE_OUT="$FIX/race.out"; : >"$RACE_OUT"
LPIDS=()
for w in $(seq 1 16); do
  ( for k in $(seq 1 4); do ship_limit_record model "w${w}k${k}" "$FARU" || echo "fail $w $k" >>"$RACE_OUT"; done ) & LPIDS+=($!)
done
for pid in "${LPIDS[@]}"; do wait "$pid"; done
assert_eq "race, 16 writers x 4: no call failed" "" "$(cat "$RACE_OUT")"
assert_eq "race, 16 writers x 4: all 64 entries are kept" 64 "$(jq -r '.models | length' "$SHIP_QUOTA_DIR/limited.json")"
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
}

part_locks() {
# the lock itself: exactly one winner per round, on the file primitive
WON="$FIX/won"; rm -rf "$WON"; mkdir -p "$WON"
for round in $(seq 1 6); do
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
for round in $(seq 1 6); do set -- "$WON/$round".*; if [[ -e "$1" ]]; then WROUNDS=$((WROUNDS + 1)); WCNT=$((WCNT + $#)); fi; done
assert_eq "ship_lock: one winner in each of 6 contended rounds" "6 6" "$WROUNDS $WCNT"
rm -f "$FIX"/rlock.*
# takeover of a dead owner's lock by 8 concurrent waiters, with pauses injected at the race windows: never two
# holders at once, every waiter gets its turn, no lock or marker is left behind. Both takeover paths run: the
# perl flock one and the noclobber .break fallback (SHIP_LOCK_NO_PERL=1). With perl, .break stays behind, by design.
LKT="$FIX/tk"; rm -rf "$LKT"; mkdir -p "$LKT"
LKMODES="noperl"; command -v perl >/dev/null 2>&1 && LKMODES="perl noperl"
for LKMODE in $LKMODES; do
  if [[ "$LKMODE" == noperl ]]; then export SHIP_LOCK_NO_PERL=1; LKR=3; else unset SHIP_LOCK_NO_PERL; LKR=6; fi
  LKBAD=0 LKGOT=0 LKLEFT=0
  for round in $(seq 1 "$LKR"); do
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
    [[ ! -e "$LKT/lock" && ! -e "$LKT/inside" ]] || LKLEFT=$((LKLEFT + 1))
    if [[ "$LKMODE" == noperl && -e "$LKT/lock.break" ]]; then LKLEFT=$((LKLEFT + 1)); fi
  done
  assert_eq "takeover race ($LKMODE), $LKR rounds x 8 waiters: never two holders, nobody gave up" 0 "$LKBAD"
  assert_eq "takeover race ($LKMODE): every waiter got its turn in every round" "$LKR" "$LKGOT"
  assert_eq "takeover race ($LKMODE): no lock or marker left behind" 0 "$LKLEFT"
done
unset SHIP_LOCK_NO_PERL
# a stray .break (any content, any age) does not wedge the takeover, with perl
if command -v perl >/dev/null 2>&1; then
  rm -f "$LKT"/*; echo "99999999@$(hostname)" >"$LKT/lock"; echo "99999998@$(hostname)" >"$LKT/lock.break"
  assert_ok "perl: a stray .break does not matter and the takeover goes on" ship_lock "$LKT/lock" 10
  ship_unlock "$LKT/lock"
  assert_eq "perl: the lock is gone and the .break is left in place" "absent present" "$([[ -e "$LKT/lock" ]] && echo present || echo absent) $([[ -e "$LKT/lock.break" ]] && echo present || echo absent)"
fi
# the fallback: a .break left by a dead process is cleared and the takeover goes on
rm -f "$LKT"/*; echo "99999999@$(hostname)" >"$LKT/lock"; echo "99999998@$(hostname)" >"$LKT/lock.break"
assert_ok "fallback: a dead process's .break is cleared and the takeover goes on" env SHIP_LOCK_NO_PERL=1 bash -c 'source "$1"; ship_lock "$2" 10' _ "$SCRIPTS_DIR/ship/lib.sh" "$LKT/lock"
rm -f "$LKT/lock"
assert_eq "fallback: no .break left after that" absent "$([[ -e "$LKT/lock.break" ]] && echo present || echo absent)"
# a directory left by an old mkdir lock is removed
rm -f "$LKT"/*; mkdir "$LKT/lock"
assert_ok "an old mkdir lock directory is replaced" ship_lock "$LKT/lock" 10
ship_unlock "$LKT/lock"
# a lock whose owner is dead on this host is taken over at once; a live one, however old, is not
echo "99999999@$(hostname)" >"$FIX/dl"
assert_ok "ship_lock takes over a dead owner's lock" ship_lock "$FIX/dl" 0
ship_unlock "$FIX/dl"; assert_eq "ship_unlock releases our own lock" absent "$([[ -e "$FIX/dl" ]] && echo present || echo absent)"
# this shell is a live owner on this host (no process to start and kill)
echo "$$@$(hostname)" >"$FIX/ll"; touch -t 200001010000 "$FIX/ll"
assert_eq "ship_lock does not take a live local owner's lock, however old" 1 "$(ship_lock "$FIX/ll" 0 1; echo $?)"
assert_eq "...and leaves it as it was" "$$@$(hostname)" "$(cat "$FIX/ll")"
# a waiter on a live owner keeps waiting, and takes the lock over as soon as that owner is dead
( ship_lock "$FIX/ll" 20 1 && echo took >"$FIX/ll.took" ) & WAITER=$!
sleep 0.3
assert_eq "a waiter on a live owner is still waiting" "waiting absent" "$(kill -0 "$WAITER" 2>/dev/null && echo waiting) $([[ -e "$FIX/ll.took" ]] && echo took || echo absent)"
echo "99999999@$(hostname)" >"$FIX/ll"
wait "$WAITER"; WRC=$?
assert_eq "...takes the lock over once the owner is dead" "0 took" "$WRC $(cat "$FIX/ll.took" 2>/dev/null)"
# an ownerless lock file is judged by its age alone
rm -f "$FIX/ll" "$FIX/ll.took"; : >"$FIX/ol"
assert_eq "a young ownerless lock is kept" 1 "$(ship_lock "$FIX/ol" 0 120; echo $?)"
touch -t 200001010000 "$FIX/ol"
assert_ok "an old ownerless lock is taken over" ship_lock "$FIX/ol" 0 120
ship_unlock "$FIX/ol"; assert_eq "...and released again" absent "$([[ -e "$FIX/ol" ]] && echo present || echo absent)"
# a foreign lock is stale only past stale_s; ship_unlock leaves a lock that is not ours
echo "1@elsewhere" >"$FIX/fl"
assert_eq "a young foreign lock is kept" 1 "$(ship_lock "$FIX/fl" 0 600; echo $?)"
ship_unlock "$FIX/fl"; assert_eq "ship_unlock leaves a lock that is not ours" present "$([[ -e "$FIX/fl" ]] && echo present || echo absent)"
touch -t 200001010000 "$FIX/fl"
assert_ok "an old foreign lock is taken over" ship_lock "$FIX/fl" 0 60
rm -f "$FIX/fl" "$FIX/ll" "$FIX/ol"
}

part_load() {
LKT2="$FIX/tk2"; rm -rf "$LKT2"; mkdir -p "$LKT2"
LKMODES="noperl"; command -v perl >/dev/null 2>&1 && LKMODES="perl noperl"
# contention under load: a dead owner, 8 separate waiters with pauses at every race window (also between the
# flock and the unlink), 2 CPU hogs running, 6 rounds (3 without perl): never two holders, nobody times out, no lock left
cat >"$LKT2/w3.sh" <<'W3'
source "$1"; L="$2"; LOG="$3"
ship_lock "$L" 30 120 || { echo "TIMEOUT $$" >>"$LOG"; exit 1; }
echo "in" >>"$LOG"; sleep "0.0$((RANDOM % 3))"; echo "out" >>"$LOG"
ship_unlock "$L"
W3
HOGS=()
for _ in 1 2; do ( while :; do :; done ) & HOGS+=($!); done
for LKMODE in $LKMODES; do
  if [[ "$LKMODE" == noperl ]]; then export SHIP_LOCK_NO_PERL=1; LKR=3; else unset SHIP_LOCK_NO_PERL; LKR=6; fi
  LKOV=0 LKTMO=0 LKLEFT3=0
  for round in $(seq 1 "$LKR"); do
    rm -f "$LKT2/lock" "$LKT2/lock.break" "$LKT2/log"; : >"$LKT2/log"
    (exit 0) & LKDEAD=$!; wait "$LKDEAD"
    echo "$LKDEAD@$(hostname)" >"$LKT2/lock"
    LPIDS=()
    for w in 1 2 3 4 5 6 7 8; do SHIP_LOCK_TEST_PAUSE=40 bash "$LKT2/w3.sh" "$SCRIPTS_DIR/ship/lib.sh" "$LKT2/lock" "$LKT2/log" & LPIDS+=($!); done
    for pid in "${LPIDS[@]}"; do wait "$pid"; done
    [[ "$(awk '$1=="in"{d++; if(d>1)o++} $1=="out"{d--} END{print o+0}' "$LKT2/log")" == 0 ]] || LKOV=$((LKOV + 1))
    if grep -q TIMEOUT "$LKT2/log"; then LKTMO=$((LKTMO + 1)); fi
    [[ ! -e "$LKT2/lock" ]] || LKLEFT3=$((LKLEFT3 + 1))
  done
  assert_eq "under load ($LKMODE): $LKR rounds of 8 waiters over a dead owner: no overlap, no timeout, no lock left" "0 0 0" "$LKOV $LKTMO $LKLEFT3"
done
unset SHIP_LOCK_NO_PERL
for pid in "${HOGS[@]}"; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
}

par quota part_quota
par locks part_locks
par load part_load
par_wait

finish
