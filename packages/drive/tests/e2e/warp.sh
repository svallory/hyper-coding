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
container="hyper-t12"
port="${WARP_E2E_PORT:-23322}"
primary="svallory"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

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

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "# KEEP=1 — container $container and $work_real left behind"
    echo "#   remove with: podman rm -f $container && rm -rf $work_real"
    return
  fi
  echo "# tearing down $container"
  podman rm -f "$container" >/dev/null 2>&1 || true
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

recipe="$(cat "$containerfile" "$work_real/entrypoint.sh" | shasum -a 256 | cut -c1-12)"
derived="hyper-t12-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (sshd + rsync + git)"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi

# --------------------------------------------------------------------------
# The machine
# --------------------------------------------------------------------------
if ! podman machine list --format '{{.Running}}' | grep -q true; then
  echo "# starting the podman machine"
  podman machine start >/dev/null
fi
podman rm -f "$container" >/dev/null 2>&1 || true
# The entrypoint takes the shared home path and does the user setup, because
# sshd is the container's main process and must be the LAST thing started.
podman run -d --name "$container" -p "$port":22 "$derived" "$home_local" >/dev/null \
  || die "could not start the container"
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
log="%WORK%/herdr-argv.log"
printf '%s\n' "$*" >> "$log"

# Drop the routing flag; the rest are the words that run on the target.
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
    # The Herdr-server probe. A real server answers here; so does ours, unless
    # the caller asks for the "no server on the target" case.
    exit ${WARP_E2E_HERDR_DOWN:-0} ;;
  "tab create")
    echo '{"result":{"tab":"w1:t1","root_pane":"w1:p1"}}'
    exit 0 ;;
esac

if [ "$1" = "agent" ] && [ "$2" = "start" ]; then
  # Skip past herdr's own words, keeping only what came after the `--`.
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
  shift || true
  # Carry the agent command to the TARGET and run it there, so the fake claude
  # on the far side is what proves the session was really resumed remotely.
  exec /usr/bin/ssh -i "%KEY%" -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
      -p %PORT% %PRIMARY%@localhost "$@"
fi

# Anything else (`agent get`, `--remote`) is a local read; succeed quietly.
exit 0
HERDR
sed -i '' \
  -e "s|%WORK%|$work_real|g" \
  -e "s|%KEY%|$key|g" \
  -e "s|%PORT%|$port|g" \
  -e "s|%PRIMARY%|$primary|g" \
  "$fakebin/herdr"
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
sed -i '' -e "s|%HOMEDIR%|$home_local|g" "$work_real/claude"
podman cp "$work_real/claude" "$container:/usr/local/bin/claude"
pexec "chmod 0755 /usr/local/bin/claude"

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
claude_argv="$(ssh_t12 "cat '$home_local/claude-argv.log'")"
printf '%s' "$claude_argv" | grep -q -- "--resume $SESSION" \
  || die "claude was not resumed on the target with $SESSION: $claude_argv"
pass "claude was resumed on the target through Herdr: $claude_argv"

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

echo "# ---------------------------------------------------------------"
printf '1..%d\n' "$step"
echo "# all $step assertions passed"
echo "# warp-argv.log (what the fake herdr was called with):"
sed 's/^/#   /' "$work_real/herdr-argv.log" 2>/dev/null || true