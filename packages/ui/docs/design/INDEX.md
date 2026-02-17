# Phase 1: Design Specification — COMPLETE

The complete design specification for the CLI Design System. Every document builds on the ones before it — read in order for first-time understanding, or jump to a specific concern.

---

## Documents

```
┌─────────────────────────────────────────────┐
│                  Recipes                     │  06-recipes.md
│           Documented compositions            │
├─────────────────────────────────────────────┤
│                Components                    │  05-components.md
│         Table, Message, Spinner, ...         │
├─────────────────────────────────────────────┤
│                Primitives                    │  04-primitives.md
│     StyledText, Symbol, Pad, Align, ...      │
├─────────────────────────────────────────────┤
│                  Tokens                      │  03-tokens.md
│     Color, Typography, Spacing, Symbol, ...  │
├─────────────────────────────────────────────┤
│            Design Principles                 │  02-design-principles.md
│         The rules that govern everything     │
├─────────────────────────────────────────────┤
│                  Scope                       │  01-scope.md
│          What's in, what's out               │
└─────────────────────────────────────────────┘

          Theming (cross-cutting)               07-theming.md
          Customizes all layers
```

| Step | Document | Summary |
|------|----------|---------|
| 1 | [01-scope.md](01-scope.md) | 17 in-scope areas, CLI vs. TUI boundary, explicit out-of-scope list |
| 2 | [02-design-principles.md](02-design-principles.md) | 7 ranked principles + system voice definition |
| 3 | [03-tokens.md](03-tokens.md) | Color, typography, spacing, symbol, border, motion tokens |
| 4 | [04-primitives.md](04-primitives.md) | 12 primitives with API sketches and composition rules |
| 5 | [05-components.md](05-components.md) | 16 components across feedback, data, layout, interactive, help |
| 6 | [06-recipes.md](06-recipes.md) | 12 documented composition patterns |
| 7 | [07-theming.md](07-theming.md) | Theme shape, 4 built-in variants, env var behavior, API surface |
| — | [08-documentation-guide.md](08-documentation-guide.md) | Cross-references, glossary, navigation guide |

---

## Quick Reference

| I want to... | Read |
|---|---|
| Know if something is in scope | [01-scope.md](01-scope.md) |
| Understand a design decision | [02-design-principles.md](02-design-principles.md) |
| See what color/symbol/spacing values exist | [03-tokens.md](03-tokens.md) |
| Understand the smallest building blocks | [04-primitives.md](04-primitives.md) |
| See how to build a table, message, or prompt | [05-components.md](05-components.md) |
| See a full output pattern (deploy, test report, etc.) | [06-recipes.md](06-recipes.md) |
| Customize colors, symbols, or behavior | [07-theming.md](07-theming.md) |
