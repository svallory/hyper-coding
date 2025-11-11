# @hyper/plugin-tools

> HyperDev tools plugin - Swiss army knife for configuring development tools for AI agents

## Overview

The `@hyper/plugin-tools` package is an oclif plugin that adds the `tools` subcommands to the `hyper` CLI. It provides a comprehensive configuration utility for setting up and managing development tools that enhance AI agent capabilities.

## Purpose

This plugin automates the laborious task of setting up and configuring all the tools for your project, giving AI agents the same advantages that developers have through IDE integrations and automated tooling. It enables agents to access external capabilities for real-time validation of generated code against project standards before deployment.

## Installation

As an oclif plugin, this package is designed to be installed as part of the main `hyper` CLI:

```bash
# Install the hyper CLI (includes this plugin)
npm install -g @hyper/cli

# Or install the plugin separately
hyper plugins:install @hyper/plugin-tools
```

## Commands

### `hyper tools`

Main command that displays available tool categories and usage information.

### `hyper tools:ai`

Configure AI integration tools including:
- MCP servers (Model Context Protocol)
- Agent definitions
- Claude Code commands

**Flags:**
- `--list, -l` - List available AI integration tools
- `--install <tool>, -i` - Install a specific AI tool
- `--configure, -c` - Configure AI tools for the project
- `--all, -a` - Apply action to all AI tools
- `--status, -s` - Show status of installed AI tools

**Examples:**
```bash
hyper tools:ai --list
hyper tools:ai --install mcp-server-git
hyper tools:ai --configure --all
```

### `hyper tools:security`

Configure security tools including:
- Dependency scanners (Snyk, npm-audit, Dependabot)
- Secret scanners (Gitleaks, TruffleHog)
- SAST tools (Semgrep, SonarQube)

**Flags:**
- `--list, -l` - List available security tools
- `--install <tool>, -i` - Install a specific security tool
- `--scan` - Run security scans on the project
- `--configure, -c` - Configure security tools
- `--all, -a` - Apply action to all security tools
- `--status, -s` - Show status of security tools

**Examples:**
```bash
hyper tools:security --list
hyper tools:security --install snyk
hyper tools:security --scan
```

### `hyper tools:quality`

Configure code quality tools including:
- Linters (ESLint, Pylint, RuboCop)
- Formatters (Prettier, Black)
- Type checkers (TypeScript, MyPy)
- Test frameworks (Vitest, Jest, Pytest, Playwright)
- Coverage tools (c8, Istanbul)
- CI/CD pipelines (GitHub Actions, GitLab CI)

**Flags:**
- `--list, -l` - List available code quality tools
- `--install <tool>, -i` - Install a specific quality tool
- `--configure, -c` - Configure quality tools
- `--all, -a` - Apply action to all quality tools
- `--status, -s` - Show status of quality tools

**Examples:**
```bash
hyper tools:quality --list
hyper tools:quality --install eslint
hyper tools:quality --configure --all
```

### `hyper tools:architecture`

Configure architecture tools including:
- Complexity scanners (complexity-report, radon)
- Architecture testing (TSArch, PyTestArch, ArchUnit)
- Plan adherence monitors
- ADR tools (adr-tools, log4brains)

**Flags:**
- `--list, -l` - List available architecture tools
- `--install <tool>, -i` - Install a specific architecture tool
- `--configure, -c` - Configure architecture tools
- `--analyze` - Run architecture analysis
- `--all, -a` - Apply action to all architecture tools
- `--status, -s` - Show status of architecture tools

**Examples:**
```bash
hyper tools:architecture --list
hyper tools:architecture --install tsarch
hyper tools:architecture --analyze
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- Bun package manager

### Setup

```bash
# Install dependencies
bun install

# Build the package
bun run build

# Run in development mode
bun run dev

# Run tests
bun run test

# Watch mode for tests
bun run test:watch
```

### Moon Build System

This package is part of a moonrepo monorepo. You can use moon commands:

```bash
# Build this package
moon run hyper-plugin-tools:build

# Run tests
moon run hyper-plugin-tools:test

# Lint code
moon run hyper-plugin-tools:lint
```

## Architecture

The plugin follows oclif's command structure:

```
src/
├── index.ts                    # Main export file
└── commands/
    └── tools/
        ├── index.ts           # Main tools command
        ├── ai.ts              # AI integration tools
        ├── security.ts        # Security tools
        ├── quality.ts         # Code quality tools
        └── architecture.ts    # Architecture tools
```

Each command category is implemented as a separate oclif command with its own flags and functionality.

## Topics

The plugin defines several oclif topics for organizing commands:

- `tools` - Main topic for all tool commands
- `tools:ai` - AI integration tools
- `tools:security` - Security tools
- `tools:quality` - Code quality tools
- `tools:architecture` - Architecture tools

## Contributing

This package is part of the HyperDev monorepo. Contributions should follow the project's coding standards and use conventional commit messages.

## License

MIT

## Links

- [Documentation](https://hyper-coding.saulo.engineer)
- [GitHub Repository](https://github.com/hyperdev/hyper-coding)
- [Issue Tracker](https://github.com/hyperdev/hyper-coding/issues)
