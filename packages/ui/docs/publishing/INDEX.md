# Publishing & Infrastructure

Everything needed to ship the CLI Design System as a usable package and maintain it as an open-source project. Deferred until the core implementation ([Phase 2](../implementation/INDEX.md)) is stable.

---

## Step 1 — Package Strategy

**Goal:** Define how the system is packaged, distributed, and consumed.

**Activities:**
- Single package (`cli-ds`) vs. scoped packages (`@cli-ds/tokens`, `@cli-ds/components`, etc.) — decide and document trade-offs
- Entry points:
  - `cli-ds` — main package (primitives, components, themes)
  - `cli-ds/test` — testing utilities (separate entry, not bundled in main)
- Module format: ESM-first, CJS compatibility via conditional exports
- Engine requirements: minimum Node.js version (informed by ANSI/TTY API availability)
- Tree-shaking: verify that selective imports produce minimal bundles
- Zero runtime dependencies as the target — document any exceptions and why

**Deliverable:** `package.json` structure, `exports` map, build configuration

---

## Step 2 — Build Tooling

**Goal:** Set up the build pipeline that produces publishable artifacts.

**Activities:**
- TypeScript compilation (declaration files, source maps)
- Bundle strategy: unbundled ESM (preserve module boundaries for tree-shaking) vs. single-file bundle — decide based on Step 1
- Development mode: watch mode, fast rebuild
- Type checking: strict mode, no `any` leaks in public API
- Linting: consistent code style across the codebase

**Deliverable:** Build scripts, `tsconfig.json`, linter config

---

## Step 3 — CI/CD Pipeline

**Goal:** Automated quality gates and release process.

**Activities:**
- **CI checks on every PR:**
  - Type check (`tsc --noEmit`)
  - Lint
  - Unit tests (all platforms: Linux, macOS, Windows)
  - Bundle size check (fail if main export exceeds threshold)
  - API surface diff (detect unintentional breaking changes in public types)
- **Release pipeline:**
  - Semantic versioning (conventional commits → auto-version)
  - Changelog generation from commit history
  - npm publish (automated on tagged release)
  - GitHub Release with changelog body
- **Platform matrix:**
  - Test on Node.js LTS versions
  - Test on Linux, macOS, Windows (terminal behavior differs)

**Deliverable:** GitHub Actions workflows, release scripts

---

## Step 4 — Versioning & Breaking Changes

**Goal:** Define what constitutes a breaking change and how to manage the API contract.

**Activities:**
- Define the public API surface explicitly (what's exported = what's promised)
- Breaking change policy:
  - Token name changes → breaking
  - New tokens → minor
  - Default value changes → minor (with changelog note)
  - Component option additions → minor
  - Component option removal/rename → breaking
  - Theme shape changes → breaking
- Deprecation workflow: deprecated features warn for one minor cycle before removal
- Pre-1.0 policy: `0.x` releases may break between minors (documented)

**Deliverable:** `VERSIONING.md`, API surface snapshot for diff checking

---

## Step 5 — Documentation Site

**Goal:** Turn the markdown specification into a browsable, interactive documentation site.

**Activities:**
- Framework: Astro (static site, markdown-native, component islands for interactive demos)
- Content: all design docs + API reference + getting started guide + migration guides
- Interactive terminal previews: render component output in a terminal emulator widget (xterm.js or similar)
- Theme playground: switch themes and see output change live
- Search: full-text search across all docs
- Hosting: GitHub Pages or Vercel (zero-cost for open source)

**Deliverable:** `docs-site/` — Astro project, deployed and linked from README

---

## Step 6 — Migration Guides

**Goal:** Help developers migrate from existing CLI libraries to the design system.

**Activities:**
- Write migration guides for the most common libraries:
  - **chalk** → `cli-ds` color/typography tokens
  - **ora** → `cli-ds` Spinner component
  - **inquirer / @inquirer/prompts** → `cli-ds` prompt components
  - **listr2** → `cli-ds` StatusList + Task Runner recipe
  - **cli-table3** → `cli-ds` Table component
  - **boxen** → `cli-ds` Panel component
  - **log-symbols** → `cli-ds` Symbol primitive
  - **figures** → `cli-ds` Symbol primitive
- Each guide: side-by-side comparison (before/after), feature mapping table, gotchas

**Deliverable:** `docs/migration/` — one guide per library

---

## Dependency Graph

```
Step 1: Package Strategy ──► Step 2: Build Tooling ──► Step 3: CI/CD
                                                          │
                                                          ▼
                                                    Step 4: Versioning
                                                          │
                                                          ▼
                                                    Step 5: Docs Site
                                                          │
                                                          ▼
                                                    Step 6: Migration Guides
```

Steps 1-4 are sequential. Step 5 can begin as soon as Step 3 is running. Step 6 can begin any time after the core implementation is stable.

---

## Current Status

**Step:** Not started
**Blocked by:** Phase 2 implementation reaching a stable, testable state
