#!/usr/bin/env bash
# Row W — docs/ship.md is the ship reference, and it must stay complete: every
# key in skills/ship/defaults.yml (as a dotted path) and every executable in
# scripts/ship/ (and each mux backend) is mentioned in it, and every script
# prints its usage and exits 0 for --help.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

doc="$PLUGIN_DIR/docs/ship.md"
defaults="$PLUGIN_DIR/skills/ship/defaults.yml"
ship_dir="$PLUGIN_DIR/scripts/ship"

assert_ok "docs/ship.md exists" test -s "$doc"
assert_ok "jq is available" command -v jq
assert_ok "yq is available" command -v yq
doc_text="$(cat "$doc")"

# Every leaf key of defaults.yml, flattened to a dotted path. Arrays are leaves
# (their members are not keys); an empty object counts as a leaf too.
missing=""
while IFS= read -r key; do
  [[ -n "$key" ]] || continue
  case "$doc_text" in
    *"$key"*) ;;
    *) missing="$missing $key" ;;
  esac
done < <(yq -o=json '.' "$defaults" | jq -r '
  [paths(type != "object" or length == 0)] | map(select(all(.[]; type == "string")))
  | map(join(".")) | unique[]')
assert_eq "every defaults.yml key is documented in docs/ship.md" "" "$missing"

# The documented keys are real: a flattened path is also what ship-config
# --get accepts, so check that the table mentions the layering too.
assert_contains "docs/ship.md names the three config layers" "$doc_text" "~/.config/hyper/ship.yml"
assert_contains "docs/ship.md names the project layer" "$doc_text" ".hyper/ship.yml"

# Every ship-* command in scripts/ship/ (the lib*.sh files are sourced, not run) is mentioned, and prints usage.
undoc="" bad_help="" no_usage="" n=0
for f in "$ship_dir"/ship-*; do
  [[ -f "$f" && -x "$f" ]] || continue
  name="$(basename "$f")"
  n=$((n + 1))
  case "$doc_text" in
    *"$name"*) ;;
    *) undoc="$undoc $name" ;;
  esac
  out="$(SHIP_MUX_TEST=1 bash "$f" --help </dev/null 2>&1)"; rc=$?
  [[ $rc -eq 0 ]] || bad_help="$bad_help $name($rc)"
  case "$out" in
    *[Uu]sage*|*"$name"*) ;;
    *) no_usage="$no_usage $name" ;;
  esac
done
assert_ok "found the ship scripts" test "$n" -ge 9
assert_eq "every scripts/ship executable is documented in docs/ship.md" "" "$undoc"
assert_eq "every scripts/ship executable exits 0 for --help" "" "$bad_help"
assert_eq "every scripts/ship executable prints usage for --help" "" "$no_usage"

# Each mux backend is mentioned as mux/<name>.
undoc=""
for f in "$ship_dir"/mux/*; do
  [[ -f "$f" ]] || continue
  case "$doc_text" in
    *"mux/$(basename "$f")"*) ;;
    *) undoc="$undoc $(basename "$f")" ;;
  esac
done
assert_eq "every mux backend is documented in docs/ship.md" "" "$undoc"

# Linked from where a reader starts.
for f in README.md commands/help.md skills/ship/SKILL.md; do
  assert_contains "$f links docs/ship.md" "$(cat "$PLUGIN_DIR/$f")" "docs/ship.md"
done

finish
