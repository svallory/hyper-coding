# hypergen → @hypercli/cli

⚠️ **This package is deprecated.**

The `hypergen` package has been split into a multi-package architecture:

- **[@hypercli/cli](https://www.npmjs.com/package/@hypercli/cli)** - Main CLI (install this)
- **[@hypercli/core](https://www.npmjs.com/package/@hypercli/core)** - Core types and config
- **[@hypercli/kit](https://www.npmjs.com/package/@hypercli/kit)** - Kit management
- **[@hypercli/gen](https://www.npmjs.com/package/@hypercli/gen)** - Generation engine

## Migration

```bash
# Uninstall old package
npm uninstall -g hypergen

# Install new CLI
npm install -g @hypercli/cli

# Use new command name
hyper run nextjs crud list
```

The command name changed from `hypergen` to `hyper`.

## Why the change?

The monolithic 32K LOC package couldn't scale to support the HyperDev vision (5+ top-level commands: gen, tools, plan, watch, dash). The new architecture enables:

- **Independent evolution** - Each command is a separate oclif plugin
- **Clear separation** - Core types, kit management, and generation engine are distinct concerns
- **Better DX** - Contributors can work on one command without understanding the entire codebase
- **Faster releases** - Bug fixes and features can ship independently

## Package Responsibilities

### @hypercli/cli
The thin shell and plugin host. Provides:
- `hyper` binary
- Config management commands
- System commands
- Plugin loading for gen/kits

### @hypercli/core
Foundation types and utilities. Provides:
- Kit, Cookbook, Recipe type definitions
- Error system with 83 error codes
- Configuration loading with cosmiconfig
- Parsers for kit.yml and cookbook.yml
- Logger and helper utilities

### @hypercli/kit
Kit lifecycle management. Provides:
- Kit installation from npm, GitHub, or local paths
- Kit manifest management
- URL resolution with caching
- `hyper kit` commands

### @hypercli/gen
Code generation engine. Provides:
- Recipe execution engine with 13 tools
- Jig template engine (Edge.js fork)
- AI integration (2-pass scaffold+complete)
- Action system with decorators
- `hyper run`, `hyper recipe`, `hyper cookbook` commands

## Links

- [GitHub Repository](https://github.com/hyperdev-io/cli)
- [Documentation](https://hyperdev.io/docs)
- [Migration Guide](https://hyperdev.io/docs/migrating-from-hypergen)

## Version History

- **9.0.0** - Deprecation release (redirects to @hypercli/cli)
- **8.0.0** - Last functional release before split
