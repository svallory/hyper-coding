# AI Module

LLM integration for Hypergen's code generation workflows. Provides AI-powered content generation through recipe steps (`tool: ai`) and inline template tags (`@ai`).

## Architecture

```
Recipe Step / @ai Template Tag
         │
    AiService  (singleton orchestrator)
    ├── ModelRouter         → Provider/model resolution + fallback chains
    ├── PromptPipeline      → 5-stage prompt assembly
    │   └── ContextCollector  → File/config/step-result gathering with token budgeting
    ├── CostTracker         → Token counting + budget enforcement
    └── validateOutput()    → Syntax/import/schema validation + retry feedback
         │
    Vercel AI SDK (generateText)
         │
    Claude / OpenAI / Google
```

## Files

| File | Purpose |
|---|---|
| `ai-config.ts` | All type definitions — no runtime code |
| `ai-service.ts` | Singleton orchestrator: model resolution → prompt assembly → generate → validate → retry |
| `model-router.ts` | Dynamic provider loading (`@ai-sdk/*`), API key resolution, fallback chains |
| `prompt-pipeline.ts` | 5-stage assembly: context collection → token budgeting → system+user prompt construction |
| `context-collector.ts` | Gathers files (glob/explicit), project configs, step results; enforces `maxContextTokens` |
| `cost-tracker.ts` | Per-step token/cost recording, budget limits, warning thresholds, formatted reports |
| `output-validator.ts` | Syntax (JSON/YAML/TS/JS), import allow/block lists, length checks; builds retry feedback |
| `index.ts` | Public re-exports |

Related files outside this directory:

| File | Purpose |
|---|---|
| `src/recipe-engine/tools/ai-tool.ts` | Recipe `tool: ai` implementation — validates step config, calls AiService, handles output routing |
| `src/template-engines/ai-tags.ts` | 2-pass `@ai`/`@context`/`@prompt`/`@output` Jig template tags |

## Execution Flow

### Recipe AI Step

```
AiTool.execute(step)
  1. costTracker.checkBudget()           — throw if limit exceeded
  2. modelRouter.resolve(provider, model) — try primary, then fallbacks
  3. Merge guardrails (global defaults + step overrides)
  4. promptPipeline.assemble()
     a. contextCollector.collect()        — read files, configs, step results
     b. Build system prompt               — global + step system prompts + guardrail rules
     c. Build user prompt                 — ## Context → ## Examples → ## Task
  5. Retry loop (0..maxRetries)
     a. On retry: append validation feedback to prompt
     b. generateText() via Vercel AI SDK
     c. validateOutput() — syntax, imports, length, content
     d. Pass → return result
     e. Fail → retry-with-feedback | fallback | error
  6. costTracker.record()
  7. handleOutput() — write file | inject into file | set variable | stdout
```

### @ai Template Tag

```jig
@ai({ model: 'claude-sonnet-4-5', validateSyntax: 'typescript' })
Generate CRUD methods for {{ name }}
@end
```

Calls `AiService.generate()` inline during template rendering. Returns the generated string directly into the template output. Supports `fallback` option for graceful degradation.

## Key Types

```typescript
// Top-level config (hypergen.config.js → ai property)
AiServiceConfig {
  provider, model, apiKey,
  systemPrompt, temperature, maxTokens,
  budget: AIBudgetConfig,
  defaultGuardrails: AIGuardrailConfig,
  fallbackModels: AIModelRef[],
  costTable: Record<string, AIModelPricing>
}

// Result from a single AI call
AIExecutionResult {
  output, structured?,
  usage: { inputTokens, outputTokens, totalTokens },
  costUsd, model, provider,
  retryAttempts, validation, durationMs
}

// Output routing for recipe steps
AIOutputConfig {
  type: 'variable' | 'file' | 'inject' | 'stdout',
  variable?, to?, injectInto?, after?, before?, at?
}
```

## Error Handling

| Scenario | Strategy |
|---|---|
| Provider not installed | Throw `AI_PROVIDER_UNAVAILABLE` |
| Primary model fails | Try fallback chain |
| Rate limited (429) | Exponential backoff, up to 5 retries |
| Network error | Exponential backoff (max 30s) |
| Validation fails | `retry-with-feedback` / `fallback` / `error` (configurable) |
| Budget exceeded | Throw `AI_BUDGET_EXCEEDED` immediately |

## Cost Tracking

Built-in pricing for common models:

| Model | Input/1M | Output/1M |
|---|---|---|
| claude-sonnet-4-5 | $3.00 | $15.00 |
| claude-haiku-3-5 | $0.80 | $4.00 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |

Budget enforcement via `AIBudgetConfig`:
- `maxTotalCostUsd` — hard cost limit
- `maxTotalTokens` — hard token limit
- `warnAtCostUsd` — warning threshold (logs, doesn't stop)

## Tests

Tests in `tests/suites/ai/`:

| File | Covers |
|---|---|
| `prompt-pipeline.test.ts` | Prompt assembly, system prompts, context/examples inclusion, guardrail rules |
| `context-collector.test.ts` | File reading, globs, project configs, step results, token budgets, overflow strategies |
| `cost-tracker.test.ts` | Cost calculation, token tracking, budget limits, report formatting |
| `output-validator.test.ts` | Syntax validation (JSON/YAML/TS), import checking, length limits, feedback building |
| `ai-tool.test.ts` | Step validation — required fields, output type rules, temperature/token bounds |
