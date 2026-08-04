#!/usr/bin/env bash
# Row C — write_memory_seed idempotency: repeated runs keep exactly one index
# line, leave no .tmp litter, and an index consisting of ONLY the hyper
# line survives the rewrite (the grep -v of everything must not kill the run).
# Plus the settings wiring: scaffold_dirs writes an absolute
# autoMemoryDirectory and merges into a pre-existing settings.json.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
source "$SCRIPTS_DIR/hyper-lib.sh"
set +eu
set +o pipefail

# json_key <file> <key> — print one top-level key's value via node.
json_key() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]])' "$1" "$2"
}

# The seed lives at a space root, which is always bare now.
d="$FIX/c1"; make_bare_space "$d"

write_memory_seed "$d" proj
write_memory_seed "$d" proj
write_memory_seed "$d" proj

idx="$d/.hyper/memory/MEMORY.md"
assert_ok "memory file written" test -f "$d/.hyper/memory/hyper-layout.md"
assert_ok "index written" test -f "$idx"
assert_eq "exactly one index line after 3 consecutive runs" \
  1 "$(grep -c 'hyper-layout.md' "$idx")"
assert_eq "no .tmp litter left behind" \
  0 "$(find "$d/.hyper" -name '*.tmp' | wc -l | tr -d ' ')"

# Index containing ONLY the hyper line: grep -v filters everything out and
# exits 1; the rewrite must still complete and end with exactly one line.
# Run under the same strict mode as the real caller (adopt is set -euo
# pipefail), so a bare failing grep aborts the run instead of being shrugged
# off by this harness.
printf -- '- [Space layout](hyper-layout.md) — old entry\n' > "$idx"
(
  set -euo pipefail
  source "$SCRIPTS_DIR/hyper-lib.sh"
  write_memory_seed "$d" proj
)
rc=$?
assert_eq "run succeeds when index holds only the hyper line" 0 "$rc"
assert_eq "still exactly one index line" 1 "$(grep -c 'hyper-layout.md' "$idx")"
assert_eq "index has no other content" 1 "$(wc -l < "$idx" | tr -d ' ')"

# ---------------------------------------------------------------------------
# Settings wiring: a fresh scaffold must produce .claude/settings.json whose
# autoMemoryDirectory is absolute (Claude Code rejects relative values) and
# ends in /.hyper/memory, with the directory itself created.
# ---------------------------------------------------------------------------
d2="$FIX/c2"; make_bare_space "$d2"
scaffold_dirs "$d2" >/dev/null

s2="$d2/.claude/settings.json"
assert_ok "scaffold writes .claude/settings.json" test -f "$s2"
assert_ok "scaffold creates .hyper/memory/" test -d "$d2/.hyper/memory"
val="$(json_key "$s2" autoMemoryDirectory)"
case "$val" in
  /*) pass "autoMemoryDirectory is absolute" ;;
  *)  fail "autoMemoryDirectory is absolute (got '$val')" ;;
esac
assert_eq "autoMemoryDirectory ends in /.hyper/memory" \
  "$d2/.hyper/memory" "$val"

# A pre-existing settings.json with another key is merged, never clobbered:
# foo survives and autoMemoryDirectory is added beside it.
d3="$FIX/c3"; make_bare_space "$d3"
mkdir -p "$d3/.claude"
printf '{"foo":1}\n' > "$d3/.claude/settings.json"
scaffold_dirs "$d3" >/dev/null

s3="$d3/.claude/settings.json"
assert_eq "merge keeps the pre-existing key" 1 "$(json_key "$s3" foo)"
assert_eq "merge sets autoMemoryDirectory" \
  "$d3/.hyper/memory" "$(json_key "$s3" autoMemoryDirectory)"

finish
