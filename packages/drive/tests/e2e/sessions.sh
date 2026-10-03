#!/usr/bin/env bash
# e2e: Claude Code session discovery, against the installed `claude`.
#
# Starts a real `claude -p` in a temp dir, then asserts that
# packages/drive/src/services/sessions.ts finds the live process, the new
# transcript, its line count, its last assistant text, and round-trips an
# ownership marker. Any Claude Code field the module relies on that turns out to
# be missing fails loudly, naming the field (C-18).
#
# Usage: packages/drive/tests/e2e/sessions.sh
# Cost:   one short `claude -p` call on the operator's account.
#
# Honours CLAUDE_CONFIG_DIR (it defaults to ~/.claude) so it can run against a
# copy of the config dir.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg="$(cd "$here/../.." && pwd)"
cli="$here/sessions-cli.ts"
claude_home="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
verified="2.1.288"

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }

echo "# claude --version"
version="$(claude --version 2>/dev/null | awk '{print $1}')"
echo "$version"
if [ "$version" != "$verified" ]; then
  echo "# WARNING: this script was written against claude $verified; $version may store files differently" >&2
fi
echo "# claude config dir: $claude_home"

work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-sessions.XXXXXX")"
# macOS puts the temp dir behind a symlink (`/var` -> `/private/var`) and Claude
# Code records the realpath, so compare against that.
work_real="$(cd "$work" && pwd -P)"
cleanup() {
  [ -n "${claude_pid:-}" ] && kill -9 "$claude_pid" 2>/dev/null
  rm -rf "$work"
  return 0
}
trap cleanup EXIT

# Run the entry point, keeping every line it printed: a proto shim greets a
# fresh HOME with one NDJSON line before the real output.
run_raw() {
  (cd "$pkg" && bun "$cli" "$@")
}

# run_field <assertion name> <subcommand...> ; echoes the JSON, or dies with
# the raw stdout when it does not parse.
json() {
  local name="$1"; shift
  local raw new
  raw="$(run_raw "$@")"
  new="$(printf '%s' "$raw" | tail -n 1)"
  if ! printf '%s' "$new" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null; then
    echo "# raw stdout for $name:" >&2
    printf '%s\n' "$raw" >&2
    die "$name: the entry point did not print a JSON object on its last line"
  fi
  printf '%s' "$new"
}

field() {
  printf '%s' "$1" |
    python3 -c 'import json,sys
doc = json.load(sys.stdin)
for key in sys.argv[1].split("."):
    doc = doc[int(key)] if key.isdigit() else doc[key]
print(doc)' "$2"
}

echo "# work dir: $work (realpath: $work_real)"
enc_json="$(json 'encodeProjectDir' encoded "$work")"
expected_enc="$(field "$enc_json" encoded)"
echo "# encodeProjectDir($work) = $expected_enc"
project_dir="$claude_home/projects/$expected_enc"

# --- a live `claude -p`, stdin closed, in the background ---------------------
# `exec` so $! is claude's own pid and the trap can actually reach it.
(cd "$work" && exec claude -p "reply with the single word: ok" >"$work/stdout.txt" 2>"$work/stderr.txt" </dev/null) &
claude_pid=$!
echo "# started claude -p as pid $claude_pid"

live_json=""
for _ in $(seq 1 100); do
  live_json="$(json 'liveSession' live "$work" || true)"
  [ "$(field "$live_json" live)" != "None" ] && break
  kill -0 "$claude_pid" 2>/dev/null || break
  sleep 0.2
done

[ "$(field "$live_json" live)" != "None" ] ||
  die "liveSession never saw a running claude in $work (sessions file $claude_home/sessions/<pid>.json must carry 'cwd'; project folder $project_dir)"
pass "liveSession sees the running session (pid $(field "$live_json" live.pid))"
[ "$(field "$live_json" live.cwd)" = "$work_real" ] || die "liveSession returned the wrong cwd: $(field "$live_json" live.cwd)"
pass "liveSession matches the cwd"
live_session_id="$(field "$live_json" live.sessionId)"
[ -n "$live_session_id" ] && [ "$live_session_id" != "None" ] ||
  die "liveSession did not report 'sessionId' (Claude Code sessions file field 'sessionId')"
pass "liveSession reports sessionId ($live_session_id)"

# CLAUDE-INTERNAL (verified 2.1.288): the file holds `LC_ALL=C TZ=UTC
# ps -o lstart= -p <pid>`. Compare against the same invocation, or the check
# that stops a stale pid would never match a real session.
live_proc_start="$(field "$live_json" live.procStart)"
expected_proc_start="$(LC_ALL=C TZ=UTC ps -o lstart= -p "$(field "$live_json" live.pid)" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$live_proc_start" ] && [ "$live_proc_start" != "None" ] ||
  die "liveSession did not report 'procStart' (Claude Code sessions file field 'procStart')"
[ "$live_proc_start" = "$expected_proc_start" ] ||
  die "procStart mismatch: file says '$live_proc_start', LC_ALL=C TZ=UTC ps says '$expected_proc_start'"
pass "liveSession procStart matches LC_ALL=C TZ=UTC ps -o lstart= ($live_proc_start)"

# --- wait for it to finish --------------------------------------------------
wait "$claude_pid" || die "claude -p exited non-zero (see $work/stderr.txt)"
# The pid is gone and could be recycled; the trap must never signal it again.
unset claude_pid
echo "# claude -p exited: $(cat "$work/stdout.txt")"

# --- the transcript ---------------------------------------------------------
latest_json="$(json 'latestTranscript' latest "$work")"
[ "$(field "$latest_json" latest)" != "None" ] || die "latestTranscript found no transcript in $project_dir"
path="$(field "$latest_json" latest.path)"
id="$(field "$latest_json" latest.id)"
[ "$(basename "$path")" = "$id.jsonl" ] || die "transcript id $id does not match file $(basename "$path")"
pass "latestTranscript -> $(basename "$path")"
[ "$id" = "$live_session_id" ] ||
  die "transcript id $id does not match the live sessionId $live_session_id (warp pairs them by sessionId)"
pass "transcript id equals the live sessionId"

lines_json="$(json 'transcriptLineCount' lines "$path")"
lines="$(field "$lines_json" lines)"
[ "$lines" -gt 0 ] || die "transcriptLineCount($path) = $lines"
pass "transcriptLineCount = $lines"

last_json="$(json 'lastAssistantText' last "$path")"
last="$(field "$last_json" text)"
printf '# last assistant text: %s\n' "$last"
case "$last" in
  *ok*) pass "lastAssistantText contains 'ok'" ;;
  *) die "lastAssistantText did not contain 'ok': $last" ;;
esac

# --- ownership marker -------------------------------------------------------
written="$(json 'writeOwner' write-owner "$work" "$id" e2e-machine)"
readback="$(json 'readOwner' read-owner "$work" "$id")"
[ "$(field "$written" marker)" = "$(field "$readback" marker)" ] ||
  die "ownership marker did not round-trip: wrote $written, read $readback"
printf '# owner marker: %s\n' "$readback"
pass "writeOwner/readOwner round-trip (C-10)"
marker_path="$(field "$(json 'ownerPath' owner-path "$work" "$id")" path)"
[ -f "$marker_path" ] || die "marker is not next to the transcript: $marker_path missing"
[ "$(dirname "$marker_path")" = "$project_dir" ] ||
  die "marker landed outside the project folder: $marker_path"
pass "marker lives next to the transcript, so config sync carries it"

# --- no leftovers -----------------------------------------------------------
left="$(find "$project_dir" -name '*.tmp' | wc -l | tr -d ' ')"
[ "$left" = "0" ] || die "writeOwner left $left temp file(s) behind"
pass "no temp files left behind by the atomic write"

echo "# transcript kept for inspection: $path"
echo "1..$step"
echo "# PASS"