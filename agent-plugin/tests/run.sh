#!/usr/bin/env bash
# Test runner: executes every tests/test-*.sh under bash (never zsh), prints
# each file's TAP-ish assertion lines, and exits non-zero when anything fails.
# No dependencies beyond bash, git, node, and coreutils.
#
# Usage: bash tests/run.sh

set -u

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# C-12: no test may reach a real multiplexer server. SHIP_MUX_TEST=1 makes the
# Herdr backend exit 99 before anything else, and a `herdr` stub that fails
# loudly sits first on PATH in case anything else calls the command directly.
stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/hyper-herdr-stub.XXXXXX")"
trap 'rm -rf "$stub_dir"' EXIT
cat > "$stub_dir/herdr" <<'STUB'
#!/bin/sh
echo "herdr stub: a test called the real herdr command; this must never run" >&2
exit 97
STUB
chmod +x "$stub_dir/herdr"
export SHIP_MUX_TEST=1
export PATH="$stub_dir:$PATH"

file_timeout="${HYPER_TEST_FILE_TIMEOUT:-900}"

total_pass=0
total_fail=0
crashed=0
files=0

for f in "$dir"/test-*.sh; do
  [[ -f "$f" ]] || continue
  files=$((files + 1))
  name="$(basename "$f")"
  echo "# === $name"
  # Output goes to a file, not a command substitution: a leaked background
  # child holding the pipe would otherwise keep this runner waiting forever.
  # The per-file alarm (seconds, HYPER_TEST_FILE_TIMEOUT) turns a hang into a
  # loud failure instead of a stuck job.
  perl -e 'alarm shift; exec @ARGV' "$file_timeout" bash "$f" >"$stub_dir/out" 2>&1 </dev/null
  status=$?
  out="$(cat "$stub_dir/out")"
  if [[ $status -eq 142 ]]; then
    out="$out"$'\n'"not ok - $name timed out after ${file_timeout}s"
  fi
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
