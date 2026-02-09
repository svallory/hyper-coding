# Moon Kit for Hypergen

This kit provides comprehensive support for working with [Moon](https://moonrepo.dev/) monorepos in Hypergen.

## Overview

The `@hyper-kits/moon` kit contains multiple cookbooks for managing Moon-based monorepos:

- **repo** - Repository management (create new monorepos)
- **toolchain** - Runtime toolchain configuration (Node.js, TypeScript, Deno, Bun)
- **tasks** - Development tool task configuration (ESLint, Jest, Vitest, etc.)
- **project** - Project management within monorepos

## Installation

```bash
# Install the kit (when published)
npm install -g @hyper-kits/moon
```

## Usage

### Create a New Monorepo

```bash
# Create a new moon monorepo
hypergen moon repo create

# Or use the default (repo create)
hypergen moon
```

### Add Toolchains

```bash
# Add Node.js toolchain
hypergen moon toolchain node

# Add TypeScript toolchain
hypergen moon toolchain typescript

# Add Deno toolchain
hypergen moon toolchain deno

# Add Bun toolchain
hypergen moon toolchain bun
```

### Configure Tasks

```bash
# Add TypeScript compilation tasks
hypergen moon tasks typescript

# Add ESLint linting tasks
hypergen moon tasks eslint

# Add Jest testing
hypergen moon tasks jest

# Add Vitest testing
hypergen moon tasks vitest

# Add Prettier formatting
hypergen moon tasks prettier

# Add Vite build tasks
hypergen moon tasks vite

# Add Astro tasks
hypergen moon tasks astro

# Add SvelteKit tasks
hypergen moon tasks sveltekit

# Add Packemon build tasks
hypergen moon tasks packemon
```

### Create New Projects

```bash
# Create a new project within the monorepo
hypergen moon project create
```

## Examples

### Example 1: Create a TypeScript Node.js Monorepo

```bash
# Create monorepo
hypergen moon repo create
# Select: platform=node, tools=[typescript, eslint, prettier], package_manager=bun

# Add toolchain configurations
hypergen moon toolchain node
hypergen moon toolchain typescript

# Add task configurations
hypergen moon tasks typescript
hypergen moon tasks eslint
hypergen moon tasks prettier
```

### Example 2: Add Testing to Existing Project

```bash
# Add Jest for unit testing
hypergen moon tasks jest

# Or Vitest for faster testing
hypergen moon tasks vitest
```

## Kit Structure

```
@hyper-kits/moon/
├── kit.yml                    # Kit metadata
└── cookbooks/
    ├── repo/
    │   └── create/            # Create new monorepo
    ├── toolchain/
    │   ├── node/              # Add Node.js toolchain
    │   ├── typescript/        # Add TypeScript toolchain
    │   ├── deno/              # Add Deno toolchain
    │   └── bun/               # Add Bun toolchain
    ├── tasks/
    │   ├── typescript/        # TypeScript compilation tasks
    │   ├── eslint/            # ESLint linting tasks
    │   ├── jest/              # Jest testing tasks
    │   ├── vitest/            # Vitest testing tasks
    │   ├── prettier/          # Prettier formatting tasks
    │   ├── vite/              # Vite build tasks
    │   ├── astro/             # Astro framework tasks
    │   ├── sveltekit/         # SvelteKit tasks
    │   └── packemon/          # Packemon build tasks
    └── project/
        └── create/            # Create new project
```

## Task Tags

Tasks are configured using moon's tag system. Add tags to your `moon.yml` files:

```yaml
tags:
  - typescript
  - eslint
  - prettier
```

This enables the configured tasks for that project.

## File Updates

The recipes in this kit can update existing configuration files using Hypergen's injection system:

```yaml
---
to: .moon/toolchain.yml
inject: true
after: "node:"
---
# New content to inject
```

## Testing

Run the test script to verify all recipes:

```bash
./test-recipes.sh
```

## Migration from Tera Templates

This kit replaces the original Tera-based moon templates. See [MIGRATION.md](MIGRATION.md) for details on converting from Tera to LiquidJS.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new recipes
4. Submit a pull request

## License

MIT - see LICENSE file for details."}

## Future Kit.yml Support

The kit includes a `kit.yml` file prepared for when kit support is implemented in Hypergen. Once supported, you'll be able to:

- Run `hypergen moon` to use the default recipe (repo create)
- Define default cookbooks and recipes
- Configure kit metadata for discovery

## Notes

- The `kit.yml` file is prepared for future Hypergen kit support
- All templates use LiquidJS syntax (`.liquid` files)
- Recipes support file injection for updating existing configurations
- Interactive prompts provide excellent user experience