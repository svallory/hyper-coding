# hyper kit install

Install a kit from npm, JSR, GitHub, or local path.

## Usage

`hyper kit install <kit> [flags]`

## Arguments

| Argument | Description |
|----------|-------------|
| `kit` | Kit to install — accepts an npm package name, JSR package, GitHub shorthand (`user/repo`), full Git URL, or local path |

## Flags

| Flag | Description |
|------|-------------|
| `--dev` | Install as a dev dependency (npm/JSR only) |
| `-n, --name <name>` | Name to use for the kit directory (default: auto-detected from source) |
| `-f, --force` | Replace an existing kit even if already installed |
| `--cwd <dir>` | Working directory |
| `-d, --debug` | Enable debug output |

## Examples

```sh
# Install from npm
hyper kit install @kit/nextjs

# Install from GitHub shorthand
hyper kit install svallory/hypergen-kit-nextjs

# Install from JSR
hyper kit install jsr:@std/path

# Install from a local directory
hyper kit install ./local-kit

# Install from a full Git URL
hyper kit install https://github.com/user/repo.git

# Install with a custom name
hyper kit install svallory/hypergen-kit-nextjs --name nextjs

# Force reinstall (change source or refresh)
hyper kit install ./local-kit --force
```

## Notes

npm and JSR kits are installed into `node_modules` via your project's package manager. GitHub, Git URL, and local path kits are copied to `.hyper/kits/<name>/` and tracked in the kit manifest.
