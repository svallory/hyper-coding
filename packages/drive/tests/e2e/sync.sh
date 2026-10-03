#!/usr/bin/env bash
# e2e: config sync end to end, against a real Mutagen and a real SSH hop to
# localhost.
#
# Runs `hyper drive sync-config loop` where `loop` is a fake machine that
# Herdr maps to host `localhost` with a temp home on both sides. It asserts:
#   1. `mutagen version` and the version this script was written against
#   2. `sync-config loop` creates both sessions (Claude + pi)
#   3. `--check` then reports ready
#   4. a file written on alpha shows up on beta within 60s
#   5. an ignored path (.credentials.json) never reaches beta
#   6. a symlink to an absolute target resolves on beta (posix-raw symlinks)
#   7. both sessions are terminated at the end (trap), so nothing is left running
#
# Usage: packages/drive/tests/e2e/sync.sh
# Cost:   creates two throwaway Mutagen sessions named hyper-claude-loop-test /
#         hyper-pi-loop-test, a temp fake `herdr` on PATH, and an ssh hop to
#         localhost. It NEVER touches the operator's real ~/.claude or their
#         existing claude-config / pi-config sessions. Requires sshd reachable
#         at localhost (Remote Login on macOS).

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg="$(cd "$here/../.." && pwd)"
# e2e -> tests -> drive -> packages, so the CLI is three levels up.
cli="$here/../../../cli/bin/run.js"
[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }
# `sync-config loop` derives the session names from the machine name, so they
# are exactly these — NOT suffixed. The trap must terminate these exact names,
# so a preflight below refuses to run if they already exist (they would be
# someone else's session, and this script must never terminate those).
claude_session="hyper-claude-loop"
pi_session="hyper-pi-loop"
verified="0.18.1"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

echo "# mutagen version"
version="$(mutagen version 2>/dev/null | awk '{print $1}')"
echo "$version"
if [ "$version" != "$verified" ]; then
  echo "# WARNING: this script was written against mutagen $verified; $version may differ" >&2
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-sync.XXXXXX")"
# macOS: /tmp is a symlink to /private/tmp; resolve so Mutagen (which records
# realpath) and the assertions agree.
work_real="$(cd "$work" && pwd -P)"
alpha_home="$work_real/alpha"
beta_home="$work_real/beta"
fakebin="$work_real/bin"
log="$work_real/mutagen.log"
mkdir -p "$alpha_home" "$beta_home" "$fakebin" "$alpha_home/.claude" "$alpha_home/.pi/agent"

cleanup() {
  echo "# cleaning up sessions"
  mutagen sync terminate "$claude_session" >/dev/null 2>&1 || true
  mutagen sync terminate "$pi_session" >/dev/null 2>&1 || true
  rm -rf "$work"
}
# NOTE: `trap cleanup EXIT` is installed AFTER the preflight below, not here.
# Installing it earlier means the preflight's `exit 1` fires cleanup, which
# terminates the very `hyper-*-loop` session it just refused to touch.

# Fake herdr: the `loop` machine is host `localhost` with a temp home on both sides.
cat > "$fakebin/herdr" <<EOF
#!/bin/sh
cat <<'JSON'
[{"label":"loop","target":"localhost","enabled":true}]
JSON
EOF
chmod +x "$fakebin/herdr"

# Temp drive.toml. self.home is the temp alpha so hyperdrive never syncs the real ~/.claude.
cat > "$work_real/drive.toml" <<EOF
[self]
name = "e2e-host"
home = "$alpha_home"

[machines.loop]
home = "$beta_home"
features = ["mutagen"]
agent_user = "agent"
EOF

export PATH="$fakebin:$PATH"
export HYPER_DRIVE_CONFIG="$work_real/drive.toml"

# Runs the CLI, echoing its output AND returning its real exit status. An
# earlier version ended in `|| true`, which made `$?` always 0 and turned the
# "--check exits 0" assertion into one that could never fail.
run_cli() {
  local status
  NO_COLOR=1 FORCE_COLOR=0 bun "$cli" "$@" 2>&1
  status=$?
  return $status
}

echo "# sync-config loop (create)"
# Preflight: never touch a session that isn't ours.
existing="$(mutagen sync list 2>/dev/null | grep -E '^Name:' | sed 's/^Name: //' || true)"
for name in "$claude_session" "$pi_session"; do
  if printf '%s\n' "$existing" | grep -qx "$name"; then
    echo "# refusing to run: a session called '$name' already exists (this script terminates" >&2
    echo "# those names in its trap). Remove it first, or rename the machine in the toml." >&2
    exit 1
  fi
done

trap cleanup EXIT

# SHOULD: the create step must be able to FAIL LOUDLY. Previously `out=$(...)`
# under `set -e` aborted the script on a non-zero exit with no `not ok` line at
# all, so a broken create looked like a silent, truncated run.
set +e
out="$(run_cli drive sync-config loop)"
create_rc=$?
set -e
echo "$out"
if [ "$create_rc" != 0 ]; then
  die "sync-config loop exited $create_rc; got: $out"
fi
if ! printf '%s' "$out" | grep -q "$claude_session"; then
  die "expected the claude session to be created; got: $out"
fi
pass "created $claude_session"
if ! printf '%s' "$out" | grep -q "$pi_session"; then
  die "expected the pi session to be created; got: $out"
fi
pass "created $pi_session"

echo "# sync-config loop --check (ready)"
# `--check` is defined by both its output and its exit status, so both are
# captured: errexit is off just for this call.
set +e
out="$(run_cli drive sync-config loop --check)"
rc=$?
set -e
echo "$out"
[ "$rc" = 0 ] || die "--check exited $rc, expected 0; got: $out"
# Both sessions, not just one: a single "ready" line would otherwise pass.
for name in "$claude_session" "$pi_session"; do
  printf '%s' "$out" | grep -F "$name" | grep -q ready \
    || die "--check did not report $name ready; got: $out"
done
pass "--check exits 0 and reports both sessions ready"

echo "# waiting for a file written on alpha to land on beta (up to 60s)"
echo "hello-from-alpha" > "$alpha_home/.claude/probe.txt"
landed=0
for _ in $(seq 1 60); do
  if [ -f "$beta_home/.claude/probe.txt" ] && grep -q hello-from-alpha "$beta_home/.claude/probe.txt"; then
    landed=1
    break
  fi
  sleep 1
done
[ "$landed" = 1 ] || die "file written on alpha never appeared on beta within 60s"
pass "file propagated alpha -> beta"

echo "# ignored path must not reach beta"
echo "secret" > "$alpha_home/.claude/.credentials.json"
# A fixed sleep would race: if the sentinel hasn't landed yet, "not on beta"
# proves nothing. Write a normal file after it, wait for THAT to arrive, then
# the ignored file has demonstrably had every chance to arrive too.
echo "sentinel" > "$alpha_home/.claude/sentinel.txt"
sentinel=0
for _ in $(seq 1 60); do
  if [ -f "$beta_home/.claude/sentinel.txt" ] \
    && grep -q sentinel "$beta_home/.claude/sentinel.txt"; then
    sentinel=1
    break
  fi
  sleep 1
done
[ "$sentinel" = 1 ] || die "sentinel never reached beta, so the ignore check proves nothing"
if [ -e "$beta_home/.claude/.credentials.json" ]; then
  die ".credentials.json is ignored but reached beta"
fi
pass ".credentials.json stayed off beta (sentinel landed first)"

echo "# symlink with an absolute target resolves on beta (posix-raw)"
mkdir -p "$alpha_home/.claude/skills" "$work_real/skill-target"
echo "x" > "$work_real/skill-target/SKILL.md"
ln -s "$work_real/skill-target" "$alpha_home/.claude/skills/x"
# The link must survive as a link (posix-raw), not be copied as a file, and must
# still point at the absolute target it had on alpha.
resolved=0
for _ in $(seq 1 60); do
  if [ -L "$beta_home/.claude/skills/x" ]; then
    resolved=1
    break
  fi
  sleep 1
done
[ "$resolved" = 1 ] || die "skills/x never appeared as a symlink on beta"
if [ "$(cd "$beta_home/.claude" && readlink skills/x)" != "$work_real/skill-target" ]; then
  die "skills/x target changed on beta (expected an absolute posix-raw target)"
fi
# And it must actually resolve to a real file through the link.
[ -f "$beta_home/.claude/skills/x/SKILL.md" ] || die "skills/x does not resolve to a file on beta"
pass "skills/x symlink preserved, absolute and resolving on beta"

echo "# all assertions passed"
exit 0