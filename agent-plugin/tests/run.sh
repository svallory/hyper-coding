#!/usr/bin/env bash
# Test runner: executes every tests/test-*.sh under bash (never zsh), prints
# each file's TAP-ish assertion lines, and exits non-zero when anything fails.
# No dependencies beyond bash, git, node, and coreutils.
#
# Usage: bash tests/run.sh

set -u

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

total_pass=0
total_fail=0
crashed=0
files=0

for f in "$dir"/test-*.sh; do
  [[ -f "$f" ]] || continue
  files=$((files + 1))
  name="$(basename "$f")"
  echo "# === $name"
  out="$(bash "$f" 2>&1)"
  status=$?
  printf '%s\n' "$out" | sed 's/^/    /'

  p="$(printf '%s\n' "$out" | grep -c '^ok ')"
  q="$(printf '%s\n' "$out" | grep -c '^not ok ')"
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + q))

  # A file that dies before reporting (syntax error, crashed fixture setup)
  # must still fail the suite, not vanish silently.
  if [[ $status -ne 0 && $q -eq 0 ]]; then
    echo "    # FILE CRASHED: exited $status without reporting a failed assertion"
    crashed=$((crashed + 1))
  fi
  echo
done

echo "# $files files, $((total_pass + total_fail)) assertions: $total_pass passed, $total_fail failed, $crashed crashed"

if [[ $total_fail -eq 0 && $crashed -eq 0 && $files -gt 0 ]]; then
  exit 0
fi
exit 1
