#!/usr/bin/env bash
# Create a new project space from a git remote.
# Usage: hyper-init.sh <repo-url> [space-name] [--default-branch <name>]

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/hyper-lib.sh"

repo_url=""
name=""
default_branch=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --default-branch) default_branch="$2"; shift 2 ;;
    --layout)
      echo "--layout was removed: spaces are always bare; adopt converts an existing checkout" >&2
      exit 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$repo_url" ]]; then repo_url="$1"
      elif [[ -z "$name" ]]; then name="$1"
      else echo "unexpected argument: $1" >&2; exit 2
      fi
      shift ;;
  esac
done

if [[ -z "$repo_url" ]]; then
  echo "usage: hyper-init.sh <repo-url> [space-name] [--default-branch <name>]" >&2
  exit 2
fi

# Derive space name from the repo when not given: strip .git and any path.
if [[ -z "$name" ]]; then
  name="$(basename "$repo_url" .git)"
fi

root="$PWD/$name"

if [[ -e "$root" ]]; then
  echo "refusing to overwrite existing path: $root" >&2
  exit 1
fi

echo "Creating space: $root"

mkdir -p "$root"

echo "Cloning bare repository..."
git clone --bare "$repo_url" "$root/.git"

# A bare clone fetches only refs/heads/* into refs/heads/*, which leaves no
# remote-tracking branches. Set the standard fetch refspec so `git fetch`,
# `wt`, and branch tracking behave like a normal clone.
git --git-dir="$root/.git" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git --git-dir="$root/.git" fetch origin

# Determine the default branch from the remote HEAD unless overridden.
if [[ -z "$default_branch" ]]; then
  default_branch="$(git --git-dir="$root/.git" symbolic-ref --short HEAD 2>/dev/null || echo main)"
fi
git --git-dir="$root/.git" config worktrunk.default-branch "$default_branch"
git --git-dir="$root/.git" config worktrunk.history "$default_branch"

echo "Scaffolding directories..."
mkdir -p "$root/.claude"
scaffold_dirs "$root"

write_hyper_md "$root" "$name"
write_memory_seed "$root" "$name"

echo "Creating worktree for $default_branch..."
if command -v wt >/dev/null 2>&1; then
  # `switch` creates the worktree if it does not exist. No -c: the branch
  # already exists from the clone. -C runs wt against the space so the
  # user's `{{ repo_path }}/../worktrees/` template resolves inside it.
  wt -C "$root" switch "$default_branch" || {
    echo "  wt failed; falling back to git worktree add" >&2
    git --git-dir="$root/.git" worktree add "$root/worktrees/$default_branch" "$default_branch"
  }
else
  git --git-dir="$root/.git" worktree add "$root/worktrees/$default_branch" "$default_branch"
fi

# Worktrees created from a bare repo get a .git *file*, so core.hooksPath
# resolution differs. Match the user's existing post-start fix.
git --git-dir="$root/.git" config core.hooksPath "$root/.git/hooks"

# Settings resolve per project root, so the worktree needs its own pointer at
# the space memory. Guarded: wt may have placed the worktree elsewhere, and a
# missed pointer must not break init.
if [[ -d "$root/worktrees/$default_branch" ]]; then
  write_worktree_settings "$root" "$root/worktrees/$default_branch"
fi

echo
echo "Space ready: $root"
echo
echo "Next steps:"
echo "  cd $root/worktrees/$default_branch"
echo "  /hyper:tools   wire the project's linter/typechecker into the check hook"
