#!/usr/bin/env bash
# Read-only space health report. Changes nothing, and always exits 0 — this is
# a report for a human (or /hyper:audit) to act on, not a gate.
# Usage: hyper-audit.sh [space-root]

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/hyper-lib.sh"

root="${1:-}"
if [[ -z "$root" ]]; then
  root="$(find_space_root "$PWD")" || {
    echo "not inside a space (no bare .git + worktrees/ found)" >&2
    echo "pass a path explicitly, or use hyper-adopt.sh to opt a repo in" >&2
    exit 0
  }
fi
root="$(cd "$root" && pwd)"

if ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  echo "not a git repository: $root" >&2
  exit 0
fi

# Findings are collected first and printed grouped by severity at the end,
# because a section-by-section dump buries the one line that matters.
problems=()
warnings=()
infos=()
problem() { problems+=("$1"); }
warn()    { warnings+=("$1"); }
info()    { infos+=("$1"); }

echo "Space:  $root"
echo "Layout: bare"

# --- 1. Layout drift -------------------------------------------------------

wt_abs="$root/worktrees"
wt_rel="worktrees"

for d in "${SPACE_DIRS[@]}"; do
  [[ -d "$root/$d" ]] \
    || warn "missing $d/ — run hyper-adopt.sh --apply to scaffold"
done

# Legacy (pre-rename) names still work everywhere, so their presence is
# info, not a warning — adopt --apply migrates them to the new names.
if [[ -f "$root/HYPER.md" ]]; then
  :
elif [[ -f "$root/HYPERDEV.md" ]]; then
  info "legacy HYPERDEV.md marker in use — run hyper-adopt.sh --apply to migrate it to HYPER.md"
else
  warn "no HYPER.md marker — run hyper-adopt.sh --apply to opt in"
fi

[[ -d "$root/.hyperdev" ]] \
  && info "legacy .hyperdev/ metadata dir in use — run hyper-adopt.sh --apply to migrate it to .hyper/"

[[ -f "$root/.claude/hyperdev.json" ]] \
  && info "legacy .claude/hyperdev.json config in use — still honored; rename to .claude/hyper.json when convenient"

# Leftover conversion evidence means a conversion's postflight verification
# did not pass cleanly (or the run died). It is our file, not the user's data.
[[ -f "$root/.hyper-convert.preflight" ]] \
  && problem ".hyper-convert.preflight left behind — a conversion did not verify cleanly; reconcile against it, then delete it"
[[ -f "$root/.hyperdev-convert.preflight" ]] \
  && problem ".hyperdev-convert.preflight left behind — a pre-rename conversion did not verify cleanly; reconcile against it, then delete it"

# A legacy .claude/worktrees/ at the space root only exists after converting a
# previously-adopted repo, and anything still in it was not a registered
# worktree — conversion parks such entries rather than guess. Without this
# check they are announced exactly once, in the apply output, and then never
# surface again.
if [[ -d "$root/.claude/worktrees" ]]; then
  for w in "$root/.claude/worktrees"/*/; do
    [[ -d "$w" ]] || continue
    wname="$(basename "$w")"
    wsize="$(du -sh "$w" 2>/dev/null | cut -f1 || echo '?')"
    warn ".claude/worktrees/$wname ($wsize): parked by conversion — not a registered worktree; inspect, then delete or move its contents"
  done
fi

# --- 2. Worktree directory -------------------------------------------------

# Same classification as the worktree scan in hyper-adopt.sh (the sibling
# copy lives there) — an entry is a live worktree, an orphan whose gitdir git
# has already pruned, or leftover build output with no .git at all.
live_worktrees=()
if [[ -d "$wt_abs" ]]; then
  for w in "$wt_abs"/*/; do
    [[ -d "$w" ]] || continue
    wname="$(basename "$w")"
    if [[ ! -e "$w/.git" ]]; then
      wsize="$(du -sh "$w" 2>/dev/null | cut -f1 || echo '?')"
      warn "$wt_rel/$wname ($wsize): no .git — leftover build output, not a worktree; safe to delete"
    elif [[ -f "$w/.git" ]] \
         && wgd="$(sed -n 's/^gitdir: //p' "$w/.git" 2>/dev/null)" \
         && [[ -n "$wgd" && ! -d "$wgd" ]]; then
      wsize="$(du -sh "$w" 2>/dev/null | cut -f1 || echo '?')"
      problem "$wt_rel/$wname ($wsize): ORPHANED worktree — gitdir missing; recover or delete"
    else
      wbranch="$(git -C "$w" branch --show-current 2>/dev/null || echo '?')"
      info "$wt_rel/$wname: ok [$wbranch]"
      live_worktrees+=("$w")
    fi
  done
fi

# --- 3. Branches whose upstream is gone ------------------------------------

# %(upstream:track) prints "[gone]" when the remote branch was deleted — same
# signal as `git branch -vv | grep ': gone]'`, without parsing the `*` marker.
# --git-dir needs no working tree, so a bare space works directly.
while IFS= read -r line; do
  [[ -n "$line" ]] && warn "branch '$line': upstream gone from remote — merged/deleted; delete locally if done"
done < <(git --git-dir="$root/.git" for-each-ref \
           --format='%(refname:short) %(upstream:track)' refs/heads 2>/dev/null \
         | sed -n 's/ \[gone\]$//p' || true)

# --- 4. Dirty worktrees ----------------------------------------------------

for w in "${live_worktrees[@]+"${live_worktrees[@]}"}"; do
  wlabel="${w#"$root"/}"; wlabel="${wlabel%/}"
  [[ "$w" == "$root" ]] && wlabel="(root)"
  dirty="$(git -C "$w" status --short 2>/dev/null || true)"
  [[ -n "$dirty" ]] || continue
  count="$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')"
  sample="$(printf '%s\n' "$dirty" | head -3 | awk '{print $NF}' | paste -sd, -)"
  [[ "$count" -gt 3 ]] && sample+=" +$((count - 3)) more"
  warn "$wlabel: $count uncommitted change(s) — $sample"
done

# --- 5. Sizes --------------------------------------------------------------

if [[ -d "$root/scratch" ]]; then
  ssize="$(du -sh "$root/scratch" 2>/dev/null | cut -f1 || echo '?')"
  info "scratch/ is $ssize — disposable; delete freely if it has grown"
fi

# Loose big files at the root — the root is bare, so every file here is loose
# by construction.
while IFS= read -r f; do
  base="$(basename "$f")"
  fsize="$(du -sh "$f" 2>/dev/null | cut -f1 || echo '?')"
  warn "$base ($fsize): >10MB loose at the space root — belongs in data/"
done < <(find "$root" -mindepth 1 -maxdepth 1 -type f -size +10M 2>/dev/null || true)

# --- 6. Secret-looking names at the root -----------------------------------

# Paths only, never contents. The root cannot be committed, so these are a
# heads-up about backup/locality, not a leak.
while IFS= read -r f; do
  base="$(basename "$f")"
  warn "$base: secret-looking file at the space root — verify it is meant to live here"
done < <(find "$root" -mindepth 1 -maxdepth 1 \
           \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \
              -o -name 'id_rsa*' -o -name 'id_ed25519*' \
              -o -name '*credential*.json' -o -name '*service-account*.json' \) \
           2>/dev/null || true)

# --- Report ----------------------------------------------------------------

print_group() {
  local title="$1"; shift
  echo
  echo "$title"
  if [[ $# -eq 0 ]]; then
    echo "  (none)"
  else
    local line
    for line in "$@"; do echo "  $line"; done
  fi
}

print_group "Problems:" "${problems[@]+"${problems[@]}"}"
print_group "Warnings:" "${warnings[@]+"${warnings[@]}"}"
print_group "Info:"     "${infos[@]+"${infos[@]}"}"

if [[ ${#problems[@]} -gt 0 || ${#warnings[@]} -gt 0 ]]; then
  echo
  echo "Next steps:"
  [[ ${#warnings[@]} -gt 0 ]] && grep -q "missing" <<<"${warnings[*]}" \
    && echo "  /hyper:adopt --apply   scaffold the missing pieces"
  echo "  /hyper:cleanup         delete the debris findings — listed first, confirmed per item"
  echo "  fix what the report flags — audit only reports, it never changes anything"
fi

exit 0
