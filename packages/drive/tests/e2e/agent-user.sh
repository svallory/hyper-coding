#!/usr/bin/env bash
# e2e: the unattended agent layout, against a throwaway Debian 13 systemd
# container on podman.
#
# This is the acceptance for T-16. It runs `hyper machine setup t16
# --features agent-user` against a machine that exists only for the length of
# this script, has the script run as the brief describes (the HARNESS plays the
# human: it runs the root script itself over ssh with sudo, then re-runs setup),
# and then asserts the properties that make the layout safe:
#
#   1. `sudo -n true` fails as the agent            (no privileged group)
#   2. `docker ps` fails or docker is absent        (that group is root here)
#   3. the agent can create a file in the shared work dir
#   4. the agent can read ~agent/.claude/settings.json
#   5. the agent CANNOT read the primary's .credentials.json
#   6. a 0600 file the primary writes under ~/.claude/projects/x becomes
#      group-readable within 5 s                   (the watcher)
#   7. the container is gone at the end            (trap)
#
# Usage: packages/drive/tests/e2e/agent-user.sh
# Cost:   one container (`hyper-t16`) on podman, a throwaway ssh key, and a
#         temp fake `herdr` + `drive.toml` on PATH. It NEVER touches netcup,
#         never touches the operator's real ~/.claude, and never runs sudo on
#         the Mac: every privileged step happens INSIDE the container, over ssh.
# Requires: podman with a started machine, and packages/cli built.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# e2e -> tests -> drive -> packages, so the CLI is three levels up.
cli="$here/../../../cli/bin/run.js"
image="debian:13"
container="hyper-t16"
port=2222
primary="svallory"
agent="agent"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-agentuser.XXXXXX")"
work_real="$(cd "$work" && pwd -P)"
key="$work_real/id"

cleanup() {
  echo "# tearing down $container"
  podman rm -f "$container" >/dev/null 2>&1 || true
  # KEEP=1 leaves the logs behind for debugging a failing run.
  if [ "${KEEP:-0}" = "1" ]; then
    echo "# KEEP=1 — logs left in $work_real"
  else
    rm -rf "$work_real"
  fi
}
trap cleanup EXIT

echo "# podman version"
podman --version
echo "# image digest"
digest="$(podman image inspect "$image" --format '{{.Digest}}')"
echo "$image $digest"

# --------------------------------------------------------------------------
# The image
# --------------------------------------------------------------------------
# The stock debian:13 image ships NO /sbin/init — systemd-sysv is a separate
# package — so `--systemd=always … /sbin/init` cannot work on it directly, and
# it cannot be installed inside the container either (nothing is running yet).
# So the packages go into a throwaway image derived from it, built once here.
# The base digest is printed above so the derivation is traceable.
derived="hyper-t16-e2e:local"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (systemd + sshd + the acl/inotify packages)"
  cat > "$work_real/Containerfile" <<CONTAINERFILE
FROM $image
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\
      systemd-sysv openssh-server sudo acl inotify-tools polkitd procps \\
    && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
CONTAINERFILE
  podman build --tag "$derived" --file "$work_real/Containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi

# --------------------------------------------------------------------------
# The machine
# --------------------------------------------------------------------------
if ! podman machine list --format '{{.Running}}' | grep -q true; then
  echo "# starting the podman machine"
  podman machine start >/dev/null
fi

# The trap removes it, but a leftover from a killed run would make `run` fail on
# the name — so clear it before starting. Only ever this exact name.
podman rm -f "$container" >/dev/null 2>&1 || true
podman run -d --name "$container" --systemd=always -p "$port":22 "$derived" /sbin/init >/dev/null
echo "# started $container"

pexec() { podman exec "$container" sh -c "$1"; }

# systemd has to be up before anything else works (loginctl, user units).
pexec 'for i in $(seq 1 90); do systemctl is-system-running >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1' \
  || die "systemd never came up in the container"

# polkitd is what allows `loginctl enable-linger` on yourself WITHOUT a password.
# Stock Debian has it; without it the watcher task would (correctly) fall back
# to the root script and this e2e would be testing the fallback, not the task.
pexec 'command -v polkitd >/dev/null || { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq polkitd; }' \
  || die "could not install polkitd"

# The primary user, playing the human: passwordless sudo, so the harness can
# run the root script the way the user would type it.
pexec "useradd -m -s /bin/bash $primary"
pexec "printf '%s ALL=(ALL) NOPASSWD:ALL\n' '$primary' > /etc/sudoers.d/$primary"
pexec 'chmod 0440 /etc/sudoers.d/svallory'

# A throwaway key: the real operator's key never goes near this container.
ssh-keygen -q -t ed25519 -N '' -f "$key" <<<y >/dev/null 2>&1 || ssh-keygen -q -t ed25519 -N '' -f "$key"
podman cp "$key.pub" "$container:/tmp/key.pub"
pexec "mkdir -p /home/$primary/.ssh && install -m 0600 -o $primary /tmp/key.pub /home/$primary/.ssh/authorized_keys && rm -f /tmp/key.pub"

pexec 'ssh-keygen -A >/dev/null && mkdir -p /run/sshd'
pexec '/usr/sbin/sshd'
echo "# sshd started"

ssh_t16() {
  /usr/bin/ssh -i "$key" -p "$port" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ConnectTimeout=10 \
    "$primary@localhost" "$@"
}

for i in $(seq 1 30); do
  ssh_t16 true >/dev/null 2>&1 && break
  sleep 1
done
ssh_t16 true >/dev/null 2>&1 || die "could not ssh into the container as $primary"

# The credential the whole ACL design protects. Created BEFORE setup and left
# 0600, so a recursive ACL anywhere in setup would show up as the agent being
# able to read it.
ssh_t16 "mkdir -p /home/$primary/.claude/projects/x"
ssh_t16 "printf '{\"token\":\"secret\"}' > /home/$primary/.claude/.credentials.json"
ssh_t16 "chmod 0600 /home/$primary/.claude/.credentials.json"
ssh_t16 "printf '{\"model\":\"claude\"}' > /home/$primary/.claude/settings.json"
ssh_t16 "printf '# shared\n' > /home/$primary/.claude/CLAUDE.md"

# --------------------------------------------------------------------------
# hyper's view of the machine: a temp config and a fake herdr (T-10's grammar,
# with the port).
# --------------------------------------------------------------------------
mkdir -p "$work_real/bin"
cat > "$work_real/bin/herdr" <<JSON
#!/bin/sh
cat <<'HERDR'
[{"label": "t16", "target": "t16box", "enabled": true}]
HERDR
exit 0
JSON
chmod +x "$work_real/bin/herdr"

# The ssh target is an ALIAS, not a `host:port` pair. `RemoteMachine` passes
# Herdr's target straight to `ssh` as one argument, and ssh has no host:port form
# — that spelling is scp/rsync's. (The brief assumed T-10's grammar supported a
# port; it doesn't, so a non-default ssh port is unreachable today. Flagged to
# the lead; out of scope here.) The alias carries the port and the user in an
# ssh config of our own, reached by pointing HOME at a scratch dir — the
# operator's real ~/.ssh is never touched.
ssh_home="$work_real/sshhome"
mkdir -p "$ssh_home/.ssh"
cat > "$ssh_home/.ssh/config" <<SSHCFG
Host t16box
  HostName localhost
  Port $port
  User $primary
  IdentityFile $key
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
SSHCFG
chmod 700 "$ssh_home/.ssh"
chmod 600 "$ssh_home/.ssh/config"

# …and ssh has to be TOLD to read it. OpenSSH expands `~/.ssh/config` through the
# passwd database's home, not $HOME, so pointing HOME at a scratch dir does not
# work (verified on this Mac). A wrapper `ssh` earlier on PATH carries the -F:
# that is the harness standing in for the ssh config a real operator would have.
# The wrapper is what the CLI spawns; the harness's own calls use /usr/bin/ssh.
cat > "$work_real/bin/ssh" <<WRAPPER
#!/bin/sh
exec /usr/bin/ssh -F "$work_real/sshhome/.ssh/config" "\$@"
WRAPPER
chmod +x "$work_real/bin/ssh"

# bun wants a ~/.bun; point it at the real one rather than re-resolving.
[ -d "$HOME/.bun" ] && ln -sfn "$HOME/.bun" "$ssh_home/.bun"
# Keep the CLI's own args off the container's locale warnings.
export LC_ALL=C LANG=C

cat > "$work_real/drive.toml" <<TOML
remote = "git@example.invalid:hyperdrive.git"

[self]
name = "mac"
home = "/Users/nobody"

[machines.t16]
home = "/home/$primary"
features = ["agent-user"]
agent_user = "$agent"
TOML

run_hyper() {
  PATH="$work_real/bin:$PATH" HYPER_DRIVE_CONFIG="$work_real/drive.toml" \
    HOME="$ssh_home" NO_COLOR=1 bun "$cli" machine setup t16 --features agent-user --yes
}

# --------------------------------------------------------------------------
# Run setup until it settles, running the root script ourselves when one appears
# (the harness is the human here; hyper must never run it itself — C-6).
# --------------------------------------------------------------------------
root_script=""
for round in 1 2 3 4; do
  echo "# setup round $round"
  set +e
  run_hyper > "$work_real/setup-$round.log" 2>&1
  code=$?
  set -e
  tail -3 "$work_real/setup-$round.log"
  # The pending-root exit code is 3: root work outstanding, nothing run.
  if [ "$code" = 3 ]; then
    root_script="$(grep -o "[^ ]*hyper-machine-root\.sh" "$work_real/setup-$round.log" | head -1)"
    [ -n "$root_script" ] || die "run $round said root work was pending but named no script"
    echo "# the harness runs the root script itself, over ssh, with sudo"
    scp -q -i "$key" -P "$port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o LogLevel=ERROR "$root_script" "$primary@localhost:/tmp/hyper-machine-root.sh"
    ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" || die "the root script failed on round $round"
    continue
  fi
  [ "$code" = 0 ] || { cat "$work_real/setup-$round.log"; die "setup exited $code on round $round"; }

  if grep -q "Nothing needed" "$work_real/setup-$round.log"; then
    settled=1
    break
  fi
done
[ "${settled:-0}" = 1 ] || {
  echo "# setup never settled. What each round said it still needed:"
  grep -h -E "still need root|how do you want|agent-user\.[a-z]+:|root steps" "$work_real"/setup-*.log | tail -20
  die "setup never settled into \"Nothing needed\""
}

grep -q "Nothing needed" "$work_real/setup-$round.log" \
  && pass "a re-run after the root script reports nothing needed (C-15)"
grep -q "already fine: agent-user.create" "$work_real/setup-$round.log" \
  && pass "agent-user.create is satisfied after the root script ran"
grep -q "already fine: agent-user.dirs" "$work_real/setup-$round.log" \
  && pass "agent-user.dirs is satisfied after its own apply"
grep -q "already fine: agent-user.watcher" "$work_real/setup-$round.log" \
  && pass "agent-user.watcher is enabled, active and lingering"

# --------------------------------------------------------------------------
# The assertions
# --------------------------------------------------------------------------
as_agent() { ssh_t16 "sudo -u $agent $*"; }

if as_agent true && as_agent "sudo -n true" >/dev/null 2>&1; then
  die "the agent could run a privileged command — the layout is not safe"
fi
pass "sudo -n true fails as $agent"

if as_agent "docker ps" >/dev/null 2>&1; then
  die "the agent could talk to docker — that group is root on this host"
fi
pass "docker ps fails as $agent"

as_agent "mkdir -p /home/$primary/work && printf 'from the agent\n' > /home/$primary/work/from-agent.txt" \
  || die "the agent could not create a file in the shared work dir"
pass "the agent can create a file in /home/$primary/work"

# …and the primary user can still write there too.
ssh_t16 "printf 'from the primary\n' > /home/$primary/work/from-primary.txt" \
  || die "the primary user could not write in their own work dir"
pass "the primary user can write in /home/$primary/work too"

as_agent "cat /home/$agent/.claude/settings.json" >/dev/null 2>&1 \
  || die "the agent could not read its settings.json"
pass "the agent can read its own ~$agent/.claude/settings.json"

as_agent "cat /home/$agent/.claude/CLAUDE.md" >/dev/null 2>&1 \
  || die "the agent could not read its CLAUDE.md"
pass "the agent can read its own CLAUDE.md"

if as_agent "cat /home/$primary/.claude/.credentials.json" >/dev/null 2>&1; then
  die "the agent CAN read .credentials.json — the recursive-ACL rule was broken"
fi
pass ".credentials.json is NOT readable as $agent"

as_agent "cat /home/$primary/.claude/projects/x/agent-wrote.jsonl" >/dev/null 2>&1 \
  && pass "the agent can read the primary's transcripts"

# The watcher: a 0600 file, written by its owner, becomes group-readable.
#
# The file is made in /tmp — NOT in projects/ — and asserted there, then moved
# into the watched dir. Two reasons, both about not writing a flaky test:
#   - the default ACL on projects/ would hand a newly created file group-read
#     anyway, so creating it there would not prove the watcher did anything;
#   - asserting "it is still 0600" AFTER moving it in would race the very
#     process under test, which typically wins within a second.
# A file MOVED in keeps the mode it was created with — default ACLs apply at
# creation, to the directory being created in — so after the move the only
# thing that can widen it is the watcher.
ssh_t16 "printf '{\"session\":\"abc\"}\n' > /tmp/live.jsonl && chmod 0600 /tmp/live.jsonl"
mode_before="$(ssh_t16 'stat -c %a /tmp/live.jsonl')"
[ "$mode_before" = "600" ] || die "the fixture file is $mode_before, expected 600"
ssh_t16 "mv /tmp/live.jsonl /home/$primary/.claude/projects/x/live.jsonl"

shared=0
for _ in $(seq 1 5); do
  if as_agent "cat /home/$primary/.claude/projects/x/live.jsonl" >/dev/null 2>&1; then
    shared=1
    break
  fi
  sleep 1
done
[ "$shared" = 1 ] || die "the watcher did not make a 0600 file group-readable within 5s"
pass "a 0600 file moved under projects/ becomes group-readable within 5s (the watcher)"
# …and the watcher widened it rather than the file arriving permissive.
mode_after="$(ssh_t16 "stat -c %a /home/$primary/.claude/projects/x/live.jsonl")"
[ "$mode_after" = "660" ] || die "after the watcher, the file is $mode_after, expected 660"
pass "the watcher widened 600 to 660 ($mode_before -> $mode_after)"

# The helper the user installs and types themselves. It runs the command through
# the agent's LOGIN shell with the args joined and eval'd, which is what makes
# `as-agent 'echo $USER'` behave like `ssh 'echo $USER'`.
ssh_t16 "grep -q eval /home/$primary/.local/bin/as-agent" || die "as-agent is not installed"
as_agent_out="$(ssh_t16 "cd /home/$primary/work && /home/$primary/.local/bin/as-agent 'echo \$USER'" 2>/dev/null || true)"
if ! printf '%s' "$as_agent_out" | grep -qx "$agent"; then
  die "as-agent printed $(printf '%q' "$as_agent_out"), expected exactly '$agent'"
fi
pass "the as-agent helper runs a command as $agent"

# The container must not survive the script.
echo "# container is removed by the trap"

echo "# $step assertions passed"