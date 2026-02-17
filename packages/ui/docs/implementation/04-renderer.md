# Step 4 — Rendering Engine

**Goal:** Build the layer that converts resolved tokens into ANSI escape sequences.

---

## Activities

- Implement SGR code generation for all ANSI attributes:
  - Color: 16-color (`\e[31m`), 256-color (`\e[38;5;Nm`), truecolor (`\e[38;2;R;G;Bm`)
  - Background color: same three tiers
  - Typography: bold (1), dim (2), italic (3), underline (4), strikethrough (9)
  - Reset: per-attribute reset codes, full reset (`\e[0m`)
- Implement style composition — multiple attributes combine into a single SGR sequence
- Implement the "strip" modes:
  - `NO_COLOR`: strip color codes, preserve typography SGR
  - `TERM=dumb`: strip all SGR codes
  - Non-TTY stream: strip all SGR (unless `FORCE_COLOR`)
- Implement string width calculation (accounting for wide characters, emoji, zero-width joiners)
- Implement ANSI-aware string operations:
  - `stripAnsi(str)` — remove all escape sequences
  - `ansiLength(str)` — visual width excluding escape sequences
  - `ansiSlice(str, start, end)` — slice by visual position, preserving active styles
  - `ansiWrap(str, width)` — word-wrap respecting visual width and active styles
  - `ansiPad(str, width, align)` — pad to visual width
  - `ansiTruncate(str, width, ellipsis?)` — truncate to visual width with optional ellipsis

---

## Key Design Decisions

- The rendering engine is internal. Consumers never write ANSI codes directly — they use tokens and primitives.
- Style composition is additive. `bold + red + underline` produces one opening sequence and one closing sequence, not three nested pairs.
- String width uses the Unicode East Asian Width property + grapheme cluster segmentation for correct emoji/CJK handling.

---

## Deliverable

`src/render/` — SGR generator, strip functions, ANSI-aware string utilities

---

## Tests

- Every SGR attribute generates the correct escape sequence
- Style composition produces minimal escape sequences (no redundant resets)
- Strip modes remove exactly the right codes (NO_COLOR vs. TERM=dumb)
- String width is correct for ASCII, CJK, emoji, combining characters, ZWJ sequences
- ANSI-aware slice/wrap/pad/truncate produce visually correct output
- Round-trip: `stripAnsi(render(token))` produces the plain-text equivalent
