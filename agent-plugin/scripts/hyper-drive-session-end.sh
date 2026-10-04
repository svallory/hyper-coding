#!/usr/bin/env bash
# SessionEnd must never fail a Claude session. Only a successful commit command
# permits a push; in particular a secret refusal must not publish older commits.
set -u

source "$(dirname "${BASH_SOURCE[0]}")/hyper-require-lib.sh"

if command -v hyper >/dev/null 2>&1; then
  hyper_soft_lib </dev/null 2>/dev/null || exit 0
  root="$(find_space_root "$PWD" 2>/dev/null)" || exit 0
else
  # The canonical library ships in the missing CLI. This fallback only locates
  # hyperdrive metadata for the missing-CLI diagnostic; it never commits and
  # deliberately does not duplicate space_layout or require a HYPER.md marker.
  root="$PWD"
  while [[ "$root" != / && ! -d "$root/.hyper/space.git" ]]; do
    root="$(dirname "$root")"
  done
fi
# hyper-lib.sh enables errexit/pipefail when sourced. This hook owns its exit
# policy, including failures from commit/push and diagnostic formatting.
set +e
set +o pipefail

[[ -d "$root/.hyper/space.git" ]] || exit 0
cadence="$(git --git-dir="$root/.hyper/space.git" config --local hyper.cadence 2>/dev/null)" || exit 0
case "$cadence" in
  session-end|session-end+push) ;;
  *) exit 0 ;;
esac
if ! command -v hyper >/dev/null 2>&1; then
  printf 'hyperdrive: cadence is %s but the hyper CLI is not installed\n' "$cadence"
  exit 0
fi

# Preserve stdin byte-for-byte. Capture both streams so failures are one line,
# even for an older CLI or a verbose network error. Successful hooks are silent.
# Do not use a pipeline for hyper itself: its exit status gates publication.
output="$(hyper space commit --session-end 2>&1)"
status=$?
if [[ $status -eq 0 && "$cadence" == session-end+push ]]; then
  output="$(hyper space push </dev/null 2>&1)"
  status=$?
fi
if [[ $status -ne 0 ]]; then
  if [[ -z "$output" ]]; then output="hyperdrive: session-end save failed; inspect hyper space status (session end continues)."; fi
  line="$(printf '%s' "$output" | tr '\r\n\t' '   ' | tr -d '[:cntrl:]' | cut -c 1-1200)"
  printf '%s\n' "$line"
fi
exit 0
