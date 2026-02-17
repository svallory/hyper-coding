# Step 7 — System Entry Point & API Surface

**Goal:** Design and implement the public API — how consumers import and use the system.

---

## Activities

- Implement `createSystem(options?)` — the main entry point:
  ```typescript
  import { createSystem } from 'cli-ds'
  const ds = createSystem({ theme: 'minimal' })
  ```
- The returned `ds` object exposes:
  - `ds.tokens` — resolved token values
  - `ds.capabilities` — detected terminal capabilities
  - `ds.theme` — current theme metadata
  - `ds.setTheme(theme)` — runtime theme switch
  - `ds.mergeTheme(partial)` — runtime theme overlay
  - All primitives and components as methods: `ds.message()`, `ds.table()`, `ds.spinner()`, etc.
- Implement standalone function exports for consumers who don't want the system object:
  ```typescript
  import { message, table, spinner } from 'cli-ds'
  ```
  Standalone functions use the default theme and auto-detected capabilities.
- Implement the `render()` utility for testing:
  ```typescript
  import { render } from 'cli-ds/test'
  const output = render(ds.message({ type: 'error', text: 'Failed' }))
  expect(output.plain).toBe('✗ Failed')
  expect(output.hasColor).toBe(true)
  ```

---

## Key Design Decisions

- Two consumption modes: system object (full control) and standalone functions (zero config). Both are first-class.
- The system object is NOT a singleton. Multiple instances with different themes can coexist (useful for generating output for different targets in the same process).
- Tree-shaking: standalone function imports should tree-shake — importing `message` should not bundle `table`.

---

## Deliverable

`src/index.ts` — public API surface, `src/test/` — testing utilities

---

## Tests

- `createSystem()` with no args produces working defaults
- `createSystem({ theme: 'minimal' })` applies the correct built-in theme
- Custom themes override correct tokens
- Standalone functions produce identical output to system-object methods with default config
- Multiple system instances coexist without interference
- Tree-shaking verification: bundle size test for selective imports
