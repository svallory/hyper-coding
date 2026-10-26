# hyper:ship reference

Everything `hyper:ship` ships, in one place: the scripts under `scripts/ship/`,
every configuration key, the files a unit leaves under `notes/loops/<ref>/`,
every state a unit can stop in and how to continue it, the contract a
multiplexer backend implements, and what to check when something is wrong.

For the vocabulary (unit, brief, driver, ruling, parked) see
[concepts.md](concepts.md#ship). For the lead's playbook see
`skills/ship/SKILL.md`. Each script also prints its own full usage with
`--help`; this page is the same information arranged for lookup, plus the
parts that span scripts.

Contents: [Quick start](#quick-start), [Overview](#overview), [Scripts](#scripts),
[Configuration](#configuration), [The unit directory](#the-unit-directory),
[Stopped units](#stopped-units), [Usage limits and failover](#usage-limits-and-failover),
[Multiplexer backends](#multiplexer-backends), [Troubleshooting](#troubleshooting).

## Quick start

A unit runs in a space: a bare repo with `worktrees/` and a `.hyper/` directory.
A plain clone is not a space.

1. **Get a space.** For a new project, `/hyper:init <remote-url> [name]` (the
   plugin's init command) clones the remote into a bare repo and adds
   `worktrees/<default branch>`. For a repo you already have, `/hyper:adopt`
   converts the checkout in place. Then work from the space root.
2. **Load the plugin and call the scripts.** The scripts live in
   `scripts/ship/` inside the plugin and are not on your PATH.
   `${CLAUDE_PLUGIN_ROOT}` is set for Claude Code (skills and commands), not in
   your own shell. For local use, start Claude Code with the plugin loaded from
   its directory, and put the scripts on the PATH of the shell you run ship from:

   ```
   claude --plugin-dir /path/to/agent-plugin
   export PATH="/path/to/agent-plugin/scripts/ship:$PATH"
   ```

   The lead is a Claude session (the `ship` skill describes its role); the
   scripts can also be run by hand from any shell.
3. Install the prerequisites listed under [Overview](#overview) (`jq`, mikefarah
   `yq` v4, `git`, `gh`, `wt`, the `hyper` CLI, `claude` or `pi`, and Herdr).
   [What ship asks of `gh`](#what-ship-asks-of-gh) lists the exact calls.
4. Create `<space root>/.hyper/ship.yml` with the one required key, the command
   that must pass before push and merge: `gate: "bun test"` (any command; exit 0
   passes). Check it with `ship-config --print`.
5. Run inside Herdr (`HERDR_ENV=1`) from the space root. To exercise the flow
   without a multiplexer, set `mux: fake` (see
   [Multiplexer backends](#multiplexer-backends)); no real agent runs then.
6. Write the brief, a markdown file such as `notes/briefs/my-unit.md`: the goal,
   the files to read, the acceptance criteria and the gate. It must tell the dev to
   push the branch and open a PR against the base with `gh pr create`, because
   a `DONE` verdict without a PR number ends the unit as `ERROR`.
7. Pick a ref: letters, digits, `.`, `_`, `-`, starting with a letter or digit
   (`^[A-Za-z0-9][A-Za-z0-9._-]*$`). It names the unit, its branch and its state
   directory.
8. `ship-unit run my-unit --brief notes/briefs/my-unit.md --class S`. It blocks
   until the driver exits (run it in the background if you have other work), then
   prints `result.json` and exits 0 for READY, 2 for stopped, 1 for ERROR. Read
   `notes/loops/my-unit/result.json`; if it is not READY, see
   [Stopped units](#stopped-units).
9. `ship-land my-unit` merges the PR, deletes its remote branch, runs `on_land`
   and removes the agents, panes and worktree.

The rulings file (`rulings` in the config, default `notes/decisions.md`) is
optional. You can write your own rulings into it before a run; agents read it and
add to it. If it does not exist when a unit starts, ship creates it with a
`# Rulings` heading.

### What agents run with

- **Permissions are off.** Every Claude agent ship starts runs with
  `--permission-mode bypassPermissions`: it can run any command and edit any file
  the user running ship can, without asking. The only guards are the worktree it
  starts in, the role settings ship passes, and the review and gate steps. Run ship
  only on repos and machines where that is acceptable, with credentials you are
  willing to expose to an agent, and read what a unit did before you land it.
- **Workspace trust.** Claude Code asks whether to trust every folder it has not
  seen, and each unit worktree is a new folder. ship creates the worktree from
  your own repo, so the driver accepts that one dialog for you: it finds the
  cursor (the `❯` line), moves it with `down` (at most twice) onto "Yes, I trust
  this folder", which is not where it starts, presses Enter, and logs one line to
  `loop.log`. It does this once per agent start and answers no other dialog. If
  the cursor never reaches Yes, or the dialog is still showing after Enter, the
  unit parks as `DIALOG`.
- **PATH.** Agents get the `PATH` of the shell that ran `ship-unit`, passed
  explicitly to the pane (`env PATH=...`, or an export in the pane's shell). Nothing else from your
  environment is passed on, and no secrets; tokens such as `GH_TOKEN` must reach
  the agent the way they would reach any new terminal in the multiplexer.

### What ship asks of `gh`

| Call | Who | Used for |
|---|---|---|
| `gh pr create --base <base> --head <branch>` | the dev agent, in its pane | open the PR (the brief tells it to) |
| `gh pr view <branch> --json number -q .number` | `ship-land` | find the PR number when `result.json` has none |
| `gh pr view <n> --json state -q .state` | `ship-land` | skip a PR that is already `MERGED`; confirm a merge |
| `gh pr merge <n> --<merge_method> --delete-branch` | `ship-land` | merge, and delete the remote branch |

A stub `gh` that implements these four is enough for a test run.

## Overview

A lead session turns a request into briefed units. For each unit
`ship-unit run` starts the driver `ship-loop` inside a multiplexer space (on
this machine or on a host over ssh) and blocks until it exits. The driver runs
dev, verify, review, an optional spec check, fix rounds, an optional final gate
and finalize, writing one verdict file per stage. Its exit code and
`result.json` are the only signal the lead gets. `ship-land` merges a READY unit
and tears it down.

```
ship-unit run  ──►  ship-loop  ──►  ship-mux  ──►  mux/<backend>
 (blocks)           (driver)        (the seam)     (herdr, fake)
                       │
                       ├─ ship-role   launch arguments per agent role
                       ├─ ship-config merged settings
                       └─ ship-quota-tap  records rate limits (status line)
ship-land ──► ship-retire ──► ship-mux      (merge, then tear down)
ship-auto                                    (rulings review; no unit needed)
```

`lib.sh` and `lib-host.sh` in that directory are shared code the scripts source; they are not commands.

Requirements on the machine that runs a script: `bash`, `jq`, mikefarah `yq`
v4 (a different `yq` is refused), `git` 2.39 or newer, `gh`, `wt` (worktrunk;
`ship-unit run` creates the worktree with it), the `hyper` CLI (not needed when
`SHIP_SPACE_ROOT` is set), `claude` and/or `pi` for the models you configure
(including `failover.summarizer`), and the multiplexer backend named by `mux`
(Herdr needs `HERDR_ENV=1` and `herdr` on PATH). Host mode (`--host`) also needs
`ssh` and `rsync` here, and the same tools on the host.

`ship-loop --preflight` checks `jq`, `git`, `gh`, `hyper` (unless
`SHIP_SPACE_ROOT` is set), `yq` v4, that the config loads and has a `gate`,
`ship-mux check`, and that `claude` or `pi` is on PATH for every model in every
stage list and in `failover.summarizer`. It does not check `wt`, `ssh` or
`rsync`; `ship-unit run` stops with exit 70 when `wt` is missing.

Shared environment:

| Variable | Meaning |
|---|---|
| `SHIP_SPACE_ROOT` | the space root; otherwise found from the working directory with the hyper CLI. |
| `SHIP_CONFIG_JSON` / `SHIP_CONFIG_FILE` | a merged config (JSON text, or a file holding it) used instead of reading the layers. Host units use this to run under the lead's config. |
| `SHIP_MUX_TEST=1` | makes the `herdr` backend exit 99 on every verb, so a test can never reach a real server. |
| `SHIP_MUX_FAKE_LOG`, `SHIP_MUX_FAKE_DIR` | where the `fake` backend logs calls and reads scripted answers. |
| `SHIP_QUOTA_DIR` | where rate-limit snapshots and `limited.json` live (default `~/.cache/hyper/quota`). |

## Scripts

All scripts are in `scripts/ship/` of the plugin (`${CLAUDE_PLUGIN_ROOT}/scripts/ship/` inside Claude Code; see the [Quick start](#quick-start) for putting them on your PATH). Exit code 0 is
success everywhere; the others are listed per script. `-h` and `--help` print
usage and exit 0.

### ship-unit

Start, resume, wait for and list units. Start it as a background command: its
exit is the notification.

```
ship-unit run <ref> --brief FILE --class S|M|L [--host H] [--branch B] [--base B]
                    [--max-rounds N] [--final-gate] [--model STAGE=M[,M...]]...
                    [--spec-dir DIR]
ship-unit resume <ref> [--answer FILE] [--extend MIN] [--model STAGE=M[,M...]]...
ship-unit wait <ref>
ship-unit list
```

| Flag | Meaning |
|---|---|
| `--brief FILE` | the unit's brief (required for `run`). |
| `--class S\|M\|L` | the unit's size; picks the develop time budget (`budgets.S/M/L`). Required. |
| `--host H` | run on host `H` from `hosts.H` instead of `local`. The space must exist on the host at the same absolute path. |
| `--branch B` | branch to create; default is the ref. |
| `--base B` | base branch; default config `base`. |
| `--max-rounds N` | review/fix rounds before STUCK; default config `max_rounds`. |
| `--final-gate` | run the final gate stage for this unit (otherwise only when `stages.final.always`). |
| `--model STAGE=M[,M...]` | replace one stage's model list for this unit (repeatable). Written to `models.override`. |
| `--spec-dir DIR` | a spec directory the agents read; copied to the host in host mode. |
| `--answer FILE` | (`resume`) the lead's answer to the current park; becomes `answer-<n>.md`. Refused for LIMIT and DIALOG parks. |
| `--extend MIN` | (`resume`) minutes to add to the stage that went OVER-BUDGET; above 0. |

`run` creates the worktree (`wt switch -c` from `origin/<base>`), checks the
host has a free slot, opens the unit's space, starts the driver there, and
blocks. It prints `result.json` and exits with the driver's code. In host mode
the scripts, `hyper-require-lib.sh` and `defaults.yml` are copied to
`~/.cache/hyper/ship/<plugin version>/` on the host, the brief, rulings file and
spec dir are copied to the same paths, and the lead's merged config travels in
the ssh command (so a host unit runs under the lead's config whatever the
host's own files say). The loop directory is mirrored back at the start and the
end. After an ssh failure it reconnects with a growing delay and keeps polling;
the driver keeps running meanwhile.

`list` prints one line per unit under `notes/loops/` (not `.done`): ref, host,
status, stage, failovers, age, driver alive. A unit with a live driver is
`RUNNING`; without one the status is `result.json`'s, or `DEAD` when it left
none.

Slots: a unit counts against `hosts.<h>.slots` while its driver is alive (or
within `SHIP_UNIT_START_GRACE_S` of launch). The check, worktree creation and
launch run under one lock per host, so concurrent runs cannot overbook.

Exit codes: 0 READY, 1 ERROR, 2 parked / over budget / stuck (these three are
only ever the driver's result); 3 refused (host full, driver already running,
nothing to answer or extend, answer for a LIMIT or DIALOG park); 64 usage;
70 ship-unit itself failed (copy or sync failure, no ssh destination, unknown
unit, a driver that died leaving no exit code or result); 75 the connection to
the host was lost while the driver still runs (`ship-unit wait <ref>`
reattaches).

Environment knobs: `SHIP_UNIT_POLL_S` (default 5), `SHIP_UNIT_BACKOFF_MAX_S`
(30), `SHIP_UNIT_RECONNECT_SEC` (900), `SHIP_UNIT_START_GRACE_S` (60),
`SHIP_UNIT_LOCK_WAIT_S` (300), `SHIP_LOOP_BIN` (the driver to run).

```
ship-unit run my-unit --brief notes/briefs/my-unit.md --class M --host buildbox &
ship-unit resume my-unit --answer /tmp/answer.md
ship-unit resume my-unit --extend 20
ship-unit resume my-unit --model dev=sonnet,provider/model-b
ship-unit list
```

### ship-loop

The driver. Normally started by `ship-unit`; run it directly only to test.

```
ship-loop --ref REF --worktree ABS --branch B --brief ABS --class S|M|L
          [--base B] [--max-rounds N] [--final-gate] [--model STAGE=M[,M...]]...
ship-loop --preflight [--ref REF]
ship-loop --clear-limit NAME
```

| Flag | Meaning |
|---|---|
| `--ref`, `--worktree`, `--branch`, `--brief`, `--class` | the unit; all required for a run. Paths are absolute. |
| `--base`, `--max-rounds`, `--final-gate`, `--model` | as for `ship-unit run`. Stages: `dev verify review spec_check spec_write final`. |
| `--preflight` | check git, gh, yq v4, jq, the config (including a usable `gate`), `ship-mux check`, and that `claude` / `pi` exist for the configured models; then exit. |
| `--clear-limit NAME` | remove the account or model `NAME` from `limited.json`, so preflight stops skipping it; then exit. Prints whether it was marked. |

Stages, in order: develop, verify (skipped unless `stages.verify.instructions`
is set), review, spec check (only when the diff touches `spec.paths`), fix
rounds, optional final gate, finalize (rebase on `origin/<base>`, run `gate`,
forbidden-pattern scan, `git push --force-with-lease`). The driver pushes only a
diff that an ACCEPT review (or final gate) has seen. A fix round that leaves the
diff unchanged counts as a failed round.

Restart is resume: run it again with the same `--ref` and it reattaches to live
agents and replays finished stages from their files. A finished stage (valid
verdict newer than its `.sent` marker) is never re-run.

Budgets: develop gets `budgets.<class>` minutes, fix rounds
`budgets.fix_fraction` of that, every other agent stage `budgets.check`. The
clock is wall time since the stage's prompt was sent, minus time spent parked.

Exit codes and `result.json` status:

| Exit | `status` | Meaning |
|---|---|---|
| 0 | `READY` | finalize passed; land it. |
| 2 | `PARKED` | `park.json` says why. See [Stopped units](#stopped-units). |
| 2 | `OVER-BUDGET` | `budget-r<k>.json`; the agent is left running. |
| 2 | `STUCK` | `max_rounds` without ACCEPT, or finalize failures the dev could not fix. |
| 1 | `ERROR` | tool or script failure, malformed verdict, bad usage. `driver.err` has the message. |

Test knobs: `SHIP_POLL_S` (default 2), `SHIP_IDLE_GRACE_S` (1200; how long an
idle agent without a verdict is left alone before a nudge), `SHIP_HOST` (recorded
in `result.json`), `SHIP_LIMIT_LINES` (25), `SHIP_FAILOVER_STOP_MS` (15000),
`SHIP_SUMMARY_TIMEOUT_S` (300).

### ship-land

Merge a READY unit, run `on_land`, tear it down.

```
ship-land <ref> [--force] [--task ID] [--host H]
ship-land <ref> --abandon [--force] [--host H]
```

| Flag | Meaning |
|---|---|
| `--force` | land although `result.json` is not READY. With `--abandon`: also delete the branch (`wt remove -D`) even if unmerged. |
| `--task ID` | value for `{task}` in `on_land` commands; default the ref. |
| `--abandon` | only the teardown: no rebase, gate, push or merge. |
| `--host H` | the unit lives on host `H`: copy the scripts, run the same command there over ssh, mirror `notes/loops/` back. |

Steps: (1) take `<space root>/.hyper/ship-land.lock` (one land at a time per
space); (2) require READY; (3) a PR already MERGED skips to step 6, otherwise
fetch and rebase on `origin/<base>`, refusing an empty branch or a rebase that
drops commits (the branch is restored); (4) run `gate`, then
`git push --force-with-lease` leased on the remote branch as seen before the
fetch; (5) `gh pr merge --<merge_method> --delete-branch` (the PR's remote branch goes with it) and pull the base; (6) run each
`on_land` command with `{ref}`, `{pr}`, `{task}` replaced; (7) teardown:
`ship-retire` every recorded agent, close every recorded pane and the unit
space, close a ship-created units group when empty, verify `ship-mux list` is
empty, `wt remove <branch>`, move `notes/loops/<ref>/` to `notes/loops/.done/<ref>/`.

Config used: `gate` (needed to land, not to abandon), `base`, `merge_method`,
`on_land`, `mux`, `units_group`. A rerun after a failed teardown is safe.

Exit codes: 0 landed or abandoned; 1 error (gate failed, rebase conflict, merge
failed, teardown left something behind, an `on_land` command failed, lost
connection to the host); 2 usage; 3 refused (not READY, empty branch, rebase
dropped commits, uncommitted changes).

Knobs: `SHIP_LAND_SETTLE_SEC` (seconds between push and merge, default 5),
`SHIP_LAND_LOCK_WAIT_SEC` (1800).

```
ship-land my-unit
ship-land my-unit --abandon
ship-land my-unit --force --abandon     # also drops an unmerged branch
```

### ship-mux

The multiplexer seam. Scripts call it with intents; it dispatches to
`scripts/ship/mux/<mux>`. Its header comment is the authoritative interface
document (`ship-mux --help`); this is the summary.

```
ship-mux check
ship-mux open   --ref R --cwd D [--label L]
ship-mux run    --ref R --pane P -- CMD...
ship-mux start  --ref R --space S --name N --harness claude|pi --cwd D -- ARGS...
ship-mux send   --ref R --to A (--text T [--wait-ms N] | --keys K[,K...])
ship-mux read   --ref R --to A|P [--lines N]
ship-mux status --ref R --to A
ship-mux wait   --ref R --to A --until working|idle|gone|ready --timeout-ms N
ship-mux close  --ref R --id X
ship-mux list   --ref R
```

Ids are opaque strings; never parse them. Keys are `enter esc up down ctrl+c ctrl+d`.
Every verb except `check` is scoped to a ref and may only touch ids recorded
for that ref; anything else exits 3 with no backend call.

| Verb | Output |
|---|---|
| `open` | `{"space":id,"pane":id,"group":id}`; idempotent per ref. |
| `start` | `{"agent":id,"pane":id}` |
| `read` | plain text of the visible screen, or the last N lines. |
| `status` | `{"state":"working\|idle\|blocked\|gone","pane":id,"space":id}`; `gone` means the agent exited but the backend still has it. |
| `list` | `[{"id","kind":"space\|pane\|agent","name","backend_name","state"}]`, only ids recorded for the ref and still alive. |

Exit codes: 0 ok; 1 error; 2 usage; 3 refused (id not recorded for the ref,
start into an unrecorded space, closing a root pane on its own, closing a group
ship did not create or that is not empty); 4 timeout (`wait`, or `send --wait-ms`
when the agent never starts working); 5 target gone (on a recorded id the backend
no longer has; `close` maps it to 0); 99 the test guard.

The ownership record is `notes/loops/<ref>/mux.json`; the units group is
recorded in `<space root>/.hyper/ship-mux.json` and closes only when ship
created it and no unit still has a space in it. `close` removes entries it
closed; an id the backend no longer has counts as closed.

### ship-config

```
ship-config [--print]
ship-config --get <key>
```

`--print` (the default) shows every key, its value and the file it came from.
`--get` prints one value by dotted key (`models.dev`, `spec.paths`, `gate`).

Exit codes: 0 ok (an empty string value prints an empty line); 1 config error
(`yq` missing or not mikefarah v4, malformed YAML, space root unknown, `gate`
unset; `--print` still prints everything first, with `gate = <unset:
required>`); 2 usage; 3 `--get` on a key that is unset.

```
ship-config --get models.review
ship-config --print | grep -n budgets
```

### ship-role

Prints the launch arguments for one agent role. The driver uses it for every
agent; the operator uses it to start a lead.

```
ship-role <role> --harness claude|pi [--host-settings <file>] [--cwd <dir>]
```

Roles: `lead`, `dev`, `verify`, `review`, `spec`. Settings come from
`roles.<role>`.

For `claude` it writes a settings file under
`~/.cache/hyper/roles/<project>-<hash>/<role>.json` built from the host's
`enabledPlugins` (and the project's `.claude/settings.json` layers), with every
plugin switched off except those the host has on and `plugins_keep` names, and
prints `--settings <file> --strict-mcp-config`, plus
`--disallowedTools=AskUserQuestion` for every role except `lead`. The profile's
`statusLine` is `ship-quota-tap`, wrapping the host's own status line command.
For `pi` it prints `-ne -ns -np --no-mcp`, `--skill` per `pi_skills`, `-e` per
`pi_extensions`, and `--exclude-tools ask_user`; a skill or extension that
cannot be found is an error. The lead has no pi form. Output is one line of
space-separated arguments.

Exit codes: 0 ok; 1 error (config, missing skill or extension, unreadable
settings, a path with whitespace or glob characters); 2 usage.

```
claude $(ship-role lead --harness claude) "ship the notifications feature"
```

### ship-quota-tap

A Claude Code status-line command; `ship-role` installs it, you do not run it.

```
ship-quota-tap [--original <shell command>]
```

It reads the
status-line JSON on stdin. When that has a `rate_limits` object, it writes
`<quota dir>/claude-<account>.json` as `{"account","at","rate_limits"}`; without
`rate_limits` it writes nothing. It then pipes the same input to the `--original`
command and prints that command's output and exit status unchanged; with no
`--original` it prints nothing. A failure to write never changes the output. The
account name is `CLAUDE_CONFIG_DIR` with characters outside `[A-Za-z0-9._-]`
turned into `_`, or `default`. `--help` prints this usage. Exit code: 0, or the
original command's.

### ship-auto

The mechanics of `hyper:auto`. Works in any session, with or without ship.

```
ship-auto on [--rulings FILE]
ship-auto next [--rulings FILE]
ship-auto questions [--markdown] [--out FILE] [--rulings FILE]
ship-auto apply REPLY|- [--rulings FILE]
```

`on` writes `notes/auto.json` (`{since, first_ruling}`; an existing file is
kept). `next` prints the next ruling number. `questions` builds the papiro
questions JSON (or a markdown list with `--markdown`) for rulings with `By:
lead-auto`, `Status: pending-review` and a number at or above `first_ruling`:
one question per ruling, id `D<n>`, options `keep`, `alt-N` per `Alternatives:`
entry (separated by ` | `), or `overturn` when there are none. `apply` reads a
papiro reply (or `-` for stdin, or the markdown fallback): kept rulings become
`confirmed`; overturned ones become `overturned (by D<m>)` with a new
`## D<m>` (`By: operator`, `Status: binding`) appended and a
`FOLLOW-UP D<n> -> D<m>: ...` line printed. A reply naming a ruling that is not
pending, naming one twice, or that does not parse fails whole: nothing is
written. A good reply deletes `notes/auto.json`. `--rulings` defaults to config
`rulings`.

Exit codes: 0 ok; 1 error (including a bad reply); 3 nothing pending; 64 usage.

### ship-retire

Stop one agent the way its harness expects, wait until the multiplexer no longer
has it, then close it (which also closes its pane).

```
ship-retire --ref R [--harness claude|pi|codex] [--timeout S] <agent-id>
```

`--harness` chooses how to stop it: claude types `/exit` (ctrl+d if that fails),
pi sends ctrl+d (never a prompt), codex ctrl+c twice, unset ctrl+d twice.
`--timeout` is seconds to wait (default 60); at a third of it an agent that
ignores the stop gets esc, ctrl+c and the stop again, once. An agent already
gone is only closed. Exit codes: 0 retired or already gone; 1 error; 2 usage; 3
refused by `ship-mux` (id not recorded for the ref); 4 the agent did not stop in
time (its pane is left open). Knob: `SHIP_RETIRE_POLL` (default 1 second).

## Configuration

Settings are YAML in three layers, later wins:

1. `skills/ship/defaults.yml` in the plugin (every key commented)
2. `~/.config/hyper/ship.yml` (user)
3. `<space root>/.hyper/ship.yml` (project; lives in the space, never the repo)

Objects merge key by key; arrays replace. The merge happens once per run, with
`yq -o=json` into `jq`. `ship-config --print` shows each key and the file that
supplied it. Only `gate` is required.

Minimal project file:

```yaml
gate: "bun run typecheck && bun test"
models:
  dev: [sonnet, provider/model-b]
hosts:
  buildbox: {ssh: me@buildbox, slots: 4}
```

| Key | Meaning |
|---|---|
| `gate` | Required, no default. Command run in the unit worktree before push and before merge; exit 0 passes. |
| `mux` | Backend file under `scripts/ship/mux/`. Default `herdr`. |
| `units_group` | Name of the multiplexer group holding unit spaces. `<project>` becomes the space directory name. Default `<project>-units`. |
| `base` | Branch units are rebased onto and merged into. Default `main`. |
| `merge_method` | `rebase`, `squash` or `merge`. Default `rebase`. |
| `spec.paths` | Globs of spec or contract documents. A diff touching one triggers the spec check stage. Default `[]`. |
| `scan.forbidden` | Regexes (jq/Oniguruma, matched with `test()`) that must not appear in added lines; finalize fails on a match. Default `[]`. |
| `scan.exclude` | Globs excluded from the scan. Default `[]`. |
| `stages.final.always` | Run the final gate on every unit instead of only with `--final-gate`. Default `false`. |
| `stages.verify.instructions` | Optional. Path to a markdown file with the verify prompt; unset means the verify stage is skipped. |
| `stages.review.instructions` | Optional. Path to a markdown file appended to the review prompt. |
| `max_rounds` | Review/fix rounds before STUCK. Default 3. |
| `models.dev` | Develop and fix rounds. Default `[sonnet]`. |
| `models.verify` | Runtime verification. Default `[haiku]`. |
| `models.review` | Review rounds. Default `[opus]`. |
| `models.spec_check` | Spec check. Default `[opus]`. |
| `models.spec_write` | Spec writer for GAP and spec-text REMOVE verdicts. Default `[fable, opus]`. |
| `models.final` | Final gate. Default `[opus]`. |
| `quota.threshold_pct` | Preflight skips a Claude entry when a rate-limit window is at or above this percentage. Default 95. |
| `quota.max_age_min` | Quota snapshots older than this many minutes are ignored. Default 30. |
| `limits.patterns.claude` | Regex matched against the newest lines of a Claude agent's screen to detect a usage limit. Anchored (see [below](#usage-limits-and-failover)). |
| `limits.patterns.pi` | The same for pi agents; only error phrasing counts (for example `error: status code 429`). |
| `limits.cooldown_min` | Minutes an account or model is treated as limited when no reset time is known. Default 60. |
| `failover.summarizer` | Models tried in order to summarise an interrupted stage into `STATUS.md`. Default `[haiku]`. |
| `budgets.S`, `budgets.M`, `budgets.L` | Develop time budget in minutes per class. Defaults 15, 45, 90. |
| `budgets.fix_fraction` | Fraction of the class budget a fix round gets. Default 0.5. |
| `budgets.check` | Minutes for a check stage (verify, review, spec check, final). Default 30. The gate is not a stage. |
| `hosts.local.slots`, `hosts.<name>.slots` | Concurrent units on that host. `hosts.local.slots` defaults to 2. |
| `hosts.<name>.ssh` | ssh destination for a remote host (not needed for `local`). |
| `rulings` | Rulings file, relative to the space root. Default `notes/decisions.md`. |
| `tracker` | `beads` or `none`; `kickoff` writes tracker items for `beads`. Default `none`. |
| `on_land` | Commands run after a successful merge; `{ref}`, `{pr}`, `{task}` are replaced. Default `[]`. |
| `roles.lead.plugins_keep` | Claude plugins left enabled for the lead. Default `[hyper, beads, papiro]`. |
| `roles.dev.plugins_keep`, `roles.verify.plugins_keep`, `roles.review.plugins_keep`, `roles.spec.plugins_keep` | Claude plugins left enabled for that role (projects add language servers here). Default `[]`. |
| `roles.dev.pi_skills`, `roles.verify.pi_skills`, `roles.review.pi_skills`, `roles.spec.pi_skills` | Skills a pi agent of that role is launched with. |
| `roles.dev.pi_extensions`, `roles.verify.pi_extensions`, `roles.review.pi_extensions`, `roles.spec.pi_extensions` | Extensions a pi agent is launched with: a list of `{name, flags}`. |

A model entry is a bare name (`sonnet`, `opus`, `haiku`, `fable`) for Claude
Code, or `provider/model[:thinking]` for pi. A stage's list is walked in order.
`--model stage=a,b` on `ship-unit` replaces one stage's list for that unit.

## The unit directory

Everything about a unit is in `<space root>/notes/loops/<ref>/`. When a unit is
landed or abandoned, the directory moves to `notes/loops/.done/<ref>/`. Files
that exist only in some runs are marked.

| File | Written by | Meaning |
|---|---|---|
| `loop.log` | driver | timestamped log; the first place to look. |
| `driver.pid` | driver | pid of the running driver. |
| `driver.err` | driver | the last ERROR message. |
| `driver.exit` | `ship-unit` | the driver's exit code; removed on each start. |
| `unit.json` | `ship-unit` | what the unit was started with (host, branch, worktree, brief, class, base, max rounds, final gate, models), so `resume` and `wait` need no arguments. |
| `config.json` | `ship-unit` | host units only: the lead's merged config. |
| `mux.json` | `ship-mux` | ownership record of the panes, agents and spaces ship created. |
| `result.json` | driver | the outcome (below); also printed on stdout. |
| `park.json` | driver | present while the unit is parked. |
| `park-<n>.json` | driver | a resolved park. |
| `<verdict>.<STATUS>-<n>.json` | driver | the agent verdict that caused park `n`, kept beside it. |
| `budget-r<k>.json` | driver | a stage ran over budget. |
| `failover-<N>.json` | driver | one per failover (preflight skip or reactive). |
| `STATUS.md` | driver | the handover note for the successor of an interrupted agent. |
| `summary/` | driver | files the summariser reads (`diff.txt`, `git.txt`); `summarize.prompt.md` is its prompt. |
| `agents/<name>.json` | driver | role, model, models key, harness and session of each agent. |
| `<stage>.prompt.md` | driver | the prompt each agent was given. |
| `<verdict>.takeover.md` | driver | the prompt a replacement agent got after a failover. |
| `answer-<n>.md` | `ship-unit resume` | the lead's answer to park `n`. |
| `extend` | `ship-unit resume` | minutes to add to the OVER-BUDGET stage. |
| `models.override` | `ship-unit` | lines `stage=model[,model...]` applied on every start; later lines win. |

Verdict files (written by the agents, validated against `scripts/ship/schemas/`):

| File | Stage | `verdict` / `status` values |
|---|---|---|
| `develop.json` | dev | `DONE` (with `pr`, `head`, `summary`), `BLOCKED`, `QUESTION` |
| `fix-r<N>.json` | fix round N | same as develop |
| `verify-r<N>.json` | verify | `PASS`, `FAIL`, `BLOCKED`, `SKIP` (the driver writes `SKIP` itself when verify is off) |
| `review-r<N>.json` | review | `ACCEPT`, `CHANGES` (with `findings[]`) |
| `spec-r<N>.json` | spec check | `ACCEPT`, `CHANGES`, `GAP`, `REMOVE` (with `gaps[]`, `removals[]`) |
| `specwriter-r<N>.json` | spec writer | `WRITTEN`, `OPERATOR` (with `operator_questions[]`) |
| `final-r<N>.json` | final gate, one per round | `ACCEPT`, `CHANGES` |
| `finalize.json` | finalize | written by the driver |

Each verdict `X.json` has companions: `X.json.sent` (one line appended per
prompt; a verdict newer than its marker answers the last prompt, so a finished
stage is never re-run), `X.json.clock` (accumulated stage time, so a resume does
not reset the budget) and `X.json.answer` (the lead's answer last delivered to
that agent). Review verdicts also leave `review-r<N>.sig` (the signature of the
diff that review saw; the driver pushes only a diff whose signature matches an
ACCEPT) and fix rounds leave `fix-r<N>.findings`, `fix-r<N>.src` and
`fix-r<N>.before`, which record what the dev was asked so a resumed park
continues that fix instead of replaying it.

`result.json`:

| Field | Meaning |
|---|---|
| `ref`, `pr`, `stage`, `status` | the unit, its PR number, the stage reached, and `READY`, `PARKED`, `OVER-BUDGET`, `STUCK` or `ERROR`. |
| `rounds` | one entry per review round: `{round, verdict, findings}`. |
| `spec`, `final`, `specwriter` | verdict and rounds of the spec check and final gate; spec writer runs and commits. |
| `finalize` | the finalize outcome. |
| `failovers` | the number of `failover-N.json` files. |
| `host`, `worktree` | where it ran. |
| plus `park`, `budget`, `findings` or `why` | the record for a PARKED, OVER-BUDGET, STUCK or ERROR result. |

`failover-<N>.json` fields: `stage`, `round`, `agent`, `from`, `to`, `reason`
(`preflight` or `limit`), `limit_kind` (`account` or `model`), `matched` (the
screen line, for `limit`), `quota` (the rate-limit reading, when known),
`summarizer` (the model that wrote `STATUS.md`, or null for the git-facts
fallback), `status_md`, `at`.

User-wide state (not in the unit directory): `~/.cache/hyper/quota/claude-<account>.json`
(the latest rate-limit snapshot), `~/.cache/hyper/quota/limited.json` (accounts
and models known to be limited: `{"accounts":{A:{"until":T}},"models":{M:{"until":T}}}`),
`<space root>/.hyper/ship-mux.json` (units groups), `<space root>/.hyper/ship-land.lock`
and `ship-unit.lock`, and `<space root>/notes/auto.json` (an `auto on` stretch).

## Stopped units

The driver exits 2 for every stop that needs the lead. `result.json` and
`park.json` say which. Continue with `ship-unit resume <ref> ...`; without what
the stop needs, the driver re-emits the same result and exits 2 again.

| State | Caused by | `park.json` / file | Resume with |
|---|---|---|---|
| `QUESTION` | the dev (or a fix round) wrote `QUESTION` in its verdict | `park.json` status `QUESTION`; the verdict is kept as `<verdict>.QUESTION-<n>.json` | `--answer FILE`. The answer goes to the waiting dev. |
| `BLOCKED` | the dev, or verify, wrote `BLOCKED`; or an agent could not be started, kept alive or prompted for a reason other than a dialog (`loop.log` says why) | `park.json` status `BLOCKED` | `--answer FILE` to nudge the agent; resuming without an answer closes it and retries the stage with a fresh agent. |
| `OPERATOR` | the spec writer needs a decision only the operator can make (all gaps marked `operator_call`, or `operator_questions`) | `park.json` status `OPERATOR` | `--answer FILE`; a fresh spec writer gets the answer in its prompt. |
| `DIALOG` | an agent is blocked on a dialog in its pane: the workspace-trust dialog ship could not clear (the cursor would not move onto "Yes, I trust this folder", or it is still showing after Enter), or any other dialog (ship answers none) | `park.json` status `DIALOG`, with the screen text | answer the dialog in the pane (`ship-mux read` shows it), then `resume` with no answer. `--answer` is refused. |
| `LIMIT` | every model for the stage is limited or over `quota.threshold_pct`, or the limited one has no successor | `park.json` status `LIMIT`, `resets_at` when known | wait for the reset, or `--model stage=...` to name a usable list, or `ship-loop --clear-limit NAME` if the quota is back; then `resume`. `--answer` is refused. |
| `OVER-BUDGET` | a stage ran past its budget | `budget-r<k>.json`; agent left running | `--extend MIN`. |
| `STUCK` | `max_rounds` reached without ACCEPT, or finalize failed and the dev could not fix it | `result.json.findings` | Raise the limit and run it again: `ship-unit run <ref> --brief ... --class ... --max-rounds <higher>`. Finished rounds are replayed from their files and the driver goes on with the next round (`resume` reuses the old limit and would stop at STUCK again). Or abandon it: `ship-land <ref> --abandon --force`, then start a fresh `ship-unit run`. Read `result.json.findings` first; if the reviewer keeps asking for the same thing, rule on it or re-brief rather than raising the limit. |
| `ERROR` | tool or script failure, or a malformed verdict (CHANGES with no findings; DONE with no PR; WRITTEN with nothing resolved; finalize found nothing ahead of `origin/<base>`) | `driver.err`, `result.json.why` | fix the cause, then `resume`; or abandon. |

`resume` also refuses (exit 3) an `--answer` when there is no `park.json`, and
an `--extend` when no OVER-BUDGET stage is waiting; nothing is written.

A unit you do not want to continue: `ship-land <ref> --abandon`.

## Usage limits and failover

Two mechanisms keep a unit running when a model's allowance runs out. Both walk
the stage's ordered model list (`models.<stage>`).

**Preflight routing.** Before a stage starts on a Claude model, the driver reads
the latest rate-limit snapshot for the account (written by `ship-quota-tap`) and
`limited.json`. It skips a Claude entry when the account or model is in
`limited.json` with `until` in the future, or when the snapshot is younger than
`quota.max_age_min` and the `five_hour` or `seven_day` `used_percentage` is at
or above `quota.threshold_pct` and that window's `resets_at` is still in the
future. No snapshot, a stale one, or a window that already reset means no skip.
pi entries are never skipped by preflight, because pi has no quota source. Each
skip writes a `failover-<N>.json` with reason `preflight`. If every entry is
skipped, the unit parks LIMIT.

**Reactive failover.** While an agent works, the driver looks at the newest
`SHIP_LIMIT_LINES` (25) lines of its screen, not the scrollback, for its
harness's `limits.patterns` regex. The patterns are anchored to the start of a
line (after terminal glyphs, never after `+`, `-`, `>` or a quote), so diffs and
quotations of the message do not match; the Claude pattern must be the whole
message, optionally followed by `· resets ...`. The pi pattern only accepts
error phrasing: `Error: ... 429`, `error: status code 429`, "too many requests",
`RESOURCE_EXHAUSTED`, a provider `rate_limit_error`, or a sentence such as "rate
limit reached" or "quota exceeded". A bare "rate limit" or "429" in code or a
file listing does not match. On a match the driver records the limit in `limited.json` (until
the snapshot's reset time, else `limits.cooldown_min` from now), stops the agent
cleanly, has the first usable `failover.summarizer` model read the transcript
and the worktree's diff and git state and write `STATUS.md` (Done, In progress,
Next steps, Open questions), and restarts the same stage under the same agent
name on the next usable model. The successor's first prompt is, in order: the
takeover text (which points at `STATUS.md` and the brief), then the stage prompt,
then the lead's answer if one was pending for the old agent. If no summariser is usable, `STATUS.md` is built from
git facts and begins "transcript not summarised". Before it is handed on,
`STATUS.md` is scrubbed: any line that quotes a limit message is replaced by
`[line removed: it quoted a provider message]`, so the successor's own screen
cannot trip the detector. Each failover writes `failover-<N>.json`, bumps
`failovers` in `result.json` and the stage's verdict, and logs a `FAILOVER`
line. An exhausted list parks LIMIT.

The other-model rule: a message that names another model ("You've hit your Opus
limit") is recorded against that model in `limited.json`, but an agent running a
different model is not stopped and not failed over; only later entries naming
the limited model are skipped.

Marking a quota as back: `ship-loop --clear-limit NAME` removes the account or
model `NAME` (the account name as the tap writes it, or the model as written in
the list) from `limited.json`.

## Multiplexer backends

A backend is one bash file in `scripts/ship/mux/`, named by the `mux` config
key, called as `<file> <verb> <flags>` with the flags of the [`ship-mux`
verbs](#ship-mux). It keeps no ref mapping of its own: the dispatcher records
ownership and passes recorded ids in.

Differences from the `ship-mux` surface:

- `open` also gets `--group NAME` (the units group) and prints
  `{"space","pane","group":{"id","created":bool,"name"}}`; the dispatcher records
  the group and prints the plain id.
- `list` gets `--ids JSON` (a JSON array of the recorded ids) and prints
  `[{"id","kind","name","state"}]` for those that are alive; a group id is
  reported with kind `group` and its name.
- Exit codes: 0 ok, 1 error, 4 timeout, 5 not found. `ship-mux` turns a backend 2
  or 3 into 1, passes 4, 5 and 99, and turns a 5 from `close` into 0.
- Closing a group that still has children must exit 1.
- Ids must be stable for the life of the thing they name.
- A real backend should exit 99 on every verb under `SHIP_MUX_TEST=1`.
- Only the backend may call the multiplexer's CLI; a test asserts no other file
  under the plugin does.

To add a backend: write `scripts/ship/mux/<name>`, add
`tests/test-t-ship-mux-<name>.sh` that sources `tests/lib/mux-contract.sh`
against it, and set `mux: <name>`. `mux/fake` is the reference
implementation: it logs each call as a JSON line to `$SHIP_MUX_FAKE_LOG` and
answers `read`, `status` and `wait` from files in `$SHIP_MUX_FAKE_DIR`.

`mux/herdr` is the real backend: it requires `HERDR_ENV=1` and `herdr` on PATH
(`ship-mux check` says which is missing), maps agent names to Herdr's
32-character limit, and waits for a shell prompt for `wait --until ready`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ship-unit`, `ship-loop`, `ship-land` or `ship-config` exits 1 with a message naming `gate` | `gate` is unset (`ship-land --abandon`, `ship-mux`, `ship-role` and `ship-auto` do not need it). Set it in `<space root>/.hyper/ship.yml`. `ship-config --print` shows what is merged. |
| "yq" error | `yq` is missing or is not mikefarah v4 (`yq --version`). Install mikefarah yq. |
| `ship-unit` exits 70 with "wt (worktrunk) not found on PATH" | Install worktrunk (`wt`). |
| `ship-mux check` fails | Herdr: run inside Herdr (`HERDR_ENV=1`) with `herdr` on PATH. |
| A unit parked `DIALOG` and the question names the workspace-trust dialog | Claude Code asked to trust the worktree and ship's one attempt (down, then Enter) did not clear it, or the cursor would not move onto Yes. `ship-mux read --ref <ref> --to <agent id>` shows the screen. Answer it in the pane, then `ship-unit resume <ref>` with no answer. |
| A unit parked `BLOCKED` with "could not prompt" | ship-mux could not deliver the prompt and the agent was not at a dialog. Read `loop.log` (the line before `PARKED` has the exit code), and the agent's pane. `resume` with no answer retries with a fresh agent. |
| The dev ran the wrong tool, or cannot find one that works for you | The agent's `PATH` is the one of the shell that ran `ship-unit`. Run `ship-unit` from a shell whose `PATH` has what the agent needs (a stub `gh`, a pinned toolchain). Other variables are not passed. |
| `ship-unit run` exits 70 with "wt switch -c ... failed" and `branch 'x' has no upstream information` | Your global git config has `branch.autosetupmerge` set to an empty value, which breaks `wt switch -c`. Fix it with `git config --global --unset branch.autosetupmerge`, or set it to `true`. ship removes the branch and worktree that run created, so a rerun starts clean. |
| A script exits 99 | `SHIP_MUX_TEST=1` is set (tests set it). Unset it for a real run. |
| `ship-unit run` exits 3 | The host has no free slot (`ship-unit list`; raise `hosts.<h>.slots` or wait), or a driver is already running for that ref (`ship-unit wait <ref>`). |
| `ship-unit` exits 75 | The connection to the host dropped. The driver still runs there; `ship-unit wait <ref>` reattaches. |
| `ship-unit` exits 70 | Its own failure: read stderr. Often ssh or a missing `unit.json`. A `DEAD` row in `list` is a driver that died without a result; read `loop.log` and `driver.err`, then `resume`. |
| A unit parked LIMIT but you have quota | A stale `limited.json` entry. `ship-loop --clear-limit <account or model>`, then `resume`. |
| Preflight keeps skipping Claude | The snapshot says a window is over `quota.threshold_pct`. Check `~/.cache/hyper/quota/claude-<account>.json` and `ship-config --get quota.threshold_pct`. |
| A dev sat idle for a long time | After `SHIP_IDLE_GRACE_S` the driver nudges it; read the agent's screen with `ship-mux read --ref <ref> --to <agent id>` (ids are in `agents/` and `mux.json`). |
| `ship-land` exits 3 | Not READY (use `ship-unit resume` or `--force`), an empty branch, a rebase that dropped commits, or uncommitted changes in the worktree. |
| `ship-land` exits 1 after the merge | Teardown or an `on_land` command failed. Fix and rerun: a merged PR skips straight to `on_land` and teardown. |
| `ship-land` waits | Another land holds `<space root>/.hyper/ship-land.lock`; it gives up after `SHIP_LAND_LOCK_WAIT_SEC`. A lock whose holder died is taken over. |
| Panes left after a crash | `ship-land <ref> --abandon` closes everything recorded for the ref. `ship-mux` closes only ids it recorded; it exits 3 for anything else. |
| A host unit used the wrong settings | It should not: the lead's merged config travels with the command. Check `notes/loops/<ref>/config.json` on the host. |
| An answer file seems ignored | `--answer` is applied by park number (`answer-<n>.md`). `park.json`'s `n` must match; stale files for old parks are not re-sent. |

When in doubt, read `notes/loops/<ref>/loop.log`, then `result.json` and
`park.json`. Do not edit verdict files by hand; give the driver what it asks for
through `resume`.
