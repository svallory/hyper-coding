# CLI Design System — Primitives

## Purpose

Primitives are the smallest, indivisible building blocks of the system. They cannot be broken down further. Every component in the system is assembled from these atoms.

A primitive does one thing: it takes data and tokens, and produces a string. It has no opinion about context — it doesn't know if it's inside a table, a message, or a standalone line. That's the caller's job.

**Key properties of all primitives:**

1. **Pure output.** Every primitive returns a string (or array of strings for multi-line). No side effects. No writing to stdout.
2. **Token-aware.** Primitives resolve token references through the active theme.
3. **Capability-aware.** Primitives adapt their output based on detected terminal capabilities (color depth, Unicode support, terminal width).
4. **Composable.** Primitives combine through string concatenation (inline) or array joining (multi-line).

---

## Primitive Catalog

| Primitive | Purpose | Output |
|---|---|---|
| [StyledText](#styledtext) | Apply ANSI styling to a string | Styled string |
| [Symbol](#symbol) | Resolve a semantic glyph name to a character | Single character/string |
| [Pad](#pad) | Add whitespace padding | Padded string |
| [Truncate](#truncate) | Shorten text to fit a width | Truncated string |
| [Align](#align) | Position text within a fixed-width column | Aligned string |
| [Line](#line) | A single line of horizontal content | String |
| [Stack](#stack) | Join multiple lines vertically | String array |
| [Indent](#indent) | Prepend indentation to content | Indented string(s) |
| [Wrap](#wrap) | Word-wrap text to a width | Multi-line string |
| [Border](#border) | Draw a box border around content | Multi-line string |
| [Divider](#divider) | Draw a horizontal rule | String |
| [Badge](#badge) | Short labeled text with background | Styled string |

---

## StyledText

The most fundamental primitive. Takes a string and applies ANSI styling based on token references or explicit style attributes.

### API Sketch

```typescript
styledText(text: string, style: StyleSpec): string

type StyleSpec = {
  color?: ColorToken       // e.g., 'error', 'success', 'info'
  bg?: ColorToken          // background color token
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
}
```

### Examples

```
styledText('Error', { color: 'error', bold: true })
// → "\x1b[31;1mError\x1b[0m"  (red + bold)

styledText('hint text', { dim: true })
// → "\x1b[2mhint text\x1b[0m"  (dim)
```

### Degradation

| Tier | Behavior |
|---|---|
| Truecolor | Uses hex RGB values from theme |
| 256-color | Maps to nearest 256-color index |
| 16-color | Uses ANSI color name from token |
| No color | Returns plain text, no ANSI codes |

---

## Symbol

Resolves a semantic symbol name to the appropriate glyph for the current environment.

### API Sketch

```typescript
symbol(name: SymbolToken): string

type SymbolToken =
  | 'success' | 'error' | 'warning' | 'info'
  | 'pending' | 'running' | 'skipped'
  | 'arrowRight' | 'arrowLeft' | 'arrowUp' | 'arrowDown'
  | 'pointer' | 'pointerSmall'
  | 'bullet' | 'dash' | 'ellipsis' | 'middot'
  | 'radioOn' | 'radioOff' | 'checkboxOn' | 'checkboxOff'
  | 'cursor'
  // ... extensible via theme
```

### Examples

```
symbol('success')   // → "✓" (Unicode) or "[OK]" (ASCII)
symbol('error')     // → "✗" (Unicode) or "[FAIL]" (ASCII)
symbol('bullet')    // → "•" (Unicode) or "*" (ASCII)
symbol('pointer')   // → "▸" (Unicode) or ">" (ASCII)
```

### Degradation

| Tier | Behavior |
|---|---|
| UTF-8 | Unicode glyph from token |
| ASCII | ASCII fallback from token |
| Screen reader mode | Text label (`[OK]`, `[FAIL]`) |

---

## Pad

Adds whitespace characters to a string.

### API Sketch

```typescript
pad(text: string, options?: {
  left?: number     // characters to prepend (default: 0)
  right?: number    // characters to append (default: 0)
  char?: string     // padding character (default: ' ')
}): string
```

### Examples

```
pad('hello', { left: 2 })           // → "  hello"
pad('hello', { right: 5 })          // → "hello     "
pad('hello', { left: 1, right: 1 }) // → " hello "
```

---

## Truncate

Shortens text to fit within a maximum width, appending an ellipsis if truncated. ANSI-aware — does not count escape sequences toward width. Wide-character-aware — accounts for East Asian and emoji characters.

### API Sketch

```typescript
truncate(text: string, maxWidth: number, options?: {
  position?: 'end' | 'middle' | 'start'  // where to truncate (default: 'end')
  ellipsis?: string                        // truncation indicator (default: token-resolved '…')
}): string
```

### Examples

```
truncate('This is a long string', 12)
// → "This is a l…"

truncate('/usr/local/bin/very-long-path', 20, { position: 'start' })
// → "…/very-long-path"

truncate('abcdefghij', 8, { position: 'middle' })
// → "abc…hij"
```

---

## Align

Positions text within a fixed-width column. Fills remaining space with whitespace (or a specified character).

### API Sketch

```typescript
align(text: string, width: number, options?: {
  alignment?: 'left' | 'right' | 'center'  // default: 'left'
  fill?: string                              // fill character (default: ' ')
}): string
```

### Examples

```
align('Name', 20)                          // → "Name                "
align('42', 10, { alignment: 'right' })    // → "        42"
align('Title', 20, { alignment: 'center'}) // → "       Title        "
```

---

## Line

Composes multiple inline elements into a single line. This is the horizontal composition primitive — it concatenates elements with optional spacing.

### API Sketch

```typescript
line(...parts: Array<string | [string, number]>): string
// string: direct concatenation
// [string, number]: element with allocated column width (aligned left)
```

### Examples

```
line(symbol('success'), ' ', styledText('Build complete', { color: 'success' }))
// → "✓ Build complete"

line([styledText('Name', { bold: true }), 12], ['my-project', 30])
// → "Name        my-project                    "
```

---

## Stack

Joins multiple lines vertically. The vertical composition primitive. Handles spacing between elements.

### API Sketch

```typescript
stack(lines: string[], options?: {
  spacing?: number    // blank lines between items (default: 0)
  prefix?: string     // prepended to each line (e.g., indent)
}): string
```

### Examples

```
stack([
  line(symbol('success'), ' ', 'Build complete'),
  line(symbol('success'), ' ', 'Tests passed'),
  line(symbol('error'),   ' ', 'Lint failed'),
])
// → "✓ Build complete\n✓ Tests passed\n✗ Lint failed"

stack(['Section 1 content', 'Section 2 content'], { spacing: 1 })
// → "Section 1 content\n\nSection 2 content"
```

---

## Indent

Prepends indentation to content. Handles both single-line and multi-line strings.

### API Sketch

```typescript
indent(content: string | string[], level?: number): string | string[]
// level: number of indent units (each unit = space.indent characters, default 2)
// default level: 1
```

### Examples

```
indent('Details here')
// → "  Details here"

indent('Details here', 2)
// → "    Details here"

indent(['Line 1', 'Line 2'], 1)
// → ["  Line 1", "  Line 2"]
```

---

## Wrap

Word-wraps text to fit within a maximum width. ANSI-aware — preserves styling across line breaks.

### API Sketch

```typescript
wrap(text: string, maxWidth: number, options?: {
  hard?: boolean      // break mid-word if necessary (default: false)
  trim?: boolean      // trim leading whitespace on each line (default: true)
}): string
```

### Examples

```
wrap('This is a long message that should be wrapped to fit the terminal width', 40)
// → "This is a long message that should be\nwrapped to fit the terminal width"
```

---

## Border

Draws a box border around multi-line content. Uses border tokens for the character set.

### API Sketch

```typescript
border(content: string | string[], options?: {
  style?: BorderStyle     // 'rounded' | 'single' | 'double' | 'heavy' | 'dashed' | 'ascii'
  title?: string          // optional title in the top border
  titleAlign?: 'left' | 'center' | 'right'
  padding?: number        // inner horizontal padding (default: 1)
  width?: number | 'auto' // box width (default: 'auto')
}): string
```

### Examples

```
border('Hello, world!')
// → ╭───────────────╮
//   │ Hello, world! │
//   ╰───────────────╯

border(['Name    my-project', 'Version 2.1.0'], { title: 'Package', style: 'single' })
// → ┌─ Package ──────┐
//   │ Name    my-proj │
//   │ Version 2.1.0   │
//   └─────────────────┘
```

### Degradation

| Tier | Behavior |
|---|---|
| UTF-8 | Uses the selected border style characters |
| ASCII | Forces `ascii` style (`+`, `-`, `|`) |

---

## Divider

Draws a horizontal rule spanning a width. Uses border tokens for the character.

### API Sketch

```typescript
divider(options?: {
  width?: number          // line width (default: terminal width)
  style?: 'line' | 'dashed' | 'heavy' | 'blank'
  title?: string          // embedded title
  titleAlign?: 'left' | 'center' | 'right'
}): string
```

### Examples

```
divider()
// → "──────────────────────────────────────────"

divider({ title: 'Results', titleAlign: 'center' })
// → "──────────────── Results ─────────────────"

divider({ style: 'blank' })
// → ""  (empty line)
```

---

## Badge

A short piece of text with a background color, used for labels, tags, and status indicators.

### API Sketch

```typescript
badge(text: string, options?: {
  color?: ColorToken       // background color (default: 'info')
  textColor?: ColorToken   // foreground color (default: auto-contrast)
}): string
```

### Examples

```
badge('ERROR')
// → " ERROR " (white text on red background)

badge('v2.1.0', { color: 'success' })
// → " v2.1.0 " (black text on green background)
```

### Degradation

| Tier | Behavior |
|---|---|
| Color supported | Background + contrasting foreground |
| No color | `[ERROR]`, `[v2.1.0]` — bracketed text |

---

## Composition Rules

### Horizontal Composition (inline)

Elements on the same line are composed by string concatenation, optionally with spacing:

```typescript
// Direct concatenation
symbol('success') + ' ' + styledText('Done', { color: 'success' })

// Using the line primitive
line(symbol('success'), ' ', styledText('Done', { color: 'success' }))
```

### Vertical Composition (stacking)

Multi-line output is composed by joining lines with newlines:

```typescript
// Using the stack primitive
stack([
  styledText('Build Results', { bold: true }),
  '',  // blank line
  line(symbol('success'), ' ', 'Compiled successfully'),
  line(symbol('success'), ' ', 'Tests passed (42/42)'),
  line(symbol('error'),   ' ', 'Lint found 3 errors'),
])
```

### Nesting

Primitives nest naturally. A `border` wraps a `stack` of `line` elements that contain `symbol` and `styledText` primitives:

```typescript
border(
  stack([
    line(align('Name', 10), 'my-project'),
    line(align('Version', 10), '2.1.0'),
    line(align('License', 10), 'MIT'),
  ]),
  { title: 'Package Info', style: 'rounded' }
)
```

### The Output Contract

Every primitive returns plain strings. This means:

1. **No special types.** No `TerminalNode` or `RenderTree`. Just strings.
2. **`console.log` works.** You can always `console.log(result)`.
3. **Pipes work.** Output can be piped, redirected, or captured with no special handling.
4. **Testing is simple.** Compare strings. Strip ANSI for content tests.
5. **Composition is concatenation.** No rendering engine, no virtual DOM, no reconciliation.

This is deliberate. The terminal is a string-output medium. The design system respects that.
