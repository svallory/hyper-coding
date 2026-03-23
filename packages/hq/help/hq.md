# hyper hq

Always-on Claude Code command center. Manages persistent Claude sessions via tmux, accessible from claude.ai/code, mobile, and Telegram.

## Usage

`hyper hq <command> [options]`

## Commands

| Command | Description |
|---------|-------------|
| `hyper hq setup` | Check dependencies and configure HQ |
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
# 1. Run setup (first time only)
hyper hq setup

# 2. Start the HQ command center
hyper hq start

# 3. Check what projects are available
hyper hq list

# 4. Spawn a Claude session for a project
hyper hq spawn my-project

# 5. Check running sessions
hyper hq status

# 6. Attach to a session in your terminal
hyper hq attach my-project

# 7. When done, stop everything
hyper hq stop-all
```

## How It Works

HQ runs a persistent Claude Code instance in a tmux session in remote-control server mode. Once started, you can connect to it from claude.ai/code, the Claude mobile app, or via Telegram. From there, you can ask HQ to spawn sessions for any of your projects.

Run `hyper hq <command> --help` for details on any command.
