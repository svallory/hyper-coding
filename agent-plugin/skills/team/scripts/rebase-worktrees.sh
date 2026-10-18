#!/usr/bin/env bash
#
# rebase-worktrees.sh — rebase every local worktree with an open PR onto a
# rewritten base branch.
#
# Purpose:
#   After a history rewrite (force-push, squash, amend, etc.) of a base
#   branch (e.g. `dev`), every local worktree whose branch has an open PR
#   targeting that base needs `git rebase origin/<base>` to pick up the new
#   history. This script finds those worktrees, rebases each one, and
#   reports the outcome. Conflicted rebases are left in progress (not
#   aborted) so you can resolve them by hand.
#
# Usage:
#   rebase-worktrees.sh --base <branch> [--space <hyper space root>] \
#       [--dry-run] [--only <branch,...>] [--push] [--all-authors]
#
#   --base <branch>     Required. The base branch that was rewritten
#                        (e.g. dev, main).
#   --space <path>       Root of the hyper space, i.e. the directory that
#                        contains `worktrees/<base>` and sibling worktree
#                        dirs. Defaults to $PWD.
#   --dry-run            Print the plan (which worktrees would be rebased)
#                        without touching anything.
#   --only <branch,...>  Comma-separated list of branch names to restrict
#                        the run to. All other matching PRs are skipped.
#   --push               After a successful rebase, force-push with
#                        `--force-with-lease`. Without this flag, rebased
#                        branches are left unpushed.
#   --all-authors        Include PRs authored by anyone, not just the
#                        current `gh` user. By default only PRs whose
#                        author login matches `gh api user` are included.
#
# Discovery:
#   - Worktrees: `wt list --format json` (worktrunk CLI). Expected JSON
#     shape: {items:[{branch, worktree:{path, ...}, ...}, ...]}.
#   - Open PRs: `gh pr list --base <base> --state open --json
#     number,headRefName,author`, run from the space's `worktrees/<base>`
#     directory (falls back to any discovered worktree, or --space itself,
#     if that directory doesn't exist).
#
# Per-worktree behavior:
#   - If the branch has no matching local worktree: SKIPPED-no-worktree.
#   - If the worktree is dirty (`git status --porcelain` non-empty) or
#     already mid-rebase (.git/rebase-merge or .git/rebase-apply present):
#     SKIPPED-dirty.
#   - Otherwise: `git fetch origin <base>` then `git rebase origin/<base>`.
#       - On success without --push: OK (rebased, not pushed).
#       - On success with --push: PUSHED (rebased and force-pushed).
#       - On conflict: CONFLICT. The rebase is left in progress (NOT
#         aborted) so it can be resolved manually; `git status` output is
#         printed for context.
#
# Output:
#   One line per worktree:
#     <branch>  <PR#>  <OK|PUSHED|SKIPPED-dirty|SKIPPED-no-worktree|CONFLICT>  <path>
#   Followed by a summary line with counts per status.
#
# Exit codes:
#   0  success, no conflicts
#   1  usage or tooling error (missing dependency, bad args, gh/wt failure)
#   2  one or more worktrees ended in CONFLICT
#
# Dependencies: git, jq, gh, wt. No other external tools.

set -euo pipefail

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

base=""
space="${PWD}"
dry_run=0
only=""
push=0
all_authors=0

usage() {
  cat >&2 <<'EOF'
Usage: rebase-worktrees.sh --base <branch> [--space <hyper space root, default $PWD>] [--dry-run] [--only <branch,...>] [--push] [--all-authors]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      base="${2:-}"
      shift 2
      ;;
    --space)
      space="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --only)
      only="${2:-}"
      shift 2
      ;;
    --push)
      push=1
      shift
      ;;
    --all-authors)
      all_authors=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$base" ]]; then
  echo "error: --base <branch> is required" >&2
  usage
  exit 1
fi

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

for dep in git jq gh wt; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "error: required dependency not found in PATH: $dep" >&2
    exit 1
  fi
done

if [[ ! -d "$space" ]]; then
  echo "error: space root does not exist: $space" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine current gh user (unless --all-authors)
# ---------------------------------------------------------------------------

current_login=""
if [[ "$all_authors" -eq 0 ]]; then
  if ! current_login="$(gh api user --jq .login 2>/dev/null)"; then
    echo "error: failed to determine current gh user (gh api user)" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Discover worktrees: branch -> path
# ---------------------------------------------------------------------------

worktrees_json="$(cd "$space" && wt list --format json 2>/dev/null)" || {
  echo "error: failed to run 'wt list --format json' in $space" >&2
  exit 1
}

declare -A branch_to_path=()
while IFS=$'\t' read -r wt_branch wt_path; do
  [[ -z "$wt_branch" ]] && continue
  branch_to_path["$wt_branch"]="$wt_path"
done < <(printf '%s' "$worktrees_json" | jq -r '.items[]? | [.branch, .worktree.path] | @tsv')

# ---------------------------------------------------------------------------
# Discover open PRs against base
# ---------------------------------------------------------------------------

pr_run_dir="$space/worktrees/$base"
if [[ ! -d "$pr_run_dir" ]]; then
  # fall back to any known worktree, else the space root itself
  fallback=""
  for b in "${!branch_to_path[@]}"; do
    fallback="${branch_to_path[$b]}"
    break
  done
  pr_run_dir="${fallback:-$space}"
fi

prs_json="$(cd "$pr_run_dir" && gh pr list --base "$base" --state open --json number,headRefName,author 2>/dev/null)" || {
  echo "error: failed to run 'gh pr list --base $base --state open ...' in $pr_run_dir" >&2
  exit 1
}

# Build an --only filter set, if provided
declare -A only_set=()
if [[ -n "$only" ]]; then
  IFS=',' read -ra only_arr <<<"$only"
  for b in "${only_arr[@]}"; do
    only_set["$b"]=1
  done
fi

# ---------------------------------------------------------------------------
# Build the plan: rows of branch, pr_number, path (or empty path if none)
# ---------------------------------------------------------------------------

count_ok=0
count_pushed=0
count_skip_dirty=0
count_skip_nowt=0
count_conflict=0

plan_rows=()
while IFS=$'\t' read -r pr_number pr_branch pr_author; do
  [[ -z "$pr_branch" ]] && continue

  if [[ "$all_authors" -eq 0 && "$pr_author" != "$current_login" ]]; then
    continue
  fi

  if [[ -n "$only" && -z "${only_set[$pr_branch]+x}" ]]; then
    continue
  fi

  plan_rows+=("${pr_number}"$'\t'"${pr_branch}")
done < <(printf '%s' "$prs_json" | jq -r '.[] | [.number, .headRefName, .author.login] | @tsv')

if [[ "$dry_run" -eq 1 ]]; then
  echo "Plan (dry run) — base=$base space=$space push=$push all_authors=$all_authors"
  if [[ ${#plan_rows[@]} -eq 0 ]]; then
    echo "(no matching open PRs)"
    exit 0
  fi
  for row in "${plan_rows[@]}"; do
    IFS=$'\t' read -r pr_number pr_branch <<<"$row"
    path="${branch_to_path[$pr_branch]:-}"
    if [[ -z "$path" ]]; then
      echo "${pr_branch}  #${pr_number}  SKIPPED-no-worktree  -"
    else
      echo "${pr_branch}  #${pr_number}  would-rebase  ${path}"
    fi
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# Execute the plan
# ---------------------------------------------------------------------------

for row in "${plan_rows[@]}"; do
  IFS=$'\t' read -r pr_number pr_branch <<<"$row"
  path="${branch_to_path[$pr_branch]:-}"

  if [[ -z "$path" ]]; then
    echo "${pr_branch}  #${pr_number}  SKIPPED-no-worktree  -"
    count_skip_nowt=$((count_skip_nowt + 1))
    continue
  fi

  if [[ -d "$path/.git/rebase-merge" || -d "$path/.git/rebase-apply" ]]; then
    echo "${pr_branch}  #${pr_number}  SKIPPED-dirty  ${path}"
    count_skip_dirty=$((count_skip_dirty + 1))
    continue
  fi

  dirty_status="$(cd "$path" && git status --porcelain 2>/dev/null)" || {
    echo "error: git status failed in $path" >&2
    exit 1
  }
  if [[ -n "$dirty_status" ]]; then
    echo "${pr_branch}  #${pr_number}  SKIPPED-dirty  ${path}"
    count_skip_dirty=$((count_skip_dirty + 1))
    continue
  fi

  if ! (cd "$path" && git fetch origin "$base") >/dev/null 2>&1; then
    echo "error: git fetch origin $base failed in $path" >&2
    exit 1
  fi

  if (cd "$path" && git rebase "origin/$base") >/dev/null 2>&1; then
    if [[ "$push" -eq 1 ]]; then
      if (cd "$path" && git push --force-with-lease) >/dev/null 2>&1; then
        echo "${pr_branch}  #${pr_number}  PUSHED  ${path}"
        count_pushed=$((count_pushed + 1))
      else
        echo "${pr_branch}  #${pr_number}  CONFLICT  ${path}"
        echo "  note: rebase succeeded but push failed (see git push output in $path)" >&2
        count_conflict=$((count_conflict + 1))
      fi
    else
      echo "${pr_branch}  #${pr_number}  OK  ${path}  (rebased, not pushed)"
      count_ok=$((count_ok + 1))
    fi
  else
    echo "${pr_branch}  #${pr_number}  CONFLICT  ${path}"
    echo "--- git status in $path ---" >&2
    (cd "$path" && git status) >&2 || true
    echo "--- rebase left in progress; resolve manually ---" >&2
    count_conflict=$((count_conflict + 1))
  fi
done

echo ""
echo "Summary: ok=${count_ok} pushed=${count_pushed} skipped-dirty=${count_skip_dirty} skipped-no-worktree=${count_skip_nowt} conflict=${count_conflict}"

if [[ "$count_conflict" -gt 0 ]]; then
  exit 2
fi

exit 0
