---
name: plan-develop
description: Use when running the Develop phase of hyper plan — executing tasks.md one task at a time, validating each against define.md criteria and design.md constraints before marking it complete. Triggers on "develop the feature", "work the tasks", "/hyper:plan <feature> develop", or a spec dir that already has tasks.md.
---

# Plan · Develop

Fourth phase of hyper plan. Input: `notes/specs/<feature-slug>/define.md`,
`design.md`, `tasks.md`, and the tracked tasks Decompose created. Output:
code, one validated unit at a time — and `deviations.md` when reality
disagrees with the design.

**Prerequisite:** `tasks.md` must exist. If it is missing, stop and route to
the `plan-decompose` skill.

This phase is the friction gate. The artifacts upstream are cheap to write;
here they get teeth. The easy path must be compliance; deviation must cost a
written justification.

## Work one task at a time

Pick the lowest-numbered task whose dependencies are all complete. Mark it
in progress in the tracker. Do not batch tasks, and do not start the next one
before the current one passes validation — early feedback after each unit is
what prevents compounding errors.

While implementing, treat the `C-n` constraints in `design.md` as hard rules,
not suggestions.

## Before marking a task complete

All three, every task, no exceptions:

1. **Re-read** the task's acceptance criteria in `tasks.md` and the `C-n`
   constraints it traces to in `design.md`. Re-read means open the file now,
   not recall from earlier in the session.
2. **Run the project's checks.** If `.claude/hyper.json` has an enabled
   `check` config (see the `hyper-tooling` skill), run that command; the
   per-edit hook has been running it too, but run it once more over the
   finished unit. Otherwise run the project's own lint/typecheck/test scripts.
   A task whose checks fail is not complete.
3. **Confirm** each acceptance item explicitly — state the evidence, not
   "looks done". Only then mark the tracked task complete.

## Deviations require a written justification first

Any deviation from `design.md` — a different boundary, a bypassed constraint,
a changed data model — requires appending an entry to
`notes/specs/<feature-slug>/deviations.md` **before** writing the deviating
code:

```markdown
## T-4: <what deviates>
- **Constraint:** C-2
- **Why the design does not work here:** …
- **What is done instead:** …
```

This is Engineered Friction by design: doing the wrong thing must require the
extra, harder step of formally justifying it. If the justification is not
worth writing, the deviation is not worth making — follow the design. If a
deviation invalidates other tasks or constraints, stop and update `design.md`
(and `tasks.md`) with the user before continuing.

## Compounding errors rule

If **two consecutive tasks fail validation** — checks fail, or acceptance
criteria cannot be confirmed — stop implementing. The problem is upstream:
revisit `design.md` with the user (route back through the `plan-design`
skill), reconcile, and update `tasks.md` before touching more code. Pushing
through a broken design compounds the error into every remaining task.

## Done

The feature is done when every task in `tasks.md` is complete and every
`AC-n` in `define.md` has been confirmed against the running result — not
merely against per-task claims. Walk the acceptance criteria list one final
time and report each with its evidence.
