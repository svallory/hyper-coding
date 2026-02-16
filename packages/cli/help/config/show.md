# hyper config show

Display the resolved Hypergen configuration in an interactive JSON viewer.

## Usage

`hyper config show [--json] [--cwd <dir>]`

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON instead of interactive viewer |
| `--cwd <dir>` | Set working directory |

## Examples

```sh
# Open config in interactive fx viewer
hyper config show

# Pipe config as JSON
hyper config show --json

# Show config for a specific project
hyper config show --cwd ./my-project
```
