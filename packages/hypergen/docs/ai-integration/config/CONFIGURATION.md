# AI Configuration

> This document is a brief reference. See the source code for full details.

## Source

- **Config types**: [`src/ai/ai-config.ts`](../../../src/ai/ai-config.ts) -- `AiServiceConfig` and all related types
- **Integration**: [`src/config/hypergen-config.ts`](../../../src/config/hypergen-config.ts) -- `HypergenConfig.ai` field

## AiServiceConfig

The top-level `ai` key in `hypergen.config.js`:

```typescript
interface AiServiceConfig {
  provider?: string           // e.g., 'anthropic', 'openai', 'ollama'
  model?: string              // e.g., 'claude-sonnet-4-5', 'gpt-4o'
  apiKey?: string             // Plain value or '$ENV_VAR' (resolved from env)
  systemPrompt?: string       // Default system prompt for all AI calls
  temperature?: number        // Default temperature (0-2)
  maxTokens?: number          // Default max output tokens
  budget?: AIBudgetConfig     // Cost budget (maxTokensPerStep, maxCostPerStep, etc.)
  defaultGuardrails?: AIGuardrailConfig  // Default validation rules
  fallbackModels?: AIModelRef[]          // Tried when primary model fails
}
```

## Example Configuration

```javascript
// hypergen.config.js
export default {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: '$ANTHROPIC_API_KEY',
    systemPrompt: 'You are a code generator. Output only code, no explanations.',
    temperature: 0.7,
    maxTokens: 4096,
    budget: {
      maxTokensPerStep: 8000,
      maxCostPerStep: 0.50,
    },
    fallbackModels: [
      { provider: 'openai', model: 'gpt-4o' },
    ],
  },
}
```

## Related Types

All defined in `src/ai/ai-config.ts`:

- `AIBudgetConfig` -- token and cost limits
- `AIOutputConfig` -- how output is written (`create`, `inject`, `replace`)
- `AIContextConfig` -- context file globs
- `AIExample` -- few-shot examples
- `AIGuardrailConfig` -- validation rules and retry config
- `AIModelRef` -- provider + model reference
- `AIModelPricing` -- per-model pricing info
- `AIExecutionResult` -- result from a single AI call
- `AICostSummary` -- accumulated cost tracking
