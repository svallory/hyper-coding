# AI Integration Architecture

> For the full architecture, research, and implementation plan, see [`agent/plans/gleaming-weaving-cherny.md`](../../agent/plans/gleaming-weaving-cherny.md).

## Integration Surface

```
                    hypergen.config.js
                         |
                    AiServiceConfig
                         |
           +-------------+-------------+
           |                           |
     Template Engine              Recipe Engine
           |                           |
   {% ai %}{% endai %}          AIStep (tool: 'ai')
           |                           |
           +-------------+-------------+
                         |
                     AiService
                    (singleton)
                         |
          +---------+----+----+---------+
          |         |         |         |
    ModelRouter  Prompt   Context   CostTracker
                Pipeline  Collector
                         |
                  Vercel AI SDK
                         |
              +----------+----------+
              |          |          |
          Anthropic   OpenAI    Ollama
```

## Prompt Pipeline Stages

1. **Context Collection** -- `ContextCollector` reads explicit context files listed in the step/tag config and bundles them into a `ContextBundle`.
2. **Prompt Assembly** -- `PromptPipeline` combines system prompt, context bundle, few-shot examples, and the user prompt into a single `AssembledPrompt`.
3. **Model Routing** -- `ModelRouter` resolves the provider/model from config or step overrides, with fallback chain support.
4. **Budget Check** -- `CostTracker` checks token limit first, then cost limit, before the call is made.
5. **LLM Call** -- `AiService` dispatches to Vercel AI SDK's `generateText`.
6. **Output Validation** -- `validateOutput` runs syntax checks (regex-based) and import validation against the generated output.
7. **Retry Loop** -- On validation failure, `buildValidationFeedback` appends errors to the prompt and retries (up to `guardrails.maxRetries`).

## Key Design Choices

- **Vercel AI SDK** for provider abstraction (no custom HTTP clients)
- **Single `{% ai %}` tag** instead of 7 specialized template tags
- **Explicit context files** instead of automatic AST analysis
- **Dynamic imports** for provider SDKs (truly optional dependencies)
- **Graceful degradation** via try/catch in LiquidTemplateEngine

See [DECISIONS.md](./DECISIONS.md) for the full ADR log.
