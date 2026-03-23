# hyper

Modern, scalable code generator with AI integration.

## Usage

`hyper <command> [options]`

## Getting Started

```sh
# Initialize Hyper in your project
hyper init

# Install a generator kit
hyper kit install nextjs

# Generate code from a recipe
hyper gen nextjs crud create
```

## Generation

| Command | Description |
|---------|-------------|
| `hyper gen <recipe>` | Execute a recipe to generate code |
| `hyper recipe list` | Browse available recipes |
| `hyper recipe run <file>` | Run a recipe by file path |
| `hyper cookbook list` | Explore multi-step cookbooks |

**Shorthand:** `hyper nextjs crud` is equivalent to `hyper gen nextjs crud`.

## Session Management

| Command | Description |
|---------|-------------|
| `hyper hq start` | Start the always-on HQ control center |
| `hyper hq spawn <project>` | Spawn a Claude session for a project |
| `hyper hq status` | Check running sessions |

## Kit Management

| Command | Description |
|---------|-------------|
| `hyper kit install <source>` | Install a kit from npm, GitHub, or local path |
| `hyper kit list` | List installed kits |
| `hyper kit update` | Update kits to latest versions |

Run `hyper help <topic>` to learn more about any topic, or `hyper <command> --help` for command details.
