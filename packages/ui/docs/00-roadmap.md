# CLI Design System — Project Roadmap

## What Is This?

An open-source Design System for command-line interfaces. Not a component library. Not a styling utility. A **system** — with principles, tokens, primitives, components, recipes, and theming — that gives CLI developers the same coherence and consistency that web developers get from Material, Radix, or Shadcn.

**Value prop:** One tool, one design language, one import. Instead of gluing together five different libraries and hoping they look coherent, developers get a unified system where everything works together by design.

---

## Rules

1. **TypeScript only.** The entire system is authored in and for TypeScript.
2. **No architectural lock-in.** We will NOT depend on frameworks like Ink or OpenTUI that force a rendering model on consumers. The DS must work in a simple `console.log` script, a complex interactive CLI, or anything in between. We may use other libraries internally, but the consumer should never be affected by that choice.
3. **Design before code.** Every step in Phase 1 produces documentation, not implementation. Code comes in Phase 2.
4. **Decisions are documented.** Every "why" gets written down. Future contributors shouldn't have to reverse-engineer intent.

---

## Phase 1: Design

### Step 1 — Scope

**Goal:** Define what's IN the design system and what's OUT.

**Activities:**
- Answer the question: "What does a CLI need from a design system?" by cataloging every visual and communicative concern a CLI has (color, typography, spacing, symbols, messages, data display, progress feedback, interactive prompts, layout, etc.)
- For each concern, decide: is this the DS's job or not?
- Define the boundary:
  - **IN scope:** Anything that affects how a CLI looks, feels, and communicates with the user
  - **OUT of scope:** Argument parsing, command routing, process management, file I/O — anything structural/architectural
- Produce a scope document with explicit "in" and "out" lists and rationale for each decision

**Deliverable:** `01-scope.md`

---

### Step 2 — Design Principles

**Goal:** Establish the non-negotiable rules that filter every future decision.

**Activities:**
- Define 5-7 principles that govern the DS (e.g., "accessible by default", "progressive disclosure", "composable over monolithic")
- For each principle, write: the rule, why it matters, and a concrete example of it in action
- Define the system's personality/voice (how does it "sound" when it talks to users?)
- These principles become the tie-breaker for every design argument going forward

**Deliverable:** `02-design-principles.md`

---

### Step 3 — Token System

**Goal:** Define the abstract design language — the vocabulary the entire system speaks.

**Activities:**
- **Color tokens:** Semantic roles, not raw values. "error", "success", "muted" — not "red", "green", "gray"
- **Typography tokens:** Bold, dim, italic, underline, strikethrough — when to use each, what they mean semantically (emphasis, de-emphasis, code, heading, etc.)
- **Spacing tokens:** Indentation units, line spacing rhythm, padding rules
- **Symbol tokens:** Standardized icon vocabulary (checkmark, cross, warning triangle, info circle, arrow, bullet, etc.) with Unicode and ASCII fallback pairs
- **Border tokens:** Box-drawing characters, divider styles, separator patterns
- All tokens are named semantically and designed to be overridable (theming comes in Step 7)

**Deliverable:** `03-tokens.md`

---

### Step 4 — Primitives

**Goal:** Define the atomic, indivisible building blocks of the system.

**Activities:**
- Identify the smallest visual units that can't be broken down further
- For each primitive, define: what it is, what props/options it accepts, what it produces
- Define composition rules: how primitives combine (concatenation, nesting, stacking)

**Deliverable:** `04-primitives.md`

---

### Step 5 — Components

**Goal:** Define how primitives compose into the things developers actually reach for.

**Activities:**
- For each component, define:
  - **Purpose** — what problem it solves
  - **Anatomy** — how it's built from primitives (which ones, in what arrangement)
  - **Variants** — different modes/appearances
  - **API sketch** — what options the developer passes in
  - **Examples** — what it looks like in the terminal (ASCII mockups)
- This step is about the "how" — how primitives assemble into higher-level units
- Things that feel too big or too domain-specific to be components get pushed to Step 6

**Deliverable:** `05-components.md`

---

### Step 6 — Recipes

**Goal:** Document compositions that are too big or too specific for components, but too common to leave undocumented.

**Activities:**
- Identify patterns that emerge from combining multiple components (e.g., error recovery flows, help screens, multi-step wizards, task runner output)
- For each recipe: document the composition, show the expected output, explain when to use it
- Recipes are NOT enforced abstractions — they're documented patterns using existing components

**Deliverable:** `06-recipes.md`

---

### Step 7 — Theming & Customization

**Goal:** Define what users can customize and how.

**Activities:**
- Define the theme object shape (maps to token layer)
- Specify which tokens are overridable and which are fixed
- Define extension points:
  - Can users add new color roles?
  - Can they replace symbols?
  - Can they override component defaults?
- Define built-in theme variants (default, minimal, high-contrast, monochrome)
- Document how `NO_COLOR`, `FORCE_COLOR`, and `TERM` environment variables affect the system
- Define the theming API surface (how does a consumer pass a theme?)

**Deliverable:** `07-theming.md`

---

### Step 8 — Documentation

**Goal:** Compile everything into a complete, browsable design system specification in markdown (later converted to an Astro site).

**Activities:**
- Review and polish all previous deliverables
- Add cross-references between documents (tokens referenced by components, components referenced by recipes)
- Write a README that introduces the system, its philosophy, and how to navigate the docs
- Add a glossary of terms

**Deliverable:** `08-documentation-guide.md` + polished versions of all previous docs

---

## Phase 2: Implementation

Everything below is deferred until Phase 1 is complete. Listed here for awareness, not for planning yet.

- Terminal capability model (color depth detection, Unicode support, CI/pipe detection, graceful degradation)
- Rendering strategy (how tokens become ANSI escape sequences)
- API surface design (functional calls? builder pattern? tagged templates?)
- Testing utilities (render-to-string, snapshot helpers, strip-ansi comparisons, mock terminal)
- Package strategy (single tree-shakeable package, ESM-first, engine requirements)
- CI/CD, versioning, publishing
- Astro documentation site
- Migration guides from popular libraries

---

## Current Status

**Phase:** 1 — Design
**Current Step:** 1 — Scope
**Next action:** Write `01-scope.md`
