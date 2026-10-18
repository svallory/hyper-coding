#!/usr/bin/env bash
#
# retire-agent.sh — retire a Herdr-hosted agent completely: stop the agent
# process the way its harness expects, wait until Herdr no longer lists it,
# close its tab, and optionally remove its worktree.
#
# A "retired" agent whose tab stays open is not retired: the pane still holds
# a shell, the tab clutters the operator's workspace, and the next lead cannot
# tell a finished dev from a live one. This script is the one retire path.
#
# Usage:
#   retire-agent.sh <agent-name-or-pane-id> [--machine <label>] [--keep-tab]
#                   [--worktree <branch> [--force]] [--timeout <seconds>]
#
#   --machine   a saved Herdr SSH profile; the agent lives there
#   --keep-tab  stop the agent but leave the tab (a shell) open
#   --worktree  also `wt remove <branch>` after the tab is closed, run from the
#               current directory (the space root); with --machine it runs on
#               that machine over SSH, in the same path. --force passes -D to
#               delete an unmerged branch.
#   --timeout   seconds to wait for the agent to disappear (default 60)
#
# Exit codes: 0 retired (a pane id whose agent already exited gets its tab
# closed and exits 0 too); 1 bad arguments; 2 no agent by that name and it is
# not a pane id; 3 the agent did not stop in time (tab left open so a human can
# look); 4 worktree removal failed (agent and tab are gone); 5 the tab did not
# close (agent is stopped).

set -euo pipefail

name=""; machine=""; keep_tab=0; worktree=""; force=0; timeout=60
while [ $# -gt 0 ]; do
  case "$1" in
    --machine|--worktree|--timeout)
      [ $# -ge 2 ] || { echo "retire-agent: $1 needs a value" >&2; exit 1; }
      case "$1" in
        --machine) machine="$2" ;;
        --worktree) worktree="$2" ;;
        --timeout) timeout="$2" ;;
      esac
      shift 2 ;;
    --keep-tab) keep_tab=1; shift ;;
    --force) force=1; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    -*) echo "retire-agent: unknown option $1" >&2; exit 1 ;;
    *) if [ -z "$name" ]; then name="$1"; else echo "retire-agent: one agent at a time" >&2; exit 1; fi; shift ;;
  esac
done
[ -n "$name" ] || { echo "retire-agent: agent name or pane id required" >&2; exit 1; }
case "$timeout" in ''|*[!0-9]*) echo "retire-agent: --timeout takes whole seconds" >&2; exit 1 ;; esac
command -v herdr >/dev/null || { echo "retire-agent: herdr not on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "retire-agent: jq not on PATH" >&2; exit 1; }

h() { if [ -n "$machine" ]; then herdr --machine "$machine" "$@"; else herdr "$@"; fi; }

close_tab() {
  if [ "$keep_tab" = 1 ]; then echo "retire-agent: tab $tab kept open (--keep-tab)"; return; fi
  if h tab close "$tab" >/dev/null; then
    echo "retire-agent: tab $tab closed"
  else
    echo "retire-agent: could not close tab $tab" >&2; exit 5
  fi
}

# Resolve the agent: kind, pane, tab. A pane id with no agent still gets its tab closed.
info="$(h agent get "$name" 2>/dev/null || true)"
kind="$(printf '%s' "$info" | jq -r '.result.agent.agent // empty' 2>/dev/null || true)"
pane="$(printf '%s' "$info" | jq -r '.result.agent.pane_id // empty' 2>/dev/null || true)"
tab="$(printf '%s' "$info" | jq -r '.result.agent.tab_id // empty' 2>/dev/null || true)"

if [ -z "$pane" ]; then
  case "$name" in
    w*:p*)
      pane="$name"
      tab="$(h pane get "$pane" 2>/dev/null | jq -r '.result.pane.tab_id // empty' || true)"
      ;;
  esac
  if [ -z "$tab" ]; then
    echo "retire-agent: no agent named '$name' and it is not a pane id" >&2; exit 2
  fi
  echo "retire-agent: no agent in $pane (already stopped)"
  close_tab
  exit 0
fi

echo "retire-agent: $name is a $kind agent in pane $pane (tab $tab)"

# Stop the agent the way its harness expects. Never type a prompt into a pi or
# codex agent: "/exit" is a user turn there and re-sends the whole context.
send_stop() {
  case "$kind" in
    claude) h agent prompt "$name" "/exit" >/dev/null 2>&1 || h agent send-keys "$name" ctrl+d >/dev/null 2>&1 || true ;;
    pi)     h agent send-keys "$name" ctrl+d >/dev/null 2>&1 || true ;;
    codex)  h agent send-keys "$name" ctrl+c >/dev/null 2>&1 || true; sleep 1; h agent send-keys "$name" ctrl+c >/dev/null 2>&1 || true ;;
    *)      h agent send-keys "$name" ctrl+d >/dev/null 2>&1 || true ;;
  esac
}

gone() { ! h agent get "$name" >/dev/null 2>&1; }

send_stop
waited=0; escalated=0
while ! gone; do
  if [ "$waited" -ge "$timeout" ]; then
    echo "retire-agent: $name still present after ${timeout}s; tab $tab left open" >&2; exit 3
  fi
  # Escalate once at a third of the budget: an agent mid-turn ignores ctrl+d,
  # esc then ctrl+c gets it back to its prompt, then the stop key again.
  if [ "$escalated" = 0 ] && [ "$waited" -ge $((timeout / 3)) ]; then
    escalated=1
    h agent send-keys "$name" esc >/dev/null 2>&1 || true
    sleep 1
    h agent send-keys "$name" ctrl+c >/dev/null 2>&1 || true
    sleep 1
    send_stop
  fi
  sleep 2; waited=$((waited + 2))
done
echo "retire-agent: $name stopped"

close_tab

if [ -n "$worktree" ]; then
  wt_args=(remove); [ "$force" = 1 ] && wt_args+=(-D); wt_args+=("$worktree")
  if [ -n "$machine" ]; then
    # The worktree lives where the agent ran. Herdr's machine profile names the SSH target.
    target="$(herdr machine list --json 2>/dev/null | jq -r --arg m "$machine" '.[] | select(.label == $m or .id == $m) | .target' | head -n 1)"
    [ -n "$target" ] || { echo "retire-agent: no Herdr machine '$machine' to remove $worktree on" >&2; exit 4; }
    ssh -o BatchMode=yes "$target" "cd $(printf '%q' "$PWD") && wt $(printf '%q ' "${wt_args[@]}")" || exit 4
  else
    wt "${wt_args[@]}" || exit 4
  fi
  echo "retire-agent: worktree $worktree removed${machine:+ on $machine}"
fi
