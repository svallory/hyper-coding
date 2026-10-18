#!/usr/bin/env bash
# Row D — the PostToolUse check hook (hyper-check.sh), driven exactly the
# way Claude Code drives it: hook JSON on stdin, verdict in the exit code,
# feedback on stderr. The invariant that matters most: a healthy edit must
# never fail — every ambiguous situation exits 0.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

HOOK="$SCRIPTS_DIR/hyper-check.sh"
ERR="$FIX/hook-stderr"

# run_hook <edited-file> — feeds real hook JSON; stderr lands in $ERR
run_hook() {
  printf '{"tool_input":{"file_path":"%s"}}' "$1" \
    | bash "$HOOK" >/dev/null 2>"$ERR"
}

# new_proj <name> — project dir with .claude/ and an editable source file
new_proj() {
  local p="$FIX/$1"
  mkdir -p "$p/.claude" "$p/src"
  echo 'export {}' > "$p/src/app.ts"
  echo '# notes'   > "$p/src/notes.md"
  echo "$p"
}

# D1: no config anywhere above the file -> silent pass
p="$FIX/d1"; mkdir -p "$p/src"; echo x > "$p/src/app.ts"
run_hook "$p/src/app.ts"
assert_eq "no config -> exit 0" 0 "$?"

# D2: enabled check that passes -> 0
p="$(new_proj d2)"
cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "true" } }
EOF
run_hook "$p/src/app.ts"
assert_eq "enabled passing check -> exit 0" 0 "$?"

# D3: enabled check that fails -> 2, with the tool's output on stderr
p="$(new_proj d3)"
cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "echo BOOM-marker-42 >&2; exit 1" } }
EOF
run_hook "$p/src/app.ts"
assert_eq "enabled failing check -> exit 2" 2 "$?"
err="$(cat "$ERR")"
assert_contains "stderr names the failure" "$err" "project check failed"
assert_contains "stderr carries the tool output" "$err" "BOOM-marker-42"

# D4: extension filter — editing a .md file must not trigger a .ts check
p="$(new_proj d4)"
cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "exit 1", "extensions": [".ts", ".tsx"] } }
EOF
run_hook "$p/src/notes.md"
assert_eq "extension filter skips non-matching file" 0 "$?"

# D5: checks array — each entry routes by its own extension filter
p="$(new_proj d5)"
cat > "$p/.claude/hyper.json" <<'EOF'
{
  "checks": [
    { "command": "echo MD-CHECK-FIRED >&2; exit 1", "extensions": [".md"] },
    { "command": "echo TS-CHECK-FIRED >&2; exit 1", "extensions": [".ts"] }
  ]
}
EOF
run_hook "$p/src/app.ts"
assert_eq "matching array entry fails the edit" 2 "$?"
err="$(cat "$ERR")"
assert_contains "the .ts check fired" "$err" "TS-CHECK-FIRED"
assert_not_contains "the .md check did not" "$err" "MD-CHECK-FIRED"

# D6: first failure stops the run — the second check must never execute
p="$(new_proj d6)"
cat > "$p/.claude/hyper.json" <<EOF
{
  "checks": [
    { "command": "echo FIRST-FAILED >&2; exit 1", "extensions": [".ts"] },
    { "command": "touch '$p/SECOND_RAN'; exit 1", "extensions": [".ts"] }
  ]
}
EOF
run_hook "$p/src/app.ts"
assert_eq "first failing check exits 2" 2 "$?"
assert_contains "first check's output reported" "$(cat "$ERR")" "FIRST-FAILED"
assert_fails "second check never ran" test -e "$p/SECOND_RAN"

# D7: a command containing single quotes survives the JSON -> base64 -> bash
# round trip intact (no eval, no quote stripping)
p="$(new_proj d7)"
cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "printf %s \"quote's-intact\" >&2; exit 1" } }
EOF
run_hook "$p/src/app.ts"
assert_eq "single-quoted command still fails the edit" 2 "$?"
assert_contains "single quote survived quoting" "$(cat "$ERR")" "quote's-intact"

# D8: a command that cannot run (127) is an environment problem, reported as
# "not runnable" rather than as a code failure
p="$(new_proj d8)"
cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "/nonexistent/hyper-test-cmd-xyzzy" } }
EOF
run_hook "$p/src/app.ts"
assert_eq "nonexistent command -> exit 2" 2 "$?"
assert_contains "reported as not runnable, not as a check failure" \
  "$(cat "$ERR")" "not runnable"

# D9: broken JSON config disables the hook instead of guessing
p="$(new_proj d9)"
echo '{ this is not json' > "$p/.claude/hyper.json"
run_hook "$p/src/app.ts"
assert_eq "broken JSON config -> exit 0" 0 "$?"

# D10: a check that outruns its timeout is reported as a timeout, not as a
# type error that never happened. Requires a timeout binary; the hook itself
# degrades to "no limit" without one, so skip rather than hang.
if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
  p="$(new_proj d10)"
  cat > "$p/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "sleep 5", "timeout": 1 } }
EOF
  run_hook "$p/src/app.ts"
  assert_eq "timed-out check -> exit 2" 2 "$?"
  assert_contains "reported as a timeout" "$(cat "$ERR")" "timed out"
else
  skip "timed-out check -> exit 2" "no timeout/gtimeout on this machine"
  skip "reported as a timeout"     "no timeout/gtimeout on this machine"
fi

finish
