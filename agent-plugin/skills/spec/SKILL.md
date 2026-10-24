---
name: spec
description: Use when a feature needs a written specification before any code - turning a business goal and the real codebase into define.md (goal, users, constraints, non-goals, testable acceptance criteria) and then design.md (architecture, checkable constraints, data model, risks, traceability). Triggers on "write a spec for", "spec this feature", "write define.md", "write design.md", "product definition and technical blueprint", "/hyper:spec", or a ship lead deciding a request needs a spec first.
---

# Spec

Written for Claude Code sessions. Input: a feature name and whatever the
requester has in their head. Output: `notes/specs/<feature-slug>/define.md`
then `design.md` - the what and why, then the how, precise enough that
`plan` can cut units from them without guessing.

The slug is the feature name lowercased, spaces to hyphens. `notes/` sits at
the space root, outside every working tree, so spec artifacts are
uncommittable by construction and exist on one disk only. Say so the first
time you create a spec directory. The format below is the only one; do not
import or convert Spec-ify, TaskMaster or Kiro specs.

Artifacts are the source of truth, not the conversation: a decision that is
not written in `define.md` or `design.md` was not made.

Two parts, in order, each with its own gate. Part 2 refuses to start without
a `define.md` that passed Gate 1. If asked for `design.md` with no
`define.md`, start at part 1.

## Part 1 - Define

This part is an interrogation, not dictation. The requester knows the
business goal; extract what they have not said out loud. Ask about each topic
until you could write the section without inventing anything. One topic at a
time; no questionnaire dump.

- **Goal** - what outcome does this serve? Why now?
- **Users** - who touches this, and what is their journey through it?
- **Constraints** - deadlines, compliance, compatibility, anything
  non-technical that bounds the solution. Technical constraints come in part 2.
- **Non-goals** - what is explicitly out. "None" is almost always an
  unexamined answer; push back once.
- **Acceptance criteria** - observable behaviours that mean "done". Each is
  testable: a person or a script gets a yes/no. "Fast", "intuitive", "robust"
  are not criteria until quantified or made observable.

**No one to ask** (autonomous run, or the requester is away): do not silently
invent answers. Write your best guess, collect every guess under
`## Assumptions (unconfirmed)`, and set the frontmatter to
`status: draft - assumptions unconfirmed`. Both gates still apply. The lead
confirms or rules on each unconfirmed assumption before running `kickoff`.

### define.md format

Frontmatter (`feature`, `status`, `phase: define`, `created`), then these
headings, which `design` and `plan` read by name:

```markdown
# <Feature name>

## Goal
## Users & Journey
## Constraints
## Non-goals
## Acceptance Criteria
## Open Questions
```

- Acceptance Criteria is a checklist (`- [ ]`), each item numbered `AC-1`,
  `AC-2`, ... so tasks can trace back to them.
- Open Questions holds anything deferred. Acceptance criteria never go there.

### Gate 1 - refuse to proceed

Do not start part 2, or tell anyone Define is done, while there are no
acceptance criteria or any criterion is untestable as written. Say which one
fails and why, and propose a testable rewrite for the requester to accept or
correct. With no one to ask, apply your rewrite and list it under
`## Assumptions (unconfirmed)`. An untestable definition makes every later
phase unverifiable.

## Part 2 - Design

Read before writing:

1. **`define.md`.** Every design decision must serve a Goal, Constraint or
   Acceptance Criterion. A decision that serves none is scope creep.
2. **The actual codebase.** Explore the worktree: architecture, conventions,
   the modules this touches, how similar features are built. Name real files
   and modules, not hypothetical ones. A design that ignores the code
   produces constraints the code already violates. If you are a lead that
   does not read code, delegate the lookup to a cheap read-only subagent with
   a narrow question.
3. **The project's toolchain** (`.claude/hyper.json` if present): the checks
   the units will run shape what "compliant" means.

### design.md format

Frontmatter (`feature`, `status`, `phase: design`, `created`, `reads`), then:

```markdown
# <Feature name> - Design

## Overview
## Architecture
## Constraints
## Data Model
## Risks
## Traceability
## Spec Documents Touched
```

- **Architecture** - components, boundaries, how the feature slots into the
  existing system, with real paths. For every element it adds (type, flag,
  file, option, command, config key), say who consumes it today. `plan`
  re-checks this per unit, so an element with no consumer here will stop a
  brief later.
- **Constraints** - rules the units must NOT deviate from, numbered `C-1`,
  `C-2`, ... Each is **checkable**: state the grep, test or command that
  verifies it. "All DB access goes through `src/db/repo.ts` (grep for direct
  `pg` imports elsewhere)" is a constraint; "keep the code clean" is not, and
  does not go in the list. If you cannot say how to check it, rewrite or drop it.
- **Data Model** - schemas, types, migrations, ownership of each piece of
  state. "None" is acceptable when true.
- **Risks** - what could invalidate this design, and the early signal for each.
- **Traceability** - map from each `AC-n` to the design parts that satisfy
  it. An `AC` with no coverage means the design is incomplete.
- **Spec Documents Touched** - if the project keeps contract or design docs
  (the globs in the ship config key `spec.paths`; read it with
  `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config --get spec.paths`), list every file under them
  this design changes. "None" is allowed. `plan` turns a non-empty list into
  a spec-PR unit that comes first. If it is missing or fails, use the defaults: rulings `notes/decisions.md`, `spec.paths` empty.

### Gate 2

Before declaring Design done: every constraint has a stated check, every
`AC-n` from `define.md` appears in Traceability, and every file under
`spec.paths` this design changes is listed under Spec Documents Touched. If designing shows that
`define.md` is wrong or incomplete, fix `define.md` first (with the requester,
or as a recorded assumption in an autonomous run) and re-pass Gate 1; do not
paper over it in the design.

## Hand-off

When Gate 2 passes, the next step is the `plan` skill on the same slug. Report
the spec directory, the AC and C counts, any unconfirmed assumptions, and the
list of spec documents touched.
