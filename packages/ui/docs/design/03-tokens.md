# CLI Design System — Token System

## Purpose

Tokens are the abstract design vocabulary of the system. They are named, semantic values that decouple *intent* from *implementation*. A component never says "make this red" — it says "make this `color.error`," and the token system resolves that to the right value for the current environment.

Tokens are the single source of truth. Change a token, and every component that uses it updates. Override a token in a theme, and the override cascades everywhere.

**Naming rule:** Every token is named for what it *means*, never for what it *looks like*. `color.error`, not `color.red`. `typography.emphasis`, not `typography.bold`. `symbol.success`, not `symbol.checkmark`.

---

## Token Categories

| Category | What it governs |
|---|---|
| [Color](#color-tokens) | Semantic color roles for foreground text |
| [Typography](#typography-tokens) | Text decoration and styling (bold, dim, italic, etc.) |
| [Spacing](#spacing-tokens) | Indentation, padding, vertical rhythm |
| [Symbol](#symbol-tokens) | Semantic glyphs with Unicode/ASCII pairs |
| [Border](#border-tokens) | Box-drawing characters and divider styles |
| [Motion](#motion-tokens) | Spinner sequences and animation timing |

---

## Color Tokens

### Design Decisions

1. **Semantic roles only.** Tokens are named for meaning (`error`, `success`), never for hue (`red`, `green`).
2. **Foreground-first.** The vast majority of CLI color use is foreground text. Background color is used sparingly and intentionally.
3. **ANSI 16 as the base tier.** The default theme targets the 16 standard ANSI colors because these are remapped by terminal themes (Dracula, Solarized, etc.) to match the user's chosen aesthetic. Using ANSI colors means the DS inherits the user's terminal theme for free.
4. **Truecolor as an enhancement.** When detected, the system can use richer, more precise colors. But the 16-color version must always be legible.
5. **No bright colors in the base set.** Bright ANSI variants (`brightRed`, `brightGreen`, etc.) are reserved because Solarized and other themes repurpose them. The standard 8 colors are more universally reliable.

### Core Color Roles

These are the semantic color tokens every component in the system can reference.

| Token | Semantic meaning | ANSI 16 | 256-color | Truecolor (dark) |
|---|---|---|---|---|
| `color.fg` | Default foreground text | (terminal default) | (terminal default) | (terminal default) |
| `color.fgMuted` | De-emphasized, secondary text | `dim` | `dim` | `dim` attribute |
| `color.error` | Errors, failures, destructive actions | `red` | `196` | `#f87171` |
| `color.warning` | Warnings, cautions, non-fatal issues | `yellow` | `214` | `#fbbf24` |
| `color.success` | Success, completion, positive outcomes | `green` | `34` | `#4ade80` |
| `color.info` | Informational, neutral highlights | `cyan` | `39` | `#38bdf8` |
| `color.accent` | Interactive elements, links, focus states | `blue` | `33` | `#60a5fa` |
| `color.emphasis` | High-importance text within a message | `bold` (attr) | `bold` (attr) | `bold` (attr) |
| `color.code` | Inline code, commands, file paths, flags | `cyan` | `37` | `#67e8f9` |
| `color.heading` | Section headers, titles | `bold` (attr) | `bold` (attr) | `bold white` |

### Background Color Roles

Used sparingly — primarily for badges, highlights, and selection states.

| Token | Semantic meaning | ANSI 16 | Notes |
|---|---|---|---|
| `color.bgError` | Error badge background | `bgRed` | Pair with white/bright foreground |
| `color.bgWarning` | Warning badge background | `bgYellow` | Pair with black foreground |
| `color.bgSuccess` | Success badge background | `bgGreen` | Pair with black foreground |
| `color.bgInfo` | Info badge background | `bgCyan` | Pair with black foreground |
| `color.bgHighlight` | Selection highlight, search match | `bgBlue` | Pair with white foreground |

### Diff Color Roles

| Token | Semantic meaning | ANSI 16 |
|---|---|---|
| `color.diffAdded` | Added lines/content | `green` |
| `color.diffRemoved` | Removed lines/content | `red` |
| `color.diffContext` | Unchanged context lines | `dim` |
| `color.diffHunk` | Hunk headers (`@@...@@`) | `cyan` |

### Color Resolution

The system resolves color tokens through a capability-aware pipeline:

```
1. Token name (e.g., `color.error`)
2. Theme lookup (user overrides first, then built-in theme)
3. Capability detection (truecolor? 256? 16? none?)
4. Value selection (pick the value for the detected tier)
5. NO_COLOR / FORCE_COLOR override (strip or force)
6. ANSI escape code output
```

**Environment variable priority (highest to lowest):**

1. `NO_COLOR` (if set, strip ALL color — no exceptions)
2. `FORCE_COLOR` (if set, force color even in non-TTY)
3. `COLORTERM=truecolor` or `COLORTERM=24bit` → truecolor
4. `TERM` ending in `256color` → 256-color
5. TTY detection → 16-color if TTY, no color if piped
6. `TERM=dumb` → no styling at all

---

## Typography Tokens

Typography in the terminal is limited to ANSI SGR (Select Graphic Rendition) attributes. There are no fonts, no font sizes, no font weights beyond bold. The system assigns semantic meaning to each available attribute.

### Attribute Support Tiers

| Attribute | SGR code | Support level | System stance |
|---|---|---|---|
| **Bold** | `1` | Universal | Primary emphasis tool |
| **Dim / faint** | `2` | Broad (all modern terminals) | Primary de-emphasis tool |
| **Italic** | `3` | Broad (most modern terminals) | Secondary emphasis; used with caution |
| **Underline** | `4` | Universal | Links, interactive cues |
| **Strikethrough** | `9` | Moderate (most modern terminals) | Deprecation, deletion |
| **Blink** | `5` | Varies | **Banned.** Never used |
| **Inverse** | `7` | Universal | Selection states, badges |
| **Overline** | `53` | Poor | Not used |

### Semantic Typography Tokens

| Token | ANSI attributes | When to use |
|---|---|---|
| `type.emphasis` | `bold` | Key terms, important values, primary information |
| `type.strong` | `bold` + color | Headings, critical labels |
| `type.deEmphasis` | `dim` | Secondary info, timestamps, metadata, hints |
| `type.code` | `color.code` | Inline code, commands, file paths, flag names |
| `type.link` | `underline` + `color.accent` | Clickable URLs (OSC 8 when supported) |
| `type.deleted` | `strikethrough` + `dim` | Removed or deprecated content |
| `type.heading1` | `bold` + `underline` | Top-level section headers |
| `type.heading2` | `bold` | Sub-section headers |
| `type.heading3` | `bold` + `dim` | Minor section headers |
| `type.label` | `bold` | Key in key-value pairs, column headers |
| `type.caption` | `dim` + `italic` | Supplementary notes, help text |

### Typographic Hierarchy

The system defines a clear hierarchy for output structure:

```
Level 1: bold + underline         "Setup"
Level 2: bold                     "Database Configuration"
Level 3: bold + dim               "Connection Parameters"
Body:    (default)                 "host: localhost"
Caption: dim + italic             "Using default port 5432"
Muted:   dim                      "Last updated 2 minutes ago"
```

---

## Spacing Tokens

Spacing in terminals is measured in characters (horizontal) and lines (vertical). There is no sub-character positioning.

### Horizontal Spacing

| Token | Value | Use case |
|---|---|---|
| `space.indent` | `2` characters | Standard indentation per nesting level |
| `space.indentLarge` | `4` characters | Wide indentation (code blocks, deep nesting) |
| `space.gutter` | `2` characters | Gap between columns (e.g., between a flag name and its description) |
| `space.gutterLarge` | `4` characters | Gap between major columns |
| `space.padding` | `1` character | Inner padding (inside boxes, between icon and text) |
| `space.paddingLarge` | `2` characters | Generous inner padding |
| `space.iconGap` | `1` character | Space between a status icon and its text |

### Vertical Spacing

| Token | Value | Use case |
|---|---|---|
| `space.lineNone` | `0` blank lines | Items within a dense group |
| `space.lineCompact` | `0` blank lines | List items, table rows — no extra spacing |
| `space.lineNormal` | `1` blank line | Between sections, between a heading and its content |
| `space.lineRelaxed` | `2` blank lines | Between major sections of output |

### Layout Constraints

| Token | Value | Use case |
|---|---|---|
| `layout.maxWidth` | `100` characters | Maximum content width for readability |
| `layout.minWidth` | `40` characters | Minimum width before switching to compact mode |
| `layout.defaultWidth` | `80` characters | Assumed width when detection fails |

---

## Symbol Tokens

Every symbol has a semantic name, a Unicode glyph, and an ASCII fallback. The system picks the right one based on terminal capability.

### Status Symbols

| Token | Unicode | ASCII | Meaning |
|---|---|---|---|
| `symbol.success` | `✓` | `[OK]` | Operation succeeded |
| `symbol.error` | `✗` | `[FAIL]` | Operation failed |
| `symbol.warning` | `⚠` | `[WARN]` | Warning condition |
| `symbol.info` | `ℹ` | `[INFO]` | Informational notice |
| `symbol.pending` | `◌` | `[ ]` | Not yet started |
| `symbol.running` | `◉` | `[..]` | In progress (static representation) |
| `symbol.skipped` | `○` | `[SKIP]` | Intentionally skipped |

### Navigation Symbols

| Token | Unicode | ASCII | Meaning |
|---|---|---|---|
| `symbol.arrowRight` | `→` | `->` | Points to, leads to |
| `symbol.arrowLeft` | `←` | `<-` | Returns to, back |
| `symbol.arrowUp` | `↑` | `^` | Upward, increase |
| `symbol.arrowDown` | `↓` | `v` | Downward, decrease |
| `symbol.pointer` | `▸` | `>` | Current selection, active item |
| `symbol.pointerSmall` | `›` | `>` | Nested indicator |

### Structural Symbols

| Token | Unicode | ASCII | Meaning |
|---|---|---|---|
| `symbol.bullet` | `•` | `*` | List item |
| `symbol.dash` | `─` | `-` | Separator, range |
| `symbol.ellipsis` | `…` | `...` | Truncation, continuation |
| `symbol.middot` | `·` | `.` | Separator in inline lists |

### Interactive Symbols

| Token | Unicode | ASCII | Meaning |
|---|---|---|---|
| `symbol.radioOn` | `◉` | `(*)` | Selected radio option |
| `symbol.radioOff` | `○` | `( )` | Unselected radio option |
| `symbol.checkboxOn` | `◼` | `[x]` | Checked checkbox |
| `symbol.checkboxOff` | `◻` | `[ ]` | Unchecked checkbox |
| `symbol.cursor` | `▸` | `>` | Cursor position in select list |

### Symbol Resolution

```
1. Token name (e.g., `symbol.success`)
2. Theme lookup (user overrides first)
3. Capability detection:
   - UTF-8 detected (LANG/LC_ALL) → Unicode glyph
   - ASCII-only or TERM=dumb → ASCII fallback
4. Return resolved glyph
```

---

## Border Tokens

Border tokens define the character sets used for boxes, tables, dividers, and tree-drawing.

### Border Styles

The system ships with named border styles. Each style defines a complete set of characters.

| Style name | Corners | Horizontals | Verticals | Intersections |
|---|---|---|---|---|
| `rounded` (default) | `╭╮╰╯` | `─` | `│` | `├┤┬┴┼` |
| `single` | `┌┐└┘` | `─` | `│` | `├┤┬┴┼` |
| `double` | `╔╗╚╝` | `═` | `║` | `╠╣╦╩╬` |
| `heavy` | `┏┓┗┛` | `━` | `┃` | `┣┫┳┻╋` |
| `dashed` | `┌┐└┘` | `╌` | `╎` | `├┤┬┴┼` |
| `ascii` | `++++` | `-` | `|` | `++++` |

### Border Token Map

| Token | Description | Resolved from style |
|---|---|---|
| `border.topLeft` | Top-left corner | Style-dependent |
| `border.topRight` | Top-right corner | Style-dependent |
| `border.bottomLeft` | Bottom-left corner | Style-dependent |
| `border.bottomRight` | Bottom-right corner | Style-dependent |
| `border.horizontal` | Horizontal line | Style-dependent |
| `border.vertical` | Vertical line | Style-dependent |
| `border.teeRight` | Right-facing tee (`├`) | Style-dependent |
| `border.teeLeft` | Left-facing tee (`┤`) | Style-dependent |
| `border.teeDown` | Downward tee (`┬`) | Style-dependent |
| `border.teeUp` | Upward tee (`┴`) | Style-dependent |
| `border.cross` | Four-way intersection (`┼`) | Style-dependent |

### Tree-Drawing Characters

| Token | Unicode | ASCII | Use |
|---|---|---|---|
| `tree.branch` | `├──` | `|--` | Intermediate child |
| `tree.last` | `└──` | `\--` | Last child |
| `tree.vertical` | `│  ` | `|  ` | Continuation line |
| `tree.indent` | `   ` | `   ` | Indent after last child |

### Divider Tokens

| Token | Description | Default |
|---|---|---|
| `divider.line` | Full-width horizontal rule | `─` repeated to terminal width |
| `divider.dashed` | Dashed horizontal rule | `╌` repeated to terminal width |
| `divider.titled` | Horizontal rule with embedded title | `── Title ──────────` |
| `divider.blank` | Empty line used as a divider | Single blank line |

### Border Resolution

```
1. Border style selection (theme default or component override)
2. Capability detection:
   - UTF-8 → use the Unicode characters from the selected style
   - ASCII-only → force `ascii` style regardless of selection
3. Return character set
```

---

## Motion Tokens

Motion tokens govern animated elements — spinners, progress bars, and their timing.

### Spinner Sequences

| Token | Frames (Unicode) | Frames (ASCII) | Use case |
|---|---|---|---|
| `spinner.dots` | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `-\|/-\|/` | Default spinner for indeterminate work |
| `spinner.line` | `─\╲│╱` | `-\|/-\|/` | Alternative minimal spinner |
| `spinner.arc` | `◜◠◝◞◡◟` | `-\|/-\|/` | Smooth circular spinner |

### Progress Bar Characters

| Token | Unicode | ASCII | Use |
|---|---|---|---|
| `progress.filled` | `█` | `#` | Completed portion |
| `progress.partial` | `░` | `-` | Remaining portion |
| `progress.head` | `▌` | `>` | Leading edge |

### Timing

| Token | Value | Use case |
|---|---|---|
| `motion.spinnerInterval` | `80ms` | Frame interval for spinners |
| `motion.progressInterval` | `100ms` | Update interval for progress bars |

### Motion Resolution

```
1. Check for NO_COLOR or --no-animations → disable all motion, use static fallback
2. Check TTY → non-TTY gets static log lines, not animations
3. Check CI detection → static output with timestamps
4. Otherwise → animated output with the specified timing
```

---

## Token Naming Conventions

All tokens follow a consistent naming scheme:

```
<category>.<role>[.<variant>]
```

- **Category:** `color`, `type`, `space`, `symbol`, `border`, `tree`, `divider`, `spinner`, `progress`, `motion`, `layout`
- **Role:** Semantic name (`error`, `success`, `emphasis`, `indent`, etc.)
- **Variant** (optional): Sub-variant (`color.error.bg`, `border.single.topLeft`)

**Rules:**

1. `camelCase` for all token names
2. No abbreviations except universally understood ones (`bg`, `fg`)
3. No raw values in names (no `red`, `bold`, `2px`)
4. Every token must have a JSDoc description explaining its semantic purpose

---

## Token Override Rules

1. **All tokens are overridable** via the theme system (see `07-theming.md`).
2. **Overrides are validated.** A color token must resolve to a valid color value. A symbol token must resolve to a string. A spacing token must resolve to a non-negative integer.
3. **Overrides cascade.** Set `color.error` and every component using it updates. No per-component overrides needed.
4. **Overrides compose with capabilities.** If a user overrides `color.error` with a truecolor value but the terminal only supports 16 colors, the system will downgrade the override value to the nearest 16-color equivalent.
5. **Missing overrides fall through** to the built-in theme defaults.
