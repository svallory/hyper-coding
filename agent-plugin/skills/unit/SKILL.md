---
name: unit
description: Use when one briefed unit must be run through the dev-review driver, or a unit that parked, ran over budget or failed must be continued. Triggers on "run unit", "run the unit", "start the unit", "unit is parked", "unit over budget", "resume the unit", "answer the unit", "/hyper:unit".
---

# Unit

Written for Claude Code sessions. A unit is one brief run by the driver:
develop, verify, review, spec check, fix rounds, finalize. The driver writes
verdict files under `notes/loops/<ref>/` and **its process exit is the only
signal**. No agent messages you.

Prerequisite: the brief at `notes/briefs/<ref>.md` (from the `plan` skill).
Configuration comes from the ship config; read it with
`${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-config`. Do not restate its values.

## Run

```
${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-unit run <ref> --brief notes/briefs/<ref>.md --class S|M|L [--host <name>] [--branch <b>]
```

Always start it with **`run_in_background: true`** on the Bash call, then
stop. Do not sleep, poll or re-check. When the process exits, you are woken
with its exit code. Check that the host has a free slot first
(`hosts.<name>.slots` in the config; `ship-unit list` shows what is running).

`ship-unit run` creates the worktree, opens the unit's space, runs the
driver, blocks until it exits and returns the driver's exit code.

## On exit

Read `notes/loops/<ref>/result.json` (small; read it yourself). If it names
`park.json`, read that too. Then act:

| Exit | `result.json` status / park kind | Do |
|---|---|---|
| 0 | `READY` | `land` skill: land `<ref>`. |
| 2 | PARKED, QUESTION | Rule on it (write the ruling first), write the answer to a file, then `ship-unit resume <ref> --answer <file>` in the background. The answer quotes rulings by number. |
| 2 | PARKED, BLOCKED | Same as QUESTION. If the block is a defect in the brief, re-brief: fix the brief file, then resume with an answer saying so. If it cannot be unblocked, abandon. |
| 2 | PARKED, DIALOG | An agent is stuck on a permission dialog. Look (below). It usually needs the operator or a profile fix; ask them (or in auto mode, record a ruling and abandon), then `ship-unit resume <ref>`. |
| 2 | PARKED, OPERATOR | The spec writer needs a call that is the operator's. Ask the operator, or under `auto` rule it with `By: lead-auto`; resume with the answer. |
| 2 | PARKED, LIMIT | Every model for a stage is used up. `resets_at` in `park.json` says when. Either wait and `resume <ref>`, or `resume <ref> --model <stage>=<list>` with another list. |
| 2 | OVER-BUDGET | The agent is still running. Extend with `ship-unit resume <ref> --extend <minutes>`, or re-brief a smaller unit and abandon this one. |
| 2 | STUCK | Max rounds without ACCEPT. Re-brief (smaller or clearer), change the model for the stage with `resume --model`, or abandon. |
| 1 | ERROR | `driver.err` names the cause. Have a cheap `Explore` subagent read `loop.log` and report the cause in two sentences; fix the config or environment, then `resume <ref>`. A malformed verdict from an agent is an ERROR, not a question. |

Rules for acting:

- Answering is a decision: log it as a ruling first when it binds future work.
- Answers contain rulings and facts, never fix hypotheses.
- `resume` blocks like `run`; start it in the background too and stop.
- `ship-unit wait <ref>` reattaches to a driver that is still running (after
  compaction or a restart); also in the background.
- `ship-unit list` shows ref, host, status, stage, failovers, age and whether
  the pid is alive.

`resume` flags: `--answer <file>`, `--extend <minutes>`,
`--model <stage>=<m>[,<m>...]` (stages: dev verify review spec_check
spec_write final).

## Taking a look

When you need to see an agent's screen (a DIALOG park, an agent that looks
silent), read it through the multiplexer seam. Never call a multiplexer
directly.

```
${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-mux read --ref <ref> --to <agent from park.json> [--lines 40]
```

`ship-mux list --ref <ref>` shows the unit's panes and agents. This is a look,
not a control: do not send keys or close anything from here. Teardown is
`land`'s job.

## Do not

- Start a unit without its brief, or one whose dependencies have not landed.
- Read the code or diff the unit produced to decide for the dev.
- Run the driver script by hand or without the background flag.
