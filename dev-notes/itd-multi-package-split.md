# ITD: Split hypergen into @hypercli/core, @hypercli/kit, @hypercli/gen, and @hypercli/cli

**Status:** Accepted
**Date:** 2026-02-14

## Context

The HyperDev vision includes 5+ top-level commands (gen, tools, plan, watch, dash) with different concerns and release cadences. A monolithic 32K LOC package cannot scale. We need oclif plugin architecture to enable independent command packages.

## Decision

Extract the monolith into 4 packages with a strict dependency DAG:

```
@hypercli/cli  ──→  @hypercli/gen  ──→  @hypercli/kit  ──→  @hypercli/core
      │                   │                                        ↑
      │                   └────────────────────────────────────────┘
      └────────────────────────────────────────────────────────────┘
```

| Package          | Type                   | Purpose                                                                                               |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `@hypercli/core` | npm pkg                | Domain entities (Kit, Cookbook, Recipe types), config schema/loader, parsers, errors, logger, helpers |
| `@hypercli/kit`  | npm pkg (oclif plugin) | Kit lifecycle: resolve, install, update, validate, manifest, source resolution. Kit commands.         |
| `@hypercli/gen`  | npm pkg (oclif plugin) | Recipe engine, tools, Jig template engine, AI integration, actions, ops, prompts, discovery           |
| `@hypercli/cli`  | npm pkg                | Thin shell (`hyper` binary), plugin host, config commands, system commands, help, `CoreBaseCommand`   |

## Rules for the Split

- **npm package** = different user-facing command, different concern, potentially different release cadence
- Domain entities (Kit, Cookbook, Recipe) live in core as the single source of truth
- Kit lifecycle is separate from code generation because they have different dependencies and evolution rates

## Rationale

- npm packages per command = independent evolution and release cycles
- `@hypercli/core` as stable foundation = clear dependency direction, no cross-package circular deps
- oclif plugin architecture = future commands (tools, plan, watch, dash) plug in without touching existing packages
- Kit lifecycle in own package = different dependencies (degit, registry clients) from generation engine
- Monorepo without submodules = simpler development workflow during extraction

## Alternatives Rejected

1. **Keep monolith, use TS project references only** — doesn't enable oclif plugin architecture
2. **Split into 2 packages (core + cli)** — kits and gen have different evolution rates and consumers
3. **Split into 6+ packages including config and help separately** — config is too intertwined with core, help is a utility not a concern
4. **Git submodules for each package** — unnecessary complexity during extraction; can add later

## Key Technical Decisions

### Helper Registration Decoupling

Parsers in `@hypercli/core` return loaded helpers in their result objects. Config loader accepts optional `onHelpersLoaded?: (helpers: Record<string, Function>, source: string) => void` callback. `@hypercli/gen` passes `registerHelpers` as that callback when initializing.

### BaseCommand Split

- `CoreBaseCommand` in `@hypercli/cli`: loads config, sets up logger, parses base flags
- `GenBaseCommand` in `@hypercli/gen`: extends CoreBaseCommand, adds recipe engine, discovery, tools
- Kit commands in `@hypercli/kit` use CoreBaseCommand directly

### Circular Dependency Resolution

`template-engines ↔ ai` both live in `@hypercli/gen`, so internal-only. Fix with DI: `PromptAssembler` takes a `renderFn` parameter instead of importing `renderTemplateSync` directly.

## Hypergen Deprecation Strategy

- Publish `hypergen@9.0.0` with postinstall deprecation notice
- Run `npm deprecate` on all versions
- No facade/re-exports — clean break
- New packages start at `1.0.0`

## Consequences

- Build pipeline complexity increases (4 packages to build/test/publish), mitigated by moonrepo caching
- Cross-package type sharing requires careful API design in core
- `registerHelpers` coupling resolved via callback injection pattern
- BaseCommand splits into CoreBaseCommand (cli) and GenBaseCommand (gen)
