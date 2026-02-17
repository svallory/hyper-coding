# CLI Design System — Components

## Purpose

Components are composed from primitives. They are the things developers actually reach for — a table, a message, a spinner, a prompt. Each component solves a specific output problem and has a well-defined anatomy, variants, and API surface.

**Key properties of all components:**

1. **Composed from primitives.** Every component's anatomy traces back to StyledText, Symbol, Pad, Align, Line, Stack, Indent, Wrap, Border, Divider, and Badge.
2. **Return strings.** Like primitives, components produce strings. They don't write to stdout (with the exception of interactive components like Spinner and Prompt, which manage terminal state).
3. **Token-aware.** All styling comes from tokens, making every component automatically themeable.
4. **Configurable with sensible defaults.** Zero-config produces professional output. Options exist for the 20% who need them.

---

## Component Catalog

| Category | Components |
|---|---|
| **Feedback** | [Message](#message), [Spinner](#spinner), [ProgressBar](#progressbar), [StatusList](#statuslist) |
| **Data** | [Table](#table), [List](#list), [Tree](#tree), [KeyValue](#keyvalue), [Diff](#diff) |
| **Layout** | [Panel](#panel), [Columns](#columns), [Section](#section) |
| **Interactive** | [TextPrompt](#textprompt), [PasswordPrompt](#passwordprompt), [ConfirmPrompt](#confirmprompt), [SelectPrompt](#selectprompt), [MultiSelectPrompt](#multiselectprompt) |
| **Help** | [HelpLayout](#helplayout) |

---

## Feedback Components

### Message

The most common output pattern in any CLI. A single status message with an icon, styled text, and optional detail lines.

**Anatomy:**

```
[Symbol] [StyledText: main message]
  [Indent][StyledText: detail line 1]      ← optional
  [Indent][StyledText: detail line 2]      ← optional
```

**Variants:**

| Variant | Symbol | Color | Use case |
|---|---|---|---|
| `error` | `symbol.error` | `color.error` | Operation failed |
| `warning` | `symbol.warning` | `color.warning` | Non-fatal issue |
| `success` | `symbol.success` | `color.success` | Operation completed |
| `info` | `symbol.info` | `color.info` | Informational note |

**API Sketch:**

```typescript
message(options: {
  level: 'error' | 'warning' | 'success' | 'info'
  text: string
  details?: string | string[]   // indented detail lines
  hint?: string                 // dim, de-emphasized follow-up
}): string
```

**Examples:**

```
✗ Could not connect to database at localhost:5432
  Connection refused — is PostgreSQL running?

⚠ Package lockfile is out of date
  Run `bun install` to update

✓ Deployed to production (2.3s)

ℹ Using config from ~/.config/myapp/config.yml
```

**Degradation:** Without color, the symbol changes to `[FAIL]`/`[WARN]`/`[OK]`/`[INFO]` and no ANSI codes are emitted.

---

### Spinner

An animated indicator for indeterminate operations. Unlike other components, the spinner writes directly to the terminal and manages cursor state.

**Anatomy:**

```
[Animated Symbol] [StyledText: message]
```

Resolves to a static line on completion:

```
[Symbol.success/error] [StyledText: final message] [dim: duration]
```

**API Sketch:**

```typescript
spinner(options?: {
  text?: string
  style?: SpinnerToken         // default: 'dots'
}): {
  start(text?: string): void
  update(text: string): void
  stop(finalText?: string): void
  succeed(text?: string): void
  fail(text?: string): void
}
```

**Examples:**

Active state:
```
⠋ Installing dependencies...
```

Completed states:
```
✓ Installed 142 packages (3.1s)
✗ Installation failed: EACCES
```

**Degradation:**

| Tier | Behavior |
|---|---|
| TTY + Unicode | Animated braille dots spinner |
| TTY + ASCII | Animated `-\|/` spinner |
| Non-TTY / CI | Static log lines: `[..] Installing dependencies...` → `[OK] Installed 142 packages` |
| NO_COLOR | Animation works, but no color on the final status line |

---

### ProgressBar

A horizontal bar showing determinate or indeterminate progress.

**Anatomy:**

```
[Symbol/Spinner] [StyledText: label] [Bar: ████░░░░░░] [StyledText: percentage] [dim: eta]
```

**API Sketch:**

```typescript
progressBar(options?: {
  total?: number           // if omitted, indeterminate mode
  width?: number           // bar width in characters (default: 30)
  label?: string
  showPercentage?: boolean // default: true
  showETA?: boolean        // default: false
}): {
  start(label?: string): void
  update(current: number, label?: string): void
  increment(amount?: number): void
  stop(finalText?: string): void
  succeed(text?: string): void
  fail(text?: string): void
}
```

**Examples:**

Determinate:
```
⠋ Downloading   ████████░░░░░░░░░░░░  38% (eta 12s)
```

Indeterminate:
```
⠋ Processing... ░░░░█████░░░░░░░░░░░
```

Completed:
```
✓ Downloaded 24.3 MB (8.2s)
```

**Degradation:**

| Tier | Behavior |
|---|---|
| TTY + Unicode | Full animated bar with block characters |
| TTY + ASCII | Animated bar with `#` and `-` |
| Non-TTY / CI | Static percentage updates: `Downloading... 38%` → `Downloading... 100%` |

---

### StatusList

A list of items with status indicators, updated in place. Used for multi-step operations and parallel task tracking.

**Anatomy:**

```
[Symbol: status] [StyledText: task name] [dim: duration/detail]
[Symbol: status] [StyledText: task name] [dim: duration/detail]
[Symbol: status] [StyledText: task name] [dim: duration/detail]
```

**API Sketch:**

```typescript
statusList(items: Array<{
  text: string
  status: 'pending' | 'running' | 'success' | 'error' | 'warning' | 'skipped'
  detail?: string
}>): string

// Or imperative for live updates:
statusList(options?: {
  concurrent?: boolean   // show all at once vs. sequential
}): {
  add(text: string): string  // returns item ID
  update(id: string, status: Status, detail?: string): void
  done(): void
}
```

**Examples:**

Static:
```
✓ Compile TypeScript (1.2s)
✓ Run tests (4.8s)
⚠ Lint (3 warnings)
✗ Type check (2 errors)
○ Deploy (skipped)
```

Live (in progress):
```
✓ Compile TypeScript (1.2s)
⠋ Running tests...
◌ Lint
◌ Type check
◌ Deploy
```

---

## Data Components

### Table

Renders structured data in aligned columns.

**Anatomy:**

```
[Row: [Align: header1] [Pad: gutter] [Align: header2] ...]    ← type.label
[Divider: ─────────── ──────────── ...]                         ← border.horizontal
[Row: [Align: cell1]   [Pad: gutter] [Align: cell2]   ...]    ← per row
[Row: [Align: cell1]   [Pad: gutter] [Align: cell2]   ...]
```

**Variants:**

| Variant | Description | When to use |
|---|---|---|
| `minimal` (default) | Header separator only, no outer borders | Most data display |
| `grid` | Full borders around every cell | Dense data needing cell distinction |
| `borderless` | No borders at all, just aligned columns | Simple key-value-like data |
| `outer` | Only outer borders, no internal grid | Contained data blocks |

**API Sketch:**

```typescript
table(options: {
  columns: Array<{
    key: string
    header?: string
    align?: 'left' | 'right' | 'center'  // default: 'left'
    width?: number | 'auto'               // default: 'auto'
    maxWidth?: number
    truncate?: boolean                     // default: true
  }>
  data: Array<Record<string, unknown>>
  variant?: 'minimal' | 'grid' | 'borderless' | 'outer'
  borderStyle?: BorderStyle
  stripedRows?: boolean                    // default: false
  emptyText?: string                       // shown when data is empty
}): string
```

**Examples:**

Minimal (default):
```
Name          Version   License   Size
───────────── ───────── ───────── ──────
react         18.2.0    MIT       2.4 kB
typescript    5.3.2     Apache    12 MB
eslint        8.55.0    MIT       3.1 MB
```

Grid:
```
┌───────────┬─────────┬─────────┬────────┐
│ Name      │ Version │ License │ Size   │
├───────────┼─────────┼─────────┼────────┤
│ react     │ 18.2.0  │ MIT     │ 2.4 kB │
│ typescri… │ 5.3.2   │ Apache  │ 12 MB  │
│ eslint    │ 8.55.0  │ MIT     │ 3.1 MB │
└───────────┴─────────┴─────────┴────────┘
```

Borderless:
```
Name          Version   License   Size
react         18.2.0    MIT       2.4 kB
typescript    5.3.2     Apache    12 MB
eslint        8.55.0    MIT       3.1 MB
```

**Responsive behavior:** When terminal is too narrow to display all columns, the table truncates cell content with ellipsis. Below `layout.minWidth`, components can switch to a stacked key-value format.

---

### List

Renders ordered or unordered lists with optional nesting.

**Anatomy:**

```
[Symbol: bullet/number] [Pad: iconGap] [StyledText: item text]
  [Symbol: bullet]      [Pad: iconGap] [StyledText: nested item]
```

**API Sketch:**

```typescript
list(items: ListItem[], options?: {
  ordered?: boolean           // numbered list (default: false)
  compact?: boolean           // no blank lines between items (default: true)
  bulletStyle?: 'bullet' | 'dash' | 'arrow'  // default: 'bullet'
}): string

type ListItem = string | { text: string; children?: ListItem[] }
```

**Examples:**

Unordered:
```
• Install dependencies
• Configure environment
  • Set DATABASE_URL
  • Set API_KEY
• Run migrations
• Start the server
```

Ordered:
```
1. Install dependencies
2. Configure environment
   a. Set DATABASE_URL
   b. Set API_KEY
3. Run migrations
4. Start the server
```

---

### Tree

Renders hierarchical data with connecting lines.

**Anatomy:**

```
[StyledText: root]
[tree.branch] [StyledText: child]
[tree.branch] [StyledText: child]
[tree.vertical][tree.branch] [StyledText: grandchild]
[tree.vertical][tree.last]   [StyledText: grandchild]
[tree.last]    [StyledText: child]
```

**API Sketch:**

```typescript
tree(root: TreeNode, options?: {
  maxDepth?: number          // truncate at this depth
  showCounts?: boolean       // show hidden node counts when truncated
  formatNode?: (node: TreeNode) => string
}): string

type TreeNode = {
  label: string
  children?: TreeNode[]
}
```

**Example:**

```
my-project
├── src
│   ├── index.ts
│   ├── config.ts
│   └── utils
│       ├── format.ts
│       └── validate.ts
├── tests
│   └── index.test.ts
├── package.json
└── tsconfig.json
```

---

### KeyValue

Renders a set of key-value pairs with aligned keys.

**Anatomy:**

```
[Align: key (type.label)] [Pad: gutter] [StyledText: value]
```

**API Sketch:**

```typescript
keyValue(entries: Array<{
  key: string
  value: string | undefined
}>, options?: {
  separator?: string        // between key and value (default: 2 spaces)
  keyStyle?: StyleSpec      // default: { bold: true }
  nullDisplay?: string      // display for undefined/null (default: '-')
  grouped?: boolean         // add blank lines between groups
}): string
```

**Example:**

```
Name       my-project
Version    2.1.0
License    MIT
Author     Jane Doe
Homepage   https://example.com
```

---

### Diff

Renders a unified or side-by-side diff.

**Anatomy:**

```
[StyledText: file header (type.label)]
[StyledText: hunk header (color.diffHunk)]
[StyledText: context line (color.diffContext)]
[StyledText: removed line (color.diffRemoved)] with - prefix
[StyledText: added line (color.diffAdded)] with + prefix
```

**API Sketch:**

```typescript
diff(options: {
  hunks: DiffHunk[]
  fileHeader?: { old: string; new: string }
  variant?: 'unified' | 'side-by-side'   // default: 'unified'
  context?: number                         // context lines (default: 3)
}): string

type DiffHunk = {
  header: string
  lines: Array<{
    type: 'add' | 'remove' | 'context'
    content: string
  }>
}
```

**Example:**

```
── src/config.ts ─────────────────────

@@ -10,7 +10,8 @@
   const port = process.env.PORT || 3000
-  const host = 'localhost'
+  const host = process.env.HOST || 'localhost'
+  const debug = process.env.DEBUG === 'true'
   return { port, host }
```

---

## Layout Components

### Panel

Wraps content in a bordered box. Built on the `border` primitive but with higher-level options.

**API Sketch:**

```typescript
panel(content: string | string[], options?: {
  title?: string
  titleAlign?: 'left' | 'center' | 'right'
  borderStyle?: BorderStyle
  padding?: number
  width?: number | 'auto'
}): string
```

**Example:**

```
╭─ Warning ────────────────────────╮
│                                  │
│  Your config file is deprecated. │
│  Run `myapp migrate` to update.  │
│                                  │
╰──────────────────────────────────╯
```

---

### Columns

Arranges content in side-by-side columns.

**API Sketch:**

```typescript
columns(cols: Array<{
  content: string | string[]
  width?: number | 'auto' | 'fill'
  align?: 'left' | 'right' | 'center'
}>, options?: {
  gap?: number              // gap between columns (default: space.gutter)
}): string
```

**Example:**

```
Name          Status       Last Deploy
my-app        ● Active     2 hours ago
api-server    ● Active     1 day ago
worker        ○ Stopped    3 days ago
```

---

### Section

Groups content under a heading with consistent spacing.

**API Sketch:**

```typescript
section(options: {
  title: string
  level?: 1 | 2 | 3           // heading level (default: 1)
  content: string | string[]
}): string
```

**Example:**

```
Build Results
─────────────

✓ Compiled successfully (1.2s)
✓ All 42 tests passed
⚠ 3 lint warnings
```

---

## Interactive Components

Interactive components manage terminal state (raw mode, cursor, in-place updates). They are imperative — they take over a portion of the terminal, handle input, and resolve to a value.

### TextPrompt

Single-line text input.

**API Sketch:**

```typescript
textPrompt(options: {
  message: string
  placeholder?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined  // return error message or undefined
  required?: boolean
}): Promise<string>
```

**Example:**

```
? What is the project name? › my-project
```

After submission:
```
✓ What is the project name? my-project
```

---

### PasswordPrompt

Masked text input.

**API Sketch:**

```typescript
passwordPrompt(options: {
  message: string
  mask?: string              // mask character (default: '●')
  validate?: (value: string) => string | undefined
}): Promise<string>
```

**Example:**

```
? Enter your API key: › ●●●●●●●●●●●●
```

---

### ConfirmPrompt

Yes/no binary choice.

**API Sketch:**

```typescript
confirmPrompt(options: {
  message: string
  defaultValue?: boolean     // default: true
}): Promise<boolean>
```

**Example:**

```
? Deploy to production? (Y/n) › Yes
```

---

### SelectPrompt

Choose one option from a list.

**API Sketch:**

```typescript
selectPrompt<T>(options: {
  message: string
  options: Array<{
    label: string
    value: T
    hint?: string
    disabled?: boolean
  }>
  maxVisible?: number        // visible options before scrolling (default: 10)
  filter?: boolean           // enable type-to-filter (default: false)
}): Promise<T>
```

**Example:**

```
? Select a framework:
  ▸ Next.js       (React framework)
    Remix         (Full stack web)
    Astro         (Content-focused)
    SvelteKit     (Svelte framework)
```

With scrolling:
```
? Select a package:
    ...
    eslint
  ▸ prettier
    typescript
    vitest
    ...
```

---

### MultiSelectPrompt

Choose multiple options from a list.

**API Sketch:**

```typescript
multiSelectPrompt<T>(options: {
  message: string
  options: Array<{
    label: string
    value: T
    hint?: string
    disabled?: boolean
    selected?: boolean       // pre-selected
  }>
  required?: boolean         // at least one must be selected (default: false)
  maxVisible?: number
  filter?: boolean
}): Promise<T[]>
```

**Example:**

```
? Select features to enable:
    ◼ TypeScript
    ◼ ESLint
    ◻ Prettier
  ▸ ◻ Testing (vitest)
    ◻ Docker
```

---

## Help Component

### HelpLayout

Formats a help screen with consistent structure: usage line, description, grouped flags, examples, and footer.

**API Sketch:**

```typescript
helpLayout(options: {
  usage: string                    // e.g., 'myapp <command> [options]'
  description?: string
  commands?: Array<{
    name: string
    description: string
    alias?: string
  }>
  flagGroups?: Array<{
    title: string
    flags: Array<{
      short?: string              // e.g., '-v'
      long: string                // e.g., '--verbose'
      description: string
      type?: string               // e.g., 'string', 'number'
      default?: string
      required?: boolean
    }>
  }>
  examples?: Array<{
    command: string
    description: string
  }>
  footer?: string
}): string
```

**Example:**

```
Usage: myapp <command> [options]

A tool for managing deployments.

Commands:
  deploy        Deploy the application
  rollback      Rollback to a previous version
  status        Show deployment status

Options:
  -e, --env <string>     Target environment (default: staging)
  -v, --verbose          Enable verbose output
  -q, --quiet            Suppress non-error output
      --json             Output as JSON
  -h, --help             Show this help message
  -V, --version          Show version number

Advanced:
      --timeout <number> Request timeout in seconds (default: 30)
      --retries <number> Number of retries (default: 3)
      --no-color         Disable colored output

Examples:
  $ myapp deploy --env production
  $ myapp rollback --to v2.1.0
  $ myapp status --json | jq '.url'
```

---

## Component Composition Rules

### Components don't nest arbitrarily

Unlike web components where anything can go inside anything, CLI components have structured composition:

- **Message** is a leaf — it doesn't contain other components.
- **Table** is a leaf — cells contain styled text, not nested tables.
- **Section** is a container — it wraps other components with a heading.
- **Panel** is a container — it wraps any content in a border.
- **StatusList** contains status items, not arbitrary components.

### Spacing between components

Components do **not** add trailing newlines. The caller controls spacing:

```typescript
// The caller composes and spaces:
console.log(
  section({ title: 'Build', content: statusList([...]) }) +
  '\n' +
  section({ title: 'Deploy', content: message({...}) })
)
```

### Static vs. interactive

Static components (Message, Table, List, etc.) return strings. They're pure functions.

Interactive components (Spinner, ProgressBar, Prompts) return imperative handles or promises. They manage terminal state and must be awaited or explicitly stopped.

Never mix static and interactive components on the same lines — interactive components manage cursor position and will overwrite static content if they overlap.
