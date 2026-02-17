# Step 6 — Components

**Goal:** Implement the 16 components from [05-components.md](../design/05-components.md).

---

## Activities

- Implement components in dependency order:
  1. **Feedback:** Message, Spinner, ProgressBar, StatusList
  2. **Data display:** Table, List, Tree, KeyValue, Diff
  3. **Layout:** Panel, Columns, Section
  4. **Interactive:** TextPrompt, SelectPrompt, MultiSelectPrompt, ConfirmPrompt, PasswordPrompt
  5. **Help:** HelpLayout
- Each component is a function that accepts an options object and returns a string (for static components) or manages terminal output (for interactive/animated components)
- Static components follow the same pure-function contract as primitives
- Interactive components (prompts) require TTY — provide clear error when stdin is not a TTY
- Animated components (Spinner, ProgressBar) use `setInterval` for TTY, emit static log lines for non-TTY/CI

---

## Key Design Decisions

- Components use primitives internally. A Table uses `pad`, `align`, `divider`, `border`. It does not generate ANSI codes directly.
- Component options accept both token names (`color: 'error'`) and direct values (`color: '#ff0000'`). Token names are resolved through the theme; direct values bypass the theme but still go through capability-based degradation.
- Interactive components are the one exception to "no side effects" — they read stdin and write to stdout/stderr. They are clearly separated from static components in the API.

---

## Deliverable

`src/components/` — one module per component, barrel export

---

## Tests

- Each component variant produces expected output (snapshot tests with `render-to-string`)
- Table handles edge cases: empty data, single column, overflow, mixed-width content
- Spinner/ProgressBar degrade to static output in non-TTY
- Prompts reject gracefully when stdin is not a TTY
- Components respect theme overrides and component-level theme defaults
- All components produce valid output at every capability tier
