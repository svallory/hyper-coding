#!/usr/bin/env bash
# Claude Code SessionEnd hook: save the space (and push, for session-end+push).
#
# SessionEnd hooks share a 1.5-second budget unless the user's own settings
# raise it, and it is not documented that a plugin's hooks.json timeout does.
# A commit plus a push routinely takes longer, and a hook killed part-way
# through a commit is how an index.lock gets left behind. So this script does
# only cheap work in the foreground:
#
#   1. find the space and read its cadence (silent exit 0 when there is none,
#      no .hyper/space.git, or the cadence is manual/unset);
#   2. one line when the hyper CLI is missing, or cannot provide its library;
#   3. write the hook JSON to a payload file in the space git dir and start
#      `hyper space commit --session-end --payload-file <file>` DETACHED, in a
#      new session, so it survives this hook's exit and a kill of its process
#      group; then return.
#
# The detached worker commits, pushes for session-end+push, and records its
# result in .hyper/space.git/session-end.log; `hyper space status` shows the
# last result when it was a failure. Its bounds live in the CLI
# (services/session-end-worker.ts). This script never exits non-zero.
set -u

# A session-end save must not also start the CLI's background update check.
export HYPER_SKIP_NEW_VERSION_CHECK=1

source "$(dirname "${BASH_SOURCE[0]}")/hyper-require-lib.sh"

# Cheap prefilter, no CLI start-up: the nearest ancestor holding
# .hyper/space.git. Most directories have none, and then nothing else runs.
# With a CLI, the canonical find_space_root below decides; without one, this
# walk is all there is, and it only feeds the missing-CLI line.
root="$PWD"
while [[ "$root" != / && ! -d "$root/.hyper/space.git" ]]; do
  root="$(dirname "$root")"
done

read_cadence() {
  git --git-dir="$1/.hyper/space.git" config --local hyper.cadence 2>/dev/null
}

[[ -d "$root/.hyper/space.git" ]] || exit 0
cadence="$(read_cadence "$root")" || exit 0
case "$cadence" in
  session-end|session-end+push) ;;
  *) exit 0 ;;
esac

if ! command -v hyper >/dev/null 2>&1; then
  printf 'hyperdrive: cadence is %s but the hyper CLI is not installed\n' "$cadence"
  exit 0
fi
if ! hyper_soft_lib </dev/null 2>/dev/null; then
  set +e
  if [[ "${hyper_lib_reason:-}" == outdated ]]; then
    printf 'hyperdrive: cadence is %s but the installed hyper CLI is too old for this plugin (its hyper-lib.sh is older than v%s); update @hypercli/cli\n' "$cadence" "$HYPER_REQUIRE_LIB_VERSION"
  else
    printf 'hyperdrive: cadence is %s but the hyper CLI could not provide hyper-lib.sh (hyper space lib-path); reinstall or update @hypercli/cli\n' "$cadence"
  fi
  exit 0
fi
# hyper-lib.sh enables errexit/pipefail when sourced. This hook owns its exit
# policy.
set +e
set +o pipefail

canonical="$(find_space_root "$PWD" 2>/dev/null)" || exit 0
if [[ "$canonical" != "$root" ]]; then
  root="$canonical"
  [[ -d "$root/.hyper/space.git" ]] || exit 0
  cadence="$(read_cadence "$root")" || exit 0
  case "$cadence" in
    session-end|session-end+push) ;;
    *) exit 0 ;;
  esac
fi

hyper_bin="$(command -v hyper)"
# stdin of a detached process is not reliable: hand the JSON over in a file the
# worker removes. 64 KiB is the CLI's own limit; one byte more lets it refuse.
payload="$(mktemp "$root/.hyper/space.git/session-end-payload.XXXXXX" 2>/dev/null)" || {
  printf 'hyperdrive: could not write the session-end payload into %s/.hyper/space.git; nothing was saved\n' "$root"
  exit 0
}
head -c 65537 > "$payload"

# Detach: a new session (so a kill of this hook's process group does not reach
# it), SIGHUP ignored, and no inherited pipes (Claude Code waits for the hook's
# stdout and stderr to close). setsid(1) on Linux; perl's POSIX::setsid on
# stock macOS; plain nohup as the last resort.
if command -v setsid >/dev/null 2>&1; then
  nohup setsid "$hyper_bin" space commit --session-end --payload-file "$payload" \
    </dev/null >/dev/null 2>&1 &
elif command -v perl >/dev/null 2>&1; then
  nohup perl -MPOSIX -e 'POSIX::setsid(); exec { $ARGV[0] } @ARGV or exit 127' -- \
    "$hyper_bin" space commit --session-end --payload-file "$payload" \
    </dev/null >/dev/null 2>&1 &
else
  nohup "$hyper_bin" space commit --session-end --payload-file "$payload" \
    </dev/null >/dev/null 2>&1 &
fi
disown 2>/dev/null
exit 0
