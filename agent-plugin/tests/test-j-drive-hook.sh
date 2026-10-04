#!/usr/bin/env bash
# SessionEnd cadence contract. run.sh discovers test-*.sh automatically.
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
export HYPER_HOME="$FIX/hyper-home" HYPER_DRIVE_CONFIG="$FIX/drive.toml"
export XDG_CONFIG_HOME="$FIX/config" CLAUDE_CONFIG_DIR="$FIX/claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
HOOK="$SCRIPTS_DIR/hyper-drive-session-end.sh"
NODE="$(command -v node)"
export HOOK_LOG="$FIX/calls" HOOK_STDIN="$FIX/stdin"
export REAL_LIB="$PLUGIN_DIR/../packages/drive/scripts/hyper-lib.sh"
mkdir -p "$FIX/bin"
cat > "$FIX/bin/hyper" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == 'space lib-path' ]]; then printf '%s\n' "$REAL_LIB"; exit 0; fi
printf '%s\n' "$*" >> "$HOOK_LOG"
if [[ "$*" == 'space commit --session-end' ]]; then
  cat > "$HOOK_STDIN"
  if [[ "${REFUSE:-0}" == 1 ]]; then printf 'hyperdrive: secret refusal\nsecond line\n' >&2; exit 2; fi
fi
if [[ "$*" == 'space push' && "${PUSH_FAIL:-0}" == 1 ]]; then
  printf 'hyperdrive: push refused\nsecond line\n' >&2; exit 2
fi
STUB
chmod +x "$FIX/bin/hyper"
export PATH="$FIX/bin:/usr/bin:/bin"
payload='{"session_id":"ba0efb18-103b-43b5-b5a0-fc3a08a2b00b","unknown":true}'
run_hook() { (cd "$1" && printf '%s' "$payload" | bash "$HOOK" 2>&1); }
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
assert_ok 'unset local cadence never calls commit' test ! -f "$HOOK_LOG"
git config --global --unset hyper.cadence
git --git-dir="$space/.hyper/space.git" config hyper.cadence manual
out="$(run_hook "$space")"
assert_eq 'manual cadence is silent' '' "$out"
assert_ok 'manual cadence never calls commit' test ! -f "$HOOK_LOG"
out="$(PATH=/usr/bin:/bin run_hook "$space/notes")"
assert_eq 'manual cadence with missing CLI is silent' '' "$out"
git --git-dir="$space/.hyper/space.git" config hyper.cadence session-end
out="$(PATH=/usr/bin:/bin run_hook "$space/notes")"; rc=$?
assert_eq 'missing CLI exits zero' 0 "$rc"
assert_eq 'missing CLI is exactly the expected line, without a marker' 'hyperdrive: cadence is session-end but the hyper CLI is not installed' "$out"
out="$(PATH=/usr/bin:/bin run_hook "$FIX/outside")"
assert_eq 'missing CLI outside space is silent' '' "$out"
out="$(run_hook "$space/notes")"; rc=$?
assert_eq 'commit succeeds' 0 "$rc"
assert_eq 'successful hook is silent' '' "$out"
assert_eq 'commit argv' 'space commit --session-end' "$(<"$HOOK_LOG")"
assert_eq 'stdin forwarded exactly' "$payload" "$(<"$HOOK_STDIN")"
: > "$HOOK_LOG"
git --git-dir="$space/.hyper/space.git" config hyper.cadence session-end+push
out="$(run_hook "$space")"
assert_eq 'commit precedes push' $'space commit --session-end\nspace push' "$(<"$HOOK_LOG")"
: > "$HOOK_LOG"
out="$(REFUSE=1 run_hook "$space")"; rc=$?
assert_eq 'commit refusal never fails session' 0 "$rc"
assert_eq 'commit refusal never pushes' 'space commit --session-end' "$(<"$HOOK_LOG")"
assert_eq 'commit refusal is one line' 1 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
assert_contains 'commit refusal keeps the reason' "$out" 'secret refusal'
out="$(PUSH_FAIL=1 run_hook "$space")"; rc=$?
assert_eq 'push refusal never fails session' 0 "$rc"
assert_eq 'push refusal is one line' 1 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
assert_contains 'push refusal keeps the reason' "$out" 'push refused'
# Registration is part of the contract, not merely script behavior.
assert_ok 'SessionEnd is registered with timeout 60' "$NODE" -e '
const hooks = require(process.argv[1]).hooks.SessionEnd;
if (!hooks.some(entry => entry.hooks.some(h => h.timeout === 60 && h.command.includes("hyper-drive-session-end.sh")))) process.exit(1);
' "$PLUGIN_DIR/hooks/hooks.json"
finish
