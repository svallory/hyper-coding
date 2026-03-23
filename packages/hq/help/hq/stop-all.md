# hyper hq stop-all

Stop all HQ-managed sessions.

## Usage

`hyper hq stop-all`

## Examples

```sh
# Stop every running HQ session
hyper hq stop-all
```

## Notes

- Kills all tmux sessions whose names start with `hq`.
- If no HQ sessions are running, the command exits cleanly with a message.
- To stop a single session, use `hyper hq stop [session]`.
