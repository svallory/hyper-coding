# Hyper CLI Multi-Package Refactoring Plan

## Context

Hypergen is a monolithic ~112-file, ~32K LOC TypeScript CLI at `packages/hypergen/`. The future vision for HyperDev includes 5+ top-level commands (`gen`, `tools`, `plan`, `watch`, `dash`) that have different concerns, dependencies, and release cadences. The current architecture cannot support this — every command lives in one package, every contributor must understand the full codebase, and there's no plugin boundary for new commands.

**Goals:**
1. Enable independent evolution of commands as separate oclif plugins
2. Reduce cognitive load through clear package boundaries
3. Establish `@hypercli/core` as a stable foundation for all future packages

**Approach:** Split into 4 packages in a monorepo (no git submodules), with future packages (tools, plan, watch, dash) added as oclif plugins when needed. The original `hypergen` npm package gets a final deprecation-only release pointing users to `@hypercli/cli`.

---

## Package Architecture

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

---

## Phase 0: Preparation

**Goal:** Set up package infrastructure in the monorepo. Zero code changes to hypergen. All 958 tests pass.

### Steps

0.1. **Write ITD** at `dev-notes/itd-multi-package-split.md` (see ITD section at bottom)

0.2. **Scaffold packages** using our oss recipe:
```bash
bun run hypergen run oss project npm-pkg --dir=packages/core --projectName="@hypercli/core" --description="Core domain types, config, errors for HyperDev" --buildTool=tsup
bun run hypergen run oss project npm-pkg --dir=packages/hyper-kits --projectName="@hypercli/kit" --description="Kit lifecycle management for HyperDev" --buildTool=tsup
bun run hypergen run oss project npm-pkg --dir=packages/gen --projectName="@hypercli/gen" --description="Code generation engine for HyperDev" --buildTool=tsup
bun run hypergen run oss project npm-pkg --dir=packages/cli --projectName="@hypercli/cli" --description="HyperDev CLI" --buildTool=tsup
```

0.3. **Configure bun workspaces** in root `package.json` to include the new packages for cross-references during development.

0.4. **Add moon.yml** to each package with appropriate `type`, `language`, `platform`, and `tags`.

0.5. **Verify:** `bun test` in `packages/hypergen` — all 958 tests still pass.

---

## Phase 1: Extract `@hypercli/core`

**Goal:** Move domain types, error system, config loader, and parsers to core. Hypergen depends on core and re-exports via shims (strangler fig pattern).

This is the hardest phase — deepest import graph rewiring.

### Target structure
```
packages/core/src/
  types/
    kit.ts              # KitConfig, CookbookConfig (from config/types.ts)
    template.ts         # TemplateVariable, TemplateConfig (from config/template-parser.ts)
    recipe.ts           # RecipeConfig, all step types, RecipeStepUnion (from recipe-engine/types.ts)
    actions.ts          # ActionMetadata, ActionContext, ActionResult (from actions/types.ts)
    ai-config.ts        # AI config interfaces (from ai/ai-config.ts)
    common.ts           # Logger interface, Prompter, RenderedAction, RunnerConfig
    index.ts
  errors/
    hypergen-errors.ts  # ErrorCode, HypergenError, ErrorHandler
  config/
    config-loader.ts    # HypergenConfigLoader (cosmiconfig, NO jig-engine dep)
    load-helpers.ts
  parsers/
    kit-parser.ts
    cookbook-parser.ts
    template-parser.ts  # TemplateParser class
    path-resolver.ts
  logger/
    logger.ts
  utils/
    find-project-root.ts
    newline.ts
  helpers.ts
  constants.ts
  index.ts
```

### Key design decisions

**Decoupling `registerHelpers`:** Currently `kit-parser.ts`, `cookbook-parser.ts`, and `hypergen-config.ts` all import `registerHelpers` from `jig-engine.ts`. When they move to `@hypercli/core`, they can't depend on Jig.

Solution:
- Parsers return loaded helpers in their result objects (e.g., `ParsedKit.loadedHelpers`)
- Config loader accepts optional `onHelpersLoaded?: (helpers: Record<string, Function>, source: string) => void` callback
- `@hypercli/gen` passes `registerHelpers` as that callback when initializing

**Type extraction from `recipe-engine/types.ts`:** This 1285-line file defines the entire recipe domain model. ALL type definitions (interfaces, enums, type aliases, type guards) move to `@hypercli/core/src/types/recipe.ts`. Runtime implementations stay in `@hypercli/gen`.

### Steps

1.1. Copy type files to core with reorganized structure (see above)
1.2. Implement the `onHelpersLoaded` callback pattern in config-loader and parsers
1.3. Update `packages/hypergen` to depend on `@hypercli/core` via `"workspace:*"`
1.4. Create re-export shims in hypergen (old import paths delegate to `@hypercli/core`)
1.5. Migrate relevant tests to `@hypercli/core`
1.6. **Verify:** `bun test` passes in BOTH `packages/core` AND `packages/hypergen`

### Critical files to modify in hypergen
- `src/recipe-engine/types.ts` → split types out, keep re-exports
- `src/config/template-parser.ts` → split types from parser class
- `src/config/hypergen-config.ts` → remove jig-engine import
- `src/config/kit-parser.ts` → remove registerHelpers import
- `src/config/cookbook-parser.ts` → remove registerHelpers import
- `src/errors/hypergen-errors.ts` → move to core
- `src/types.ts` → move to core
- `src/logger.ts` → move to core

---

## Phase 2: Extract `@hypercli/kit`

**Goal:** Extract kit lifecycle management. Small, contained extraction.

### Target structure
```
packages/hyper-kits/src/
  manifest.ts           # from lib/kit/manifest.ts
  source-resolver.ts    # from lib/kit/source-resolver.ts
  url-resolution/       # from config/url-resolution/ (entire directory)
  commands/
    kit/
      install.ts
      update.ts
      list.ts
      info.ts
  index.ts
```

### Steps

2.1. Copy files to `@hypercli/kit`
2.2. Update imports to use `@hypercli/core` for domain types
2.3. Configure as oclif plugin (kit commands live here)
2.4. Create re-export shims in hypergen
2.5. Write/migrate tests
2.6. **Verify:** All tests pass across core, kits, hypergen

---

## Phase 3: Extract `@hypercli/gen`

**Goal:** Extract the generation engine — recipe engine, template engine, AI, actions, ops, discovery, and gen-related commands.

### Target structure
```
packages/gen/src/
  recipe-engine/        # engine, step-executor, group-executor, output-evaluator
  recipe-engine/tools/  # all 13 tools, registry, base
  template-engines/     # jig-engine.ts, ai-tags.ts
  ai/                   # all 17 files
  actions/              # all 8 files
  ops/                  # add.ts, inject.ts
  prompts/              # interactive-prompts.ts
  discovery/            # generator-discovery.ts
  commands/
    run.ts
    recipe/             # run, list, info, validate
    cookbook/            # info, list
  hooks/
    command-not-found.ts
  lib/
    gen-base-command.ts # extends CoreBaseCommand, adds recipe engine + discovery
  index.ts
```

### Key design decisions

**Circular dependency (template-engines ↔ ai):** Both live in `@hypercli/gen`, so this is internal-only. Fix with dependency injection: `PromptAssembler` takes a `renderFn` parameter instead of importing `renderTemplateSync` directly.

**BaseCommand split:**
- `CoreBaseCommand` in `@hypercli/cli`: loads config, sets up logger, parses base flags
- `GenBaseCommand` in `@hypercli/gen`: extends CoreBaseCommand, adds recipe engine, discovery, tools
- Kit commands in `@hypercli/kit` use CoreBaseCommand directly

**Helper registration wiring:** `@hypercli/gen` initializes Jig on startup. When loading kits/config, it passes `registerHelpers` as the callback to `@hypercli/core`'s parsers.

### Steps

3.1. Copy files to `@hypercli/gen`
3.2. Fix circular dependency with DI pattern
3.3. Configure as oclif plugin (package.json oclif section)
3.4. Create `GenBaseCommand` extending CoreBaseCommand from cli
3.5. Wire helper registration callback
3.6. Migrate bulk of test suite (recipe engine, tools, AI, actions, template engine, E2E)
3.7. **Verify:** All tests pass across all packages

---

## Phase 4: Extract `@hypercli/cli`

**Goal:** Create the thin shell with `hyper` binary.

### Target structure
```
packages/cli/
  bin/
    run.js
    dev.js
  src/
    commands/
      config/init.ts, show.ts, validate.ts
      system/status.ts, version.ts
      init.ts
    lib/
      core-base-command.ts  # slim base: config + logger + base flags
      colors.ts
      styles.ts
      flags.ts
    index.ts
  package.json            # oclif.plugins: ["@hypercli/gen", "@hypercli/kit", "@oclif/plugin-help"]
```

### oclif plugin config
```json
{
  "name": "@hypercli/cli",
  "bin": { "hyper": "./bin/run.js" },
  "oclif": {
    "bin": "hyper",
    "dirname": "hyper",
    "commands": "./dist/commands",
    "plugins": ["@hypercli/gen", "@hypercli/kit", "@oclif/plugin-help"],
    "topics": {
      "kit": { "description": "Manage kits" },
      "cookbook": { "description": "Manage cookbooks" },
      "recipe": { "description": "Work with recipes" },
      "config": { "description": "Configuration management" },
      "system": { "description": "System information" }
    },
    "topicSeparator": " "
  }
}
```

### Steps

4.1. Set up package with oclif plugin loading
4.2. Move config/system/init commands
4.3. Create `CoreBaseCommand` (slim: config + logger + base flags only)
4.4. Binary: `hyper` primary
4.5. Write tests
4.6. **Verify:** `hyper nextjs crud update Org` works end-to-end via oclif plugin loading

---

## Phase 5: Deprecate Hypergen

**Goal:** Publish final `hypergen` version that tells users to switch to `@hypercli/cli`.

### Steps

5.1. Strip `packages/hypergen` to a minimal package:
   - `package.json` with `postinstall` script that prints colored migration notice
   - No source code, no commands
   - Points users to `@hypercli/cli`

5.2. Publish as `hypergen@9.0.0` (major bump)

5.3. Run `npm deprecate hypergen "This package has moved to @hypercli/cli"` on all versions

5.4. New packages start at `1.0.0`

---

## Phase 6: Cleanup & Documentation

6.1. Remove hypergen source code (package is now deprecation-only)
6.2. Update Mintlify docs site at `apps/docs/`
6.3. Write CLAUDE.md for each new package
6.4. Update CI/CD workflows for independent package releases
6.5. Update moon workspace config

---

## Verification Strategy

Each phase must pass:
1. `bun test` in the extracted package
2. `bun test` in `packages/hypergen` (strangler fig shims keep existing tests working until Phase 5)
3. End-to-end: `bun run hypergen run nextjs crud list-page` generates correct output
4. After Phase 4: `hyper nextjs crud list-page` works via oclif plugin loading

---

## ITD (to be written to `dev-notes/itd-multi-package-split.md`)

### Decision: Split hypergen into @hypercli/core, @hypercli/kit, @hypercli/gen, and @hypercli/cli

**Status:** Accepted

**Context:** The HyperDev vision includes 5+ top-level commands (gen, tools, plan, watch, dash) with different concerns and release cadences. A monolithic 32K LOC package cannot scale. We need oclif plugin architecture to enable independent command packages.

**Decision:** Extract the monolith into 4 packages with a strict dependency DAG:
- `@hypercli/core` — domain types, config, errors, logger, parsers
- `@hypercli/kit` — kit lifecycle management (oclif plugin with kit commands)
- `@hypercli/gen` — recipe/template/AI engine (oclif plugin with gen commands)
- `@hypercli/cli` — thin shell, plugin host, config/system commands

**Rule for the split:**
- **npm package** = different user-facing command, different concern, potentially different release cadence
- Domain entities (Kit, Cookbook, Recipe) live in core as the single source of truth
- Kit lifecycle is separate from code generation because they have different dependencies and evolution rates

**Rationale:**
- npm packages per command = independent evolution and release cycles
- `@hypercli/core` as stable foundation = clear dependency direction, no cross-package circular deps
- oclif plugin architecture = future commands (tools, plan, watch, dash) plug in without touching existing packages
- Kit lifecycle in own package = different dependencies (degit, registry clients) from generation engine
- Monorepo without submodules = simpler development workflow during extraction

**Alternatives rejected:**
1. Keep monolith, use TS project references only — doesn't enable oclif plugin architecture
2. Split into 2 packages (core + cli) — kits and gen have different evolution rates and consumers
3. Split into 6+ packages including config and help separately — config is too intertwined with core, help is a utility not a concern
4. Git submodules for each package — unnecessary complexity during extraction; can add later

**Hypergen deprecation strategy:**
- Publish `hypergen@9.0.0` with postinstall deprecation notice
- Run `npm deprecate` on all versions
- No facade/re-exports — clean break

**Consequences:**
- Build pipeline complexity increases (4 packages to build/test/publish), mitigated by moonrepo caching
- Cross-package type sharing requires careful API design in core
- `registerHelpers` coupling resolved via callback injection pattern
- BaseCommand splits into CoreBaseCommand (cli) and GenBaseCommand (gen)
