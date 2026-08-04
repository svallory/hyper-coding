---
name: plan-design
description: Use when running the Design phase of hyper plan — turning define.md plus the actual codebase into a technical blueprint (design.md) with architecture, checkable constraints, data model, and risks. Triggers on "design the feature", "technical blueprint", "/hyper:plan <feature> design", or a spec dir with define.md but no design.md.
---

# Plan · Design

Second phase of hyper plan. Input: `notes/specs/<feature-slug>/define.md`.
Output: `design.md` in the same directory — the technical blueprint the
Decompose and Develop phases must comply with.

**Prerequisite:** `define.md` must exist with acceptance criteria. If it is
missing, stop and route to the `plan-define` skill; do not design from the
conversation alone.

## Read before writing

1. **`define.md`** — every design decision must serve a Goal, Constraint, or
   Acceptance Criterion in it. If a decision serves none, it is scope creep.
2. **The actual codebase.** Explore the worktree: existing architecture,
   conventions, the modules this feature touches, how similar features are
   built. A design that ignores the codebase produces constraints the code
   already violates. Name real files and modules in the design, not
   hypothetical ones.
3. The project's toolchain (`.claude/hyper.json` if present) — the checks
   Develop will run shape what "compliant" means.

## Write design.md

Fixed section structure:

```markdown
# <Feature name> — Design

## Overview
## Architecture
## Constraints
## Data Model
## Risks
## Traceability
```

- **Architecture** — components, boundaries, and how the feature slots into
  the existing system. Reference real paths.
- **Constraints** — the rules Develop must NOT deviate from, numbered `C-1`,
  `C-2`, …. Every constraint must be **checkable**: state how a reviewer or a
  command verifies compliance. "All DB access goes through `src/db/repo.ts`
  (grep for direct `pg` imports elsewhere)" is a constraint; "keep the code
  clean" is vibes and does not go in this list. If you cannot say how to
  check it, rewrite it or drop it.
- **Data Model** — schemas, types, migrations, ownership of each piece of
  state. "None" is acceptable when true.
- **Risks** — what could invalidate this design, and the early signal for
  each.
- **Traceability** — a short map from acceptance criteria (`AC-n`) to the
  parts of the design that satisfy them. An `AC` with no design coverage
  means the design is incomplete.

## Gate

Before declaring Design done, verify every constraint has a stated check and
every `AC-n` from `define.md` appears in Traceability. Then tell the user the
next step is `/hyper:plan <feature> decompose` (the `plan-decompose`
skill).

If designing reveals that `define.md` is wrong or incomplete, update
`define.md` first (with the user), then resume — do not paper over it here.
