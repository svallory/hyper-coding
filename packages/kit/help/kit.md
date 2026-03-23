# hyper kit

Manage the kits installed in your project. Kits are generator packages that provide recipes and cookbooks for code generation.

## Commands

| Command | Description |
|---------|-------------|
| `hyper kit install <source>` | Install a kit from npm, JSR, GitHub, or local path |
| `hyper kit list` | List all installed kits |
| `hyper kit info <kit>` | Show detailed information about a kit |
| `hyper kit uninstall <kit>` | Remove an installed kit |
| `hyper kit update [kit]` | Update installed kits from their original source |

## Examples

```sh
# Install a kit from GitHub
hyper kit install svallory/hypergen-kit-nextjs

# List all installed kits
hyper kit list

# Show details for a specific kit
hyper kit info nextjs

# Update all kits at once
hyper kit update --all

# Remove a kit
hyper kit uninstall nextjs
```

## How kits are stored

Kits installed from GitHub, Git URLs, or local paths are stored in `.hyper/kits/` inside your project. Kits installed from npm or JSR are installed as regular node_modules using your project's package manager.
