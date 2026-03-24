# @hypercli/hq — Claude Code Session Management

This package is the `hyper hq` plugin for the HyperDev CLI. It manages persistent Claude Code sessions via tmux, controllable through Remote Control (claude.ai/code, mobile) and Telegram Channels.

## Architecture

- **Plugin type:** oclif plugin registered in `@hypercli/cli`
- **Base command:** Extends `BaseCommand` from `@hypercli/kit`
- **Commands:** All under `hyper hq <command>`

## Key Services

- `services/tmux.ts` — tmux session lifecycle (create, kill, list, verify)
- `services/claude.ts` — Builds interactive `claude` command strings with `--continue`, `--channels`, and passthrough args
- `services/projects.ts` — Project discovery + worktree detection (wt + git)
- `services/telegram.ts` — Telegram channel plugin integration (`plugin:telegram@claude-plugins-official`)

## Config

User config at `~/.config/hyper/hq.toml` (TOML format).

## Package Management
- Use bun, never npm
