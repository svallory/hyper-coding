# hyper kit update

Update installed kits by re-fetching from their original source. Either update a single kit by name or all kits at once with `--all`.

## Usage

`hyper kit update [kit] [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `kit` | Name of the kit to update (omit when using `--all`) |

## Flags

| Flag | Description |
|------|-------------|
| `--all` | Update all installed kits |
| `--cwd <dir>` | Working directory |
| `-d, --debug` | Enable debug output |

## Examples

```sh
# Update a single kit
hyper kit update nextjs

# Update all installed kits
hyper kit update --all
```

## Notes

npm and JSR kits are updated through your package manager — this command will print the appropriate command to run (e.g. `bun update <package>`). For GitHub, Git URL, and local path kits, the existing `.hyper/kits/<name>/` directory is replaced by re-fetching from the recorded source.
