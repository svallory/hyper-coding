# AI Tool (Recipe Engine)

> This document is a brief reference. See the source code for full details.

## Source

- **Tool**: [`src/recipe-engine/tools/ai-tool.ts`](../../../src/recipe-engine/tools/ai-tool.ts) -- `AiTool` class, `AiToolFactory`
- **Step type**: [`src/recipe-engine/types.ts`](../../../src/recipe-engine/types.ts) -- `AIStep` interface

## Overview

`AiTool` extends `Tool<AIStep>` and is the recipe engine's integration point for AI generation. It:

1. Validates the step (checks for prompt, output config, provider availability)
2. Collects context files via `ContextCollector`
3. Assembles the prompt via `PromptPipeline`
4. Routes to the correct model via `ModelRouter`
5. Checks budget via `CostTracker`
6. Calls `AiService.generate()`
7. Validates output via `validateOutput()`
8. Retries with feedback on validation failure (up to `guardrails.maxRetries`)
9. Writes/injects the result per `output` config

## AIStep Interface

```typescript
interface AIStep extends BaseRecipeStep {
  tool: 'ai'
  prompt: string
  system?: string
  model?: string
  provider?: string
  output: AIOutputConfig       // { mode: 'create' | 'inject' | 'replace', to: string, ... }
  context?: AIContextConfig    // { files: string[], ... }
  examples?: AIExample[]
  guardrails?: AIGuardrailConfig
  budget?: AIBudgetConfig
  stream?: boolean
  temperature?: number
  maxTokens?: number
}
```

## AiToolFactory

Registered in `src/recipe-engine/tools/index.ts`. Creates `AiTool` instances for the `'ai'` tool type.
