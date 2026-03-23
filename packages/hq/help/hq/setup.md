# hyper hq setup

Check dependencies and configure HQ. Verifies that tmux, Claude CLI, and authentication are in place, then runs the configuration wizard.

## Usage

`hyper hq setup`

## What It Checks

- tmux is installed
- Claude CLI is installed
- Claude authentication is configured
- HQ configuration exists (creates or reconfigures)

## Examples

```sh
# Run the full setup
hyper hq setup
```
