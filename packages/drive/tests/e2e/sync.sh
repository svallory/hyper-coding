#!/usr/bin/env bash
# e2e: config sync end to end, against a real Mutagen and a real SSH hop to
# localhost.
#
# Runs `hyper machine setup loop --features config-sync` and `hyper drive
# sync-config loop`, where `loop` is a fake machine that Herdr maps to host
# `localhost` with a temp home on both sides. It asserts:
#   1. `mutagen version` and the version this script was written against
#   2. `machine setup loop --features config-sync --yes` creates both sessions
#      (Claude + pi), creating beta's missing `~/.pi` first, and `sync-config
#      loop` then finds them ready (AC-21, review B3)
#   3. `--check` then reports ready
#   4. a plugin written on alpha shows up on beta within 60s, and a transcript
#      written on beta shows up on alpha within 60s (AC-18)
#   5. `.credentials.json`, `.claude.json`, `sessions/`, `state/` and pi's
#      `auth.json`, present on alpha before the sessions existed, never reach
#      beta, and beta's `.credentials.json` never reaches alpha (AC-17)
#   6. a symlink to an absolute target resolves on beta (posix-raw symlinks)
#   7. a transition problem makes `--check` exit 1 naming it, and it recovers
#      once fixed (review B3)
#   8. a second `machine setup` run reports nothing needed (C-15, AC-24)
#   9. both sessions are terminated and this script's own daemon is stopped at
#      the end (trap), so nothing is left running
#
# Usage: packages/drive/tests/e2e/sync.sh (standalone or through run.sh; it
#        sets its own temp HOME, empty CLAUDE_CONFIG_DIR and HYPER_HOME)
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

# H2: this script's OWN Mutagen daemon, inside its own throwaway directory. With
# only a temp HOME, `mutagen sync create` starts a daemon under <tmpHOME>/.mutagen
# that nothing stops — an orphan holding a lock in a directory the suite then
# deletes. It also means the operator's real daemon (which owns claude-config
# and pi-config) is never contacted or terminated by this test.
# The directory is under short /tmp, NOT $work_real: the daemon's socket is a
# unix socket, and macOS's TMPDIR (/var/folders/…) plus this script's own name
# would push it past sun_path's 104 bytes (the daemon then starts but never
# answers: "unable to connect to daemon: connection timed out").
mutagen_dir="$(mktemp -d /tmp/hyperdrive-e2e-mutagen.XXXXXX)"
export MUTAGEN_DATA_DIRECTORY="$mutagen_dir"
mkdir -p "$MUTAGEN_DATA_DIRECTORY"

# A signal from the suite runner must still run this cleanup, so neither a
# session nor a daemon survives it.
trap 'exit 143' INT TERM HUP

cleanup() {
  echo "# cleaning up sessions"
  mutagen sync terminate "$claude_session" >/dev/null 2>&1 || true
  mutagen sync terminate "$pi_session" >/dev/null 2>&1 || true
  # Stops ONLY this script's daemon. MUTAGEN_DATA_DIRECTORY alone does NOT
  # guarantee that: on macOS `mutagen daemon stop` first looks for a launchd
  # registration under os.UserHomeDir() ($HOME/Library/LaunchAgents/
  # io.mutagen.mutagen.plist) and, when there is one, runs `launchctl unload`
  # on it — the operator's daemon, whatever the data directory says (this is
  # how an ad-hoc probe stopped it on 2026-10-04). So: only with the fixture's
  # HOME, which the guard below proves holds no registration.
  if [ "$HOME" = "$work_real/home" ] && [ ! -e "$HOME/Library/LaunchAgents/io.mutagen.mutagen.plist" ]; then
    mutagen daemon stop >/dev/null 2>&1 || true
  fi
  rm -rf "$mutagen_dir" "$work"
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

# H1: every ssh this test causes must be isolated. OpenSSH resolves ~/.ssh from
# the PASSWD home, not $HOME, so a temp HOME alone still forwards the operator's
# agent (1Password on a Mac) into the loopback hop and writes ControlMaster
# sockets into the real ~/.ssh. -F /dev/null plus no agent, no control reuse and
# a known_hosts this run owns keeps it all inside the fixture. Mutagen reaches
# beta over its own transport, but anything here that spawns ssh gets this.
ssh_identity=""
for candidate in id_ed25519 id_rsa id_ecdsa; do
  if [ -r "$HOME/.ssh/$candidate" ]; then
    ssh_identity="$HOME/.ssh/$candidate"
    break
  fi
done
# Review of PR #54, M4: this script runs `hyper machine setup`, so it must
# never run with the operator's HOME or Claude config, standalone or not
# (root CLAUDE.md, machine setup test safety). The identity above is the only
# thing read from the caller's HOME; from here on everything is the fixture's.
real_home="$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
export HOME="$work_real/home"
export CLAUDE_CONFIG_DIR="$work_real/claude-config"
export HYPER_HOME="$work_real/hyper-home"
export HYPER_SKIP_NEW_VERSION_CHECK=1
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$HYPER_HOME"
if [ "$(cd "$HOME" && pwd -P)" = "$(cd "$real_home" && pwd -P)" ]; then
  echo "# refusing to run: HOME resolves to the real home $real_home" >&2
  exit 1
fi
[ -z "$(ls -A "$CLAUDE_CONFIG_DIR")" ] || { echo "# refusing to run: CLAUDE_CONFIG_DIR is not empty" >&2; exit 1; }
# Mutagen resolves its launchd registration from $HOME, not from
# MUTAGEN_DATA_DIRECTORY: a registered daemon in this HOME would be the one
# every auto-start and `daemon stop` acts on (see cleanup). The fixture HOME
# must hold none.
if [ -e "$HOME/Library/LaunchAgents/io.mutagen.mutagen.plist" ]; then
  echo "# refusing to run: a Mutagen launchd registration exists under $HOME" >&2
  exit 1
fi

# The REAL ssh, resolved while this file is not yet first on PATH. `exec ssh`
# inside the wrapper would find the wrapper itself and re-exec it with another
# copy of the flags until argv hit E2BIG.
real_ssh="$(command -v ssh)"
cat > "$fakebin/ssh" <<WRAPPER
#!/bin/sh
exec "$real_ssh" -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none \\
  -o ForwardAgent=no -o ControlMaster=no -o ControlPath=none \\
  -o UserKnownHostsFile="$work_real/known_hosts" \\
  -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR \\
  ${ssh_identity:+-i "$ssh_identity"} "\$@"
WRAPPER
chmod +x "$fakebin/ssh"

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

# Files that must NEVER reach the other machine, put on alpha BEFORE any
# session exists (AC-17): an initial scan is exactly when a forgotten ignore
# pattern would carry them across.
echo "secret" > "$alpha_home/.claude/.credentials.json"
echo '{"oauthAccount":"x"}' > "$alpha_home/.claude/.claude.json"
mkdir -p "$alpha_home/.claude/sessions" "$alpha_home/.claude/state"
echo '{"pid":1}' > "$alpha_home/.claude/sessions/1.json"
echo "lock" > "$alpha_home/.claude/state/lock"
echo '{"token":"x"}' > "$alpha_home/.pi/agent/auth.json"
# …and one on beta that must never come back to alpha. Beta has NO `~/.pi`, as
# a fresh machine where pi never ran (review B3): Mutagen creates a missing
# beta ROOT but not its missing parent, so hyper must create `~/.pi` first, or
# the session says "Watching for changes" while pi never syncs.
mkdir -p "$beta_home/.claude"
[ ! -e "$beta_home/.pi" ] || die "fixture: beta must start without ~/.pi"
echo "beta-secret" > "$beta_home/.claude/.credentials.json"

# Waits up to 60s for a file to exist with the given content. Returns 1 on timeout.
wait_for() {
  local file="$1" content="$2"
  for _ in $(seq 1 60); do
    if [ -f "$file" ] && grep -q "$content" "$file"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# AC-21 / D-1: `hyper machine setup <machine> --features config-sync` creates the
# sync through the same service `drive sync-config` uses. It must be able to
# FAIL LOUDLY: `out=$(...)` under `set -e` would abort with no `not ok` line.
echo "# machine setup loop --features config-sync --yes (create)"
set +e
out="$(run_cli machine setup loop --features config-sync --yes)"
create_rc=$?
set -e
echo "$out"
if [ "$create_rc" != 0 ]; then
  die "machine setup loop --features config-sync exited $create_rc; got: $out"
fi
printf '%s' "$out" | grep -q "set up: *config-sync" \
  || die "setup did not report config-sync as set up; got: $out"
if ! printf '%s' "$out" | grep -F "$claude_session" | grep -q created; then
  die "expected setup to create the claude session; got: $out"
fi
pass "machine setup created $claude_session"
if ! printf '%s' "$out" | grep -F "$pi_session" | grep -q created; then
  die "expected setup to create the pi session; got: $out"
fi
pass "machine setup created $pi_session"
[ -d "$beta_home/.pi" ] || die "setup did not create beta's missing ~/.pi before the pi session"
pass "machine setup created beta's missing ~/.pi through ssh (B3)"

# The command and the task share one service: what setup created, the command
# finds ready and leaves alone (exit 0, nothing created).
set +e
out="$(run_cli drive sync-config loop)"
rc=$?
set -e
echo "$out"
[ "$rc" = 0 ] || die "sync-config loop after setup exited $rc; got: $out"
if printf '%s' "$out" | grep -q created; then
  die "sync-config created a session setup had already made: $out"
fi
for name in "$claude_session" "$pi_session"; do
  printf '%s' "$out" | grep -F "$name" | grep -q ready \
    || die "sync-config did not find $name ready after setup; got: $out"
done
pass "drive sync-config finds both sessions setup made ready, and creates nothing"

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

echo "# a plugin installed on alpha lands on beta (up to 60s)"
mkdir -p "$alpha_home/.claude/plugins/e2e-plugin/.claude-plugin"
echo '{"name":"e2e-plugin"}' > "$alpha_home/.claude/plugins/e2e-plugin/.claude-plugin/plugin.json"
wait_for "$beta_home/.claude/plugins/e2e-plugin/.claude-plugin/plugin.json" e2e-plugin \
  || die "the plugin written on alpha never appeared on beta within 60s"
pass "plugin propagated alpha -> beta"

echo "# a transcript created on beta lands on alpha (up to 60s)"
# AC-18's other half: the machine writes, the laptop receives.
mkdir -p "$beta_home/.claude/projects/-e2e-proj"
echo '{"type":"user","message":"from beta"}' > "$beta_home/.claude/projects/-e2e-proj/beta-session.jsonl"
wait_for "$alpha_home/.claude/projects/-e2e-proj/beta-session.jsonl" "from beta" \
  || die "the transcript written on beta never appeared on alpha within 60s"
pass "transcript propagated beta -> alpha"

echo "# ignored paths must not cross"
# A fixed sleep would race: if the sentinels haven't landed yet, "not there"
# proves nothing. Write a normal file in each session after the ignored ones,
# wait for THAT to arrive, and the ignored files have demonstrably had every
# chance to arrive too — they have existed since before the sessions did.
echo "sentinel" > "$alpha_home/.claude/sentinel.txt"
echo "sentinel" > "$alpha_home/.pi/agent/sentinel.txt"
echo "sentinel" > "$beta_home/.claude/beta-sentinel.txt"
wait_for "$beta_home/.claude/sentinel.txt" sentinel \
  || die "the claude sentinel never reached beta, so the ignore check proves nothing"
wait_for "$beta_home/.pi/agent/sentinel.txt" sentinel \
  || { mutagen sync list "$pi_session" >&2 || true; die "the pi sentinel never reached beta, so the ignore check proves nothing"; }
wait_for "$alpha_home/.claude/beta-sentinel.txt" sentinel \
  || die "the beta sentinel never reached alpha, so the reverse ignore check proves nothing"
# beta has its OWN .credentials.json (seeded above): that one is checked by content below.
for path in .claude/.claude.json .claude/sessions .claude/state .pi/agent/auth.json; do
  if [ -e "$beta_home/$path" ]; then die "$path is ignored but reached beta"; fi
done
pass ".claude.json, sessions/, state/ and pi auth.json stayed off beta (sentinels landed first)"
[ "$(cat "$alpha_home/.claude/.credentials.json")" = "secret" ] \
  || die "beta's .credentials.json replaced alpha's"
[ "$(cat "$beta_home/.claude/.credentials.json")" = "beta-secret" ] \
  || die "alpha's .credentials.json replaced beta's"
pass "each side keeps its own .credentials.json (nothing crossed either way)"

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

echo "# a session with a transition problem is not ready (B3)"
# Beta cannot write into a directory it may not write: alpha's new file there
# becomes a transition problem, which Mutagen reports while still "Watching".
mkdir -p "$beta_home/.claude/blocked"
chmod 0500 "$beta_home/.claude/blocked"
mkdir -p "$alpha_home/.claude/blocked"
echo "blocked" > "$alpha_home/.claude/blocked/f.txt"
problem=0
for _ in $(seq 1 60); do
  set +e
  out="$(run_cli drive sync-config loop --check)"
  rc=$?
  set -e
  if [ "$rc" = 1 ] && printf '%s' "$out" | grep -q "transition problem"; then
    problem=1
    break
  fi
  sleep 1
done
chmod 0700 "$beta_home/.claude/blocked"
if [ "$problem" != 1 ]; then
  mutagen sync list "$claude_session" >&2 || true
  die "--check never reported the transition problem as not ready; last output: $out"
fi
printf '%s' "$out" | grep -F "$claude_session" | grep -q "blocked" \
  || die "the not-ready row does not name the blocked path: $out"
pass "--check exits 1 and names the transition problem while Mutagen still watches"
# Writable again: the next cycle clears the problem and the check recovers.
# Fixing a mode is not a content change, so on Linux's polling watcher no new
# cycle would run on its own: the check forces one before calling a problem
# current (that is what this step proves, not a timing allowance).
recovered=0
for _ in $(seq 1 60); do
  set +e
  out="$(run_cli drive sync-config loop --check)"
  rc=$?
  set -e
  if [ "$rc" = 0 ]; then recovered=1; break; fi
  sleep 1
done
if [ "$recovered" != 1 ]; then
  mutagen sync list "$claude_session" >&2 || true
  die "--check never recovered after the problem was fixed; last output: $out"
fi
wait_for "$beta_home/.claude/blocked/f.txt" blocked || die "the blocked file never arrived after the fix"
pass "once fixed, the file arrives and --check is ready again"

echo "# a second machine setup run changes nothing (C-15, AC-24)"
set +e
out="$(run_cli machine setup loop --features config-sync --yes)"
rc=$?
set -e
echo "$out"
[ "$rc" = 0 ] || die "the second machine setup run exited $rc; got: $out"
printf '%s' "$out" | grep -q "Nothing needed" \
  || die "the second setup run did not report nothing needed; got: $out"
printf '%s' "$out" | grep -q "already fine: *config-sync" \
  || die "the second setup run did not call config-sync already fine; got: $out"
pass "a second machine setup run reports nothing needed and creates nothing"

echo "# all assertions passed"
exit 0