#!/usr/bin/env bash
# Row U — no two skills claim the same trigger phrase (AC-2, C-8). Lists every
# double-quoted phrase in every skill's `description:` line and fails on a
# phrase that two different skills carry (compared case-insensitively).

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

all="$FIX/triggers.txt"
: > "$all"
count=0
for f in "$PLUGIN_DIR"/skills/*/SKILL.md; do
  name="$(basename "$(dirname "$f")")"
  desc="$(awk 'NR == 1 && /^---$/ { fm = 1; next } fm && /^---$/ { exit } fm && /^description:/ { print }' "$f")"
  [[ -n "$desc" ]] || { fail "skills/$name has a description"; continue; }
  n=0
  while IFS= read -r trig; do
    [[ -n "$trig" ]] || continue
    printf '%s\t%s\n' "$(printf '%s' "$trig" | tr '[:upper:]' '[:lower:]')" "$name" >> "$all"
    n=$((n + 1))
  done < <(printf '%s\n' "$desc" | grep -oE '"[^"]+"' | sed 's/^"//; s/"$//')
  count=$((count + n))
  if [[ $n -gt 0 ]]; then pass "skills/$name lists trigger phrases ($n)"; else fail "skills/$name lists trigger phrases"; fi
done

assert_ok "the skills carry trigger phrases at all ($count)" test "$count" -gt 0

# A phrase repeated by two skills; the same skill repeating itself is not a clash.
dups="$(sort -u "$all" | cut -f1 | sort | uniq -d | tr '\n' ';')"
assert_eq "no trigger phrase is claimed by two skills" "" "$dups"

# The check itself must be able to fail: a fixture pair that does clash.
printf 'ship this\tship\nship this\tlead\nother\tship\n' > "$FIX/clash.txt"
clash="$(sort -u "$FIX/clash.txt" | cut -f1 | sort | uniq -d)"
assert_eq "the duplicate detector flags a shared phrase" "ship this" "$clash"

finish
