# hyper recipe validate

Validate a recipe file's syntax and structure without executing it. Reports the recipe name, version, variable count, and step list on success.

## Usage

`hyper recipe validate <recipe> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `recipe` | Path to recipe file (`.yml` or `.yaml`) — required |

## Flags

| Flag | Description |
|------|-------------|
| `--strict` | Strict validation mode |
| `--json` | Output result as JSON |
| `--verbose`, `-v` | Verbose output |
| `--quiet`, `-q` | Suppress output |

## Examples

```sh
# Validate a local recipe
hyper recipe validate my-recipe.yml

# Validate a recipe inside a kit
hyper recipe validate .hyper/kits/component.yml --strict

# Machine-readable output
hyper recipe validate recipe.yml --json
```

## JSON Output

With `--json`, the command outputs a structured object:

```json
{
  "valid": true,
  "name": "Create Component",
  "version": "1.0.0",
  "steps": 4,
  "variables": 2
}
```

On failure, `valid` is `false` and an `error` field describes the problem.
