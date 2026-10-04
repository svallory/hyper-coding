#!/usr/bin/env bash
# Row R — /hyper:help lists every command, in both directions. The help
# command is the plugin's orientation surface: a commands/*.md file that
# help.md does not mention is invisible to the user asking "what can this
# do", and a /hyper:<name> in help.md with no command file behind it is a
# dead link. Checks both directions, and names the two thin CLI commands
# explicitly (T-9).

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

help_md="$PLUGIN_DIR/commands/help.md"
assert_ok "help.md exists" test -f "$help_md"
help_text="$(cat "$help_md")"

# Every commands/*.md must appear as /hyper:<name> in help.md. help.md is a
# command too, so it is part of the loop — it must list itself.
missing=""
for f in "$PLUGIN_DIR"/commands/*.md; do
  name="$(basename "$f" .md)"
  case "$help_text" in
    *"/hyper:$name"*) ;;
    *) missing="$missing $name" ;;
  esac
done
assert_eq "every commands/*.md is listed in help.md" "" "$missing"

# The other direction: every /hyper:<name> help.md points at must exist as
# commands/<name>.md. A stale row is a promise the plugin cannot keep.
dead=""
while read -r name; do
  [[ -n "$name" ]] || continue
  [[ -f "$PLUGIN_DIR/commands/$name.md" ]] || dead="$dead $name"
done < <(grep -o '/hyper:[a-z-]*' <<<"$help_text" | sort -u | sed 's|^/hyper:||')
assert_eq "every /hyper:<name> in help.md exists as a command" "" "$dead"

# The T-9 pair: thin commands that relay the hyper CLI.
assert_contains "/hyper:space appears in help.md" "$help_text" "/hyper:space"
assert_contains "/hyper:warp appears in help.md" "$help_text" "/hyper:warp"

finish
