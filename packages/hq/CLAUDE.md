# @hypercli/hq — Claude Code Session Management

This package is the `hyper hq` plugin for the HyperDev CLI. It manages persistent Claude Code sessions via tmux, controllable through Remote Control (claude.ai/code, mobile) and Telegram Channels.

## Architecture

- **Plugin type:** oclif plugin registered in `@hypercli/cli`
- **Base command:** Extends `BaseCommand` from `@hypercli/kit`
- **Commands:** All under `hyper hq <command>`

## Key Services

- `services/tmux.ts` — tmux session lifecycle
- `services/claude.ts` — Builds `claude remote-control` command strings
- `services/projects.ts` — Project discovery + worktree detection (wt + git)
- `services/telegram.ts` — Bot pool token management

## Config

User config at `~/.config/hyper/hq.toml` (TOML format).

## Package Management
- Use bun, never npm
