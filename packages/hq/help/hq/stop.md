# hyper hq stop

Stop an HQ session.

## Usage

`hyper hq stop [session]`

## Arguments

| Argument | Description |
|----------|-------------|
| `session` | Session name or project name (default: `hyper-hq`) |

## Examples

```sh
# Stop the main HQ session
hyper hq stop

# Stop a specific project session by project name
hyper hq stop my-project

# Stop a session by its full session name
hyper hq stop hq-my-project
```

## Notes

- If the argument does not start with `hq`, the prefix `hq-` is added automatically — so `hyper hq stop my-project` targets the session named `hq-my-project`.
- To stop all HQ sessions at once, use `hyper hq stop-all`.
