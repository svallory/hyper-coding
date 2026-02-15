# Multi-Package Architecture Overview

## Dependency Architecture

```
@hypercli/cli  ──→  @hypercli/gen  ──→  @hypercli/kit  ──→  @hypercli/core
      │                   │                                        ↑
      │                   └────────────────────────────────────────┘
      └────────────────────────────────────────────────────────────┘
```

**Dependency Rules:**
- Core has NO dependencies on other packages
- Kits depends ONLY on core
- Gen depends on core + kits
- CLI depends on core + gen + kits (as oclif plugins)
- Strict unidirectional flow, no circular dependencies

## Package Summary

| Package          | Type              | Files | Size  | Purpose                                      |
| ---------------- | ----------------- | ----- | ----- | -------------------------------------------- |
| `@hypercli/core` | npm pkg           | 26    | 383KB | Domain types, config, errors, parsers, utils |
| `@hypercli/kit`  | oclif plugin      | 15    | -     | Kit lifecycle management                     |
| `@hypercli/gen`  | oclif plugin      | 68    | -     | Code generation engine                       |
| `@hypercli/cli`  | npm pkg + plugins | 2     | -     | Thin shell, plugin host                      |

**Total Extraction:** 111 TypeScript files from monolithic hypergen

## Rationale for 4-Package Split

### Why NOT 2 packages (core + cli)?
Kits and gen have different:
- Evolution rates (kit discovery vs generation features)
- Dependencies (degit/registry-clients vs Jig/AI libs)
- Consumer audiences (kit authors vs template authors)

### Why NOT 6+ packages?
Config is too intertwined with core types. Help is a utility not a concern. Splitting further would create excessive coordination overhead.

### Why separate kits from gen?
Kit lifecycle (install, update, manifest, source resolution) is orthogonal to code generation. Kit authors need kit APIs but not generation internals. Different release cadences.

## oclif Plugin Architecture

**CLI as Plugin Host:**
```json
{
  "oclif": {
    "bin": "hyper",
    "plugins": ["@hypercli/gen", "@hypercli/kit", "@oclif/plugin-help"],
    "commands": "./dist/commands"
  }
}
```

**Command Routing:**
- `hyper kit install` → routed to @hypercli/kit plugin
- `hyper run nextjs crud` → routed to @hypercli/gen plugin
- `hyper config show` → handled by @hypercli/cli directly
- `hyper --help` → @oclif/plugin-help

**Future Extensibility:**
Planned commands (tools, plan, watch, dash) will be added as additional oclif plugins without modifying existing packages.

## BaseCommand Hierarchy

```
Command (oclif base)
  ↓
CoreBaseCommand (@hypercli/cli)
  - Loads config
  - Sets up logger
  - Parses base flags: --config, --debug, --cwd
  - NO recipe engine, NO discovery, NO tools
  ↓
GenBaseCommand (@hypercli/gen)
  - Extends CoreBaseCommand
  - Adds recipe engine
  - Adds generator discovery
  - Adds tool registry
  - Used by: run, recipe, cookbook commands
```

**Kit commands** use CoreBaseCommand directly (no need for generation engine).

## Key Design Patterns

### 1. Helper Registration Callback Pattern
**Problem:** Config loader and parsers in core need to load helpers, but can't depend on Jig engine.

**Solution:**
```typescript
// In @hypercli/core
export interface ConfigLoaderOptions {
  onHelpersLoaded?: (helpers: Record<string, Function>, source: string) => void
}

// In @hypercli/gen (consumer)
const config = await HypergenConfigLoader.loadConfig(configPath, root, env, {
  onHelpersLoaded: (helpers, source) => {
    registerHelpers(helpers, source) // Jig registration happens in gen
  }
})
```

Parsers return `loadedHelpers` in their result objects. Consumer (gen) registers them with Jig.

### 2. Type Extraction Pattern
**Rule:** ALL type definitions (interfaces, enums, type aliases, type guards) extracted to core. Runtime implementations stay in original package.

**Example:** `recipe-engine/types.ts` (1285 lines)
- Types moved to `@hypercli/core/src/types/recipe.ts`
- Runtime code (RecipeEngine class, executeSteps, etc.) stays in `@hypercli/gen/src/recipe-engine/`

### 3. Re-export Shim Pattern (Planned)
To maintain backward compatibility during transition:
```typescript
// In hypergen (old package)
export * from '@hypercli/core'
export * from '@hypercli/gen'
// etc.
```

Allows existing code to import from hypergen while new code uses new packages.

## File Organization

### @hypercli/core Structure
```
src/
  types/
    kit.ts              # KitConfig, CookbookConfig
    template.ts         # TemplateVariable, TemplateConfig
    recipe.ts           # RecipeConfig, all step types (28KB)
    actions.ts          # ActionMetadata, ActionContext
    ai-config.ts        # AI service config types (7KB)
    common.ts           # Logger, Prompter, RenderedAction
    index.ts
  errors/
    hypergen-errors.ts  # Complete error system (36KB, 83 codes)
    index.ts
  config/
    config-loader.ts    # HypergenConfigLoader with callback
    load-helpers.ts
    index.ts
  parsers/
    kit-parser.ts
    cookbook-parser.ts
    template-parser.ts  # TemplateParser class (41KB)
    path-resolver.ts
    index.ts
  logger/
    logger.ts           # Chalk-based Logger class
    types.ts            # ActionLogger, ExtendedLogger
    index.ts
  utils/
    find-project-root.ts
    newline.ts
    index.ts
  helpers.ts
  constants.ts
  index.ts
```

### @hypercli/kit Structure
```
src/
  manifest.ts
  manifest.schema.json
  source-resolver.ts
  url-resolution/
    cache.ts
    manager.ts
    types.ts
    resolvers/
      npm-resolver.ts
      github-resolver.ts
      local-resolver.ts
      index.ts
    index.ts
  commands/
    kit/
      install.ts
      update.ts
      list.ts
      info.ts
  base-command.ts
  utils/
  index.ts
```

### @hypercli/gen Structure
```
src/
  recipe-engine/
    recipe-engine.ts
    step-executor.ts
    group-executor.ts
    output-evaluator.ts
    tools/
      template-tool.ts
      action-tool.ts
      recipe-tool.ts
      shell-tool.ts
      prompt-tool.ts
      ai-tool.ts
      install-tool.ts
      query-tool.ts
      patch-tool.ts
      ensure-dirs-tool.ts
      sequence-tool.ts
      parallel-tool.ts
      conditional-tool.ts
      registry.ts
      base.ts
  template-engines/
    jig-engine.ts       # Singleton with registerHelpers
    ai-tags.ts          # @ai tag for 2-pass generation
  ai/
    # 17 files for AI integration
    prompt-assembler.ts
    ai-collector.ts
    output-validator.ts
    ai-config.ts
    # etc.
  actions/
    decorator.ts        # @action decorator
    executor.ts
    parameter-resolver.ts
    registry.ts
    lifecycle.ts
    pipelines.ts
    # etc.
  ops/
    add.ts              # File creation (auto-mkdir)
    inject.ts           # Content injection
  prompts/
    interactive-prompts.ts  # Clack-based prompts
  discovery/
    generator-discovery.ts
  commands/
    run.ts
    recipe/
      run.ts
      list.ts
      info.ts
      validate.ts
    cookbook/
      info.ts
      list.ts
  hooks/
    command-not-found.ts  # Enable "hyper nextjs crud update Org" syntax
  lib/
    gen-base-command.ts   # Extends CoreBaseCommand
  index.ts
```

### @hypercli/cli Structure
```
bin/
  run.js              # Main entry point
  dev.js              # Development entry point
src/
  commands/
    config/
      init.ts
      show.ts
      validate.ts
    system/
      status.ts
      version.ts
    init.ts
  lib/
    core-base-command.ts  # Base for all commands
    colors.ts
    styles.ts
    flags.ts
  index.ts
```

## Monorepo Configuration

### Bun Workspaces
```json
{
  "workspaces": [
    "apps/*",
    "libs/*",
    "packages/*",
    "devtools/*/*"
  ]
}
```

All 4 new packages use `workspace:*` for internal dependencies.

### Moon Configuration
Each package has `moon.yml`:
- **core, kits, gen:** `type: library`, `language: typescript`, `platform: node`
- **cli:** `type: application`, `language: typescript`, `platform: node`
- All: `toolchain.typescript.syncProjectReferences: false`

## Build Configuration

### TypeScript (tsconfig.json)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": false,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

Note: Strict mode disabled to allow incremental migration. Re-enable per-package as code is cleaned up.

### Build Tool (tsup)
```typescript
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,  // Disabled in core due to inflection types issue
  sourcemap: true,
  clean: true,
  target: 'node20'
})
```

## Binary Name Change

**Old:** `hypergen` command
**New:** `hyper` command

**Rationale:**
- Shorter, easier to type
- Aligns with package scope (@hypercli)
- Clean break for major architecture change

**Migration Impact:**
```bash
# Old
hypergen run nextjs crud list

# New
hyper run nextjs crud list
```

All documentation and examples updated.
