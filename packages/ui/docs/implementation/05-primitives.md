# Step 5 — Primitives

**Goal:** Implement the 12 primitives from [04-primitives.md](../design/04-primitives.md).

---

## Activities

- Implement each primitive as a pure function that returns a string:
  - `styledText(text, style)` — apply color + typography from resolved tokens
  - `symbol(name)` — resolve to Unicode or ASCII glyph based on capabilities
  - `pad(text, width, align?)` — ANSI-aware padding
  - `truncate(text, width, ellipsis?)` — ANSI-aware truncation
  - `align(text, width, alignment)` — left/center/right within width
  - `line(...segments)` — horizontal concatenation of segments
  - `stack(...lines)` — vertical concatenation (join with newlines)
  - `indent(text, level?)` — prepend indentation using `space.indent` token
  - `wrap(text, width?)` — ANSI-aware word wrap
  - `border(content, style?)` — surround with box-drawing characters
  - `divider(width?, style?)` — horizontal rule
  - `badge(text, color?)` — colored label with background
- Every primitive consumes resolved tokens — never raw ANSI codes
- Every primitive respects the current capability context (degrades automatically)
- The Output Contract: all primitives return strings, no side effects, no stdout writes

---

## Key Design Decisions

- Primitives are functions, not classes. No `new`, no `this`.
- Primitives compose via their return values. `indent(stack(line(symbol('success'), ' Done')))` is valid.
- Width defaults to `layout.maxWidth` token when not specified explicitly.

---

## Deliverable

`src/primitives/` — one module per primitive, barrel export

---

## Tests

- Each primitive produces correct output at every capability tier
- Composition produces expected results (indent + stack + line combinations)
- Width-sensitive primitives handle wide characters correctly
- Border/divider handle zero-width and overflow cases
- Badge handles background color degradation (background → bold text → brackets)
