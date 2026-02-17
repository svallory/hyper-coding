# CLI Design System

An open-source Design System for command-line interfaces. Not a component library. Not a styling utility. A **system** — with principles, tokens, primitives, components, recipes, and theming — that gives CLI developers the same coherence and consistency that web developers get from Material, Radix, or Shadcn.

**Value prop:** One tool, one design language, one import. Instead of gluing together five different libraries and hoping they look coherent, developers get a unified system where everything works together by design.

---

## Rules

1. **TypeScript only.** The entire system is authored in and for TypeScript.
2. **No architectural lock-in.** The DS must work in a simple `console.log` script, a complex interactive CLI, or anything in between. We may use other libraries internally, but the consumer should never be affected by that choice.
3. **Decisions are documented.** Every "why" gets written down. Future contributors shouldn't have to reverse-engineer intent.

---

## Project Structure

### [Phase 1: Design](design/INDEX.md) — COMPLETE

The design specification. Principles, tokens, primitives, components, recipes, and theming — all documented before a single line of implementation code is written.

### [Phase 2: Implementation](implementation/INDEX.md) — COMPLETE

Working TypeScript library with 583 tests. Terminal capability detection, token/theme engines, rendering, 12 primitives, 16 components, public API, and testing utilities.

### [Publishing & Infrastructure](publishing/INDEX.md) — NOT STARTED

Package strategy, CI/CD, versioning, documentation site, and migration guides. Deferred until core implementation is stable.
