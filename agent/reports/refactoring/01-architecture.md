# HyperDev Multi-Package Architecture

## Package Dependency Graph

```
@hypercli/cli  ──→  @hypercli/gen  ──→  @hypercli/kit  ──→  @hypercli/core
      │                   │                                        ↑
      │                   └────────────────────────────────────────┘
      └────────────────────────────────────────────────────────────┘
```

**Rules:** Core has zero @hypercli deps. Kit depends only on core. Gen depends on core + kit. CLI depends on all three. No circular dependencies.

## Packages

| Package | Folder | Role | Key Contents |
|---------|--------|------|-------------|
| `@hypercli/core` | `packages/core/` | Types, config, errors, parsers, utils | 26 files, 383KB built |
| `@hypercli/kit` | `packages/kit/` | Kit lifecycle, source resolution (oclif plugin) | 15 files |
| `@hypercli/gen` | `packages/gen/` | Recipe engine, templates, AI, actions (oclif plugin) | 68 files |
| `@hypercli/cli` | `packages/cli/` | Thin shell, plugin host, `hyper` binary | 2 files |

## CLI Plugin Architecture

CLI is a thin oclif shell that loads gen and kit as plugins:

```json
{
  "oclif": {
    "bin": "hyper",
    "plugins": ["@hypercli/gen", "@hypercli/kit", "@oclif/plugin-help"],
    "topicSeparator": " "
  }
}
```

**Command routing:**
- `hyper kit install` → @hypercli/kit plugin
- `hyper run nextjs crud` → @hypercli/gen plugin
- `hyper nextjs crud list` → gen's `command_not_found` hook rewrites to `hyper run nextjs/crud/list`
- `hyper config show` → @hypercli/cli directly

**BaseCommand hierarchy:**
```
oclif Command
  └─ CoreBaseCommand (cli) — loads config, logger, base flags (--config, --debug, --cwd)
       └─ GenBaseCommand (gen) — adds recipe engine, discovery, tool registry
```

Kit commands use CoreBaseCommand directly (no generation engine needed).

## Key Design Decisions

### Helper Registration Callback
Core parsers/config can't depend on Jig (would create circular dep). Instead, they accept an `onHelpersLoaded` callback — the consumer (gen) registers helpers with Jig.

```typescript
const config = await loadConfig(path, root, env, {
  onHelpersLoaded: (helpers, source) => registerHelpers(helpers, source)
})
```

### Type vs Runtime Separation
All type definitions live in core. Runtime implementations stay in their packages. This lets any package import types without pulling in heavy runtime deps.

### Clean Deprecation
`hypergen@9.0.0` will be deprecation-only (postinstall notice, no code). No re-export shims — clean break forces migration.

## Build Config

All packages use:
- **tsup** — ESM output, sourcemaps, target node20
- **DTS disabled** — inflection types incompatibility (to be fixed)
- **strict: false** — to be re-enabled per-package incrementally
- **workspace:\*** — for inter-package dependencies

## What's in Each Package

### @hypercli/core
Types (kit, template, recipe, actions, AI config, common), error system (83 codes), config loader (cosmiconfig + callback), parsers (kit.yml, cookbook.yml, template.yml, path resolver), logger (chalk-based), utils (find-project-root, newline, helpers, constants).

### @hypercli/kit
Kit manifest validation, source resolution (npm/GitHub/local), URL resolution with caching, kit commands (install, update, list, info).

### @hypercli/gen
Recipe engine (13 tools: template, action, recipe, shell, prompt, ai, install, query, patch, ensure-dirs, sequence, parallel, conditional), Jig template engine (singleton, 13 filters, @ai tag), AI 2-pass system, actions (@action decorator, lifecycle, pipelines), file ops (add with auto-mkdir, inject), interactive prompts (clack), generator discovery, commands (run, recipe/*, cookbook/*), command_not_found hook.

### @hypercli/cli
Binary entry points (bin/run.js, bin/dev.js), CoreBaseCommand, config/system commands (planned).
