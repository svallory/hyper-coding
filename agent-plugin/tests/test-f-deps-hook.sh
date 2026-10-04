#!/usr/bin/env bash
# Row F — the deps friction hook (hyper-deps.sh): fires exactly once per
# new dependency, and only when the project opted in and the manifest has a
# committed baseline to diff against.
#
# The once-per-session dedup file is keyed on the payload's session_id when
# present, else the hook's $PPID, in ${TMPDIR:-/tmp}. These payloads carry no
# session_id, so to make the PPID fallback deterministic both invocations of
# an assertion pair run inside ONE wrapper shell (same parent PID both
# times); the wrapper clears its own dedup file first in case the PID was
# recycled.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

HOOK="$SCRIPTS_DIR/hyper-deps.sh"

# F1: committed package.json + opt-in, then a new dependency appears
p="$FIX/f1"; git init -q "$p"
mkdir -p "$p/.claude"
echo '{ "deps": { "enabled": true } }' > "$p/.claude/hyper.json"
cat > "$p/package.json" <<'EOF'
{ "name": "f1", "dependencies": { "left-pad": "1.0.0" } }
EOF
git -C "$p" add package.json
git -C "$p" commit -qm baseline
cat > "$p/package.json" <<'EOF'
{ "name": "f1", "dependencies": { "left-pad": "1.0.0", "brand-new-dep": "2.0.0" } }
EOF
printf '{"tool_input":{"file_path":"%s"}}' "$p/package.json" > "$FIX/f1-input.json"

cat > "$FIX/f1-wrapper.sh" <<EOF
#!/usr/bin/env bash
rm -f "\${TMPDIR:-/tmp}/hyper-deps-\$\$"
bash "$HOOK" < "$FIX/f1-input.json" >/dev/null 2> "$FIX/f1-err1"
echo "first=\$?"
bash "$HOOK" < "$FIX/f1-input.json" >/dev/null 2> "$FIX/f1-err2"
echo "second=\$?"
rm -f "\${TMPDIR:-/tmp}/hyper-deps-\$\$"
EOF
out="$(bash "$FIX/f1-wrapper.sh")"
assert_contains "new dependency -> exit 2" "$out" "first=2"
assert_contains "stderr names the dependency" "$(cat "$FIX/f1-err1")" "brand-new-dep"
assert_contains "identical rerun in the same session -> exit 0 (dedup)" "$out" "second=0"
assert_eq "deduped rerun says nothing" "" "$(cat "$FIX/f1-err2")"

# F2: same edit, but the project never opted in -> silent pass
p="$FIX/f2"; git init -q "$p"
cat > "$p/package.json" <<'EOF'
{ "name": "f2", "dependencies": {} }
EOF
git -C "$p" add package.json
git -C "$p" commit -qm baseline
cat > "$p/package.json" <<'EOF'
{ "name": "f2", "dependencies": { "sneaky-dep": "1.0.0" } }
EOF
printf '{"tool_input":{"file_path":"%s"}}' "$p/package.json" \
  | bash "$HOOK" >/dev/null 2>&1
assert_eq "no opt-in -> exit 0" 0 "$?"

# F3: manifest not in HEAD — nothing to diff against, so every dep would be
# "new"; the hook must skip instead of spamming
p="$FIX/f3"; git init -q "$p"
mkdir -p "$p/.claude"
echo '{ "deps": { "enabled": true } }' > "$p/.claude/hyper.json"
echo readme > "$p/README.md"
git -C "$p" add README.md
git -C "$p" commit -qm init
cat > "$p/package.json" <<'EOF'
{ "name": "f3", "dependencies": { "everything-is-new": "1.0.0" } }
EOF
printf '{"tool_input":{"file_path":"%s"}}' "$p/package.json" \
  | bash "$HOOK" >/dev/null 2>&1
assert_eq "manifest not in HEAD -> exit 0" 0 "$?"

# F-PATH: a project's own bin/node or bin/git never runs from this hook, even
# with relative entries ahead of the real ones on PATH.
p="$FIX/fpath"; git init -q "$p"
mkdir -p "$p/.claude"
echo '{ "deps": { "enabled": true } }' > "$p/.claude/hyper.json"
echo '{ "name": "fpath", "dependencies": {} }' > "$p/package.json"
git -C "$p" add -A
git -C "$p" commit -qm baseline
echo '{ "name": "fpath", "dependencies": { "path-dep": "1.0.0" } }' > "$p/package.json"
for d in "$p/bin" "$p"; do
  plant_binaries "$d" "$FIX/planted.log" node git bash sh dirname sed cat head tr
done
bash_bin="$(command -v bash)"
rm -f "$FIX/planted.log"
err="$(cd "$p" && printf '{"session_id":"fpath-%s","tool_input":{"file_path":"%s"}}' "$$" "$p/package.json" \
  | PATH="./bin:.::$PATH" "$bash_bin" "$HOOK" 2>&1 >/dev/null)"
assert_contains "hostile PATH: the new dependency is still reported" "$err" "path-dep"
assert_eq "hostile PATH: no planted binary ran from the hook" "" "$(cat "$FIX/planted.log" 2>/dev/null)"

finish
