# Brief template

Copy everything below the line into `notes/briefs/<ref>.md`, fill every
`<...>`, delete the guidance lines in parentheses, and keep the "Rules" and
"Verdict file" sections word for word. A brief with a leftover `<...>` is not
ready. The plan skill's consumer gate and no-fix-hypotheses rules apply.

---

# Brief - <ref> - class <S|M|L>

(One line: what the unit is, in the words of tasks.md. Class budgets come
from the config `budgets`; the driver enforces them.)

Read first: the project's own rules file (`AGENTS.md` or `CLAUDE.md`) in your
worktree<, and `<path to notes/briefs/common.md>` if the project has one>.

## Goal

(Two to five sentences: the outcome, not the method. State the symptom or gap
with its evidence if this fixes something. Never guess a cause and never
prescribe a fix: no "probably because", no "change X to Y" unless Y is a
spec requirement quoted below.)

## Consumers

(One row per element this unit adds: type, field, flag, option, command, file,
config key, script, schema, doc. The consumer is who uses it once this unit
has merged: an existing code path or command, a person, or the `ref` of a
planned unit that is itself consumed. A test alone is not a consumer. No row
may be empty. If an element has no consumer, it is not in this brief.)

| Element | Kind | Consumer today |
|---|---|---|
| <name> | <type\|flag\|file\|command\|...> | <existing caller, or unit <ref> that <does what>> |

## Rulings

(Quote each ruling this unit depends on, with its number and status exactly as
in the rulings file. Write "None" if none apply. These are binding; do not
reopen them. Ask a QUESTION if one conflicts with the code.)

- D<n> (<status>): <ruling text>

## Spec

(Paths to the binding documents and the sections that matter. Where the spec
and the code disagree, the spec wins. Write "None" if there is no spec.)

- <path>: <sections>

## Acceptance criteria

(Numbered, each checkable by a command or an observation. Keep the spec's
AC and C numbers in front when they exist.)

1. <AC-n: observable behaviour, and how it is checked>

## Constraints

(Rules from the design that this unit must not break, each with its check.
"None" if none.)

- <C-n: rule. Check: <grep or command>>

## Scope

In scope:
- <what this unit changes>

Out of scope (do not touch):
- <files, behaviours, or work owned by another unit>

## Where

(Worktree, branch and base are in your launch prompt. Work only in the
worktree. Repository files you commit must not mention anything outside the
repository: no absolute local paths, no space-root files.)

Spec directory: <abs path to notes/specs/<slug>/>. Deviations file:
<abs path>/deviations.md.

## Verify

(Exact commands, run from the worktree, each with the result that means
pass. Run only what your change affects, not the whole suite, unless the
command below says otherwise. The final gate is run by the driver.)

```
<command>   # expect: <pass condition>
```

## Rules

These apply to every unit. Do not edit them.

1. **Re-read before DONE.** Before you write a DONE verdict, open this brief
   again and re-read the acceptance criteria and constraints. Re-reading
   means opening the file now, not recalling it. Confirm each criterion with
   evidence (the command and its result), not "looks done".
2. **Deviations are written first.** If the work needs to differ from the
   spec, a ruling, or a constraint, append an entry to the deviations file
   BEFORE writing the deviating code, in this form, then proceed:

   ```markdown
   ## <ref>: <what deviates>
   - Constraint: <C-n or ruling or spec section>
   - Why the design does not work here: ...
   - What is done instead: ...
   ```

   If the justification is not worth writing, follow the spec.
3. **Two failures, then stop.** If the same check fails twice in a row, stop
   changing code. The problem is upstream of the code. Write a BLOCKED
   verdict with what you tried and what you observed. Do not try a third
   approach, and do not widen scope to route around the blocker.
4. **Questions go in the verdict.** Never ask the operator, and never message
   the lead. If the spec, a ruling or this brief is silent or contradicts
   itself and you cannot proceed, write a QUESTION verdict with the options
   you see and your recommendation, then stop. Decide small things yourself
   and record the decision in `summary`.
5. **Commits.** Conventional commits with a detailed body on your branch.
   No attribution, AI or session trailers. Do not merge.
6. **Surface, do not fix, what you notice outside scope.** List it in
   `summary`.

## Verdict file

The only completion signal is one JSON file. Your launch prompt gives its
path and schema; this is the contract:

- Write exactly one JSON object to that path, then stop. No other output is
  read.
- `status` is `DONE`, `BLOCKED` or `QUESTION`.
- `summary` states what changed (files), how each acceptance criterion was
  verified (commands and results), decisions you made, and what you noticed
  out of scope.
- `question` (QUESTION and BLOCKED only) states the problem, the options and
  your recommendation.
- `pr` and `head` are the pull request URL and head commit when you opened
  one; otherwise empty.
- A file that is missing, malformed or off-schema is an ERROR for the unit.
  Write it only when the work is truly finished or stuck.
