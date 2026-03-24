# @hypercli/hq

Claude Code session management plugin for the `hyper` CLI. Manages persistent Claude sessions via tmux, accessible from claude.ai/code, mobile, and Telegram.

## Install

Included automatically with `@hypercli/cli`. Can also be installed as a standalone oclif plugin.

## Commands

- `hyper hq start` — Start the always-on HQ control center
- `hyper hq launch [project] [path]` — Launch a Claude session for a project
- `hyper hq relaunch <session|project>` — Relaunch a session with --continue
- `hyper hq status` — Show running sessions
- `hyper hq list` — List available projects
- `hyper hq attach` — Attach to a tmux session
- `hyper hq stop` / `hyper hq stop-all` — Stop sessions

## Documentation

Full documentation at [hyperdev.saulo.engineer](https://hyperdev.saulo.engineer).

## License

MIT
