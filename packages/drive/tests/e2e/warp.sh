#!/usr/bin/env bash
# e2e: `hyper warp <machine>`, against a disposable podman container.
#
# This is the acceptance for T-12. Unit tests drive a recording spawner; this
# drives REAL ssh, REAL rsync and a REAL `git push` so it can show that the
# right bytes actually move.
#
# Why a container, and not a second HOME on this Mac: warp copies to the SAME
# absolute path on the target, so proving a copy needs two filesystems that can
# hold the same path string with different contents. A temp dir on the same
# filesystem cannot do that — the "copy" would be invisible. The podman machine
# is a VM, so `/private/var/folders/.../homelab` exists on both sides with
# genuinely separate bytes, which is exactly the situation warp is for.
#
# It asserts:
#   1.  the harness itself: ssh and rsync reach the container (AC-10 precondition)
#   2.  AC-16  a parent that is not writable is refused BEFORE any copy, and
#              nothing arrives
#   3.  AC-13  a live session is refused with exit 2 naming its pid; --stop
#              proceeds
#   4.  AC-9   the target's transcript has the same line count and the same last
#              message
#   5.  AC-11  modified and untracked files arrive; node_modules does not
#   6.  AC-10  the plain-directory kind, then the plain-git-repo kind
#   7.  C-10   a foreign owner is refused without --force, and --force proceeds
#   8.         --dry-run leaves both trees byte-identical
#   9.  AC-12  `git ls-remote origin` of the project is unchanged by a warp
#  10.  the space-worktree kind: the clone happens only when the target is
#       missing the space, at the pinned path; the branch arrives through the
#       explicit ssh:// URL; the worktree is a working git worktree there
#       (`git status` shows the modified and untracked files); a re-warp moves
#       the branch checked out in that worktree
#  11.  AC-16 for a space present on the target (unwritable worktrees/) and for
#       a missing space (unwritable nearest ancestor): refused before --stop,
#       the marker, any copy, clone or push; nothing changed on either side
#  12.  a re-warp to the machine that owns the session is refused without
#       --force, and the target's newer transcript line and edit survive;
#       with --force only this session's files travel
#  13.  a partial copy (rsync 23) leaves a truthful message and the marker
#  14.  a cwd with a space is refused at planning, dry run and real run alike
#  15.  uncommitted work in the target's worktree or repo is refused without
#       --force (files and index intact); --force stashes a worktree's first
#  16.  a missing space that is not in the local manifest is refused first
#  and the Herdr argv shape (`-- --resume <id>`, pane id from the tab JSON).
#
# The fake `herdr` models Herdr: it records argv, answers `tab create` with the
# JSON shape Herdr prints, and starts the binary named by `--kind` with the
# words after `--` as its ARGUMENTS. It never runs those words as a command.
#
# WHAT THIS SCRIPT DOES NOT TEST: the real `hyper space clone` that runs ON THE
# TARGET. `hyper` on the far side is a stub that records its argv, insists on
# `--yes` and an explicit path, and creates the bare repo the push needs. That
# command's own behaviour is covered by T-8's tests (space-clone.test.ts). The
# real Herdr is not exercised either (never run against the operator's).
#
# Usage: packages/drive/tests/e2e/warp.sh
# Safety: the container is removed by a trap; the only ssh target is that
# container; HOME, CLAUDE_CONFIG_DIR, HYPER_HOME, HYPER_DRIVE_CONFIG and
# XDG_CONFIG_HOME are all throwaway; `herdr` and `claude` are FAKES recording
# argv, so no real session and no real agent is ever started or stopped. The
# only process this script signals is one it started itself.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# e2e -> tests -> drive -> packages, so the CLI is three levels up.
cli="$here/../../../cli/bin/run.js"
image="debian:13"
# Name and port are overridable so the suite runner (run.sh) can give each run
# a free port and a unique container name on a shared machine.
container="${WARP_E2E_CONTAINER:-hyper-t12}"
port="${WARP_E2E_PORT:-23322}"
primary="svallory"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

# shasum is a perl script (macOS ships it; minimal Linux may not) — fall back
# to coreutils sha256sum. Both print the same hex, so the recipe tag is stable.
sha12() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi | cut -c1-12; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

# Fixture commits must never consult the operator's global commit-signing
# agent (which may be absent and must not be called by a test). Per-process
# Git config beats global config without changing the user's files.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-warp.XXXXXX")"
# macOS: /tmp is a symlink to /private/tmp. Resolve, because the SAME resolved
# string has to be recreated inside the container and both sides compared.
work_real="$(cd "$work" && pwd -P)"
key="$work_real/id"
# The throwaway HOME. Its absolute path is reproduced inside the container, so
# every path warp computes on this side is valid on the target too.
home_local="$work_real/homelab"
# The SAME absolute path exists on both sides: here as the throwaway HOME, and
# inside the container (the entrypoint creates it there). Identical string,
# genuinely separate bytes — which is the situation warp exists for and the
# reason a second HOME on one filesystem would prove nothing.
mkdir -p "$home_local"

container_started=0
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    if [ "$container_started" = "1" ]; then
      echo "# KEEP=1 — container $container and $work_real left behind"
      echo "#   remove with: podman rm -f $container && rm -rf $work_real"
    else
      echo "# KEEP=1 — $work_real left behind (no container started)"
    fi
    return
  fi
  if [ "$container_started" = "1" ]; then
    echo "# tearing down $container"
    podman rm -f "$container" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_real"
}
trap cleanup EXIT

# --------------------------------------------------------------------------
# The image: sshd, rsync (local rsync drives a remote `rsync --server` over
# ssh) and git (the push target is a bare repo on the far side).
# --------------------------------------------------------------------------
echo "# podman version"
podman --version
containerfile="$work_real/Containerfile"
cat > "$containerfile" <<CONTAINERFILE
FROM $image
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\
      openssh-server rsync git ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
# No systemd here: warp does not need one. The entrypoint prepares the sshd
# runtime and execs it in the foreground, which is all this container does.
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CONTAINERFILE

cat > "$work_real/entrypoint.sh" <<'ENTRYPOINT'
#!/bin/sh
# The account's HOME is the SHARED path, not /home/<user>: sshd reads the home
# out of the passwd database, so a home created anywhere else would leave sshd
# looking for authorized_keys under a directory this harness never populates.
set -e
home_dir="$1"
useradd -d "$home_dir" -s /bin/bash svallory
mkdir -p "$home_dir"
# chown by USER only: this Debian image does not necessarily create a group of
# the same name, and the account primary group is what matters anyway.
chown -R svallory "$home_dir"
# Every component of the path must be traversable by the account.
d="$home_dir"
while [ "$d" != "/" ]; do chmod 0755 "$d" 2>/dev/null || true; d=$(dirname "$d"); done
# StrictModes is off for one reason: the shared path lives under a
# world-writable /tmp, which StrictModes would refuse. This container is
# disposable, reachable only on a mapped localhost port, and authenticates with
# a throwaway key that exists nowhere else — nothing here is worth protecting.
echo "StrictModes no" >> /etc/ssh/sshd_config
mkdir -p /run/sshd
ssh-keygen -A >/dev/null 2>&1 || true
exec /usr/sbin/sshd -D -e
ENTRYPOINT
chmod +x "$work_real/entrypoint.sh"

recipe="$(cat "$containerfile" "$work_real/entrypoint.sh" | sha12)"
derived="hyper-t12-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (sshd + rsync + git)"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi

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
# Never remove a container this invocation did not start, including a stale
# standalone default name. run.sh supplies a unique name per run.
if podman container exists "$container"; then
  die "container $container already exists; refusing to touch it"
fi
# The entrypoint takes the shared home path and does the user setup, because
# sshd is the container's main process and must be the LAST thing started.
podman run -d --name "$container" -p "$port":22 "$derived" "$home_local" >/dev/null \
  || die "could not start the container"
container_started=1
echo "# started $container on port $port (shared home $home_local)"

pexec() { podman exec "$container" sh -c "$1"; }

ssh-keygen -q -t ed25519 -N '' -f "$key" >/dev/null 2>&1 \
  || ssh-keygen -q -t ed25519 -N '' -f "$key"
podman cp "$key.pub" "$container:/tmp/key.pub"
pexec "mkdir -p '$home_local/.ssh' && chown $primary '$home_local/.ssh' && chmod 0700 '$home_local/.ssh' \
  && install -m 0600 -o $primary /tmp/key.pub '$home_local/.ssh/authorized_keys' && rm -f /tmp/key.pub"

for _ in $(seq 1 30); do
  pexec "test -s /etc/ssh/ssh_host_ed25519_key" >/dev/null 2>&1 && break
  sleep 1
done

# --------------------------------------------------------------------------
# The fakes. `herdr` on THIS side (warp shells out to it locally, and real
# herdr would reach the operator's live workspace). `claude` on the TARGET
# side, so we can prove the resume really landed over there.
# --------------------------------------------------------------------------
fakebin="$work_real/bin"
mkdir -p "$fakebin"

# --- fake herdr (local) -----------------------------------------------------
# `herdr --machine <name> ...` forwards over the machine's own ssh profile. Our
# fake does exactly that, with the REAL ssh, so the argv warp built is carried
# all the way to the target and recorded by the fake claude there.
#
# The heredoc is QUOTED, so nothing here is expanded while the file is written;
# the four values that must come from this run are substituted afterwards. An
# unquoted heredoc would expand this script's own $1/$2 at write time and the
# fake would arrive as a pile of "command not found".
cat > "$fakebin/herdr" <<'HERDR'
#!/bin/sh
# Models the parts of Herdr warp uses, as the lead's live Herdr behaves:
#   herdr --machine <m> tab create [--cwd P] [--label L] [--no-focus]
#       prints {"result":{"tab":{...},"root_pane":{"pane_id":...}}}
#   herdr --machine <m> agent start <name> --kind <kind> --pane <id> -- <args>
#       starts the agent binary named by --kind with <args> as its ARGUMENTS.
# What follows `--` is NEVER run as a command: `-- claude --resume x` would
# start `claude claude --resume x`, which is the bug this fake must expose.
log="%WORK%/herdr-argv.log"
printf '%s\n' "$*" >> "$log"
pane="w9:p3"

while [ $# -gt 0 ]; do
  case "$1" in
    --machine) shift 2 ;;
    --machine=*) shift ;;
    *) break ;;
  esac
done

case "$1 $2" in
  "machine list")
    echo '[{"label": "t12", "target": "%PRIMARY%@localhost:%PORT%", "enabled": true}]'
    exit 0 ;;
  "pane list")
    exit ${WARP_E2E_HERDR_DOWN:-0} ;;
  "tab create")
    printf '{"result":{"tab":{"tab_id":"w9:t3","label":"x"},"root_pane":{"pane_id":"%s","tab_id":"w9:t3"}}}\n' "$pane"
    exit 0 ;;
esac

if [ "$1" = "agent" ] && [ "$2" = "start" ]; then
  shift 2
  name="$1"; shift
  case "$name" in
    [a-z]*) ;;
    *) echo "herdr: invalid agent name: $name" >&2; exit 2 ;;
  esac
  printf '%s' "$name" | grep -Eq '^[a-z][a-z0-9_-]*$' \
    || { echo "herdr: invalid agent name: $name" >&2; exit 2; }
  kind=""; got_pane=""
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    case "$1" in
      --kind) kind="$2"; shift 2 ;;
      --pane) got_pane="$2"; shift 2 ;;
      --timeout) shift 2 ;;
      *) echo "herdr: unexpected argument $1" >&2; exit 2 ;;
    esac
  done
  [ -n "$kind" ] || { echo "herdr: --kind is required" >&2; exit 2; }
  [ "$got_pane" = "$pane" ] || { echo "herdr: no pane $got_pane" >&2; exit 2; }
  [ "${1:-}" = "--" ] && shift
  # Start the KIND's binary on the target with the remaining words as its
  # arguments: exactly one `claude`, whatever the caller sent.
  exec /usr/bin/ssh -i "%KEY%" -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
      -p %PORT% %PRIMARY%@localhost "$kind" "$@"
fi

exit 0
HERDR
# BSD sed (macOS) uses `-i ''`; GNU sed (Linux) treats that empty argument
# as a filename. Render to a sibling temp file then rename on both platforms.
render_in_place() {
  local file="$1"; shift
  sed "$@" "$file" > "$file.rendered"
  mv "$file.rendered" "$file"
}
render_in_place "$fakebin/herdr" \
  -e "s|%WORK%|$work_real|g" \
  -e "s|%KEY%|$key|g" \
  -e "s|%PORT%|$port|g" \
  -e "s|%PRIMARY%|$primary|g"
chmod +x "$fakebin/herdr"

# --- fake claude (target side, /usr/local/bin is on a non-login ssh PATH) ---
# The argv is recorded ON THE TARGET, at the same absolute path this script
# reads afterwards. That is what proves the resume reached the far side rather
# than merely being built here.
cat > "$work_real/claude" <<'CLAUDE'
#!/bin/sh
printf '%s\n' "$*" >> "%HOMEDIR%/claude-argv.log"
exit 0
CLAUDE
# The log goes INSIDE the shared home, which the target user owns; the harness
# work dir is root-owned in the container and the fake would get EACCES.
render_in_place "$work_real/claude" -e "s|%HOMEDIR%|$home_local|g"
podman cp "$work_real/claude" "$container:/usr/local/bin/claude"
pexec "chmod 0755 /usr/local/bin/claude"

# --- fake hyper (target side) ------------------------------------------------
# Records the argv warp chose to run on the far side, and — because the step
# that follows the clone is a `git push` into a bare repo that will not exist
# unless something creates it — lays down the minimal space shape the push
# needs. It creates NO code: the point is to observe the DECISION, not to
# reimplement T-8's clone.
cat > "$work_real/hyper" <<'HYPERSTUB'
#!/bin/sh
printf '%s\n' "$*" >> "%HOMEDIR%/hyper-argv.log"
if [ "$1" = "space" ] && [ "$2" = "clone" ]; then
  shift 2
  yes=""
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    case "$1" in --yes) yes=1; shift ;; *) echo "stub: unexpected $1" >&2; exit 2 ;; esac
  done
  [ "${1:-}" = "--" ] && shift
  name="$1"; root="$2"
  # The real clone takes `<name> [path]` and, with a path, puts the space
  # exactly there. Without one it would remap the manifest's path, which
  # warp must never rely on: refuse, so the e2e fails if warp stops pinning.
  [ -n "$name" ] && [ -n "$root" ] || { echo "stub: warp did not pin the path" >&2; exit 3; }
  [ -n "$yes" ] || { echo "stub: --yes missing (no tty here)" >&2; exit 4; }
  mkdir -p "$root/worktrees"
  git init -q --bare "$root/.git"
  exit 0
fi
exit 0
HYPERSTUB
render_in_place "$work_real/hyper" -e "s|%HOMEDIR%|$home_local|g"
podman cp "$work_real/hyper" "$container:/usr/local/bin/hyper"
pexec "chmod 0755 /usr/local/bin/hyper"

# --- ssh wrapper (local) ----------------------------------------------------
# RemoteMachine spawns the ssh found on PATH. Ours carries the throwaway key;
# every argument, including the `-p` the port support adds, is passed through.
cat > "$fakebin/ssh" <<WRAPPER
#!/bin/sh
exec /usr/bin/ssh -i "$key" -o StrictHostKeyChecking=no \\
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "\$@"
WRAPPER
chmod +x "$fakebin/ssh"

ssh_t12() {
  /usr/bin/ssh -F /dev/null -i "$key" -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 \
    -p "$port" "$primary@localhost" "$@"
}

for _ in $(seq 1 40); do
  ssh_t12 true >/dev/null 2>&1 && break
  sleep 1
done
ssh_t12 true >/dev/null 2>&1 || die "could not ssh into the container as $primary"

# bun wants a ~/.bun; point it at the real one rather than re-resolving.
[ -d "$HOME/.bun" ] && ln -sfn "$HOME/.bun" "$home_local/.bun" || true
export LC_ALL=C LANG=C NO_COLOR=1

# --------------------------------------------------------------------------
# hyper's view of the machine
# --------------------------------------------------------------------------
mkdir -p "$work_real/hyper-home" "$work_real/xdg-empty"
# A local hyperdrive checkout whose manifest lists the spaces this script
# warps while they are missing on the target: warp checks that locally (no
# fetch) before it lets the target clone. research3 is deliberately absent.
mkdir -p "$work_real/hyper-home/drive/.git"
{
  echo "spaces:"
  for name in research research2; do
    printf '  - name: %s\n    group: null\n    branch: %s\n    path: /x/%s\n    layout: bare\n    repos: []\n    cadence: ""\n    tracked: []\n    public: []\n' "$name" "$name" "$name"
  done
} > "$work_real/hyper-home/drive/spaces.yaml"
cat > "$work_real/drive.toml" <<TOML
remote = "git@example.invalid:hyperdrive.git"

[self]
name = "mac"
home = "$home_local"

[machines.t12]
home = "$home_local"
TOML

run_hyper() {
  ( cd "$1" && shift && PATH="$fakebin:$PATH" HYPER_DRIVE_CONFIG="$work_real/drive.toml" \
      HOME="$home_local" CLAUDE_CONFIG_DIR="$home_local/.claude" \
      HYPER_HOME="$work_real/hyper-home" XDG_CONFIG_HOME="$work_real/xdg-empty" \
      bun "$cli" "$@" )
}

# The tree hash used by the --dry-run assertion: a stable fingerprint of every
# path and every byte under a root, with no dependency beyond coreutils.
#
# `Library/Caches` is excluded, and only for one reason: on macOS `bun` keeps a
# wasmtime JIT cache there and rewrites it on every run, so it changes under any
# command at all — including a --dry-run that correctly touches nothing. Hashing
# it would make the assertion measure bun, not warp.
tree_hash() {
  find "$1" -type f -not -path "*/Library/Caches/*" -print0 2>/dev/null \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -d' ' -f1
}

echo "# ---------------------------------------------------------------"
echo "# 1. the harness: real ssh and real rsync reach the container"
echo "# ---------------------------------------------------------------"
# Directories the TARGET must be able to write into are created as the target
# user: `podman exec` is root, and a root-owned directory would make the very
# transfer we are testing fail with a permissions error of our own making.
# -R because `mkdir -p` also creates the intermediates as root; chowning only
# the leaf would leave a root-owned `.claude` above a user-owned project folder.
target_mkdir() { pexec "mkdir -p '$1' && chown -R $primary '$1'"; }
target_mkdir "$home_local/harness"
printf 'from the target\n' > /tmp/warp-harness-src.txt
ssh_t12 "cat > '$home_local/harness/from-ssh.txt'" < /tmp/warp-harness-src.txt
[ "$(ssh_t12 "cat '$home_local/harness/from-ssh.txt'")" = "from the target" ] \
  || die "ssh write/read round trip failed"
pass "ssh reaches the container at the shared absolute path"

mkdir -p "$work_real/rsync-src"
printf 'payload\n' > "$work_real/rsync-src/file.txt"
# `--` ends the OPTIONS, so it has to come after -e; everything after it is a path.
PATH="$fakebin:$PATH" rsync -a \
  -e "ssh -i $key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p $port" \
  -- "$work_real/rsync-src/" "$primary@localhost:$home_local/harness/copied/" \
  || die "rsync to the container failed"
[ "$(ssh_t12 "cat '$home_local/harness/copied/file.txt'")" = "payload" ] \
  || die "rsync did not deliver the bytes"
pass "rsync delivers bytes into the shared absolute path (port $port, through remote.ts's -e 'ssh -p')"

echo "# ---------------------------------------------------------------"
echo "# fixtures"
echo "# ---------------------------------------------------------------"
SESSION="3d9c77a6-6975-4381-b884-214b3ca452d8"
LASTMSG="the last thing I said before the warp"

# Claude Code names a project folder after its cwd with every non-alphanumeric
# character replaced by "-", so the transcript for a cwd lands at a path derived
# from that cwd. The folder must exist on BOTH sides for a warp to have anywhere
# to write.
enc_for() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }

# Give `dir` one session: a transcript here, and an empty project folder there.
make_session() {
  local dir="$1" enc folder
  enc="$(enc_for "$dir")"
  folder="$home_local/.claude/projects/$enc"
  mkdir -p "$folder"
  printf '{"type":"user","cwd":"%s","message":{"role":"user","content":"first"}}\n' "$dir" \
    > "$folder/$SESSION.jsonl"
  printf '{"type":"assistant","cwd":"%s","message":{"id":"m1","content":[{"type":"text","text":"%s"}]}}\n' "$dir" "$LASTMSG" \
    >> "$folder/$SESSION.jsonl"
  target_mkdir "$folder"
  printf '%s' "$folder"
}

proj="$home_local/work/proj"
mkdir -p "$proj/node_modules/pkg"
printf 'should not travel\n' > "$proj/node_modules/pkg/index.js"
printf 'original\n' > "$proj/tracked.txt"
printf 'new file, untracked\n' > "$proj/untracked.txt"
target_mkdir "$home_local/work/proj"
folder="$(make_session "$proj")"

# The parent of cwd has to exist and be writable on the target, or AC-16 would
# refuse every warp in this script before reaching its own assertion.
target_mkdir "$home_local/work"
pass "fixture built (project $(enc_for "$proj"), session $SESSION)"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 2. AC-16 — an unwritable parent is refused BEFORE any copy"
echo "# ---------------------------------------------------------------"
locked="$home_local/locked"
mkdir -p "$locked/proj"
target_mkdir "$locked/proj"
make_session "$locked/proj" >/dev/null
# Root-level setup goes through `pexec`: `ssh_t12` logs in as the target USER,
# which cannot chown. 0500 leaves the directory unwritable by that user, which
# is exactly the AC-16 condition.
pexec "chown -R $primary '$locked' && chmod 0500 '$locked'"
set +e
out="$(run_hyper "$locked/proj" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "expected exit 2 for an unwritable parent, got $code: $out"
printf '%s' "$out" | grep -q "writable" || die "refusal did not mention the parent: $out"
[ -z "$(ssh_t12 "ls -A '$locked/proj'")" ] || die "something was copied into a refused warp"
pass "AC-16 unwritable parent refused with exit 2, nothing copied"
# Leave the dir usable again for the rest of the script.
pexec "chmod 0755 '$locked'"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 3. AC-13 — a live session is refused with its pid; --stop proceeds"
echo "# --------------------------------------------------------------"
# A process THIS SCRIPT started, so the only pid warp is ever allowed to signal
# is one we own. Registered the way Claude Code registers itself.
sleep 300 &
live_pid=$!
mkdir -p "$home_local/.claude/sessions"
# `ps -o lstart=` pads on the RIGHT on macOS, and stopSession compares the
# TRIMMED value — so this must be trimmed at both ends too, or every --stop
# would report a mismatched pid and signal nothing.
proc_start="$(LC_ALL=C TZ=UTC ps -o lstart= -p "$live_pid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
cat > "$home_local/.claude/sessions/$live_pid.json" <<SESSIONJSON
{"pid":$live_pid,"cwd":"$proj","sessionId":"$SESSION","startedAt":$(date +%s000),
 "procStart":$(printf '%s' "$proc_start" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
 "version":"2.1.288","entrypoint":"cli"}
SESSIONJSON

set +e
out="$(run_hyper "$proj" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "expected exit 2 for a live session, got $code: $out"
printf '%s' "$out" | grep -q "$live_pid" || die "refusal did not name the pid $live_pid: $out"
pass "AC-13 a live session is refused with exit 2 naming pid $live_pid"

# --stop now, and let it run the rest of the way.
: > "$work_real/herdr-argv.log"
ssh_t12 "rm -f '$home_local/claude-argv.log'"
set +e
out="$(run_hyper "$proj" warp t12 --stop 2>&1)"; code=$?
set -e
[ "$code" = 0 ] || die "--stop did not proceed: exit $code: $out"
kill -0 "$live_pid" 2>/dev/null && { kill -9 "$live_pid" 2>/dev/null || true; die "--stop left the session running"; }
pass "AC-13 --stop proceeds and stops the live session"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 4. AC-9 — the transcript arrives intact"
echo "# ---------------------------------------------------------------"
remote_lines="$(ssh_t12 "wc -l < '$folder/$SESSION.jsonl' | tr -d ' '")"
local_lines="$(wc -l < "$folder/$SESSION.jsonl" | tr -d ' ')"
[ "$remote_lines" = "$local_lines" ] || die "line count differs: local $local_lines, target $remote_lines"
ssh_t12 "cat '$folder/$SESSION.jsonl'" | grep -q "$LASTMSG" \
  || die "the last message did not reach the target"
pass "AC-9 transcript has $remote_lines lines on the target and the same last message"

# The ownership marker travelled with it.
owner="$(ssh_t12 "cat '$folder/$SESSION.warp.json'" | python3 -c 'import json,sys; print(json.load(sys.stdin)["owner"])')"
[ "$owner" = "t12" ] || die "ownership marker says $owner, expected t12"
pass "ownership marker reached the target naming t12"

# The resume really ran on the TARGET: the fake claude there recorded it.
# EXACT line: the fake Herdr starts the kind's binary with the words after
# `--` as its arguments, so `-- claude --resume x` would record
# "claude --resume x" here (claude started as `claude claude --resume x`).
claude_argv="$(ssh_t12 "cat '$home_local/claude-argv.log'")"
[ "$claude_argv" = "--resume $SESSION" ] \
  || die "claude on the target got the wrong arguments: '$claude_argv' (want '--resume $SESSION')"
pass "claude was resumed on the target through Herdr with exactly: $claude_argv"

# The Herdr argv shape: a tab with no focus at the cwd, then agent start with
# a lowercase name, --kind claude, the pane id from the tab's JSON, and only
# claude's ARGUMENTS after `--`.
grep -Eq "^--machine t12 tab create --cwd $proj --label warp-3d9c77a6-[a-z0-9]+ --no-focus\$" "$work_real/herdr-argv.log" \
  || die "tab create argv is not what Herdr takes: $(cat "$work_real/herdr-argv.log")"
grep -Eq "^--machine t12 agent start warp-3d9c77a6-[a-z0-9]+ --kind claude --pane w9:p3 -- --resume $SESSION\$" "$work_real/herdr-argv.log" \
  || die "agent start argv is not what Herdr takes: $(cat "$work_real/herdr-argv.log")"
pass "Herdr argv: tab create --cwd … --no-focus, then agent start <lowercase name> --kind claude --pane w9:p3 -- --resume <id>"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 5. AC-11 — what travelled and what did not"
echo "# ---------------------------------------------------------------"
[ "$(ssh_t12 "cat '$proj/untracked.txt'")" = "new file, untracked" ] || die "untracked file did not arrive"
[ "$(ssh_t12 "cat '$proj/tracked.txt'")" = "original" ] || die "tracked file did not arrive"
ssh_t12 "test -e '$proj/node_modules'" && die "node_modules was copied despite the exclusion list"
pass "AC-11 tracked and untracked files arrived; node_modules stayed behind"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 6. AC-10 — the plain-git-repo kind"
echo "# ---------------------------------------------------------------"
repo="$home_local/work/repo"
mkdir -p "$repo"
git -C "$repo" init -q
printf 'hello\n' > "$repo/a.txt"
git -C "$repo" add -A
git -C "$repo" -c user.email=t@e -c user.name=t commit -qm init
# A "hosting" remote warp must never touch (AC-12).
git init -q --bare "$work_real/fake-origin.git"
git -C "$repo" remote add origin "$work_real/fake-origin.git"
# Give the hosting remote a real branch, so "ls-remote is unchanged" is a
# meaningful claim: an EMPTY ls-remote would be unchanged by anything at all,
# including a warp that pushed everything it had.
git -C "$repo" push -q origin HEAD:refs/heads/main
before_origin="$(git -C "$repo" ls-remote origin)"
[ -n "$before_origin" ] || die "the fake hosting remote is empty; AC-12 would prove nothing"

# A session for the repo's own project folder, so warp picks a session there.
repo_enc="$(printf '%s' "$repo" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$home_local/.claude/projects/$repo_enc"
printf '{"type":"user","cwd":"%s","message":{"role":"user","content":"repo"}}\n' "$repo" \
  > "$home_local/.claude/projects/$repo_enc/$SESSION.jsonl"
target_mkdir "$home_local/.claude/projects/$repo_enc"
target_mkdir "$repo"

run_hyper "$repo" warp t12 >/dev/null \
  || die "warping a plain git repo failed"
[ "$(ssh_t12 "cat '$repo/a.txt'")" = "hello" ] || die "the git repo's files did not arrive"
pass "AC-10 a plain git repository copies across, .git included"

after_origin="$(git -C "$repo" ls-remote origin)"
[ "$before_origin" = "$after_origin" ] || die "AC-12: warp changed the hosting remote"
pass "AC-12 git ls-remote origin still reports $(printf '%s' "$after_origin" | wc -l | tr -d ' ') ref(s) exactly as before the warp"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 7. C-10 — a foreign owner is refused without --force"
echo "# ------------------------------------------------------------------------"
proj2="$home_local/work/proj2"
mkdir -p "$proj2"
enc2="$(printf '%s' "$proj2" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$home_local/.claude/projects/$enc2"
printf '{"type":"user","cwd":"%s","message":{"role":"user","content":"x"}}\n' "$proj2" \
  > "$home_local/.claude/projects/$enc2/$SESSION.jsonl"
printf '{"owner":"someone-else","at":"2026-01-01T00:00:00.000Z"}\n' \
  > "$home_local/.claude/projects/$enc2/$SESSION.warp.json"
target_mkdir "$home_local/.claude/projects/$enc2"

set +e
out="$(run_hyper "$proj2" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "expected exit 2 for a foreign owner, got $code: $out"
printf '%s' "$out" | grep -q "someone-else" || die "refusal did not name the owner: $out"
owner_now="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["owner"])' "$home_local/.claude/projects/$enc2/$SESSION.warp.json")"
[ "$owner_now" = "someone-else" ] || die "--force was not given but the owner changed"
pass "C-10 a foreign owner is refused and the marker is untouched"

run_hyper "$proj2" warp t12 --force >/dev/null || die "--force did not proceed"
owner_now="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["owner"])' "$home_local/.claude/projects/$enc2/$SESSION.warp.json")"
[ "$owner_now" = "t12" ] || die "--force did not rewrite the owner (still $owner_now)"
pass "C-10 --force proceeds and rewrites the owner to t12"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 8. --dry-run changes neither side"
echo "# ------------------------------------------------------------------------"
proj3="$home_local/work/proj3"
mkdir -p "$proj3/node_modules"
printf 'to be excluded\n' > "$proj3/node_modules/x.js"
printf 'untouched\n' > "$proj3/keep.txt"
enc3="$(printf '%s' "$proj3" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$home_local/.claude/projects/$enc3"
printf '{"type":"user","cwd":"%s","message":{"role":"user","content":"dry"}}\n' "$proj3" \
  > "$home_local/.claude/projects/$enc3/$SESSION.jsonl"
target_mkdir "$home_local/.claude/projects/$enc3"
target_mkdir "$proj3"

find "$home_local" -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 > "$work_real/h-before.txt"
before_local="$(tree_hash "$home_local")"
before_remote="$(ssh_t12 "find '$home_local' -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1")"
run_hyper "$proj3" warp t12 --dry-run > "$work_real/dry-run.txt" || die "--dry-run failed"
after_local="$(tree_hash "$home_local")"
after_remote="$(ssh_t12 "find '$home_local' -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1")"
[ "$before_local" = "$after_local" ] || die "--dry-run changed this machine ($before_local -> $after_local)"
[ "$before_remote" = "$after_remote" ] || die "--dry-run changed the target"
pass "--dry-run left both trees byte-identical (local $after_local, target $after_remote)"

# The dry run really did print the plan, not just succeed quietly.
grep -q "test -d " "$work_real/dry-run.txt" || die "--dry-run did not print the remote checks"
grep -q -- "--exclude=node_modules" "$work_real/dry-run.txt" || die "--dry-run did not print the exclusions"
pass "--dry-run printed the remote commands and the exclusions"

# --------------------------------------------------------------------------
echo "# ---------------------------------------------------------------"
echo "# 9. the space-worktree kind"
echo "# ---------------------------------------------------------------"
# A bare space is `git init --bare .git` beside a `worktrees/` directory, and
# the worktree is a linked checkout whose `.git` is a FILE pointing at that
# bare repo — which is exactly how space_layout tells a worktree from a root.
space_name="research"
space="$home_local/work/spaces/$space_name"
branch="feat-warp"
mkdir -p "$space/worktrees"
git init -q --bare "$space/.git"
git --git-dir="$space/.git" worktree add -q "$space/worktrees/$branch" -b "$branch" 2>/dev/null \
  || die "could not create a linked worktree (git too old for worktree add -b on an empty bare repo)"
printf 'worktree file\n' > "$space/worktrees/$branch/code.txt"
printf 'tracked, unchanged\n' > "$space/worktrees/$branch/stable.txt"
mkdir -p "$space/worktrees/$branch/node_modules"
printf 'excluded\n' > "$space/worktrees/$branch/node_modules/dep.js"
# Commit INSIDE the worktree, not against the bare git dir with a --work-tree:
# `worktree add -b` leaves the new branch UNBORN, and `rev-parse --abbrev-ref
# HEAD` fails on an unborn branch — which is exactly the call warp uses to learn
# which branch to push, so a fixture that skipped it would prove nothing.
git -C "$space/worktrees/$branch" add -A
git -C "$space/worktrees/$branch" -c user.email=t@e -c user.name=t commit -qm "work in progress"
[ -n "$(git --git-dir="$space/.git" rev-parse "refs/heads/$branch" 2>/dev/null)" ] \
  || die "the fixture branch has no commit, so warp would have no branch to push"
# The worktree is a `.git` FILE, not a directory: assert it, because a
# directory here would make this an ordinary repo and the space path untested.
[ -f "$space/worktrees/$branch/.git" ] || die "the fixture is not a linked worktree"
# Uncommitted work, which is what warp is for: a modified tracked file and an
# untracked one. Both must show up in `git status` on the target.
printf 'worktree file, modified\n' > "$space/worktrees/$branch/code.txt"
printf 'untracked in the worktree\n' > "$space/worktrees/$branch/untracked-wt.txt"

wt="$space/worktrees/$branch"
make_session "$wt" >/dev/null
# Deliberately NOT created on the target: the space is supposed to be MISSING
# there, and pre-creating even the worktree directory would make the space root
# exist — the probe would then (correctly) say "already there", skip the clone,
# and leave the push with no bare repo to push into.

# The stub needs no map: warp passes the space root explicitly
# (`hyper space clone --yes -- <name> <root>`), and the stub refuses a call
# without it.

# A hosting remote for the PROJECT, which a warp must never touch.
git init -q --bare "$work_real/space-origin.git"
# The space's own bare repo needs an `origin` too, so AC-12 has something to
# be unchanged about.
git --git-dir="$space/.git" remote add origin "$work_real/space-origin.git"
space_origin_before="$(git --git-dir="$space/.git" ls-remote origin)"

# --- case A: the space is MISSING on the target ----------------------------
ssh_t12 "rm -f '$home_local/hyper-argv.log'"
set +e
out="$(run_hyper "$wt" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 0 ] || die "warping a space worktree (missing on target) failed: exit $code: $out"
stub_argv="$(ssh_t12 "cat '$home_local/hyper-argv.log'" 2>/dev/null || true)"
[ "$stub_argv" = "space clone --yes -- $space_name $space" ] \
  || die "the target's hyper was not asked to clone the space at its pinned path; got: ${stub_argv:-<nothing>}"
pass "a space missing on the target is cloned there at its pinned path, with --yes (stub saw: $stub_argv)"

# The push landed in the TARGET's bare repo, through the explicit ssh:// URL.
ssh_t12 "git --git-dir='$space/.git' rev-parse --verify 'refs/heads/$branch'" >/dev/null 2>&1 \
  || die "branch $branch did not arrive in the target's bare repo"
remote_sha="$(ssh_t12 "git --git-dir='$space/.git' rev-parse 'refs/heads/$branch'")"
local_sha="$(git --git-dir="$space/.git" rev-parse "refs/heads/$branch")"
[ "$remote_sha" = "$local_sha" ] || die "target has $remote_sha, this machine has $local_sha"
pass "the worktree branch arrived in the target's bare repo ($remote_sha)"

# The worktree's files arrived, and its excluded ones did not.
[ "$(ssh_t12 "cat '$wt/code.txt'")" = "worktree file, modified" ] || die "worktree files did not arrive (or arrived unmodified)"
[ "$(ssh_t12 "cat '$wt/untracked-wt.txt'")" = "untracked in the worktree" ] || die "the untracked worktree file did not arrive"
ssh_t12 "test -e '$wt/node_modules'" && die "node_modules was copied despite the exclusion list"
pass "space-worktree files arrived with the exclusions applied"

# Blocker 3: the warped worktree is a WORKING git worktree on the target.
status_target="$(ssh_t12 "git -C '$wt' status --porcelain" 2>&1)" \
  || die "git status fails in the warped worktree on the target: $status_target"
printf '%s\n' "$status_target" | grep -qx ' M code.txt' \
  || die "git status on the target does not show code.txt modified: $status_target"
printf '%s\n' "$status_target" | grep -qx '?? untracked-wt.txt' \
  || die "git status on the target does not show untracked-wt.txt: $status_target"
printf '%s\n' "$status_target" | grep -q 'stable.txt' \
  && die "git status on the target reports an unchanged file: $status_target"
[ "$(ssh_t12 "git -C '$wt' rev-parse --abbrev-ref HEAD")" = "$branch" ] \
  || die "the target worktree is not on $branch"
pass "git status works in the warped worktree on the target and shows ' M code.txt' and '?? untracked-wt.txt' (on $branch)"

# --- case B: the space is ALREADY there ------------------------------------
# cd26ebb9's fix: the clone is conditional on the probe, not eager. With the
# space present, `hyper` on the target must NOT be called at all.
ssh_t12 "rm -f '$home_local/hyper-argv.log'"
printf 'second run\n' > "$wt/second.txt"
# A NEW commit, so the push really has to move a branch that is checked out in
# the target's registered worktree (receive-pack refuses that by default).
printf 'committed between warps\n' > "$wt/between.txt"
git -C "$wt" add between.txt
git -C "$wt" -c user.email=t@e -c user.name=t commit -qm "between warps"
# The marker names t12 after case A, so this re-warp needs --force (blocker 2).
set +e
out="$(run_hyper "$wt" warp t12 --force 2>&1)"; code=$?
set -e
[ "$code" = 0 ] || die "warping a space worktree (present on target) failed: exit $code: $out"
stub_argv="$(ssh_t12 "cat '$home_local/hyper-argv.log'" 2>/dev/null || true)"
[ -z "$stub_argv" ] || die "hyper was called on the target even though the space was there: $stub_argv"
pass "with the space already on the target, hyper is NOT called (nothing in its argv log)"

[ "$(ssh_t12 "cat '$wt/second.txt'")" = "second run" ] || die "the second run copied nothing"
pass "the conditional warp still copied the new worktree file"

[ "$(ssh_t12 "git --git-dir='$space/.git' rev-parse 'refs/heads/$branch'")" = "$(git -C "$wt" rev-parse HEAD)" ] \
  || die "the re-warp did not move the checked-out branch on the target"
status_target="$(ssh_t12 "git -C '$wt' status --porcelain" 2>&1)" || die "git status fails after the re-warp: $status_target"
printf '%s\n' "$status_target" | grep -q 'between.txt' \
  && die "the target's index was not reset to the new commit: $status_target"
pass "a re-warp moved the branch checked out in the target's worktree, and its index follows HEAD"

# AC-12 on the project's own hosting remote.
space_origin_after="$(git --git-dir="$space/.git" ls-remote origin)"
[ "$space_origin_before" = "$space_origin_after" ] \
  || die "AC-12: a warp changed the project's hosting remote"
pass "AC-12 the project's git ls-remote origin is unchanged by the space-worktree warp"

# --------------------------------------------------------------------------
# oclif wraps an error at ~80 columns behind a " ›   " gutter, splitting
# paths and sentences anywhere. Undo that before grepping a long phrase.
flat() { printf '%s\n' "$1" | LC_ALL=C sed -e 's/^ › \{3\}//' | tr -d '\n'; }

# Helpers for the "nothing changed" cases.
# A live session THIS script starts, registered the way Claude Code does, so
# the refusal can be shown to happen before `--stop` signals it.
start_live() {
  local cwd_for="$1"
  sleep 300 &
  live_pid=$!
  local proc_start
  proc_start="$(LC_ALL=C TZ=UTC ps -o lstart= -p "$live_pid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  cat > "$home_local/.claude/sessions/$live_pid.json" <<SESSIONJSON
{"pid":$live_pid,"cwd":"$cwd_for","sessionId":"$SESSION","startedAt":$(date +%s000),
 "procStart":$(printf '%s' "$proc_start" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
 "version":"2.1.288","entrypoint":"cli"}
SESSIONJSON
}
stop_live() { kill -9 "$live_pid" 2>/dev/null || true; wait "$live_pid" 2>/dev/null || true; rm -f "$home_local/.claude/sessions/$live_pid.json"; }

# Make a linked worktree of `$1` (a space) on branch `$2`, with a commit.
make_worktree() {
  local sp="$1" br="$2" base="${3:-}"
  if [ -n "$base" ]; then
    git --git-dir="$sp/.git" worktree add -q "$sp/worktrees/$br" -b "$br" "$base"
  else
    git --git-dir="$sp/.git" worktree add -q "$sp/worktrees/$br" -b "$br" 2>/dev/null
  fi
  printf '%s\n' "$br" > "$sp/worktrees/$br/$br.txt"
  git -C "$sp/worktrees/$br" add -A
  git -C "$sp/worktrees/$br" -c user.email=t@e -c user.name=t commit -qm "$br"
}

echo "# ---------------------------------------------------------------"
echo "# 10. AC-16 for a space ON the target: unwritable worktrees/, refused first"
echo "# ---------------------------------------------------------------"
# Blocker 1 as the review reproduced it: the space is already on the target
# and its worktrees/ dir is not writable. With --stop and a live session, the
# refusal must come before the stop, the marker, any copy and the push.
wt2="$space/worktrees/feat-two"
make_worktree "$space" feat-two "$branch"
folder_wt2="$(make_session "$wt2")"
start_live "$wt2"
sha_before="$(ssh_t12 "git --git-dir='$space/.git' rev-parse 'refs/heads/$branch'")"
lines_before_local="$(wc -l < "$folder_wt2/$SESSION.jsonl" | tr -d ' ')"
pexec "chmod 0500 '$space/worktrees'"
set +e
out="$(run_hyper "$wt2" warp t12 --stop 2>&1)"; code=$?
set -e
pexec "chmod 0755 '$space/worktrees'"
[ "$code" = 2 ] || { stop_live; die "expected exit 2 for an unwritable worktrees/, got $code: $out"; }
flat "$out" | grep -q "$space/worktrees exists on t12 but isn't writable" \
  || { stop_live; die "the refusal does not name the unwritable worktrees/ dir: $out"; }
flat "$out" | grep -q "Nothing was changed on either machine" \
  || { stop_live; die "the refusal does not say nothing changed: $out"; }
kill -0 "$live_pid" 2>/dev/null || die "the live session was stopped by a warp that refused"
[ -e "$folder_wt2/$SESSION.warp.json" ] && { stop_live; die "a marker was written by a warp that refused"; }
[ "$(wc -l < "$folder_wt2/$SESSION.jsonl" | tr -d ' ')" = "$lines_before_local" ] || { stop_live; die "the local transcript changed"; }
[ "$(ssh_t12 "git --git-dir='$space/.git' rev-parse 'refs/heads/$branch'")" = "$sha_before" ] \
  || { stop_live; die "the target's $branch moved"; }
ssh_t12 "git --git-dir='$space/.git' rev-parse --verify -q refs/heads/feat-two" >/dev/null \
  && { stop_live; die "feat-two was pushed by a warp that refused"; }
[ -z "$(ssh_t12 "ls -A '$folder_wt2'")" ] || { stop_live; die "the transcript or marker reached the target"; }
ssh_t12 "test -e '$wt2'" && { stop_live; die "the worktree reached the target"; }
stop_live
pass "AC-16 space on target, worktrees/ unwritable: exit 2 before --stop signalled pid, no marker, $branch still $sha_before, no feat-two, no transcript, no files"

echo "# ---------------------------------------------------------------"
echo "# 11. AC-16 for a space MISSING on the target: unwritable ancestor"
echo "# ---------------------------------------------------------------"
locked2="$home_local/work/locked2"
space2="$locked2/spaces/research2"
mkdir -p "$space2/worktrees"
git init -q --bare "$space2/.git"
make_worktree "$space2" main
wt3="$space2/worktrees/main"
folder_wt3="$(make_session "$wt3")"
target_mkdir "$locked2"
pexec "chmod 0500 '$locked2'"
ssh_t12 "rm -f '$home_local/hyper-argv.log'"
start_live "$wt3"
set +e
out="$(run_hyper "$wt3" warp t12 --stop 2>&1)"; code=$?
set -e
pexec "chmod 0755 '$locked2'"
[ "$code" = 2 ] || { stop_live; die "expected exit 2 for an unwritable ancestor, got $code: $out"; }
flat "$out" | grep -q "$space2 can be created" || { stop_live; die "the refusal does not name the space: $out"; }
flat "$out" | grep -q "t12 said: $locked2)" || { stop_live; die "the refusal does not name the unwritable ancestor: $out"; }
kill -0 "$live_pid" 2>/dev/null || die "the live session was stopped by a warp that refused"
[ -e "$folder_wt3/$SESSION.warp.json" ] && { stop_live; die "a marker was written by a warp that refused"; }
[ -z "$(ssh_t12 "cat '$home_local/hyper-argv.log' 2>/dev/null")" ] || { stop_live; die "hyper space clone ran on the target"; }
[ -z "$(ssh_t12 "ls -A '$locked2'")" ] || { stop_live; die "something was created under $locked2 on the target"; }
[ -z "$(ssh_t12 "ls -A '$folder_wt3'")" ] || { stop_live; die "the transcript reached the target"; }
stop_live
pass "AC-16 space missing, nearest ancestor $locked2 unwritable: exit 2 before --stop signalled pid, no clone, no marker, nothing on the target"

echo "# ---------------------------------------------------------------"
echo "# 12. re-warp to the machine that owns the session (blocker 2)"
echo "# ---------------------------------------------------------------"
# $proj was warped to t12 in step 4; its marker names t12. Work continues THERE.
other_id="11111111-2222-4333-8444-555555555555"
ssh_t12 "printf '%s\n' '{\"type\":\"assistant\",\"cwd\":\"$proj\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"written on t12\"}]}}' >> '$folder/$SESSION.jsonl'"
ssh_t12 "printf 'edited on t12\n' > '$proj/tracked.txt'"
ssh_t12 "printf 'another session, only on t12\n' > '$folder/$other_id.jsonl'"
printf 'another session, this machine\n' > "$folder/$other_id.jsonl"
touch -t 200001010000 "$folder/$other_id.jsonl"
target_lines="$(ssh_t12 "wc -l < '$folder/$SESSION.jsonl' | tr -d ' '")"
set +e
out="$(run_hyper "$proj" warp t12 --session "$SESSION" 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "a re-warp to the owner was not refused: exit $code: $out"
flat "$out" | grep -q "lives on t12 now" || die "the refusal does not say where the session lives: $out"
flat "$out" | grep -q -- "--force to overwrite t12's copy with this machine's" || die "the refusal does not offer --force: $out"
[ "$(ssh_t12 "wc -l < '$folder/$SESSION.jsonl' | tr -d ' '")" = "$target_lines" ] || die "the target's transcript changed"
ssh_t12 "tail -n 1 '$folder/$SESSION.jsonl'" | grep -q "written on t12" || die "the target's newest transcript line is gone"
[ "$(ssh_t12 "cat '$proj/tracked.txt'")" = "edited on t12" ] || die "the target's edit was overwritten"
pass "re-warp to the owner refused without --force; t12 keeps its $target_lines-line transcript (newest line 'written on t12') and its edit"

run_hyper "$proj" warp t12 --session "$SESSION" --force >/dev/null || die "--force did not proceed"
[ "$(ssh_t12 "cat '$folder/$other_id.jsonl'")" = "another session, only on t12" ] \
  || die "the warp overwrote ANOTHER session's transcript on the target"
pass "with --force only this session's files travel: another session's transcript on t12 is untouched"

echo "# ---------------------------------------------------------------"
echo "# 13. a partial copy: truthful message, marker kept (HIGH 5, HIGH 7)"
echo "# ---------------------------------------------------------------"
proj5="$home_local/work/proj5"
mkdir -p "$proj5/sub"
printf 'top\n' > "$proj5/top.txt"
printf 'in sub\n' > "$proj5/sub/a.txt"
folder5="$(make_session "$proj5")"
target_mkdir "$proj5"
# A root-owned sub/ on the target: the user can't write there, so rsync
# delivers top.txt and fails on sub/ (exit 23, partial transfer).
pexec "mkdir -p '$proj5/sub' && chown root '$proj5/sub' && chmod 0755 '$proj5/sub'"
set +e
out="$(run_hyper "$proj5" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "a partial copy did not fail: exit $code: $out"
flat "$out" | grep -q "PARTIAL transfer" || die "the message does not say the transfer was partial: $out"
flat "$out" | grep -q "What may now be on t12:.*the transcript $folder5/$SESSION.jsonl.*possibly part of files under $proj5" \
  || die "the message does not list what may have arrived: $out"
flat "$out" | grep -q "nothing needs undoing" && die "the message still claims nothing needs undoing: $out"
owner5="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["owner"])' "$folder5/$SESSION.warp.json")"
[ "$owner5" = "t12" ] || die "the marker was restored after files had been copied (owner $owner5)"
[ "$(ssh_t12 "cat '$proj5/top.txt'")" = "top" ] || die "the fixture did not partially copy"
pass "a partial copy (rsync 23) exits 2, lists what may be on t12, keeps the marker naming t12"

echo "# ---------------------------------------------------------------"
echo "# 14. a cwd the remote path rule refuses is refused at planning (HIGH 6)"
echo "# ---------------------------------------------------------------"
spaced="$home_local/work/my proj"
mkdir -p "$spaced"
folder_spaced="$(make_session "$spaced")"
target_mkdir "$spaced"
for mode in --dry-run ""; do
  set +e
  out="$(run_hyper "$spaced" warp t12 $mode 2>&1)"; code=$?
  set -e
  [ "$code" = 2 ] || die "a cwd with a space was not refused (${mode:-real run}): exit $code: $out"
  flat "$out" | grep -q "can't be sent to t12" || die "the refusal does not explain the path rule: $out"
done
[ -e "$folder_spaced/$SESSION.warp.json" ] && die "a marker was written for a cwd that can't be sent"
[ -z "$(ssh_t12 "ls -A '$folder_spaced'")" ] || die "the transcript reached the target"
pass "a cwd with a space is refused at planning, by --dry-run and by a real run alike, before any marker or copy"

echo "# ---------------------------------------------------------------"
echo "# 15. uncommitted work on the target is not overwritten without --force"
echo "# ---------------------------------------------------------------"
# The session came back here (the marker names this machine, as after a warp
# back), but the target's copy still holds edits nobody committed.
mark_mine() { printf '{"owner":"mac","at":"2026-10-04T00:00:00.000Z"}\n' > "$1/$SESSION.warp.json"; }
folder_wt="$home_local/.claude/projects/$(enc_for "$wt")"
mark_mine "$folder_wt"
ssh_t12 "printf 'edited on t12, never committed\n' > '$wt/stable.txt' && printf 'staged on t12\n' > '$wt/staged-t12.txt' && git -C '$wt' add staged-t12.txt"
set +e
out="$(run_hyper "$wt" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "a dirty target worktree was not refused: exit $code: $out"
flat "$out" | grep -q "t12 has uncommitted work in the worktree $wt" || die "the refusal does not say why: $out"
flat "$out" | grep -q "M stable.txt" || die "the refusal does not name the dirty paths: $out"
[ "$(ssh_t12 "cat '$wt/stable.txt'")" = "edited on t12, never committed" ] || die "the target's edit was overwritten"
ssh_t12 "git -C '$wt' diff --cached --name-only" | grep -qx staged-t12.txt || die "the target's staged file lost its staging"
pass "a dirty target worktree is refused without --force; t12's edit and its staged file are intact"

set +e
out="$(run_hyper "$wt" warp t12 --force 2>&1)"; code=$?
set -e
[ "$code" = 0 ] || die "--force on a dirty target worktree failed: exit $code: $out"
printf '%s' "$out" | tr -d '\n' | grep -q "was saved as stash" || die "the user was not told about the stash: $out"
stash_list="$(ssh_t12 "git -C '$wt' stash list")"
printf '%s' "$stash_list" | grep -q "hyper warp $SESSION" || die "no stash on the target: $stash_list"
ssh_t12 "git -C '$wt' show 'stash@{0}:stable.txt'" | grep -qx "edited on t12, never committed" \
  || die "the stash does not hold the target's edit"
pass "with --force the target's work is saved first: $(printf '%s' "$stash_list" | head -n 1 | cut -c1-90)"

repo_folder="$home_local/.claude/projects/$repo_enc"
mark_mine "$repo_folder"
ssh_t12 "printf 'edited on t12\n' > '$repo/a.txt' && printf 'staged\n' > '$repo/new-t12.txt' && git -C '$repo' add new-t12.txt"
set +e
out="$(run_hyper "$repo" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "a dirty target repository was not refused: exit $code: $out"
flat "$out" | grep -q "t12 has uncommitted work in the repository $repo" || die "the refusal does not say why: $out"
[ "$(ssh_t12 "cat '$repo/a.txt'")" = "edited on t12" ] || die "the target's edit was overwritten"
ssh_t12 "git -C '$repo' diff --cached --name-only" | grep -qx new-t12.txt || die "the target's staged file lost its staging"
pass "a dirty plain git repo on the target is refused without --force; its edit and staged file are intact"
run_hyper "$repo" warp t12 --force >/dev/null || die "--force on a dirty target repository failed"
[ "$(ssh_t12 "cat '$repo/a.txt'")" = "hello" ] || die "--force did not overwrite the plain repo's file"
pass "with --force the plain repo is overwritten file by file (no stash for a plain repo, as documented)"

echo "# ---------------------------------------------------------------"
echo "# 16. a missing space that is not in the manifest is refused first"
echo "# ---------------------------------------------------------------"
space3="$home_local/work/spaces/research3"
mkdir -p "$space3/worktrees"
git init -q --bare "$space3/.git"
make_worktree "$space3" main
wt4="$space3/worktrees/main"
folder_wt4="$(make_session "$wt4")"
ssh_t12 "rm -f '$home_local/hyper-argv.log'"
set +e
out="$(run_hyper "$wt4" warp t12 2>&1)"; code=$?
set -e
[ "$code" = 2 ] || die "a space missing from the manifest was not refused: exit $code: $out"
flat "$out" | grep -q 'the space "research3" isn.t in your hyperdrive manifest' || die "the refusal does not say why: $out"
flat "$out" | grep -q "hyper space init" || die "the refusal does not say what to run: $out"
[ -z "$(ssh_t12 "cat '$home_local/hyper-argv.log' 2>/dev/null")" ] || die "hyper ran on the target"
ssh_t12 "test -e '$space3'" && die "something was created for research3 on the target"
[ -e "$folder_wt4/$SESSION.warp.json" ] && die "a marker was written"
pass "a missing space that is not in the local manifest is refused before any change (no clone, no marker)"

echo "# ---------------------------------------------------------------"
printf '1..%d\n' "$step"
echo "# all $step assertions passed"
echo "# warp-argv.log (what the fake herdr was called with):"
sed 's/^/#   /' "$work_real/herdr-argv.log" 2>/dev/null || true