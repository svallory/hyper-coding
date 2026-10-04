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
- the copy would overwrite an untracked or ignored file in the target's
  copy (a `.env`, say) whose content differs from this machine's. Identical
  files and paths the copy excludes don't count.

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

**Say `--force` is the user's call.** Relay the refusal and stop; do not
retry with `--force` to "make it work".

## What `--force` actually saves (and what it does not)

- **Space worktree**: the target's uncommitted *tracked* work is saved there
  as a stash first (untracked and ignored files are not in it).
- **Plain repo**: the target's uncommitted tracked work is not saved; those
  files are overwritten one by one.
- **Both**: every untracked or ignored file the copy would overwrite with
  different content is first copied into
  `hyper-warp-backup/<session id>-<start time>/` inside the target repo's git
  directory (the space's bare repo for a worktree, `.git` for a plain repo),
  relative paths kept, directories mode 0700. Warp prints that directory and
  how many files it holds. Untracked or ignored files the copy does not
  overwrite are left alone.
- **Plain directory** (no repo): nothing is checked and nothing is saved.
- Excluded from the copy by default: `node_modules`, `_build`, `deps`,
  `target`, `dist`, `.turbo`, `.cache`, `.next`.

**`--dry-run` first** when the user is unsure: it prints every step and
changes nothing, here or there.

The way back is the same command from the other machine, which requires
this machine to be reachable from there (tailnet or a reverse tunnel) —
warp does not set that up.