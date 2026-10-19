Read this when `HERDR_ENV=1` (Herdr mode): before launching or briefing your first dev, and when you arm the stall watchdog.

## Herdr mode

Applies only when `test "${HERDR_ENV:-}" = 1` passes. Inside Herdr every dev (Haiku included) gets its own tab so the user can watch and take over; Researchers and reviewers that only return text still use the Agent tool.

Variables: `WORKSPACE` is your pane's current workspace. Look it up right before each `tab create` with `herdr pane current --current | jq -r .result.pane.workspace_id`. Never use `$HERDR_WORKSPACE_ID` for this: Herdr sets it when the pane starts and never updates it, so after your pane is moved to another workspace it still names the old one (verified with herdr 0.9.1). `SPACE_ROOT` is the hyper space root (repo root outside a space). `PROJECT` is the space/repo directory name. **REQUIRED SUB-SKILL:** use the `herdr` skill for command syntax; run `herdr tab`, `herdr pane`, `herdr agent` to confirm current flags before first use.

Each dev gets **one tab** whose root pane runs the dev session, with cwd = the hyper space root (or the repo root outside a space).

Session naming: `[project]-[task-ref]`, e.g. `web-login-form`. Same name for the Claude display name, the Remote Control name, and the Herdr agent name.

```bash
# 0. the dev's environment: resolve the harness's env: block (see Dev
#    environment) into --env flags. Shown for claude with inherit: [CLAUDE_CONFIG_DIR];
#    one --env per resolved pair, inherited vars only when set in your own env.
env_args=()
[ -n "${CLAUDE_CONFIG_DIR:-}" ] && env_args+=(--env "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR")

# 1. tab, cwd = space root, no focus steal; the env flags apply to the pane shell,
#    so everything started in it (agent start included) sees them
WORKSPACE=$(herdr pane current --current | jq -r .result.pane.workspace_id)
tab=$(herdr tab create --workspace "$WORKSPACE" --cwd "$SPACE_ROOT" --label "$REF" --no-focus "${env_args[@]}")
tab_id=$(jq -r .result.tab.tab_id <<<"$tab")
root_pane=$(jq -r .result.root_pane.pane_id <<<"$tab")

# 2. the dev in the root pane, named (+ remote control for Claude Code); the
#    question tool is denied so questions come to you, not the operator
#    (see Chain of command)
name="${PROJECT}-${REF}"
herdr agent start "$name" --kind claude --pane "$root_pane" \
  -- --name "$name" --remote-control "$name" --model "$MODEL" \
     --disallowedTools AskUserQuestion
# other harnesses: --kind <herdr_kind from the config>, args after `--` per that
# CLI, always denying its ask-the-operator tool (pi: `--exclude-tools ask_user`).
# `agent start` runs the kind's canonical executable, so the dev's account and
# config come from the --env flags above, never from a shell alias or wrapper.
# If `agent start` rejects a kind or a wrapper script, fall back to
#   herdr pane run "$root_pane" "<launch command from the config>"
#   herdr agent rename "$root_pane" "$name"

```

**Brief branch — Claude lead → Claude or pi dev (default):** use the `SendMessage` tool with recipient `$name` and message set to the contents of `$BRIEF_FILE`. Launch pi with `--name "$name"`. This sends over sockets; do not also type into the pane.

**Brief branch — other harness pairs or `messaging: herdr`:** after `herdr agent get "$name"` confirms `idle`/`done`, fire and forget (do not use `--wait`):

```bash
herdr agent prompt "$name" "$(cat "$BRIEF_FILE")"
```

Choose the lead → dev pair from *Agent messaging* in SKILL.md; a Kimi/omni lead does not have Claude's `SendMessage` tool.

No per-dev waiter: the dev's `STATUS:` message is the notification, and the *Monitoring* in SKILL.md status script catches a dev that finishes without sending one.

Check `herdr agent get "$name"` shows `idle` before prompting (`agent start` returns before the TUI is fully ready; `.result.agent.agent_status` may be null right after start). Do not `--wait` on the prompt itself: it blocks your turn for the whole task. Only prompt an agent whose status is `idle`/`done`: a prompt sent while it is `working` lands in the input box unsubmitted and the agent goes idle forever. If `agent get` reports idle but nothing happened, check the input box (see [Reading the input box](#reading-the-input-box)). Read results with `herdr agent read "$name" --source recent-unwrapped --lines 200`; on failure fall back to asking the dev to write its report to a file under `scratch/` and read that. Herdr agent names must match `[a-z][a-z0-9_-]{0,31}`. If `PROJECT-REF` is longer, truncate `PROJECT` to its first 8 chars; the ref is never shortened.

Outside Herdr, the Agent tool is the launcher; the naming rule still applies to the agent `description`.

### Reading the input box

Claude Code shows a dim **suggested next prompt** in its `❯` box; it is not input, so never submit or report it. Plain text only shows the difference with attributes kept: `herdr agent read "$name" --source visible --format ansi --lines 8 | cat -v | grep -a '❯'`. Dim text (`^[[2m`) is a suggestion; bare text is an unsent draft — yours if you just prompted a working agent (send `herdr agent send-keys "$name" enter`), otherwise the user's (leave it, tell the user).

### Stall watchdog (Herdr, no tokens)

Herdr mode only: the script reads and prompts Herdr agents. In Orca mode the equivalent is the blocking `check --wait` described in [Orca mode](orca-mode.md) plus the liveness verdicts the status script reports.

`team-status.sh` needs you awake to read it. A team can also stall silently: a dev goes idle waiting on its leader while the leader believes the dev is busy, and nobody works for hours. Start `stall-watch.sh` once per session as a background shell (Bash with `run_in_background`; the user sees and stops it in the task list). It runs a plain shell loop, costs no tokens, and only prompts an agent when there is something to act on. If your harness has no background shells, run it in a pane instead.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/team/scripts/stall-watch.sh \
  --team <leader-name-or-pane-id>='<project>-<glob>' [--team ...] --escalate <agent-name-or-pane-id> --quiet-min 15
```

It delivers its alerts with `herdr agent prompt`, so they can collide with the operator typing in the leader's pane (see *Agent messaging* in SKILL.md).

- A team is a leader plus every agent matching its globs. For your own devs, the leader is you (`--team <you>='<project>-*'`); for a Squad Leader, add a `--team` for it and its devs. Use the live Herdr agent name, or your pane ID if you have no Herdr name: `herdr pane current --current | jq -r .result.pane.pane_id`. Do not use `$HERDR_PANE_ID`: it goes stale if the pane moves. Use the same rule for `--escalate`.
- When nobody on a team has been `working` for `--quiet-min` minutes, it prompts the leader once per quiet episode with each member's status and the last lines of its pane. If the team is still quiet `--quiet-min` minutes later, it prompts `--escalate` once.
- A member stuck in a non-idle, non-working state (approval dialog, error) for two checks is reported to the leader right away.
- It only prompts agents that are not `working`, retrying on the next tick otherwise.
- When your team is legitimately waiting (the user, CI, a merge), silence it: `stall-watch.sh --snooze <leader> <minutes>`. The alert text includes the exact command.
- Test a configuration with `--once --dry-run` before leaving it running.
