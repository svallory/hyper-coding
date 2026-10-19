Read this when another team lead runs for the same or another repository, or a task belongs to another repo and a dev must be handed over.

## Peer team leads

One team lead per repository. Several leads may run at once, each in its own Herdr workspace whose cwd is that project's space root. Naming is the contract: session/agent name `<project>-team-lead` (e.g. `api-team-lead`, `web-team-lead`); dev agents are `<project>-<task-ref>`.

Discover peers when you need one (never assume): `herdr agent list` and match `terminal_title_stripped` or `name` against `*-team-lead`; the row gives `pane_id`, `workspace_id`, `cwd`. Address a peer by its pane ID when it has no registered name. In Orca mode: `orca terminal list --json` (add `--environment <env-id>` per remote machine) and match the title against `*-team-lead`; the row gives the handle, which is also the peer's address for `orca orchestration send`. Pane moves are Herdr-only; in Orca the handoff message carries the dev's terminal handle and dispatch id, and the peer adopts the dispatch into its own Run with `worker-start --terminal <handle> --retry-of <dispatch-id>` after you `worker-release` it.

Cross-project work: if research shows a task belongs to another repo (a bug report from the wrong app, a shared package), do not spawn its devs under your workspace. Either hand the task to the peer lead with the facts you have, or, if you already started a dev, hand the dev over:

1. Move the dev's pane into the peer's workspace so the user finds it there: `herdr pane move <dev-pane-id> --workspace <peer-workspace-id> --new-tab`. Agent names follow the pane; after the move use the name, not the old pane ID.
2. Send the peer a handoff message (`SendMessage` to the peer's session name; `herdr agent prompt <peer-name-or-pane>` only if the peer is not a Claude Code or pi session; see *Agent messaging* in SKILL.md) containing: dev agent name and new pane/tab IDs, worktree path and branch, brief file path, report file path and completion phrase, rules already given to the dev (discussion-first, no deploy, no push until accepted), and the established facts with `file:line`. End with "I am no longer tracking it."
3. Drop the row from your status table. Only one lead tracks a dev at a time.

If no peer lead is running for that repo, tell the user and offer to start one (`herdr tab create --workspace <that project's workspace id> --cwd <its space root>` + `herdr agent start <project>-team-lead --kind claude ... -- --name <project>-team-lead --remote-control <project>-team-lead --disallowedTools AskUserQuestion`, then send it `/team-lead` with the task, naming you as its lead) rather than coordinating two repos yourself.
