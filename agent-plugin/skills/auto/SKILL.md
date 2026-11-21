---
name: auto
description: Use when the lead should stop asking the operator and rule on its own while the operator is away, or when the operator is back and wants to review what was ruled. Triggers on "auto on", "auto off", "hyper:auto", "/hyper:auto", "rule without asking me", "show me what you decided while I was away".
---

# Auto

Written for Claude Code sessions. Works in any session that makes decisions,
with or without `ship`. `auto on` turns questions into logged rulings;
`auto off` hands the operator a review sheet and applies their reply. The
mechanics are in `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-auto`; the rulings
file is the path in the ship config key `rulings`, read
with `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config --get rulings`.

## auto on

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-auto on`. It writes
   `notes/auto.json` with `since` and `first_ruling` (the next free number).
2. For the rest of the session, never call AskUserQuestion and never stop to
   wait for the operator. Each question you would have asked becomes a ruling
   appended to the rulings file:

```
## D<n> — <title>
Ruling: <the choice you made>
Reason: <why this one>
Alternatives: <rejected option> | <rejected option>
By: lead-auto
Status: pending-review
```

   Number it with `ship-auto next`. Only a ruling about what ships is
   written: scope, behaviour, an interface, a convention for later work, a
   deferred item. A choice that only steers how a unit runs and leaves no
   trace in what ships (another round, a bigger budget, a model or effort
   change, a restart, a retry) is not a ruling: make it and carry on. The
   file is the record the operator reads later; operational noise buries the
   rulings that matter. Pick the safest, most reversible choice;
   when two are equal, the one that keeps scope smaller. A ruling that would
   delete data, spend money, publish, or touch another repo is not yours:
   record a **deferred item** and carry on with other work. A deferred item
   is a ruling with `By: lead-auto`, `Status: pending-review` and
   `Ruling: deferred to the operator: <what>`, so `auto off` puts it on the
   sheet. Leave the affected unit parked; do not act on it.
3. Tell the operator once, in one line, that auto is on and where rulings go.

## auto off

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-auto questions --out <file>`.
   It collects the `lead-auto` rulings still `pending-review` since
   `first_ruling` and writes a papiro questions file: one question per ruling,
   options "Keep the ruling" (the default), one per rejected alternative, or
   "Overturn" when there are none. Exit 3 means nothing is pending: say so and
   delete `notes/auto.json`. `ship-auto on` keeps an existing `notes/auto.json`,
   so turning it on twice does not move `first_ruling`.
2. Triage. The sheet is for the rulings that still need the operator; the
   rulings file is the full record and they can read it any time. Keep a
   ruling on the sheet when it is a deferred item still open, or a choice
   about what ships that is still in force and still the operator's to
   change: a convention for work to come, an open PR, a setting. Leave it off
   when it records what happened (a finding, a step that ran), transcribes an
   operator instruction, was replaced by a later ruling, or only steered how a
   unit ran. In doubt, keep it on. Rebuild the file without the rest:
   `ship-auto questions --drop "D12 D15" --out <file>`. Rulings left off stay
   pending and `apply` confirms them like any ruling the reply does not name.
   Exit 4 means every ruling was left off: run `ship-auto apply -` with
   `Auto rulings review: all <number pending> as suggested.`, tell the
   operator in one line, and skip to step 6. Keep the sheet's `title`
   (`apply` refuses a reply under another title); you may rewrite `intro` to
   say how many are on it and where the file is, and the `summary` of a kept
   ruling a dropped one amended.
3. With papiro available (the `papiro` skill), build and publish the sheet as
   that skill says (`build.mjs` on the file, then publish the HTML). Send the
   link, one line saying how many rulings were left off and the rulings file
   path, and stop. The operator pastes the reply.
4. Without papiro, run `ship-auto questions --markdown` with the same
   `--drop` and print its output as is, followed by the same one line. The
   operator replies with `D<n>: <new answer>` for each ruling they disagree
   with, or `D<n>: ok` (or `D<n>: Keep the ruling`). Rulings not named are
   confirmed. In either reply, a `D<n>: <what to do instead>` line overturns
   a ruling left off the sheet.
5. Run `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-auto apply <reply file>`
   (or `-` for stdin). Each ruling becomes `confirmed`, or `overturned (by
   D<m>)` with a new `By: operator`, `Status: binding` ruling appended. It
   prints one `FOLLOW-UP` line per overturned ruling and deletes
   `notes/auto.json`. A reply line that names a ruling that is not pending,
   or that does not parse, fails the whole reply (so does a reply that is neither the
   papiro reply nor a list of `D<n>:` lines; "all N as suggested" is accepted) with the bad lines listed
   and nothing written: show them to the operator and ask again. A note on a
   kept ruling is printed as `NOTE D<n>: ...`; act on it.
6. Act on every follow-up: re-brief the affected unit, resume a parked one
   with the new answer (`unit` skill), or revert a merged PR through a new
   unit. Report what you did per ruling.

## Do not

- Ask the operator anything while auto is on.
- Rule on what ships without writing the ruling: the file is how the
  operator finds out later.
- Edit a ruling's status by hand; `apply` owns that.
- Put a ruling on the sheet that no longer needs the operator: every extra
  question costs their attention and hides the ones that matter.
