# hyper hq

Always-on Claude Code command center. Manages persistent Claude sessions via tmux, accessible from claude.ai/code, mobile, and Telegram.

## Usage

`hyper hq <command> [options]`

## Commands

| Command | Description |
|---------|-------------|
| `hyper hq start` | Start the HQ command center session |
| `hyper hq stop [session]` | Stop an HQ session |
| `hyper hq stop-all` | Stop all HQ-managed sessions |
| `hyper hq attach [session]` | Attach to an HQ tmux session |
| `hyper hq spawn <project>` | Spawn a Claude session for a project |
| `hyper hq list` | List available projects and their worktrees |
| `hyper hq status` | Show running HQ sessions |
| `hyper hq config` | Show HQ configuration |

## Quick Start

```sh
# 1. Start the HQ command center
hyper hq start

# 2. Check what projects are available
hyper hq list

# 3. Spawn a Claude session for a project
hyper hq spawn my-project

# 4. Check running sessions
hyper hq status

# 5. Attach to a session in your terminal
hyper hq attach my-project

# 6. When done, stop everything
hyper hq stop-all
```

## How It Works

HQ runs a persistent Claude Code instance in a tmux session in remote-control server mode. Once started, you can connect to it from claude.ai/code, the Claude mobile app, or via Telegram. From there, you can ask HQ to spawn sessions for any of your projects.

Run `hyper hq <command> --help` for details on any command.
