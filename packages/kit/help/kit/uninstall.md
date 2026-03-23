# hyper kit uninstall

Remove an installed kit from your project. Also available as `hyper kit remove`.

## Usage

`hyper kit uninstall <kit> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `kit` | Name of the kit to uninstall |

## Flags

| Flag | Description |
|------|-------------|
| `-f, --force` | Skip the confirmation prompt |
| `--cwd <dir>` | Working directory |
| `-d, --debug` | Enable debug output |

## Examples

```sh
# Remove a kit (prompts for confirmation)
hyper kit uninstall starlight

# Remove without confirmation
hyper kit uninstall starlight --force

# Alias
hyper kit remove starlight
```

## Notes

For npm/JSR kits, the package is removed via your project's package manager. For GitHub, Git URL, and local path kits, the directory under `.hyper/kits/` is deleted and the kit is removed from the manifest.
