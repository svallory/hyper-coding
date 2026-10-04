---
name: warp
description: Move a live Claude session to another machine — working directory, transcript and ownership — over ssh
argument-hint: "<machine> [--session id] [--stop] [--remote-control] [--force] [--dry-run]"
---

# Warp

Thin wrapper over `hyper warp`. **Run the CLI with the user's arguments and
relay the output — this command adds no logic of its own.**

```bash
hyper warp $ARGUMENTS
```

Warp is **send only**: the machine holding the session runs it. It copies
the working directory file by file (no `--delete`), this session's
transcript, and an ownership marker, over ssh.

Reading the output:

- **Refusals are the safety.** Warp refuses when the session is owned by the
  target, when the target's worktree or repo is dirty, and when the space is
  missing from the hyperdrive manifest — each without `--force`. Relay the
  refusal; do not retry with `--force` on your own.
- **`--force` is the user's call, stated plainly.** On a dirty space worktree
  it first saves the target's tracked changes in a stash (untracked files
  are **not** saved); a plain repo on the target is overwritten file by file
  with nothing saved. Say that before running it.
- **`--dry-run` first** when the user is unsure: it prints every step and
  changes nothing, here or there.
- The way back is the same command from the other machine, which requires
  this machine to be reachable from there (tailnet or a reverse tunnel) —
  warp does not set that up.
