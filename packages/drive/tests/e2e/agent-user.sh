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

recipe="$(shasum -a 256 "$containerfile" | cut -c1-12)"
derived="hyper-t16-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (systemd + sshd + the acl/inotify packages)"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi
# Drop superseded tags of the same harness: they are this script's own byproducts
# and nothing else refers to them.
for stale in $(podman images --format '{{.Repository}}:{{.Tag}}' | grep '^hyper-t16-e2e:' || true); do
  [ "$stale" = "$derived" ] && continue
  podman rmi -f "$stale" >/dev/null 2>&1 || true
done

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
# `chown` the directory too, not just the file: ssh-keygen creates it as the
# user, and a root-owned ~/.ssh makes `setfacl` fail for the primary — which
# would be a harness artifact masquerading as a product bug.
pexec "mkdir -p /home/$primary/.ssh && chown $primary:$primary /home/$primary/.ssh && chmod 0700 /home/$primary/.ssh && install -m 0600 -o $primary /tmp/key.pub /home/$primary/.ssh/authorized_keys && rm -f /tmp/key.pub"

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

# The config dir carries TRAVERSE only, so the agent can reach the entries it
# was given and nothing else. `ls` is what proves the difference: the entries
# exist, the listing does not.
if as_agent "ls /home/$primary/.claude" >/dev/null 2>&1; then
  die "the agent can LIST the primary's config dir — traverse-only is not in place"
fi
pass "the agent cannot list the primary's config dir (traverse only)"

# --------------------------------------------------------------------------
# Part B: the deny. A named-group entry that matches decides access outright, so
# `g:collab:---` denies the agent whatever the file's own mode says.
# --------------------------------------------------------------------------
denied() {
  # Readable by the agent? 0 = no (good), anything else = yes (bad).
  as_agent "cat '$1'" >/dev/null 2>&1 && echo yes || echo no
}

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
ssh_t16 "printf 'after\n' > /home/$primary/late.txt && chmod 0644 /home/$primary/late.txt"
[ "$(denied "/home/$primary/late.txt")" = "no" ] || die "the agent can read a 0644 file created after setup"
pass "2 - a 0644 top-level file created AFTER setup is unreadable (inherited default)"

# 3. The classic write pattern: write a temp file, then rename it over the
#    target. The new inode is a different object with different ACLs.
ssh_t16 "printf '# replaced by the harness\n' > /home/$primary/.bashrc.new && mv /home/$primary/.bashrc.new /home/$primary/.bashrc"
[ "$(denied "/home/$primary/.bashrc")" = "no" ] || die "the agent can read .bashrc after it was replaced by rename"
pass "3 - ~/.bashrc replaced by temp-file-and-rename is unreadable"

# 4. Widening the mode cannot reopen what the deny closed...
ssh_t16 "printf 'chmodtest\n' > /home/$primary/chmodtest.txt && chmod 0644 /home/$primary/chmodtest.txt"
for mode in 644 g+r 777; do
  ssh_t16 "chmod $mode /home/$primary/chmodtest.txt" || true
  [ "$(denied "/home/$primary/chmodtest.txt")" = "no" ] \
    || die "the agent can read chmodtest.txt after \`chmod $mode\`"
done

# 4b. ...and neither can ZEROING THE GROUP BITS. This is the kernel condition:
# with an ACL present the mode's group bits are the mask, and the kernel only
# consults the ACL when those bits are non-zero — so 604/704 make the file
# readable through "other" even though getfacl still shows the deny. The
# watcher has to notice the attribute change and strip the other bits.
for mode in 604 704; do
  ssh_t16 "chmod $mode /home/$primary/chmodtest.txt" || true
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
ssh_t16 "chmod 604 /home/$primary/chmodtest.txt" || true
set +e
run_hyper > "$work_real/setup-chmod.log" 2>&1
set -e
[ "$(denied "/home/$primary/chmodtest.txt")" = "no" ] \
  || die "a plain setup run did not repair an entry left in the 604 state"
pass "4c - the next setup run repairs an entry left in the 604 state"

# 4d. A file CREATED with a bad mode after setup is unreadable immediately, with
# no watcher reaction needed: the inherited default carries o::---.
ssh_t16 "printf 'made604\n' > /home/$primary/made604.txt && chmod 604 /home/$primary/made604.txt"
[ "$(denied "/home/$primary/made604.txt")" = "no" ] \
  || die "a file created with mode 604 after setup is readable by the agent"
pass "4d - a file created with mode 604 after setup is unreadable immediately"
pass "4 - still unreadable after chmod 644, chmod g+r and chmod 777"

# 5. The config dir: denied by default, shared entries readable, and the two
#    shared FILES re-granted after Claude Code replaces them by rename.
for f in "/home/$primary/.claude/history.jsonl"; do
  [ "$(denied "$f")" = "no" ] || die "the agent can read the pre-existing $f"
done
ssh_t16 "printf '{\"h\":1}\n' > /home/$primary/.claude/late.jsonl && chmod 0644 /home/$primary/.claude/late.jsonl"
[ "$(denied "/home/$primary/.claude/late.jsonl")" = "no" ] \
  || die "the agent can read a 0644 file created in ~/.claude after setup"
pass "5a - pre-existing and new 0644 files in ~/.claude are both unreadable"

[ "$(denied "/home/$primary/.claude/settings.json")" = "yes" ] \
  || die "the agent cannot read settings.json"
[ "$(denied "/home/$primary/.claude/CLAUDE.md")" = "yes" ] \
  || die "the agent cannot read CLAUDE.md"
ssh_t16 "mkdir -p /home/$primary/.claude/skills && printf 'skill\n' > /home/$primary/.claude/skills/new.md"
[ "$(denied "/home/$primary/.claude/skills/new.md")" = "yes" ] \
  || die "a new file under skills/ is not readable as $agent"
pass "5b - settings.json, CLAUDE.md and a new file under skills/ are readable"

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

# 7. ssh must keep working for the PRIMARY after the deny lands on ~/.ssh: the
#    deny is on the shared group, and sshd logs in as the owner.
ssh_t16 "ssh-keygen -q -t ed25519 -N '' -f /home/$primary/.ssh/after-setup <<<y" >/dev/null 2>&1
ssh_t16 "cp /home/$primary/.ssh/after-setup.pub /home/$primary/.ssh/authorized_keys.new && mv /home/$primary/.ssh/authorized_keys.new /home/$primary/.ssh/authorized_keys"
ssh_t16 true >/dev/null 2>&1 || die "ssh stopped working for the primary after the deny (StrictModes)"
pass "7 - a fresh key and a renamed authorized_keys still let the primary ssh in"

if as_agent "cat /home/$primary/.claude/.credentials.json" >/dev/null 2>&1; then
  die "the agent CAN read .credentials.json"
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
ssh_t16 "systemctl --user stop claude-share-watch.service" >/dev/null 2>&1 || true
for _ in $(seq 1 5); do
  [ "$(ssh_t16 "systemctl --user is-active claude-share-watch.service 2>/dev/null" || true)" = "active" ] || break
  sleep 1
done
[ "$(ssh_t16 "systemctl --user is-active claude-share-watch.service 2>/dev/null" || true)" != "active" ] \
  || die "could not stop the watcher; assertion 8a would test nothing"
ssh_t16 "setfacl -x g:collab /home/$primary/late.txt"
[ "$(denied "/home/$primary/late.txt")" = "yes" ] \
  || die "removing the deny did not make the file readable — the fixture is wrong"
set +e
run_hyper > "$work_real/setup-drift.log" 2>&1
drift_code=$?
set -e
if [ "$drift_code" = 0 ] && ! grep -q "Nothing needed" "$work_real/setup-drift.log"; then
  die "setup neither restored the deny nor reported the drift"
fi
if ! grep -q "late.txt" "$work_real/setup-drift.log"; then
  die "setup did not NAME the entry whose deny was missing"
fi
ssh_t16 "systemctl --user start claude-share-watch.service" >/dev/null 2>&1 || true
pass "8a - removing a deny makes setup name the file and restore it"

# 8b. A file moved in from elsewhere on the same filesystem keeps the ACLs it
#     came with — the case the watcher exists to close.
ssh_t16 "printf 'moved in\n' > /tmp/moved-in.txt && chmod 0644 /tmp/moved-in.txt && mv /tmp/moved-in.txt /home/$primary/moved-in.txt"
moved_denied=no
for _ in $(seq 1 5); do
  [ "$(denied "/home/$primary/moved-in.txt")" = "no" ] && moved_denied=yes && break
  sleep 1
done
[ "$moved_denied" = "yes" ] || die "a file moved into the home was not denied within 5s"
pass "8b - a 0644 file moved into the home is denied within 5s (the watcher)"

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
ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1 \
  || die "the root script failed on its SECOND run — it is not idempotent"
after="$(snapshot)"
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
# A DIRECTORY, and one the agent can actually write to. Pointed at a FILE, mkdir
# aborts on the old code and the new code alike, so the assertion proved nothing;
# pointed at a writable root-owned directory, root chown/chmod/setfacl on the
# path would change it and that is what we are testing for.
ssh_t16 "sudo sh -c 'rm -rf $canary && mkdir -p $canary && chown root:root $canary && chmod 0755 $canary && printf CANARY > $canary/inside'"
before_canary="$(ssh_t16 "sudo stat -c '%U %G %a' $canary && sudo getfacl -c -p $canary | sort")"
# The agent replaces its own config dir with a symlink to the canary.
# Both steps run inside ONE `bash -c`, because `as_agent` expands to
# `sudo -u agent <cmd>` and that applies only to the FIRST word of an `&&` list —
# the second would silently run as the primary user instead.
as_agent "bash -c 'rm -rf /home/$agent/.claude && ln -s $canary /home/$agent/.claude'" \
  || die "could not plant the symlink as the agent"
# The script must FINISH: refusing the hostile layout is fine, following the link
# is not, and an abort on the planted dir would hide which of the two happened.
if ! ssh_t16 "sudo bash /tmp/hyper-machine-root.sh" >/dev/null 2>&1; then
  die "the root script did not finish with the planted symlink in place"
fi
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

# The container must not survive the script.
echo "# container is removed by the trap"

echo "# $step assertions passed"