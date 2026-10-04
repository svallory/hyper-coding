#!/usr/bin/env bash
# e2e: rootless Docker for the unattended agent, and a /Users-shaped home.
#
# This is the acceptance for T-17. It runs `hyper machine setup t17 --features
# agent-user,docker-rootless,home-path` against a machine that exists only for
# the length of this script, plays the human (the HARNESS runs the root script,
# over ssh with sudo, exactly as a user would), and then asserts the properties
# that make both features safe and useful:
#
#   1. as the AGENT: `docker run --rm hello-world` succeeds after
#      `systemctl --user start docker`
#   2. `systemctl --user is-enabled docker` is `disabled`
#   3. the agent is NOT in the docker group and cannot reach /var/run/docker.sock
#   4. the home-path acceptance line: `cd /home/<user>/x && pwd` in a login shell
#      prints /Users/<user>/x
#   5. the logged-in `usermod -d` case: the script REFUSES while the user has
#      processes, changes nothing, and says how to run it from a root console
#   6. T-16's home ACL probe still passes after the move (agent-user.dirs settles)
#   7. a root-owned file under skills/ is skipped with a warning, not fatal
#   8. a second full run is a no-op
#   9. the container is gone at the end (trap)
#
# TWO THINGS ABOUT THE FIXTURE, both because this is a container and not a VM:
#
# - The container runs `--privileged`: rootless Docker needs nested user
#   namespaces (`unshare -Ur` and newuidmap/newgidmap), which the default
#   seccomp/capability set does not allow. Inside the podman machine VM only.
# - The agent's `~/.config/docker/daemon.json` is set to the `vfs` storage
#   driver BY THE HARNESS, before setup's install task runs: overlayfs on
#   overlayfs is refused by the kernel, so `docker run` fails at the mount with
#   "invalid argument". That is a nested-container artifact, NOT a product
#   change — a real Linux host uses overlayfs and this file is never written by
#   hyperdrive.
#
# Usage: packages/drive/tests/e2e/docker-home.sh
# Safety: the ONLY machine this touches is the disposable container below. No
# sudo on the Mac, nothing installed on it, the operator's real ~/.ssh is never
# read (the key is a throwaway one created here and named in drive.toml).
# Requires: podman with a started machine, and packages/cli built.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/../../../cli/bin/run.js"
image="debian:13"
container="hyper-t17"
port=2299
primary="svallory"
agent="agent"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-dockerhome.XXXXXX")"
work_real="$(cd "$work" && pwd -P)"
key="$work_real/id"

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "# KEEP=1 — container $container and logs left in $work_real; remove with podman rm -f $container"
  else
    echo "# tearing down $container"
    podman rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$work_real"
  fi
}
trap cleanup EXIT

echo "# podman version"
podman --version

# --------------------------------------------------------------------------
# The image: debian:13 + systemd + sshd + everything the three features install.
# The stock image ships no /sbin/init, so the packages go into a derived image.
# The tag carries a hash of the Containerfile, so editing it makes a new image
# instead of silently reusing a stale one.
# --------------------------------------------------------------------------
containerfile="$work_real/Containerfile"
cat > "$containerfile" <<CONTAINERFILE
FROM $image
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\
      systemd-sysv openssh-server sudo acl inotify-tools polkitd procps \\
      ca-certificates curl gnupg uidmap slirp4netns dbus-user-session \\
      iptables iproute2 less kmod fuse-overlayfs xz-utils psmisc \\
    && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
CONTAINERFILE

recipe="$(shasum -a 256 "$containerfile" | cut -c1-12)"
derived="hyper-t17-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi
for stale in $(podman images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(localhost/)?hyper-t17-e2e:' || true); do
  [ "${stale#localhost/}" = "$derived" ] && continue
  podman rmi "$stale" >/dev/null 2>&1 || true
done

if ! podman machine list --format '{{.Running}}' | grep -q true; then
  echo "# starting the podman machine"
  podman machine start >/dev/null
fi

podman rm -f "$container" >/dev/null 2>&1 || true
# --privileged: nested user namespaces, which rootless Docker needs. See header.
podman run -d --name "$container" --privileged --systemd=always -p "$port":22 "$derived" /sbin/init >/dev/null
echo "# started $container (privileged: nested user namespaces)"

pexec() { podman exec "$container" sh -c "$1"; }
pexec 'for i in $(seq 1 90); do systemctl is-system-running >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1' \
  || die "systemd never came up in the container"
pexec 'command -v polkitd >/dev/null || { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq polkitd; }' \
  || die "could not install polkitd"
pexec "unshare -Ur true" || die 'this container cannot create user namespaces at all'

# The primary user, playing the human: passwordless sudo inside the container.
pexec "useradd -m -s /bin/bash $primary"
pexec "printf '%s ALL=(ALL) NOPASSWD:ALL\n' '$primary' > /etc/sudoers.d/$primary"
pexec "chmod 0440 /etc/sudoers.d/$primary"

# A throwaway key. The operator's real key never goes near this container, and
# `agent_key` in drive.toml points at THIS file — hyper reads the public half.
ssh-keygen -q -t ed25519 -N '' -f "$key" >/dev/null 2>&1
podman cp "$key.pub" "$container:/tmp/key.pub"
pexec "mkdir -p /home/$primary/.ssh && chown $primary /home/$primary/.ssh && chmod 0700 /home/$primary/.ssh && install -m 0600 -o $primary /tmp/key.pub /home/$primary/.ssh/authorized_keys && rm -f /tmp/key.pub"
pexec 'ssh-keygen -A >/dev/null && mkdir -p /run/sshd'
pexec '/usr/sbin/sshd'
echo "# sshd started"

ssh_t17() {
  /usr/bin/ssh -F /dev/null -o ControlMaster=no -o ControlPath=none -i "$key" -p "$port" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ConnectTimeout=10 "$primary@localhost" "$@"
}
for _ in $(seq 1 30); do ssh_t17 true >/dev/null 2>&1 && break; sleep 1; done
ssh_t17 true >/dev/null 2>&1 || die "could not ssh into the container as $primary"

# --------------------------------------------------------------------------
# Fixtures that must exist BEFORE setup: the shared entries, a pre-existing
# world-readable file (the deny is applied to what is already there), and the
# root-owned file under skills/ that T-17 follow-up (a) is about.
# --------------------------------------------------------------------------
ssh_t17 "mkdir -p /home/$primary/.claude/projects/x /home/$primary/.claude/skills"
ssh_t17 "printf 'top-secret\n' > /home/$primary/topsecret.txt && chmod 0644 /home/$primary/topsecret.txt"
ssh_t17 "printf '# shared\n' > /home/$primary/.claude/CLAUDE.md"
pexec "printf 'foreign\n' > /home/$primary/.claude/skills/root-owned.md && setfacl -b /home/$primary/.claude/skills/root-owned.md && chmod 0644 /home/$primary/.claude/skills/root-owned.md"
foreign_before="$(pexec "stat -c '%U %G %a' /home/$primary/.claude/skills/root-owned.md; getfacl -c -p /home/$primary/.claude/skills/root-owned.md | sort")"

# --------------------------------------------------------------------------
# hyper's view of the machine: temp config, fake herdr, ssh wrapper.
# --------------------------------------------------------------------------
mkdir -p "$work_real/bin" "$work_real/claude-empty" "$work_real/hyper-home" "$work_real/xdg-empty"
ssh_home="$work_real/sshhome"
mkdir -p "$ssh_home/.ssh"
cat > "$work_real/bin/herdr" <<JSON
#!/bin/sh
cat <<'HERDR'
[{"label": "t17", "target": "$primary@t17box", "enabled": true}]
HERDR
exit 0
JSON
chmod +x "$work_real/bin/herdr"
# The target names a user (so the generated root script can fall back to it from
# a root console with no \$SUDO_USER) and an ssh alias (which carries the port).
cat > "$ssh_home/.ssh/config" <<SSHCFG
Host t17box
  HostName localhost
  Port $port
  User $primary
  IdentityFile $key
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
SSHCFG
chmod 700 "$ssh_home/.ssh"; chmod 600 "$ssh_home/.ssh/config"
cat > "$work_real/bin/ssh" <<WRAPPER
#!/bin/sh
exec /usr/bin/ssh -F "$work_real/sshhome/.ssh/config" "\$@"
WRAPPER
chmod +x "$work_real/bin/ssh"
[ -d "$HOME/.bun" ] && ln -sfn "$HOME/.bun" "$ssh_home/.bun"
export LC_ALL=C LANG=C

cat > "$work_real/drive.toml" <<TOML
remote = "git@example.invalid:hyperdrive.git"

[self]
name = "mac"
home = "/Users/nobody"

[machines.t17]
home = "/Users/svallory"
features = ["agent-user", "docker-rootless", "home-path"]
agent_user = "$agent"
agent_key = "$key.pub"
TOML

run_isolated() {
  PATH="$work_real/bin:$PATH" HYPER_DRIVE_CONFIG="$work_real/drive.toml" \
    HOME="$ssh_home" CLAUDE_CONFIG_DIR="$work_real/claude-empty" HYPER_MACHINE_SCRATCH="$work_real/scratch" \
    HYPER_HOME="$work_real/hyper-home" XDG_CONFIG_HOME="$work_real/xdg-empty" \
    NO_COLOR=1 bun "$@"
}
run_hyper() { run_isolated "$cli" machine setup t17 --yes; }
# The script travels over stdin, so quoting inside the command is its own
# business and never the harness's.
as_agent() { ssh_t17 "sudo -u $agent -- bash -s" <<<"$1"; }
as_agent_ssh() {
  /usr/bin/ssh -F /dev/null -o ControlMaster=no -o ControlPath=none -i "$key" -p "$port" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
    "$agent@localhost" "$@"
}
copy_root_script() {
  scp -F /dev/null -o ControlMaster=no -o ControlPath=none -q -i "$key" -P "$port" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
    "$1" "$primary@localhost:/tmp/hyper-machine-root.sh"
}

# The nested-container storage driver, written by the HARNESS as the agent.
vfs=0
write_vfs() {
  as_agent_ssh "mkdir -p ~/.config/docker && printf '{\"storage-driver\":\"vfs\"}\n' > ~/.config/docker/daemon.json" \
    >/dev/null 2>&1 || return 1
  vfs=1
  return 0
}

# --------------------------------------------------------------------------
# Run setup until it settles, running the root script the way the user would.
# --------------------------------------------------------------------------
settled=0
refused_logged=0
console_used=0
root_log=""
for round in $(seq 1 12); do
  echo "# setup round $round"
  set +e
  run_hyper > "$work_real/setup-$round.log" 2>&1
  code=$?
  set -e
  tail -3 "$work_real/setup-$round.log"
  # Exit 3 is "root steps pending, nothing run"; exit 4 is "something failed to
  # install". Both mean the same thing to this harness when a root script was
  # written: nothing has run yet, and the next step is the same.
  if [ "$code" = 3 ] || [ "$code" = 4 ]; then
    script="$(grep -o "[^ ]*hyper-machine-root\.sh" "$work_real/setup-$round.log" | head -1)"
    [ -n "$script" ] || die "round $round said root work was pending but named no script"
    copy_root_script "$script"
    set +e
    ssh_t17 "sudo bash /tmp/hyper-machine-root.sh" > "$work_real/root-$round.log" 2>&1
    rcode=$?
    set -e
    if [ "$rcode" != 0 ]; then
      if ! grep -q "still has processes running" "$work_real/root-$round.log"; then
        cat "$work_real/root-$round.log"
        die "the root script failed on round $round for an unexpected reason"
      fi
      # The logged-in case, exactly as designed: usermod -d refuses while the
      # user has processes, so the script refuses BEFORE changing anything.
      [ "$refused_logged" = 1 ] || refused_logged=1
      root_log="$work_real/root-$round.log"
      [ "$(pexec "getent passwd $primary | cut -d: -f6")" = "/home/$primary" ] \
        || die "the refused script still changed the passwd entry"
      pexec "test -e /Users/$primary" && die "the refused script still created /Users/$primary"
      # …and the way out it names: a root console, where the user has no
      # processes of their own.
      if [ "$console_used" = 0 ]; then
        echo "# the harness now runs the same script from a root console, as it says to"
        podman exec -e "SUDO_USER=$primary" "$container" bash /tmp/hyper-machine-root.sh \
          > "$work_real/root-console-$round.log" 2>&1 \
          || { cat "$work_real/root-console-$round.log"; die "the root script failed from the root console"; }
        console_used=1
      fi
    fi
    # Once the packages script has run, the agent can be reached: give the
    # nested container its storage driver before setup's install task verifies
    # a real `docker run`.
    if [ "$vfs" = 0 ]; then write_vfs && echo "# wrote the vfs storage driver for the nested container"; fi
    continue
  fi
  [ "$code" = 0 ] || { cat "$work_real/setup-$round.log"; die "setup exited $code on round $round"; }
  if grep -q "Nothing needed" "$work_real/setup-$round.log"; then settled=1; break; fi
done

if [ "$settled" != 1 ]; then
  echo "# setup never settled. What each round said it still needed:" >&2
  grep -h -E "still need root|not settled|docker-rootless|home-path" "$work_real"/setup-*.log | tail -25 >&2
  die "setup never settled into \"Nothing needed\""
fi
pass "a re-run after the root script reports nothing needed (C-15)"
grep -q "already fine: .*agent-user.create" "$work_real/setup-$round.log" \
  || die "agent-user.create is not settled"
grep -q "already fine: .*docker-rootless.packages" "$work_real/setup-$round.log" \
  || die "docker-rootless.packages is not settled"
grep -q "already fine: .*docker-rootless.install" "$work_real/setup-$round.log" \
  || die "docker-rootless.install is not settled"
grep -q "already fine: .*home-path.symlink" "$work_real/setup-$round.log" || die "home-path.symlink is not settled"
grep -q "already fine: .*home-path.physical" "$work_real/setup-$round.log" || die "home-path.physical is not settled"
pass "every docker-rootless and home-path task is settled"

# --------------------------------------------------------------------------
# home-path
# --------------------------------------------------------------------------
[ "$(pexec "getent passwd $primary | cut -d: -f6")" = "/Users/$primary" ] \
  || die "the passwd home is $(pexec "getent passwd $primary | cut -d: -f6"), expected /Users/$primary"
[ "$(pexec "readlink /home/$primary")" = "/Users/$primary" ] || die "/home/$primary is not a symlink to /Users/$primary"
pass "the real home is /Users/$primary and /home/$primary is a symlink to it"
pexec "test -d /Users/$primary/.claude && echo yes" | grep -qx yes || die "the moved home has no .claude"

# The acceptance line, in a LOGIN shell: `.bashrc` is only read by an
# interactive shell, so this is `bash -l` with a tty-shaped invocation.
ssh_t17 "mkdir -p /home/$primary/x" >/dev/null 2>&1
acceptance="$(ssh_t17 "bash -lic 'cd /home/$primary/x && pwd'" 2>/dev/null | tail -1)"
[ "$acceptance" = "/Users/$primary/x" ] \
  || die "the acceptance line printed '$acceptance', expected /Users/$primary/x"
pass "4 - a login shell's \`cd /home/$primary/x && pwd\` prints /Users/$primary/x"
[ "$(ssh_t17 "grep -cxF 'set -o physical' /Users/$primary/.bashrc")" = 1 ] \
  || die "the primary's .bashrc has no single \`set -o physical\` line"
pass "the physical-cd line is in the primary's .bashrc exactly once"

# The logged-in `usermod -d` refusal, with the evidence for both halves.
[ "$refused_logged" = 1 ] || die "the root script never refused while the user was logged in"
grep -q "usermod will not change a home directory" "$root_log" \
  || { cat "$root_log"; die "the refusal does not explain the usermod limit"; }
grep -q "usermod -d /Users/$primary $primary" "$root_log" \
  || { cat "$root_log"; die "the refusal does not print the one-liner to run by hand"; }
pass "5 - logged in, the script refuses before changing anything and prints the way out"

# T-16's home ACL probe, AFTER the move: the layout the agent-user tasks manage
# has to have moved with the directory, or that task stops settling.
ssh_t17 "getfacl -c -p /Users/$primary | grep -qx 'user:$agent:--x'" \
  || { ssh_t17 "getfacl -p /Users/$primary"; die "the moved home lost the agent traverse entry"; }
ssh_t17 "getfacl -c -p /Users/$primary/.claude | grep -qx 'user:$agent:--x'" \
  || { ssh_t17 "getfacl -p /Users/$primary/.claude"; die "the moved config dir lost the agent traverse entry"; }
[ "$(ssh_t17 "stat -c %U /Users/$primary/.claude/skills/root-owned.md")" = root ] \
  || die "the move changed the owner of a root-owned file (a rename must not)"
pass "6 - T-16's home ACLs survived the move, and the foreign-owned file kept its owner"

# --------------------------------------------------------------------------
# T-17 follow-up (a): a readable root-owned file under skills/ is skipped with a
# warning, and the apply is not stopped by it.
# --------------------------------------------------------------------------
grep -h "not owned by $primary and are skipped" "$work_real"/setup-*.log | grep -q "root-owned.md" \
  || { grep -h "skipped" "$work_real"/setup-*.log || true; die 'no warning named the foreign-owned skills entry'; }
pass "7a - the root-owned file under skills/ is skipped with a warning, and setup still settled"
foreign_after="$(pexec "stat -c '%U %G %a' /home/$primary/.claude/skills/root-owned.md; getfacl -c -p /home/$primary/.claude/skills/root-owned.md | sort")"
if [ "$foreign_before" != "$foreign_after" ]; then
  diff <(printf '%s\n' "$foreign_before") <(printf '%s\n' "$foreign_after") || true
  die "the foreign-owned entry was modified"
fi
pass "7b - the foreign-owned entry keeps its owner, mode and ACLs"

# --------------------------------------------------------------------------
# docker-rootless
# --------------------------------------------------------------------------
as_agent_ssh "systemctl --user start docker" || die "the agent could not start its own daemon"
for _ in $(seq 1 30); do
  as_agent_ssh "docker version >/dev/null 2>&1" >/dev/null 2>&1 && break
  sleep 1
done
hello="$(as_agent_ssh "docker run --rm hello-world 2>&1" | tail -12)"
printf '%s\n' "$hello" | grep -q "Hello from Docker!" \
  || { printf '%s\n' "$hello"; die "hello-world did not run as the agent"; }
pass "1 - as the agent, \`docker run --rm hello-world\` succeeds after systemctl --user start docker"
[ "$(as_agent_ssh "systemctl --user is-enabled docker")" = "disabled" ] \
  || die "the unit is $(as_agent_ssh "systemctl --user is-enabled docker"), expected disabled"
pass "2 - the agent's docker unit is enabled=no (disabled)"
as_agent "id -nG" | grep -qw docker && die "the agent IS in the docker group"
as_agent_ssh "docker info --format '{{.Name}}'" >/dev/null 2>&1 \
  || die "docker info failed for the agent"
as_agent_ssh "test -w /var/run/docker.sock" >/dev/null 2>&1 && die "the agent can write the root-owned docker socket"
as_agent_ssh "test -S /var/run/docker.sock" && die "a root-owned docker socket exists on this machine at all"
pass "3 - the agent is not in the docker group and cannot reach /var/run/docker.sock"
# The DOCKER_HOST line, above a non-interactive guard.
[ "$(as_agent_ssh "head -1 ~/.bashrc | grep -c 'DOCKER_HOST=unix:///run/user/'" )" = 1 ] \
  || die "the DOCKER_HOST line is not the first line of the agent's .bashrc"
pass "the agent's .bashrc points DOCKER_HOST at its own socket on the first line"
as_agent_ssh "systemctl --user stop docker" || die "could not stop the agent's daemon"

# --------------------------------------------------------------------------
# A second full run is a no-op, and the machine is still settled (the kept
# container case T-16's canary restore used to break).
# --------------------------------------------------------------------------
run_hyper > "$work_real/setup-final.log" 2>&1 || { cat "$work_real/setup-final.log"; die 'the second full run failed'; }
grep -q "Nothing needed" "$work_real/setup-final.log" \
  || { cat "$work_real/setup-final.log"; die 'the second full run is not a no-op'; }
pass "8 - a second full run is a no-op on the kept container"
# …and the root script is idempotent from here, from the new home.
ssh_t17 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1 || die "the root script is not idempotent"
run_hyper > "$work_real/setup-final2.log" 2>&1 \
  && grep -q "Nothing needed" "$work_real/setup-final2.log" \
  || { cat "$work_real/setup-final2.log"; die 'a second root script run changed the machine'; }
pass "running the root script twice more changes nothing (C-15)"

echo "# the container is removed by the trap"
echo "# $step assertions passed"