# hyper cookbook info

Show detailed information about a cookbook, including its recipes and their variables. Searches all installed kits to locate the cookbook by name.

## Usage

`hyper cookbook info <cookbook> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `cookbook` | Cookbook name or path — required |

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

## Examples

```sh
# Show info for a cookbook by name
hyper cookbook info starlight

# Show info using the full kit-qualified path
hyper cookbook info @kit/starlight/docs --json
```

## Output

The default output displays the cookbook's location, kit, description, and a recipe list with each recipe's variables. With `--json`, the full structure is returned as a machine-readable object.

If the cookbook is not found, `hyper cookbook info` lists all available cookbooks grouped by kit.
