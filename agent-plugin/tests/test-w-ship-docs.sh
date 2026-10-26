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

# The Configuration section of the doc: from its heading to the next "## ".
config_section="$(awk '/^## Configuration$/ {on = 1; next} /^## / {on = 0} on' "$doc")"
assert_ok "docs/ship.md has a Configuration section" test -n "$config_section"

# The first cell of every table row in that section, e.g. "`base`" or "`a`, `b`".
first_cells="$(printf '%s\n' "$config_section" | awk -F'|' '/^\|/ {print $2}')"

# Every leaf key of defaults.yml, flattened to a dotted path, has a table row in
# the Configuration section (the key in backticks in the row's first cell). Arrays
# are leaves (their members are not keys); an empty object counts as a leaf too.
missing=""
while IFS= read -r key; do
  [[ -n "$key" ]] || continue
  case "$first_cells" in
    *"\`$key\`"*) ;;
    *) missing="$missing $key" ;;
  esac
done < <(yq -o=json '.' "$defaults" | jq -r '
  [paths(type != "object" or length == 0)] | map(select(all(.[]; type == "string")))
  | map(join(".")) | unique[]')
assert_eq "every defaults.yml key has a row in the Configuration table" "" "$missing"

# All three layers are named in that section. The tilde is literal text here.
# shellcheck disable=SC2088
for layer in "skills/ship/defaults.yml" "~/.config/hyper/ship.yml" "<space root>/.hyper/ship.yml"; do
  assert_contains "Configuration names the layer $layer" "$config_section" "$layer"
done

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
  # usage text: the word "usage", or a synopsis line that starts with the command and its arguments
  if ! grep -qiE "usage" <<<"$out" && ! grep -qE "^[[:space:]]*${name}[[:space:]]+(\\[|<|-|[a-z]+[[:space:]]*[<\\[-])" <<<"$out"; then
    no_usage="$no_usage $name"
  fi
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
