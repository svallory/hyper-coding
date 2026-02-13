# AI Mode: Pluggable AI Resolution for 2-Pass Templates

## Context

Hypergen's 2-pass AI system currently only supports one resolution path: print the assembled prompt to stdout, exit with code 2, and expect the user to manually get answers from an AI and re-run with `--answers ai-answers.json`. We want to support multiple ways to resolve @ai blocks automatically — via API calls, CLI commands, and (in the future) a persistent stdio subprocess or interactive prompts.

**Decisions made:**
- User-facing concept is **AI mode** (`--ai-mode`, `ai.mode`), not "transport"
- 5 modes: `auto` (default), `api`, `command`, `stdout`, `off`
- `auto` detects from config: API key present → api, command set → command, otherwise → stdout
- `stdout` = current behavior (print prompt, exit 2) — useful for AI agents that want the raw prompt
- `off` = same as stdout for now; in the future, interactive prompts in a TUI
- Command mode supports both `{prompt}` substitution and stdin piping
- API mode defaults to **batched** (one call for all blocks, JSON response)
- When api/command mode resolves answers inline, **Pass 2 runs automatically** in same process
- **Stdio mode** (persistent subprocess with JSON protocol): interface accommodates it, implement later

---

## File Plan

### New files

```
src/ai/transports/
  types.ts              — AiTransport interface, TransportResult, TransportContext
  resolve-transport.ts  — Maps ai.mode to transport, auto-detection logic
  stdout-transport.ts   — Current behavior extracted (used by stdout + off modes)
  api-transport.ts      — Vercel AI SDK batched resolution
  command-transport.ts  — CLI subprocess (batched + per-block modes)
  index.ts              — Barrel exports

tests/suites/ai/transports/
  resolve-transport.test.ts
  stdout-transport.test.ts
  api-transport.test.ts
  command-transport.test.ts
  transport-integration.test.ts  — Full Pass1→transport→Pass2 flow
```

### Modified files

- `src/ai/ai-config.ts` — Add `mode`, `command`, `commandMode` to AiServiceConfig
- `src/commands/recipe/run.ts` — Replace hardcoded stdout with transport dispatch + auto Pass 2
- `src/lib/flags.ts` — Add `--ai-mode` flag to executionFlags
- `src/errors/hypergen-errors.ts` — Add `AI_TRANSPORT_FAILED` error code

### Untouched files

- `src/ai/ai-collector.ts`, `src/ai/ai-service.ts`, `src/ai/prompt-assembler.ts`, `src/ai/model-router.ts` — reused as-is
- `src/template-engines/ai-tags.ts` — template rendering layer, unaffected
- All existing 565 tests — additive change; stdout is default when unconfigured

---

## 1. Transport Interface (`src/ai/transports/types.ts`)

```typescript
import type { AiCollector } from '../ai-collector.js'
import type { AiServiceConfig } from '../ai-config.js'

/** Either answers resolved inline, or deferred (stdout/off — expects re-run with --answers) */
export type TransportResult =
  | { status: 'resolved'; answers: Record<string, string> }
  | { status: 'deferred'; exitCode: number }

export interface TransportContext {
  collector: AiCollector
  config: AiServiceConfig
  originalCommand: string
  answersPath: string
  projectRoot: string
  promptTemplate?: string
}

/** A transport knows how to resolve AiBlockEntry[] into answers. */
export interface AiTransport {
  readonly name: string
  resolve(ctx: TransportContext): Promise<TransportResult>
}
```

Intentionally minimal — a future stdio transport (persistent subprocess, streaming, JSON protocol) fits this same shape.

---

## 2. Config Changes (`src/ai/ai-config.ts`)

Add to `AiServiceConfig` after `maxTokens`:

```typescript
/**
 * AI resolution mode for 2-pass @ai blocks.
 * - 'auto': detect from config (default)
 * - 'api': call LLM via Vercel AI SDK (requires provider + apiKey)
 * - 'command': pipe prompt to a CLI command (requires ai.command)
 * - 'stdout': print prompt to stdout, exit code 2 (for AI agents)
 * - 'off': no AI automation (same as stdout now; future: interactive prompts)
 */
mode?: 'auto' | 'api' | 'command' | 'stdout' | 'off'

/**
 * CLI command template for 'command' mode.
 * Include {prompt} for argument substitution, or omit to pipe via stdin.
 * Examples: 'claude -p {prompt}', 'llm', 'aichat -r coder'
 */
command?: string

/**
 * How command mode handles multiple @ai blocks.
 * - 'batched': one invocation, expects JSON response (default)
 * - 'per-block': one invocation per @ai block, raw text response
 */
commandMode?: 'batched' | 'per-block'
```

Note: `provider`, `model`, `apiKey` are only relevant for `api` mode. `stdout` and `off` don't use them.

---

## 3. CLI Flag (`src/lib/flags.ts`)

Add to `executionFlags`:

```typescript
'ai-mode': Flags.string({
  description: 'How to resolve @ai blocks: auto, api, command, stdout, off',
  options: ['auto', 'api', 'command', 'stdout', 'off'],
}),
```

In `recipe/run.ts`, this flag overrides `config.ai.mode` before calling `resolveTransport()`.

---

## 4. Transport Implementations

### StdoutTransport (`stdout-transport.ts`)
Extracts current behavior from `recipe/run.ts`:
- Calls `PromptAssembler.assemble()` with the collector
- Writes to `process.stdout`
- Returns `{ status: 'deferred', exitCode: 2 }`

Used by both `stdout` and `off` modes (for now).

### ApiTransport (`api-transport.ts`)
- Gets `AiService.getInstance(config)` — reuses existing retry, cost tracking, validation
- Builds a batched prompt from all `AiBlockEntry[]` with global contexts
- System prompt instructs JSON-only response
- Calls `aiService.generate()` once
- Parses JSON response, validates all expected keys present
- Strips markdown code fences before parsing (common LLM quirk)
- Returns `{ status: 'resolved', answers }`

### CommandTransport (`command-transport.ts`)
Two sub-modes:
- **Batched** (default): assembles full prompt via `PromptAssembler`, appends JSON instruction, spawns command once, parses JSON response
- **Per-block**: builds individual prompts per `AiBlockEntry`, spawns command once per block, raw text response per key

Command execution:
- `{prompt}` in template → shell-escape and substitute into command args
- No `{prompt}` → pipe prompt to subprocess stdin
- Capture stdout as response, stderr for errors
- Non-zero exit code → throw `AI_TRANSPORT_FAILED`

### resolveTransport (`resolve-transport.ts`)

```typescript
function resolveTransport(config: AiServiceConfig | undefined): AiTransport
```

Pure function. Resolution logic:

| `ai.mode` | Result |
|---|---|
| `'api'` | ApiTransport (error if no provider) |
| `'command'` | CommandTransport (error if no `ai.command`) |
| `'stdout'` | StdoutTransport |
| `'off'` | StdoutTransport (same for now) |
| `'auto'` or unset | provider + API key available → Api; `ai.command` set → Command; else → Stdout |

API key detection checks: `config.apiKey`, `$`-prefixed env var refs, well-known env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`).

---

## 5. RecipeRun Changes (`src/commands/recipe/run.ts`)

Current code (lines 79-92):
```typescript
if (collector.collectMode && collector.hasEntries()) {
  const prompt = assembler.assemble(collector, { ... })
  process.stdout.write(prompt)
  this.exit(2)
}
```

Replace with:
```typescript
if (collector.collectMode && collector.hasEntries()) {
  // CLI flag overrides config
  const aiConfig = { ...this.hypergenConfig?.ai }
  if (flags['ai-mode']) aiConfig.mode = flags['ai-mode']

  const transport = resolveTransport(aiConfig)
  const transportResult = await transport.resolve({
    collector, config: aiConfig, originalCommand, answersPath, projectRoot, promptTemplate
  })
  collector.clear()

  if (transportResult.status === 'deferred') {
    this.exit(transportResult.exitCode)
    return
  }

  // Answers resolved inline → auto-run Pass 2
  collector.collectMode = false
  result = await this.recipeEngine.executeRecipe(recipePath, {
    ...options,
    answers: transportResult.answers,
  })
}
```

Extract result-reporting logic (lines 96-131) into a private `reportResult()` method so it works for both the original path and the auto Pass 2 path.

---

## 6. Error Handling

Add `AI_TRANSPORT_FAILED` to `src/errors/hypergen-errors.ts`:
- Command transport: non-zero exit, JSON parse failure
- API transport: JSON parse failure from LLM response (distinct from `AI_GENERATION_FAILED` which is SDK-level)

---

## 7. Implementation Order

1. `src/ai/transports/types.ts` — interface definitions
2. `src/ai/ai-config.ts` — add `mode`, `command`, `commandMode` fields
3. `src/ai/transports/stdout-transport.ts` — extract current behavior
4. `src/ai/transports/resolve-transport.ts` — factory function
5. `src/ai/transports/api-transport.ts` — Vercel AI SDK integration
6. `src/ai/transports/command-transport.ts` — CLI subprocess
7. `src/ai/transports/index.ts` — barrel exports
8. `src/lib/flags.ts` — add `--ai-mode` flag
9. `src/commands/recipe/run.ts` — refactor to use transport dispatch + auto Pass 2
10. `src/errors/hypergen-errors.ts` — add error code
11. Tests for each transport + integration test

---

## 8. Verification

1. `bun test` — all 565 existing tests pass (transport is additive, stdout is default)
2. New unit tests for each transport (mocked AiService, mocked child_process)
3. Integration test: mock ApiTransport returning canned answers, verify full 2-pass cycle
4. Manual smoke test: `ai.command: 'echo {"key":"value"}'` + recipe with @ai tags

---

## 9. Config Examples

```javascript
// API mode (auto-detected when provider + API key present)
export default {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: '$ANTHROPIC_API_KEY',
  }
}

// Command mode
export default {
  ai: {
    mode: 'command',
    command: 'claude -p {prompt}',
    // commandMode: 'per-block',  // optional
  }
}

// Stdout mode (no provider/model needed — just prints the prompt)
export default {
  ai: {
    mode: 'stdout',
  }
}

// Off mode (no provider/model needed — same as stdout for now)
export default {
  ai: {
    mode: 'off',
  }
}
```

CLI override (useful for AI agents to force stdout even when API keys exist in config):
```bash
hypergen recipe run my-recipe.yml --ai-mode stdout
```
