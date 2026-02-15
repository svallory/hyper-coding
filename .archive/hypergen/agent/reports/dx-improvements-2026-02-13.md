# Recipe Engine DX Improvements — Implementation Report

**Date:** 2026-02-13
**Branch:** feat/mintlify-typedoc-integration
**Commits:**
- `499d6e1` — refactor(hypergen): register helpers as Jig globals and remove Hygen legacy
- `cca1d43` — feat(recipe-engine): add onSuccess/onError messages, install tool, and DX improvements

---

## Summary

Two consecutive commits implement the full plan from `agent/plans/refactored-tumbling-treehouse.md` (helpers + legacy cleanup) and 3 of the 6 items from `agent/plans/recipe-engine-dx-improvements.md`.

### Test Suite
- **Before:** 871 tests, 0 fail
- **After:** 958 tests, 0 fail (87 new tests)
- **Build:** TypeScript compiles cleanly

---

## Commit 1: Helpers as Jig Globals + Hygen Legacy Removal

### What changed
1. **Shared `loadHelpers()` utility** — Extracted from `HypergenConfigLoader` to `src/config/load-helpers.ts`
2. **`registerHelpers()` on Jig engine** — New function with collision tracking/warnings in `jig-engine.ts`
3. **Kit/Cookbook helpers** — Added `helpers?: string` to `KitConfig` and `CookbookConfig`; parsers load and register them as Jig globals
4. **Simplified recipe engine** — Removed `context()` import; builds execution context directly
5. **Simplified `buildRenderContext()`** — No `processedLocals`, no `...helpers` spread, no `h:` namespace
6. **Deleted 20+ dead files** — All Hygen legacy modules: `context.ts`, `render.ts`, `execute.ts`, `engine.ts`, `params.ts`, `help.ts`, `prompt.ts`, `generators.ts`, `TemplateStore.ts`, `indexed-store/`, `ops/shell.ts`, `ops/echo.ts`, `ops/setup.ts`, `ops/index.ts`
7. **Deleted 6 test files** — Tests for deleted modules

### Impact
- **-1,634 lines deleted**, +388 lines added (net ~1,250 line reduction)
- No more `path` variable collision from `builtinHelpers` spreading Node's `path` module
- Kit helpers (`kits/nextjs/helpers/`) are now loadable via `kit.yml: helpers: "./helpers/index.ts"`

---

## Commit 2: Recipe Engine DX Improvements

### Item #1: Auto-create directories for template `to:` paths
**Status:** Already handled. `ops/add.ts` line 62 already calls `fs.ensureDir(path.dirname(absTo))`. The `mkdir -p` shell steps in kit recipes are redundant — they can simply be deleted.

### Item #4: Recipe-level `onSuccess` / `onError` messages
**Status:** Implemented.

- `RecipeConfig` now has `onSuccess?: string` and `onError?: string` fields
- Parsed from recipe YAML in `parseRecipeContent()`
- After execution, `renderLifecycleMessage()` renders the message with Jig using the recipe's variables + result metadata
- Rendering failures are caught silently (logged via debug, not fatal)
- **16 tests** covering: variable rendering, Jig filters/conditionals, result metadata access, error resilience, YAML parsing

**Recipe YAML example:**
```yaml
name: entity
steps:
  - name: generate
    tool: template
    template: entity.jig
onSuccess: |
  Entity '{{ name }}' generated successfully!

  Generated files:
    lib/schemas/{{ kebabCase(name) }}-schema.ts
```

### Item #3: Built-in `install` tool
**Status:** Implemented.

- New `InstallTool` at `src/recipe-engine/tools/install-tool.ts`
- Auto-detects package manager from lockfiles (bun > pnpm > yarn > npm)
- Supports: `packages`, `dev`, `optional`, `packageManager` override
- Dry run mode returns command string without executing
- Optional flag: failure returns `status: 'completed'` with warning instead of `'failed'`
- Registered in default tool registry as `install`/`default`
- **71 tests** covering: validation, PM detection, command format, dry run, dev deps, optional installs, edge cases

**Recipe YAML example:**
```yaml
- name: Install dependencies
  tool: install
  packages: [zod, react-hook-form, "@hookform/resolvers"]
  dev: false
  optional: true
```

### Item #5: Kit helpers loading
**Status:** Completed in Commit 1 (helpers as Jig globals).

### Item #2: Kit/Cookbook setup metadata
**Status:** Not implemented (requires design decisions on open questions).

### Item #7: Update domain cookbook
**Status:** Deferred (depends on kit files in separate repo).

---

## Files Changed

### Commit 1 (40 files)
- Created: `src/config/load-helpers.ts`
- Modified: 12 source files, 2 test files
- Deleted: 20 source files, 6 test files

### Commit 2 (7 files)
| File | Change |
|------|--------|
| `src/recipe-engine/types.ts` | +`onSuccess`/`onError` on RecipeConfig, +`InstallStep`, +`InstallExecutionResult`, +`isInstallStep` |
| `src/recipe-engine/recipe-engine.ts` | Parse lifecycle fields, render after execution, add `install` to valid tools |
| `src/recipe-engine/step-executor.ts` | Add `install` to execution time estimations |
| `src/recipe-engine/tools/install-tool.ts` | **New** — full install tool implementation |
| `src/recipe-engine/tools/index.ts` | Export/register install tool, update type re-exports |
| `tests/suites/recipe-engine/on-success-message.test.ts` | **New** — 16 tests |
| `tests/suites/recipe-engine/install-tool.test.ts` | **New** — 71 tests |

---

## What Kit Recipes Can Now Do

Before (boilerplate):
```yaml
- name: Create directory
  tool: shell
  command: mkdir -p src/handlers

- name: Install deps
  tool: shell
  command: |
    if command -v bun &> /dev/null; then bun add zod
    elif command -v pnpm &> /dev/null; then pnpm add zod
    # ... 15 more lines

- name: Generate handler
  tool: template
  template: handler.jig

- name: Success
  tool: shell
  command: echo "Done!"
```

After:
```yaml
- name: Install deps
  tool: install
  packages: [zod]

- name: Generate handler
  tool: template
  template: handler.jig

onSuccess: "Handler generated successfully!"
```

`mkdir -p` is unnecessary (ops/add.ts handles it). Install tool replaces PM detection. `onSuccess` replaces echo steps.
