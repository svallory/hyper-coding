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
# Overridable so the suite runner (run.sh) can give each run a free port and a
# unique container name on a shared machine; the defaults are the T-17 names.
container="${DOCKER_HOME_E2E_CONTAINER:-hyper-fm-machine-t17}"
port="${DOCKER_HOME_E2E_PORT:-23323}"
primary="svallory"
agent="agent"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

# shasum is a perl script (macOS ships it; minimal Linux may not) — fall back
# to coreutils sha256sum. Both print the same hex, so the recipe tag is stable.
sha12() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi | cut -c1-12; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-dockerhome.XXXXXX")"
work_real="$(cd "$work" && pwd -P)"
key="$work_real/id"
started=0

cleanup() {
  # The throwaway ssh-agent goes whatever KEEP says: it holds only a throwaway
  # key, but a leftover agent process is still a leftover.
  if [ -n "${SSH_AGENT_PID:-}" ]; then ssh-agent -k >/dev/null 2>&1 || kill "$SSH_AGENT_PID" 2>/dev/null || true; fi
  if [ "${KEEP:-0}" = "1" ]; then
    echo "# KEEP=1 — container $container and logs left in $work_real; remove with podman rm -f $container"
  else
    if [ "$started" = 1 ]; then
      echo "# tearing down $container"
      podman rm -f "$container" >/dev/null 2>&1 || true
    fi
    rm -rf "$work_real"
  fi
}
trap cleanup EXIT

# A throwaway ssh-agent holding a throwaway key, for the forwarding assertion.
# The operator's own agent is dropped from this script's environment first, so
# nothing below can use or forward it.
unset SSH_AUTH_SOCK SSH_AGENT_PID
eval "$(ssh-agent -s)" >/dev/null
ssh-keygen -q -t ed25519 -N '' -C forwarded-throwaway -f "$work_real/forwarded" >/dev/null 2>&1
ssh-add -q "$work_real/forwarded" 2>/dev/null
echo "# throwaway ssh-agent $SSH_AGENT_PID holds one throwaway key"

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

recipe="$(sha12 "$containerfile")"
derived="hyper-t17-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi
# Leave older image tags alone: a different run may still refer to one.

# Start the podman VM when this platform has one (macOS/Windows). On Linux
# `podman machine` is unsupported and exits non-zero; podman is native there.
if [ "$(uname -s)" != Linux ] && podman machine list --format '{{.Running}}' >/dev/null 2>&1; then
  if ! podman machine list --format '{{.Running}}' | grep -q true; then
    echo "# starting the podman machine"
    podman machine start >/dev/null
  fi
fi

# Refuse a name collision rather than remove a container this run did not start.
# run.sh passes a run-unique name via DOCKER_HOME_E2E_CONTAINER.
# --privileged: nested user namespaces, which rootless Docker needs. See header.
podman run -d --name "$container" --privileged --systemd=always -p "$port":22 "$derived" /sbin/init >/dev/null
started=1
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
  IdentitiesOnly yes
  # What a dev-server config often says. Sessions as the primary forward the
  # (throwaway) agent; sessions hyper opens as the agent must not.
  ForwardAgent yes
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
run_probe() { HYPER_T17_CONTAINER_TEST=1 run_isolated "$here/run-as-agent-probe.ts"; }
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
# DOCKER_IO=1: the existing-engine case (security review finding 3). Debian's
# own docker.io is installed and started first; setup must refuse and leave it
# exactly as it was — still installed, its unit in the same state, and no
# Docker apt repository or key added. Then the script ends.
# --------------------------------------------------------------------------
if [ "${DOCKER_IO:-0}" = 1 ]; then
  pexec 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq docker.io >/dev/null' \
    || die "could not preinstall docker.io"
  pexec 'systemctl start docker >/dev/null 2>&1 || true'
  engine_before="$(pexec 'dpkg-query -W -f="\${Status} \${Version}" docker.io; echo; systemctl is-enabled docker || true; systemctl is-active docker || true')"
  echo "# docker.io before: $(printf '%s' "$engine_before" | tr '\n' ' ')"
  set +e
  run_hyper > "$work_real/setup-dockerio.log" 2>&1
  code=$?
  set -e
  [ "$code" != 0 ] || { cat "$work_real/setup-dockerio.log"; die "setup did not refuse over docker.io"; }
  # The CLI wraps the error text; read it as one line.
  refusal="$(tr '\n' ' ' < "$work_real/setup-dockerio.log" | tr -s ' ')"
  printf '%s' "$refusal" | grep -q "already has a Docker engine that is not docker-ce: the docker.io package" \
    || { cat "$work_real/setup-dockerio.log"; die "the refusal does not name docker.io"; }
  printf '%s' "$refusal" | grep -q "Nothing has been changed" \
    || { cat "$work_real/setup-dockerio.log"; die "the refusal does not say nothing changed"; }
  pass "docker-rootless: over an installed docker.io, setup refuses, naming it"
  engine_after="$(pexec 'dpkg-query -W -f="\${Status} \${Version}" docker.io; echo; systemctl is-enabled docker || true; systemctl is-active docker || true')"
  [ "$engine_before" = "$engine_after" ] \
    || { printf 'before:\n%s\nafter:\n%s\n' "$engine_before" "$engine_after"; die "docker.io changed"; }
  pexec 'test ! -e /etc/apt/sources.list.d/docker.list' || die "a Docker apt repository appeared"
  pexec 'test ! -e /etc/apt/keyrings/docker.asc' || die "Docker's apt key appeared"
  # dpkg may know the NAME (docker.io declares a conflict with it); installed is the question.
  case "$(pexec "dpkg-query -W -f='\${Status}' docker-ce 2>/dev/null || true")" in
    *"ok installed"*) die "docker-ce was installed" ;;
  esac
  pass "docker-rootless: docker.io is still installed, its unit unchanged ($(printf '%s' "$engine_after" | tail -1)), and no Docker repo, key or docker-ce was added"
  echo "# $step assertions passed (DOCKER_IO=1)"
  exit 0
fi

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
      cp "$script" "$work_real/refused-root.sh"
      [ "$(pexec "getent passwd $primary | cut -d: -f6")" = "/home/$primary" ] \
        || die "the refused script still changed the passwd entry"
      pexec "test -e /Users/$primary" && die "the refused script still created /Users/$primary"
      # …and the way out it names: a root console, where the user has no
      # processes of their own.
      if [ "$console_used" = 0 ]; then
        echo "# the harness now closes every session of $primary and re-runs from a root console"
        pexec "loginctl terminate-user $primary" >/dev/null 2>&1 || true
        pexec "pkill -u $primary" >/dev/null 2>&1 || true
        for _ in $(seq 1 20); do
          [ "$(pexec "pgrep -u $primary | wc -l")" = 0 ] && break
          pexec "pkill -9 -u $primary" >/dev/null 2>&1 || true
          sleep 0.5
        done
        [ "$(pexec "pgrep -u $primary | wc -l")" = 0 ] || die "could not close every session of $primary"
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
pass "home-path: a login shell's \`cd /home/$primary/x && pwd\` prints /Users/$primary/x"
[ "$(ssh_t17 "grep -cxF 'set -o physical' /Users/$primary/.bashrc")" = 1 ] \
  || die "the primary's .bashrc has no single \`set -o physical\` line"
pass "the physical-cd line is in the primary's .bashrc exactly once"

# The logged-in `usermod -d` refusal, with the evidence for both halves.
[ "$refused_logged" = 1 ] || die "the root script never refused while the user was logged in"
grep -q "usermod will not change a home directory" "$root_log" \
  || { cat "$root_log"; die "the refusal does not explain the usermod limit"; }
grep -q "usermod -d /Users/$primary $primary" "$root_log" \
  || { cat "$root_log"; die "the refusal does not print the one-liner to run by hand"; }
grep -q "no root section can" "$root_log" \
  || { cat "$root_log"; die "the refusal does not say the other root sections cannot run from ssh"; }
grep -q "NEEDS A ROOT CONSOLE ONCE" "$work_real/refused-root.sh" \
  || die "the root script header does not say a pending move needs a root console"
pass "home-path: logged in, the root script refuses and changes nothing; with every session closed it moves the home (root console)"

# T-16's home ACL probe, AFTER the move: the layout the agent-user tasks manage
# has to have moved with the directory, or that task stops settling.
ssh_t17 "getfacl -c -p /Users/$primary | grep -qx 'user:$agent:--x'" \
  || { ssh_t17 "getfacl -p /Users/$primary"; die "the moved home lost the agent traverse entry"; }
ssh_t17 "getfacl -c -p /Users/$primary/.claude | grep -qx 'user:$agent:--x'" \
  || { ssh_t17 "getfacl -p /Users/$primary/.claude"; die "the moved config dir lost the agent traverse entry"; }
[ "$(ssh_t17 "stat -c %U /Users/$primary/.claude/skills/root-owned.md")" = root ] \
  || die "the move changed the owner of a root-owned file (a rename must not)"
pass "home-path: T-16's home ACLs survived the move, and the foreign-owned file kept its owner"

# --------------------------------------------------------------------------
# T-17 follow-up (a): a readable root-owned file under skills/ is skipped with a
# warning, and the apply is not stopped by it.
# --------------------------------------------------------------------------
grep -h "not owned by $primary and are skipped" "$work_real"/setup-*.log | grep -q "root-owned.md" \
  || { grep -h "skipped" "$work_real"/setup-*.log || true; die 'no warning named the foreign-owned skills entry'; }
pass "T-16 follow-up (a): the root-owned file under skills/ is skipped with a warning, and setup still settled"
foreign_after="$(pexec "stat -c '%U %G %a' /home/$primary/.claude/skills/root-owned.md; getfacl -c -p /home/$primary/.claude/skills/root-owned.md | sort")"
if [ "$foreign_before" != "$foreign_after" ]; then
  diff <(printf '%s\n' "$foreign_before") <(printf '%s\n' "$foreign_after") || true
  die "the foreign-owned entry was modified"
fi
pass "T-16 follow-up (a): the foreign-owned entry keeps its owner, mode and ACLs"

# --------------------------------------------------------------------------
# Sessions hyper opens as the agent never take the operator's ssh-agent, even
# when the operator's ssh config forwards it for this host (finding 1).
# --------------------------------------------------------------------------
probe_out="$(run_probe 2>&1)" || { printf '%s\n' "$probe_out"; die "the as-agent probe failed"; }
printf '%s\n' "$probe_out" | grep -q "^primary 0 user=$primary sock=/" \
  || { printf '%s\n' "$probe_out"; die "the fixture does not forward the agent to the primary's session, so the next assertion would prove nothing"; }
printf '%s\n' "$probe_out" | grep -qx "agent 0 user=$agent sock=unset" \
  || { printf '%s\n' "$probe_out"; die "the session hyper opened as the agent received a forwarded ssh-agent"; }
pass "ssh: with ForwardAgent yes in the ssh config, the primary's session gets SSH_AUTH_SOCK and hyper's as-agent session does not"

# --------------------------------------------------------------------------
# docker-rootless
# --------------------------------------------------------------------------
as_agent_ssh "systemctl --user start docker" || die "the agent could not start its own daemon"
for _ in $(seq 1 30); do
  as_agent_ssh "docker version >/dev/null 2>&1" >/dev/null 2>&1 && break
  sleep 1
done
# The whole output: the greeting is near the TOP of hello-world's text. In a
# login shell, so the DOCKER_HOST line in .bashrc is what points at the daemon.
hello="$(as_agent_ssh "bash -lic 'docker run --rm hello-world' 2>&1" || true)"
printf '%s\n' "$hello" | grep -q "Hello from Docker!" \
  || { printf '%s\n' "$hello" | tail -20; die "hello-world did not run as the agent"; }
pass "docker-rootless: as the agent, \`docker run --rm hello-world\` succeeds after systemctl --user start docker"
[ "$(as_agent_ssh "systemctl --user is-enabled docker")" = "disabled" ] \
  || die "the unit is $(as_agent_ssh "systemctl --user is-enabled docker"), expected disabled"
pass "docker-rootless: the agent's docker unit is enabled=no (disabled)"
as_agent "id -nG" | grep -qw docker && die "the agent IS in the docker group"
as_agent_ssh "docker info --format '{{.Name}}'" >/dev/null 2>&1 \
  || die "docker info failed for the agent"
as_agent_ssh "test -w /var/run/docker.sock" >/dev/null 2>&1 && die "the agent can write the root-owned docker socket"
# "Cannot reach" is the claim, so it is tested by trying: the root socket, by
# name, from the agent. (The packages script disables the system-wide daemon
# docker-ce brings; a stale socket file may still exist, which is why this is
# not a `test -S`.)
as_agent_ssh "docker -H unix:///var/run/docker.sock version >/dev/null 2>&1" \
  && die "the agent reached a daemon through /var/run/docker.sock"
[ "$(pexec "systemctl is-active docker.service || true")" != active ] \
  || die "the system-wide Docker daemon is running"
pass "docker-rootless: the agent is not in the docker group and cannot reach /var/run/docker.sock"
# The DOCKER_HOST line, above a non-interactive guard.
[ "$(as_agent_ssh "head -1 ~/.bashrc | grep -c 'DOCKER_HOST=\"unix:///run/user/'" )" = 1 ] \
  || die "the DOCKER_HOST line is not the first line of the agent's .bashrc"
[ "$(as_agent_ssh "grep -c 'DOCKER_HOST=' ~/.bashrc")" = 1 ] \
  || die "the agent's .bashrc has the DOCKER_HOST line more than once"
pass "the agent's .bashrc points DOCKER_HOST at its own socket, once, on the first line"
as_agent_ssh "systemctl --user stop docker" || die "could not stop the agent's daemon"

# --------------------------------------------------------------------------
# A second full run is a no-op, and the machine is still settled (the kept
# container case T-16's canary restore used to break).
# --------------------------------------------------------------------------
run_hyper > "$work_real/setup-final.log" 2>&1 || { cat "$work_real/setup-final.log"; die 'the second full run failed'; }
grep -q "Nothing needed" "$work_real/setup-final.log" \
  || { cat "$work_real/setup-final.log"; die 'the second full run is not a no-op'; }
pass "a second full run is a no-op on the kept container"
# …and the root script is idempotent from here, from the new home.
ssh_t17 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1 || die "the root script is not idempotent"
run_hyper > "$work_real/setup-final2.log" 2>&1 \
  && grep -q "Nothing needed" "$work_real/setup-final2.log" \
  || { cat "$work_real/setup-final2.log"; die 'a second root script run changed the machine'; }
pass "running the root script twice more changes nothing (C-15)"

echo "# the container is removed by the trap"
echo "# $step assertions passed"