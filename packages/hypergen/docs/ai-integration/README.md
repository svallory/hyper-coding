# AI Integration for Hypergen

**Status**: Implementation complete

## Summary

Hypergen's AI integration uses the **"Scaffold + Complete"** pattern: deterministic LiquidJS templates generate file structure and boilerplate, then a single `{% ai %}` tag or `ai` recipe step invokes an LLM to fill in business logic, tests, or other context-dependent code.

Built on the [Vercel AI SDK](https://sdk.vercel.ai/) for provider abstraction, with explicit context files (no automatic AST analysis), token/cost budget enforcement, and graceful degradation when AI is unavailable.

## File Structure

```
src/ai/
  ai-service.ts           # AiService singleton (central gateway)
  ai-config.ts            # All AI configuration types (AiServiceConfig, etc.)
  prompt-pipeline.ts      # PromptPipeline, PromptAssembler
  context-collector.ts    # ContextCollector, ContextBundle
  cost-tracker.ts         # CostTracker, CostSummary
  model-router.ts         # ModelRouter, FallbackChain
  output-validator.ts     # SyntaxValidator, ImportValidator
  index.ts                # Public exports

src/recipe-engine/tools/
  ai-tool.ts              # AiTool extends Tool<AIStep>, AiToolFactory

src/template-engines/
  ai-liquid-tag.ts        # {% ai %}{% endai %} custom tag
```

Modified files: `src/recipe-engine/types.ts`, `src/config/hypergen-config.ts`, `src/errors/hypergen-errors.ts`, `src/recipe-engine/tools/index.ts`, `src/template-engines/liquid-engine.ts`, `src/index.ts`, `package.json`.

Tests: 5 files, 49 tests, all passing.

## Key References

- **Master plan**: [`agent/plans/gleaming-weaving-cherny.md`](../../agent/plans/gleaming-weaving-cherny.md) -- full research, architecture, and implementation breakdown
- **Research papers**: [`agent/research/papers/INDEX.md`](../../agent/research/papers/INDEX.md)
- **Architecture decisions**: [DECISIONS.md](./DECISIONS.md)
- **Implementation details**: [implementation-report.md](./implementation-report.md)

## Documentation in This Directory

| File | Contents |
|------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Concise architecture summary with integration diagram |
| [DECISIONS.md](./DECISIONS.md) | Architecture Decision Records (ADR) |
| [implementation-report.md](./implementation-report.md) | Actual file structure and implementation details |
| [tools/LLM-COMPLETION-TOOL.md](./tools/LLM-COMPLETION-TOOL.md) | AiTool reference |
| [config/CONFIGURATION.md](./config/CONFIGURATION.md) | AiServiceConfig reference |
| [examples/RECIPE-EXAMPLES.md](./examples/RECIPE-EXAMPLES.md) | Recipe YAML examples |
