#!/usr/bin/env bash
#
# team-status.sh — one-shot status snapshot for a team lead running dev agents
# in Herdr (default) or as Orca orchestration workers (--orca).
#
# Reads a markdown status table whose FIRST column is the task ref, e.g.
#   | ref | title | model | state | machine | worktree | notes |
# Only the first column is parsed for refs, so extra columns (a tracker id,
# etc.) are fine. A column whose header is "machine" is read too: it names the
# machine each dev runs on ("local", or an Orca environment name or id) and
# drives the per-machine load probe in --orca mode.
# Looks up each ref's agent, optionally checks elapsed time against a per-ref
# time budget, and checks whether a report file exists for the ref. Also
# reports machine load (CPU load average, memory, and count of heavy
# build/test processes) so the lead can tell when a machine is oversubscribed.
#
# Herdr backend (default): the agent is the Herdr agent named "<prefix><ref>".
# Orca backend (--orca --run <id>): the agent is the worker in that Run whose
#   task title is "<ref>" or starts with "<ref>:". Its state comes from
#   `orca orchestration worker-list` (liveness verdict, activity, outcome).
#   Remote machines named in the table are probed through a throwaway Orca
#   terminal (needs a registered project setup on that environment).
#
# Usage:
#   team-status.sh --table <path> --prefix <agent-name-prefix> \
#                   [--budgets <path>] [--reports <dir>] \
#                   [--alerts-only] [--state <file>] [--json]
#   team-status.sh --table <path> --orca --run <run-id> \
#                   [--budgets <path>] [--reports <dir>] \
#                   [--alerts-only] [--state <file>] [--json]
#
# Options:
#   --table PATH      Markdown file containing the status table (required).
#   --prefix PREFIX   Agent name prefix, e.g. "web-" (required without --orca).
#                      Agents are looked up in Herdr as "<prefix><ref>".
#   --orca            Use the Orca orchestration backend instead of Herdr.
#   --run ID          Orca Run id the devs were dispatched in (required with --orca).
#   --budgets PATH    Optional JSON file: { "<ref>": { "started": "<ISO8601>", "budget_min": <N> } }
#   --reports DIR     Optional directory containing "<ref>.md" report files.
#                      The first line of a report is expected to look like
#                      "STATUS: <value>"; that value is shown/checked.
#   --alerts-only     Print only alert lines (see below) instead of the full table.
#   --state FILE      Used with --alerts-only: persist alert state in FILE.
#                      On each run, print only NEW alerts and CLEARED alerts.
#                      LOAD and HEAVY alerts compare by keyword only (numbers
#                      ignored); with --orca by keyword plus machine.
#   --json            Emit machine-readable JSON instead of the text table.
#                      (Ignored together with --alerts-only; alerts stay plain text
#                      since they are meant for quick scanning / grep / logging.)
#
# Default output:
#   A table:  ref  status  elapsed/budget  report  note
#   followed by one machine-status line per machine.
#
# Status values. Herdr: whatever `herdr agent get` reports (working, idle,
# done, blocked, ...), or missing. Orca: running (liveness live), idle (live
# but no activity), done (exited, outcome succeeded), blocked (exited, outcome
# failed), stopped, unverifiable (Orca cannot confirm liveness: inspect, never
# treat as done), or missing (no worker in the Run matches the ref).
#
# --alerts-only output (one line per condition that is currently true):
#   OVER-BUDGET <ref> <elapsed>m/<budget>m
#   BLOCKED <ref>
#   DONE <ref>
#   MISSING <ref>
#   UNVERIFIABLE <ref>                 (--orca only)
#   LOAD <load1>/<ncpu>                (Herdr)   LOAD <machine> <load1>/<ncpu>   (--orca)
#   HEAVY <n> processes                (Herdr)   HEAVY <machine> <n> processes   (--orca)
#   PROBE-FAILED <machine>             (--orca only: the machine could not be probed)
#
# --state output (when used with --alerts-only):
#   NEW alert lines that were not in the previous run.
#   CLEARED alert-keyword lines for alerts that disappeared.
#
# Exit status is always 0 (this script is meant to run unattended in a loop).
#
# Example: watch loop that only prints when something needs attention.
#
#   while true; do
#     /path/to/team-status.sh --table notes/team-lead.md --prefix web- \
#       --budgets scratch/budgets.json --reports scratch/reports --alerts-only
#     sleep 180
#   done
#
# Or with state tracking, print only new/cleared alerts:
#   until /path/to/team-status.sh --table T --prefix P --alerts-only \
#       --state /tmp/state.txt | grep -q .; do sleep 180; done
#
# Or drive it from Monitor's until-loop pattern to get a single notification
# once something interesting happens:
#   until /path/to/team-status.sh --table T --prefix P --alerts-only \
#       --state /tmp/state.txt | grep -q .; do sleep 180; done

set -euo pipefail

TABLE=""
PREFIX=""
ORCA=0
RUN=""
BUDGETS=""
REPORTS_DIR=""
ALERTS_ONLY=0
JSON_OUT=0
STATE_FILE=""

usage() {
  grep '^#' "$0" | sed '1d;s/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --table) TABLE="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --orca) ORCA=1; shift ;;
    --run) RUN="${2:-}"; shift 2 ;;
    --budgets) BUDGETS="${2:-}"; shift 2 ;;
    --reports) REPORTS_DIR="${2:-}"; shift 2 ;;
    --alerts-only) ALERTS_ONLY=1; shift ;;
    --state) STATE_FILE="${2:-}"; shift 2 ;;
    --json) JSON_OUT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$TABLE" ]; then
  echo "error: --table is required" >&2
  usage >&2
  exit 2
fi
if [ "$ORCA" -eq 1 ] && [ -z "$RUN" ]; then
  echo "error: --orca requires --run <run-id>" >&2
  usage >&2
  exit 2
fi
if [ "$ORCA" -eq 0 ] && [ -z "$PREFIX" ]; then
  echo "error: --prefix is required (or use --orca --run <run-id>)" >&2
  usage >&2
  exit 2
fi

if [ ! -f "$TABLE" ]; then
  echo "error: table file not found: $TABLE" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 2
fi

ORCA_BIN=""
if [ "$ORCA" -eq 1 ]; then
  # Same resolution order as check-deps.sh: the first candidate whose `status` works.
  for candidate in "${ORCA_CLI_COMMAND:-}" orca-dev orca-ide orca /Applications/Orca.app/Contents/Resources/bin/orca; do
    [ -z "$candidate" ] && continue
    { [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; } || continue
    if "$candidate" status >/dev/null 2>&1; then ORCA_BIN="$candidate"; break; fi
  done
  if [ -z "$ORCA_BIN" ]; then
    echo "error: --orca needs a working Orca CLI (set ORCA_CLI_COMMAND if it is not on PATH)" >&2
    exit 2
  fi
elif ! command -v herdr >/dev/null 2>&1; then
  echo "error: herdr is required (or use --orca --run <run-id>)" >&2
  exit 2
fi

# ---- parse refs (and machines) from the markdown table ----
# Rows look like: | ref | title | model | state | machine | worktree | notes |
# Column 1 is the ref. The header row tells us which column, if any, is
# "machine"; empty or absent means local. Only rows starting with "| " whose
# second cell isn't the "---" separator, and whose first cell isn't literally
# "ref" (header), are considered.
refs=()
ref_machines=()
machine_col=0
while IFS= read -r line; do
  case "$line" in
    '| '*) ;;
    *) continue ;;
  esac
  # second field (between 1st and 2nd pipe after the leading one) used to skip separator rows
  second=$(printf '%s\n' "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/,"",$3); print $3}')
  case "$second" in
    *---*) continue ;;
  esac
  ref=$(printf '%s\n' "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2}')
  [ -z "$ref" ] && continue
  if [ "$ref" = "ref" ]; then
    machine_col=$(printf '%s\n' "$line" | awk -F'|' '{for (i = 2; i <= NF; i++) { c = $i; gsub(/^[ \t]+|[ \t]+$/, "", c); if (tolower(c) == "machine") { print i; exit } } print 0}')
    continue
  fi
  machine=""
  if [ "$machine_col" -gt 0 ]; then
    machine=$(printf '%s\n' "$line" | awk -F'|' -v c="$machine_col" '{gsub(/^[ \t]+|[ \t]+$/,"",$c); print $c}')
  fi
  [ -z "$machine" ] && machine="local"
  refs+=("$ref")
  ref_machines+=("$machine")
done < "$TABLE"

if [ "${#refs[@]}" -eq 0 ]; then
  echo "warning: no refs parsed from $TABLE" >&2
fi

now_epoch=$(date +%s)

# ---- Orca: fetch the Run once ----
# One line per worker: task_title US dispatch_id US verdict US activity US outcome US dispatch_status US worker_state
# (US = unit separator, 0x1f). Tasks come from task-list (worker-list carries no title).
orca_workers=""
if [ "$ORCA" -eq 1 ]; then
  tasks_json=$("$ORCA_BIN" orchestration task-list --run "$RUN" --json 2>/dev/null || true)
  workers_json=$("$ORCA_BIN" orchestration worker-list --run "$RUN" --include-remote --limit 100 --json 2>/dev/null || true)
  if [ -z "$tasks_json" ] || [ -z "$workers_json" ] || ! printf '%s' "$workers_json" | jq -e '.ok == true' >/dev/null 2>&1; then
    echo "error: could not read Run $RUN from Orca (worker-list failed)" >&2
    exit 2
  fi
  orca_workers=$(jq -rn --argjson tasks "$tasks_json" --argjson workers "$workers_json" '
    ($tasks.result.tasks // [] | map({key: .id, value: (.task_title // .display_name // "")}) | from_entries) as $titles
    | $workers.result.workers[]
    | [ ($titles[.taskId] // ""), .dispatchId, (.projection.liveness.verdict // "unknown"),
        (.projection.stage.activity // "unknown"), (.projection.outcome // ""), (.dispatchStatus // ""), (.workerState // "") ]
    | join("\u001f")')
fi

# Map Orca worker fields to one status word. Preference when a ref has several
# dispatches (retries): a live one wins, otherwise the last listed.
orca_status_for_ref() {
  local ref="$1" line title dispatch verdict activity outcome dstatus wstate chosen=""
  while IFS=$'\037' read -r title dispatch verdict activity outcome dstatus wstate; do
    [ -z "$title" ] && continue
    if [ "$title" = "$ref" ] || [ "${title#"$ref":}" != "$title" ]; then
      chosen="$dispatch"$'\037'"$verdict"$'\037'"$activity"$'\037'"$outcome"$'\037'"$dstatus"$'\037'"$wstate"
      [ "$verdict" = "live" ] && break
    fi
  done <<< "$orca_workers"
  if [ -z "$chosen" ]; then printf 'missing\037\n'; return; fi
  IFS=$'\037' read -r dispatch verdict activity outcome dstatus wstate <<< "$chosen"
  local status
  case "$verdict" in
    live)
      case "$activity" in
        idle|waiting*) status="idle" ;;
        *) status="running" ;;
      esac ;;
    exited)
      case "$outcome:$dstatus:$wstate" in
        succeeded:*|*:succeeded:*) status="done" ;;
        failed:*|*:failed:*) status="blocked" ;;
        *stopped*|*cancel*) status="stopped" ;;
        *) status="exited" ;;
      esac ;;
    unverifiable) status="unverifiable" ;;
    *) status="unknown" ;;
  esac
  printf '%s\037%s\n' "$status" "$dispatch"
}

# ---- per-ref lookups ----
declare -a OUT_REF OUT_STATUS OUT_ELAPSED OUT_BUDGET OUT_REPORT OUT_NOTE OUT_MACHINE

for i in "${!refs[@]}"; do
  ref="${refs[$i]}"
  ref_machine="${ref_machines[$i]}"

  status="unknown"
  note=""

  if [ "$ORCA" -eq 1 ]; then
    IFS=$'\037' read -r status dispatch_id <<< "$(orca_status_for_ref "$ref")"
    [ -n "${dispatch_id:-}" ] && note="$dispatch_id"
  else
    agent_name="${PREFIX}${ref}"
    agent_json=$(herdr agent get "$agent_name" 2>/dev/null || true)
    if [ -z "$agent_json" ]; then
      status="missing"
    else
      status=$(printf '%s' "$agent_json" | jq -r '.result.agent.agent_status // "unknown"' 2>/dev/null || echo "unknown")
      [ -z "$status" ] && status="unknown"
    fi
  fi

  # elapsed / budget
  elapsed_min=""
  budget_min=""
  if [ -n "$BUDGETS" ] && [ -f "$BUDGETS" ]; then
    started=$(jq -r --arg r "$ref" '.[$r].started // empty' "$BUDGETS" 2>/dev/null || true)
    budget_min=$(jq -r --arg r "$ref" '.[$r].budget_min // empty' "$BUDGETS" 2>/dev/null || true)
    if [ -n "$started" ]; then
      started_epoch=$(date -j -f '%Y-%m-%dT%H:%M:%S%z' "$started" '+%s' 2>/dev/null || true)
      if [ -z "$started_epoch" ]; then
        # GNU date fallback (Linux)
        started_epoch=$(date -d "$started" '+%s' 2>/dev/null || true)
      fi
      if [ -n "$started_epoch" ]; then
        elapsed_min=$(( (now_epoch - started_epoch) / 60 ))
      fi
    fi
  fi

  # report file
  report_state="-"
  if [ -n "$REPORTS_DIR" ]; then
    report_file="${REPORTS_DIR%/}/${ref}.md"
    if [ -f "$report_file" ]; then
      first_line=$(head -n 1 "$report_file" 2>/dev/null || true)
      report_status=$(printf '%s' "$first_line" | sed -n 's/^STATUS: *//p')
      if [ -n "$report_status" ]; then
        report_state="$report_status"
      else
        report_state="present"
      fi
    else
      report_state="none"
    fi
  fi

  OUT_REF+=("$ref")
  OUT_STATUS+=("$status")
  if [ -n "$elapsed_min" ] && [ -n "$budget_min" ]; then
    OUT_ELAPSED+=("${elapsed_min}m/${budget_min}m")
  elif [ -n "$elapsed_min" ]; then
    OUT_ELAPSED+=("${elapsed_min}m/-")
  else
    OUT_ELAPSED+=("-")
  fi
  OUT_BUDGET+=("$budget_min")
  OUT_REPORT+=("$report_state")
  OUT_NOTE+=("$note")
  OUT_MACHINE+=("$ref_machine")
done

# ---- machine status (local) ----
ncpu=""
if command -v sysctl >/dev/null 2>&1; then
  ncpu=$(sysctl -n hw.ncpu 2>/dev/null || true)
fi
if [ -z "$ncpu" ] && command -v nproc >/dev/null 2>&1; then
  ncpu=$(nproc 2>/dev/null || true)
fi
[ -z "$ncpu" ] && ncpu="?"

load1=""
if command -v uptime >/dev/null 2>&1; then
  load1=$(uptime | sed -n 's/.*load averages\{0,1\}:\{0,1\} *\([0-9.]*\).*/\1/p')
fi
[ -z "$load1" ] && load1="?"

mem_summary=""
if command -v memory_pressure >/dev/null 2>&1; then
  mem_line=$(memory_pressure 2>/dev/null | grep -m1 -i 'memory free percentage' || true)
  if [ -n "$mem_line" ]; then
    mem_summary="$mem_line"
  fi
fi
if [ -z "$mem_summary" ] && command -v vm_stat >/dev/null 2>&1; then
  free_pages=$(vm_stat 2>/dev/null | awk '/Pages free/{gsub("\\.","",$3); print $3}')
  [ -n "$free_pages" ] && mem_summary="free pages: ${free_pages}"
fi
if [ -z "$mem_summary" ] && command -v free >/dev/null 2>&1; then
  mem_summary=$(free -m 2>/dev/null | awk '/^Mem:/{printf "free: %sMB / total: %sMB", $4, $2}')
fi
[ -z "$mem_summary" ] && mem_summary="unavailable"

if command -v pgrep >/dev/null 2>&1; then
  heavy_count=$(pgrep -f -- 'vitest|karma|ng build|tsc |turbo|jest|playwright|headless' 2>/dev/null | wc -l | tr -d ' ')
else
  # shellcheck disable=SC2009 # pgrep unavailable; fall back to ps+grep, excluding grep itself
  heavy_count=$(ps -Ao command= 2>/dev/null | grep -E 'vitest|karma|ng build|tsc |turbo|jest|playwright|headless' | grep -vc 'grep' || true)
fi
[ -z "$heavy_count" ] && heavy_count=0

# ---- machine status (remote, --orca only) ----
# One probe per distinct remote machine named in the table. The probe is a
# throwaway Orca terminal on that environment running a one-line report; the
# shell stays open afterwards, so we poll `terminal read` for the end marker
# and then close it. Every per-terminal call needs --environment, or the local
# runtime answers terminal_handle_stale.
declare -a M_NAME M_LOAD1 M_NCPU M_MEM M_HEAVY M_OK
M_NAME+=("local"); M_LOAD1+=("$load1"); M_NCPU+=("$ncpu"); M_MEM+=("$mem_summary"); M_HEAVY+=("$heavy_count"); M_OK+=(1)

probe_remote() {
  # $1 = machine name or environment id. Sets r_load1 r_ncpu r_mem r_heavy; returns 1 on failure.
  local machine="$1" env_id setup_path handle out tail tries
  r_load1="?"; r_ncpu="?"; r_mem="unavailable"; r_heavy=0
  env_id=$("$ORCA_BIN" environment list --json 2>/dev/null \
    | jq -r --arg m "$machine" '.result.environments[]? | select(.id == $m or .name == $m) | .id' | head -n 1)
  [ -z "$env_id" ] && return 1
  setup_path=$("$ORCA_BIN" project setups --environment "$env_id" --json 2>/dev/null \
    | jq -r '.result.setups[]? | select(.setupState == "ready" or .setupState == null) | .path' | head -n 1)
  [ -z "$setup_path" ] && return 1
  out=$("$ORCA_BIN" terminal create --environment "$env_id" --worktree "path:$setup_path" --title "team-status probe" \
    --command "echo PROBE-BEGIN; nproc; uptime; free -m | awk '/Mem:/{print \$7}'; pgrep -fc '[v]itest|[k]arma|[n]g build|[t]sc |[t]urbo|[j]est|[p]laywright|[h]eadless'; echo PROBE-END" --json 2>/dev/null || true)
  handle=$(printf '%s' "$out" | jq -r '.result.terminal.handle // empty' 2>/dev/null)
  [ -z "$handle" ] && return 1
  tail=""
  for tries in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    tail=$("$ORCA_BIN" terminal read --environment "$env_id" --terminal "$handle" --json 2>/dev/null \
      | jq -r '.result.terminal.tail[]?' 2>/dev/null || true)
    case "$tail" in *PROBE-END*) break ;; esac
    sleep 1
  done
  "$ORCA_BIN" terminal close --environment "$env_id" --terminal "$handle" --json >/dev/null 2>&1 || true
  case "$tail" in *PROBE-END*) ;; *) return 1 ;; esac
  # Lines after PROBE-BEGIN: ncpu, uptime, available MB, heavy count.
  r_ncpu=$(printf '%s\n' "$tail" | awk '/^PROBE-BEGIN$/{f=1; next} f && /^[0-9]+$/{print; exit}')
  r_load1=$(printf '%s\n' "$tail" | sed -n 's/.*load average[s]*: *\([0-9.]*\).*/\1/p' | head -n 1)
  r_mem=$(printf '%s\n' "$tail" | awk '/load average/{f=1; next} f && /^[0-9]+$/{print "available: " $1 "MB"; exit}')
  r_heavy=$(printf '%s\n' "$tail" | awk '/load average/{f=1; next} f && /^[0-9]+$/{n++; if (n == 2) {print; exit}}')
  [ -z "$r_ncpu" ] && r_ncpu="?"
  [ -z "$r_load1" ] && r_load1="?"
  [ -z "$r_mem" ] && r_mem="unavailable"
  [ -z "$r_heavy" ] && r_heavy=0
  return 0
}

if [ "$ORCA" -eq 1 ]; then
  seen_machines=" local "
  for m in "${OUT_MACHINE[@]}"; do
    case "$seen_machines" in *" $m "*) continue ;; esac
    seen_machines="$seen_machines$m "
    if probe_remote "$m"; then
      M_NAME+=("$m"); M_LOAD1+=("$r_load1"); M_NCPU+=("$r_ncpu"); M_MEM+=("$r_mem"); M_HEAVY+=("$r_heavy"); M_OK+=(1)
    else
      M_NAME+=("$m"); M_LOAD1+=("?"); M_NCPU+=("?"); M_MEM+=("unavailable"); M_HEAVY+=(0); M_OK+=(0)
    fi
  done
fi

# ---- alerts ----
alerts=()
for i in "${!OUT_REF[@]}"; do
  ref="${OUT_REF[$i]}"
  status="${OUT_STATUS[$i]}"
  budget_min="${OUT_BUDGET[$i]}"
  elapsed_field="${OUT_ELAPSED[$i]}"
  report_state="${OUT_REPORT[$i]}"

  if [ "$status" = "missing" ]; then
    alerts+=("MISSING $ref")
    continue
  fi

  if [ "$status" = "blocked" ]; then
    alerts+=("BLOCKED $ref")
  fi

  if [ "$status" = "unverifiable" ]; then
    alerts+=("UNVERIFIABLE $ref")
  fi

  if [ -n "$budget_min" ] && [ "$budget_min" != "null" ]; then
    elapsed_only="${elapsed_field%%m/*}"
    if [ "$elapsed_only" != "-" ] && [ -n "$elapsed_only" ]; then
      if [ "$elapsed_only" -gt "$budget_min" ] 2>/dev/null; then
        alerts+=("OVER-BUDGET $ref ${elapsed_only}m/${budget_min}m")
      fi
    fi
  fi

  if { [ "$status" = "done" ] || [ "$status" = "idle" ]; } && [ "$report_state" != "-" ] && [ "$report_state" != "none" ]; then
    alerts+=("DONE $ref")
  fi
done

for mi in "${!M_NAME[@]}"; do
  m_name="${M_NAME[$mi]}"; m_load1="${M_LOAD1[$mi]}"; m_ncpu="${M_NCPU[$mi]}"; m_heavy="${M_HEAVY[$mi]}"
  if [ "$ORCA" -eq 1 ]; then tag="$m_name "; else tag=""; fi
  if [ "${M_OK[$mi]}" -eq 0 ]; then
    alerts+=("PROBE-FAILED $m_name")
    continue
  fi
  if [ "$m_load1" != "?" ] && [ "$m_ncpu" != "?" ]; then
    load1_int=${m_load1%%.*}
    if [ "$load1_int" -gt "$m_ncpu" ] 2>/dev/null; then
      alerts+=("LOAD ${tag}${m_load1}/${m_ncpu}")
    fi
  fi
  if [ "$m_heavy" -gt 2 ] 2>/dev/null; then
    alerts+=("HEAVY ${tag}${m_heavy} processes")
  fi
done

# ---- state tracking for alerts ----
output_alerts=("${alerts[@]}")

if [ "$ALERTS_ONLY" -eq 1 ] && [ -n "$STATE_FILE" ]; then
  # Read previous state
  declare -a prev_alerts
  if [ -f "$STATE_FILE" ]; then
    while IFS= read -r line; do
      prev_alerts+=("$line")
    done < "$STATE_FILE"
  fi

  # Function to extract alert keyword (e.g., "LOAD" from "LOAD 1.5/4")
  extract_keyword() {
    local alert="$1"
    printf '%s' "$alert" | awk '{print $1}'
  }

  # Function to match alert by keyword only (for LOAD/HEAVY which have changing
  # numbers); with --orca the machine name (second word) must match too.
  alert_matches_by_keyword() {
    local current="$1"
    local previous="$2"
    local curr_keyword prev_keyword
    curr_keyword=$(extract_keyword "$current")
    prev_keyword=$(extract_keyword "$previous")
    if [ "$curr_keyword" = "LOAD" ] || [ "$curr_keyword" = "HEAVY" ]; then
      [ "$curr_keyword" = "$prev_keyword" ] || return 1
      if [ "$ORCA" -eq 1 ]; then
        [ "$(printf '%s' "$current" | awk '{print $2}')" = "$(printf '%s' "$previous" | awk '{print $2}')" ]
      fi
    else
      [ "$current" = "$previous" ]
    fi
  }

  # Find new alerts (in current but not in previous)
  declare -a new_alerts
  for curr in "${alerts[@]}"; do
    found=0
    for prev in "${prev_alerts[@]}"; do
      if alert_matches_by_keyword "$curr" "$prev"; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      new_alerts+=("$curr")
    fi
  done

  # Find cleared alerts (in previous but not in current)
  declare -a cleared_alerts
  for prev in "${prev_alerts[@]}"; do
    found=0
    for curr in "${alerts[@]}"; do
      if alert_matches_by_keyword "$curr" "$prev"; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      keyword=$(extract_keyword "$prev")
      if [ "$ORCA" -eq 1 ] && { [ "$keyword" = "LOAD" ] || [ "$keyword" = "HEAVY" ]; }; then
        keyword="$keyword $(printf '%s' "$prev" | awk '{print $2}')"
      fi
      cleared_alerts+=("CLEARED $keyword")
    fi
  done

  # Output new and cleared alerts
  output_alerts=()
  for alert in "${new_alerts[@]}"; do
    output_alerts+=("$alert")
  done
  for alert in "${cleared_alerts[@]}"; do
    output_alerts+=("$alert")
  done

  # Update state file with current alerts
  {
    for alert in "${alerts[@]}"; do
      printf '%s\n' "$alert"
    done
  } > "$STATE_FILE"
fi

# ---- output ----
if [ "$ALERTS_ONLY" -eq 1 ]; then
  for line in "${output_alerts[@]}"; do
    printf '%s\n' "$line"
  done
  exit 0
fi

if [ "$JSON_OUT" -eq 1 ]; then
  {
    printf '{'
    printf '"refs":['
    for i in "${!OUT_REF[@]}"; do
      [ "$i" -gt 0 ] && printf ','
      jq -nc \
        --arg ref "${OUT_REF[$i]}" \
        --arg status "${OUT_STATUS[$i]}" \
        --arg elapsed "${OUT_ELAPSED[$i]}" \
        --arg report "${OUT_REPORT[$i]}" \
        --arg machine "${OUT_MACHINE[$i]}" \
        --arg note "${OUT_NOTE[$i]}" \
        '{ref:$ref,status:$status,elapsed:$elapsed,report:$report,machine:$machine,note:$note}'
    done
    printf '],'
    printf '"machine":'
    jq -nc \
      --arg load1 "$load1" \
      --arg ncpu "$ncpu" \
      --arg mem "$mem_summary" \
      --argjson heavy "$heavy_count" \
      '{load1:$load1,ncpu:$ncpu,mem:$mem,heavy_processes:$heavy}'
    printf ','
    printf '"machines":['
    for mi in "${!M_NAME[@]}"; do
      [ "$mi" -gt 0 ] && printf ','
      jq -nc \
        --arg name "${M_NAME[$mi]}" \
        --arg load1 "${M_LOAD1[$mi]}" \
        --arg ncpu "${M_NCPU[$mi]}" \
        --arg mem "${M_MEM[$mi]}" \
        --arg heavy "${M_HEAVY[$mi]}" \
        --argjson ok "$([ "${M_OK[$mi]}" -eq 1 ] && echo true || echo false)" \
        '{machine:$name,load1:$load1,ncpu:$ncpu,mem:$mem,heavy_processes:($heavy|tonumber? // 0),probed:$ok}'
    done
    printf '],'
    printf '"alerts":['
    for i in "${!alerts[@]}"; do
      [ "$i" -gt 0 ] && printf ','
      jq -nc --arg a "${alerts[$i]}" '$a'
    done
    printf ']'
    printf '}\n'
  }
  exit 0
fi

if [ "$ORCA" -eq 1 ]; then
  printf '%-24s %-13s %-14s %-10s %-12s %s\n' "ref" "status" "elapsed/budget" "report" "machine" "dispatch"
  for i in "${!OUT_REF[@]}"; do
    printf '%-24s %-13s %-14s %-10s %-12s %s\n' \
      "${OUT_REF[$i]}" "${OUT_STATUS[$i]}" "${OUT_ELAPSED[$i]}" "${OUT_REPORT[$i]}" "${OUT_MACHINE[$i]}" "${OUT_NOTE[$i]}"
  done
else
  printf '%-24s %-10s %-14s %-10s %s\n' "ref" "status" "elapsed/budget" "report" "note"
  for i in "${!OUT_REF[@]}"; do
    printf '%-24s %-10s %-14s %-10s %s\n' \
      "${OUT_REF[$i]}" "${OUT_STATUS[$i]}" "${OUT_ELAPSED[$i]}" "${OUT_REPORT[$i]}" "${OUT_NOTE[$i]}"
  done
fi

for mi in "${!M_NAME[@]}"; do
  if [ "${M_OK[$mi]}" -eq 1 ]; then
    printf 'machine %s: load1=%s ncpu=%s heavy_procs=%s mem: %s\n' "${M_NAME[$mi]}" "${M_LOAD1[$mi]}" "${M_NCPU[$mi]}" "${M_HEAVY[$mi]}" "${M_MEM[$mi]}"
  else
    printf 'machine %s: probe failed (no reachable environment or registered project setup)\n' "${M_NAME[$mi]}"
  fi
done

exit 0
