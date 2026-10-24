#!/usr/bin/env bash
#
# stall-watch.sh — token-free stall watchdog for Herdr agent teams.
#
# Herdr only. In Orca mode (HERDR_ENV unset, ORCA_WORKSPACE_ID set) do not run this script: use
# `orca orchestration check --terminal <coordinator> --run <id> --wait` for mail
# and the liveness verdicts from `worker-list` (via team-status.sh --orca) for
# stalls. A token-free Orca watchdog is tracked in the skill's TODO.md.
#
# A "team" is a leader agent plus the dev agents it runs. The team is STALLED
# when none of its members has been `working` for --quiet-min minutes: every
# agent is idle/done, typically because a dev is waiting on its leader while
# the leader believes the dev is busy. The watchdog then prompts the leader
# once per quiet episode with each member's status and the last lines of its
# pane. If the team is still quiet --quiet-min minutes after that, it
# escalates once to --escalate (e.g. the leader's own lead).
#
# A member stuck in a non-idle, non-working state (an approval dialog, an
# error) for two consecutive ticks is reported to the leader right away, even
# while other members work.
#
# A member counts as working when Herdr says `working`, or when its pane shows
# a background shell still running (Claude Code prints "N shell(s) still
# running" while a backgrounded verify/build runs; Herdr reports that agent as
# idle/done). `--busy-if CMD` adds a team-wide check: while CMD exits 0 (e.g.
# `pgrep -f "flock /tmp/heavy.lock"`) the team counts as working.
#
# It never reads anything into a model's context unless there is something to
# act on; the loop itself costs no tokens. Run it in its own Herdr pane (so the
# user can see and stop it) or with nohup.
#
# Lifecycle: the watchdog exists only while a leader is coordinating a team.
# Start it when the first dev is launched and stop it with `--stop <leader>`
# when the batch is over; a watcher left running after the team is gone keeps
# prompting the leader about a team that no longer exists. Each run records
# its PID in <state-dir>/<leader>.pid; a second start for a leader whose
# watcher is still alive is refused, so a session cannot stack watchers.
#
# Usage:
#   stall-watch.sh --team <leader>=<glob>[,<glob>...] [--team ...]
#                  [--escalate <agent>] [--quiet-min 15] [--interval 60]
#                  [--state-dir DIR] [--once] [--dry-run]
#   stall-watch.sh --snooze <leader> <minutes> [--state-dir DIR]
#   stall-watch.sh --stop <leader> [--state-dir DIR]
#   stall-watch.sh --status <leader> [--state-dir DIR]
#
#   --team L=G      Leader agent name or pane ID L; members are every Herdr agent whose
#                   name matches one of the comma-separated shell globs G
#                   (e.g. web-team-lead='web-*'). Repeatable.
#   --escalate A    Agent to notify when a leader does not react (optional).
#   --quiet-min N   Minutes with nobody working before alerting (default 15).
#   --interval S    Seconds between checks (default 60).
#   --state-dir D   Where per-team state lives (default ${TMPDIR:-/tmp}/stall-watch).
#   --busy-if CMD   Shell command; exit 0 means the team is busy (optional).
#   --once          Run a single check and exit (for testing / cron).
#   --dry-run       Print the messages instead of sending them.
#   --snooze L M    Silence team L for M minutes (a leader legitimately waiting
#                   on the user, CI, or a merge). The alert text tells the
#                   leader how to run this.
#   --stop L        Stop the watcher recorded for leader L and remove its
#                   state (snooze, episode, stuck-member marks). Exit 0 when
#                   it stopped or none was running.
#   --status L      Print whether a watcher is running for L. Exit 0 if it
#                   is, 1 if not.
#
# Messages are delivered with `herdr agent prompt`, only to an agent that is
# not `working` (a prompt sent to a working agent lands unsubmitted in its
# input box). If the target is working, delivery is retried on the next tick.

set -uo pipefail

QUIET_MIN=15
INTERVAL=60
STATE_DIR="${TMPDIR:-/tmp}/stall-watch"
ESCALATE=""
BUSY_IF=""
ONCE=0
DRY=0
TEAMS=()
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

usage() { echo 'usage: stall-watch.sh --team <leader>=<glob> [--escalate <agent>] [--quiet-min N] [--interval S] [--state-dir DIR] [--busy-if CMD] [--once] [--dry-run] | --snooze <leader> <minutes> [--state-dir DIR] | --stop <leader> [--state-dir DIR] | --status <leader> [--state-dir DIR]' >&2; }
die() { echo "stall-watch: $*" >&2; usage; exit 2; }
value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "missing value for $1"; }
number() { [[ "$2" =~ ^[0-9]+$ ]] && (( 10#$2 > 0 )) || die "$1 must be a positive integer"; }
valid_leader() { [[ "$1" =~ ^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_-]+)?$ ]] || die 'invalid leader'; }

# PID of the live watcher for a leader, or nothing (a stale pid file is removed).
live_pid() {
  local pf="$STATE_DIR/$1.pid" pid
  [[ -f "$pf" ]] || return 1
  pid=$(cat "$pf" 2>/dev/null)
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; return 0; fi
  rm -f "$pf"; return 1
}

# --stop / --status <leader> [--state-dir DIR]: one-shot subcommands.
if [[ "${1:-}" == "--stop" || "${1:-}" == "--status" ]]; then
  cmd="$1"; value "$@"; leader="$2"; shift 2
  if [[ $# -gt 0 ]]; then
    [[ "$1" == "--state-dir" ]] || die "unexpected $cmd argument: $1"
    value "$@"; STATE_DIR="$2"; shift 2
  fi
  [[ $# -eq 0 ]] || die "unexpected $cmd argument: $1"
  valid_leader "$leader"
  if [[ "$cmd" == "--status" ]]; then
    if pid=$(live_pid "$leader"); then echo "stall-watch: $leader watched by pid $pid"; exit 0; fi
    echo "stall-watch: no watcher for $leader"; exit 1
  fi
  if pid=$(live_pid "$leader"); then
    kill "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    echo "stall-watch: stopped watcher for $leader (pid $pid)"
  else
    echo "stall-watch: no watcher running for $leader; clearing its state"
  fi
  rm -f "$STATE_DIR/$leader.pid" "$STATE_DIR/$leader.state" "$STATE_DIR/$leader.snooze" "$STATE_DIR/$leader".*.odd
  exit 0
fi

if [[ "${1:-}" == "--snooze" ]]; then
  value "$@"; leader="$2"; shift 2
  value "--snooze minutes" "${1:-}"; minutes="$1"; number minutes "$minutes"; shift
  if [[ $# -gt 0 ]]; then
    [[ "$1" == "--state-dir" ]] || die "unexpected snooze argument: $1"
    value "$@"; STATE_DIR="$2"; shift 2
  fi
  [[ $# -eq 0 ]] || die "unexpected snooze argument: $1"
  valid_leader "$leader"
  mkdir -p "$STATE_DIR"
  echo $(( $(date +%s) + minutes * 60 )) > "$STATE_DIR/$leader.snooze"
  echo "stall-watch: $leader snoozed for ${minutes}m"
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team) value "$@"; [[ "$2" == *=?* && "${2%%=*}" =~ ^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_-]+)?$ ]] || die "invalid team: $2"; TEAMS+=("$2"); shift 2 ;;
    --escalate) value "$@"; ESCALATE="$2"; shift 2 ;;
    --busy-if) value "$@"; BUSY_IF="$2"; shift 2 ;;
    --quiet-min) value "$@"; number "$1" "$2"; QUIET_MIN="$2"; shift 2 ;;
    --interval) value "$@"; number "$1" "$2"; INTERVAL="$2"; shift 2 ;;
    --state-dir) value "$@"; STATE_DIR="$2"; shift 2 ;;
    --once) ONCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,68p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ ${#TEAMS[@]} -gt 0 ]] || die "at least one --team is required"
command -v herdr >/dev/null || die "herdr not found"
command -v jq >/dev/null || die "jq not found"
mkdir -p "$STATE_DIR"

log() { echo "$(date +%H:%M:%S) $*"; }

# One watcher per leader. The pid file is what `--stop` and `--status` read;
# a `--once` run is a probe, so it registers nothing.
LEADERS=()
for t in "${TEAMS[@]}"; do LEADERS+=("${t%%=*}"); done
if [[ $ONCE -eq 0 ]]; then
  for l in "${LEADERS[@]}"; do
    if pid=$(live_pid "$l"); then
      echo "stall-watch: a watcher for $l is already running (pid $pid); stop it first: $SELF --stop $l --state-dir $STATE_DIR" >&2
      exit 1
    fi
  done
  for l in "${LEADERS[@]}"; do echo $$ > "$STATE_DIR/$l.pid"; done
  cleanup() { for l in "${LEADERS[@]}"; do rm -f "$STATE_DIR/$l.pid"; done; }
  trap 'cleanup; exit 0' INT TERM
  trap cleanup EXIT
  log "watching ${LEADERS[*]} (pid $$); stop with: $SELF --stop <leader> --state-dir $STATE_DIR"
fi

# Last few meaningful lines of an agent's pane, joined on one line.
pane_tail() {
  herdr agent read "$1" --lines 40 2>/dev/null \
    | sed -e 's/[[:space:]]\+$//' \
    | grep -vE '^[[:space:]]*$|^[─━╭╰│┊ ]+$|^[[:space:]]*[❯›>][[:space:]]*$|bypass permissions|shift\+tab|Ask Codex|new task\?|How is Claude doing' \
    | tail -n 6 | cut -c1-160 | paste -sd'|' - | sed 's/|/ | /g'
}

# Resolve names to their live name, or preserve an unnamed agent's pane ID.
# Missing targets retain the supplied ID/name so escalation can still report them.
resolve_target() {
  local target="$1" row
  row=$(jq -r --arg n "$target" '.result.agents[] | select(.name==$n or .pane_id==$n) | (.name // .pane_id)' <<<"$AGENTS" | head -1)
  printf '%s\n' "${row:-$target}"
}
status_of() { jq -r --arg n "$1" '.result.agents[] | select(.name==$n or .pane_id==$n) | .agent_status // "unknown"' <<<"$AGENTS" | head -1; }

deliver() { # target message -> 0 delivered, 1 retry later
  local target="$1" msg="$2" st
  st="$(status_of "$target")"
  if [[ -z "$st" ]]; then log "cannot deliver to $target: no such agent"; return 1; fi
  if [[ "$st" == "working" ]]; then log "defer message to $target (working)"; return 1; fi
  if [[ $DRY -eq 1 ]]; then log "DRY-RUN → $target: $msg"; return 0; fi
  if herdr agent prompt "$target" "$msg" >/dev/null 2>&1; then log "sent → $target"; return 0; fi
  log "herdr agent prompt to $target failed"; return 1
}

check_team() {
  local spec="$1" leader="${1%%=*}" globs="${1#*=}"
  leader="$(resolve_target "$leader")"
  local sf="$STATE_DIR/$leader.state" now; now=$(date +%s)
  local last_active alerted escalated
  last_active=$now; alerted=0; escalated=0
  # shellcheck disable=SC1090
  [[ -f "$sf" ]] && source "$sf"

  local snooze=0
  [[ -f "$STATE_DIR/$leader.snooze" ]] && snooze=$(cat "$STATE_DIR/$leader.snooze")

  # members: leader + agents matching any glob
  local names member_lines="" any_working=0 m st
  names=$(jq -r '.result.agents[] | select(.name != null) | .name' <<<"$AGENTS")
  local members=("$leader")
  IFS=',' read -ra gl <<<"$globs"
  while read -r m; do
    [[ -z "$m" || "$m" == "$leader" ]] && continue
    for g in "${gl[@]}"; do
      # shellcheck disable=SC2053
      if [[ "$m" == $g ]]; then members+=("$m"); break; fi
    done
  done <<<"$names"

  for m in "${members[@]}"; do
    st="$(status_of "$m")"; [[ -z "$st" ]] && st="missing"
    member_lines+="$m=$st; "
    if [[ "$st" == "working" ]]; then any_working=1
    elif [[ "$st" != "missing" ]] && herdr agent read "$m" --lines 8 2>/dev/null | grep -qE '[0-9]+ (background )?shells? (still )?running'; then
      any_working=1; member_lines+="(bg shell) "
    fi
    # stuck in a non-idle, non-working state (approval dialog, error) two ticks in a row
    local bf="$STATE_DIR/$leader.$m.odd"
    case "$st" in
      working|idle|done|missing) rm -f "$bf" ;;
      *)
        if [[ -f "$bf" && "$(cat "$bf")" != "sent" && $m != "$leader" ]]; then
          if deliver "$leader" "stall-watch: $m has been '$st' for 2+ checks (likely an approval dialog or an error). Last lines: $(pane_tail "$m")"; then
            echo sent > "$bf"
          fi
        elif [[ ! -f "$bf" ]]; then echo seen > "$bf"; fi ;;
    esac
  done

  if [[ $any_working -eq 0 && -n "$BUSY_IF" ]] && bash -c "$BUSY_IF" >/dev/null 2>&1; then
    any_working=1; member_lines+="busy-if=true; "
  fi

  if [[ $any_working -eq 1 ]]; then
    last_active=$now; alerted=0; escalated=0
  elif (( now < snooze )); then
    # snoozed: restart the quiet clock and the episode, so the snooze's end
    # never escalates at once
    last_active=$now; alerted=0; escalated=0
  else
    local quiet=$(( (now - last_active) / 60 ))
    if (( alerted == 0 && quiet >= QUIET_MIN )); then
      local detail=""
      for m in "${members[@]}"; do
        [[ "$m" == "$leader" ]] && continue
        detail+=" [$m, $(status_of "$m"): $(pane_tail "$m")]"
      done
      local msg="stall-watch: nobody on your team has been working for ${quiet}m ($member_lines). A dev may be waiting on you, or you on it. Check each and unblock it; if the team is legitimately waiting (user, CI, merge), run: $SELF --snooze $leader <minutes> --state-dir $STATE_DIR.${detail}"
      # Start the escalation clock even if the leader is missing or delivery
      # fails; otherwise an absent leader traps the team in this branch forever.
      deliver "$leader" "$msg" || log "$leader: alert undeliverable; escalation clock started"
      alerted=$now
    elif (( alerted > 0 && escalated == 0 )) && [[ -n "$ESCALATE" ]] && (( (now - alerted) / 60 >= QUIET_MIN )); then
      local msg="stall-watch: team $leader is still quiet $(( (now - alerted) / 60 ))m after its leader was alerted ($member_lines). The leader may be stuck or waiting on you. Leader's last lines: $(pane_tail "$leader")"
      deliver "$ESCALATE_TARGET" "$msg" && escalated=$now
    fi
  fi

  printf 'last_active=%s\nalerted=%s\nescalated=%s\n' "$last_active" "$alerted" "$escalated" > "$sf"
  log "$leader: ${member_lines}quiet $(( (now - last_active) / 60 ))m"
}

while :; do
  if AGENTS="$(herdr agent list 2>/dev/null)" && jq -e '.result.agents' >/dev/null 2>&1 <<<"$AGENTS"; then
    ESCALATE_TARGET="$(resolve_target "$ESCALATE")"
    for t in "${TEAMS[@]}"; do check_team "$t"; done
  else
    log "herdr agent list failed; retrying"
  fi
  [[ $ONCE -eq 1 ]] && break
  sleep "$INTERVAL"
done
