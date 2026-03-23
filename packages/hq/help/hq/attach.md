# hyper hq attach

Attach to an HQ tmux session in your current terminal.

## Usage

`hyper hq attach [session]`

## Arguments

| Argument | Description |
|----------|-------------|
| `session` | Session name or project name (default: `hyper-hq`) |

## Examples

```sh
# Attach to the main HQ session
hyper hq attach

# Attach to a project session by project name
hyper hq attach my-project

# Attach using the full session name
hyper hq attach hq-my-project
```

## Notes

- If the argument does not start with `hq`, the prefix `hq-` is added automatically — so `hyper hq attach my-project` targets the session named `hq-my-project`.
- Requires tmux to be installed and the session to already be running. Use `hyper hq status` to list active sessions.
- Detach from the session with `Ctrl-b d` (standard tmux detach).
