---
name: land
description: Use when a unit the driver finished as READY must be merged and torn down, or when a unit must be abandoned and its agents, panes and worktree cleaned up. Triggers on "land the unit", "land <ref>", "merge the ready unit", "abandon the unit", "abandon <ref>", "tear down the unit", "/hyper:land".
---

# Land

Written for Claude Code sessions. Landing merges one READY unit and tears
everything it created down: agents, the unit's panes and space, the worktree.
It runs where the unit's worktree lives. For a unit started on another host with
`ship-unit run --host`, land it with `ship-land --host <host> <ref>`, using the host
shown by `ship-unit list`: it holds the local land lock and runs the land and
retire steps on that host.

## When to land

Land when `notes/loops/<ref>/result.json` says `READY` (the driver exited 0).
Nothing else qualifies: not PARKED, not OVER-BUDGET, not STUCK. Land one unit
at a time; the script takes a per-space lock, so a second land waits.

Do not review the diff yourself. The driver's review, spec check and gate are
the review. If something looks wrong, that is a ruling and a re-brief, not a
hand edit.

## Land

```
${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-land [--host <host>] <ref> [--task <tracker id>]
```

It rebases on the base branch (refusing an empty or commit-dropping rebase),
runs the project's `gate`, pushes, merges the PR with the configured
`merge_method`, runs each `on_land` command, then tears down. `--task` fills
`{task}` in `on_land` (default: the ref). Read the config with
`${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config`; do not restate it.

| Exit | Meaning | Do |
|---|---|---|
| 0 | Merged and torn down | Start any unit that was waiting on this one. Update the tracker if `on_land` does not. |
| 3 | Refused: not READY, empty branch, rebase dropped commits, or uncommitted changes | Do not force. Resume or re-brief the unit (`unit` skill). |
| 1 | Gate failed, rebase conflict, merge failed, or teardown left something behind | Read the message. A gate failure or conflict goes back to the dev as a re-brief (`unit` skill), with the gate output quoted as fact. A teardown leftover: run `land <ref>` again, it picks up where it stopped. |

`--force` lands a unit that is not READY. Use it only on an explicit operator
instruction, and log a ruling naming the operator and the reason.

## Abandon

Abandon a unit you will not land: it is stuck, its brief was wrong, its
rulings were overturned, or the plan changed.

```
${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-land <ref> --abandon
```

This runs only the teardown: no gate, no push, no merge. It stops the unit's
agents, closes its panes and space, removes the worktree and moves its loop
directory to `notes/loops/.done/<ref>/`. It leaves an unmerged branch alone.
`--abandon --force` also deletes the branch even if unmerged; the work is then
gone, so use it only when the operator said to discard it or its PR is closed.

After abandoning, log a ruling (what was dropped and why), update the tracker,
and decide whether a replacement unit is needed (`plan`, then `unit`).

## Do not

- Merge, rebase or push by hand, or call `gh pr merge` yourself.
- Land with `--force` to get past a failing gate.
- Remove a worktree or close a pane yourself; teardown owns that.
