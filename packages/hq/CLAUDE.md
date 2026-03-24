# @hypercli/hq — Claude Code Session Management

This package is the `hyper hq` plugin for the HyperDev CLI. It manages persistent Claude Code sessions via tmux, controllable through Remote Control (claude.ai/code, mobile) and Telegram Channels.

## Architecture

- **Plugin type:** oclif plugin registered in `@hypercli/cli`
- **Base command:** Extends `BaseCommand` from `@hypercli/kit`
- **Commands:** All under `hyper hq <command>`
- **Setup logic lives in `create-hyper-hq`** — hq depends on it, not the reverse

### Why interactive mode + /remote-control (not `claude remote-control`)

The `claude` CLI has two ways to enable web access:

1. **`claude remote-control`** — a subcommand that starts a standalone server accepting sessions from claude.ai/code. Does NOT support `--channels` for Telegram.
2. **`claude` (interactive)** — supports `--channels` for Telegram AND the `/remote-control` slash command.

We use option 2 because it's the only way to get **both Telegram channels AND web access** in one session. The flow:

1. `hyper hq start` runs `claude --channels plugin:telegram@... --continue` inside tmux
2. The generated CLAUDE.md instructs Claude to run `/remote-control <name>` on startup
3. Result: one session with Telegram + web remote control

**IMPORTANT:** Do NOT pipe stdout (e.g. `| tee`). Claude interactive mode requires a TTY — piping strips it and the process dies immediately. Use tmux `pipe-pane` for logging instead.

### Session naming

- HQ session: uses config `hq.name` (default: `"Hyper HQ"`)
- Project sessions: `hq-<project-name>` (via `sanitizeSessionName`)
- All commands (`attach`, `stop`, etc.) read config to resolve the default session name

### Startup flow

1. `hyper hq start` creates tmux session, verifies it's alive, then auto-attaches
2. Claude starts, reads CLAUDE.md, checks Telegram pairing status
3. If Telegram is configured but not paired, Claude walks the user through pairing
4. Claude runs `/remote-control` to enable web access
5. User detaches with `Ctrl+B, D` — session keeps running
6. `hyper hq web` can open the bridge URL later

### Telegram pairing state

State lives in `~/.claude/channels/telegram/`:
- `.env` — contains `TELEGRAM_BOT_TOKEN` (written by `create-hyper-hq` during setup)
- `access.json` — managed by the Telegram plugin's `/telegram:access` skill
  - Not present or `allowFrom: []` → not paired
  - `allowFrom: [userId]` → paired and locked down

## Key Services

- `services/tmux.ts` — tmux session lifecycle (create, kill, list, verify, pipe-pane logging)
- `services/claude.ts` — Builds interactive `claude` command strings with `--continue`, `--channels`, and passthrough args
- `services/projects.ts` — Project discovery + worktree detection (wt + git)
- `services/telegram.ts` — Telegram channel plugin integration (`plugin:telegram@claude-plugins-official`)

## Config

User config at `~/.config/hyper/hq.toml` (TOML format).

## Package Management
- Use bun, never npm
