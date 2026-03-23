# hyper cookbook list

List cookbooks across all installed kits, or filter to a specific kit. Shows each cookbook's name, description, and the recipes it contains.

## Usage

`hyper cookbook list [kit] [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `kit` | Kit to list cookbooks from — optional, lists all if omitted |

## Flags

| Flag | Description |
|------|-------------|
| `--kit <name>`, `-k` | Filter by kit name (alternative to the positional argument) |
| `--json` | Output as JSON |

## Examples

```sh
# List all cookbooks across all installed kits
hyper cookbook list

# List cookbooks from a specific kit
hyper cookbook list @kit/starlight

# Machine-readable output
hyper cookbook list --json
```

## Output

Cookbooks are grouped by kit. Each entry shows the cookbook name, version (if set), description, and the names of recipes it contains. With `--json`, the full list is returned as an array.
