#!/usr/bin/env bash
# Row S — the plugin's skills after the team/plan-* removal: exactly the twelve
# skills exist, nothing generated or deleted is left behind or referenced, every
# ${CLAUDE_PLUGIN_ROOT} path a skill names exists (C-10), and no file outside the
# Herdr backend calls the Herdr command (C-11).

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

SKILLS="$PLUGIN_DIR/skills"

# --- the skill set (AC-1) ---------------------------------------------------------------
want="auto canvas hyper hyper-gen hyper-tooling kickoff land plan ship spec test-engineer unit"
want="$(printf '%s\n' $want | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
have="$(for d in "$SKILLS"/*/; do basename "$d"; done | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
assert_eq "skills/ holds exactly the twelve skills" "$want" "$have"

for n in $want; do
  f="$SKILLS/$n/SKILL.md"
  assert_ok "skills/$n/SKILL.md exists" test -f "$f"
  assert_eq "skills/$n frontmatter name is its directory" "$n" "$(sed -n '2s/^name: *//p' "$f")"
  assert_eq "skills/$n has no generated-file header" "0" "$(grep -ci 'generated from' "$f")"
done

# --- removed things are gone (AC-1) -----------------------------------------------------
# Built from pieces so this file does not match itself.
t=te; t+=am
for p in "skills/$t" skills/plan-define skills/plan-design skills/plan-decompose \
  skills/plan-develop commands/plan.md "commands/$t-lead.md" "commands/$t.md" \
  "scripts/sync-$t-skill.sh" "tests/test-s-$t-skill.sh"; do
  assert_fails "$p is gone" test -e "$PLUGIN_DIR/$p"
done

pat="skills/$t|$t-lead|sync-$t-skill|/hyper:pl""an"
hits=""
while IFS= read -r f; do
  rel="${f#"$PLUGIN_DIR"/}"
  case "$rel" in CHANGELOG.md|*/CHANGELOG.md) continue ;; esac
  grep -qE "$pat" "$f" 2>/dev/null && hits="$hits $rel"
done < <(find "$PLUGIN_DIR" -type f -not -path '*/.git/*' -not -path '*/node_modules/*')
assert_eq "no file references the removed team and plan commands (AC-1)" "" "$hits"

# --- every ${CLAUDE_PLUGIN_ROOT} path exists (C-10) --------------------------------------
missing=""
for n in $want; do
  while read -r rel; do
    [[ -n "$rel" ]] || continue
    [[ -e "$PLUGIN_DIR/$rel" ]] || missing="$missing $n:$rel"
  done < <(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[A-Za-z0-9._/-]+' "$SKILLS/$n/SKILL.md" | sed 's|^${CLAUDE_PLUGIN_ROOT}/||; s|[./]*$||' | sort -u)
done
assert_eq "every \${CLAUDE_PLUGIN_ROOT} path in every skill exists (C-10)" "" "$missing"

# --- C-11 ---------------------------------------------------------------------------------
assert_no_direct_herdr

finish
