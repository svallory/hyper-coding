---
name: plan-decompose
description: Use when running the Decompose phase of hyper plan — breaking design.md into ordered, dependent work units in tasks.md and creating tracked tasks for each. Triggers on "decompose the design", "break into tasks", "/hyper:plan <feature> decompose", or a spec dir with design.md but no tasks.md.
---

# Plan · Decompose

Third phase of hyper plan. Input: `notes/specs/<feature-slug>/define.md` and
`design.md`. Output: `tasks.md` in the same directory, plus one tracked task
per work unit so the harness follows progress.

**Prerequisite:** `design.md` must exist. If it is missing, stop and route to
the `plan-design` skill.

## Shape of a good unit

- Small enough that its result is easy to validate in one review — the point
  of Decompose is focused, targeted changes, not one big submission.
- Independently checkable: it has its own acceptance criteria and the
  project's checks pass when it is done.
- Ordered by dependency. A unit lists the units it depends on; units with no
  dependency between them may note they can run in parallel.

## Write tasks.md

```markdown
# <Feature name> — Tasks

## T-1: <title>
- **Depends on:** — (or T-n, T-m)
- **Traces to:** AC-2, C-1
- **Description:** what changes, in which files/modules
- **Acceptance:** how to verify this unit alone is done

## T-2: <title>
…
```

- Number tasks `T-1`, `T-2`, … in dependency order.
- **Traces to** links each task to the `AC-n` items in `define.md` (and the
  `C-n` constraints in `design.md` it must honor). Every `AC-n` must be
  covered by at least one task; every task must trace to at least one `AC-n`
  or be infrastructure a traced task depends on.
- **Acceptance** must be verifiable at that task's completion, not "works
  once everything else lands".

## Create tracked tasks

After writing `tasks.md`, create one real task per unit with the TaskCreate
tool — the file is the spec, the tracked tasks are how progress is followed.
If no task-tracking tool exists in the current environment, `tasks.md` alone
is authoritative: note "no task tracker available" at its top and skip this
section (including its line in the Gate) rather than failing the phase.

- Subject: `T-n: <title>` (matching `tasks.md` exactly).
- Description: the unit's description and acceptance criteria, plus
  `Depends on: T-n, …` stated explicitly so the dependency survives in the
  tracker.
- Do not start any of them here; Develop works them one at a time.

## Gate

Verify: every `AC-n` in `define.md` is traced by some task, no dependency
cycle exists, and the tracked tasks match `tasks.md` one-to-one. Then tell the
user the next step is `/hyper:plan <feature> develop` (the `plan-develop`
skill).
