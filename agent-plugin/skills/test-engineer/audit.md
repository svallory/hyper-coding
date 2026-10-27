# Audit and slim a suite

Reference for the `test-engineer` skill. Run when a suite is over its budget,
when the gate takes longer than the unit it checks, or when asked to audit
the tests. The outcome is a smaller suite that catches the same breaks, with
the evidence that it does.

- [Measure](#1-measure)
- [Map](#2-map)
- [Decide per test](#3-decide-per-test)
- [Cut in slices](#4-cut-in-slices)
- [Report](#5-report)
- [Keep it slim](#6-keep-it-slim)

## 1. Measure

Numbers first, on an idle machine, before any opinion:

| Measure | How | Finding when |
|---|---|---|
| Wall time per file, sorted | `vitest --reporter=verbose`, `pytest --durations=0`, `go test -json`, timing lines in a bash harness (`SECONDS` before and after each file) | the top five files hold most of the time |
| Process spawns per file | count calls to the program under test, `spawn`, `execa`, `subprocess`, `$(...)` of the binary; for bash harnesses `grep -c 'ship-land\b'`-style counts | more than ten per file |
| Expensive fixtures per file | `git init`, `createServer`, `launch(`, database creation, `docker`, `mktemp -d` per case | more than one per file |
| Sleeps and timeouts | `sleep`, `setTimeout` in tests, raised `timeout:` values | any |
| Lane mix | small / medium / large counts (sizes in `layers.md`) | large tests exist outside a slow lane, or medium tests outnumber small |
| Overlap candidates | tests whose names or assertions name the same behaviour; tests that fail together on one mutation | pairs found |

Write the numbers down; they are the "before" of the report.

## 2. Map

A coverage map, one row per test case (not per file), kept as a markdown
table or CSV in the audit's notes:

| Test | Behaviour it protects | Layer now | Lowest layer possible | Seam needed | Unique break it catches | Decision |
|---|---|---|---|---|---|---|
| `test-t-ship-land.sh: queued auto-merge refused` | land refuses while PR OPEN with auto-merge | large (spawns land, builds repo) | small (`decide_land`) | sourceable functions in `ship-land` | exit 3 before any push | move down |

Fill "unique break" by asking, per test, which single production change makes
this test fail and no other test in the map fail. Two tests with the same
answer overlap. A test with no answer (it fails only together with others, or
only on a refactor) is a change detector.

Filling the map is reading, not running; delegate file-by-file reading to
subagents with the table as their output format when the suite is large.

## 3. Decide per test

| Decision | When | Evidence required before the change |
|---|---|---|
| **keep** | its unique break is real and its layer is the lowest possible | none |
| **merge** | several cases differ only in input: one behaviour, many variants | the table-driven replacement lists every original input and expected value |
| **move down** | the behaviour is reachable at a lower layer, after a seam | the new small test fails on the same mutation the large one did (break the code, run both, restore) |
| **hoist the fixture** | cases rebuild an expensive fixture | the per-file fixture plus per-case state (branch, temp dir, row) gives the same assertions |
| **replace** | a change detector or mirrored assertion guards a real behaviour badly | the replacement names the behaviour and uses literal expectations |
| **slow lane** | a large test whose journey matters and cannot move down | the journey is named; it leaves the affected run |
| **quarantine** | it flakes | owner and date; out of the gate; a week to fix or delete |
| **delete** | its break is caught by another test (named), or it has no break | the mutation check: break the code once, the named survivor fails, the suite without the deleted test fails too |

Never: delete without a named survivor; skip silently; raise a timeout;
lower a coverage threshold to make numbers fit; "temporarily" comment out.

## 4. Cut in slices

1. Seams first: add the sourceable functions, injected collaborators or pure
   core the "move down" rows need. Pure refactor, behaviour unchanged, the
   old tests still green.
2. Then one file (or one behaviour cluster) per slice: hoist fixtures, write
   the small tests, run the mutation checks, delete what the map says, run
   the file. Suite green after every slice.
3. Commit per slice with the map rows it executed in the message.
4. Affected selection last: if the project had none, add it (`affected.md`);
   if it had one, check the moved tests are still reachable.

## 5. Report

Before and after, same machine, same conditions:

| | Before | After |
|---|---|---|
| Suite wall time | 20 min | 4 min |
| Affected run for a one-file change | 20 min (no selection) | 12 s |
| Test cases | 412 | 388 |
| Process spawns (largest file) | 111 | 9 |
| Repositories built (largest file) | 96 | 1 |
| Large tests outside a slow lane | 31 | 0 |
| Sleeps | 14 | 0 |

Plus: the map (every row's decision and its evidence), the behaviours that
turned out to have no test at all (they get a row in the next plan), and the
budgets now enforced in CI.

## 6. Keep it slim

- CI prints per-file durations on every PR and fails over the suite budget.
- The review check "no overlap" and "layer and fixtures" (SKILL.md) stop the
  regrowth per diff.
- A suite that is over budget again is audited again; the map from the last
  audit is the starting point, not a blank table.
