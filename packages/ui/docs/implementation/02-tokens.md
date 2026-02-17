# Step 2 — Token Engine

**Goal:** Implement the token resolution system — the bridge between semantic names and terminal output.

---

## Activities

- Define all token types in TypeScript matching [03-tokens.md](../design/03-tokens.md):
  - `ColorToken` — semantic color roles with per-tier values (truecolor hex, 256-color index, 16-color ANSI code)
  - `TypographyToken` — maps semantic roles to ANSI SGR attributes
  - `SpacingToken` — numeric values for indentation, line spacing, padding
  - `SymbolToken` — Unicode/ASCII pairs
  - `BorderToken` — box-drawing character sets
  - `MotionToken` — spinner frames, progress characters, timing intervals
- Implement the default token set (the `default` theme's concrete values)
- Build the token resolver: `(tokenName, capabilities) → resolved value`
  - Color tokens resolve through the degradation chain based on detected color depth
  - Symbol tokens resolve Unicode vs. ASCII based on encoding detection
  - Motion tokens resolve animated vs. static based on TTY/CI status
- Token values are cached after first resolution; cache invalidates on theme change

---

## Key Design Decisions

- Tokens are plain objects, not classes. Serializable to/from JSON.
- The resolver is a pure function: same token + same capabilities = same output. No side effects.
- Color conversion (hex → nearest 256 → nearest 16) is built-in. Theme authors can override the automatic conversion by providing explicit per-tier values.

---

## Deliverable

`src/tokens/` — token types, default values, resolver

---

## Tests

- Every token resolves correctly at each capability tier
- Color degradation produces visually reasonable fallbacks (not just mathematically nearest)
- Symbol fallback pairs render at consistent widths
- Serialization round-trip: `JSON.parse(JSON.stringify(tokens))` produces identical resolution
