# Structured Terminal Messages

## Overview

Add well-formatted, structured message utilities to `@hypercli/core` for displaying error, warning, success, info, and tip messages in the terminal. Complementary to the existing markdown rendering system.

## Visual Format

Inspired by git's error output. Three-tier hierarchy: title, summary (with icon), and optional body under a vertical bar.

```
  Error: process::failed              <- type prefix (colored) + title (default terminal color)

    x  Process git failed: exit code 128   <- icon (colored) + summary (default)
    |
    |  fatal: .git/index open failed       <- bar (colored) + body (dim)
    |  Not a directory
```

### Message Types

| Type      | Icon | Accent Color | Auto Prefix  |
|-----------|------|-------------|--------------|
| `error`   | `x`  | red         | `Error:`     |
| `warning` | `▲`  | yellow      | `Warning:`   |
| `success` | `✔`  | green       | `Success:`   |
| `info`    | `●`  | blue        | `Info:`      |
| `tip`     | `◆`  | cyan        | `Tip:`       |

### Color Rules

- **Type prefix** (e.g. "Error:") — accent color of the message type
- **Title text** (after prefix) — default terminal color
- **Icon** — accent color
- **Summary text** (next to icon) — default terminal color
- **Vertical bar** — accent color
- **Body text** — dim/gray

## API

Simple function-based. Each function returns a formatted string (does not print).

### Signatures

```typescript
function error(summary: string): string
function error(title: string, summary: string): string
function error(title: string, summary: string, body: string | string[]): string

// Same for warning, success, info, tip
```

### Usage Examples

```typescript
// Summary only (no title line)
error("Process git failed: exit code 128")

// Title + summary
warning("deprecated config", "The 'helpers' field has been renamed to 'plugins'")

// Title + summary + body
error("process::failed", "Process git failed: exit code 128",
  "fatal: .git/index open failed: Not a directory")

// Multi-line body
error("validation failed", "3 errors in recipe.yml", [
  "missing required field 'name'",
  "invalid step type 'foobar' at step 3",
  "circular dependency between steps 2 and 5"
])

// Summary only for lightweight messages
success("Generated 4 files in src/components/")
tip("Add --parallel flag to run steps concurrently")
```

### Return Value

Functions return the formatted string. Callers decide how to output:

```typescript
const msg = error("Failed", "details")
logger.log(msg)       // via Logger
console.error(msg)    // direct
messages.push(msg)    // buffer for later
```

## File Structure

```
packages/core/src/ui/
├── messages.ts    <- error(), warning(), success(), info(), tip()
├── symbols.ts     <- unicode symbols/icons
└── index.ts       <- re-exports
```

## Exports from Core

```typescript
// packages/core/src/index.ts
export { error, warning, success, info, tip } from "#/ui/index"
export { symbols } from "#/ui/index"
```

## Future Work (Separate PRs)

- Migrate gen's `c` (colors) and `s` (styles) objects into `core/src/ui/`
- Integrate with `HypergenError` for automatic structured error display
