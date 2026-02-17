# CLI Design System — Theming & Customization

## Purpose

Theming is how consumers customize the design system without forking it. A theme is a set of token overrides that cascade through every component. Change one token, and every component that references it updates.

This document defines:
1. The theme object shape
2. Which tokens are overridable and which are fixed
3. Extension points
4. Built-in theme variants
5. How environment variables affect theming
6. The theming API surface

---

## Theme Object Shape

A theme is a partial override of the token system. It is a plain object with the same structure as the token namespace. Unspecified tokens fall through to the built-in defaults.

```typescript
type Theme = {
  name?: string
  meta?: {
    description?: string
    author?: string
    version?: string
  }

  color?: Partial<ColorTokens>
  type?: Partial<TypographyTokens>
  space?: Partial<SpacingTokens>
  symbol?: Partial<SymbolTokens>
  border?: Partial<BorderTokens>
  motion?: Partial<MotionTokens>
  layout?: Partial<LayoutTokens>

  // Component-level defaults
  components?: {
    table?: { variant?: TableVariant; borderStyle?: BorderStyle }
    message?: { showTimestamp?: boolean }
    spinner?: { style?: SpinnerToken }
    progressBar?: { width?: number }
    list?: { bulletStyle?: BulletStyle }
    // ... other component defaults
  }
}
```

**Key design decisions:**

1. **Partial by design.** A theme only includes what it overrides. Everything else inherits from defaults.
2. **Deep-merged, not replaced.** If a theme specifies `color.error`, only `color.error` changes — other color tokens are untouched.
3. **Typed.** The theme object is fully typed in TypeScript. Autocomplete works. Invalid token names are compile errors.
4. **Serializable.** Themes are plain objects — they can be loaded from JSON files, environment variables, or runtime configuration.

---

## Overridable vs. Fixed

### Fully Overridable

These tokens can be changed by themes without restriction:

| Category | Tokens | Notes |
|---|---|---|
| **Colors** | All `color.*` tokens | Must resolve to valid ANSI color or hex value |
| **Symbols** | All `symbol.*` tokens | Must be a string; system still applies Unicode/ASCII detection |
| **Border style** | `border.style` | Must be one of the named styles or a complete custom character set |
| **Spinner** | All `spinner.*` tokens | Frame arrays; must contain at least 2 frames |
| **Progress** | All `progress.*` tokens | Characters for filled/partial/empty |
| **Spacing** | All `space.*` tokens | Must be non-negative integers |
| **Layout** | `layout.maxWidth`, `layout.minWidth` | Must be positive integers |
| **Typography** | All `type.*` semantic tokens | Mapping of semantic role to ANSI attributes |
| **Component defaults** | All `components.*` | Override default options for any component |

### Fixed (Not Overridable)

These are structural invariants that themes cannot change:

| Invariant | Reason |
|---|---|
| Token name structure | `color.error` is always `color.error` — themes can't rename tokens |
| Degradation chains | The system always degrades truecolor → 256 → 16 → none. Themes can't skip tiers |
| NO_COLOR behavior | When `NO_COLOR` is set, all color is stripped regardless of theme |
| ANSI code generation | Themes provide values; the system generates the escape codes |
| Component output structure | A Message always has icon + text. A Table always has rows and columns. Themes change appearance, not structure |
| Primitive API | Themes don't change what parameters primitives accept |

---

## Extension Points

### Adding Custom Color Roles

Themes can add new color roles beyond the built-in set:

```typescript
const myTheme: Theme = {
  color: {
    // Override built-in
    error: '#ff6b6b',

    // Add new roles
    brand: '#6c5ce7',
    link: '#00b894',
    deprecated: '#636e72',
  }
}
```

Custom roles are accessed the same way as built-in roles: `styledText('text', { color: 'brand' })`.

### Replacing Symbols

Any symbol can be replaced:

```typescript
const myTheme: Theme = {
  symbol: {
    success: '●',      // instead of ✓
    error: '●',         // instead of ✗
    warning: '▲',       // instead of ⚠
    bullet: '→',        // instead of •
  }
}
```

The system still handles Unicode → ASCII fallback for custom symbols. If the consumer provides only a Unicode glyph, they should also provide the ASCII fallback:

```typescript
const myTheme: Theme = {
  symbol: {
    success: { unicode: '●', ascii: '[*]' }
  }
}
```

### Custom Border Styles

Themes can define entirely custom border character sets:

```typescript
const myTheme: Theme = {
  border: {
    custom: {
      topLeft: '╒', topRight: '╕',
      bottomLeft: '╘', bottomRight: '╛',
      horizontal: '═', vertical: '│',
      teeRight: '╞', teeLeft: '╡',
      teeDown: '╤', teeUp: '╧',
      cross: '╪',
    }
  }
}
```

### Component Default Overrides

Themes can change the default options of any component:

```typescript
const myTheme: Theme = {
  components: {
    table: { variant: 'grid', borderStyle: 'single' },
    spinner: { style: 'line' },
    message: { showTimestamp: true },
  }
}
```

Component-level overrides are the lowest priority — they're overridden by options passed directly to the component call.

---

## Built-in Theme Variants

### `default`

The standard theme. Targets dark terminal backgrounds (the vast majority of developer terminals). Uses the ANSI 16-color palette so colors inherit from the user's terminal color scheme.

| Token | Value | Rationale |
|---|---|---|
| `color.error` | ANSI `red` | Universal error color |
| `color.warning` | ANSI `yellow` | Universal warning color |
| `color.success` | ANSI `green` | Universal success color |
| `color.info` | ANSI `cyan` | High readability on dark backgrounds |
| `color.accent` | ANSI `blue` | Common for interactive/link elements |
| `color.code` | ANSI `cyan` | Distinct from body text |
| `border.style` | `rounded` | Modern, friendly feel |
| `symbol.*` | Unicode glyphs | `✓`, `✗`, `⚠`, `ℹ`, `•`, `▸` |

### `minimal`

Stripped-down theme for clean, utilitarian output. Less color, no border decoration.

| Difference from default | Value |
|---|---|
| `border.style` | `ascii` |
| `color.heading` | `bold` only, no color |
| `color.info` | `dim` instead of cyan |
| `symbol.success` | `+` |
| `symbol.error` | `x` |
| `symbol.warning` | `!` |
| `symbol.info` | `-` |
| Table default variant | `borderless` |

**When to use:** Tools targeting minimal environments, log-heavy output, or when the visual style should be invisible.

### `highContrast`

Maximum readability. Uses bold + bright colors for all status indicators. No dim text.

| Difference from default | Value |
|---|---|
| `type.deEmphasis` | Normal weight (not dim) |
| `color.error` | `bold red` |
| `color.warning` | `bold yellow` |
| `color.success` | `bold green` |
| All text | Normal or bold, never dim |
| `symbol.*` | ASCII text labels: `[OK]`, `[FAIL]`, `[WARN]`, `[INFO]` |

**When to use:** Accessibility needs, screen readers, terminals with poor contrast, presentations on projectors.

### `monochrome`

No color at all. Relies entirely on typography (bold, dim, underline) and symbols for visual hierarchy.

| Difference from default | Value |
|---|---|
| All `color.*` | No color applied |
| `type.emphasis` | `bold` |
| `type.deEmphasis` | `dim` |
| `type.heading1` | `bold` + `underline` |
| `type.link` | `underline` |
| Symbols | ASCII text labels |

**When to use:** Piping output through processing tools, environments where color causes issues, printing terminal output to paper.

---

## Environment Variable Behavior

Environment variables override theme settings. They are the highest-priority configuration layer.

### Priority Order (highest to lowest)

```
1. NO_COLOR                    → strip ALL color and ANSI styling
2. FORCE_COLOR                 → force color even in non-TTY
3. TERM=dumb                   → plain text, no ANSI at all
4. CLI flags (--no-color, etc) → per-invocation user choice
5. Theme settings              → developer-configured theme
6. Built-in defaults           → the default theme
```

### `NO_COLOR`

When the `NO_COLOR` environment variable is set (to any value, including empty string), the system:

- Strips all ANSI color codes from output
- Strips all ANSI style codes (bold, dim, underline, etc.)
- Uses ASCII symbol fallbacks (`[OK]`, `[FAIL]`, etc.)
- Disables all animation (spinners become static)
- This is **not overridable** by themes or code. It's a user accessibility choice.

Reference: [https://no-color.org](https://no-color.org)

### `FORCE_COLOR`

When `FORCE_COLOR` is set, the system forces color output even when stdout is not a TTY. Useful for CI systems that support color (GitHub Actions, etc.).

| Value | Behavior |
|---|---|
| `FORCE_COLOR=0` | Equivalent to NO_COLOR |
| `FORCE_COLOR=1` | Force 16-color |
| `FORCE_COLOR=2` | Force 256-color |
| `FORCE_COLOR=3` | Force truecolor |

### `TERM`

| Value | Behavior |
|---|---|
| `TERM=dumb` | No ANSI codes at all — plain text only |
| `TERM=xterm-256color` | 256-color support |
| `TERM=xterm` | 16-color support |

### `COLORTERM`

| Value | Behavior |
|---|---|
| `COLORTERM=truecolor` | 24-bit color support |
| `COLORTERM=24bit` | 24-bit color support |

### CI Detection

When `CI=true` or known CI variables are detected (`GITHUB_ACTIONS`, `CIRCLECI`, `GITLAB_CI`, etc.):

- Spinners are replaced with static log lines
- Progress bars emit periodic percentage updates instead of animations
- All other styling (color, bold, symbols) works normally unless `NO_COLOR` is also set

---

## Theming API Surface

### Initializing with a theme

```typescript
import { createSystem } from 'cli-ds'

// Use a built-in theme
const ds = createSystem({ theme: 'minimal' })

// Use a custom theme
const ds = createSystem({
  theme: {
    color: { error: '#ff6b6b' },
    symbol: { success: '●' },
    components: { table: { variant: 'grid' } }
  }
})

// Extend a built-in theme
const ds = createSystem({
  theme: {
    extends: 'default',
    color: { accent: '#6c5ce7' }
  }
})
```

### Theme composition

Multiple themes merge in order (later overrides earlier):

```typescript
const ds = createSystem({
  theme: [
    'default',                          // base
    brandTheme,                         // company overrides
    { color: { error: '#ff6b6b' } }     // project-specific tweak
  ]
})
```

### Runtime theme switching

For tools that need to change themes at runtime (e.g., light/dark mode detection):

```typescript
const ds = createSystem({ theme: 'default' })

// Later:
ds.setTheme('highContrast')

// Or merge overrides:
ds.mergeTheme({ color: { accent: '#6c5ce7' } })
```

### Accessing resolved tokens

```typescript
const ds = createSystem({ theme: myTheme })

ds.tokens.color.error     // resolved color value for current capability tier
ds.tokens.symbol.success  // resolved glyph for current encoding
ds.tokens.space.indent    // resolved spacing value
```

---

## Theme Resolution Pipeline

When a component requests a token value, the system resolves it through this pipeline:

```
1. Component calls for token (e.g., color.error)
2. Check component-level override (passed directly to component)
3. Check theme.components override
4. Check theme token override
5. Check base theme (if extends is used)
6. Check built-in default
7. Apply capability detection:
   - Color: pick value for detected color depth tier
   - Symbol: pick Unicode or ASCII based on encoding
   - Motion: check TTY/CI/NO_COLOR for animation
8. Apply environment overrides:
   - NO_COLOR: strip all color/style
   - TERM=dumb: strip all ANSI
9. Return resolved value
```

This pipeline runs once per token per session (values are cached after first resolution). Theme changes invalidate the cache.
