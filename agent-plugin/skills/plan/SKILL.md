---
name: plan
description: Use when a spec or a request must become units a dev agent can run - ordered work units in tasks.md plus one self-contained brief per unit, each checked so that everything it adds has a consumer today. Triggers on "write the briefs", "brief the units", "plan the units", "write tasks.md", "turn the spec into units", "brief for unit", or a spec dir with design.md but no tasks.md. Not for generic task lists or to-do planning.
---

# Plan

Written for Claude Code sessions. Input: `notes/specs/<slug>/define.md` and
`design.md` (from the `spec` skill), or, when no spec was needed, the request
itself. Output: `tasks.md` beside the spec (or `notes/specs/<slug>/` created
for it) and one brief per unit at `notes/briefs/<ref>.md`, written from
`${CLAUDE_PLUGIN_ROOT}/skills/plan/brief-template.md`.

No task-tracker calls here: the file is the plan; the `kickoff` skill puts it
in a tracker when the project uses one. If a spec is expected but
`design.md` is missing, stop and route to the `spec` skill.

## Read first

1. `define.md` and `design.md` in full (skip when there is no spec).
2. The rulings file: the ship config key `rulings`
   (`${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config --get rulings`). Entries are `## D<n> — <title>`
   with `Ruling`, `Reason`, `By`, `Status`. Briefs quote the ones they
   depend on; they never paraphrase them.
3. The spec-paths globs: `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config --get spec.paths`.
   If it is missing or fails, use the defaults: rulings `notes/decisions.md`, `spec.paths` empty.
   These skills must work in a project with no ship config.
4. A project-wide common brief at `notes/briefs/common.md`, if one exists.
   Briefs point at it; they do not repeat it.
5. The `test-engineer` skill
   (`${CLAUDE_PLUGIN_ROOT}/skills/test-engineer/SKILL.md`), section "Plan the
   tests of a unit": it fills each brief's `## Tests` section (layer per
   behaviour, fixtures, budget, affected-run command). If the project has no
   affected-only test command, the first unit of the plan adds one and the
   others depend on it.

## Shape of a unit

- One reviewable change that fits one class budget: **S**, **M** or **L**
  (minutes come from the config `budgets`). If it will not fit L, split it.
- Independently checkable: its own acceptance criteria, and the project's
  gate passes when it is done.
- Ordered by dependency; units with no edge between them may run in parallel
  and share a wave.
- Its `ref` is a short kebab-case name; it becomes the branch, the loop
  directory and the brief file name.

## tasks.md

```markdown
# <Feature name> - Tasks

## T-1: <title>
- Ref: <ref>   Class: S|M|L
- Depends on: - (or T-n, T-m)
- Traces to: AC-2, C-1
- Consumer: who uses this unit's output today
- Description: what changes, in which files and modules
- Acceptance: how to verify this unit alone is done
```

- Number tasks in dependency order. Every `AC-n` is covered by at least one
  task; every task traces to an `AC-n`, or is infrastructure a traced task
  depends on.
- Acceptance is verifiable when that task completes, not "once everything
  else lands".
- **Spec-PR first.** If `design.md` lists files under Spec Documents Touched (anything
  under `spec.paths`), `T-1` is a unit that lands those document changes
  alone, and every unit that builds on them depends on it.
- A table of waves (which tasks run together) at the top helps the lead.

## Consumer gate

For every unit, list each element it adds: type, field, flag, option,
command, file, config key, script, schema, doc. For each, name its
**consumer**: the code path, command, or person that uses it once the unit
has merged. A consumer must be one of:

- something already in the tree on the base branch;
- another unit of this plan that is itself consumed (name its `ref`), as long
  as the chain ends in code that runs or a person who reads it.

A test is a consumer only of the behaviour it asserts, never of the element
that merely exists to be tested. "Might be useful later" is not a consumer.

**Refuse to write a brief while any element lacks one.** Do not soften the
element and ship the brief. Report to the caller each refused element with
three options: drop the element, move it into the unit that consumes it, or
get a ruling that names a real consumer. Write the briefs for the units that
pass; hold the others.

## Briefs

One file per unit from the template. Rules the template cannot enforce:

- **Self-contained.** A dev who has read only this brief, the project's own
  rules file and the files it names can start. Name paths to the spec and
  line up the AC and C numbers with the spec's.
- **Rulings are quoted by number**, e.g. `D214 (binding): ...`, with the
  ruling text copied. A ruling that is not in the rulings file does not go
  in a brief; log it first.
- **No fix hypotheses.** The lead is not a debugger. A brief states the
  goal, the symptom or gap with its evidence, and the expected behaviour. It
  never says why something is broken or how to fix it.
- **Acceptance criteria are copied** from the spec or tasks.md, numbered, each
  checkable by a command or an observation. Add the `Verify` commands
  verbatim.
- **Scope has an out side.** Name what the dev must not touch, especially
  files a parallel unit owns.
- **Tests are planned, not accumulated.** The `## Tests` section is filled
  with the `test-engineer` skill: one row per behaviour at the lowest layer
  that can fail for it, a budget in seconds, the affected-run command, and the
  tests not to add. A seam the lowest layer needs is an element of the unit;
  its consumer is the production code that calls it (the shell, the
  command), never the test. A unit that adds no behaviour (docs, config)
  writes `None — <reason>` instead of the table.
- No `bd`, tracker, or host-specific instructions in a brief; the driver and
  `kickoff` own those.

## Gate

Before telling anyone planning is done, verify and state the evidence for:

1. every `AC-n` in `define.md` is traced by a task (skip when no spec);
2. no dependency cycle;
3. every brief has all template sections filled, no `<placeholder>` left outside the Rules section;
4. every element in every brief has a named consumer (the gate above);
5. every ruling quoted in a brief exists in the rulings file with that text;
6. every brief's `## Tests` section has a row per acceptance criterion, a
   budget, an affected-run command, and no row at the large layer without the
   reason a lower layer cannot reach it; or reads `None — <reason>` for a
   unit that adds no behaviour.

Then report the waves, the briefs written, the briefs held and why, and name
the next step: the `kickoff` skill.
