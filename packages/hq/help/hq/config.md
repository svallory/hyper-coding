# hyper hq config

Show HQ configuration.

## Usage

`hyper hq config [flags]`

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--path` | Print the config file path only |

## Examples

```sh
# Show configuration summary
hyper hq config

# Print raw JSON
hyper hq config --json

# Print the config file path (useful for editors)
hyper hq config --path
```

## Output

```
Config file: /home/user/.config/hyper/hq.toml

  projects_root     /home/user/projects
  hq.name           hyper-hq
  hq.dir            /home/user/.config/hyper/hq
  hq.spawn_mode     same-dir
  hq.capacity       8
  claude.mode       default
  telegram          enabled (HQ bot configured)
  project bots      3 project bot(s)
  project groups    none

Edit: /home/user/.config/hyper/hq.toml
```

## Notes

- If no config file exists yet, the command tells you to run `hyper hq start` to create one via the setup wizard.
- To edit settings directly, open the config file path shown in the output.
