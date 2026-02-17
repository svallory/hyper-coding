# Phase 2: Implementation

Turn the [design specification](../design/INDEX.md) into a working TypeScript library.

---

## Rules

1. **The spec is the source of truth.** Implementation follows the design docs. If reality forces a deviation, update the spec first, then implement.
2. **Bottom-up.** Build tokens before primitives, primitives before components. Each layer's tests pass before starting the next.
3. **Ship incrementally.** Each step produces a usable, testable, publishable slice of the system.
4. **No runtime dependencies unless justified.** Every dependency is a decision. Document why it's needed and what it would cost to remove.

---

## Steps

| Step | Document | Goal | Deliverable |
|------|----------|------|-------------|
| 1 | [01-capabilities.md](01-capabilities.md) | Detect what the terminal can do | `src/capabilities/` |
| 2 | [02-tokens.md](02-tokens.md) | Token types and resolution engine | `src/tokens/` |
| 3 | [03-themes.md](03-themes.md) | Theme loading, composition, switching | `src/theme/` |
| 4 | [04-renderer.md](04-renderer.md) | ANSI escape sequences and string utils | `src/render/` |
| 5 | [05-primitives.md](05-primitives.md) | 12 atomic building blocks | `src/primitives/` |
| 6 | [06-components.md](06-components.md) | 16 composed components | `src/components/` |
| 7 | [07-api-surface.md](07-api-surface.md) | Public API and `createSystem()` | `src/index.ts` |
| 8 | [08-testing-utils.md](08-testing-utils.md) | Testing toolkit for consumers | `src/test/` |

---

## Dependency Graph

```
Step 1: Capabilities ─────┐
                          ▼
Step 2: Tokens ──────► Step 3: Themes
                          │
                          ▼
                    Step 4: Renderer
                          │
                          ▼
                    Step 5: Primitives
                          │
                          ▼
                    Step 6: Components
                          │
                          ▼
                    Step 7: API Surface
                          │
                          ▼
                    Step 8: Testing Utils
```

Steps 1 and 2 can begin in parallel. All other steps are sequential.

---

## Current Status

**Phase:** 2 — Implementation — **COMPLETE**
**All 8 steps delivered. 583 tests passing.**
**Next action:** Begin Phase 3 — Publishing & Infrastructure
