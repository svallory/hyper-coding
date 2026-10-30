---
name: kickoff
description: Use when a plan with tasks.md and briefs is ready to start - putting it in the issue tracker as an epic with dependent children when one is configured, and launching the first wave of units within the free slots. Triggers on "kick off the epic", "kickoff the plan", "start the first wave", "create the tracker items", "/hyper:kickoff".
---

# Kickoff

Written for Claude Code sessions. Input: `notes/specs/<slug>/tasks.md` and one
brief per unit in `notes/briefs/` (from the `plan` skill). Output: tracker
items when the project uses a tracker, and the first wave of units running.

Read the settings with `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config`
(`--get tracker`, `--get hosts`). Defaults are in
`${CLAUDE_PLUGIN_ROOT}/skills/ship/defaults.yml`; do not copy them here.
Refuse to start if a unit in the first wave has no brief.

## 1. Tracker

If `tracker` is `none`: skip this step. `tasks.md` is the plan; there are no
tracker ids, and `on_land` closes nothing.

If `tracker` is `beads`: create one epic for the feature (title = the feature
name, description = the spec path and goal) and one child per unit (title =
the unit's title, description = its ref, class and brief path). Then add a
dependency edge for each `Depends on` in `tasks.md`, so the tracker's ready
list matches the plan. Use the beads skills (create, dep, epic). Write the
tracker ids back into `tasks.md` beside each unit (`- Tracker: <id>`), so the
lead can pass `--task <id>` to `land` later. Do not duplicate items: if
`tasks.md` already has a tracker id for a unit, reuse it.

Do not put `bd` commands or tracker instructions in a brief.

## 2. First wave

The first wave is the units with no unmet dependencies.

1. Count free slots per host: `hosts.<name>.slots` from the config minus the
   units shown running by `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-unit list`.
2. Take ready units in `tasks.md` order until the slots are full. With
   several hosts, fill the first listed host first. Pass `--host` for any
   host other than `local`.
3. Launch each with the `unit` skill, in the background, passing
   `--spec-dir notes/specs/<slug>`: the base is the `base:` in `tasks.md`
   (no `tasks.md` base: the default branch). Pass `--base` only to override. Never launch more
   than the free slots, even if more units are ready.
4. The units that did not fit wait. Each landed unit frees a slot and may
   unblock others; the lead starts them one by one as it lands.
5. When the tracker is beads, mark each started unit's item in progress.

## Report

Tell the caller: the epic id (if any), the units started with their hosts and
slots used, the units waiting and what they wait on. Then stop and wait for
the first driver exit. Do not poll.

## Do not

- Start a unit whose dependency has not landed.
- Exceed the slots to "get ahead".
- Create tracker items for units that failed the consumer gate.
