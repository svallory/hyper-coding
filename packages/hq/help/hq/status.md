# hyper hq status

Show running HQ sessions.

## Usage

`hyper hq status [flags]`

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

## Examples

```sh
# Show all running HQ sessions
hyper hq status

# Output as JSON
hyper hq status --json
```

## Output

```
HQ Sessions
═══════════
  hyper-hq                 ONLINE     2024-01-15  (HQ)
  hq-my-project            ATTACHED   2024-01-15
  hq-another-project       ONLINE     2024-01-15
```

- `ATTACHED` — a terminal is currently connected to the session.
- `ONLINE` — the session is running but no terminal is attached.

If no sessions are running, the command suggests `hyper hq start`.
