#!/usr/bin/env bash
# Row L — legacy (pre-rename "hyperdev") compatibility. Spaces adopted under
# the old names must keep working unchanged, and adopt --apply must migrate
# them — announced per move, never deleting anything.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
# hyper-lib.sh turns on strict mode when sourced; the harness must not
# abort on the first failing assertion, so switch it back off.
source "$SCRIPTS_DIR/hyper-lib.sh"
set +eu
set +o pipefail

CHECK="$SCRIPTS_DIR/hyper-check.sh"
ADOPT="$SCRIPTS_DIR/hyper-adopt.sh"
AUDIT="$SCRIPTS_DIR/hyper-audit.sh"
ERR="$FIX/hook-stderr"

run_check() {
  printf '{"tool_input":{"file_path":"%s"}}' "$1" \
    | bash "$CHECK" >/dev/null 2>"$ERR"
}

# --- L1: detection accepts the legacy HYPERDEV.md marker -------------------

d="$FIX/l1"; mkdir -p "$d"; git init -q --bare "$d/.git"
touch "$d/HYPERDEV.md"
assert_eq "bare + legacy HYPERDEV.md marker -> bare" "bare" "$(space_layout "$d")"
assert_ok "legacy-marked bare repo is a space" is_space "$d"

# ...and, like HYPER.md, the legacy marker gives an ordinary checkout nothing.
d="$FIX/l1b"; make_checkout "$d"
touch "$d/HYPERDEV.md"
assert_fails "checkout + legacy marker is not a space" is_space "$d"

# --- L2: check hook falls back to legacy .claude/hyperdev.json -------------

d="$FIX/l2"; mkdir -p "$d/.claude" "$d/src"; echo 'export {}' > "$d/src/app.ts"
cat > "$d/.claude/hyperdev.json" <<'EOF'
{ "check": { "enabled": true, "command": "echo LEGACY-CFG-FIRED >&2; exit 1" } }
EOF
run_check "$d/src/app.ts"
assert_eq "legacy hyperdev.json config still drives the hook" 2 "$?"
assert_contains "legacy config's check actually ran" "$(cat "$ERR")" "LEGACY-CFG-FIRED"

# --- L3: hyper.json wins when both configs exist ---------------------------

d="$FIX/l3"; mkdir -p "$d/.claude" "$d/src"; echo 'export {}' > "$d/src/app.ts"
cat > "$d/.claude/hyper.json" <<'EOF'
{ "check": { "enabled": true, "command": "echo NEW-CFG-FIRED >&2; exit 1" } }
EOF
cat > "$d/.claude/hyperdev.json" <<'EOF'
{ "check": { "enabled": true, "command": "echo LEGACY-CFG-FIRED >&2; exit 1" } }
EOF
run_check "$d/src/app.ts"
assert_eq "with both configs the hook still fires" 2 "$?"
err="$(cat "$ERR")"
assert_contains "hyper.json won"              "$err" "NEW-CFG-FIRED"
assert_not_contains "hyperdev.json ignored"   "$err" "LEGACY-CFG-FIRED"

# --- L4: adopt --apply migrates a fully legacy space -----------------------

d="$FIX/l4"; make_bare_space "$d"
printf '# legacy marker body\n' > "$d/HYPERDEV.md"
mkdir -p "$d/.hyperdev/memory"
printf 'legacy layout memory\n' > "$d/.hyperdev/memory/hyperdev-layout.md"
printf '# Memory index\n\n- [Space layout](hyperdev-layout.md) — old line\n' \
  > "$d/.hyperdev/memory/MEMORY.md"

out="$(bash "$ADOPT" "$d" --apply 2>&1)"
rc=$?
assert_eq "adopt --apply on legacy space exits 0" 0 "$rc"

assert_contains "marker migration announced"   "$out" "migrated HYPERDEV.md → HYPER.md"
assert_contains "metadata migration announced" "$out" "migrated .hyperdev/ → .hyper/"
assert_ok    "HYPER.md exists after migration"       test -f "$d/HYPER.md"
assert_fails "HYPERDEV.md is gone (moved, not kept)" test -e "$d/HYPERDEV.md"
assert_ok    ".hyper/ exists after migration"        test -d "$d/.hyper"
assert_fails ".hyperdev/ is gone (moved, not kept)"  test -e "$d/.hyperdev"

# mv, not regenerate: the user's marker content survives the move
assert_eq "marker content preserved by the move" \
  "# legacy marker body" "$(cat "$d/HYPER.md")"

# the old seed name inside the migrated dir is renamed and re-indexed
assert_ok    "memory seed renamed to hyper-layout.md" \
  test -f "$d/.hyper/memory/hyper-layout.md"
assert_fails "no hyperdev-layout.md remains" \
  test -e "$d/.hyper/memory/hyperdev-layout.md"
assert_eq "seed content preserved by the move" \
  "legacy layout memory" "$(cat "$d/.hyper/memory/hyper-layout.md")"
idx="$(cat "$d/.hyper/memory/MEMORY.md")"
assert_contains     "index points at the new seed name" "$idx" "hyper-layout.md"
assert_not_contains "index has no stale legacy line"    "$idx" "hyperdev-layout.md"

# settings refreshed to the new metadata path
assert_contains "autoMemoryDirectory points at .hyper/memory" \
  "$(cat "$d/.claude/settings.json")" "$d/.hyper/memory"

# --- L5: both present -> warn, touch nothing -------------------------------

d="$FIX/l5"; make_bare_space "$d"
printf 'new marker\n'    > "$d/HYPER.md"
printf 'legacy marker\n' > "$d/HYPERDEV.md"
mkdir -p "$d/.hyper" "$d/.hyperdev"
printf 'legacy meta\n' > "$d/.hyperdev/state"

out="$(bash "$ADOPT" "$d" --apply 2>&1)"
assert_eq "both-present adopt --apply still exits 0" 0 "$?"
assert_contains "marker collision warned"   "$out" "both HYPER.md and legacy HYPERDEV.md"
assert_contains "metadata collision warned" "$out" "both .hyper/ and legacy .hyperdev/"
assert_eq "HYPER.md untouched"    "new marker"    "$(cat "$d/HYPER.md")"
assert_eq "HYPERDEV.md untouched" "legacy marker" "$(cat "$d/HYPERDEV.md")"
assert_ok "legacy metadata dir still intact" test -f "$d/.hyperdev/state"

# --- L6: audit reports legacy names as info, pointing at adopt --apply -----

d="$FIX/l6"; make_bare_space "$d"
touch "$d/HYPERDEV.md"
mkdir -p "$d/.hyperdev" "$d/.claude"
echo '{}' > "$d/.claude/hyperdev.json"
out="$(bash "$AUDIT" "$d" 2>&1)"
assert_eq "audit on legacy space exits 0" 0 "$?"
assert_contains "audit flags the legacy marker"   "$out" "legacy HYPERDEV.md marker"
assert_contains "audit flags the legacy metadata" "$out" "legacy .hyperdev/ metadata dir"
assert_contains "audit flags the legacy config"   "$out" "legacy .claude/hyperdev.json"
assert_contains "audit points at the migration"   "$out" "--apply"
assert_not_contains "legacy marker satisfies the marker check (no missing-marker warning)" \
  "$out" "no HYPER.md marker"

finish
