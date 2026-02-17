# CLI Design System — Documentation Guide

## What Is This?

An open-source Design System for command-line interfaces. Not a component library. Not a styling utility. A **system** — with principles, tokens, primitives, components, recipes, and theming — that gives CLI developers the same coherence and consistency that web developers get from Material, Radix, or Shadcn.

**Value prop:** One tool, one design language, one import. Instead of gluing together five different libraries and hoping they look coherent, developers get a unified system where everything works together by design.

**Target:** CLIs — programs invoked from a shell that produce output, not full-screen TUI applications. See [Scope](01-scope.md#cli-vs-tui-a-critical-distinction) for the precise boundary.

---

## How to Navigate This Specification

The design system is documented in 7 specification documents. They build on each other — each references the layers below it.

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

### Reading Order

**First time:** Read in order from 01 to 07. Each document references concepts from prior ones.

**Looking up a specific concern:**

| I want to... | Read |
|---|---|
| Know if something is in scope | [01-scope.md](01-scope.md) |
| Understand a design decision | [02-design-principles.md](02-design-principles.md) |
| See what color/symbol/spacing values exist | [03-tokens.md](03-tokens.md) |
| Understand the smallest building blocks | [04-primitives.md](04-primitives.md) |
| See how to build a table, message, or prompt | [05-components.md](05-components.md) |
| See a full output pattern (deploy, test report, etc.) | [06-recipes.md](06-recipes.md) |
| Customize colors, symbols, or behavior | [07-theming.md](07-theming.md) |

---

## Document Cross-References

### Tokens → Primitives

| Token category | Used by primitive(s) |
|---|---|
| `color.*` | StyledText, Badge |
| `type.*` | StyledText (via style presets) |
| `space.*` | Pad, Indent, Stack |
| `symbol.*` | Symbol |
| `border.*` | Border, Divider |
| `motion.*` | (used by Spinner and ProgressBar components) |
| `layout.*` | Wrap, Truncate, Table, Columns |

### Primitives → Components

| Primitive | Used by component(s) |
|---|---|
| StyledText | All components |
| Symbol | Message, StatusList, List, SelectPrompt, MultiSelectPrompt |
| Pad | Table, KeyValue, HelpLayout, Columns |
| Truncate | Table (cell overflow) |
| Align | Table, KeyValue, HelpLayout, Columns |
| Line | Message, Table (rows), HelpLayout |
| Stack | All multi-line components |
| Indent | Message (details), StatusList (sub-output), Tree, Section |
| Wrap | Message (long text), Panel, HelpLayout |
| Border | Panel, Table (grid variant) |
| Divider | Section, Table (header separator) |
| Badge | StatusList, Diff, AuditReport recipe |

### Components → Recipes

| Component | Used in recipe(s) |
|---|---|
| Message | Error Recovery, Command Summary, Deploy Output, Install Report, Init/Scaffold |
| Spinner | Deploy Output, Install Report, Task Runner |
| ProgressBar | (standalone or within Task Runner) |
| StatusList | Deploy Output, Test Report, Task Runner, Init/Scaffold |
| Table | Audit Report, Config Display |
| List | Changelog, Help Screen |
| Tree | Install Report, Init/Scaffold |
| KeyValue | Command Summary, Deploy Output, Config Display, Interactive Wizard |
| Diff | (standalone) |
| Section | Test Report, Config Display, Changelog |
| Panel | Error Recovery (when boxed display is warranted) |
| HelpLayout | Help Screen |
| Prompts | Interactive Wizard |

---

## Glossary

| Term | Definition |
|---|---|
| **ANSI** | American National Standards Institute. In this context, the ANSI escape code standard for terminal text styling (colors, bold, etc.) |
| **ASCII fallback** | A plain-text alternative for a Unicode symbol, used when the terminal doesn't support Unicode |
| **Badge** | A short text label with a background color, used for status tags |
| **Border style** | A named set of box-drawing characters (rounded, single, double, heavy, ascii) |
| **CI** | Continuous Integration. An automated build/test environment where terminal output is typically non-interactive |
| **CLI** | Command-Line Interface. A program invoked from a shell that accepts arguments and produces output |
| **Color depth** | The number of colors a terminal can display: 8 (3-bit), 16 (4-bit), 256 (8-bit), or 16 million (24-bit truecolor) |
| **Component** | A composed unit of output built from primitives (e.g., Table, Message, Spinner) |
| **Degradation chain** | The ordered sequence of fallbacks when a capability is unavailable (truecolor → 256 → 16 → none) |
| **Design system** | A coherent set of principles, tokens, primitives, components, and patterns that ensure consistent output |
| **Glyph** | A visual character or symbol (e.g., `✓`, `✗`, `⚠`) |
| **Monospace** | A font where every character occupies the same width. All terminal output uses monospace fonts |
| **NO_COLOR** | An environment variable convention. When set, programs should not emit color codes. See [no-color.org](https://no-color.org) |
| **OSC 8** | Operating System Command #8 — the escape sequence for clickable hyperlinks in modern terminals |
| **Primitive** | The smallest indivisible building block of the system (e.g., StyledText, Symbol, Pad) |
| **Recipe** | A documented composition of components that solves a common CLI output pattern |
| **SGR** | Select Graphic Rendition — the ANSI escape code subset that controls text styling (bold, color, etc.) |
| **Theme** | A set of token overrides that customizes the visual output of the system |
| **Token** | A named, semantic design value (e.g., `color.error`, `symbol.success`, `space.indent`) |
| **Truecolor** | 24-bit color support (16.7 million colors), sometimes called "true color" |
| **TTY** | Teletype terminal. In modern usage, a terminal that supports interactive features (as opposed to a pipe or file redirect) |
| **TUI** | Text-based User Interface. A full-screen terminal application (not in scope for this design system) |
| **Unicode** | A character encoding standard that includes symbols, emoji, and box-drawing characters beyond ASCII |
| **Wide character** | A character that occupies two columns in a monospace terminal (e.g., CJK characters, most emoji) |

---

## Design System Rules

These are the non-negotiable constraints from the [roadmap](../INDEX.md):

1. **TypeScript only.** The entire system is authored in and for TypeScript.
2. **No architectural lock-in.** The DS works in a simple `console.log` script, a complex interactive CLI, or anything in between.
3. **Design before code.** Phase 1 (this specification) produces documentation. Code comes in Phase 2.
4. **Decisions are documented.** Every "why" is written down.

---

## Where to Go From Here

This specification is complete for Phase 1. Phase 2 (implementation) will address:

- **Terminal capability model** — runtime detection of color depth, Unicode support, TTY status
- **Rendering strategy** — how tokens become ANSI escape sequences
- **API surface** — functional calls, builder patterns, or tagged templates
- **Testing utilities** — render-to-string, snapshot helpers, strip-ansi comparisons
- **Package strategy** — single tree-shakeable package, ESM-first
- **Documentation site** — Astro-based browsable documentation
- **Migration guides** — from chalk, ora, inquirer, listr2, cli-table3, etc.

---

## Document Status

| Document | Status | Summary |
|---|---|---|
| [INDEX.md](../INDEX.md) | Reference | Project plan and rules |
| [01-scope.md](01-scope.md) | Complete | 17 in-scope areas, CLI vs. TUI boundary |
| [02-design-principles.md](02-design-principles.md) | Complete | 7 principles + system voice |
| [03-tokens.md](03-tokens.md) | Complete | Color, typography, spacing, symbol, border, motion tokens |
| [04-primitives.md](04-primitives.md) | Complete | 12 primitives with API sketches |
| [05-components.md](05-components.md) | Complete | 16 components across feedback, data, layout, interactive, help |
| [06-recipes.md](06-recipes.md) | Complete | 12 documented composition patterns |
| [07-theming.md](07-theming.md) | Complete | Theme shape, built-in variants, env var behavior, API surface |
| [08-documentation-guide.md](08-documentation-guide.md) | Complete | This document — navigation, cross-references, glossary |
