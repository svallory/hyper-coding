# hyper kit info

Show detailed information about an installed kit, including its cookbooks, recipes, and optionally its variables and source provenance.

## Usage

`hyper kit info <kit> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `kit` | Name of the installed kit |

## Flags

| Flag | Description |
|------|-------------|
| `--variables` | Show variable details defined by the kit |
| `--source` | Show provenance info (path, URL, commit, branch, tag) |
| `--recipes` | Expand recipes with descriptions |
| `--steps` | Show step list with tool types (recipe info only) |
| `--json` | Output as JSON |
| `--cwd <dir>` | Working directory |
| `-d, --debug` | Enable debug output |

## Examples

```sh
# Show kit overview with cookbooks and recipes
hyper kit info starlight

# Include variable definitions
hyper kit info starlight --variables

# Include source and install metadata
hyper kit info starlight --source

# Output as JSON
hyper kit info starlight --json
```
