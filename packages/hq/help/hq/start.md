# hyper hq start

Start the HQ session — always-on Claude Code command center.

## Usage

`hyper hq start [flags]`

## Flags

| Flag | Description |
|------|-------------|
| `--name <name>` | Custom session name (default: from config) |
| `--spawn-mode <mode>` | How new sessions are created: `same-dir`, `worktree`, or `session` |
| `--permission-mode <mode>` | Permission mode for sessions: `default`, `acceptEdits`, `plan`, or `auto` |
| `--capacity <n>` | Max concurrent sessions |

## Examples

```sh
# Start HQ with defaults
hyper hq start

# Start with worktree spawn mode
hyper hq start --spawn-mode worktree

# Start with higher session capacity
hyper hq start --capacity 16

# Start in auto-permission mode (no approval prompts)
hyper hq start --permission-mode auto
```

## Notes

- The first run triggers an interactive setup wizard to create `~/.config/hyper/hq.toml`.
- HQ runs as a tmux session in Claude's remote-control server mode — connect to it from claude.ai/code or the mobile app.
- If a session with the same name is already running, the command exits early and suggests using `hyper hq attach`.
- Flags override the corresponding values in your config file.
