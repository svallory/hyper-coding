# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

HyperDev is a monorepo for **Hypergen** — a modern, scalable code generator with AI integration, built with TypeScript. It uses a multi-package architecture with oclif for CLI plugin composition.

## Package Architecture

```
@hypercli/cli  ──→  @hypercli/gen  ──→  @hypercli/kit  ──→  @hypercli/core
```

| Package | Folder | Purpose |
|---------|--------|---------|
| `@hypercli/core` | `packages/core/` | Types, config, errors, parsers, utils. No runtime deps on other packages. |
| `@hypercli/kit` | `packages/kit/` | Kit lifecycle, source resolution. oclif plugin. |
| `@hypercli/gen` | `packages/gen/` | Recipe engine, Jig templates, AI 2-pass, actions. oclif plugin. |
| `@hypercli/cli` | `packages/cli/` | Thin shell, plugin host. Provides `hyper` binary. |
| `hypergen` | `packages/hypergen/` | **DEPRECATED** — being replaced by the packages above. |

Dependencies flow strictly left-to-right. No circular deps.

## Monorepo Structure

```
hyperdev/
├── .moon/                    # Moon build system configuration
├── apps/
│   └── docs/                 # Mintlify documentation site
├── packages/
│   ├── core/                 # @hypercli/core
│   ├── kit/                  # @hypercli/kit
│   ├── gen/                  # @hypercli/gen
│   ├── cli/                  # @hypercli/cli
│   └── hypergen/             # DEPRECATED
├── hyper-kits/
│   └── nextjs/               # Next.js kit (git submodule)
├── agent/reports/            # AI agent work reports
└── .taskmaster/              # Task Master AI integration
```

## Essential Commands

### Package Management
- **Always use `bun`** — never npm
- `bun install` — install all workspace dependencies

### Building & Testing
```bash
# Moon (all projects)
moon check --all                    # Build, lint, test, format, typecheck
moon run :build                     # Build all
moon run :test                      # Test all
moon run <project>:<task>           # e.g. moon run core:test

# Per-package (from package dir)
bun run build                       # Build with tsup
bun test                            # Run tests
bun test --watch                    # Watch mode
```

### Key Technologies
- **Template engine**: Jig (Edge.js fork) — `.jig` files, NOT EJS
- **CLI framework**: oclif with plugin architecture
- **Build**: tsup (ESM, node20 target)
- **Test**: vitest (compatible with bun test)
- **Monorepo**: bun workspaces + moon

## How the CLI Works

CLI is a thin oclif shell that loads gen and kit as plugins:
- `hyper kit install` → routed to @hypercli/kit
- `hyper run nextjs crud` → routed to @hypercli/gen
- `hyper nextjs crud list` → gen's `command_not_found` hook rewrites to `hyper run`
- `hyper config show` → handled by @hypercli/cli directly

**BaseCommand hierarchy**: oclif Command → CoreBaseCommand (cli) → GenBaseCommand (gen)

## Template System

Templates use **Jig** (Edge.js fork), NOT EJS:
- Files: `.jig` extension
- Syntax: `{{ variable }}`, `@if()/@end`, `@each()/@end`, `@let(x = expr)`
- Filters: `{{ camelCase :: name }}`
- Custom `@ai` tag for 2-pass AI generation
- YAML frontmatter with `to:`, `inject:`, `when:`, `after:` fields

## Recipe Engine

Recipes are YAML workflows with steps. 13 tool types: template, action, recipe, shell, prompt, ai, install, query, patch, ensure-dirs, sequence, parallel, conditional.

Key features:
- Topological sort for dependency resolution
- Parallel execution batches
- Step output piping via `exports` field
- `onSuccess`/`onError` message templates
- `install` tool auto-detects package manager

## Git Conventions

Commits follow conventional commit format:
```bash
git commit -m "feat(core): add new parser for cookbook.yml"
git commit -m "fix(gen): resolve template variable collision"
```

## Error Messages & User Experience

Use friendly, conversational language for error messages and user-facing output:

**Good:**
- "Uh oh! I couldn't find any command or hyper kit named `iniit`. Did you mean `init`?"
- "Here are the available commands and kits"

**Avoid:**
- "Unknown command"
- "Command not found"
- Dry, technical jargon

**Command Styling:**
- Use `styleCommand()` from `@hypercli/core/ui` to highlight commands consistently
- Commands are styled with hex color #4EC9B0 (matching the cli-html theme)
- Examples: `styleCommand("hyper init")`, `styleCommand("nextjs")`

**Message Types:**
- Use `error()` for actual errors (things that went wrong)
- Use `tip()` for helpful information (suggestions, available options)
- Use `warning()` for cautions (things that might cause issues)
- Use `success()` for confirmations (things that worked)
- Use `info()` for neutral information

## Important Notes

- `hyper-kits/nextjs/` is a **git submodule** — the only submodule in the repo
- The packages under `packages/` are NOT submodules — regular monorepo directories
- Tests live in each package's `tests/` directory
- TypeScript strict mode is disabled (to be re-enabled incrementally)
- DTS generation is disabled (inflection types issue — to be fixed)

---

# Mintlify Documentation Standards

**For the main HyperDev documentation site in `apps/docs/`**

## Working relationship
- Push back on ideas when warranted — cite sources and explain reasoning
- ALWAYS ask for clarification rather than making assumptions
- NEVER lie, guess, or make up information

## Project context
- Format: MDX files with YAML frontmatter
- Config: `apps/docs/docs.json` for navigation, theme, settings
- Dev server: `cd apps/docs && mintlify dev`

## Content strategy
- Document just enough for user success
- Prioritize accuracy and usability
- Search for existing content before adding new — avoid duplication
- Check existing patterns for consistency

## Writing standards
- Second-person voice ("you")
- Prerequisites at start of procedural content
- Test all code examples before publishing
- Language tags on all code blocks
- Alt text on all images
- Relative paths for internal links
- Frontmatter required: `title` and `description`

## Git workflow
- NEVER use --no-verify when committing
- NEVER skip or disable pre-commit hooks
- Create a new branch when no clear branch exists
- Commit frequently
