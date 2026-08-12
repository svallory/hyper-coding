#!/usr/bin/env bash
# Shared helpers for space init/adopt/audit.
# Sourced, not executed directly.

set -euo pipefail

# The scaffolded directories and what each is for. Order matters for display.
SPACE_DIRS=(worktrees data notes scratch bin)

dir_purpose() {
  case "$1" in
    worktrees) echo "git worktrees, one per branch (managed by wt)" ;;
    data)      echo "DB dumps, fixtures, large blobs" ;;
    notes)     echo "briefs, handoffs, working docs" ;;
    scratch)   echo "throwaway files; safe to delete at any time" ;;
    bin)       echo "local helper scripts for this project" ;;
    *)         echo "" ;;
  esac
}

# A space has exactly one shape: a bare .git at the root, worktrees in
# worktrees/, local-only dirs beside them. Space files and project files never
# share a directory — adopting an ordinary checkout means converting it.
#
# space_layout <dir> prints "bare" or nothing.
#
# core.bare alone is not enough: a plain bare clone (a mirror, a hosting
# remote) is not a space. Require the structure the docs promise — a
# worktrees/ directory beside .git — or the explicit adoption marker.
space_layout() {
  local d="${1:-$PWD}"
  [[ -d "$d/.git" ]] || return 1
  [[ "$(git --git-dir="$d/.git" config --get core.bare 2>/dev/null)" == "true" ]] || return 1
  # HYPERDEV.md is the legacy marker (pre-rename); spaces adopted under the
  # old plugin name must keep being detected until adopt --apply migrates it.
  if [[ -d "$d/worktrees" || -f "$d/HYPER.md" || -f "$d/HYPERDEV.md" ]]; then
    echo bare
    return 0
  fi
  return 1
}

# Where worktrees live for a given root. Always <root>/worktrees.
worktrees_dir() {
  local d="${1:-$PWD}"
  echo "$d/worktrees"
}

# A space is exactly what space_layout accepts: a bare repo with worktrees/
# or the marker beside it. No marker-only fallback — HYPER.md lives at the
# uncommittable bare root, so a marker inside an ordinary checkout is either
# legacy debris or a committed copy in some clone; neither makes that checkout
# a space, and treating it as one would fire the root-guard hooks inside a
# normal working tree.
is_space() {
  space_layout "${1:-$PWD}" >/dev/null 2>&1
}

# Walk up from cwd to find the enclosing space root, if any.
#
# Order matters: a linked worktree contains a .git *file* pointing elsewhere,
# so space_layout correctly rejects it and the walk continues to the real
# root. That is what makes detection work from inside a worktree.
find_space_root() {
  local d="${1:-$PWD}"
  while [[ "$d" != "/" ]]; do
    if is_space "$d"; then
      echo "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# True when cwd is the space root itself rather than inside a worktree.
# This is where the dangerous mistakes happen (committing, loose files).
at_space_root() {
  local root
  root="$(find_space_root "$PWD")" || return 1
  [[ "$root" == "$PWD" ]]
}

write_hyper_md() {
  local root="$1" name="$2"
  cat > "$root/HYPER.md" <<EOF
# $name

Project **space**, bare layout. This directory is not a git worktree —
nothing here is committed. The worktrees live in \`worktrees/\`.

## Layout

| Path | Purpose |
|------|---------|
| \`.git/\` | bare repository (shared object store for all worktrees) |
| \`.claude/\` | Claude settings scoped to this project |
| \`.hyper/\` | plugin metadata; space memory in \`.hyper/memory/\` |
| \`worktrees/\` | $(dir_purpose worktrees) |
| \`data/\` | $(dir_purpose data) |
| \`notes/\` | $(dir_purpose notes) |
| \`scratch/\` | $(dir_purpose scratch) |
| \`bin/\` | $(dir_purpose bin) |

## Rules

- Do not run \`git commit\` from the space root; \`cd\` into a worktree first.
- Create worktrees with \`wt switch <branch>\`, never \`git worktree add\` by hand.
- \`scratch/\` is disposable. Anything you would miss belongs in \`data/\` or \`notes/\`.
- Files here never reach the remote. Secrets are local-only by construction,
  but that also means nothing here is backed up.
EOF
}

# ensure_auto_memory <settings-file> <memory-dir> <label> — make the settings
# file point autoMemoryDirectory at the space memory, creating it if absent.
# An existing file is merged, never clobbered: only that one key is set, via
# node (JSON.parse/stringify, 2-space) so every other key survives. No node
# means no safe merge, so the file is left alone and the skip is reported —
# a scaffold step must degrade to a message, never break the flow.
ensure_auto_memory() {
  local file="$1" mem="$2" label="$3" rc=0
  if [[ ! -f "$file" ]]; then
    printf '{\n  "autoMemoryDirectory": "%s"\n}\n' "$mem" > "$file"
    echo "  wrote    $label (autoMemoryDirectory)"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "  skipped  $label (node unavailable; set autoMemoryDirectory manually)"
    return 0
  fi
  node -e '
    const fs = require("fs");
    const [file, dir] = process.argv.slice(1);
    let obj;
    try { obj = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(4); }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) process.exit(4);
    if (obj.autoMemoryDirectory === dir) process.exit(3);
    obj.autoMemoryDirectory = dir;
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  ' "$file" "$mem" 2>/dev/null || rc=$?
  case $rc in
    0) echo "  updated  $label (autoMemoryDirectory)" ;;
    3) echo "  exists   $label (autoMemoryDirectory already set)" ;;
    *) echo "  skipped  $label (could not parse JSON; set autoMemoryDirectory manually)" ;;
  esac
  return 0
}

# Wire the space memory into Claude Code. Auto memory loads only from the
# directory settings.json names in autoMemoryDirectory — nothing under
# .claude/memory/ is ever read on its own. The value must be an absolute path
# (or start with ~/), so it is computed at write time; moving the space means
# re-running adopt --apply to refresh it.
write_settings_json() {
  local root="$1"
  mkdir -p "$root/.hyper/memory" "$root/.claude"
  ensure_auto_memory "$root/.claude/settings.json" "$root/.hyper/memory" \
    ".claude/settings.json"
}

# Same wiring for a worktree. Settings resolve per project root: a session
# inside a worktree reads the worktree's .claude, not the space's, so each
# worktree needs its own pointer. settings.local.json because the file is
# untracked by convention — an absolute path there never reaches the remote.
write_worktree_settings() {
  local root="$1" wt="$2"
  mkdir -p "$root/.hyper/memory" "$wt/.claude"
  ensure_auto_memory "$wt/.claude/settings.local.json" "$root/.hyper/memory" \
    "${wt#"$root"/}/.claude/settings.local.json"
}

# Seed the space memory with a note describing the layout, so future sessions
# in this project know the conventions without relying on the hook alone.
# It lives in .hyper/memory/ — the plugin's tool-agnostic metadata home —
# and loads via the autoMemoryDirectory wiring above.
write_memory_seed() {
  local root="$1" name="$2"
  local mem="$root/.hyper/memory"
  mkdir -p "$mem"

  cat > "$mem/hyper-layout.md" <<EOF
---
name: hyper-layout
description: $name uses the hyper bare space layout; worktrees in worktrees/, root is never committed
metadata:
  type: project
---

\`$root\` is a project space, not a checkout. The \`.git\` there is bare and
the worktrees are in \`worktrees/<branch>\`, created via \`wt switch\`.

Local-only directories at the space root: \`data/\` (dumps, fixtures),
\`notes/\` (briefs, handoffs), \`scratch/\` (disposable), \`bin/\` (helper scripts).
None of it is committed or backed up.

**Why:** keeps a single object store across branches and gives local-only files a
home that cannot accidentally be committed.

**How to apply:** never commit from the space root; put new local files in the
matching directory instead of loose at the root. See \`HYPER.md\`.
EOF

  local index="$mem/MEMORY.md"
  if [[ ! -f "$index" ]]; then
    printf '# Memory index\n\n' > "$index"
  fi
  # Rewrite rather than skip-if-present: an interrupted earlier run can leave
  # an index line pointing at a memory file that was never written, and a
  # plain grep would treat that dangling entry as "already done".
  if grep -q 'hyper-layout.md' "$index" 2>/dev/null; then
    # grep -v exits 1 when nothing survives the filter; an index containing
    # only this entry must still be rewritten (to empty), so ignore the exit
    # code and always move the temp file into place.
    grep -v 'hyper-layout.md' "$index" > "$index.tmp" || :
    mv "$index.tmp" "$index"
  fi
  printf -- '- [Space layout](hyper-layout.md) — worktrees/, local-only dirs, root is never committed\n' >> "$index"
}

# Point worktrunk at the space's default branch, and make bare-repo worktrees
# resolve hooks correctly. Idempotent and non-destructive: an explicit
# existing worktrunk.default-branch is never overwritten, since the caller
# may have set it deliberately (e.g. a branch other than HEAD's symbolic ref).
#
# ensure_worktrunk_config <git-dir> <default-branch>
ensure_worktrunk_config() {
  local gitdir="$1" branch="$2"
  if [[ -z "$(git --git-dir="$gitdir" config --get worktrunk.default-branch 2>/dev/null)" ]]; then
    git --git-dir="$gitdir" config worktrunk.default-branch "$branch"
    git --git-dir="$gitdir" config worktrunk.history "$branch"
    echo "  set      worktrunk.default-branch=$branch"
  fi
  # Worktrees created from a bare repo get a .git *file*, so core.hooksPath
  # resolution differs; point it at the shared hooks dir explicitly.
  git --git-dir="$gitdir" config core.hooksPath "$gitdir/hooks"
}

# Create the directory set. Idempotent: reports created vs already-present.
scaffold_dirs() {
  local root="$1" d
  for d in "${SPACE_DIRS[@]}"; do
    local target="$root/$d"
    if [[ -d "$target" ]]; then
      echo "  exists   $d/"
    else
      mkdir -p "$target"
      # A note beats .gitkeep here: it explains the directory to whoever opens
      # it in six months.
      printf '%s\n' "$(dir_purpose "$d")" > "$target/.what-goes-here"
      echo "  created  $d/"
    fi
  done
  # .hyper/ is plugin-managed metadata, not a user-facing dir, so it stays
  # out of SPACE_DIRS — but every scaffold wires the memory settings.
  write_settings_json "$root"
  return 0
}
