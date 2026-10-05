#!/usr/bin/env bash
# run.sh — the hyperdrive end-to-end suite (T-19): one entry point that runs
# EVERY e2e script in this directory, in a fixed order, each under its own
# throwaway HOME.
#
# Usage: packages/drive/tests/e2e/run.sh
# Requires: packages/cli built (every script drives the built CLI), plus git,
#   ssh and python3 on PATH. A missing REQUIRED tool is an immediate loud FAIL
#   (exit 2, one clear line) — the suite never degrades silently.
#
# Fixed order (cheap first, containers last):
#   sessions    session discovery against the installed claude (real `claude -p`)
#   sync        mutagen sync-config over loopback ssh
#   tools       the tool registry: real downloads into a temp HOME
#   warp        `hyper warp` against a disposable podman container
#   agent-user  the T-16 agent layout, systemd podman container
#   docker-home T-17 rootless docker + /Users home, privileged container
#
# Environment contract — every script runs with:
#   HOME=<fresh short /tmp dir>, SSH_AUTH_SOCK and SSH_AGENT_PID REMOVED, and an
#   EMPTY CLAUDE_CONFIG_DIR=<temp>/claude — except sessions.sh, which by design
#   (C-18) asserts against the installed claude and inherits the caller's
#   CLAUDE_CONFIG_DIR, and the three container scripts, which keep the host's
#   absolute XDG_CONFIG_HOME and XDG_DATA_HOME so podman finds its machine
#   connection (macOS) and its image store (Linux). The container scripts also
#   get a freshly picked free port and a unique container name.
#
#   A temp HOME does NOT isolate ssh: OpenSSH resolves ~/.ssh from the PASSWD
#   home, so every test ssh call must carry -F /dev/null, an explicit -i and
#   the no-agent/no-control flags (see the scripts and ssh_isolation_flags in
#   this file). run.sh's own probe does exactly that.
#
# Real Claude (the C-18 exception): sessions.sh starts a REAL `claude -p`. It is
# opt-IN and never runs by default:
#   plain `bash run.sh`                  -> SKIP sessions: real claude -p needs HYPER_E2E_REAL_CLAUDE=1
#   HYPER_E2E_REAL_CLAUDE=1              -> only with CLAUDE_CONFIG_DIR exported; without it run.sh exits 2
#
# Skipping — never silent. A script is skipped ONLY when:
#   1. it is named in HYPER_E2E_SKIP, or
#   2. one of its capability probes below fails, or
#   3. it is sessions.sh and real Claude is not enabled (above).
# Names in HYPER_E2E_SKIP may be separated by commas, spaces, tabs or newlines.
# Every skip prints exactly `SKIP <script>: <reason>` and the summary counts
# skips separately from passes. An unknown name is a hard FAIL (exit 2): a typo
# must not silently drop a script.
#
# Requiring — a skip that must not be a skip. HYPER_E2E_REQUIRE takes the same
# list syntax. A listed script that would be skipped (explicitly or by a probe)
# is a FAIL, so a broken runner image cannot turn this job into a green no-op.
# The CI workflow lists every script it expects to run.
#
# Capability probes (the ONLY automatic skips):
#   sessions                        real Claude enabled (see above)
#   sync                            HYPER_E2E_LOOPBACK_OWN_KEY=1 (or CI=true):
#                                   its beta is LOOPBACK, so it logs in to
#                                   localhost as you with your own ssh key
#                                   (never your agent, never writing any
#                                   authorized_keys); `mutagen` on PATH;
#                                   non-interactive ssh to localhost works
#   tools                           `curl` on PATH; https://github.com reachable
#   warp, agent-user, docker-home   `podman` on PATH AND `podman info` succeeds
#                                   within 30s
# Anything else a script needs and cannot find must make THAT script fail
# loudly (C-18), which run.sh reports as FAIL — never a skip.
#
# Before anything runs, run.sh prints the version of every tool the suite can
# depend on: `claude --version` (only when claude is present — a version print
# never starts a session), `mutagen version`, `herdr --version`,
# `podman --version`, `git --version`, `ssh -V`.
#
# Exit status: 0 when nothing failed (skips are fine), 1 when any script
# failed or a required script was skipped, 2 when the suite itself cannot run
# (missing required tool, bad HYPER_E2E_SKIP/HYPER_E2E_REQUIRE name, missing
# CLI build, HYPER_E2E_REAL_CLAUDE=1 without CLAUDE_CONFIG_DIR).
#
# Concurrency: no script here takes the repository heavy-command flock, so the
# suite itself may run under `flock /tmp/hyper-heavy2.lock` like other heavy
# commands.
#
# The real herdr is never driven: every script that needs herdr puts a fake on
# its own PATH.

set -uo pipefail

# Signal handling is installed FIRST, before the version prints and before any
# temp file exists, so a signal can never land in a window where this runner
# would tear state down without stopping the child. Everything the handlers
# touch is initialised here and only guarded, never assumed.
homes=()
child=""
known_hosts=""

cleanup() {
  for home in ${homes[@]+"${homes[@]}"}; do
    rm -rf "$home"
  done
  if [ -n "$known_hosts" ]; then rm -f "$known_hosts"; fi
}

# A cancel or timeout signals the runner, not the child's process group. Stop
# the child — and its own children, scoped to that pid and never by name — so
# the script's EXIT trap removes its container, its ssh-agent and its daemon
# BEFORE this runner deletes anything.
on_signal() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    pkill -TERM -P "$child" 2>/dev/null || true
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  printf 'run.sh: signalled — stopped the running script and exiting\n' >&2
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM HUP

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/../../../cli/bin/run.js"

# Fixed order — do not reorder casually; the summary and CI log read top-down.
scripts=(sessions sync tools warp agent-user docker-home)

fail_fast() {
  printf 'FAIL run.sh: %s\n' "$1" >&2
  exit 2
}

[ -f "$cli" ] || fail_fast "cannot find the CLI at $cli — build packages/cli first"
for tool in git ssh python3; do
  command -v "$tool" >/dev/null 2>&1 || fail_fast "required tool '$tool' is not on PATH"
done

# --- tool versions ----------------------------------------------------------
print_version() {
  local name="$1"; shift
  if ! command -v "$name" >/dev/null 2>&1; then
    printf '# %-9s not found\n' "$name:"
    return 0
  fi
  local out
  out="$("$@" 2>&1 | head -n 1)"
  printf '# %-9s %s\n' "$name:" "${out:-unknown}"
}

echo "# tool versions"
# claude --version is a plain version print; it never starts a session.
print_version claude claude --version
print_version mutagen mutagen version
print_version herdr herdr --version
print_version podman podman --version
print_version git git --version
print_version ssh ssh -V

# --- switches ---------------------------------------------------------------
# One array for each list, built by normalising EVERY separator (comma, space,
# tab, newline) to a space. A YAML block scalar or a `printf '\n'` list must
# not validate and then skip nothing.
parse_name_list() {
  local raw="${1:-}"
  [ -n "$raw" ] || return 0
  local normalized
  normalized="$(tr ',	 \n' '    ' <<<"$raw")"
  read -r -a "$2" <<<"$normalized"
}

parse_name_list "${HYPER_E2E_SKIP:-}" skip_names
parse_name_list "${HYPER_E2E_REQUIRE:-}" require_names

# Iterate "$@", not a local array: bash 3.2 (stock macOS /bin/bash) raises
# "names[@]: unbound variable" under `set -u` for an EMPTY array.
validate_names() {
  local list_name="$1"
  shift
  local name
  for name in "$@"; do
    case " ${scripts[*]} " in
      *" $name "*) ;;
      *) fail_fast "$list_name names unknown script '$name' (known: ${scripts[*]})" ;;
    esac
  done
}
validate_names HYPER_E2E_SKIP ${skip_names[@]+"${skip_names[@]}"}
validate_names HYPER_E2E_REQUIRE ${require_names[@]+"${require_names[@]}"}

# HYPER_E2E_REAL_CLAUDE=1 opts into the one script that starts a real session.
# It must name the config to use; run.sh never invents one, and an inherited
# one under a throwaway HOME is exactly the case that would be a billed session.
case "${HYPER_E2E_REAL_CLAUDE:-}" in
  1)
    [ -n "${CLAUDE_CONFIG_DIR:-}" ] \
      || fail_fast "HYPER_E2E_REAL_CLAUDE=1 requires CLAUDE_CONFIG_DIR to point at a logged-in Claude config"
    ;;
esac

list_has() {
  local needle="$1"; shift
  local name
  for name in "$@"; do
    [ "$name" = "$needle" ] && return 0
  done
  return 1
}

# --- isolated ssh, for run.sh's own loopback probe --------------------------
# Same reasoning as the scripts: -F /dev/null (no user config), an explicit
# identity, no agent, no ControlMaster, and a known_hosts this run owns.
original_home="$HOME"
known_hosts="$(mktemp /tmp/hyperdrive-e2e-known-hosts.XXXXXX)"
ssh_identity=""
for candidate in id_ed25519 id_rsa id_ecdsa; do
  if [ -r "$original_home/.ssh/$candidate" ]; then
    ssh_identity="$original_home/.ssh/$candidate"
    break
  fi
done
ssh_isolated() {
  ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none \
    -o ForwardAgent=no -o ControlMaster=no -o ControlPath=none \
    -o UserKnownHostsFile="$known_hosts" -o StrictHostKeyChecking=accept-new \
    ${ssh_identity:+-i "$ssh_identity"} "$@"
}

# Prints the skip reason and returns 0 when the script's probes fail;
# returns 1 (prints nothing) when the script can run.
probe_skip_reason() {
  case "$1" in
    sessions)
      [ "${HYPER_E2E_REAL_CLAUDE:-}" = "1" ] \
        || { echo "real claude -p needs HYPER_E2E_REAL_CLAUDE=1"; return 0; }
      ;;
    sync)
      # sync.sh logs in to localhost as YOU with YOUR ssh key (loopback beta):
      # only when asked, or on a CI runner's throwaway account.
      [ "${HYPER_E2E_LOOPBACK_OWN_KEY:-}" = "1" ] || [ "${CI:-}" = "true" ] \
        || { echo "needs HYPER_E2E_LOOPBACK_OWN_KEY=1 (uses your own ssh key against localhost)"; return 0; }
      command -v mutagen >/dev/null 2>&1 || { echo "no mutagen on PATH"; return 0; }
      ssh_isolated -o BatchMode=yes -o ConnectTimeout=5 localhost true >/dev/null 2>&1 \
        || { echo "cannot ssh to localhost non-interactively"; return 0; }
      ;;
    tools)
      command -v curl >/dev/null 2>&1 || { echo "no curl on PATH"; return 0; }
      curl -fsSI --max-time 10 https://github.com >/dev/null 2>&1 \
        || { echo "https://github.com unreachable"; return 0; }
      ;;
    warp | agent-user | docker-home)
      command -v podman >/dev/null 2>&1 || { echo "no podman on PATH"; return 0; }
      podman_info_ok || { echo "podman info failed (no podman machine or connection)"; return 0; }
      ;;
  esac
  return 1
}

# `podman info` can hang indefinitely on a broken connection, and this probe
# must not hold the suite: 30s, then it counts as "cannot run".
podman_info_ok() {
  podman info >/dev/null 2>&1 &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge 30 ]; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

# --- per-script environment -------------------------------------------------
# A free localhost port, picked at run time so concurrent runs do not collide.
free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

# Container names carry this run's slug so two runs on a shared machine never
# fight over a name, and a trap only ever removes a container this run started.
slug="t19-$$"

passed=()
failed=()
skipped=()

record_skip() {
  local name="$1" reason="$2"
  if list_has "$name" ${require_names[@]+"${require_names[@]}"}; then
    printf 'FAIL %s: required by HYPER_E2E_REQUIRE, cannot run (%s)\n' \
      "$name" "$reason" >&2
    failed+=("$name")
  else
    printf 'SKIP %s: %s\n' "$name" "$reason"
    skipped+=("$name")
  fi
}

for name in "${scripts[@]}"; do
  if list_has "$name" ${skip_names[@]+"${skip_names[@]}"}; then
    record_skip "$name" "excluded via HYPER_E2E_SKIP"
    continue
  fi
  reason=""
  if reason="$(probe_skip_reason "$name")"; then
    record_skip "$name" "$reason"
    continue
  fi

  # Short paths: docker-home.sh forwards a throwaway ssh-agent whose socket
  # lives under $HOME, and macOS's TMPDIR (/var/folders/…) is already so long
  # that a home under it pushes the socket path past sun_path's 104 bytes.
  home="$(mktemp -d /tmp/hyperdrive-e2e-home.XXXXXX)"
  homes+=("$home")

  # Never hand a script the operator's agent. SSH_AUTH_SOCK would be forwarded
  # into every test container (1Password on this Mac), and nothing in a test may
  # use or signal it. All -u flags come FIRST: BSD env (macOS /usr/bin/env)
  # stops parsing options at the first assignment and would try to run "-u".
  env_unset=(-u SSH_AUTH_SOCK -u SSH_AGENT_PID)
  env_sets=("HOME=$home")
  case "$name" in
    warp | agent-user | docker-home)
      # Podman keeps machine connections in XDG_CONFIG_HOME and rootless image
      # storage in XDG_DATA_HOME. Preserve those absolute locations across the
      # temp HOME: otherwise macOS loses its VM connection, while Linux builds
      # fresh image layers as subuid-owned files under the throwaway HOME that
      # its ordinary user cannot remove.
      env_sets+=("XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$original_home/.config}"
                 "XDG_DATA_HOME=${XDG_DATA_HOME:-$original_home/.local/share}")
      ;;
    *)
      # Nothing needs the real XDG dirs: drop them so a script cannot write into
      # the operator's config/state/cache by inheritance. tools.sh sets the ones
      # it needs itself.
      env_unset+=(-u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME)
      ;;
  esac
  if [ "$name" != sessions ]; then
    mkdir -p "$home/claude"
    env_sets+=("CLAUDE_CONFIG_DIR=$home/claude")
  fi
  case "$name" in
    sync)
      # The probe above allowed it: explicitly, or on CI.
      env_sets+=("HYPER_E2E_LOOPBACK_OWN_KEY=1")
      ;;
    warp)
      env_sets+=("WARP_E2E_PORT=$(free_port)" "WARP_E2E_CONTAINER=hyper-t12-$slug")
      ;;
    agent-user)
      env_sets+=("AGENT_USER_E2E_PORT=$(free_port)" "AGENT_USER_E2E_CONTAINER=hyper-t16-$slug")
      ;;
    docker-home)
      env_sets+=("DOCKER_HOME_E2E_PORT=$(free_port)" "DOCKER_HOME_E2E_CONTAINER=hyper-t17-$slug")
      ;;
  esac

  echo
  echo "=== $name.sh (HOME=$home) ==="
  start=$SECONDS
  env "${env_unset[@]}" "${env_sets[@]}" bash "$here/$name.sh" &
  child=$!
  # Poll rather than bare `wait`: bash 3.2 (stock macOS /bin/bash) does not run
  # a trapped signal while blocked in `wait`, so a cancel would wait for the
  # whole script. This loop notices the signal within a second on every bash.
  while kill -0 "$child" 2>/dev/null; do
    sleep 1
  done
  wait "$child"
  rc=$?
  child=""
  if [ "$rc" -eq 0 ]; then
    printf 'PASS %s (%ds)\n' "$name" "$((SECONDS - start))"
    passed+=("$name")
  else
    printf 'FAIL %s (exit %d)\n' "$name" "$rc" >&2
    failed+=("$name")
  fi
done

echo
echo "== e2e summary ======================================================"
printf 'passed (%d): %s\n' "${#passed[@]}" "${passed[*]:-none}"
printf 'failed (%d): %s\n' "${#failed[@]}" "${failed[*]:-none}"
printf 'skipped (%d): %s\n' "${#skipped[@]}" "${skipped[*]:-none}"
printf 'e2e summary: passed=%d failed=%d skipped=%d\n' \
  "${#passed[@]}" "${#failed[@]}" "${#skipped[@]}"
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'e2e: FAILED — %s\n' "${failed[*]}" >&2
  exit 1
fi
echo "e2e: OK"