# PRD for oclif Refactoring

## Overview

This document outlines the plan to refactor the `hypergen` CLI from its current implementation to use the `oclif` framework. This will improve maintainability, extensibility, and provide a more standard CLI experience for users. It will also allow `hypergen` to function as a standalone CLI and as a plugin for a larger `hyper` CLI tool, under the `gen` subcommand.

## Core Features

- **Command Structure Refactoring**: All existing `hypergen` commands will be migrated to `oclif` command structure.
- **Standalone `hypergen` CLI**: The package will expose a `hypergen` executable.
- **`hyper` CLI Plugin**: The package will be structured to be a valid `oclif` plugin, allowing it to be integrated into a `hyper` CLI as the `gen` subcommand.
- **Argument and Flag Parsing**: Utilize `oclif`'s argument and flag parsing capabilities, replacing the current implementation.
- **Help Generation**: Use `oclif`'s automatic help generation for commands.
- **Plugin System Integration**: Ensure that hypergen's internal plugin system is compatible with the new oclif structure.

## User Experience

- The CLI commands, arguments, and flags should remain as consistent as possible with the current version to minimize disruption for existing users.
- Help messages will be improved and standardized thanks to `oclif`.
- Users will be able to install and use `hypergen` as a standalone tool or as part of the larger `hyper` ecosystem.

## Technical Architecture

- **Framework**: `oclif` (https://oclif.io/)
- **Language**: TypeScript
- **Command Structure**: Commands will be organized in the `src/commands` directory as per `oclif` conventions.
- **Existing Logic**: The core logic of `hypergen` (in `src/engine.ts`, `src/execute.ts`, etc.) will be preserved and called from the new `oclif` commands. The main effort will be in the `src/cli` directory and `bin.ts`.
- **Plugin configuration**: `package.json` will be updated to include the `oclif` section, defining it as a plugin for the `hyper` CLI.

## Development Roadmap

- **Phase 1: Initial Setup and Proof of Concept**
  - Install `oclif` as a dependency.
  - Create a single `oclif` command (e.g., `hypergen version`) to verify the setup.
  - Configure `package.json` for `oclif` and the `hypergen` executable.
- **Phase 2: Command Migration**
  - Migrate one existing command (e.g., `new`) to the `oclif` structure.
  - Refactor argument and flag parsing for that command.
  - Ensure the core `hypergen` logic is correctly invoked.
  - Test the migrated command thoroughly.
- **Phase 3: Full Migration**
  - Migrate all remaining commands to the `oclif` structure.
  - Refactor the entry point (`src/bin.ts`) to use the `oclif` runtime.
  - Remove old CLI handling code from `src/cli`.
- **Phase 4: Plugin Integration**
  - Configure `package.json` to make `hypergen` a plugin for `hyper`.
  - Test the integration with a mock `hyper` CLI.
- **Phase 5: Documentation and Cleanup**
  - Update `README.md` and other documentation to reflect the new CLI structure and usage.
  - Remove any dead code related to the old CLI implementation.

## Logical Dependency Chain

1. Setup `oclif` and create a basic command.
2. Migrate a simple command to establish the pattern.
3. Migrate the rest of the commands.
4. Integrate as a plugin.
5. Update documentation.

## Risks and Mitigations

- **Breaking Changes**: The refactoring might introduce subtle breaking changes.
  - **Mitigation**: A thorough testing plan, including integration tests, is needed. A beta release could be considered.
- **Complexity of `hypergen`'s internals**: Integrating `oclif` with `hypergen`'s existing context and execution flow might be complex.
  - **Mitigation**: Start with a small proof of concept and carefully refactor step-by-step.
- **Plugin integration with `hyper` CLI**: The `hyper` CLI is not part of this project, so integration testing will require a mock setup.
  - **Mitigation**: Create a separate test project that simulates the `hyper` CLI and installs `hypergen` as a plugin.

## Agents

This epic will require the following agents:

- **oclif-expert**: For the core refactoring to the `oclif` framework.
- **typescript-expert**: For general TypeScript development.
- **cli-design-expert**: For ensuring good CLI design principles are followed.
- **testing-expert**: To ensure the refactoring is well-tested.
