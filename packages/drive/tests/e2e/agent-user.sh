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
#   Docker daemon access is not tested (no daemon/socket fixture). Unit tests
#   check that setup removes the agent from the privileged docker group.
#   3. the agent can create a file in the shared work dir
#   4. the agent can read ~agent/.claude/settings.json
#   5. the agent CANNOT read the primary's .credentials.json
#   6. a 0600 file the primary writes under ~/.claude/projects/x becomes
#      group-readable within 5 s                   (the watcher)
#   7. the container is gone at the end            (trap)
#
# Usage: packages/drive/tests/e2e/agent-user.sh
# Cost:   one container (`hyper-fm-machine-t16`) on podman, a throwaway ssh key, and a
#         temp fake `herdr` + `drive.toml` on PATH. It NEVER touches netcup,
#         never touches the operator's real ~/.claude, and never runs sudo on
#         the Mac: every privileged step happens INSIDE the container, over ssh.
# Requires: podman with a started machine, and packages/cli built.

set -euo pipefail

# The operator's ssh-agent must never be offered to this container. The throwaway
# key below is the only credential the harness may authenticate with, and an
# inherited SSH_AUTH_SOCK would let ssh offer the operator's real keys (1Password
# included, which may prompt) to a disposable sshd. Unset for this script and
# everything it spawns, including the CLI.
unset SSH_AUTH_SOCK SSH_AGENT_PID

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# e2e -> tests -> drive -> packages, so the CLI is three levels up.
cli="$here/../../../cli/bin/run.js"
image="debian:13"
# Overridable so the suite runner (run.sh) can give each run a free port and a
# unique container name on a shared machine; the defaults are the T-16 names.
container="${AGENT_USER_E2E_CONTAINER:-hyper-fm-machine-t16}"
port="${AGENT_USER_E2E_PORT:-23322}"
primary="svallory"
agent="agent"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

# shasum is a perl script (macOS ships it; minimal Linux may not) — fall back
# to coreutils sha256sum. Both print the same hex, so the recipe tag is stable.
sha12() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi | cut -c1-12; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-agentuser.XXXXXX")"
work_real="$(cd "$work" && pwd -P)"
key="$work_real/id"
started=0

container_started=0
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    if [ "$container_started" = "1" ]; then
      echo "# KEEP=1 — container $container and logs left in $work_real; remove with podman rm -f $container"
    else
      echo "# KEEP=1 — logs left in $work_real (no container started)"
    fi
  else
if [ "$started" = 1 ]; then
      echo "# tearing down $container"
      podman rm -f "$container" >/dev/null 2>&1 || true
    fi
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
# So the packages go into a throwaway image derived from it. The base digest is
# printed above so the derivation is traceable.
#
# The tag carries a hash of the Containerfile: editing it must produce a NEW
# image rather than silently reusing the old one, which is how a stale tag turns
# a fixed harness back into a failing one.
containerfile="$work_real/Containerfile"
cat > "$containerfile" <<CONTAINERFILE
FROM $image
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\
      systemd-sysv openssh-server sudo acl inotify-tools polkitd procps \\
    && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
CONTAINERFILE

recipe="$(sha12 "$containerfile")"
derived="hyper-t16-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (systemd + sshd + the acl/inotify packages)"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi
# Leave older image tags alone: a different run may still refer to one.

# --------------------------------------------------------------------------
# The machine
# --------------------------------------------------------------------------
# Start the podman VM when this platform has one (macOS/Windows). On Linux
# `podman machine` is unsupported and exits non-zero; podman is native there.
if [ "$(uname -s)" != Linux ] && podman machine list --format '{{.Running}}' >/dev/null 2>&1; then
  if ! podman machine list --format '{{.Running}}' | grep -q true; then
    echo "# starting the podman machine"
    podman machine start >/dev/null
  fi
fi

# Never remove a container this invocation did not start, even if its name
# matches a standalone default or a stale run. run.sh passes a unique name via
# AGENT_USER_E2E_CONTAINER.
if podman container exists "$container"; then
  die "container $container already exists; refusing to touch it"
fi
podman run -d --name "$container" --systemd=always -p "$port":22 "$derived" /sbin/init >/dev/null
started=1
echo "# started $container"

pexec() { podman exec "$container" sh -c "$1"; }
fixture_token="$(basename "$work_real")"
pexec "printf '%s' '$fixture_token' > /run/hyper-t16-fixture"

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
# `chown` the directory too, not just the file: ssh-keygen creates it as the
# user, and a root-owned ~/.ssh makes `setfacl` fail for the primary — which
# would be a harness artifact masquerading as a product bug.
pexec "mkdir -p /home/$primary/.ssh && chown $primary:$primary /home/$primary/.ssh && chmod 0700 /home/$primary/.ssh && install -m 0600 -o $primary /tmp/key.pub /home/$primary/.ssh/authorized_keys && rm -f /tmp/key.pub"

pexec 'ssh-keygen -A >/dev/null && mkdir -p /run/sshd'
pexec '/usr/sbin/sshd'
echo "# sshd started"

ssh_t16() {
  # IdentityAgent=none + IdentitiesOnly=yes: authenticate with the throwaway key
  # on the command line and nothing else, whatever the environment offers.
  /usr/bin/ssh -F /dev/null -o ControlMaster=no -o ControlPath=none -i "$key" -p "$port" \
    -o IdentityAgent=none -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ConnectTimeout=10 \
    "$primary@localhost" "$@"
}

for _ in $(seq 1 30); do
  ssh_t16 true >/dev/null 2>&1 && break
  sleep 1
done
ssh_t16 true >/dev/null 2>&1 || die "could not ssh into the container as $primary"

# The credential the whole ACL design protects, plus the fixtures that must exist
# BEFORE setup: the deny is applied to entries that are already there, and a file
# created afterwards relies on the inherited default instead. Both paths need
# proving, so both are set up here.
ssh_t16 "mkdir -p /home/$primary/.claude/projects/x /home/$primary/.config/gh"
# The world-readable token case from the reference machine: a mode that says
# "everyone can read", inside a directory the agent can traverse.
ssh_t16 "printf 'gh-token\n' > /home/$primary/.config/gh/hosts.yml && chmod 0644 /home/$primary/.config/gh/hosts.yml"
ssh_t16 "chmod 0755 /home/$primary/.config"
ssh_t16 "printf 'top-level-secret\n' > /home/$primary/topsecret.txt && chmod 0644 /home/$primary/topsecret.txt"
ssh_t16 "printf '{\"history\":\"before\"}\n' > /home/$primary/.claude/history.jsonl && chmod 0644 /home/$primary/.claude/history.jsonl"
ssh_t16 "printf '{\"token\":\"secret\"}' > /home/$primary/.claude/.credentials.json"
ssh_t16 "chmod 0644 /home/$primary/.claude/.credentials.json"
# Leave both optional shared files absent until setup settles; missing files
# must not cause endless repair attempts or masked setfacl errors.

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
mkdir -p "$ssh_home/.ssh" "$work_real/claude-empty" "$work_real/hyper-home" "$work_real/xdg-empty"
cat > "$ssh_home/.ssh/config" <<SSHCFG
Host t16box
  HostName localhost
  Port $port
  User $primary
  IdentityFile $key
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
Host localhost
  # The host:port probe below MUST get the port from RemoteMachine's argv,
  # not this config. This block supplies only the throwaway key and host trust.
  IdentityFile $key
  IdentitiesOnly yes
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
exec /usr/bin/ssh -F "$work_real/sshhome/.ssh/config" -o IdentityAgent=none -o IdentitiesOnly=yes "\$@"
WRAPPER
chmod +x "$work_real/bin/ssh"
# scp also needs the throwaway key without reading the operator's real ssh
# config (OpenSSH resolves ~/.ssh/config through the passwd home, not $HOME).
# It gets -F here; the port still MUST come from RemoteMachine's -P argv.
cat > "$work_real/bin/scp" <<WRAPPER
#!/bin/sh
exec /usr/bin/scp -F "$work_real/sshhome/.ssh/config" -o IdentityAgent=none -o IdentitiesOnly=yes "\$@"
WRAPPER
chmod +x "$work_real/bin/scp"

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

run_isolated() {
  PATH="$work_real/bin:$PATH" HYPER_DRIVE_CONFIG="$work_real/drive.toml" \
    HOME="$ssh_home" CLAUDE_CONFIG_DIR="$work_real/claude-empty" HYPER_MACHINE_SCRATCH="$work_real/scratch" \
    HYPER_HOME="$work_real/hyper-home" XDG_CONFIG_HOME="$work_real/xdg-empty" \
    HYPER_T16_CONTAINER_TEST=1 HYPER_T16_TOKEN="$fixture_token" NO_COLOR=1 bun "$@"
}
run_hyper() { run_isolated "$cli" machine setup t16 --features agent-user --yes; }
run_dirs() { run_isolated "$here/run-agent-user-dirs.ts"; }
stop_watcher() {
  ssh_t16 'systemctl --user stop claude-share-watch.service' || die 'could not stop watcher'
  [ "$(ssh_t16 'systemctl --user is-active claude-share-watch.service' || true)" = inactive ] \
    || die 'watcher is not stopped'
}
start_watcher() {
  # This harness deliberately toggles the service more than systemd's burst
  # limit. Reset that counter, not product policy or test outcomes.
  ssh_t16 'systemctl --user reset-failed claude-share-watch.service && systemctl --user start claude-share-watch.service' || die 'could not start watcher'
  # Active != watching: wait until all three inotify descriptors have watches.
  ssh_t16 'for _ in $(seq 1 50); do n=0; for p in $(pgrep -u "$(id -u)" -x inotifywait); do if grep -qs "^inotify" /proc/$p/fdinfo/*; then n=$((n + 1)); fi; done; [ "$n" = 3 ] && exit 0; sleep 0.1; done; exit 1' || die 'watcher never became ready'
}

# --------------------------------------------------------------------------
# Item 2 fixture: the primary's systemd --user manager is already running
# BEFORE setup adds the primary to collab. With linger it survives logout, and
# a running process never gains a group — the exact production failure from
# the T-16 confirm review. Keep it running through the root script, no reboot.
# --------------------------------------------------------------------------
# Fixture setup runs as container root to avoid a polkit authorization timeout
# before the product code is even exercised. The primary's SSH session was
# already opened above, and it remains the user whose manager runs with linger.
pexec "loginctl enable-linger $primary" || die 'could not enable primary linger before setup'
puid="$(pexec "id -u $primary")"
manager_before=""
for _ in $(seq 1 30); do
  manager_before="$(ssh_t16 "systemctl show -p MainPID --value user@$puid.service" 2>/dev/null || true)"
  [ -n "$manager_before" ] && [ "$manager_before" != 0 ] && break
  sleep 1
done
[ -n "$manager_before" ] && [ "$manager_before" != 0 ] || die 'fixture: primary user manager did not start before setup'
pass "fixture: primary user manager $manager_before runs with linger before collab is added"

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
    scp -F /dev/null -o ControlMaster=no -o ControlPath=none -q -i "$key" -P "$port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o LogLevel=ERROR "$root_script" "$primary@localhost:/tmp/hyper-machine-root.sh"
    ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" || die "the root script failed on round $round"
    if [ "$round" = 1 ]; then
      collab_gid="$(pexec 'getent group collab | cut -d: -f3')"
      manager_after="$(ssh_t16 "systemctl show -p MainPID --value user@$puid.service")"
      [ -n "$manager_after" ] && [ "$manager_after" != 0 ] || die 'the primary user manager is not running after the root script'
      ssh_t16 "sed -n 's/^Groups:[[:space:]]*//p' /proc/$manager_after/status | tr ' ' '\n' | grep -qx '$collab_gid'" \
        || die 'the primary user manager still lacks the collab group after the root script — the watcher would run without it until a reboot'
      [ "$manager_after" != "$manager_before" ] || die 'the primary user manager was not restarted after its groups changed'
      pass 'the root script restarted the primary user manager, which now carries collab (no reboot)'
      # Seed the old reference layout AND owning-collab roots. Named-user
      # traverse must win over the owning group's read access; no group-write
      # on the home, which would violate sshd StrictModes.
      ssh_t16 "chgrp collab /home/$primary /home/$primary/.claude; setfacl -m g::r-x,g:collab:--x /home/$primary /home/$primary/.claude; setfacl -d -m g:collab:r-x /home/$primary /home/$primary/.claude"
      ssh_t16 "sudo usermod -aG collab nobody; sudo sh -c 'printf foreign > /home/$primary/root-owned.txt; setfacl -b /home/$primary/root-owned.txt; chmod 0644 /home/$primary/root-owned.txt'"
    fi
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
  grep -h -E "still need root|how do you want|agent-user\.[a-z]+:|root steps|not settled|readable by" "$work_real"/setup-*.log | tail -20
  # The facts, not a verdict: which ACL is actually on disk is what tells us why.
  echo "# --- ACLs as they are on the machine ---" >&2
  ssh_t16 "for p in /home/$primary /home/$primary/work /home/$primary/.claude /home/$primary/.claude/skills /home/$primary/.claude/settings.json; do echo \"## \$p\"; getfacl -p \$p 2>&1 | grep -vE '^# (file|owner|group)'; done" >&2 || true
  die "setup never settled into \"Nothing needed\""
}

grep -q "Nothing needed" "$work_real/setup-$round.log" \
  && pass "a re-run after the root script reports nothing needed (C-15)"
grep -q "already fine: agent-user.create" "$work_real/setup-$round.log" \
  && pass "agent-user.create is satisfied after the root script ran"
grep -q "already fine: .*agent-user.dirs" "$work_real/setup-$round.log" \
  && pass "agent-user.dirs is satisfied after its own apply"
grep -q "already fine: .*agent-user.watcher" "$work_real/setup-$round.log" \
  && pass "agent-user.watcher is enabled, active and lingering"

# --------------------------------------------------------------------------
# The assertions
# --------------------------------------------------------------------------
as_agent() { ssh_t16 "sudo -u $agent $*"; }
pass 'setup settles with settings.json and CLAUDE.md both missing'
grep -q "cannot protect, not owned by $primary: 1 entries; /home/$primary/root-owned.txt" "$work_real/setup-$round.log" || die 'missing unowned-entry warning'
grep -q "other members of collab.*nobody" "$work_real/setup-$round.log" || die 'missing extra collab member warning'
ssh_t16 "test \"\$(stat -c %U /home/$primary/root-owned.txt)\" = root && ! getfacl -c -p /home/$primary/root-owned.txt | grep -q 'user:$agent:'" || die 'unowned entry was modified'
pass 'unowned entries and extra collab members warn without making setup unsettled'
ssh_t16 "! getfacl -c -p /home/$primary /home/$primary/.claude | grep -E '^(default:)?group:collab:'" || die 'legacy root collab ACL remains'
pass 'setup migrates the old reference root ACLs to named-user entries'
start_watcher
watcher_pid="$(ssh_t16 'systemctl --user show -p MainPID --value claude-share-watch.service')"
[ -n "$watcher_pid" ] && [ "$watcher_pid" != 0 ] || die 'no running watcher process after setup'
ssh_t16 "sed -n 's/^Groups:[[:space:]]*//p' /proc/$watcher_pid/status | tr ' ' '\n' | grep -qx '$collab_gid'" \
  || die 'the RUNNING watcher still lacks the collab group after the root script'
pass 'the running watcher carries collab without a reboot'
# A fresh directory under projects inherits setgid + collab; the watcher
# touches it through its live-event path (setfacl/chgrp). Without the group,
# setfacl silently strips setgid and the watcher cannot restore it.
ssh_t16 "mkdir /home/$primary/.claude/projects/watcher-group-check" || die 'could not create the watcher-path directory'
sleep 2
watcher_dir_state="$(ssh_t16 "stat -c '%A %G' /home/$primary/.claude/projects/watcher-group-check")"
case "$watcher_dir_state" in
  *s*collab) pass 'a directory the watcher repairs keeps setgid and group collab' ;;
  *) die "the watcher stripped setgid/group from its directory: $watcher_dir_state" ;;
esac
ssh_t16 "printf '{\"model\":\"claude\"}' > /home/$primary/.claude/settings.json; printf '# shared\n' > /home/$primary/.claude/CLAUDE.md"
for _ in $(seq 1 5); do
  as_agent "cat /home/$primary/.claude/settings.json /home/$primary/.claude/CLAUDE.md" >/dev/null 2>&1 && break
  sleep 1
done

if as_agent true && as_agent "sudo -n true" >/dev/null 2>&1; then
  die "the agent could run a privileged command — the layout is not safe"
fi
pass "sudo -n true fails as $agent"

# No docker CLI/daemon exists in this image: a failing `docker ps` would be
# vacuous, so deliberately do not count it as a security assertion.
echo '# Docker socket access is not covered by this fixture (no daemon/socket).'

as_agent "bash -c \"mkdir -p /home/$primary/work && printf 'from the agent\\n' > /home/$primary/work/from-agent.txt\"" \
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

# The config dir carries TRAVERSE only, so the agent can reach the entries it
# was given and nothing else. `ls` is what proves the difference: the entries
# exist, the listing does not.
if as_agent "ls /home/$primary/.claude" >/dev/null 2>&1; then
  die "the agent can LIST the primary's config dir — traverse-only is not in place"
fi
as_agent "ls /home/$primary" >/dev/null 2>&1 && die 'the agent can list the collab-owned home'
pass "the agent cannot list collab-owned home/config roots (named-user traverse only)"

# --------------------------------------------------------------------------
# Part B: a named-user entry is decisive BEFORE all group-class matches.
# user:<agent>:--- still needs the mask-zero/other-bit guard below.
# --------------------------------------------------------------------------
denied() {
  # Readable by the agent? 0 = no (good), anything else = yes (bad).
  as_agent "cat '$1'" >/dev/null 2>&1 && echo yes || echo no
}

# Kernel premise: named-user denial wins over owning AND named group grants.
# No watcher or setup runs during these three probes.
stop_watcher
ssh_t16 "printf a > /home/$primary/probe-a; printf b > /home/$primary/probe-b; mkdir /home/$primary/probe-dir; printf inside > /home/$primary/probe-dir/inside; setfacl -b /home/$primary/probe-a /home/$primary/probe-b /home/$primary/probe-dir; chgrp collab /home/$primary/probe-a /home/$primary/probe-dir; sudo chgrp $agent /home/$primary/probe-b; chmod 0644 /home/$primary/probe-a; chmod 0640 /home/$primary/probe-b; chmod 0755 /home/$primary/probe-dir; setfacl -m u:$agent:--- /home/$primary/probe-a /home/$primary/probe-b /home/$primary/probe-dir; setfacl -m g:collab:r-- /home/$primary/probe-b"
ssh_t16 "getfacl -p /home/$primary/probe-a /home/$primary/probe-b /home/$primary/probe-dir"
[ "$(denied "/home/$primary/probe-a")" = no ] || die 'named-user deny lost to owning collab'
pass 'named-user premise a: collab-owned 0644 file is denied'
[ "$(denied "/home/$primary/probe-b")" = no ] || die 'named-user deny lost to another matching group'
pass 'named-user premise b: another owning group and named collab grant cannot override denial'
[ "$(denied "/home/$primary/probe-dir/inside")" = no ] || die 'named-user directory deny allows traversal'
as_agent "ls /home/$primary/probe-dir" >/dev/null 2>&1 && die 'named-user directory deny allows listing'
pass 'named-user premise c: collab-owned directory cannot be listed or traversed'
start_watcher

# 1. Entries that existed BEFORE setup: a 0644 top-level file, and a 0755
#    directory holding a 0644 gh token file — the case from the reference server.
for f in "/home/$primary/topsecret.txt" "/home/$primary/.config/gh/hosts.yml"; do
  if [ "$(denied "$f")" = "yes" ]; then
    # Evidence, not just a verdict: this is the assertion the whole deny rests on,
    # so a failure has to be reportable rather than merely red.
    echo "# --- WHY $f is readable ---" >&2
    echo "# getfacl:" >&2
    ssh_t16 "getfacl -p $f" >&2 || true
    echo "# stat: $(ssh_t16 "stat -c '%A %U %G %a' $f")" >&2
    echo "# agent groups: $(as_agent 'id' 2>&1)" >&2
    echo "# cat as agent:" >&2
    as_agent "cat '$f'" >&2 || true
    die "the agent can read the pre-existing $f"
  fi
done
pass "1 - a pre-existing 0644 file, and a 0644 gh token under ~/.config, are unreadable"

# 2. A file created AFTER setup, relying on the inherited default.
stop_watcher
ssh_t16 "printf 'after\n' > /home/$primary/late.txt && chmod 0644 /home/$primary/late.txt"
[ "$(denied "/home/$primary/late.txt")" = "no" ] || die "the agent can read a 0644 file created after setup"
pass "2 - a 0644 top-level file created AFTER setup is unreadable (inherited default)"
start_watcher

# 3. The classic write pattern: write a temp file, then rename it over the
#    target. The new inode is a different object with different ACLs.
ssh_t16 "printf '# replaced by the harness\n' > /home/$primary/.bashrc.new && mv /home/$primary/.bashrc.new /home/$primary/.bashrc"
[ "$(denied "/home/$primary/.bashrc")" = "no" ] || die "the agent can read .bashrc after it was replaced by rename"
pass "3 - ~/.bashrc replaced by temp-file-and-rename is unreadable"

# 4. Widening the mode cannot reopen what the deny closed...
ssh_t16 "printf 'chmodtest\n' > /home/$primary/chmodtest.txt && chmod 0644 /home/$primary/chmodtest.txt"
for mode in 644 g+r 777; do
  ssh_t16 "chmod $mode /home/$primary/chmodtest.txt"
  [ "$(denied "/home/$primary/chmodtest.txt")" = "no" ] \
    || die "the agent can read chmodtest.txt after \`chmod $mode\`"
done

# 4b. ...and neither can ZEROING THE GROUP BITS. This is the kernel condition:
# with an ACL present the mode's group bits are the mask, and the kernel only
# consults the ACL when those bits are non-zero — so 604/704 make the file
# readable through "other" even though getfacl still shows the deny. The
# watcher has to notice the attribute change and strip the other bits.
for mode in 604 704 004; do
  ssh_t16 "chmod $mode /home/$primary/chmodtest.txt"
  healed=no
  for _ in $(seq 1 5); do
    [ "$(denied "/home/$primary/chmodtest.txt")" = "no" ] && healed=yes && break
    sleep 1
  done
  [ "$healed" = "yes" ] || die "the watcher did not re-protect the file after \`chmod $mode\` (still readable after 5s)"
  [ "$(ssh_t16 "stat -c %a /home/$primary/chmodtest.txt" | sed 's/^.//')" != "04" ] \
    || die "the other bits were not stripped after \`chmod $mode\`"
  pass "4b - chmod $mode is re-protected within 5s (watcher strips the other bits)"
done

# ...and the next setup run must also repair it, not only the watcher.
stop_watcher
for mode in 604 004; do
  ssh_t16 "chmod $mode /home/$primary/chmodtest.txt"
  [ "$(denied "/home/$primary/chmodtest.txt")" = yes ] || die "$mode fixture is not exposed"
  run_dirs > "$work_real/setup-chmod-$mode.log" 2>&1 || { cat "$work_real/setup-chmod-$mode.log"; die 'dirs repair failed'; }
  [ "$(denied "/home/$primary/chmodtest.txt")" = no ] || die "setup did not repair mode $mode"
  [ "$(ssh_t16 'systemctl --user is-active claude-share-watch.service' || true)" = inactive ] || die 'watcher masked short-mode repair'
  pass "4c - setup repairs the $mode state with the watcher stopped and exit 0"
done
start_watcher

# 4d. A file CREATED with a bad mode after setup is unreadable immediately, with
# no watcher reaction needed: the inherited default carries o::---.
stop_watcher
# open(O_CREAT, 0604), not chmod after creation (which bypasses inheritance).
ssh_t16 "perl -e 'sysopen(my \$f, \"/home/$primary/made604.txt\", 193, 0604) or die \$!; print \$f \"made604\\n\";'"
[ "$(denied "/home/$primary/made604.txt")" = "no" ] \
  || die "a file created with mode 604 after setup is readable by the agent"
pass "4d - a file created with mode 604 after setup is unreadable immediately"
start_watcher
pass "4 - still unreadable after chmod 644, chmod g+r and chmod 777"

# 5. The config dir: denied by default, shared entries readable, and the two
#    shared FILES re-granted after Claude Code replaces them by rename.
[ "$(denied "/home/$primary/.claude/history.jsonl")" = no ] || die 'the agent can read pre-existing history.jsonl'
stop_watcher
ssh_t16 "printf '{\"h\":1}\n' > /home/$primary/.claude/late.jsonl && chmod 0644 /home/$primary/.claude/late.jsonl"
[ "$(denied "/home/$primary/.claude/late.jsonl")" = "no" ] \
  || die "the agent can read a 0644 file created in ~/.claude after setup"
pass "5a - pre-existing and new 0644 files in ~/.claude are both unreadable"
start_watcher

[ "$(denied "/home/$primary/.claude/settings.json")" = "yes" ] \
  || die "the agent cannot read settings.json"
[ "$(denied "/home/$primary/.claude/CLAUDE.md")" = "yes" ] \
  || die "the agent cannot read CLAUDE.md"
ssh_t16 "mkdir -p /home/$primary/.claude/skills && printf 'skill\n' > /home/$primary/.claude/skills/new.md"
[ "$(denied "/home/$primary/.claude/skills/new.md")" = "yes" ] \
  || die "a new file under skills/ is not readable as $agent"
pass "5b - settings.json, CLAUDE.md and a new file under skills/ are readable"

# Granting agent read must not cap an unrelated user's existing write grant.
stop_watcher
ssh_t16 "setfacl -m u:nobody:rw- /home/$primary/.claude/settings.json; setfacl -x u:$agent /home/$primary/.claude/settings.json"
run_dirs > "$work_real/setup-readonly-migration.log" 2>&1 || { cat "$work_real/setup-readonly-migration.log"; die 'readonly migration failed'; }
ssh_t16 "getfacl -c -p /home/$primary/.claude/settings.json | grep -qx 'user:nobody:rw-'" || die 'readonly migration capped unrelated grant'
as_agent "test -w /home/$primary/.claude/settings.json" && die 'agent readonly grant allows writing'
pass 'readonly migration preserves unrelated grants without granting agent write'
start_watcher

# Claude Code rewrites settings.json by writing a new file and renaming it, so
# the replacement arrives with the inherited DENY and no access entry. The
# watcher has to put the grant back.
ssh_t16 "printf '{\"model\":\"claude\"}\n' > /home/$primary/.claude/settings.json.new && mv /home/$primary/.claude/settings.json.new /home/$primary/.claude/settings.json"
regranted=no
for _ in $(seq 1 5); do
  [ "$(denied "/home/$primary/.claude/settings.json")" = "yes" ] && regranted=yes && break
  sleep 1
done
[ "$regranted" = "yes" ] || die "settings.json did not become readable again within 5s of being replaced"
pass "5c - a settings.json replaced by rename is readable again within 5s"

# 6. The shared dirs must still work — the deny must not cost the agent its work.
# One `bash -c` for each: `sudo -u agent A && B` runs only A as the agent, and B
# would silently run as the primary — which is how the first version of this
# assertion passed a write that had nothing to do with the agent.
as_agent "bash -c \"mkdir -p /home/$primary/work/agent-dir && printf 'from the agent\\n' > /home/$primary/work/agent-dir/f.txt\"" \
  || die "the agent cannot write in the work dir"
as_agent "cat /home/$primary/work/agent-dir/f.txt" >/dev/null 2>&1 \
  || die "the agent cannot read back what it wrote in the work dir"
as_agent "bash -c \"printf 'from the agent\\n' > /home/$primary/.claude/projects/x/agent-wrote.jsonl\"" \
  || die "the agent cannot write into projects/"
as_agent "cat /home/$primary/.claude/projects/x/agent-wrote.jsonl" >/dev/null 2>&1 \
  || die "the agent cannot read what it wrote into projects/"
pass "6 - the agent still reads and writes the work dir and projects/"
# Agent-owned drift cannot be repaired by the primary; it must warn without
# preventing a later privacy repair. A work-tree symlink must not be followed.
as_agent "chgrp agent /home/$primary/work/agent-dir/f.txt"
as_agent "ln -s /home/$primary/topsecret.txt /home/$primary/work/agent-link"

# 7. ssh must keep working for the PRIMARY after the deny lands on ~/.ssh: the
#    deny names the agent user; sshd logs in as the owner.
ssh_t16 "ssh-keygen -q -t ed25519 -N '' -f /home/$primary/.ssh/after-setup <<<y" >/dev/null 2>&1
# Preserve the harness key and prove the fresh key separately, with multiplexing off.
ssh_t16 "cat /home/$primary/.ssh/authorized_keys /home/$primary/.ssh/after-setup.pub > /home/$primary/.ssh/authorized_keys.new && mv /home/$primary/.ssh/authorized_keys.new /home/$primary/.ssh/authorized_keys"
ssh_t16 "ssh -F /dev/null -o ControlMaster=no -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /home/$primary/.ssh/after-setup $primary@localhost true" \
  || die "the primary could not log in with its fresh key"
ssh_t16 true >/dev/null 2>&1 || die "ssh stopped working for the primary after the deny (StrictModes)"
pass "7 - a fresh key and a renamed authorized_keys still let the primary ssh in"

if as_agent "cat /home/$primary/.claude/.credentials.json" >/dev/null 2>&1; then
  die "the agent CAN read .credentials.json"
fi
pass "0644 .credentials.json is NOT readable as $agent (ACL, not owner-only mode)"


as_agent "cat /home/$primary/.claude/projects/x/agent-wrote.jsonl" >/dev/null 2>&1 \
  && pass "the agent can read the primary's transcripts"

# The watcher: a 0600 file, written by its owner, becomes group-readable.
#
# The file is made in work/ — NOT in projects/ — and asserted there, then moved
# into the watched dir. Two reasons, both about not writing a flaky test:
#   - the default ACL on projects/ would hand a newly created file group-read
#     anyway, so creating it there would not prove the watcher did anything;
#   - asserting "it is still 0600" AFTER moving it in would race the very
#     process under test, which typically wins within a second.
# A file MOVED in keeps the mode it was created with — default ACLs apply at
# creation, to the directory being created in — so after the move the only
# thing that can widen it is the watcher.
ssh_t16 "printf '{\"session\":\"abc\"}\n' > /home/$primary/work/live.jsonl && chmod 0600 /home/$primary/work/live.jsonl"
mode_before="$(ssh_t16 "stat -c %a /home/$primary/work/live.jsonl")"
[ "$mode_before" = "600" ] || die "the fixture file is $mode_before, expected 600"
[ "$(ssh_t16 "stat -c %d /home/$primary/work/live.jsonl")" = "$(ssh_t16 "stat -c %d /home/$primary/.claude/projects/x")" ] || die 'transcript move is not on one filesystem'
ssh_t16 "mv /home/$primary/work/live.jsonl /home/$primary/.claude/projects/x/live.jsonl"

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

# 8a. Take the deny off one top-level file. The next setup must NOTICE and put
#     it back — otherwise the machine slowly drifts open and nothing says so.
# The watcher is stopped for this one. Removing the deny is an ATTRIB event, so
# with the watcher running it puts the deny straight back and setup never sees
# drift to report — which is the system working, not the check failing. Stopping
# it is what makes this exercise the CHECK path the ruling asks for; 8b below is
# the watcher path.
# Stopping must be VERIFIED. The unit is Restart=always, so a stop that did not
# take leaves the watcher re-applying the deny before setup's check ever runs —
# which looks exactly like "the check does not detect drift".
stop_watcher
ssh_t16 "setfacl -x u:$agent /home/$primary/late.txt"
[ "$(denied "/home/$primary/late.txt")" = "yes" ] \
  || die "removing the deny did not make the file readable — the fixture is wrong"
echo '# drift getfacl before setup'
ssh_t16 "getfacl -c -p /home/$primary/late.txt; stat -c '%a %U %G' /home/$primary/late.txt"
# Render the REAL check through a recording runner; execute it only in this container.
bun "$here/render-agent-user-probe.ts" "$work_real/dirs-probe.sh"
podman cp "$work_real/dirs-probe.sh" "$container:/tmp/dirs-probe.sh"
echo '# drift check probe before setup'
podman exec "$container" runuser -u "$primary" -- sh /tmp/dirs-probe.sh
set +e
run_dirs > "$work_real/setup-drift.log" 2>&1
drift_code=$?
set -e
[ "$drift_code" = 0 ] || { cat "$work_real/setup-drift.log"; die "dirs repair exited $drift_code"; }
grep -q '"applied":\["agent-user.dirs"\]' "$work_real/setup-drift.log" || die 'dirs was not applied'
if ! grep -q "late.txt" "$work_real/setup-drift.log"; then
  die "setup did not NAME the entry whose deny was missing"
fi
ssh_t16 "getfacl -c -p /home/$primary/late.txt | grep -qx 'user:$agent:---'" || die 'deny not restored'
mode="$(ssh_t16 "stat -c %a /home/$primary/late.txt")"
case "$mode" in *[0-7]0[1-7]) die 'late.txt is still in the bad state' ;; esac
[ "$(denied "/home/$primary/late.txt")" = no ] || die 'late.txt remains readable after dirs repair'
[ "$(ssh_t16 'systemctl --user is-active claude-share-watch.service' || true)" = inactive ] || die 'watcher masked the repair'
grep -q '1 agent-owned work entries have the wrong group' "$work_real/setup-drift.log" || die 'missing agent-owned drift warning'
[ "$(denied "/home/$primary/topsecret.txt")" = no ] || die 'shared-tree repair followed a symlink'
[ "$(ssh_t16 "stat -c %G /home/$primary/work/agent-dir/f.txt")" = agent ] || die 'primary rewrote agent-owned metadata'
pass "8a - setup names and repairs the removed deny BEFORE watcher restart"
pass '8a-ownership - warns on agent-owned drift and skips shared-tree symlinks'
# Also cover an inode with NO extended ACL at all, not just a removed named entry.
ssh_t16 "setfacl -b /home/$primary/late.txt && chmod 0644 /home/$primary/late.txt"
[ "$(denied "/home/$primary/late.txt")" = yes ] || die 'no-ACL fixture is not exposed'
run_dirs > "$work_real/setup-no-acl.log" 2>&1 || { cat "$work_real/setup-no-acl.log"; die 'no-ACL repair failed'; }
grep -q late.txt "$work_real/setup-no-acl.log" || die 'no-ACL repair did not name the file'
[ "$(denied "/home/$primary/late.txt")" = no ] || die 'no-ACL file was not reprotected'
pass '8a-no-acl - setup repairs an inode with no extended ACL while watcher is stopped'

# 8a-wedge. An agent-owned 0700 directory inside a shared tree is a state the
#     primary can neither read nor repair. Before this, find descended into it,
#     printed "Permission denied" and exited nonzero, so EVERY later setup run
#     died in the shared-tree repair — before the home protection, which is the
#     documented fallback when the watcher is down. The agent could therefore
#     suppress its own privacy repair at will. The run must now succeed, protect
#     the exposed home file, and warn about what it had to skip.
# One `bash -c` per step: `as_agent` expands to `sudo -u agent <cmd>`, which
# applies only to the FIRST word of an && list, so a bare `&&` would run the
# chmod as the primary instead of the agent.
as_agent "bash -c 'mkdir -p /home/$primary/work/agentpriv && chmod 700 /home/$primary/work/agentpriv'" \
  || die 'could not create the agent-owned unreadable directory'
as_agent "bash -c 'mkdir -p /home/$primary/.claude/projects/agentpriv && chmod 700 /home/$primary/.claude/projects/agentpriv'" \
  || die 'could not create the agent-owned unreadable transcripts directory'
# The home's default ACL denies the agent, so a new file is protected on
# creation; remove the inherited deny explicitly or there is nothing to repair.
ssh_t16 "printf 'exposed\n' > /home/$primary/wedged.txt && chmod 0644 /home/$primary/wedged.txt && setfacl -x u:$agent /home/$primary/wedged.txt"
[ "$(denied "/home/$primary/wedged.txt")" = yes ] || die 'wedge fixture is not exposed'
# The primary must not be able to list it: prove the fixture before setup runs.
ssh_t16 "sudo -u $agent test -r /home/$primary/work/agentpriv" || die 'the agent cannot read its own directory'
ssh_t16 "sudo -u $primary test -r /home/$primary/work/agentpriv" && die 'the primary can read the agent-owned work directory'
ssh_t16 "sudo -u $primary test -r /home/$primary/.claude/projects/agentpriv" && die 'the primary can read the agent-owned transcripts directory'
if ! run_dirs > "$work_real/setup-wedged.log" 2>&1; then
  cat "$work_real/setup-wedged.log"
  die 'an agent-owned unreadable directory made setup fail'
fi
[ "$(denied "/home/$primary/wedged.txt")" = no ] \
  || die 'setup exited 0 but left the exposed home file readable'
ssh_t16 "getfacl -c -p /home/$primary/wedged.txt | grep -qx 'user:$agent:---'" \
  || die 'the named-user deny was not applied to wedged.txt'
grep -q '1 unreadable work entries' "$work_real/setup-wedged.log" \
  || { cat "$work_real/setup-wedged.log"; die 'no warning for the unreadable work entry'; }
grep -q 'agentpriv' "$work_real/setup-wedged.log" || die 'the warning did not name the skipped entry'
grep -q '1 unreadable projects entries' "$work_real/setup-wedged.log" \
  || { cat "$work_real/setup-wedged.log"; die 'no warning for the unreadable projects entry'; }
grep -q 'cannot inspect or repair inside them' "$work_real/setup-wedged.log" \
  || die 'the warning does not state the limit'
ssh_t16 "stat -c %U /home/$primary/work/agentpriv" | grep -qx "$agent" \
  || die 'setup changed the owner of the skipped directory'
pass '8a-wedge - an agent-owned unreadable shared dir is skipped, not fatal, and the home is still protected'
# The primary still owns the shared trees' own metadata, so the wedge does not
# stop later work; remove it so the remaining assertions start clean.
as_agent "rm -rf /home/$primary/work/agentpriv /home/$primary/.claude/projects/agentpriv" \
  || die 'could not remove the wedge directories as the agent'
# `run_dirs` exits 1 when nothing needed doing, so judge the report, not the code:
# recovery means the task settles again with nothing applied and nothing failed.
run_dirs > "$work_real/setup-recovered.log" 2>&1 || true
grep -q '"alreadyOk":\["agent-user.dirs"\]' "$work_real/setup-recovered.log" \
  || { cat "$work_real/setup-recovered.log"; die 'setup did not settle again once the wedge was removed'; }
grep -q '"failed":\[\]' "$work_real/setup-recovered.log" \
  || { cat "$work_real/setup-recovered.log"; die 'setup reported a failure after the wedge was removed'; }
pass '8a-wedge-recovery - setup settles again once the agent removes the wedge'
start_watcher
run_hyper > "$work_real/setup-after-drift.log" 2>&1 || { cat "$work_real/setup-after-drift.log"; die 'full CLI setup failed'; }
[ "$(denied "/home/$primary/late.txt")" = no ] || die 'full CLI left late.txt readable'
pass '8a-full - the full CLI also leaves late.txt protected'

# 8b. A file moved in from elsewhere on the same filesystem keeps the ACLs it
#     came with — the case the watcher exists to close.
ssh_t16 "printf 'moved in\n' > /home/$primary/work/moved-in.txt && setfacl -b /home/$primary/work/moved-in.txt && chmod 0644 /home/$primary/work/moved-in.txt"
[ "$(ssh_t16 "stat -c %d /home/$primary/work/moved-in.txt")" = "$(ssh_t16 "stat -c %d /home/$primary")" ] || die 'home move is not on one filesystem'
[ "$(denied "/home/$primary/work/moved-in.txt")" = yes ] || die 'move fixture must be readable before moving'
ssh_t16 "mv /home/$primary/work/moved-in.txt /home/$primary/moved-in.txt"
moved_denied=no
for _ in $(seq 1 5); do
  [ "$(denied "/home/$primary/moved-in.txt")" = "no" ] && moved_denied=yes && break
  sleep 1
done
[ "$moved_denied" = "yes" ] || die "a file moved into the home was not denied within 5s"
pass "8b - a 0644 file moved into the home is denied within 5s (the watcher)"

# Move a whole collab-owned directory: denying its top level must also block
# full-path reads below it, without recursively rewriting its children.
ssh_t16 "mkdir /home/$primary/work/moved-dir; printf nested > /home/$primary/work/moved-dir/inside; chmod 0755 /home/$primary/work/moved-dir; chmod 0644 /home/$primary/work/moved-dir/inside"
[ "$(denied "/home/$primary/work/moved-dir/inside")" = yes ] || die 'directory move fixture is not readable'
ssh_t16 "mv /home/$primary/work/moved-dir /home/$primary/moved-dir"
healed=no
for _ in $(seq 1 5); do
  if [ "$(denied "/home/$primary/moved-dir/inside")" = no ] && ! as_agent "ls /home/$primary/moved-dir" >/dev/null 2>&1 && ssh_t16 "! getfacl -c -p /home/$primary/moved-dir | grep -E '^(default:)?group:collab:'"; then healed=yes; break; fi
  sleep 1
done
[ "$healed" = yes ] || die 'moved directory remains listable or traversable after 5s'
pass '8b-directory - watcher protects a collab-owned moved directory and full-path reads below it'

# The same moves with the watcher stopped must remain exposed UNTIL setup.
stop_watcher
ssh_t16 "printf stopped > /home/$primary/work/stopped-file; mkdir /home/$primary/work/stopped-dir; printf nested > /home/$primary/work/stopped-dir/inside; chmod 0644 /home/$primary/work/stopped-file /home/$primary/work/stopped-dir/inside; chmod 0755 /home/$primary/work/stopped-dir; mv /home/$primary/work/stopped-file /home/$primary/stopped-file; mv /home/$primary/work/stopped-dir /home/$primary/stopped-dir"
ssh_t16 "getfacl -c -p /home/$primary/stopped-file | grep -q '^group:collab:' && ! getfacl -c -p /home/$primary/stopped-file | grep -q 'user:$agent:'" || die 'rename fixture did not retain its shared ACL'
[ "$(denied "/home/$primary/stopped-file")" = yes ] || die 'stopped file move was not exposed'
[ "$(denied "/home/$primary/stopped-dir/inside")" = yes ] || die 'stopped directory move was not exposed'
as_agent "ls /home/$primary/stopped-dir" >/dev/null 2>&1 || die 'stopped directory cannot be listed before repair'
run_dirs > "$work_real/setup-moved.log" 2>&1 || { cat "$work_real/setup-moved.log"; die 'setup failed on moved collab-owned entries'; }
grep -q stopped-file "$work_real/setup-moved.log" && grep -q stopped-dir "$work_real/setup-moved.log" || die 'setup did not name moved entries'
[ "$(denied "/home/$primary/stopped-file")" = no ] || die 'setup did not protect moved file'
[ "$(denied "/home/$primary/stopped-dir/inside")" = no ] || die 'setup did not protect moved directory traversal'
as_agent "ls /home/$primary/stopped-dir" >/dev/null 2>&1 && die 'setup did not protect moved directory listing'
[ "$(ssh_t16 'systemctl --user is-active claude-share-watch.service' || true)" = inactive ] || die 'watcher masked moved-entry repair'
ssh_t16 "! getfacl -c -p /home/$primary/stopped-dir | grep -E '^(default:)?group:collab:'" || die 'protected directory kept legacy default collab ACL'
ssh_t16 "getfacl -c -p /home/$primary/stopped-dir/inside | grep -q '^group:collab:'" || die 'protected directory cleanup unexpectedly recursed'
pass '8c - retained shared ACL is exposed after rename until exit-0 setup, BEFORE watcher restart'
pass '8c-defaults - protected directory loses collab defaults without rewriting children'
start_watcher
ssh_t16 "printf regrouped > /home/$primary/regrouped; chmod 0644 /home/$primary/regrouped; chgrp collab /home/$primary/regrouped"
healed=no
for _ in $(seq 1 5); do [ "$(denied "/home/$primary/regrouped")" = no ] && healed=yes && break; sleep 1; done
[ "$healed" = yes ] || die 'chgrp collab exposed a protected entry'
pass '8d - chgrp collab cannot bypass the named-user deny on a home-created file'

# --------------------------------------------------------------------------
# Running the root script a second time changes nothing (C-15)
# --------------------------------------------------------------------------
# Compared as ACLs and modes rather than "the script exited 0": every step is
# guarded, so a second run must leave both homes' metadata byte-identical.
snapshot() {
  # The agent's own config dir and .bashrc too: those are the paths the script
  # touches as the AGENT, and a second run that rewrote either would be just as
  # much a change as one that rewrote the primary's.
  ssh_t16 "getfacl -p /home/$primary /home/$primary/.claude /home/$primary/work /home/$agent /home/$agent/.claude 2>/dev/null; stat -c '%n %a %U %G' /home/$primary /home/$primary/.claude /home/$primary/work /home/$agent /home/$agent/.claude 2>/dev/null; cat /home/$agent/.bashrc 2>/dev/null | md5sum"
}
before="$(snapshot)"
manager_pid_before_second="$(ssh_t16 "systemctl show -p MainPID --value user@$puid.service")"
ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1 \
  || die "the root script failed on its SECOND run — it is not idempotent"
after="$(snapshot)"
manager_pid_after_second="$(ssh_t16 "systemctl show -p MainPID --value user@$puid.service")"
[ "$manager_pid_before_second" = "$manager_pid_after_second" ] \
  || die "the second root script run restarted the user manager ($manager_pid_before_second -> $manager_pid_after_second) — not a no-op"
pass 'the second root script run does not restart the primary user manager (C-15)'
if [ "$before" != "$after" ]; then
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -20
  die "the root script changed the machine on its second run"
fi
pass "running the root script twice is a no-op (C-15)"

# --------------------------------------------------------------------------
# Root must not follow a symlink the agent planted in its own home
# --------------------------------------------------------------------------
# The agent owns everything under ~agent. If root did `chown`/`chmod` on
# $agent_home/.claude without asking whether it is a symlink, the agent could
# point that at any file on the machine and have root rewrite it. So: plant a
# symlink at a root-owned canary, re-run the script, and require the canary to
# come out untouched.
canary="/etc/hyper-t16-canary"
# A root-owned DIRECTORY, not writable by the agent. Pointed at a FILE, mkdir
# aborts on the old code and the new code alike, so the assertion proved nothing;
# pointed at a root-owned directory, root chown/chmod/setfacl on the
# path would change it and that is what we are testing for.
ssh_t16 "sudo sh -c 'rm -rf $canary && mkdir -p $canary && chown root:root $canary && chmod 0755 $canary && printf CANARY > $canary/inside'"
before_canary="$(ssh_t16 "sudo stat -c '%U %G %a' $canary && sudo getfacl -c -p $canary | sort")"
# The agent replaces its own config dir with a symlink to the canary.
# Both steps run inside ONE `bash -c`, because `as_agent` expands to
# `sudo -u agent <cmd>` and that applies only to the FIRST word of an `&&` list —
# the second would silently run as the primary user instead.
as_agent "bash -c 'rm -rf /home/$agent/.claude && ln -s $canary /home/$agent/.claude'" \
  || die "could not plant the symlink as the agent"
# Lead r3 ruling: explicit refusal BEFORE mutation, not success or a chmod error.
if ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" > "$work_real/canary.log" 2>&1; then
  die "the root script silently accepted the planted symlink"
fi
grep -q '/home/agent/.claude is a symlink; refusing agent home setup' "$work_real/canary.log" \
  || { cat "$work_real/canary.log"; die 'missing explicit symlink refusal'; }
after_canary="$(ssh_t16 "sudo stat -c '%U %G %a' $canary && sudo getfacl -c -p $canary | sort")"
if [ "$before_canary" != "$after_canary" ]; then
  die "root followed the agent's planted symlink: canary changed from '$before_canary' to '$after_canary'"
fi
pass "root did not follow a symlink the agent planted at ~$agent/.claude"
# Owner, group, mode AND the full ACL must be identical: root chowning or
# chmodding through the link would show up in any of them.
if [ "$before_canary" != "$after_canary" ]; then
  diff <(printf '%s\n' "$before_canary") <(printf '%s\n' "$after_canary") | head -20
  die "root changed the canary through the agent's planted symlink"
fi
pass "the canary keeps its owner, group, mode and full ACL across the re-run"

# A kept container must stay usable. The canary leaves ~agent/.claude as a
# symlink into the canary, and every later check asserts that ~agent/.claude
# links to each shared entry — so restore it or any subsequent setup run on
# this machine fails with "projects is not a symlink".
#
# Restoring it FAITHFULLY is the point. `rm` + `mkdir` alone leaves an empty
# 0775 directory owned by the agent with NO ACL on it, so the next setup run
# reports agent-user.create as unsettled (the primary has no r-x entry on it)
# and the run never reaches "nothing needed" on a kept container. The metadata
# is the agent's to set, so the faithful restore is: put the links back, then
# run the root script once more — the one thing that knows how to put the mode
# and the ACLs back — and ASSERT both, so this cannot silently degrade into the
# 0775 hole again.
as_agent "bash -c 'rm -f /home/$agent/.claude && mkdir -p /home/$agent/.claude'" \
  || die 'could not restore the agent config dir'
for entry in projects settings.json CLAUDE.md skills commands agents; do
  target="/home/$primary/.claude/$entry"
  [ -e "$target" ] || continue
  as_agent "ln -sfn $target /home/$agent/.claude/$entry" \
    || die "could not restore the agent's $entry link"
done
for entry in projects settings.json CLAUDE.md skills commands agents; do
  target="/home/$primary/.claude/$entry"
  [ -e "$target" ] || continue
  [ "$(ssh_t16 "readlink /home/$agent/.claude/$entry")" = "$target" ] \
    || die "the agent's $entry link was not restored"
done
ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1 \
  || die 'the root script failed on the canary restore — the machine is left half set up'
[ "$(ssh_t16 "stat -c %a /home/$agent/.claude")" = "750" ] \
  || { ssh_t16 "stat -c '%n %a %U' /home/$agent/.claude"; die "~agent/.claude is not 0750 after the restore"; }
ssh_t16 "getfacl -c -p /home/$agent/.claude | grep -qx 'user:$primary:r-x'" \
  || { ssh_t16 "getfacl -p /home/$agent/.claude"; die "~agent/.claude has no ACL entry for $primary after the restore"; }
pass "the agent's config dir is usable again after the canary assertions"
# …and the machine itself must be settled again: a kept container that reports
# agent-user.create as unsettled is not usable, and that is exactly what the
# empty 0775 restore used to leave behind.
run_hyper > "$work_real/setup-after-canary.log" 2>&1 \
  || { cat "$work_real/setup-after-canary.log"; die 'setup failed after the canary restore'; }
grep -q "Nothing needed" "$work_real/setup-after-canary.log" \
  || { cat "$work_real/setup-after-canary.log"; die 'setup does not report nothing needed after the canary restore'; }
pass "a kept container still reports nothing needed after the canary assertions"

# --------------------------------------------------------------------------
# Item 1: the root-script COPY and RUN both reach THIS container on a
# non-default port. The main setup above uses an ssh alias carrying the port,
# so it cannot catch scp's missing -P bug. Here the target is host:port, and
# the localhost ssh config has NO Port directive — the port must come from
# RemoteMachine's -p (ssh) and -P (scp) argv. Make create unsettled again,
# then the harness-only probe answers the root prompt "run it for me" (NOPASSWD
# inside this disposable container; never sudo on the Mac).
# --------------------------------------------------------------------------
ssh_t16 "sudo gpasswd -d $agent collab" >/dev/null || die 'could not make create unsettled for the port probe'
ssh_t16 "id -nG $agent | tr ' ' '\n' | grep -qx collab" && die 'port fixture: agent still belongs to collab'
HYPER_T16_PORT_TARGET="$primary@localhost:$port" run_isolated "$here/run-root-script-remote.ts" \
  > "$work_real/port-probe.log" 2>&1 \
  || { tail -25 "$work_real/port-probe.log"; die "the run-for-me root script copy/run did not reach the container on port $port"; }
grep -q '"applied":\["agent-user.create"\]' "$work_real/port-probe.log" \
  || { tail -25 "$work_real/port-probe.log"; die 'agent-user.create did not settle through the port-carrying copy and run'; }
ssh_t16 "id -nG $agent | tr ' ' '\n' | grep -qx collab" \
  || die 'the root script copied via scp did not run on the container'
run_hyper > "$work_real/setup-after-port.log" 2>&1 \
  && grep -q "Nothing needed" "$work_real/setup-after-port.log" \
  || { tail -25 "$work_real/setup-after-port.log"; die 'setup did not settle after the port-carrying copy and run'; }
pass "root script copy (scp -P) and run (ssh -p) both reach the container on port $port"

# The container must not survive the script.
echo "# container is removed by the trap"

echo "# $step assertions passed"