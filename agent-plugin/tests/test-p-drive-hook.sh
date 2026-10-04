#!/usr/bin/env bash
# SessionEnd cadence hook: cheap foreground, detached worker. run.sh discovers
# test-*.sh automatically.
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
export HYPER_HOME="$FIX/hyper-home" HYPER_DRIVE_CONFIG="$FIX/drive.toml"
export XDG_CONFIG_HOME="$FIX/config" CLAUDE_CONFIG_DIR="$FIX/claude"
export HYPER_SKIP_NEW_VERSION_CHECK=1
mkdir -p "$CLAUDE_CONFIG_DIR"
HOOK="$SCRIPTS_DIR/hyper-drive-session-end.sh"
NODE="$(command -v node)"
REAL_HYPER="$TESTS_DIR/hyper"
SYSTEM_PATH="$(dirname "$(command -v git)"):$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin"
export HOOK_LOG="$FIX/calls" HOOK_PAYLOAD="$FIX/payload"
export REAL_LIB="$PLUGIN_DIR/../packages/drive/scripts/hyper-lib.sh"
printf 'HYPER_LIB_VERSION=0\n' > "$FIX/old-lib.sh"
export OLD_LIB="$FIX/old-lib.sh"

# A stub CLI: real library, and a "worker" that records its argv and payload.
mkdir -p "$FIX/stub"
cat > "$FIX/stub/hyper" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == 'space lib-path' ]]; then
  case "${LIB_MODE:-real}" in
    outdated) printf '%s\n' "$OLD_LIB" ;;
    nowhere) printf '/nonexistent/hyper-lib.sh\n' ;;
    *) printf '%s\n' "$REAL_LIB" ;;
  esac
  exit 0
fi
sleep "${WORKER_DELAY:-0}"
payload="${*: -1}"
cp "$payload" "$HOOK_PAYLOAD.tmp" && rm -f "$payload"
printf '%s\n' "$*" > "$HOOK_LOG.tmp"
mv "$HOOK_PAYLOAD.tmp" "$HOOK_PAYLOAD"
mv "$HOOK_LOG.tmp" "$HOOK_LOG"
STUB
chmod +x "$FIX/stub/hyper"
export PATH="$FIX/stub:$SYSTEM_PATH"

payload='{"session_id":"ba0efb18-103b-43b5-b5a0-fc3a08a2b00b","reason":"prompt_input_exit","unknown":true}'
run_hook() { (cd "$1" && printf '%s' "${2:-$payload}" | bash "$HOOK" 2>&1); }
now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }
# wait_for <seconds> <command...>: poll until the command succeeds.
wait_for() {
  local deadline=$(( $(date +%s) + $1 )); shift
  until "$@" >/dev/null 2>&1; do
    [[ $(date +%s) -ge $deadline ]] && return 1
    perl -e 'select undef, undef, undef, 0.05'
  done
}

mkdir -p "$FIX/outside"
out="$(run_hook "$FIX/outside")"; rc=$?
assert_eq 'outside a space exits zero' 0 "$rc"
assert_eq 'outside a space is silent' '' "$out"
space="$FIX/space"; make_bare_space "$space"
out="$(run_hook "$space")"
assert_eq 'space without space.git is silent' '' "$out"
mkdir -p "$space/.hyper" "$space/notes"
git init --bare -q "$space/.hyper/space.git"
out="$(run_hook "$space")"
assert_eq 'unset cadence is silent' '' "$out"
git config --global hyper.cadence session-end
out="$(run_hook "$space")"
assert_eq 'global cadence cannot opt an unset space into saving' '' "$out"
git config --global --unset hyper.cadence
git --git-dir="$space/.hyper/space.git" config hyper.cadence manual
out="$(run_hook "$space")"
assert_eq 'manual cadence is silent' '' "$out"
out="$(PATH="$SYSTEM_PATH" run_hook "$space/notes")"
assert_eq 'manual cadence with missing CLI is silent' '' "$out"
assert_ok 'no worker was started for unset or manual cadence' test ! -f "$HOOK_LOG"

git --git-dir="$space/.hyper/space.git" config hyper.cadence session-end
out="$(PATH="$SYSTEM_PATH" run_hook "$space/notes")"; rc=$?
assert_eq 'missing CLI exits zero' 0 "$rc"
assert_eq 'missing CLI is exactly the expected line' 'hyperdrive: cadence is session-end but the hyper CLI is not installed' "$out"
out="$(PATH="$SYSTEM_PATH" run_hook "$FIX/outside")"
assert_eq 'missing CLI outside space is silent' '' "$out"
out="$(LIB_MODE=outdated run_hook "$space/notes")"; rc=$?
assert_eq 'outdated CLI exits zero' 0 "$rc"
assert_eq 'outdated CLI is one line' 1 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
assert_contains 'outdated CLI says so' "$out" 'hyperdrive: cadence is session-end but the installed hyper CLI is too old'
out="$(LIB_MODE=nowhere run_hook "$space/notes")"; rc=$?
assert_eq 'unloadable library exits zero' 0 "$rc"
assert_eq 'unloadable library is one line' 1 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
assert_contains 'unloadable library says so' "$out" 'could not provide hyper-lib.sh'
out="$(LIB_MODE=outdated git --git-dir="$space/.hyper/space.git" config hyper.cadence manual; LIB_MODE=outdated run_hook "$space/notes")"
assert_eq 'outdated CLI with manual cadence is silent' '' "$out"
assert_ok 'no worker was started without a loadable library' test ! -f "$HOOK_LOG"
git --git-dir="$space/.hyper/space.git" config hyper.cadence session-end

# The foreground returns at once; the worker gets argv and the exact payload.
export WORKER_DELAY=3
started=$(now_ms)
out="$(run_hook "$space/notes")"; rc=$?
elapsed=$(( $(now_ms) - started ))
assert_eq 'detaching hook exits zero' 0 "$rc"
assert_eq 'detaching hook is silent' '' "$out"
assert_ok "hook returns well before its 3 s worker (took ${elapsed} ms; bound 1500)" test "$elapsed" -lt 1500
assert_ok 'worker is still running after the hook returned' test ! -f "$HOOK_LOG"
assert_ok 'worker completes after the hook' wait_for 20 test -f "$HOOK_LOG"
recorded="$(cat "$HOOK_LOG")"
assert_contains 'worker argv' "$recorded" 'space commit --session-end --payload-file '
assert_contains 'payload lives in the space git dir' "$recorded" "$space/.hyper/space.git/session-end-payload."
assert_eq 'payload forwarded exactly' "$payload" "$(cat "$HOOK_PAYLOAD")"
assert_eq 'no payload file is left behind' '' "$(find "$space/.hyper/space.git" -name 'session-end-payload.*')"

# The worker survives a kill of the hook's whole process group.
rm -f "$HOOK_LOG" "$HOOK_PAYLOAD"
(cd "$space/notes" && printf '%s' "$payload" \
  | perl -e 'setpgrp(0, 0); exec @ARGV' bash "$HOOK" >/dev/null 2>&1) &
group=$!
wait "$group"
wait_for 5 pgrep -f "$space/.hyper/space.git/session-end-payload"
worker="$(pgrep -f "$space/.hyper/space.git/session-end-payload" | head -n 1)"
assert_ok 'a worker is running after the hook exited' test -n "$worker"
assert_ok 'the worker is not in the hook process group' test "$(ps -o pgid= -p "${worker:-1}" | tr -d ' ')" != "$group"
kill -KILL -- "-$group" 2>/dev/null
assert_ok 'worker completes after the hook process group is killed' wait_for 20 test -f "$HOOK_LOG"
unset WORKER_DELAY

# Registration: SessionEnd only for the reasons that end the work.
assert_ok 'SessionEnd fires for logout, prompt_input_exit and other, with timeout 60' "$NODE" -e '
const entries = require(process.argv[1]).hooks.SessionEnd;
const matchers = entries.map((entry) => entry.matcher).sort().join(",");
if (matchers !== "logout,other,prompt_input_exit") process.exit(1);
if (!entries.every((entry) => entry.hooks.every((h) => h.timeout === 60 && h.command.includes("hyper-drive-session-end.sh")))) process.exit(1);
' "$PLUGIN_DIR/hooks/hooks.json"
assert_ok 'SessionEnd never matches clear or resume' "$NODE" -e '
const entries = require(process.argv[1]).hooks.SessionEnd;
for (const reason of ["clear", "resume"])
  if (entries.some((entry) => entry.matcher === "*" || entry.matcher === "" || new RegExp(`^(?:${entry.matcher})$`).test(reason))) process.exit(1);
' "$PLUGIN_DIR/hooks/hooks.json"

# ---- The real CLI ---------------------------------------------------------
if [[ ! -x "$REAL_HYPER" ]] || ! "$REAL_HYPER" space lib-path >/dev/null 2>&1; then
  skip 'real CLI cases' 'hyper CLI is not built'
  finish
fi
mkdir -p "$FIX/real-bin"
printf '#!/bin/sh\nexec "%s" "$@"\n' "$REAL_HYPER" > "$FIX/real-bin/hyper"
chmod +x "$FIX/real-bin/hyper"
export PATH="$FIX/real-bin:$SYSTEM_PATH"
remote="$FIX/remote.git"
git init -q --bare "$remote"
printf 'remote = "%s"\n' "$remote" > "$HYPER_DRIVE_CONFIG"
real="$FIX/real"
make_bare_space "$real"
mkdir -p "$real/notes"
printf 'seed\n' > "$real/notes/seed.md"
(cd "$FIX" && hyper space init "$real" --cadence session-end+push >"$FIX/init.out" 2>&1) || cat "$FIX/init.out"
assert_ok 'temporary space initialised' test -d "$real/.hyper/space.git"
sg() { git --git-dir="$real/.hyper/space.git" --work-tree="$real" "$@"; }
sg config gc.auto 0
log="$real/.hyper/space.git/session-end.log"
lines() { if [[ -f "$log" ]]; then wc -l < "$log" | tr -d ' '; else echo 0; fi; }
# Every detached worker writes exactly one log line: wait for the count.
logged() { [[ "$(lines)" -ge "$1" ]]; }

before="$(sg rev-list --count HEAD)"
printf 'cleared\n' > "$real/notes/cleared.md"
for reason in clear resume; do
  run_hook "$real/notes" "{\"session_id\":\"ba0efb18-103b-43b5-b5a0-fc3a08a2b00b\",\"reason\":\"$reason\"}" >/dev/null
done
assert_ok 'clear and resume workers finish' wait_for 30 logged 2
assert_eq 'clear and resume commit nothing' "$before" "$(sg rev-list --count HEAD)"
assert_eq 'clear and resume are logged as ignored' 'ignored,ignored' "$(cut -f 3 "$log" | paste -sd , -)"

# Three hooks at once, three rounds: every file committed and pushed.
for round in 1 2 3; do
  for index in 1 2 3; do printf '%s\n' "$round.$index" > "$real/notes/r$round-$index.md"; done
  for index in 1 2 3; do run_hook "$real/notes" >/dev/null & done
  wait
  wait_for 90 logged $((2 + round * 3))
done
missing=0
for round in 1 2 3; do for index in 1 2 3; do
  sg cat-file -e "HEAD:notes/r$round-$index.md" 2>/dev/null || missing=$((missing + 1))
done; done
assert_eq 'three concurrent hooks per round: all nine files committed' 0 "$missing"
assert_eq 'every concurrent hook logged one line' 11 "$(lines)"
assert_eq 'no concurrent hook failed' '' "$(tail -n 9 "$log" | cut -f 3 | grep -vE '^(committed|nothing)$')"
assert_eq 'the remote has the local tip' "$(sg rev-parse HEAD)" "$(git --git-dir="$remote" rev-parse refs/heads/space/real)"
assert_ok 'git fsck is clean' git --git-dir="$real/.hyper/space.git" fsck --no-progress
assert_ok 'no lock is left behind' test ! -e "$real/.hyper/space.git/hyper.lock" -a ! -e "$real/.hyper/space.git/index.lock"

# A refusal: one log line, shown by status, nothing staged, nothing pushed.
pushed="$(git --git-dir="$remote" rev-parse refs/heads/space/real)"
printf 'SECRET=1\n' > "$real/notes/.env"
run_hook "$real/notes" >/dev/null
wait_for 30 logged 12
assert_eq 'refusal is logged as refused' refused "$(tail -n 1 "$log" | cut -f 3)"
assert_contains 'refusal log names the secret' "$(tail -n 1 "$log")" 'notes/.env'
assert_eq 'refusal stages nothing' '' "$(sg diff --cached --name-only)"
assert_eq 'refusal pushes nothing' "$pushed" "$(git --git-dir="$remote" rev-parse refs/heads/space/real)"
status_text="$(cd "$real/notes" && hyper space status 2>&1)"
assert_contains 'status reports the failed session end' "$status_text" 'Last session end ('
assert_contains 'status gives the refusal reason' "$status_text" 'refused: refusing to commit'
status_json="$(cd "$real/notes" && hyper space status --json 2>/dev/null)"
assert_eq 'status --json reports the failure' refused "$(printf '%s' "$status_json" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sessionEndFailure?.outcome))')"
rm -f "$real/notes/.env"
run_hook "$real/notes" >/dev/null
wait_for 30 logged 13
status_text="$(cd "$real/notes" && hyper space status 2>&1)"
assert_not_contains 'a later success clears the status line' "$status_text" 'Last session end'
perl -e 'select undef, undef, undef, 0.5'
assert_eq 'no detached worker is left running' '' "$(pgrep -f "$FIX/" || true)"
finish
