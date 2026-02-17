# Step 8 — Testing Utilities

**Goal:** Build the testing toolkit that consumers use to test their own CLI output.

---

## Activities

- `render(output)` — captures styled string output and provides assertions:
  - `.plain` — stripped text content
  - `.styled` — raw string with ANSI codes
  - `.hasColor` — whether color codes are present
  - `.hasStyle(attr)` — whether specific SGR attribute is present
  - `.width` — visual width
  - `.lines` — array of visual lines
- `mockCapabilities(overrides)` — create a capabilities context for testing specific tiers
- `mockTheme(overrides)` — create a theme context for testing themed output
- `snapshot(output)` — deterministic string representation for snapshot testing (strips volatile content like timestamps, normalizes ANSI codes to readable names)
- `stripAnsi(str)` — public utility for consumers who need it
- `compareOutput(actual, expected)` — diff-aware comparison that ignores ANSI codes, reports visual differences

---

## Key Design Decisions

- Testing utilities are a separate entry point: `import { render } from 'cli-ds/test'`. They are NOT bundled in the main package.
- `snapshot()` replaces ANSI codes with readable tokens like `[bold]`, `[red]`, `[/red]` for human-readable snapshots.
- All utilities work without a running terminal — they operate on strings, not stdout.

---

## Deliverable

`src/test/` — testing utilities, exported from `cli-ds/test`

---

## Tests

- `render()` correctly decomposes styled output
- `snapshot()` produces stable, deterministic output
- `mockCapabilities()` correctly overrides detection
- `compareOutput()` identifies visual differences while ignoring ANSI code variations
