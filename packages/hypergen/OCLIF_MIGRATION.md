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
hypergen init:generator --name=my-generator
hypergen discover
hypergen list
```

### Plugin Mode

When installed as a plugin in the future `hyper` CLI:

```bash
hyper plugins install hypergen
hyper gen init:generator --name=my-generator  # Maps to hypergen init:generator
hyper gen discover                            # Maps to hypergen discover
hyper gen list                                # Maps to hypergen list
```

The `gen` prefix is automatically added by oclif's plugin system when hypergen is loaded as a plugin.

## Command Structure

All commands follow oclif conventions:

- **Commands**: Located in `src/oclif-commands/`
- **Topics**: Commands can be organized into topics (e.g., `init:generator`, `config:show`)
- **Flags**: Use oclif's `Flags` for consistent flag parsing
- **Args**: Use oclif's `Args` for positional arguments

### Available Commands

- `hypergen init` - Initialize workspace or generator (with subcommands)
  - `init:generator` - Create a new generator
  - `init:workspace` - Initialize a new workspace
- `hypergen discover` - Discover generators from all sources
- `hypergen list` - List available actions
- `hypergen info <action>` - Show detailed information about an action
- `hypergen config` - Manage configuration (with subcommands)

## Configuration

The oclif configuration in `package.json`:

```json
{
  "oclif": {
    "bin": "hypergen",
    "dirname": "hypergen",
    "commands": "./dist/oclif-commands",
    "plugins": [
      "@oclif/plugin-help",
      "@oclif/plugin-plugins"
    ],
    "topicSeparator": ":",
    "topics": {
      "init": {
        "description": "Initialize workspace or generator"
      },
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
- **topicSeparator**: Uses `:` for subcommands (e.g., `init:generator`)
- **plugins**: Built-in plugins for help and plugin management

## Development Workflow

### Building

```bash
bun run build:lib  # Compile TypeScript to dist/
```

### Testing Standalone Mode

```bash
node dist/bin-oclif.js --help
node dist/bin-oclif.js init:generator --help
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
hyper gen init:generator --name=my-generator
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
5. **Testing**: Built-in testing utilities for CLI commands
6. **Extensibility**: Easy to add new commands and plugins

## Migration Notes

- Original CLI structure in `src/cli/` is preserved for reference
- New oclif commands in `src/oclif-commands/` follow oclif patterns
- Functionality is maintained - only the CLI framework changed
- All existing features work in both standalone and plugin modes

## Installation Note

After pulling these changes, run:
```bash
bun install
```

This will install the new oclif dependencies (@oclif/core, @oclif/plugin-help, @oclif/plugin-plugins).
