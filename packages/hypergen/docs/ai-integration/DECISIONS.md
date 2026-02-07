# Architecture Decision Records (ADR)

> This is a **living document**. Decisions are appended as they are made. Each entry records the context, decision, and rationale.

**Last Updated**: 2026-02-07

---

## Implementation Decisions (Feb 2026)

These decisions were made during actual implementation, superseding earlier spec-phase decisions where they conflict.

### ADR-I1: Vercel AI SDK over custom provider abstraction

**Context**: The earlier spec proposed custom `AnthropicProvider`, `OpenAIProvider`, `GoogleProvider` classes with a `BaseLLMProvider` abstract class.

**Decision**: Use the [Vercel AI SDK](https://sdk.vercel.ai/) (`ai` package) for all provider interactions.

**Rationale**: The AI SDK already handles provider abstraction, streaming, token counting, retries, and rate limiting. Reimplementing this is months of work for a worse result. Provider SDKs (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.) are dynamically imported so they remain truly optional dependencies.

---

### ADR-I2: Single `{% ai %}` tag instead of 7 template tags

**Context**: The spec proposed `{% ai.implement %}`, `{% ai.generate_imports %}`, `{% ai.generate_props %}`, `{% ai.generate_schema %}`, `{% ai.generate_tests %}`, `{% ai.generate_jsx %}`, and `{% ai.complete %}`.

**Decision**: A single `{% ai %}{% endai %}` block tag that takes a prompt as its body and optional attributes for model, context, etc.

**Rationale**: Seven tags create a large API surface with overlapping semantics. A single tag with a prompt is more flexible, easier to learn, and covers all use cases. The prompt itself describes what to generate.

---

### ADR-I3: Explicit context files instead of automatic AST analysis

**Context**: The spec proposed a `ContextAnalyzer` that automatically discovers related files via AST parsing, import analysis, and pattern detection.

**Decision**: Context is specified explicitly via `context.files` globs in the step/tag config. A `ContextCollector` reads and bundles them, but performs no analysis.

**Rationale**: Automatic AST analysis is complex, fragile, and hard to debug. Explicit context is predictable, fast, and gives the user full control. If a user wants `src/services/*.ts` as context, they list it.

---

### ADR-I4: Token limit checked before cost limit in budget enforcement

**Context**: `CostTracker` enforces both token limits and cost limits.

**Decision**: Token limit is checked first. If the estimated token count exceeds the budget, the call is rejected before estimating cost.

**Rationale**: Token counting is cheap (local computation). Cost estimation requires knowing the model pricing. Fail fast on the cheaper check.

---

### ADR-I5: Dynamic imports for provider SDKs

**Context**: Provider SDKs (`@ai-sdk/anthropic`, `@ai-sdk/openai`) are large packages.

**Decision**: All provider SDK imports use dynamic `import()` inside `ModelRouter.resolve()`. They are listed as `optionalDependencies` in `package.json`.

**Rationale**: Users who never use AI features should not pay the install/bundle cost. Dynamic imports mean the SDK is only loaded when an AI step actually executes.

---

### ADR-I6: Graceful degradation for AI tag

**Context**: Templates containing `{% ai %}` tags may be used in environments where AI is not configured.

**Decision**: The `{% ai %}` tag implementation in `LiquidTemplateEngine` wraps execution in try/catch. On failure (no API key, network error, etc.), it emits a warning comment in the output instead of crashing.

**Rationale**: A template should always produce output. Crashing on a missing API key breaks the entire generation pipeline. The user sees a clear warning in the generated file and can fill in the section manually.

---

## Spec-Phase Decisions (Feb 2026, earlier)

The following decisions were made during the specification phase. They remain valid unless superseded by an implementation decision above.

---

### ADR-S1: Support Both Hook Patterns (Phased)

**Context**: Both Gemini CLI and Claude Code have mature hook systems.

**Decision**: Phase 1 uses internal TypeScript classes. Phase 2 exposes Hypergen as a hook handler for external AI tools.

**Status**: Phase 1 implemented. Phase 2 deferred.

---

### ADR-S2: Provider-Specific Retry Logic

**Decision**: Provider-specific retry with a thin generic wrapper. Respects `retry-after` headers, exponential backoff with `min(baseDelay * 2^attempt, maxDelay)`.

**Status**: Handled by Vercel AI SDK (see ADR-I1).

---

### ADR-S3: Smart Caching with Invalidation

**Decision**: Cache LLM responses keyed by prompt hash + context hash + model version. TTL-based invalidation (24h default).

**Status**: Deferred to Phase 2.

---

### ADR-S4: Environment Variables for API Keys

**Decision**: Environment variables are the primary mechanism. Strings starting with `$` in config are resolved from env. NEVER set default values for API keys.

**Status**: Implemented in `AiService`.

---

### ADR-S5: Tiered Validation Pipeline

**Decision**: Configurable validation strategies per check type (auto-retry, prompt-user, partial-accept, fail).

**Status**: Implemented via `guardrails` config in `AIStep` and `output-validator.ts`.

---

### ADR-S6: Multi-Provider with Fallback Chains

**Decision**: Support multiple providers with fallback. `ModelRouter` resolves from config with fallback chain.

**Status**: Implemented in `model-router.ts`.

---

### ADR-S7: CLI Only for MVP

**Decision**: No IDE integration. CLI works everywhere. AI tools already have IDE integrations.

**Status**: Current.

---

### ADR-S8: No AI Generation in CI

**Decision**: Non-deterministic outputs break CI. Default `allowInCI: false`.

**Status**: Current.
