# Phase 3: Extract @hypercli/gen

## Files to Move

From `packages/hypergen/src/`:

### Recipe Engine
- `recipe-engine/` → `src/recipe-engine/`
  - `recipe-engine.ts` (engine, runtime implementations only - types already in core)
  - `step-executor.ts`
  - `group-executor.ts`
  - `output-evaluator.ts`

### Tools
- `recipe-engine/tools/` → `src/recipe-engine/tools/`
  - All 13 tool implementations
  - `registry.ts`
  - `base.ts`

### Template Engine
- `template-engines/` → `src/template-engines/`
  - `jig-engine.ts`
  - `ai-tags.ts`

### AI System
- `ai/` → `src/ai/`
  - All 17 files
  - prompt-template.jig

### Actions
- `actions/` → `src/actions/`
  - All 8 files (decorator, executor, parameter-resolver, etc.)

### Operations
- `ops/` → `src/ops/`
  - `add.ts`
  - `inject.ts`

### Discovery
- `discovery/` → `src/discovery/`
  - `generator-discovery.ts`

### Prompts
- `prompts/` → `src/prompts/`
  - `interactive-prompts.ts`

### Commands
- `commands/run.ts` → `src/commands/run.ts`
- `commands/recipe/` → `src/commands/recipe/`
- `commands/cookbook/` → `src/commands/cookbook/`

### Hooks
- `hooks/command-not-found.ts` → `src/hooks/command-not-found.ts`

### Base Command
- Create `src/lib/gen-base-command.ts` - extends CoreBaseCommand from @hypercli/cli

## Dependencies

Gen package depends on:
- `@hypercli/core` - types, errors, config, parsers
- `@hypercli/kit` - kit resolution
- External: `@jig-lang/jig`, `@clack/prompts`, etc.

## Circular Dependency Fix

`template-engines/jig-engine.ts` ↔ `ai/`: Fix with dependency injection - `PromptAssembler` takes `renderFn` parameter.
