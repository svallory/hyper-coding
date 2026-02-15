# @hypercli/kit

Kit lifecycle management for HyperDev - handles installation, updates, and discovery of generator kits.

## Purpose

This package is an **oclif plugin** that provides commands for managing kits (third-party generator packages). It handles kit installation from multiple sources (npm, GitHub, local), version management, and kit manifest validation.

## What's Inside

### Commands (`src/commands/kit/`)

All commands live under `hyper kit` namespace:

- **install.ts** - `hyper kit install <source>` - Install kits from npm, GitHub, or local path
  - Supports: `npm:package-name`, `github:user/repo`, `local:./path`
  - Auto-detects package manager (bun/npm/pnpm/yarn)
  - Validates kit.yml manifest after install
- **update.ts** - `hyper kit update [kit-name]` - Update installed kits
- **list.ts** - `hyper kit list` - List all installed kits
- **info.ts** - `hyper kit info <kit-name>` - Show detailed kit information

### Source Resolution (`src/source-resolver.ts`)

Resolves kit sources to installable formats:
- **npm:** `npm:@scope/package` → npm package
- **GitHub:** `github:user/repo#branch` → GitHub tarball
- **Local:** `local:./path` → symlink or copy

### Manifest Handling (`src/manifest.ts`)

- **validateKitManifest()** - Validates kit.yml structure
- **loadKitManifest()** - Loads and parses kit.yml from kit directory
- JSON schema (`manifest.schema.json`) for kit.yml validation

### URL Resolution (`src/utils/url-resolution.ts`)

Resolves GitHub URLs, npm registry URLs with caching:
- Handles GitHub refs (branches, tags, commits)
- Caches resolved URLs to avoid repeated API calls
- Supports rate limiting and authentication

### Base Command (`src/base-command.ts`)

KitBaseCommand extends CoreBaseCommand (from @hypercli/cli) and adds:
- Kit-specific error handling
- Common kit utilities
- Shared flags for kit commands

## Dependencies

- **@hypercli/core** - Types, config, errors, utilities
- **@oclif/core** - CLI framework (inherited, not direct dep)

## Usage by CLI

CLI loads this package as an oclif plugin:

```json
{
  "oclif": {
    "plugins": ["@hypercli/kit"]
  }
}
```

Commands are automatically discovered and registered under `hyper kit` namespace.

## Kit Manifest Format

Kits must have a `kit.yml` at their root:

```yaml
name: nextjs
version: 1.0.0
description: Next.js generators
author: Your Name
recipes:
  - path: crud
    description: Generate CRUD operations
cookbooks:
  - path: cookbooks/api.yml
    description: API setup
```

## Build

```bash
bun install
bun run build       # Builds to dist/
bun run typecheck   # TypeScript validation
```

Note: DTS generation is disabled due to inflection types incompatibility.

## Architecture Notes

- **Plugin architecture** - oclif discovers commands automatically
- **Source flexibility** - Supports multiple kit sources (npm, GitHub, local)
- **Package manager agnostic** - Auto-detects bun/npm/pnpm/yarn
- **Validation-first** - All kit.yml files validated against schema
- **No generation code** - Only manages kit lifecycle, doesn't execute recipes
