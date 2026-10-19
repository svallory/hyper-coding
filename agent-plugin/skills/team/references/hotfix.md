Read this when a hotfix has landed on a production branch, or when merges and rebases of open PRs must be sequenced (merge trains).

## After a hotfix to production

Policy: no merge commits, ever. Downstream branches are rewritten onto the hotfixed production branch, then every open PR under our control is rebased. Procedure, run by the lead:

1. `git fetch`; in the branch's worktree **first `git reset --hard origin/<branch>`** (a local worktree is often stale; rebasing a stale local branch and force-pushing silently drops commits others pushed), then `git rebase origin/main && git push --force-with-lease` for `staging`; then the same reset + `git rebase origin/staging` + force-with-lease for `dev` (adapt names to the project's chain). Afterwards verify `git log --oneline origin/main..origin/dev` still lists every commit that was there before.
2. **Halt** every dev with an open PR to the rewritten branch: `herdr agent send-keys <name> esc` (Orca: `orca terminal send --terminal <handle> --text $'\e'`), then prompt "Checkpoint: commit or stash any WIP, then reply IDLE" and wait for idle. (A prompt to a working agent is lost; the `esc` first is what makes it land.)
3. Run `${CLAUDE_PLUGIN_ROOT}/skills/team/scripts/rebase-worktrees.sh --base <branch> --push` (invoke via `${CLAUDE_PLUGIN_ROOT}`, never a hardcoded path): it rebases each worktree that has an open PR to that base, force-pushes clean ones, and leaves conflicted ones mid-rebase. Dirty worktrees and other authors' PRs are skipped and listed.
4. **Resume** each dev: "Base was rewritten and your branch rebased. If your worktree is mid-rebase, resolve conflicts, `git rebase --continue`, `git push --force-with-lease`, run verify; otherwise continue." A conflicted worktree with no live agent gets a fresh Sonnet dev.
5. Confirm CI green on each PR and that the deploy platform redeployed the rewritten branches.

Merge trains: when merges trigger deploys (CI/CD on the base branch, per-PR previews), merge one PR, wait for its deploy to finish, then rebase and merge the next. Rebases of open PRs also trigger preview builds, so rebase only the next PR in line, not all of them, when previews are enabled. A burst of merges plus rebases can overload a shared build host.
