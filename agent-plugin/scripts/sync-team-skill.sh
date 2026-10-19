#!/usr/bin/env bash
# Copy the team-lead skill, as rendered for Claude by the claude-plugins build,
# into this plugin as skills/team/ (/hyper:team). The authored copy stays in
# /work/claude-plugins/src/plugins/team-lead; the files under skills/team/ are
# generated and never edited here.
#
# Usage: sync-team-skill.sh [--check] [--build] [--source <claude-plugins dir>]
#
#   (default)  read <source>/dist/claude/plugins/team-lead/skills/team-lead/
#              and write skills/team/ from it
#   --check    write nothing; exit 1 when <source>'s dist/ is stale against
#              its src/ (`bun run build:check`, read-only), or when
#              skills/team/ differs from what a sync would produce (content,
#              missing or extra files, or the executable bit on a script)
#   --build    run `bun run build` in <source> first, so dist/ reflects the
#              current src/ (this rewrites the source repo's dist/, so it
#              cannot be combined with --check)
#   --source   the claude-plugins checkout; defaults to $TEAM_LEAD_SOURCE,
#              else /work/claude-plugins
#
# What changes on the way in, and only this:
#   - SKILL.md's frontmatter `name: team-lead` becomes `name: team` (the
#     skill is /hyper:team; commands/team-lead.md is the alias), and a
#     "generated, do not edit" comment follows the frontmatter
#   - `{{ platform.pluginRootVar }}` (an unrendered template) and the bare
#     `$CLAUDE_PLUGIN_ROOT` (as a whole word) both become `${CLAUDE_PLUGIN_ROOT}`, the form this
#     plugin's other skills and commands use
#   - script and data paths move from skills/team-lead/ to skills/team/
#   - references/*.md (loaded on demand by SKILL.md) get the same three path
#     rewrites; they have no frontmatter, so nothing else changes
# The scripts and default-models.yaml are copied byte for byte.

set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$plugin_dir/skills/team"
source_dir="${TEAM_LEAD_SOURCE:-/work/claude-plugins}"
check=0
build=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) check=1 ;;
    --build) build=1 ;;
    --source)
      [[ $# -ge 2 ]] || { echo "sync-team-skill: --source needs a directory" >&2; exit 2; }
      source_dir="$2"
      shift
      ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "sync-team-skill: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ $check -eq 1 && $build -eq 1 ]]; then
  echo "sync-team-skill: --check writes nothing and --build rewrites the source's dist/; pick one" >&2
  exit 2
fi

if [[ ! -d "$source_dir" ]]; then
  echo "sync-team-skill: no claude-plugins checkout at $source_dir (pass --source or set TEAM_LEAD_SOURCE)" >&2
  exit 2
fi
source_dir="$(cd "$source_dir" && pwd)"

if [[ $build -eq 1 ]]; then
  (cd "$source_dir" && bun run build)
fi

# A dist/ that lags src/ would make --check pass against an old render.
if [[ $check -eq 1 ]] && ! (cd "$source_dir" && bun run build:check) >&2; then
  echo "sync-team-skill: dist is stale in $source_dir (bun run build:check failed); rebuild it there, then sync" >&2
  exit 1
fi

rendered="$source_dir/dist/claude/plugins/team-lead/skills/team-lead"
if [[ ! -f "$rendered/SKILL.md" ]]; then
  echo "sync-team-skill: no rendered skill at $rendered/SKILL.md (run with --build, or bun run build in $source_dir)" >&2
  exit 2
fi

# The exact set hyper ships. A new script upstream must be added here on
# purpose, not picked up silently.
scripts=(check-deps.sh rebase-worktrees.sh retire-agent.sh stall-watch.sh team-status.sh)

work="$(mktemp -d "${TMPDIR:-/tmp}/sync-team-skill.XXXXXX")"
trap 'rm -rf "$work"' EXIT
out="$work/team"
mkdir -p "$out/scripts"

header="<!-- Generated from /work/claude-plugins/src/plugins/team-lead by agent-plugin/scripts/sync-team-skill.sh; do not edit here. -->"

# The frontmatter must be the first thing in the file for the skill to load,
# so it is required on line 1 and the header goes right after its closing
# fence. `name:` is rewritten only inside the frontmatter.
if [[ "$(head -n 1 "$rendered/SKILL.md")" != "---" ]]; then
  echo "sync-team-skill: $rendered/SKILL.md does not start with frontmatter (---)" >&2
  exit 1
fi
# Path rewrites shared by SKILL.md and the references (awk source).
rewrite_awk='
  # $CLAUDE_PLUGIN_ROOT only as a whole word: $CLAUDE_PLUGIN_ROOT_X is left alone.
  function brace_root(s,    out, rest, i, next_char) {
    out = ""; rest = s
    while ((i = index(rest, "$CLAUDE_PLUGIN_ROOT")) > 0) {
      next_char = substr(rest, i + 19, 1)
      out = out substr(rest, 1, i - 1)
      if (next_char ~ /[A-Za-z0-9_]/) out = out "$CLAUDE_PLUGIN_ROOT"
      else out = out "${CLAUDE_PLUGIN_ROOT}"
      rest = substr(rest, i + 19)
    }
    return out rest
  }
  # All three path rewrites, in one place for SKILL.md and the references.
  function rewrite(s) {
    gsub(/\{\{ *platform\.pluginRootVar *\}\}/, "${CLAUDE_PLUGIN_ROOT}", s)
    s = brace_root(s)
    gsub(/\/skills\/team-lead\//, "/skills/team/", s)
    return s
  }
'

awk -v header="$header" "$rewrite_awk"'
  { line = $0
    if (NR > 1 && !done && line == "---") { print line; print ""; print header; done = 1; next }
    if (!done && line ~ /^name: *team-lead *$/) { print "name: team"; renamed = 1; next }
    print rewrite(line)
  }
  END { if (!done || !renamed) exit 3 }
' "$rendered/SKILL.md" > "$out/SKILL.md" || {
  echo "sync-team-skill: $rendered/SKILL.md frontmatter is unclosed or has no \`name: team-lead\`" >&2
  exit 1
}
# A leftover template tag means the source was not rendered: shipping it would
# hand the agent literal `{{ ... }}` paths.
if grep -nE '\{\{|^@(if|else|elseif|end|let|each)\b' "$out/SKILL.md" >&2; then
  echo "sync-team-skill: unrendered template syntax in $rendered/SKILL.md (lines above)" >&2
  exit 1
fi

# references/ holds the files SKILL.md tells the agent to read on demand. Each
# one is a rendered markdown file with no frontmatter; it gets the same path
# rewrites, and the same refusal when a template tag was left behind.
if [[ -d "$rendered/references" ]]; then
  mkdir -p "$out/references"
  for r in "$rendered"/references/*; do
    [[ -e "$r" ]] || continue
    if [[ ! -f "$r" || "$r" != *.md ]]; then
      echo "sync-team-skill: $r is not a markdown file; references/ ships .md files only" >&2
      exit 1
    fi
    rname="$(basename "$r")"
    awk "$rewrite_awk"'
      { print rewrite($0) }
    ' "$r" > "$out/references/$rname"
    if grep -nE '\{\{|^@(if|else|elseif|end|let|each)\b' "$out/references/$rname" >&2; then
      echo "sync-team-skill: unrendered template syntax in $r (lines above)" >&2
      exit 1
    fi
  done
fi

cp "$rendered/default-models.yaml" "$out/default-models.yaml"
for s in "${scripts[@]}"; do
  if [[ ! -f "$rendered/scripts/$s" ]]; then
    echo "sync-team-skill: missing script $rendered/scripts/$s" >&2
    exit 1
  fi
  cp "$rendered/scripts/$s" "$out/scripts/$s"
  chmod 755 "$out/scripts/$s"
done

if [[ $check -eq 1 ]]; then
  drift=0
  if ! diff -r "$out" "$dest" >&2; then
    drift=1
  fi
  for s in "${scripts[@]}"; do
    if [[ -f "$dest/scripts/$s" && ! -x "$dest/scripts/$s" ]]; then
      echo "sync-team-skill: $dest/scripts/$s is not executable" >&2
      drift=1
    fi
  done
  if [[ $drift -ne 0 ]]; then
    echo "sync-team-skill: skills/team is out of sync with $rendered (run agent-plugin/scripts/sync-team-skill.sh)" >&2
    exit 1
  fi
  echo "skills/team is in sync with $rendered"
  exit 0
fi

rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -R "$out" "$dest"
echo "synced $rendered -> $dest"
