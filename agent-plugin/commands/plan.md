---
name: plan
description: Run the hyper plan methodology — Define, Design, Decompose, Develop — for a feature, routing to the phase whose artifacts come next
argument-hint: <feature> [phase]
---

# Plan

Entry point for the [hyper plan](https://hyperdev.saulo.engineer) methodology:
four sequential phases that turn a business goal into validated, incremental
code. Each phase produces an artifact the next phase consumes.

| Phase | Skill | Produces |
|---|---|---|
| Define | `plan-define` | `define.md` — executable product definition |
| Design | `plan-design` | `design.md` — technical blueprint + constraints |
| Decompose | `plan-decompose` | `tasks.md` — ordered work units + tracked tasks |
| Develop | `plan-develop` | code, validated task-by-task; `deviations.md` when needed |

## Where artifacts live

All artifacts for a feature go in the space's `notes/specs/<feature-slug>/`.
The slug is the feature name lowercased, spaces to hyphens.

`notes/` sits at the space root, outside every working tree, so plan
artifacts are uncommittable by construction — and they exist on exactly one
disk. Tell the user this the first time a spec directory is created.

The native format (the section structures each skill specifies) is the only
one for now. Do not import or convert Spec-ify, TaskMaster, or Kiro specs.

## Routing

Given `<feature>`, derive the slug and look at
`notes/specs/<feature-slug>/`:

1. No directory, or no `define.md` → invoke the **plan-define** skill.
2. `define.md` exists, no `design.md` → invoke **plan-design**.
3. `design.md` exists, no `tasks.md` → invoke **plan-decompose**.
4. `tasks.md` exists → invoke **plan-develop**.

An explicit `[phase]` argument (`define`, `design`, `decompose`, `develop`)
overrides routing — but never skips prerequisites. If the user asks for
`design` and `define.md` does not exist, say so and start at Define instead.
Re-running an earlier phase on existing artifacts is fine: it means revising
that artifact, and every later artifact must then be re-checked against it.

## Usage

```
/hyper:plan checkout-flow            # routes to the next phase
/hyper:plan checkout-flow design     # jump to a phase (prereqs permitting)
```

## Ground rules across all phases

- Phases are sequential. Each skill refuses to run without its input artifact.
- Artifacts are the source of truth, not the conversation. If a decision is
  not written down in `define.md`/`design.md`/`tasks.md`, it was not made.
- Feedback goes to the agent as early as possible — that is why Develop
  validates after every task instead of at the end.
