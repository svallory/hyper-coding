Read this when `ORCA_WORKSPACE_ID` is set and `HERDR_ENV` is not (Orca mode): before creating the Run or launching your first dev.

## Orca mode

Applies only when `test -z "${HERDR_ENV:-}" && test -n "${ORCA_WORKSPACE_ID:-}"` passes (Herdr wins when both are set). Every dev becomes an Orca **worker**: a terminal running the harness, adopted into an orchestration **Run** so Orca tracks its liveness, carries its brief and its completion mail, and lets you place it on any machine Orca reaches. Researchers and reviewers that only return text still use the Agent tool, locally. **REQUIRED SUB-SKILL:** `orca skills get orca-cli` and `orca skills get orchestration` (references `worker-contract`, `placement-and-remote`, `recovery-and-cleanup`, `messaging-and-gates`) are the command reference; confirm flags with `--help` before first use. Verified against Orca 1.4.223 (macOS app) driving an `orca-ide serve` 1.4.222 remote, 2026-10-10.

Orchestration verbs live under `orca orchestration <verb>` (`run-create`, `worker-start`, `worker-list`, `worker-show`, `worker-read`, `worker-stop`, `worker-release`, `worker-abandon`, `send`, `check`, `task-create`); a bare `orca worker-start` is "Unknown command". The CLI is `$ORCA_CLI_COMMAND`, else `orca-dev`, else `orca-ide` (Linux), else `orca` (macOS: `/Applications/Orca.app/Contents/Resources/bin/orca`).

### Coordinator handle and Run

You are the coordinator. Your identity is the handle Orca binds to the Run, which is **not always `$ORCA_TERMINAL_HANDLE`**: a floating or global Orca terminal (`ORCA_WORKSPACE_ID=global-floating-terminal`) has no stable pane identity, and `run-create --from "$ORCA_TERMINAL_HANDLE"` fails there with "The coordinator terminal has no stable pane identity". Create the Run without `--from` from inside your own Orca terminal and read the bound handle back; that handle is `$COORD` for the whole session and goes as `--from` to `worker-start`, `send`, `ask`, `reply`. **Never pass another pane's handle as `--from`**: Orca binds the Run to the sender, and the real coordinator is then fenced out (`consumer_fenced`). `worker-show`, `worker-list`, `worker-stop`, `worker-release` and `check` reject `--from`; `check` takes `--terminal "$COORD" --run "$RUN"` instead.

One Run per batch, created once and written into the status table header. The flag is `--objective` (`--title` is "Unknown flag"):

```bash
RUN=$(orca orchestration run-create --objective "${PROJECT} $(date +%F)" --json | jq -r .result.run.id)
COORD=$(orca orchestration run-current --json | jq -r .result.run.coordinator_handle)
```

If you are not inside an Orca terminal at all, create one (`orca terminal create --worktree path:"$SPACE_ROOT" --title "${PROJECT}-team-lead" --json`, handle at `.result.terminal.handle`) and run the two commands above through it with `terminal send`; `--worktree` must be a path registered in `orca project setups`, anything else is `selector_not_found`.

A lead that resumes after compaction finds its devs again with `orca orchestration worker-list --run "$RUN" --include-remote --json`.

### Machine inventory and budgets

Machines are the local one plus every environment in `orca environment list --json` (`.result.environments[] | {id, name}`; the list has no status field, so a machine that fails its probe is simply excluded). Right before each dispatch, probe the candidate machines' live load (no capacity config file; other people's jobs count, which is why you measure instead of assuming). The status script does the same probe for every machine in the status table, so `team-status.sh --orca --run "$RUN" --json` (`.machines[]`) is the easiest way to get all of them at once; by hand:

```bash
# local
ncpu=$(sysctl -n hw.ncpu 2>/dev/null || nproc); load1=$(uptime | sed -n 's/.*load average[s]*: *\([0-9.]*\).*/\1/p')
# remote: a throwaway terminal that prints ncpu, load averages and available MB between two markers.
# --worktree MUST be a path registered on that environment (orca project setups --environment "$ENV" --json,
# .result.setups[].path); any other path is selector_not_found. Every later call on the handle MUST repeat
# --environment, or the local runtime answers terminal_handle_stale.
REMOTE_REPO=$(orca project setups --environment "$ENV" --json | jq -r '.result.setups[0].path')
probe=$(orca terminal create --environment "$ENV" --worktree path:"$REMOTE_REPO" --title probe \
  --command "echo PROBE-BEGIN; nproc; uptime; free -m | awk '/Mem:/{print \$7}'; echo PROBE-END" --json | jq -r .result.terminal.handle)
# the shell stays open after the command, so `terminal wait --for exit` times out; poll for the end marker
until orca terminal read --environment "$ENV" --terminal "$probe" --json | jq -r '.result.terminal.tail[]' | grep -q PROBE-END; do sleep 1; done
orca terminal read --environment "$ENV" --terminal "$probe" --json | jq -r '.result.terminal.tail[]'
orca terminal close --environment "$ENV" --terminal "$probe"
```

Budget per machine, derived from the probe: `max_devs = ncpu / 2` (at least 1), `max_heavy = 2` (same cap as *Machine load* in SKILL.md). A machine whose `load1 > ncpu` or with under 2 GB available takes no new dev until a later probe clears it. Count against a machine only the devs you placed there (status table `machine` column). Record the observed load next to the budget calibration data; `ncpu / 2` is a starting point, not a law.

Placement: the least loaded candidate (`load1 / ncpu`) with a free slot **and the repo registered there**; ties go to local, where the operator can watch. The lead itself, merges, reviews, verifiers and anything that uses the operator's `gh` login stay local; remote machines run devs only.

Each candidate machine is checked once per session for `git`, `wt`, `jq`, `flock` and the harness CLI through the same probe pattern (`--command "command -v git wt jq flock pi claude"`); a machine missing a tool is reported to the user and excluded, never silently used with a workaround.

### Repo registration on a remote machine

`orca project setups --environment "$ENV" --json` must list the project before you dispatch there. If it does not: ask (through the chain of command) whether to clone, then

```bash
orca project setup-clone --project "$PROJECT_ID" --host "runtime:$ENV" --path "$REMOTE_PATH" --json
# or, when the operator names a folder that already holds the repo:
orca project setup-existing-folder --project "$PROJECT_ID" --host "runtime:$ENV" --path "$REMOTE_PATH" --json
```

Until the setup is registered the machine is excluded from placement. Worktrees on the remote are created with `wt` through a probe-style terminal in the registered path (same `wt switch --create … --no-cd -y` as step 4), and the resulting path is the dev's `--worktree path:<abs>`. Check the repo's worktree visibility on that machine too (see *Worktree workspaces*).

### Worktree workspaces

As in Herdr mode, every dev runs in its own worktree workspace, and `wt` creates the worktree (workflow step 4); do not use `orca worktree create`, which picks its own path and branch. Orca calls a worktree it did not create a *non-Orca worktree* and hides it when the repo's `externalWorktreeVisibility` is `hide`. A hidden worktree is not an Orca workspace: `--worktree path:<it>` fails with `selector_not_found`, and it never shows in the sidebar. Check once per repo and machine before the first dev:

```bash
ENV_FLAG=(); [ "$MACHINE" != local ] && ENV_FLAG=(--environment "$ENV" )   # drop --environment for the local machine
orca repo show "${ENV_FLAG[@]}" --repo path:"$SPACE_ROOT" --json | jq -r .result.repo.externalWorktreeVisibility
```

`show` is ready. On `hide`, or on `inherit` when `orca worktree show --worktree path:"$WORKTREE"` returns `selector_not_found`, ask the operator (through the chain of command) to let you run `orca repo set --repo path:"$SPACE_ROOT" --external-worktree-visibility show`. It is a per-repo Orca setting, and you never change it without asking. If they decline, Orca mode cannot place devs in that repo; use Herdr or plain mode and say so. Verified with Orca 1.4.229.

### Launch and adopt

Session naming is the same as Herdr's: `${PROJECT}-${REF}` is the terminal title and the dev's `--name`. Per dev, on the chosen machine:

```bash
# 0a. label the worktree workspace in Orca's sidebar and board
orca worktree set "${ENV_FLAG[@]}" --worktree path:"$WORKTREE" --display-name "$REF" --workspace-status in-progress --json

# 0. env: block resolved to KEY=VALUE pairs that prefix the launch command
#    (remote: only values valid on that machine; see Dev environment)
LAUNCH="PI_CODING_AGENT_DIR=... pi --name ${PROJECT}-${REF} --model $MODEL --exclude-tools ask_user"
#    claude: claude --name ... --model $MODEL --disallowedTools AskUserQuestion

# 1. terminal running the harness in that worktree workspace (ENV_FLAG as above)
#    remote: $WORKTREE must live under a path registered with `orca project setups --environment "$ENV"`
H=$(orca terminal create "${ENV_FLAG[@]}" --worktree path:"$WORKTREE" --title "${PROJECT}-${REF}" \
      --command "$LAUNCH" --json | jq -r .result.terminal.handle)
orca terminal wait "${ENV_FLAG[@]}" --terminal "$H" --for tui-idle --timeout-ms 120000 --json
#    satisfied:false with blockedReason "agent-trust-workspace" = Claude Code's folder-trust prompt on a path
#    this machine has not seen; answer it (Down, Enter) and wait again:
#    orca terminal send "${ENV_FLAG[@]}" --terminal "$H" --text $'\x1b[B'; orca terminal send "${ENV_FLAG[@]}" --terminal "$H" --enter

# 2. adopt it as a worker; the brief IS the spec, delivered by Orca on input_accepted
ON_FLAG=(); [ "$MACHINE" != local ] && ON_FLAG=(--on "$ENV")
orca orchestration worker-start --spec "$(cat "$BRIEF_FILE")" --task-title "${REF}: ${TITLE}" \
  "${ON_FLAG[@]}" --worktree path:"$WORKTREE" --terminal "$H" --run "$RUN" --from "$COORD" \
  --timeout-ms 90000 --json
# exit 0 only when the worker is ready; record .result.dispatch.id (ctx_…) and
# .result.task.id in the status table together with $H and the machine
```

Rules learned the hard way: `--model`/`--effort` cannot be combined with `--terminal`, so the model goes in the launch command. The launch command also carries the **account**: a remote machine's default harness profile is whatever was logged in there (it may be a different, exhausted subscription), so prefix the env block (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`) or use the machine's alias for the right profile, exactly as [Dev environment](harness-setup.md) says; a dev that answers "You've hit your weekly limit" never reaches the task and `check --wait` burns its whole timeout. `worker-start --spec` works on a terminal whose TUI is already idle; the brief arrives as `=== TASK ===` input, so the dev needs no separate paste. `--worktree current`/`new-child` are invalid for a remote machine; always pass the exact path. A `worker-start` that fails at stage `worktree_resolve` with "not running a recognized agent" means the TUI was not up yet: `terminal wait --for tui-idle` again and retry once. Headless remotes return `surface: background` plus a warning that the terminal could not be made discoverable; harmless. Every `terminal wait|read|send|close` on a remote handle needs `--environment "$ENV"`, otherwise `terminal_handle_stale`. `worker-list` carries no task title; to map workers back to refs join `.workers[].taskId` with `orca orchestration task-list --run "$RUN" --json` (`.result.tasks[] | {id, task_title}`), which is what the status script does. `worker-list --limit` tops out at 100. `worker-start --agent <id>` (ids: claude, codex, cursor, antigravity, muse, zcode, opencode, opencode2) is the fallback only when adoption keeps failing for a harness in that list; pi is not in it, so pi devs always use adoption. Do not use `--agent` for a harness Orca does not know; report it as unusable in Orca mode instead.

### Completion and follow-ups

Two signals per dev, both required so a failure of one does not strand the task:

1. **Worker contract.** The brief's completion step (template item 12) is this exact command, with ids filled in by you, run by the dev as its last action after writing the report file:
   ```bash
   orca orchestration send --from "$ORCA_TERMINAL_HANDLE" --type worker_done \
     --subject "STATUS: DONE|BLOCKED|NEEDS-USER — <ref>" --body "<2–3 line summary>" \
     --task-id <task-id> --dispatch-id <dispatch-id> --outcome succeeded|failed --report-path <report file>
   ```
   `--task-id` and `--dispatch-id` are mandatory: without them Orca rejects the message ("Federated worker report is incomplete", `invalid_payload`) and you receive a `worker_done` whose subject starts with `Rejected worker_done:` — treat that as *not done* and tell the dev to resend with the ids. Orca's injected preamble already shows the dev the correct `--from`, task and dispatch ids; the brief says to copy them from there rather than hardcoding. Questions use the same command with `--type question` and FIRST LINE `QUESTION — <ref>` in the body; the dev then waits on `orca orchestration check --terminal "$ORCA_TERMINAL_HANDLE" --wait`.
2. **Report file** with the `STATUS:` first line, read by the status script.

You receive mail with `orca orchestration check --terminal "$COORD" --run "$RUN" --json`, which returns the oldest unacknowledged batch (`.result.deliveryId`, `.result.messages[]`); acknowledge it on the next call with `--ack <deliveryId>` (`--ack` without a value is an error, and `--unread` does not acknowledge). `--wait --types worker_done,question --timeout-ms <ms>` blocks until something arrives (keepalive JSON on stderr every 15 s) and is the Orca-mode replacement for the stall watchdog: run it in a background shell and act on what it returns. Follow-ups to a dev: `orca orchestration send --from "$COORD" --to dispatch:<id> --type status --subject "<ref>: follow-up" --body "…"` (valid `--type` values are `status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat`; `instruction` is rejected); Orca delivers to the dev's terminal only when it is idle, so a reply to a question never lands in a busy input box. Read a dev's screen with `orca orchestration worker-read --dispatch <id>`.

### Stop, release, recover

- `worker-list --run "$RUN" --include-remote --json` gives per worker `projection.liveness.verdict` (`live|exited|unverifiable`), `projection.stage.activity`, `projection.outcome`, `projection.nextAction.kind` and `projection.attention.requiresAction`. **`unverifiable` authorizes inspection only** (`worker-read`, then `terminal read --screen`, with `--environment` for a remote), never a stop or a retry. A failed dispatch whose terminal is already gone also reads `unverifiable`, so check `dispatchStatus` before deciding it is a live dev you cannot see.
- Retire: `worker-stop --dispatch <id>` if still live, then `worker-release --dispatch <id>` so Orca reclaims the terminal (the flag is `--dispatch`; `--dispatch-id` is "Unknown flag" on both). `worker-stop` ends the terminal, so never `worker-start` onto that handle again: the new dispatch reports `ready` and then dies with the terminal (`status: exited`, `source: screen-unavailable` on `terminal read`), then the *teardown checklist* in SKILL.md (remote worktrees are removed through a probe-style terminal). `worker-abandon` only for a worker whose terminal is gone and that will not be retried.
- Retry a failed dispatch with a fresh terminal and `--retry-of <old dispatch id>` so the Run keeps the lineage.
