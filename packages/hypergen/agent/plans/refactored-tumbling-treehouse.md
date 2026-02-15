# Plan: Helpers as Jig Globals + Hygen Legacy Removal

## Context

Hypergen was forked from Hygen. The recipe engine replaced the old pipeline, but legacy modules remain: `context.ts`, `render.ts`, `execute.ts`, `engine.ts`, `params.ts`, `help.ts`, `generators.ts`, `TemplateStore.ts`, `prompt.ts`. These are dead code — nothing imports them except each other and `index.ts` re-exports.

The helpers system is broken: kit helpers (`kits/nextjs/helpers/`) are never loaded into the template render context. Config helpers go through a convoluted chain (`context()` → `h` namespace → flat spread) that causes variable collisions (e.g., Node's `path` module overwrites a `path` template variable).

This plan:
1. Registers all helpers (kit, cookbook, project-config) as **Jig globals** — no context plumbing
2. Deletes all dead Hygen legacy modules
3. Simplifies `buildRenderContext()` to only handle data (variables, step results)
4. Drops the `processedLocals` magic (no more auto-generated `Name`/`names`/`Names` — templates use Jig filters)

## Decision Record

- **Helpers = Jig globals only.** No flat spread into context. No `h` namespace. No collision risk.
- **No recipe-level helpers.** Only kit.yml and cookbook.yml can define helpers.
- **`hypergen.config.js` helpers** also register as Jig globals (same mechanism).
- **Warn on collision.** If two sources register a global with the same name, log a warning. Last registration wins.
- **Drop `processedLocals`.** No `.jig` template uses `{{ Name }}`, `{{ names }}`, or `{{ Names }}`. Templates should use `{{ pascalCase(name) }}` and `{{ pluralize(name) }}`.
- **Keep `ops/add.ts` and `ops/inject.ts`.** The recipe engine's template-tool still uses them for file operations.

---

## Step 1: Shared helper loading utility

Extract `HypergenConfigLoader.loadHelpers()` to a standalone utility.

**Create** `src/config/load-helpers.ts`:
```typescript
/**
 * Load helpers from a file path or object.
 * Resolves relative paths against baseDir.
 * Returns Record<string, Function>.
 */
export async function loadHelpers(
  helpers: string | Record<string, Function> | undefined,
  baseDir: string
): Promise<Record<string, Function>>
```

- Same logic as current `HypergenConfigLoader.loadHelpers()` (lines 359-411 of `hypergen-config.ts`)
- Add `index.ts` to the directory scan list (bun handles `.ts` natively)
- Remove from `HypergenConfigLoader` — call the shared utility instead

**Modify** `src/config/hypergen-config.ts`:
- Import `loadHelpers` from `./load-helpers.js`
- Delete the private `loadHelpers` method
- Update callers to use the imported function

---

## Step 2: `registerHelpers()` on Jig engine

**Modify** `src/template-engines/jig-engine.ts`:

Add a new exported function:
```typescript
export function registerHelpers(
  helpers: Record<string, any>,
  source?: string  // e.g. "kit:@kit/nextjs" for collision warnings
): void {
  const engine = getJig()
  for (const [name, value] of Object.entries(helpers)) {
    if (typeof value === 'function') {
      if (registeredGlobals.has(name)) {
        const existingSource = registeredGlobals.get(name)
        console.warn(
          `Warning: Helper "${name}" from ${source ?? 'unknown'} overwrites existing helper from ${existingSource}`
        )
      }
      engine.global(name, value)
      registeredGlobals.set(name, source ?? 'unknown')
    }
  }
}
```

Add module-level collision tracking:
```typescript
const registeredGlobals = new Map<string, string>()
```

Update `initializeJig()` to clear `registeredGlobals` on reinit.

---

## Step 3: Add `helpers` to KitConfig and CookbookConfig

**Modify** `src/config/types.ts`:
- Add `helpers?: string` to `KitConfig` (around line 130)
- Add `helpers?: string` to `CookbookConfig` (around line 144)

---

## Step 4: Kit/Cookbook parsers load and register helpers

**Modify** `src/config/kit-parser.ts`:
- Import `loadHelpers` from `./load-helpers.js` and `registerHelpers` from `../template-engines/jig-engine.js`
- Add `helpers` to `validateKitConfig()` accepted fields
- Add `loadedHelpers?: Record<string, Function>` to `ParsedKit` interface
- After parsing, if `config.helpers` is set, resolve path relative to `dirPath` and call `loadHelpers()`
- Add exported `registerKitHelpers(kit: ParsedKit)` that calls `registerHelpers(kit.loadedHelpers, 'kit:' + kit.config.name)`

**Modify** `src/config/cookbook-parser.ts`:
- Same pattern: add `loadedHelpers` to `ParsedCookbook`, add `registerCookbookHelpers()`

---

## Step 5: Register `hypergen.config.js` helpers as Jig globals

**Modify** `src/config/hypergen-config.ts`:
- After loading config helpers, call `registerHelpers(loadedHelpers, 'config:hypergen.config')`
- Remove `loadedHelpers` from `ResolvedConfig` — no longer passed through config chain

**Modify** `src/lib/base-command.ts` (line 105):
- Remove `helpers: this.hypergenConfig?.loadedHelpers` from `RecipeEngineConfig`

---

## Step 6: Simplify recipe engine

**Modify** `src/recipe-engine/recipe-engine.ts`:
- Remove `import context from '../context.js'` (line 19)
- Remove `helpers` from `RecipeEngineConfig` interface (line 150)
- Remove `helpers: {}` from `DEFAULT_CONFIG` (line 247)
- Rewrite `createExecutionContext()` — stop calling `context()`, build variables directly:

```typescript
private async createExecutionContext(
  recipe: RecipeConfig, variables: Record<string, any>,
  options: RecipeExecutionOptions, executionId: string,
  source?: string | RecipeSource
): Promise<StepContext> {
  const collectMode = !options.answers && AiCollector.getInstance().collectMode
  return {
    step: {} as RecipeStepUnion,
    variables: { ...variables },
    projectRoot: options.workingDir || this.config.workingDir,
    recipeVariables: variables,
    stepResults: new Map(),
    recipe: { id: executionId, name: recipe.name, version: recipe.version, startTime: new Date() },
    stepData: {},
    evaluateCondition: this.createConditionEvaluator(variables),
    answers: options.answers,
    collectMode,
    dryRun: options.dryRun,
    force: options.force,
    logger: options.logger || this.logger,
    templatePath: source && typeof source === 'object' && source.type === 'file'
      ? path.dirname(source.path) : undefined
  }
}
```

Update `createConditionEvaluator` to accept raw variables instead of the old `context()` result.

---

## Step 7: Simplify `buildRenderContext()`

**Modify** `src/recipe-engine/tools/template-tool.ts`:

Remove imports:
- `import builtinHelpers from '../../helpers.js'` (line 25)

Rewrite `buildRenderContext()` (lines 579-640):
```typescript
private buildRenderContext(
  step: TemplateStep, context: StepContext, attributes: Record<string, any>
): Record<string, any> {
  const mergedVars = {
    ...context.recipeVariables,
    ...context.variables,
    ...step.variables
  }
  return {
    ...mergedVars,
    recipe: context.recipe,
    step: { name: step.name, description: step.description },
    utils: context.utils,
    stepResults: context.stepResults ? Object.fromEntries(context.stepResults) : {},
    answers: context.answers,
    __hypergenCollectMode: context.collectMode || false,
    provide: (key: string, value: any) => { context.variables[key] = value; return '' },
  }
}
```

No `...helpers` spread. No `h:` key. No `processedLocals`.

---

## Step 8: Clean up `helpers.ts`

**Modify** `src/helpers.ts` — remove `path` export:

```typescript
import inflection from 'inflection'
import changeCase from 'change-case'

inflection.undasherize = (str) =>
  str.split(/[-_]/).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')

const helpers = {
  capitalize(str) {
    const toBeCapitalized = String(str)
    return toBeCapitalized.charAt(0).toUpperCase() + toBeCapitalized.slice(1)
  },
  inflection,
  changeCase,
}
export default helpers
```

---

## Step 9: Remove dead import from shell-tool

**Modify** `src/recipe-engine/tools/shell-tool.ts`:
- Remove `import shell from '../../ops/shell.js'` (line 18)

---

## Step 10: Slim down types

**Modify** `src/types.ts`:

Keep only what `ops/add.ts` and `ops/inject.ts` actually use:

```typescript
export interface RunnerConfig {
  exec?: (sh: string, body: string) => void
  cwd?: string
  logger?: Logger
  createPrompter?: <Q, T>() => Prompter<Q, T>
}
```

Delete: `ResolvedRunnerConfig`, `ConflictResolutionStrategy`, `TemplatesConfigOption`, `ResolvedTemplatePathConfig`, `ParamsResult`, `RunnerResult`.

Keep: `Logger`, `Prompter`, `RenderedAction`, `ActionResult`.

Check if `Action`, `ActionsMap`, `Generator` are used by live code — delete if not.

---

## Step 11: Delete dead legacy modules

**Delete source files:**
- `src/context.ts`, `src/render.ts`, `src/execute.ts`, `src/engine.ts`
- `src/params.ts`, `src/help.ts`, `src/prompt.ts`
- `src/generators.ts`, `src/TemplateStore.ts`, `src/indexed-store/` (directory)
- `src/ops/shell.ts`, `src/ops/echo.ts`, `src/ops/setup.ts`, `src/ops/index.ts`

**Delete test files:**
- `tests/context.spec.ts`, `tests/render.spec.ts`, `tests/params.spec.ts`
- `tests/util/metaverse.helper.ts`

---

## Step 12: Clean up `src/index.ts`

Remove dead re-exports:
- `RunnerConfig`, `RunnerResult` type exports
- `engine`, `ShowHelpError` exports
- Entire `runner()` function and its imports
- `Logger` — check if still needed by live consumers; keep if so

---

## Step 13: Update affected tests

- `tests/recipe-engine.test.ts` — remove any `helpers` from `RecipeEngineConfig` construction
- `tests/recipe-engine/tools/template-tool.test.ts` — remove assertions on `h` namespace or `processedLocals`
- `tests/suites/ai/e2e-recipe-with-helpers.test.ts` — already uses Jig globals, should work as-is
- `tests/e2e/full-workflow.test.ts` — already uses Jig globals, should work as-is
- Any test importing deleted types (`RunnerResult`, `ConflictResolutionStrategy`, etc.) — update imports

---

## Files Summary

### Create (1 file)
| File                         | Purpose                       |
| ---------------------------- | ----------------------------- |
| `src/config/load-helpers.ts` | Shared helper loading utility |

### Modify (12 files)
| File                                       | Changes                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `src/template-engines/jig-engine.ts`       | Add `registerHelpers()` with collision tracking          |
| `src/config/types.ts`                      | Add `helpers?: string` to KitConfig, CookbookConfig      |
| `src/config/kit-parser.ts`                 | Load helpers, register as Jig globals                    |
| `src/config/cookbook-parser.ts`            | Load helpers, register as Jig globals                    |
| `src/config/hypergen-config.ts`            | Use shared `loadHelpers()`, register as Jig globals      |
| `src/recipe-engine/recipe-engine.ts`       | Remove context() import, simplify createExecutionContext |
| `src/recipe-engine/tools/template-tool.ts` | Simplify buildRenderContext                              |
| `src/recipe-engine/tools/shell-tool.ts`    | Remove dead ops/shell import                             |
| `src/helpers.ts`                           | Remove `path` export                                     |
| `src/types.ts`                             | Slim RunnerConfig, remove dead types                     |
| `src/index.ts`                             | Remove dead re-exports                                   |
| `src/lib/base-command.ts`                  | Remove `helpers` from RecipeEngineConfig                 |

### Delete (14+ source, 4 test files)
| File                             | Reason                                 |
| -------------------------------- | -------------------------------------- |
| `src/context.ts`                 | Replaced by Jig globals                |
| `src/render.ts`                  | Dead — old Hygen pipeline              |
| `src/execute.ts`                 | Dead — old ops orchestrator            |
| `src/engine.ts`                  | Dead — deprecated stub                 |
| `src/params.ts`                  | Dead — replaced by oclif               |
| `src/help.ts`                    | Dead — replaced by oclif               |
| `src/prompt.ts`                  | Dead — replaced by interactive-prompts |
| `src/generators.ts`              | Dead — old template scanner            |
| `src/TemplateStore.ts`           | Dead — old template store              |
| `src/indexed-store/`             | Dead — TemplateStore support           |
| `src/ops/shell.ts`               | Dead — never called                    |
| `src/ops/echo.ts`                | Dead — only used by dead execute.ts    |
| `src/ops/setup.ts`               | Dead — only used by dead execute.ts    |
| `src/ops/index.ts`               | Dead — only used by dead execute.ts    |
| `tests/context.spec.ts`          | Tests deleted module                   |
| `tests/render.spec.ts`           | Tests deleted module                   |
| `tests/params.spec.ts`           | Tests deleted module                   |
| `tests/util/metaverse.helper.ts` | Dead utility                           |

---

## Verification

1. **`bun test`** — all surviving tests pass
2. **Grep for broken imports** — no remaining imports of deleted modules
3. **Grep for `h.` in live code** — only in orphaned test fixtures
4. **`bun run build:lib`** — TypeScript compiles cleanly
5. **Test helper registration** — verify `registerHelpers()` makes functions callable in Jig templates
6. **Test collision warning** — register same name twice, verify warning
