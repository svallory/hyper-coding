#!/usr/bin/env bash
# Stack registry and dispatcher.
#
# Usage: hyper-stack.sh detect [dir]   — print KEY=VALUE toolchain facts
#        hyper-stack.sh list           — list registered stacks
#
# Adding a stack is intentionally mechanical: drop a directory under stacks/
# containing detect.sh that defines stack_matches() and stack_detect(). No
# change to this file is required — stacks are discovered, not enumerated.
#
# Detection reports only what is verifiable in the project. It never guesses a
# command. Absence of a key means "unknown", and callers must ask the user
# rather than inventing a default, because a wrong lint command fails silently
# and trains everyone to ignore the hook.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACKS_DIR="$PLUGIN_DIR/stacks"

cmd="${1:-detect}"
dir="${2:-$PWD}"
dir="$(cd "$dir" 2>/dev/null && pwd)" || { echo "no such directory: ${2:-$PWD}" >&2; exit 1; }

list_stacks() {
  local s
  for s in "$STACKS_DIR"/*/detect.sh; do
    [[ -f "$s" ]] || continue
    basename "$(dirname "$s")"
  done
}

case "$cmd" in
  list)
    list_stacks
    ;;

  detect)
    # First match wins: emitting two stacks would interleave conflicting keys
    # (two PM= lines) and corrupt the KEY=VALUE stream. Other matches are
    # reported as a trailing comment so polyglot repos stay visible.
    winner=""
    also=()
    for detect_file in "$STACKS_DIR"/*/detect.sh; do
      [[ -f "$detect_file" ]] || continue

      # Each stack is sourced in a subshell so its stack_matches/stack_detect
      # definitions cannot leak into the next iteration.
      if (
        # shellcheck source=/dev/null
        source "$detect_file"
        declare -f stack_matches >/dev/null && stack_matches "$dir"
      ); then
        if [[ -z "$winner" ]]; then
          winner="$detect_file"
        else
          also+=("$(basename "$(dirname "$detect_file")")")
        fi
      fi
    done

    if [[ -z "$winner" ]]; then
      echo "STACK=unknown"
      echo "# No registered stack matched. Registered: $(list_stacks | tr '\n' ' ')"
      exit 0
    fi

    (
      # shellcheck source=/dev/null
      source "$winner"
      stack_detect "$dir"
    )
    if (( ${#also[@]} > 0 )); then
      echo "# also matches: ${also[*]}"
    fi
    ;;

  *)
    echo "usage: $(basename "$0") {detect|list} [dir]" >&2
    exit 2
    ;;
esac
