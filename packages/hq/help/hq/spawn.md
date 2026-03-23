# hyper hq spawn

Spawn a new Claude session for a project.

## Usage

`hyper hq spawn <project> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `project` | Project name (looked up under your configured projects root) or an absolute path |

## Flags

| Flag | Description |
|------|-------------|
| `--worktree <branch>` | Use an existing worktree by branch name |
| `--new-worktree <branch>` | Create a new worktree via `wt switch -c` and spawn into it |
| `--permission-mode <mode>` | Permission mode: `default`, `acceptEdits`, `plan`, or `auto` |
| `--name <name>` | Custom session name (default: `hq-<project>[-<branch>]`) |

## Examples

```sh
# Spawn a session for a project in your projects root
hyper hq spawn my-project

# Spawn using an absolute path
hyper hq spawn /absolute/path/to/project

# Spawn on an existing worktree
hyper hq spawn my-project --worktree feat-auth

# Create a new worktree and spawn into it
hyper hq spawn my-project --new-worktree feat-login

# Spawn with auto-permission mode
hyper hq spawn my-project --permission-mode auto
```

## Notes

- If a session for the project is already running, the command exits early and suggests `hyper hq attach <project>`.
- Connect to the spawned session via claude.ai/code, the Claude mobile app, or `hyper hq attach <project>`.
- If a Telegram bot is configured for the project in `hq.toml`, the session will use it automatically.
