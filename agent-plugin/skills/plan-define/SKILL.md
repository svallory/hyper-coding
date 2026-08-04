---
name: plan-define
description: Use when starting the Define phase of hyper plan — turning a business goal into an executable product definition (define.md) through interrogation about goal, users, constraints, non-goals, and acceptance criteria. Triggers on "define the feature", "product definition", "/hyper:plan <feature> define", or a spec dir with no define.md.
---

# Plan · Define

First phase of hyper plan. Input: a feature name and whatever the user has in
their head. Output: `notes/specs/<feature-slug>/define.md` — the what, the why,
and success metrics, precise enough that Design can proceed without guessing.

This phase is an interrogation, not dictation. The user knows the business
goal; your job is to extract the parts they have not said out loud.

## Interrogate

Ask about each of these until you could write the section without inventing
anything. One topic at a time; do not dump a questionnaire.

Running without a user who can answer (autonomous or delegated run): do not
silently invent answers. Write your best-guess answer, collect every guess
under an `## Assumptions (unconfirmed)` section, and mark the frontmatter
`status: draft — assumptions unconfirmed`. The gate to Design still applies,
but Develop must not mark the first task complete while that status stands —
someone has to confirm the assumptions first.

- **Goal** — what business outcome does this serve? Why now?
- **Users** — who touches this, and what is their journey through it?
- **Constraints** — deadlines, compliance, budget, compatibility, anything
  non-technical that bounds the solution space. (Technical constraints come
  later, in Design.)
- **Non-goals** — what is explicitly out of scope. Every feature has these;
  "none" is almost always an unexamined answer, push back once.
- **Acceptance criteria** — observable behaviors that mean "done". Each must
  be testable: a person or a script can check it and get a yes/no. "Fast",
  "intuitive", "robust" are not criteria until quantified or made observable.

## Write define.md

Fixed section structure — Design and Decompose read these headings by name:

```markdown
# <Feature name>

## Goal
## Users & Journey
## Constraints
## Non-goals
## Acceptance Criteria
## Open Questions
```

- **Acceptance Criteria** is a checklist (`- [ ]`), each item numbered
  `AC-1`, `AC-2`, … so Decompose can trace tasks back to them.
- **Open Questions** holds anything the user deferred. Fine to leave items
  here — but not acceptance criteria.

## Gate: refuse to proceed

Do **not** hand off to `plan-design` (or tell the user Define is done) while:

- there are no acceptance criteria, or
- any criterion is untestable as written.

Say which criterion fails and why, and propose a testable rewrite for the user
to accept or correct. An untestable definition makes every later phase
unverifiable — Develop validates tasks against these exact criteria.

When the gate passes, tell the user the next step is
`/hyper:plan <feature> design` (the `plan-design` skill).
