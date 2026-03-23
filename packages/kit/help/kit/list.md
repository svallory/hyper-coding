# hyper kit list

List all kits installed in the current project, including their cookbooks and available recipes.

## Usage

`hyper kit list [flags]`

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--cwd <dir>` | Working directory |
| `-d, --debug` | Enable debug output |

## Examples

```sh
# List installed kits with cookbooks and recipes
hyper kit list

# Output as JSON for scripting
hyper kit list --json
```
