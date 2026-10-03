#!/usr/bin/env bash
# e2e: Claude Code session discovery, against the installed `claude`.
#
# Starts a real `claude -p` in a temp dir, then asserts that
# packages/drive/src/services/sessions.ts finds the live process, the new
# transcript, its line count, its last assistant text, and round-trips an
# ownership marker. Any Claude Code field the module relies on that turns out
# to be missing fails loudly, naming the field (C-18).
#
# Usage: packages/drive/tests/e2e/sessions.sh
# Cost:   one short `claude -p` call on the operator's account.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg="$(cd "$here/../.." && pwd)"
cli="$here/sessions-cli.ts"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

echo "# claude --version"
claude --version

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-sessions.XXXXXX")"
# macOS puts the temp dir behind a symlink (`/var` -> `/private/var`) and Claude
# Code records the realpath, so compare against that.
work_real="$(cd "$work" && pwd -P)"
cleanup() { [ -n "${claude_pid:-}" ] && kill -9 "$claude_pid" 2>/dev/null || true; }
trap cleanup EXIT

run() { (cd "$pkg" && bun run "$cli" "$@"); }

echo "# work dir: $work (realpath: $work_real)"
expected_enc="$(run encoded "$work")"
echo "# encodeProjectDir($work) = $expected_enc"
project_dir="$HOME/.claude/projects/$expected_enc"

# --- a live `claude -p`, stdin closed, in the background ---------------------
(cd "$work" && claude -p "reply with the single word: ok" >"$work/stdout.txt" 2>"$work/stderr.txt" </dev/null) &
claude_pid=$!
echo "# started claude -p as pid $claude_pid"

live_seen=""
for _ in $(seq 1 100); do
  live="$(run live "$work")"
  if [ "$live" != "none" ]; then live_seen="$live"; break; fi
  if ! kill -0 "$claude_pid" 2>/dev/null; then break; fi
  sleep 0.2
done

[ -n "$live_seen" ] || die "liveSession never saw a running claude in $work (sessions file $HOME/.claude/sessions/<pid>.json must carry 'cwd'; project folder $project_dir)"
case "$live_seen" in
  *'"cwd":"'"$work_real"'"'*) pass "liveSession matches the cwd ($live_seen)" ;;
  *) die "liveSession returned the wrong cwd: $live_seen" ;;
esac
case "$live_seen" in
  *'"pid":'*) pass "liveSession reports the pid" ;;
  *) die "liveSession did not report 'pid' (Claude Code sessions file field 'pid')" ;;
esac
case "$live_seen" in
  *'"startedAt":'*) pass "liveSession reports startedAt" ;;
  *) die "liveSession did not report 'startedAt' (Claude Code sessions file field 'startedAt')" ;;
esac

# --- wait for it to finish --------------------------------------------------
wait "$claude_pid"
echo "# claude -p exited: $(cat "$work/stdout.txt")"

# --- the transcript ---------------------------------------------------------
latest="$(run latest "$work")"
[ "$latest" != "none" ] || die "latestTranscript found no transcript in $project_dir"
path="$(printf '%s' "$latest" | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"
id="$(printf '%s' "$latest" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[ -n "$path" ] || die "latestTranscript returned no path (field 'id'/'path' of the transcript ref)"
[ "$(basename "$path")" = "$id.jsonl" ] || die "transcript id $id does not match file $(basename "$path")"
pass "latestTranscript -> $(basename "$path")"

lines="$(run lines "$path")" || die "transcriptLineCount failed on $path"
[ "$lines" -gt 0 ] || die "transcriptLineCount($path) = $lines"
pass "transcriptLineCount = $lines"

last="$(run last "$path")" || die "lastAssistantText failed on $path"
printf '# last assistant text: %s\n' "$last"
case "$last" in
  *ok*) pass "lastAssistantText contains 'ok'" ;;
  *) die "lastAssistantText did not contain 'ok': $last" ;;
esac

# --- ownership marker -------------------------------------------------------
written="$(run write-owner "$work" "$id" e2e-machine)"
readback="$(run read-owner "$work" "$id")"
[ "$written" = "$readback" ] || die "ownership marker did not round-trip: wrote $written, read $readback"
printf '# owner marker: %s\n' "$readback"
pass "writeOwner/readOwner round-trip (C-10)"
[ -f "$project_dir/$id.warp.json" ] || die "marker is not next to the transcript: $project_dir/$id.warp.json missing"
pass "marker lives next to the transcript, so config sync carries it"

# --- no leftovers -----------------------------------------------------------
left="$(find "$project_dir" -name '*.tmp' | wc -l | tr -d ' ')"
[ "$left" = "0" ] || die "writeOwner left $left temp file(s) behind"
pass "no temp files left behind by the atomic write"

echo "# transcript kept for inspection: $path"
echo "1..$step"
echo "# PASS"