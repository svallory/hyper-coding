# Plan: 2-Pass AI-Integrated Generation System

## Context

Hypergen currently has an `@ai` tag that calls an LLM inline during template rendering. This doesn't work well with AI coding agents — the agent can't control the LLM calls, doesn't know what context to provide, and can't review/edit AI output before it lands in files.

The solution is a **2-pass system**:
- **Pass 1**: Render all templates, collect AI prompts/context/output specs, print a markdown prompt to stdout, write no files.
- **Pass 2**: Agent provides answers via `--answers path.json`, templates resolve `@ai` blocks from the answers, files are written normally.

This enables agents to orchestrate AI generation externally while template authors declaratively specify what AI help they need.

---

## New Tag Design

### `@ai` — Block container (replaces current `@ai` tag)

```jig
@ai()
  @context()
    The Customer model has these fields:
    {{ JSON.stringify(modelFields, null, 2) }}
  @end

  @prompt()
    Which fields are most relevant for a quick-view card?
  @end

  @output({ key: 'mainFields' })
    ["fieldName1", "fieldName2"]
  @end
@end
```

- Contains `@context`, `@prompt`, `@output` children
- In Pass 1 (collect mode): collects children data, outputs nothing
- In Pass 2 (answers mode): outputs `answers.mainFields`

### `@context` — Block tag (inside or outside `@ai`)

- Body is rendered text that becomes context for the LLM
- Inside `@ai`: scoped to that block's prompt
- Outside `@ai`: global context shared across all prompts

### `@prompt` — Block tag (inside `@ai` only)

- Body is the rendered question/instruction for the LLM

### `@output({ key: 'myKey' })` — Block tag (inside `@ai` only)

- `key` is the JSON property name the LLM fills in
- Body is a text description / example of expected format
- In Pass 2, `{{ answers.myKey }}` resolves to the LLM's answer

---

## Files to Create

### 1. `src/ai/ai-collector.ts` — Collection singleton

Accumulates AI block data across all templates in a single run.

```typescript
interface AiBlockEntry {
  key: string              // from @output({ key })
  contexts: string[]       // rendered @context bodies within this @ai block
  prompt: string           // rendered @prompt body
  outputDescription: string // rendered @output body (format hint)
  sourceFile: string       // which template file
}

class AiCollector {
  // Singleton (same pattern as AiService)
  static getInstance(): AiCollector
  static reset(): void

  collectMode: boolean     // true = Pass 1, false = normal/Pass 2

  addGlobalContext(text: string): void
  addEntry(entry: AiBlockEntry): void
  hasEntries(): boolean
  getGlobalContexts(): string[]
  getEntries(): Map<string, AiBlockEntry>
  clear(): void
}
```

### 2. `src/ai/prompt-assembler.ts` — Markdown prompt builder

Takes AiCollector data, produces a self-contained markdown document.

```typescript
interface AssemblerOptions {
  originalCommand: string   // for the callback instruction
  answersPath?: string      // suggested path for answers file
}

class PromptAssembler {
  assemble(collector: AiCollector, options: AssemblerOptions): string
}
```

Output format:

```markdown
# Hypergen AI Generation Request

## Context
<global @context blocks>
<per-block @context blocks, labeled by key>

## Prompts

### `mainFields`
<prompt body>

**Expected output format:**
<output description>

### `relationships`
<prompt body>
...

## Response Format

Respond with a JSON object:
\```json
{
  "mainFields": "<see format above>",
  "relationships": "<see format above>"
}
\```

## Instructions

Save your response as JSON to a file and run:
\```
hypergen crud edit --model Customer --answers ./answers.json
\```
```

### 3. `src/template-engines/ai-tags.ts` — New tag implementations

Replaces `ai-jig-tag.ts`. Registers 4 tags with the Edge.js instance.

**Compile strategy**: The `@ai` tag's `compile()` method:
1. Iterates `token.children`, identifies `@context`/`@prompt`/`@output` children by `child.properties.name`
2. For each child type, processes them via `parser.processToken()` into separate capture buffers
3. Emits runtime code that branches on `state.__hypergenCollectMode`:
   - **Collect mode**: calls `__hypergenAiCollect(key, contexts, prompt, outputDesc, filename)`
   - **Answers mode**: emits `out += state.answers[key]`

The `@context` tag (standalone, outside `@ai`):
- `block: true, seekable: true`
- Renders body, calls `__hypergenAddGlobalContext(renderedText)`

**Variable namespacing**: Each `@ai` block uses `token.loc.start.line` as suffix to prevent collisions when multiple `@ai` blocks exist in one template.

**Key compile output pattern** (inside `@ai`):

```javascript
// --- @ai block at line N ---
let __aiCtx_N = [];
let __aiPrompt_N = '';
let __aiKey_N = '';
let __aiOutDesc_N = '';

// (children compile here, pushing to the above vars)

if (state.__hypergenCollectMode) {
  __hypergenAiCollect(__aiKey_N, __aiCtx_N, __aiPrompt_N, __aiOutDesc_N, $filename);
  // output nothing
} else {
  out += (state.answers && state.answers[__aiKey_N]) || '';
}
```

Child tags (`@context`, `@prompt`, `@output` when inside `@ai`) compile to:
- `@context`: captures rendered body into `__aiCtx_N.push(renderedText)`
- `@prompt`: captures rendered body into `__aiPrompt_N = renderedText`
- `@output`: extracts key from jsArg, captures body: `__aiKey_N = 'myKey'; __aiOutDesc_N = renderedText`

**Important implementation detail**: Child tags need to know they're inside an `@ai` parent. The parent sets a variable `let __insideAi = N` before processing children and clears it after. Child tags check this to know whether to push to scoped vars or call global functions.

---

## Files to Modify

### 4. `src/template-engines/jig-engine.ts`

- **Line 39**: Replace `registerAiTag(jig)` call to use new `ai-tags.ts`
- **Lines 146-155**: Replace `registerAiTag()` function body
- Register global functions for the compiled tag code:
  - `__hypergenAiCollect` → delegates to `AiCollector.getInstance().addEntry()`
  - `__hypergenAddGlobalContext` → delegates to `AiCollector.getInstance().addGlobalContext()`
- No changes to `renderTemplate()` signature — `answers` and `__hypergenCollectMode` flow through the existing `context` parameter

### 5. `src/lib/flags.ts`

Add to `executionFlags`:

```typescript
answers: Flags.file({
  description: 'Path to AI answers JSON file (2-pass generation)',
}),
```

### 6. `src/commands/run.ts`

- Add `answers` flag (via `executionFlags` or directly)
- Before execution: initialize `AiCollector`, set collect mode if no `--answers`
- If `--answers`: load JSON, pass as `options.answers`
- After execution: if collect mode and `AiCollector.hasEntries()`, run `PromptAssembler`, write to stdout, exit with code 2
- If collect mode and no entries: proceed normally (no AI tags found)

### 7. `src/commands/recipe/run.ts`

Same changes as `run.ts`.

### 8. `src/recipe-engine/types.ts`

Add to `StepContext`:

```typescript
answers?: Record<string, any>
collectMode?: boolean
```

### 9. `src/recipe-engine/recipe-engine.ts`

Add to `RecipeExecutionOptions`:

```typescript
answers?: Record<string, any>
```

In execution context creation: propagate `answers` and derive `collectMode` from absence of answers + AiCollector state.

### 10. `src/recipe-engine/tools/template-tool.ts`

- In `buildRenderContext()` (~line 541): inject `answers` and `__hypergenCollectMode` into the Jig render context
- In `onExecute()`: skip file generation when `context.collectMode` is true (still render templates to trigger collection)

### 11. `src/render.ts` (legacy pipeline)

In `renderTmpl()` (~line 38): inject `answers` and `__hypergenCollectMode` into context.

### 12. `src/execute.ts` (legacy pipeline)

Add early return when `config._collectMode` is true — return empty results, write no files.

### 13. `src/template-engines/ai-jig-tag.ts`

Deprecate. Keep file but add `@deprecated` JSDoc. The new `ai-tags.ts` replaces it.

### 14. `src/ai/index.ts`

Export new modules:

```typescript
export { AiCollector } from './ai-collector.js'
export { PromptAssembler } from './prompt-assembler.js'
```

---

## Implementation Order

| Step | File | Complexity | Depends On |
|------|------|-----------|------------|
| 1 | `src/ai/ai-collector.ts` | Low | Nothing |
| 2 | `src/ai/prompt-assembler.ts` | Low | Step 1 |
| 3 | `src/template-engines/ai-tags.ts` | **High** | Step 1 |
| 4 | `src/template-engines/jig-engine.ts` | Medium | Step 3 |
| 5 | `src/template-engines/ai-jig-tag.ts` | Trivial | Step 4 |
| 6 | `src/lib/flags.ts` | Trivial | Nothing |
| 7 | `src/recipe-engine/types.ts` | Trivial | Nothing |
| 8 | `src/recipe-engine/recipe-engine.ts` | Low | Step 7 |
| 9 | `src/recipe-engine/tools/template-tool.ts` | Medium | Steps 4, 7, 8 |
| 10 | `src/render.ts` + `src/execute.ts` | Low | Step 4 |
| 11 | `src/commands/run.ts` + `recipe/run.ts` | Medium | Steps 1, 2, 6 |
| 12 | `src/ai/index.ts` | Trivial | Steps 1, 2 |
| 13 | Tests | Medium | All above |

Steps 1-2 and 6-7 can be done in parallel. Step 3 is the critical path.

---

## Testing Strategy

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `tests/suites/ai/ai-collector.test.ts` | Singleton, addEntry, addGlobalContext, collectMode, clear, hasEntries, duplicate key handling |
| `tests/suites/ai/prompt-assembler.test.ts` | Markdown output format, all keys present, callback command, global vs scoped context |
| `tests/template-engines/ai-tags.test.ts` | Collect mode collection, answers mode resolution, @context outside @ai, multiple @ai blocks, variable interpolation inside tags |

### Integration Tests

| Test File | Covers |
|-----------|--------|
| `tests/suites/ai/two-pass-integration.test.ts` | Full Pass 1 → stdout prompt → Pass 2 → files written |

### Test Fixtures

```
tests/fixtures/ai-2pass/
  basic.jig.t               — Single @ai block with all 3 child tags
  multi-block.jig.t          — Multiple @ai blocks with different keys
  global-context.jig.t       — @context outside @ai (global)
  no-ai.jig.t                — Template without @ai (unchanged behavior)
  nested-vars.jig.t          — {{ name }} inside @prompt body
  answers.json               — Sample answers for Pass 2 tests
```

### Verification Steps

1. Create a test template with `@ai`/`@context`/`@prompt`/`@output`
2. Run `bun run hypergen run ./test-recipe` — verify markdown prompt on stdout, exit code 2, no files
3. Create `answers.json` with the expected keys
4. Run `bun run hypergen run ./test-recipe --answers ./answers.json` — verify files written with answer content
5. Run `bun test` — all existing tests still pass
6. Run new test suites

---

## Design Decisions

1. **Singleton AiCollector** — Matches existing AiService pattern. Avoids threading collector through every function. Requires `.clear()` at execution start.

2. **Exit code 2** — Distinct from 0 (success) and 1 (error). Scripts/agents can detect "AI needed" programmatically.

3. **Child tags compile to scoped variables** — `__aiCtx_N`, `__aiPrompt_N` etc. use line number suffix. Parent `@ai` tag orchestrates capture/dispatch. This avoids runtime registry lookups.

4. **`@context` dual behavior** — Inside `@ai`: scoped. Outside `@ai`: global. Determined at compile time by checking `__insideAi` variable.

5. **Existing AI infrastructure untouched** — `AiService`, `ModelRouter`, `CostTracker`, recipe `tool: ai` steps all continue to work as-is. The 2-pass system is a parallel path for template `@ai` blocks only.

6. **Prompt delivery decoupled** — `PromptAssembler` produces text. The CLI writes it to stdout. Future: API call, pipe to process, etc. — just different consumers of the same assembled prompt.
