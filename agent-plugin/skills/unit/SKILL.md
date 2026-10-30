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

Exit codes 0, 1 and 2 are only ever the driver's result (READY, ERROR, parked / over budget / stuck); 3, 64, 70 and 75 are `ship-unit`'s own.
Read `notes/loops/<ref>/result.json` (small; read it yourself). When the
unit is parked its `.park` field holds the park (kind, stage, agent,
question, `resets_at`); the same data is in `park.json`. Then act:

| Exit | `result.json` status / park kind | Do |
|---|---|---|
| 0 | `READY` | `land` skill: land `<ref>`. |
| 2 | PARKED, QUESTION | Rule on it (write the ruling first), write the answer to a file, then `ship-unit resume <ref> --answer <file>` in the background. The answer quotes rulings by number. |
| 2 | PARKED, BLOCKED | Same as QUESTION. If the block is a defect in the brief, re-brief: fix the brief file, then resume with an answer saying so. If it cannot be unblocked, abandon. |
| 2 | PARKED, DIALOG | An agent is stuck on a dialog. Look (below). If it is a dialog ship does not answer itself, it needs the operator or a profile fix; ask them. If the question says ship did not recognise the workspace-trust dialog, answer it as described under "Taking a look". Then `ship-unit resume <ref>` with no `--answer` (it is refused for a DIALOG park). In auto mode do not abandon: leave the unit parked, record a `pending-review` ruling that says it is deferred to the operator, and carry on with other units. |
| 2 | PARKED, OPERATOR | The spec writer needs a call that is the operator's. Ask the operator, or under `auto` rule it with `By: lead-auto`; resume with the answer. |
| 2 | PARKED, LIMIT | Every model for a stage is used up. `resets_at` in `park.json` says when. `--answer` is refused for a LIMIT park. Either `resume <ref> --model <stage>=<list>` now with another list, or run `resume <ref>` in the background after `resets_at` (its exit wakes you; do not sleep or poll). Meanwhile work on other units, or tell the operator the unit is waiting. |
| 2 | PARKED, AUTH | A Claude login expired ("Please run /login"). Ask the operator to run `/login`, then `ship-unit resume <ref>` with no `--answer` (refused for AUTH). Units on that login park alike. |
| 2 | OVER-BUDGET | The agent is still running. Extend with `ship-unit resume <ref> --extend <minutes>`, or re-brief a smaller unit and abandon this one. |
| 2 | STUCK | Max rounds without ACCEPT, or finalize failures the dev could not fix. A bare `resume <ref>` and `--model` alone are refused (exit 3) on a unit that ran out of rounds: it would stop at once. Give it more rounds, `ship-unit resume <ref> --max-rounds N` (N above the limit in the refusal), and tell the dev what is new with `--answer <file>`: a note put in the next fix prompt (STUCK has no park, so `--answer` is accepted here). After a re-brief the note is the only way the change reaches the dev: its fix prompt does not tell it to read the brief again, so a file edit alone is not seen by the dev (the reviewers read the brief each round). Put what changed in the note: `ship-unit resume <ref> --max-rounds N --answer <file>`. A unit that stopped for another reason (finalize failures, a reviewer rejecting the same diff again) restarts with a full allowance of fix cycles: `resume <ref> --answer <file>` or `--model STAGE=M`; a bare `resume` is refused there too. Raising rounds does not help a reviewer that keeps rejecting for the same reason: re-brief smaller or clearer, or abandon. |
| 1 | ERROR | `driver.err` names the cause. Have a cheap `Explore` subagent read `loop.log` and report the cause in two sentences; fix the config or environment, then `resume <ref>`. A malformed verdict from an agent is an ERROR, not a question. |
| 3 | `ship-unit` refused (nothing ran) | The host is full, a driver is already running for the ref, there is nothing to answer or extend (no `park.json` for `--answer`, no over-budget stage for `--extend`), or `--answer` was given for a LIMIT, DIALOG or AUTH park, or a STUCK unit was resumed with nothing new (see STUCK). Read the message. Wait for a slot (an exit frees one), `ship-unit wait <ref>` for a running driver, or drop the stray flag. |
| 64 | `ship-unit` usage error | Fix the command line (a bad `--model`, `--extend 0`, a missing argument). Never mistake it for a parked unit. |
| 70 | `ship-unit`'s own failure | Sync failure, no ssh destination for the host, unknown unit, or a driver that died with no exit code or result. Read the message; fix the host config or the ref, then `resume <ref>`. |
| 75 | The host was lost while the driver is still running | Run `ship-unit wait <ref>` in the background to reattach. Do not re-run the unit. |

Rules for acting:

- Answering is a decision: log it as a ruling first when it binds future work.
- Answers contain rulings and facts, never fix hypotheses.
- `resume` blocks like `run`; start it in the background too and stop.
- `ship-unit wait <ref>` reattaches to a driver that is still running (after
  compaction or a restart); also in the background.
- `ship-unit list` shows ref, host, status, stage, failovers, age, pid alive.

Always pass `run` `--spec-dir <dir>` (the feature's spec directory): the unit's
base is the `base:` in its `tasks.md`. Use `--base` only to override. With
`--host` the directory is copied over too.

`resume` flags: `--answer <file>`, `--extend <minutes>`, `--max-rounds <n>`,
`--model <stage>=<m>[,<m>...]` (stages: dev verify review spec_check
spec_write final).

## Taking a look

When you need to see an agent's screen (a DIALOG park, an agent that looks
silent), read it through the multiplexer seam. Never call a multiplexer
directly.

```
${CLAUDE_PLUGIN_ROOT}/scripts/ship/ship-mux read --ref <ref> --to <agent from park.json> [--lines 40]
```

`--to` takes the agent name from `park.json` (or an id from `ship-mux list`).
`ship-mux list --ref <ref>` shows the unit's panes and agents. This is a look,
not a control: do not send keys or close anything from here. Teardown is
`land`'s job.

The one exception: a DIALOG park on Claude Code's workspace-trust dialog, which
ship could not answer itself. Read the pane first. Only if it shows "Quick
safety check…" with exactly the options "No, exit" and "Yes, I trust this
folder", send `ship-mux send --ref <ref> --to <agent> --keys down`, read the
pane again, and send `--keys enter` only when `❯` is on "Yes, I trust this
folder". Then `ship-unit resume <ref>` with no answer. Those two keys, for that
dialog, are all this allows. Any other dialog (a permission prompt, "Do you want
to proceed?", anything else) belongs to the operator: send no keys, ask them.
Never call the multiplexer directly.

## Do not

- Start a unit without its brief, or one whose dependencies have not landed.
- Read the code or diff the unit produced to decide for the dev.
- Run the driver script by hand or without the background flag.
