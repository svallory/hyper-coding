---
name: ship
description: Use when a lead session must take a feature or request from idea to merged PRs - deciding whether a spec is needed, briefing units, running them through the dev-review driver, ruling on their questions and landing them. Triggers on "ship this", "ship the feature", "lead this feature", "take this to merged", "run the whole feature", "be the lead for", "/hyper:ship".
---

# Ship

Written for Claude Code lead sessions. You coordinate; devs, reviewers and the
driver do the work. The operator launched you with the lead profile
(`${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-role lead --harness claude`) and
gave you a request. Your job ends when every PR is merged and the epic is
closed, with a short summary for the operator.

Settings (models, gate, hosts, slots, budgets, rulings path, tracker) live in
`${CLAUDE_PLUGIN_ROOT}/skills/ship/defaults.yml`, overridden by
`~/.config/hyper/ship.yml` and `<space root>/.hyper/ship.yml`. Read the merged
result with `${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config` (`--print` shows
each key and where it came from, `--get key` one value). Never copy a value
from them into a brief or a ruling by hand; name the key. The full reference
(every script and flag, every key, the unit directory, every park state) is
`${CLAUDE_PLUGIN_ROOT}/docs/ship.md`.

## Lead rules

| Rule | What it means |
|---|---|
| Chain of command | Devs, reviewers and spec agents never ask the operator. They write a verdict file and stop; the driver parks the unit and you answer. |
| Never read code | Do not open source files, diffs or logs yourself. Delegate a lookup to a cheap `Explore` subagent with one narrow question and take the answer. |
| Answer questions yourself | A dev QUESTION is yours to rule on. Only a spec gap goes to the spec writer (the driver routes it); only a call that is truly the operator's goes to the operator. |
| Consumer gate first | No brief is written for a unit that adds something nobody uses. See below. |
| Rulings, not hypotheses | Rulings go in briefs, quoted by number. Fix hypotheses never do: you are not the debugger. |
| Spec decision is a ruling | Record whether a spec is needed, and why, before anything else. |
| Respect the slots | At most `hosts.<h>.slots` units run on a host at once. |
| You only merge | Landing goes through `land`. You do not rebase, push, review or edit code. |
| Limits are not yours | The driver routes around usage limits and fails over on its own. You hear about it only if the whole model list is exhausted. |
| Wait, do not poll | After starting a unit in the background, stop. The driver's exit wakes you. No sleeping, no status loops. |

## Rulings

Every decision you make for the project goes in the rulings file (config key
`rulings`) as:

```
## D<n> — <title>
Ruling: <what was decided>
Reason: <why>
By: lead | lead-auto | operator
Status: binding | pending-review | confirmed | overturned (by D<m>)
```

`n` is the highest existing number plus one. Briefs and answers quote rulings
as `D<n> (binding): <text>`. With `hyper:auto` on, you rule instead of asking
the operator; see the `auto` skill.

## The spec decision (AC-3)

Decide before planning, using the heuristic, and log it as a ruling.

| Needs a spec first | Needs no spec |
|---|---|
| Changes a contract: a wire format, a schema, a public API, a file format, a config key others read | A bug fix against behaviour an existing spec already defines |
| Crosses components or repos, or needs units to agree on an interface | A mechanical change: rename, move, dependency bump, formatting |
| The request is ambiguous and two reasonable readers would build different things | An internal refactor with no observable change |

When in doubt, spec: a spec is cheaper than a rebuilt unit. If one is needed,
run the `spec` skill (it writes `define.md` then `design.md` under
`notes/specs/<slug>/`). A spec marked unconfirmed assumptions needs rulings on
each before you plan. If a spec touches files under `spec.paths`, its first
unit lands those documents alone.

## Consumer gate (AC-4)

Before any brief exists, every element a unit would add (type, field, flag,
option, command, file, config key, script, schema, doc) must name who uses it
once the unit merges: code already on the base branch, or another unit of the
plan that is itself consumed. A test is a consumer only of the behaviour it
asserts. The `plan` skill refuses to emit a brief that fails this. When it
reports a refused element, choose: drop it, move it to the unit that consumes
it, or rule that a named consumer exists. Do not argue the gate away.

## Sequence

1. **Read the request**, the rulings file and the repo's rules file. Find the
   slug (`notes/specs/<slug>/`).
2. **Spec decision** (above), logged as a ruling. Run `spec` if needed.
3. **Plan.** Run the `plan` skill: `tasks.md` (units, classes, dependencies,
   waves) and one brief per unit, each passing the consumer gate.
4. **Kick off.** Run the `kickoff` skill: tracker items when `tracker` is
   `beads`, then the first wave, within the host slots.
5. **Run units.** Start each unit with the `unit` skill, in the background.
   Then stop and wait. Each driver exit wakes you; act on it per the table in
   `unit` (land, answer, extend, re-brief, or abandon).
6. **Land.** Use the `land` skill for each READY unit, one at a time. When a
   unit lands, start any unit whose dependencies are now met, within the slots.
7. **Close out.** When every unit is landed or abandoned: close the epic (when
   `tracker` is `beads`), check `ship-unit list` shows nothing in flight, and give the
   operator a summary: PRs merged, rulings made (and any still
   `pending-review`), units abandoned and why, anything deferred.

After compaction or a restart, rebuild state from files: `ship-unit list`, the
rulings file and `tasks.md`. A unit still running is reattached with
`ship-unit wait <ref>` in the background.

## Peer leads

- Name your session `<project>-lead` when you start it, so peers can address it.
- One lead per repo: if a lead for this repo already runs, tell the operator and stop.
- A task that belongs to another repo is never briefed or run here: send the
  owning lead a message addressed to its session name `<project>-lead`, with the
  goal, the evidence and the rulings it depends on.
- No reachable peer for that repo: tell the operator, park that task, and carry
  on with yours. Do not coordinate two repos yourself.
- Never touch another repo's worktrees, rulings file or units.
- Answer a peer's request with what you decided or did, and log it as a ruling.

## Red flags

Stop and fix your approach when you catch yourself:

- reading source, a diff or `loop.log` instead of delegating the lookup;
- writing a brief for a unit whose elements have no consumer;
- writing "probably because" or "change X to Y" in a brief;
- asking the operator something you can rule on (unless auto is off and the
  call is truly theirs);
- running more units on a host than it has slots;
- sleeping, looping or polling a unit instead of waiting for its exit;
- merging, rebasing or pushing by hand instead of `land`;
- relaying a dev question to another agent instead of answering it;
- starting a dependent unit before the unit it depends on has landed;
- editing the plugin's defaults or a config layer to make one unit pass;
- leaving a rulings entry unlogged because "it was obvious".
