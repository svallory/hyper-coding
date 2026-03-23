# hyper recipe run

Execute a recipe to generate code. Runs the full generation pipeline including template rendering, file operations, and optional AI 2-pass generation.

## Usage

`hyper recipe run <recipe> [--var=value ...] [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `recipe` | Path to recipe file (`.yml` or `.yaml`) — required |

## Flags

| Flag | Description |
|------|-------------|
| `--dry` | Dry run — show what would happen without writing files |
| `--dry-run` | Alias for `--dry` |
| `--force`, `-f` | Overwrite existing files |
| `--skip-prompts` | Skip all interactive prompts |
| `--defaults` | Use default values for all prompts |
| `--continue-on-error` | Keep running even if a step fails |
| `--answers <file>` | Load AI answers from a JSON file (Pass 2) |
| `--ai-mode <mode>` | AI resolution mode: `me`, `ai`, or `nobody` |
| `--json` | Output result as JSON |
| `--verbose`, `-v` | Verbose output |
| `--quiet`, `-q` | Suppress output |

## Examples

```sh
# Run a recipe by path
hyper recipe run my-recipe.yml

# Pass recipe variables inline
hyper recipe run recipe.yml --name=Button --type=component

# Dry run to preview file operations
hyper recipe run recipe.yml --dry

# Use pre-generated AI answers (Pass 2)
hyper recipe run recipe.yml --answers ./ai-answers.json

# Run with a specific AI mode
hyper recipe run recipe.yml --ai-mode stdout
```

## Recipe Variables

Any unknown `--flag=value` pair is treated as a recipe variable and passed directly to the template engine. For example, `--name=Button` sets the `name` variable in the recipe.
