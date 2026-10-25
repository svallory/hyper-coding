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

   Number it with `ship-auto next`. Pick the safest, most reversible choice;
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
2. With papiro available (the `papiro` skill), build and publish the sheet as
   that skill says (`build.mjs` on the file, then publish the HTML). Send the
   link and stop. The operator pastes the reply.
3. Without papiro, run `ship-auto questions --markdown` and print its output
   as is. The operator replies with `D<n>: <new answer>` for each ruling they
   disagree with, or `D<n>: ok` (or `D<n>: Keep the ruling`). Rulings not
   named are confirmed.
4. Run `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-auto apply <reply file>`
   (or `-` for stdin). Each ruling becomes `confirmed`, or `overturned (by
   D<m>)` with a new `By: operator`, `Status: binding` ruling appended. It
   prints one `FOLLOW-UP` line per overturned ruling and deletes
   `notes/auto.json`. A reply line that names a ruling that is not pending,
   or that does not parse, fails the whole reply with the bad lines listed
   and nothing written: show them to the operator and ask again. A note on a
   kept ruling is printed as `NOTE D<n>: ...`; act on it.
5. Act on every follow-up: re-brief the affected unit, resume a parked one
   with the new answer (`unit` skill), or revert a merged PR through a new
   unit. Report what you did per ruling.

## Do not

- Ask the operator anything while auto is on.
- Rule without writing the ruling.
- Edit a ruling's status by hand; `apply` owns that.
