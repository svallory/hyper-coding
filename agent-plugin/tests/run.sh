#!/usr/bin/env bash
# Test runner: executes every tests/test-*.sh under bash (never zsh), prints
# each file's TAP-ish assertion lines, and exits non-zero when anything fails.
# Dependencies: bash, git, node, perl (per-file process groups and timeouts),
# and coreutils.
#
# Usage: bash tests/run.sh

set -u

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# C-12: no test may reach a real multiplexer server. SHIP_MUX_TEST=1 makes the
# Herdr backend exit 99 before anything else, and a `herdr` stub that fails
# loudly sits first on PATH in case anything else calls the command directly.
stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/hyper-herdr-stub.XXXXXX")"
work="$(mktemp -d "${TMPDIR:-/tmp}/hyper-run.XXXXXX")"
trap 'rm -rf "$stub_dir" "$work"' EXIT
cat > "$stub_dir/herdr" <<'STUB'
#!/bin/sh
echo "herdr stub: a test called the real herdr command; this must never run" >&2
exit 97
STUB
chmod +x "$stub_dir/herdr"
export SHIP_MUX_TEST=1
export PATH="$stub_dir:$PATH"

file_timeout="${HYPER_TEST_FILE_TIMEOUT:-1200}"

total_pass=0
total_fail=0
crashed=0
files=0

for f in "$dir"/test-*.sh; do
  [[ -f "$f" ]] || continue
  files=$((files + 1))
  name="$(basename "$f")"
  echo "# === $name"
  # Each file runs in its own process group with its own output file and its
  # own TMPDIR. On timeout the whole group gets TERM, then KILL, so no child
  # outlives the file to write into a later file's results; the TMPDIR is
  # removed afterwards, so a killed file leaks no fixture directory. Output
  # goes to a file, not a command substitution, so a leaked background child
  # holding a pipe cannot keep this runner waiting. HYPER_TEST_FILE_TIMEOUT is
  # in seconds.
  outfile="$work/$name.out"
  ftmp="$work/tmp-$files"
  mkdir -p "$ftmp"
  TMPDIR="$ftmp" perl -e '
    my ($t, @cmd) = @ARGV;
    my $pid = fork();
    if (!$pid) { setpgrp(0, 0); open(STDIN, "<", "/dev/null"); exec @cmd; exit 127 }
    $SIG{ALRM} = sub {
      kill "TERM", -$pid; select(undef, undef, undef, 1);
      kill "KILL", -$pid; waitpid($pid, 0); exit 142;
    };
    alarm $t; waitpid($pid, 0); my $st = $?; alarm 0;
    kill "KILL", -$pid;   # stragglers left in the group
    exit($st & 127 ? 128 + ($st & 127) : $st >> 8);
  ' "$file_timeout" bash "$f" >"$outfile" 2>&1
  status=$?
  rm -rf "$ftmp"
  out="$(cat "$outfile")"
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
