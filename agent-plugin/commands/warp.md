---
name: warp
description: Move a live Claude session to another machine — working directory, transcript and ownership — over ssh
argument-hint: "<machine> [--session id] [--stop] [--remote-control] [--force] [--dry-run]"
---

# Warp

Thin wrapper over `hyper warp`. **Run the CLI and relay the output — this
command adds no logic of its own.**

Build the call from the user's own words, one argument at a time, each
passed as its own single-quoted word:

```bash
hyper warp '<machine>'
```

Add only the flags the user actually named. Never paste the argument text
straight into a shell line: unquoted, a `;`, `$()`, a backtick or a space
would be read as shell syntax instead of an argument. A `'` inside an
argument becomes `'\''`.

Warp is **send only**: the machine holding the session runs it. It copies
the working directory file by file (no `--delete`), this session's
transcript, and an ownership marker, over ssh.

## Refusals: which flag gets past which

**`--force` overrides only these:**

- the session is owned by another machine, or already lives on the target;
- a leftover marker from a warp that stopped mid-swap (ownership unknown);
- the target's copy holds uncommitted work (untracked files included);
- the copy would overwrite an untracked or ignored entry in the target's
  copy (a `.env`, say) with different content, or with a different type (a
  file or symlink on one side where the other has a directory). Identical
  files and paths the copy excludes don't count;
- the target has a directory git TRACKS where this machine has a file or
  symlink (the copy can't write a file over a directory). The reverse, a
  tracked file there where this machine has a directory, is not refused: git
  has that file, and the copy replaces it;
- **plain repo only**: the target's repository has a ref at a commit this
  machine doesn't have, or that none of the refs warp carries reach (or a
  detached HEAD at such a commit). After the copy the target's refs are set
  to exactly this machine's, so those commits would become unreachable. A
  ref only the target has (say `refs/remotes/origin/main` or a tag it
  fetched more recently) passes when its commit is here and one of this
  machine's branches, tags or other refs (or HEAD) reaches it; the ref itself
  is then removed there. Earlier warps' backups, another worktree's HEAD and
  the stash don't count as reaching it.
- **plain repo only**: stash entries only the target has (each named, with
  the count), and refs that conflict as file and directory between the two
  sides (`df` on one, `df/x` on the other), both named.

**`--force` does not get past any of these** — they are refused whatever you
pass:

- the session is still running here. This is usually *the session you are
  in*; the refusal says to re-run with `--stop`, which sends SIGTERM/SIGKILL
  to the running Claude process — **yourself**. Say what that means and let
  the user decide; never add `--stop` on your own.
- the space is missing from the hyperdrive manifest (so `hyper space clone`
  on the target would have nothing to clone);
- a path that the copy tools cannot quote identically on both platforms;
- an ownership marker that cannot be parsed, or a branch git would reject;
- the target's Herdr server not answering, or the target not accepting the
  branch;
- in the target's copy (a space worktree or a plain repo): a merge, rebase,
  cherry-pick, revert or bisect in progress, unresolved conflicts in the
  index, or changes in a submodule. Nothing `--force` saves can carry them.
- **plain repo only**: the target's repository keeps its refs in the
  reftable format (`extensions.refStorage=reftable`). The copy replaces its
  `.git/config`, which would hide every ref there.
- **plain repo only**: a ref lock file (`<ref>.lock` or `packed-refs.lock`)
  in the target's repository; the refusal names it. Remove it there if no
  git command is running.
- **plain repo only**: a `.git` that is a file (a `gitdir:` link) rather than
  the repository itself.

**Say `--force` is the user's call.** Relay the refusal and stop; do not
retry with `--force` to "make it work".

## What `--force` actually saves (and what it does not)

- **Space worktree**: the target's uncommitted *tracked* work is saved there
  as a stash first (untracked and ignored files are not in it).
- **Plain repo**: the target's uncommitted tracked work is not saved; those
  files are overwritten one by one.
- **Plain repo refs**: when the refs check above found something, every
  ref of the target's repository (and a detached HEAD) is first saved there
  as `refs/hyper-warp-backup/<session id>-<start time>/<ref without refs/>`;
  warp prints the namespace. The copy leaves `.git/refs/hyper-warp-backup`
  alone, and before every plain-repo copy, saved refs that a `git pack-refs`
  or `gc` on the target moved into `packed-refs` are written back there as
  loose refs, so a later warp doesn't drop them.
  Every stash entry is saved too, one ref each, as
  `refs/hyper-warp-backup/<…>/stash/<n>` (newest is 0); warp prints how
  many, and `git stash apply <that ref>` there re-applies one. The target's
  reflogs are not saved: for refs this machine also has they are replaced
  by this machine's, so a commit there reachable only from a reflog (after
  a reset, say) is not kept, with or without `--force`. A target ref that
  conflicts as file and directory with one of this machine's (`df` here,
  `df/x` there) is saved with the others and then deleted there.
  The rest of the target's `.git` — `config`, `info/exclude`,
  hooks, `HEAD`, the index, `packed-refs` — is replaced by this machine's
  files of the same name (files only the target has are kept).
- **Both**: every colliding untracked or ignored entry, and every tracked
  directory where this machine has a file (see the refusals above), is
  first copied (`cp -pPR`) into
  `hyper-warp-backup/<session id>-<start time>/` inside the target repo's git
  directory (the space's bare repo for a worktree, `.git` for a plain repo),
  relative paths kept; the `hyper-warp-backup` directory and the per-warp
  directory are mode 0700. An entry of a different type is then removed on
  the target (a symlink is removed, never followed) so the copy can write
  this machine's. Warp prints the directory and the count. Untracked or
  ignored entries that are not collisions are left alone. A target that an
  older warp left half-way (its `.git` already this machine's, a directory
  still where this machine now has a file) is put right the same way.
- **Plain directory** (no repo): nothing is checked and nothing is saved.
- Excluded from the copy by default: `node_modules`, `_build`, `deps`,
  `target`, `dist`, `.turbo`, `.cache`, `.next`.

**`--dry-run` first** when the user is unsure: it prints every step and
changes nothing, here or there.

The way back is the same command from the other machine, which requires
this machine to be reachable from there (tailnet or a reverse tunnel) —
warp does not set that up.