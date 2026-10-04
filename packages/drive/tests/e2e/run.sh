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
#   HOME=<fresh temp dir>, XDG_CONFIG_HOME=<temp>/xdg, and an EMPTY
#   CLAUDE_CONFIG_DIR=<temp>/claude — EXCEPT sessions.sh, which by design
#   (C-18) asserts against the installed claude and so needs a LOGGED-IN
#   config: export CLAUDE_CONFIG_DIR yourself before run.sh if you want
#   sessions to run. run.sh never invents one and never points claude at a
#   config you did not choose. The container scripts additionally receive a
#   freshly picked free port and a unique container name (see below), so two
#   runs on a shared machine do not collide.
#
# Skipping — never silent. A script is skipped ONLY when:
#   1. it is named in HYPER_E2E_SKIP (comma or space separated names), or
#   2. one of its capability probes below fails.
# Both print exactly `SKIP <script>: <reason>` and the summary counts skips
# separately from passes. An unknown name in HYPER_E2E_SKIP is a hard FAIL:
# a typo must not silently drop a script.
#
# Capability probes (the ONLY automatic skips):
#   sessions                        `claude` on PATH
#   sync                            `mutagen` on PATH; non-interactive ssh to
#                                   localhost works (BatchMode)
#   tools                           `curl` on PATH; https://github.com reachable
#   warp, agent-user, docker-home   `podman` on PATH AND `podman info` succeeds
# Anything else a script needs and cannot find must make THAT script fail
# loudly (C-18), which run.sh reports as FAIL — never a skip.
#
# Before anything runs, run.sh prints the version of every tool the suite can
# depend on: `claude --version` (only when claude is present — a version print
# never starts a session), `mutagen version`, `herdr --version`,
# `podman --version`, `git --version`, `ssh -V`.
#
# Exit status: 0 when nothing failed (skips are fine), 1 when any script
# failed, 2 when the suite itself cannot run (missing required tool, bad
# HYPER_E2E_SKIP name, missing CLI build).
#
# The real herdr is never driven: every script that needs herdr puts a fake on
# its own PATH. No script here may start a real herdr or claude session beyond
# sessions.sh's designed `claude -p` probe (C-18); if one does, that is a bug.

set -uo pipefail

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

# --- the skip switch --------------------------------------------------------
# Comma or space separated script names, e.g. HYPER_E2E_SKIP="sessions,tools".
skip_list="${HYPER_E2E_SKIP:-}"
skip_list="${skip_list//,/ }"
for name in $skip_list; do
  case " ${scripts[*]} " in
    *" $name "*) ;;
    *) fail_fast "HYPER_E2E_SKIP names unknown script '$name' (known: ${scripts[*]})" ;;
  esac
done

explicitly_skipped() {
  case " $skip_list " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# Prints the skip reason and returns 0 when the script's probes fail;
# returns 1 (prints nothing) when the script can run.
probe_skip_reason() {
  case "$1" in
    sessions)
      command -v claude >/dev/null 2>&1 || { echo "no claude on PATH"; return 0; }
      ;;
    sync)
      command -v mutagen >/dev/null 2>&1 || { echo "no mutagen on PATH"; return 0; }
      ssh -o BatchMode=yes -o ConnectTimeout=5 localhost true >/dev/null 2>&1 \
        || { echo "cannot ssh to localhost non-interactively"; return 0; }
      ;;
    tools)
      command -v curl >/dev/null 2>&1 || { echo "no curl on PATH"; return 0; }
      curl -fsSI --max-time 10 https://github.com >/dev/null 2>&1 \
        || { echo "https://github.com unreachable"; return 0; }
      ;;
    warp | agent-user | docker-home)
      command -v podman >/dev/null 2>&1 || { echo "no podman on PATH"; return 0; }
      podman info >/dev/null 2>&1 \
        || { echo "podman info failed (no podman machine or connection)"; return 0; }
      ;;
  esac
  return 1
}

# --- per-script environment -------------------------------------------------
# A free localhost port, picked at run time so concurrent runs do not collide.
free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

# Container names carry this run's slug so two runs on a shared machine never
# fight over a name, and a trap only ever removes a container this run started.
slug="t19-$$"

homes=()
cleanup() {
  for home in ${homes[@]+"${homes[@]}"}; do
    rm -rf "$home"
  done
}
trap cleanup EXIT

passed=()
failed=()
skipped=()

for name in "${scripts[@]}"; do
  if explicitly_skipped "$name"; then
    printf 'SKIP %s: excluded via HYPER_E2E_SKIP\n' "$name"
    skipped+=("$name")
    continue
  fi
  reason=""
  if reason="$(probe_skip_reason "$name")"; then
    printf 'SKIP %s: %s\n' "$name" "$reason"
    skipped+=("$name")
    continue
  fi

  home="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-home.XXXXXX")"
  homes+=("$home")

  env_args=("HOME=$home" "XDG_CONFIG_HOME=$home/xdg")
  if [ "$name" != sessions ]; then
    mkdir -p "$home/claude"
    env_args+=("CLAUDE_CONFIG_DIR=$home/claude")
  fi
  case "$name" in
    warp)
      env_args+=("WARP_E2E_PORT=$(free_port)" "WARP_E2E_CONTAINER=hyper-t12-$slug")
      ;;
    agent-user)
      env_args+=("AGENT_USER_E2E_PORT=$(free_port)" "AGENT_USER_E2E_CONTAINER=hyper-t16-$slug")
      ;;
    docker-home)
      env_args+=("DOCKER_HOME_E2E_PORT=$(free_port)" "DOCKER_HOME_E2E_CONTAINER=hyper-t17-$slug")
      ;;
  esac

  echo
  echo "=== $name.sh (HOME=$home) ==="
  start=$SECONDS
  env "${env_args[@]}" bash "$here/$name.sh"
  rc=$?
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
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'e2e: FAILED — %s\n' "${failed[*]}" >&2
  exit 1
fi
echo "e2e: OK"
