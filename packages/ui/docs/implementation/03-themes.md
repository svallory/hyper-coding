# Step 3 — Theme Engine

**Goal:** Implement theme loading, composition, and runtime switching.

---

## Activities

- Implement the `Theme` type from [07-theming.md](../design/07-theming.md#theme-object-shape)
- Build deep-merge for partial theme overrides (theme only includes what it changes)
- Implement `extends` — a theme can extend a named built-in theme
- Implement theme composition: `[base, brand, project]` merges left-to-right
- Implement the four built-in theme variants:
  - `default` — dark terminal, ANSI 16-color palette, Unicode symbols, rounded borders
  - `minimal` — ASCII symbols, borderless tables, dim instead of color for info
  - `highContrast` — bold + bright, no dim, ASCII text labels for symbols
  - `monochrome` — no color, typography-only hierarchy
- Implement runtime theme switching (`setTheme`, `mergeTheme`)
- Implement resolved token access (`ds.tokens.color.error`)
- Wire theme engine to capability detection — theme values pass through capability-based resolution

---

## Key Design Decisions

- Theme composition uses deep merge, not shallow. `{ color: { error: '#ff6b6b' } }` only overrides `color.error`, not all of `color`.
- Component-level defaults in themes (`components.table.variant`) are lowest-priority — direct component options always win.
- Custom color roles (not in the default set) are supported via TypeScript module augmentation for type safety.

---

## Deliverable

`src/theme/` — theme types, merge logic, built-in variants, `createSystem()` entry point

---

## Tests

- Deep merge correctness (nested overrides, array handling, undefined vs. missing)
- Theme composition order (later themes override earlier)
- `extends` resolution (chain of extensions)
- Runtime switching invalidates token cache
- Built-in variants produce expected values for key tokens
- Custom color roles are accessible after theme application
- Environment variables override theme settings at correct priority
