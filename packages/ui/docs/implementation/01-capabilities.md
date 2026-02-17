# Step 1 — Terminal Capability Detection

**Goal:** Build the runtime model that answers: "What can this terminal do?"

---

## Activities

- Detect color depth tier (truecolor → 256 → 16 → none) from environment variables (`COLORTERM`, `TERM`, `TERM_PROGRAM`, `FORCE_COLOR`, `NO_COLOR`)
- Detect Unicode support from `LANG`, `LC_ALL`, `LC_CTYPE`
- Detect TTY status per-stream (`stdout.isTTY`, `stderr.isTTY`)
- Detect CI environment (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.)
- Detect `TERM=dumb` (strips all ANSI, not just color)
- Implement the environment variable priority stack from [07-theming.md](../design/07-theming.md#environment-variable-behavior):
  ```
  TERM=dumb → NO_COLOR → FORCE_COLOR → CLI flags → detection
  ```
- Produce an immutable `TerminalCapabilities` context object, resolved once at startup
- Support explicit overrides for testing (`createCapabilities({ colorDepth: 'none', unicode: false })`)

---

## Key Design Decisions

- `NO_COLOR` strips color but preserves bold/dim/underline (per [no-color.org](https://no-color.org) spec)
- `TERM=dumb` strips ALL ANSI codes including typography
- `FORCE_COLOR=0` is equivalent to full monochrome (stronger than `NO_COLOR`)
- Capability detection must be synchronous — no async terminal queries

---

## Deliverable

`src/capabilities/` — exported `detectCapabilities()` function and `TerminalCapabilities` type

---

## Tests

- Unit tests for every env var combination
- Edge cases: conflicting vars (`FORCE_COLOR=3` + `NO_COLOR`), missing vars, empty string values
- Windows-specific detection paths (`TERM_PROGRAM`, ConPTY, Windows Terminal vs. ConHost)
