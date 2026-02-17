# Plan: Replace @hypercli/ui with DS-based Design System

## Context

The current `@hypercli/ui` package is a flat, hardcoded styling layer (~400 LOC, 10 files) that bakes chalk calls directly into implementation. It has no capability detection, no graceful degradation, no theming, and no ANSI-aware string operations. It breaks in CI, `NO_COLOR`, and `TERM=dumb` environments.

The `packages/ds/` package is a substantially complete CLI design system (~2500 LOC, 50+ files) with layered architecture: capabilities → tokens → themes → render engine → primitives → components. It has zero runtime deps (own SGR engine), 4 built-in themes, graceful degradation across all terminal types, ANSI-aware string ops, and comprehensive tests.

**Goal:** Make DS become `@hypercli/ui`, preserving the `c`, `s`, `msg`, `md` convenience API as shortcuts, wrapping `cli-html` behind an abstraction, and dropping chalk entirely.

## Decisions

- Drop chalk — use DS's SGR engine for everything
- Keep cli-html as a dep but wrap it — consumers never import from cli-html directly
- Export convenience shortcuts via `@hypercli/ui/shortcuts` subpath
- DS's `message()` component API differs from UI's `msg.*` — the shortcuts layer bridges this
- **Keep clack for prompts** — do NOT migrate DS's textPrompt/confirmPrompt/selectPrompt. Leave those files in DS source but don't export or wire them up. Prompts remain handled by clack.
- Port UI's visual design language INTO DS components (not just as wrapper hacks in shortcuts)

---

## Step 0: Port UI's visual design language into DS components

**Why:** DS's `message()` produces minimal, unstyled output (`✗ text` with indent). UI's `msg.*` has a rich, opinionated visual language: prefix labels ("Error:"), double indentation, icon gaps, vertical bars for body content, blank line separators. DS components should absorb this design language — not just serve as a backend for the shortcuts to wrap around.

**Components to enhance:**

### `message.ts` — match UI's `msg.*` output format

Current DS output:
```
✗ Connection refused
  is PostgreSQL running?
```

Target (matching UI's aesthetic):
```
  Error: Connection refused

    ×  is PostgreSQL running?
    │
    │  Check your database config
    │  Run: pg_isready -h localhost
```

Changes to `packages/ds/src/components/message.ts`:
- Add `title` field (optional, maps to UI's `prefix` line like "Error: Connection title")
- Add `body` field (optional, rendered with vertical bar connectors)
- Add leading indentation (configurable via spacing tokens)
- Add icon gap between symbol and text (use `space.iconGap` token)
- Add trailing blank line
- The `level` field already exists — extend with `'tip'` level
- Add `tip` symbol to default tokens (◆ / `[TIP]`)
- These become the default component behavior — not just a shortcuts wrapper hack

### `section.ts` — add Hyper's section styling

Currently bare (title + content, no visual treatment). Should support the visual hierarchy UI establishes with dividers, spacing, and heading colors.

### Token additions for Hyper's design language

Add to `defaultTokens`:
- `symbol.tip` — `{ unicode: '◆', ascii: '[TIP]' }` (currently missing from DS)
- `symbol.bar` — `{ unicode: '│', ascii: '|' }` (for body connectors in messages)
- `space.iconGap` already exists (value: 1). Consider if 2 matches UI better (UI uses `ICON_GAP = "  "` which is 2 spaces)

### DS design principle alignment

This is consistent with DS Principle 5 ("Predictable, Then Customizable") — we're making the defaults produce polished, opinionated output. Consumers who want minimal output use the `minimal` theme. The `default` theme should look great out of the box.

---

## Step 1: Move DS source into packages/ui

**What:** Replace `packages/ui/src/` contents with DS source tree. Delete old files, copy DS src into place.

**Files to delete:**
- `packages/ui/src/palette.ts`
- `packages/ui/src/tokens.ts`
- `packages/ui/src/symbols.ts`
- `packages/ui/src/colors.ts`
- `packages/ui/src/styles.ts`
- `packages/ui/src/md.ts`
- `packages/ui/src/messages.ts`
- `packages/ui/src/theme.ts`
- `packages/ui/src/types.ts`
- `packages/ui/src/index.ts`

**Files to copy (DS src/ → UI src/):**
- `capabilities/` (1 file)
- `tokens/` (4 files)
- `theme/` (5 files)
- `render/` (5 files)
- `primitives/` (14 files)
- `components/` (17 files — but prompt components are NOT exported, see Decisions)
- `test/` (5 files)
- `index.ts`

**Note on prompt components:** `textPrompt.ts`, `confirmPrompt.ts`, `selectPrompt.ts` are copied over as DS source but are NOT exported from the package entry points. Clack remains the prompt solution. These can be revisited later.

Also copy DS `tests/` → UI `tests/` (replacing old test files).

Also copy DS `docs/` → UI `docs/` (design docs are valuable).

---

## Step 2: Create the Hyper theme

**New file:** `packages/ui/src/hyper-theme.ts`

Encodes all of current UI's brand opinions as a DS theme object:

```ts
import type { Theme } from './theme/index.ts'

export const hyperTheme: Theme = {
  name: 'hyper',
  meta: { description: 'HyperDev CLI brand theme' },
  color: {
    // Map current palette to DS token roles
    code: '#4EC9B0',        // palette.brand → commands, inline code
    error: 'red',
    warning: 'yellow',
    success: 'green',
    info: 'cyan',
    accent: 'blue',
    // Hyper-specific semantic extensions
    // These go into the theme's component defaults or as custom roles
  },
  symbol: {
    // Match current UI symbols exactly
    error:   { unicode: '×', ascii: '[FAIL]' },
    warning: { unicode: '▲', ascii: '[WARN]' },
    success: { unicode: '✔', ascii: '[OK]' },
    info:    { unicode: '●', ascii: '[INFO]' },
  },
}
```

Plus Hyper-specific color roles that DS doesn't have natively (command, danger, kit, recipe, cookbook, helper, property, required, enum). These get added as custom color extensions in the theme, or mapped to existing DS token roles where they fit.

**Decision on Hyper-specific roles:** DS supports custom color roles in themes. We define them in the hyper theme and access them via `styledText(text, { color: 'kit' as any })` — or better, the shortcuts layer handles the mapping.

---

## Step 3: Create the shortcuts layer

**New file:** `packages/ui/src/shortcuts.ts`

Provides `c`, `s`, `msg`, `md`, `symbols`, `tokens` — the quick opinionated API.

```ts
// c — color functions (thin wrappers over styledText)
export const c = {
  command: (text: string) => styledText(text, { color: 'code' }),
  error:   (text: string) => styledText(text, { color: 'error' }),
  warning: (text: string) => styledText(text, { color: 'warning' }),
  success: (text: string) => styledText(text, { color: 'success' }),
  info:    (text: string) => styledText(text, { color: 'info' }),
  danger:  (text: string) => styledText(text, { color: 'error', bold: true }),
  kit:     (text: string) => styledText(text, { color: 'accent' }),  // was magenta
  recipe:  (text: string) => styledText(text, { color: 'info', bold: true }),
  cookbook: (text: string) => styledText(text, { color: 'accent', bold: true }),
  // ... all 22 methods from current c object
  dim:     (text: string) => styledText(text, { dim: true }),
  bold:    (text: string) => styledText(text, { bold: true }),
  subtle:  (text: string) => styledText(text, { dim: true }),
  text:    (text: string) => text,
  // etc.
}

// s — composite style formatters (icon + text, key:value, etc.)
export const s = {
  success: (text: string) => `${symbol('success')} ${styledText(text, { color: 'success' })}`,
  error:   (text: string) => `${symbol('error')} ${styledText(text, { color: 'error' })}`,
  // ... all methods from current s object
  keyValue: (key, value, indent?) => /* use DS keyValue component */,
  header:   (text, count?) => /* use DS styledText with heading2 typography */,
  listItem: (text) => `${symbol('bullet')} ${text}`,
  hr:       () => divider(),
  md,       // inline markdown processor (see below)
}

// msg — structured message blocks
export const msg = {
  error:   (input) => /* bridge to DS message() component */,
  warning: (input) => /* bridge */,
  success: (input) => /* bridge */,
  info:    (input) => /* bridge */,
  tip:     (input) => /* bridge — maps to DS info with custom icon */,
}

// md — inline markdown → styled text
export function md(text: string): string {
  // Reimplement using DS's styledText instead of chalk
  return text
    .replace(/`([^`]+)`/g, (_, code) => styledText(code, { color: 'code' }))
    .replace(/\*\*([^*]+)\*\*/g, (_, bold) => styledText(bold, { bold: true }))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, dim) => styledText(dim, { dim: true }))
}

// symbols — resolved symbol glyphs
export { resolvedSymbols as symbols }

// tokens — resolved token values
export { resolvedTokens as tokens }
```

The `msg` bridge handles both current API forms:
- String shorthand: `msg.error("something broke")`
- Props object: `msg.tip({ title: "...", summary: "...", body: [...] })`

DS's `message()` component uses `{ level, text, details, hint }`. The bridge maps:
- `summary` → `text`
- `title` → prepended as a prefix line
- `body` → `details`

---

## Step 4: Wrap cli-html behind an abstraction

**New file:** `packages/ui/src/help.ts`

```ts
import { renderMarkdown as cliHtmlRender } from 'cli-html'
import type { Config as CliHtmlConfig, Theme as CliHtmlTheme } from 'cli-html'

// Hyper's help theme config — consumers never see cli-html types
export interface HelpThemeConfig {
  theme?: HelpTheme
  lineWidth?: { max?: number; min?: number }
  asciiMode?: boolean
}

export interface HelpTheme { /* corrected heading types, same as current types.ts */ }

// The default help theme for hyper
export const helpTheme: HelpThemeConfig = { /* current theme.ts content */ }

// Wrapped render function — consumers call this, not cli-html directly
export function renderHelp(markdown: string, theme?: HelpThemeConfig): string {
  const t = theme ?? helpTheme
  return cliHtmlRender(markdown, t.theme as CliHtmlTheme)
}

// General markdown render — wraps cli-html
export function renderMarkdown(markdown: string): string {
  return cliHtmlRender(markdown, helpTheme.theme as CliHtmlTheme)
}
```

This means `custom-help.ts` changes from:
```ts
import { helpTheme, renderMarkdown } from "@hypercli/ui"
this.log(renderMarkdown(md, helpTheme.theme))
```
to:
```ts
import { renderHelp } from "@hypercli/ui"
this.log(renderHelp(md))
```

---

## Step 5: Update package.json exports and deps

**File:** `packages/ui/package.json`

```json
{
  "name": "@hypercli/ui",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./shortcuts": {
      "types": "./dist/shortcuts.d.ts",
      "import": "./dist/shortcuts.js"
    },
    "./help": {
      "types": "./dist/help.d.ts",
      "import": "./dist/help.js"
    },
    "./test": {
      "types": "./dist/test/index.d.ts",
      "import": "./dist/test/index.js"
    }
  },
  "dependencies": {
    "cli-html": "^5.3.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^20.0.0",
    "strip-ansi": "^7.1.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

**Key changes:**
- Remove `chalk` from dependencies
- Keep `cli-html` (used by help wrapper)
- Add `/shortcuts`, `/help`, `/test` subpath exports
- Remove `strip-ansi` from devDeps (DS has its own `stripAnsi`)

---

## Step 6: Initialize system with Hyper theme on import

**File:** `packages/ui/src/index.ts`

The main entry re-exports everything from DS plus initializes the Hyper theme:

```ts
// Auto-initialize the design system with Hyper's brand theme
import { createSystem } from './core-index.ts'  // DS's original index
import { hyperTheme } from './hyper-theme.ts'

const system = createSystem({ theme: hyperTheme })

// Re-export everything from DS EXCEPT prompt components
// (prompts stay with clack — DS prompts not exported)
export * from './core-index.ts'
// Note: core-index.ts must be modified to NOT export textPrompt, confirmPrompt, selectPrompt

// Re-export Hyper-specific modules
export { hyperTheme } from './hyper-theme.ts'
export { renderHelp, renderMarkdown, helpTheme } from './help.ts'
export type { HelpThemeConfig, HelpTheme } from './help.ts'
```

The `/shortcuts` entry auto-initializes too (imports from main, which triggers `createSystem`).

---

## Step 7: Update all consumers

Only 5 files import from `@hypercli/ui` (2 more are commented-out stubs):

### `packages/gen/src/commands/cookbook/list.ts`
```ts
// Before:
import { c, s } from "@hypercli/ui"
// After:
import { c, s } from "@hypercli/ui/shortcuts"
```
No other changes needed — API surface is identical.

### `packages/gen/src/commands/cookbook/info.ts`
```ts
// Before:
import { c, s } from "@hypercli/ui"
// After:
import { c, s } from "@hypercli/ui/shortcuts"
```

### `packages/gen/src/commands/recipe/list.ts`
```ts
// Before:
import { c, s } from "@hypercli/ui"
// After:
import { c, s } from "@hypercli/ui/shortcuts"
```

### `packages/gen/src/hooks/command-not-found.ts`
```ts
// Before:
import { c, msg } from "@hypercli/ui"
// After:
import { c, msg } from "@hypercli/ui/shortcuts"
```

### `packages/cli/src/help/custom-help.ts`
```ts
// Before:
import { helpTheme, renderMarkdown } from "@hypercli/ui"
this.log(renderMarkdown(md, helpTheme.theme))
// After:
import { renderHelp } from "@hypercli/ui/help"
this.log(renderHelp(md))
```

### Indirect cli-html imports (bypass UI, should be consolidated):
- `packages/core/src/errors/hypergen-errors.ts` — `import { renderMarkdown } from "cli-html"` → `import { renderMarkdown } from "@hypercli/ui/help"`
- `packages/core/src/logger/logger.ts` — same change
- `packages/core/tests/logger-markdown.test.ts` — same change

---

## Step 8: Update tsconfig and fix .ts → .js imports

DS source uses `.ts` extension imports (e.g., `from './tokens/index.ts'`). The UI package currently uses `.js` extensions (e.g., `from './palette.js'`).

**Decision:** Keep `.ts` extensions in the migrated source (DS already uses them consistently, and `allowImportingTsExtensions` is in DS's tsconfig). Update `packages/ui/tsconfig.json` to match DS's config.

---

## Step 9: Port and update tests

- Replace `packages/ui/tests/` with DS's test files
- Add new tests for:
  - `shortcuts.ts` — verify `c`, `s`, `msg`, `md` produce expected output
  - `help.ts` — verify `renderHelp` and `renderMarkdown` work
  - `hyper-theme.ts` — verify theme applies correctly
- Ensure old test assertions still pass conceptually (same API, same behavior)

---

## Step 10: Clean up

- Delete `packages/ds/` — it's been absorbed into `packages/ui/`
- Update any references to `cli-ds` package name
- Remove `packages/ds/` from workspace config if listed
- Update `packages/ui/docs/` with migrated design docs from DS

---

## Verification

1. `cd packages/ui && bun run build` — must compile cleanly
2. `cd packages/ui && bun test` — all tests pass
3. `cd packages/gen && bun run build` — consumers compile
4. `cd packages/cli && bun run build` — help system works
5. `bun test` from root — all workspace tests pass
6. Manual smoke test: `./packages/cli/bin/dev.js --help` renders correctly
7. Verify `NO_COLOR=1 ./packages/cli/bin/dev.js --help` degrades gracefully (new capability!)

---

## File Summary

| Action | Path | Description |
|--------|------|-------------|
| Delete | `packages/ui/src/*.ts` (all 10 old files) | Remove old flat implementation |
| Copy | `packages/ds/src/**` → `packages/ui/src/` | DS source becomes UI source |
| Copy | `packages/ds/tests/**` → `packages/ui/tests/` | DS tests become UI tests |
| Copy | `packages/ds/docs/**` → `packages/ui/docs/` | Design docs |
| Create | `packages/ui/src/hyper-theme.ts` | Hyper brand theme |
| Create | `packages/ui/src/shortcuts.ts` | c, s, msg, md, symbols, tokens |
| Create | `packages/ui/src/help.ts` | cli-html wrapper |
| Modify | `packages/ui/src/index.ts` | Re-export DS + auto-init hyper theme |
| Modify | `packages/ui/package.json` | Exports, deps |
| Modify | `packages/ui/tsconfig.json` | Match DS config |
| Modify | `packages/gen/src/commands/cookbook/list.ts` | Import path |
| Modify | `packages/gen/src/commands/cookbook/info.ts` | Import path |
| Modify | `packages/gen/src/commands/recipe/list.ts` | Import path |
| Modify | `packages/gen/src/hooks/command-not-found.ts` | Import path |
| Modify | `packages/cli/src/help/custom-help.ts` | Use renderHelp wrapper |
| Modify | `packages/core/src/errors/hypergen-errors.ts` | Import from @hypercli/ui/help |
| Modify | `packages/core/src/logger/logger.ts` | Import from @hypercli/ui/help |
| Modify | `packages/core/tests/logger-markdown.test.ts` | Import from @hypercli/ui/help |
| Delete | `packages/ds/` | Absorbed into UI |

## Execution Strategy

Steps 1-6 are internal to `packages/ui/` and can be done in parallel by multiple agents. Steps 7-8 are consumer updates (small, mechanical). Steps 9-10 are cleanup.

Recommended agent split:
- **Agent A:** Steps 1, 2, 3, 5, 6 (core migration + new files in packages/ui)
- **Agent B:** Step 4, 7, 8 (help wrapper + consumer updates)
- **Agent C:** Step 9 (tests)
- **Sequential:** Step 10 (cleanup after everything passes)
