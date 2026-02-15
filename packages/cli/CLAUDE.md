# @hypercli/cli

HyperDev CLI - thin oclif shell that composes gen and kit plugins into the unified `hyper` command.

## Purpose

This package provides the `hyper` binary and acts as a **plugin host**. It loads @hypercli/gen and @hypercli/kit as oclif plugins, creating a unified CLI experience. This package contains minimal code - just the shell, base command, and binary entry points.

## What's Inside

### Binary Entry Points (`bin/`)

- **bin/run.js** - Production entry point for `hyper` command
- **bin/dev.js** - Development entry point (for local testing)

### Base Command (`src/base-command.ts`)

CoreBaseCommand extends oclif Command and provides:
- Configuration loading (hyper.config.js via cosmiconfig)
- Logger initialization
- Base flags shared by all commands:
  - `--config` - Custom config file path
  - `--debug` - Enable debug logging
  - `--cwd` - Set working directory

All other commands (in gen and kit) extend CoreBaseCommand.

### CLI Configuration

The package.json oclif config defines the plugin composition:

```json
{
  "oclif": {
    "bin": "hyper",
    "plugins": [
      "@hypercli/gen",
      "@hypercli/kit",
      "@oclif/plugin-help"
    ],
    "topicSeparator": " "
  }
}
```

## Command Routing

CLI delegates all commands to plugins:

| Command | Routed To |
|---------|-----------|
| `hyper kit install` | @hypercli/kit plugin |
| `hyper kit list` | @hypercli/kit plugin |
| `hyper run nextjs crud` | @hypercli/gen plugin |
| `hyper gen nextjs crud` | @hypercli/gen plugin (alias) |
| `hyper nextjs crud` | @hypercli/gen plugin (via command_not_found hook) |
| `hyper recipe list` | @hypercli/gen plugin |
| `hyper cookbook run` | @hypercli/gen plugin |
| `hyper config show` | @hypercli/cli directly (future) |
| `hyper --version` | @hypercli/cli directly |
| `hyper --help` | @oclif/plugin-help |

## BaseCommand Hierarchy

```
oclif Command (from @oclif/core)
  └─ CoreBaseCommand (@hypercli/cli)
       ├─ GenBaseCommand (@hypercli/gen) — adds recipe engine, template system
       └─ KitBaseCommand (@hypercli/kit) — kit-specific utilities
```

- **CoreBaseCommand** - Config, logger, base flags
- **GenBaseCommand** - Recipe engine, Jig, tools, actions, AI
- **KitBaseCommand** - Kit manifest loading, source resolution

## Dependencies

- **@hypercli/core** - Types, config, errors, utilities
- **@hypercli/gen** - Generation engine plugin
- **@hypercli/kit** - Kit management plugin
- **@oclif/core** (peer) - CLI framework
- **@oclif/plugin-help** (peer) - Help system

## How It Works

1. User runs `hyper <command>`
2. oclif loads CLI package
3. oclif discovers and loads plugins (gen, kit)
4. oclif matches command to plugin
5. Plugin command executes with CoreBaseCommand context

## Development

```bash
# From packages/cli/
bun install
bun run build

# Link locally for testing
cd /work/hyper/packages/cli
npm link
hyper --version

# Or use bin/dev.js directly
./bin/dev.js --help
```

## Testing

```bash
bun test              # Run tests
bun test:watch        # Watch mode
```

Currently no tests exist - tests need to be created for:
- Plugin loading
- Command routing
- Config loading
- Base flags
- Error handling

## Build

```bash
bun install
bun run build       # Builds to dist/
bun run typecheck   # TypeScript validation
```

Note: DTS generation is disabled due to inflection types incompatibility.

## Future Commands

Planned commands to be implemented directly in CLI (not plugins):

- `hyper config show` - Show effective configuration
- `hyper config set <key> <value>` - Update configuration
- `hyper config init` - Initialize hyper.config.js
- `hyper system info` - System diagnostics
- `hyper system doctor` - Health checks

## Architecture Notes

- **Thin shell** - Minimal code, delegates to plugins
- **Plugin composition** - oclif discovers and loads gen/kit automatically
- **Single binary** - One `hyper` command for all operations
- **Shared base** - CoreBaseCommand provides common functionality
- **Future extensibility** - Easy to add more plugins or direct commands
- **No generation logic** - Generation engine lives entirely in @hypercli/gen
- **No kit logic** - Kit management lives entirely in @hypercli/kit

## Package Structure

```
packages/cli/
├── bin/
│   ├── run.js           # Production entry
│   └── dev.js           # Development entry
├── src/
│   ├── base-command.ts  # CoreBaseCommand
│   └── index.ts         # Exports
├── tests/               # TODO: Create tests
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── CLAUDE.md
```

The CLI package is intentionally minimal - it's just the shell that orchestrates the plugins.
