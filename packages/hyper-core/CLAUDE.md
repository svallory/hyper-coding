# @hypercli/core

Core domain types, configuration system, errors, and utilities for HyperDev.

## Purpose

This package provides the foundational types and systems used by all other HyperDev packages. It contains NO CLI commands and NO runtime execution code - only types, configuration loading, error handling, and utilities.

## What's Inside

### Types (`src/types/`)
- **kit.ts** - Kit and Cookbook configuration types
- **template.ts** - Template variable and configuration types
- **recipe.ts** - Complete recipe domain model (RecipeConfig, all step types, 28KB)
- **actions.ts** - Action metadata and context types
- **ai-config.ts** - AI service configuration types
- **common.ts** - Logger, Prompter, and other shared types

### Error System (`src/errors/`)
- **hypergen-errors.ts** - Complete error system with 83 error codes
  - HypergenError class with context and suggestions
  - ErrorHandler class with specialized error creators
  - Error codes cover: config, templates, actions, codemods, file ops, discovery, URL resolution, network, AI

### Configuration (`src/config/`)
- **config-loader.ts** - HypergenConfigLoader with cosmiconfig
  - Loads hypergen.config.js from project root
  - Callback pattern for helper registration: `onHelpersLoaded(helpers, source)`
  - No dependency on Jig template engine
- **load-helpers.ts** - Shared helper loading utility

### Parsers (`src/parsers/`)
- **kit-parser.ts** - Parse kit.yml files
- **cookbook-parser.ts** - Parse cookbook.yml files
- **template-parser.ts** - Parse template.yml files (41KB)
- **path-resolver.ts** - Resolve recipe paths (greedy matching algorithm)

### Utilities (`src/utils/`)
- **find-project-root.ts** - Find project root and kits directory
- **newline.ts** - Platform-aware newline utility
- **helpers.ts** - capitalize, inflection, changeCase helpers
- **constants.ts** - HYPERGEN_VERSION, DEFAULT_ACTION, etc.

### Logger (`src/logger/`)
- **logger.ts** - Chalk-based colored console output
- **types.ts** - ActionLogger and ExtendedLogger interfaces

## Dependencies

- **chalk** - Terminal colors
- **debug** - Debug logging
- **inflection** - String inflection utilities
- **change-case** - Case conversion utilities
- **cosmiconfig** - Configuration file loading

## Usage by Other Packages

All HyperDev packages depend on core:

```typescript
import {
  // Types
  KitConfig, CookbookConfig, RecipeConfig,
  TemplateVariable, TemplateConfig,
  ActionMetadata, ActionContext,

  // Errors
  HypergenError, ErrorHandler, ErrorCode,

  // Config
  HypergenConfigLoader,

  // Parsers
  parseKitConfig, parseCookbookConfig, parseTemplateConfig,

  // Utilities
  findProjectRoot, getKitsDirectory,
  Logger, helpers, constants
} from '@hypercli/core'
```

## Build

```bash
bun install
bun run build       # Builds to dist/
bun run typecheck   # TypeScript validation
```

Note: DTS generation is disabled due to inflection types incompatibility. The package builds successfully without type declarations.

## Architecture Notes

- **No Jig dependency** - Core doesn't depend on the template engine
- **Callback pattern** - Config/parsers return loaded helpers for consumers to register
- **Self-contained errors** - Error system has no external dependencies
- **Type-only exports** - Many exports are pure types with no runtime code
