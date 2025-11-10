# Oclif Migration Guide

This document explains the oclif migration for Hypergen and how it works in both standalone and plugin modes.

## Overview

Hypergen has been migrated to use [oclif](https://oclif.io/), a framework for building CLIs in Node.js. This migration enables two modes of operation:

1. **Standalone Mode**: The traditional `hypergen` command
2. **Plugin Mode**: Integration with the future `hyper` CLI as the `gen` subcommand

## Architecture

### Standalone Mode

When installed as a standalone package:

```bash
npm install -g hypergen
hypergen init                    # Initialize project
hypergen starlight create        # Run cookbook recipe
hypergen list                    # List available actions
hypergen discover                # Discover cookbooks
```

### Plugin Mode

When installed as a plugin in the future `hyper` CLI:

```bash
hyper plugins install hypergen
hyper gen init                       # Maps to hypergen init
hyper gen starlight create           # Maps to hypergen starlight create
hyper gen list                       # Maps to hypergen list
```

The `gen` prefix is automatically added by oclif's plugin system when hypergen is loaded as a plugin.

## New Taxonomy

Hypergen uses a cookbook/recipe model instead of the old generator concept:

- **Cookbooks**: Collections of recipes focused on a specific tool or scenario (e.g., @hyper-kits/starlight)
- **Recipes**: Specific processes that modify your codebase (e.g., create, add/page)
- **Tools**: Template, Action, and CodeMod engines that power recipe steps
- **Kits**: Shareable bundles containing cookbooks and related assets

## Command Structure

### Core Commands

- `hypergen init` - Initialize Hypergen in current project (finds root package.json, handles monorepos)
- `hypergen discover` - Discover available cookbooks from all sources
- `hypergen list` - List available actions/recipes
- `hypergen info <action>` - Show detailed information
- `hypergen config` - Manage configuration (with subcommands)

### Cookbook Invocation

The CLI supports flexible cookbook invocation:

```bash
# Explicit cookbook command
hypergen cookbook starlight create

# Direct invocation (recommended)
hypergen starlight create

# With recipe and variables
hypergen starlight add page --title="Getting Started"

# Built-in cookbook
hypergen cookbook default
hypergen cookbook recipe --name=MyComponent
```

When you run `hypergen COOKBOOK [RECIPE]` and COOKBOOK is not a recognized command, Hypergen automatically:
1. Treats COOKBOOK as a cookbook name
2. Treats RECIPE (if present) as the recipe name
3. Routes to the cookbook execution engine

This is handled by the `command_not_found` hook.

## Configuration

The oclif configuration in `package.json`:

```json
{
  "oclif": {
    "bin": "hypergen",
    "dirname": "hypergen",
    "commands": "./dist/oclif-commands",
    "hooks": {
      "command_not_found": "./dist/oclif-commands/hooks/command-not-found"
    },
    "plugins": [
      "@oclif/plugin-help",
      "@oclif/plugin-plugins"
    ],
    "topicSeparator": ":",
    "topics": {
      "config": {
        "description": "Manage configuration"
      }
    }
  }
}
```

### Key Configuration Points

- **bin**: The command name for standalone mode
- **commands**: Directory containing command classes
- **hooks**: Custom hooks for command routing (enables COOKBOOK pattern)
- **topicSeparator**: Uses `:` for subcommands (e.g., `config:show`)
- **plugins**: Built-in plugins for help and plugin management

## Development Workflow

### Building

```bash
bun run build:lib  # Compile TypeScript to dist/
```

### Testing Standalone Mode

```bash
node dist/bin-oclif.js --help
node dist/bin-oclif.js init
node dist/bin-oclif.js starlight create
```

### Adding New Commands

1. Create a new file in `src/oclif-commands/`
2. Extend the `Command` class from `@oclif/core`
3. Define `static description`, `flags`, and `args`
4. Implement the `run()` method
5. Build and test

Example:

```typescript
import { Command, Flags, Args } from '@oclif/core';

export default class MyCommand extends Command {
  static description = 'My command description';

  static flags = {
    help: Flags.help({ char: 'h' }),
    force: Flags.boolean({ char: 'f', description: 'Force operation' }),
  };

  static args = {
    name: Args.string({ required: true, description: 'Name of the item' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MyCommand);

    // Command implementation
    this.log(`Processing ${args.name}`);
  }
}
```

## Plugin Integration (Future)

When the `hyper` CLI is ready, hypergen will be installable as a plugin:

```bash
# Install hypergen as a plugin
hyper plugins install hypergen

# All hypergen commands become available under 'hyper gen'
hyper gen init
hyper gen starlight create
hyper gen list
```

The oclif plugin system automatically:
- Discovers commands from the plugin's `oclif.commands` directory
- Namespaces them under the plugin name (or custom topic)
- Provides consistent help and error handling
- Manages plugin lifecycle

## Benefits of Oclif

1. **Consistent CLI Experience**: Standard patterns for flags, args, and help
2. **Plugin System**: Easy integration with other oclif-based CLIs
3. **Auto-generated Help**: Help text generated from command metadata
4. **Type Safety**: Full TypeScript support with type inference
5. **Extensibility**: Easy to add new commands and hooks
6. **Flexible Routing**: Custom hooks enable dynamic command routing

## Migration Notes

- Original CLI structure in `src/cli/` is preserved for reference
- New oclif commands in `src/oclif-commands/` follow oclif patterns
- Removed `init:generator` and `init:workspace` (old generator concept)
- Replaced with cookbook/recipe model
- `hypergen init` now initializes the current project (no subcommands)
- Cookbook invocation via `hypergen COOKBOOK RECIPE` pattern

## Installation Note

After pulling these changes, run:
```bash
bun install
```

This will install the new oclif dependencies (@oclif/core, @oclif/plugin-help, @oclif/plugin-plugins).
