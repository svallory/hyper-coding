---
name: test-engineer
description: Use when tests must be planned for a unit before its code exists, when a diff's tests are reviewed, when a test suite is slow, growing or full of overlap and must be audited and slimmed, or when a project needs affected-only test runs. Triggers on "test plan", "plan the tests", "test budget", "review the tests", "slim the test suite", "audit the tests", "the suite is slow", "affected-only tests", "which tests to run", "test architecture".
---

# Test engineer

Written for Claude Code sessions and for the dev and review agents ship
launches. You own the test architecture of everything built with `ship`: which
behaviours get a test, at which layer, with which fixtures, inside which time
budget, and which tests must go. A test suite is a cost paid on every change;
every test must earn its place with a bug only it catches.

Four procedures, each with a consumer:

| Procedure | Who runs it | Output |
|---|---|---|
| [Plan](#plan-the-tests-of-a-unit) the tests of a unit before code exists | the `plan` skill, per brief | the brief's `## Tests` section |
| [Review](#review-a-diffs-tests) a diff's tests | the review agent, every round | findings in the review verdict |
| [Audit](#audit-and-slim-a-suite) and slim an existing suite | an agent asked to, or a unit briefed for it | a coverage map, a slimmer suite, before/after timings |
| [Set up](#set-up-affected-only-runs) affected-only runs | an agent asked to, or the first unit of a project with none | a `test:affected` command, used by the brief and the gate |

Reference files beside this one: `layers.md` (test sizes, doubles, seams,
determinism, when property, snapshot and mutation testing pay), `affected.md`
(affected-only selection per stack, with a bash harness pattern), `audit.md`
(the slimming procedure with its coverage map).

## Rules

Violating the letter of a rule is violating its spirit.

1. **One behaviour, one test, lowest layer.** Each behaviour in the acceptance
   criteria gets exactly one test, at the lowest layer that can fail for that
   behaviour (table below). A second test of the same behaviour at a higher
   layer is overlap: delete it, or delete the lower one if the higher one is
   the only way to reach the behaviour.
2. **Budgets are part of the plan.** A unit states, before code exists, how
   many seconds its new tests may add and how long its affected run may take.
   Defaults, measured on an idle machine: a small test under 100 ms; a test
   file under 2 s; new tests of one unit under 5 s (S), 15 s (M), 30 s (L);
   the affected run under 60 s; the full suite under 10 min. A project may
   set tighter numbers in its rules file, never looser ones without a ruling.
3. **Expensive things are built once.** A process spawn, a git repository, a
   database, a browser, a network listener is a fixture built once per file
   (or once per suite) and reused; a test case changes state inside it
   (a branch, a row, a route) and never rebuilds it. A file that spawns the
   system under test more than ten times, or builds more than one repository,
   is a finding. A unit never adds a case to a file that is already over
   this line: its new tests go to a new file at the lowest layer, and the
   file is named in the summary as audit work (`audit.md`).
4. **A seam is part of the unit.** If a behaviour can only be reached by
   spawning the program, the unit adds the seam that exposes it in-process
   (a sourceable function, an injected dependency, a pure core with an I/O
   shell) and tests through the seam. "The script has no functions to call"
   is the reason to add one, not the reason to go end to end.
5. **Deterministic or deleted.** No sleeps, no real clocks, no unseeded
   randomness, no order dependence, no shared mutable state between cases,
   no network beyond localhost. A flaky test is quarantined with an owner and
   a date on the day it flakes, and fixed or deleted within a week.
6. **Assert state through the public surface.** Verify what the behaviour
   left behind (the return value, the file, the row, the exit code), not which
   internal calls happened. Interaction checks are for state-changing calls
   whose effect cannot be observed otherwise. Expected values are literals,
   never computed by the code under test.
7. **Affected-only while working, full suite only in CI.** Every unit names
   the command that runs the tests its change affects; the dev runs that, not
   the suite. New test files land where that command finds them.
8. **Delete with evidence.** A test is removed only with a row in a coverage
   map naming the test that now catches the same break, proven by breaking
   the code once (`audit.md`).

## Which layer

| The behaviour is | Layer | Looks like | Each case costs |
|---|---|---|---|
| A computation, a decision, parsing, formatting, validation | **small** (unit): one process, no I/O, no clock, no sleep | call the function with literal input, assert literal output; table-driven for variants | under 100 ms |
| A boundary your code owns: file layout, a CLI's exit codes and output, a module talking to a real local dependency | **medium** (integration): one machine, localhost only, real fakes (temp dir, in-memory store, stub binary on PATH) | one shared fixture per file; cases change state inside it | under 2 s |
| A contract with something you do not own (a remote API, another repo's CLI) | **contract**: a fake that is itself checked against the real thing, on a schedule, not per change | fake plus one contract test; the fake is what units test against | runs in a slow lane |
| A whole journey through the real surface | **large** (end to end) | at most one per journey the feature exists for; never per edge case | seconds to minutes; slow lane |

If a behaviour seems to need a higher layer, name what stops it being lower.
A missing seam (rule 4) is the usual answer, and a seam is cheaper than a
large test on every run for years. `layers.md` has the definitions, the
doubles to use at each layer and stack examples (TypeScript/vitest, bash,
Python).

## Plan the tests of a unit

Run by the `plan` skill for every brief, before code exists. Fill the
brief's `## Tests` section from this:

1. **List behaviours** from the acceptance criteria and constraints. One row
   per behaviour; an edge case that changes the outcome is its own row (an
   empty input, a missing file, a second run); one that does not is a table
   entry in an existing row, not a test.
2. **Pick the layer** per row with the table above. Write the entry point
   (function, command, module) the test calls. When the lowest layer needs a
   seam that does not exist, name the seam in the row and in `## Consumers`
   (its consumer is the test that calls it and the shell that uses it).
3. **Name the fixture** per row, and reuse: one fixture per file, built once.
   If the fixture is the project's existing one (a helper, a stub binary),
   name it.
4. **Find existing tests to extend or replace.** Grep the test directory for
   the behaviour and the files the unit touches (delegate to a subagent if you
   lead). A new test that asserts what an existing test asserts is not
   written; the row says `extends <file>:<test>` (the existing test gains an
   assertion), `replaces <file>:<test>` (it goes, with the evidence rule) or
   `covered by <file>:<test>` (nothing is written; the row records that the
   behaviour was checked for).
5. **Write the budget**: seconds the new tests may add (rule 2 defaults by
   class unless the project's rules say less), and the affected-run command
   the dev uses (`affected.md`; the project's `test:affected` script when it
   has one). If the project has no affected-only command, the first unit of
   the plan sets one up, and the other units depend on it.
6. **Write the do-not-add list**: the tests a dev would be tempted to add
   that would overlap (the same behaviour end to end, a snapshot of a whole
   output, a test per variant that a table covers).

A plan that puts every row at the large layer is wrong: either the code
needs a seam or the behaviours are mis-stated. Fix the plan, not the budget.

## Review a diff's tests

Run by the review agent on every round, from the diff and the dev's summary,
without running tests. Each check that fails is a finding with a concrete fix.

| Check | How | Severity |
|---|---|---|
| Follows the brief's `## Tests` | each row has its test at its layer and entry point; each new test maps to a row | SHOULD: move it; BLOCKING: a row with no test |
| No overlap | for each new test, name the production change that only it catches; two tests sharing one break lose one; a test whose break an existing test already catches is deleted | SHOULD: delete, name the survivor |
| Layer and fixtures | count process spawns, repositories, servers, browsers created per test and per file; anything above one per file, or any large test the brief did not plan, is a finding | SHOULD: hoist to a file fixture, or add the seam |
| Budget met | the summary states the affected-run command, its counts and its wall time; compare with the brief's budget | SHOULD: over budget, with what to cut; BLOCKING: no timing in the summary |
| Deterministic | no sleep, `Date.now`/`time.time`/`date` without injection, unseeded random, test order dependence, shared mutable module state, real network | BLOCKING |
| Assertions hold | expected values are literals; no assertion that mirrors the implementation; no change detector (asserting a constant, exact log wording, private structure); no snapshot wider than the contract it pins; no `toHaveBeenCalled` on a read; a mock earns no assertion by existing | BLOCKING: vacuous or mirrored; SHOULD: change detector |
| Reachable by affected selection | the new test file is where the project's affected command finds it (import graph, path map, package); a test only the full suite runs is a finding | SHOULD: move or map it |
| Mutation-proved | the summary shows each new behaviour test failing when the code is broken (the dev rule); missing for any new test | SHOULD |

Vacuous and missing tests go in the same verdict as everything else; the
test findings are not a separate review.

## Audit and slim a suite

Run when a suite is over its budget, when the gate takes longer than the
unit it checks, or when asked. Procedure and coverage map in `audit.md`:
measure per-file time and spawn counts; map every test to the behaviour and
layer it covers; mark each test keep, merge, move down, or delete with the
evidence rule; cut in slices with the suite green after each; report before
and after timings and counts. The outcome is a smaller suite that catches the
same breaks, never a faster suite that catches fewer.

## Set up affected-only runs

Run when a project has no command that runs only the tests a change affects.
`affected.md` gives the command per stack (vitest `related`, jest
`--findRelatedTests`, pytest-testmon, `go list` reverse deps, moon/nx/turbo
`--affected`, a path map for bash harnesses) and the shape of a
`test:affected` script that takes a base ref. Its consumers: the brief's
`## Tests` section, the dev's working loop, and the ship `gate` when the
project chooses an affected-only gate with the full suite in CI.

## Red flags

Stop and fix the plan, the diff or the audit when you see:

- a test plan with every row at the large layer, or no `## Tests` section;
- "just to be safe", "also covers it end to end", "well covered" without a
  behaviour name;
- a fixture built inside a test case that another case also builds;
- a test file that spawns the program it tests once per case;
- a budget raised to fit the tests instead of the tests cut to fit the budget;
- a sleep, a retry loop around an assertion, a raised timeout;
- a test deleted or skipped with no coverage-map row;
- a dev summary with no affected-run command and timing;
- "extracting a seam is a refactor, out of scope" when the brief's row names
  the seam;
- running the full suite to check one change.

| Rationalization | Reality |
|---|---|
| "More tests is safer" | A duplicate catches no new bug and costs every run forever. Safety is a break with exactly one test that catches it. |
| "The script has no callable functions, so end to end is the only option" | That is the seam the unit adds. Thirty lines of refactor beat a minute per run. |
| "A fresh repository per case keeps cases isolated" | Isolation comes from state inside the fixture (a branch, a temp dir), not from rebuilding the world. |
| "The budget is tight for this unit" | The budget was set from the class; cut the plan, do not extend the budget. A ruling can change a project's numbers; a dev cannot. |
| "I will clean the tests up later" | Later is the audit, which costs more than planning now. The review finds it this round. |
| "The full suite ran green, so the affected command does not matter" | The next hundred runs pay for that habit. The affected command is a deliverable of the unit. |
