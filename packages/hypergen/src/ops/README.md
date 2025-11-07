# Operations Module (`src/ops/`)

## Overview

The operations module is the heart of Hypergen's file generation and manipulation system. It provides a plugin-style architecture for executing different types of actions (file creation, code injection, shell commands, etc.) as templates are rendered and executed. Each operation is a self-contained async function that performs a specific task with a predictable interface.

The module follows a **resolver pattern** where frontmatter attributes in template files determine which operations are executed and how they behave.

## Key Concepts

### The Ops Pipeline

When a template is rendered, Hypergen processes it through this flow:

1. **Template Rendering** (`render.ts`) - EJS templates and frontmatter are processed
2. **Operation Resolution** (`index.ts`) - Frontmatter attributes determine which ops to run
3. **Operation Execution** (`execute.ts`) - Each operation is called sequentially with the rendered action
4. **Result Tracking** (`result.ts`) - Operation results are captured with timing and status data

### Actions

An `Action` is a rendered template file with three components:

```typescript
interface RenderedAction {
  file?: string           // Path to the template file (for debugging)
  attributes: any        // Frontmatter YAML parsed as key-value pairs
  body: string          // The rendered template content
}
```

Template frontmatter determines what operations execute:

```ejs
---
to: src/components/<%= name %>.tsx      # Triggers "add" operation
inject: true                             # Modifies to trigger "inject" instead
after: "export default"                 # Injection point for "inject"
sh: npm run format                      # Triggers "shell" operation
spinner: Installing dependencies...    # Shows spinner during shell operation
setup: user/repo                        # Clones git repo with "setup" operation
echo: Component created successfully!  # Triggers "echo" operation
---
// Template body here
```

## File Structure

### Core Operations

| File | Purpose | Triggered By |
|------|---------|--------------|
| **add.ts** | Creates or overwrites files | `to:` without `inject:` |
| **inject.ts** | Inserts code into existing files | `to:` + `inject:` |
| **shell.ts** | Executes shell commands | `sh:` |
| **setup.ts** | Clones git repositories | `setup:` |
| **echo.ts** | Displays messages to user | `echo:` |

### Supporting Files

| File | Purpose |
|------|---------|
| **index.ts** | Operation resolver - maps attributes to operations |
| **result.ts** | Creates result objects with timing data |
| **injector.ts** | Core injection logic (used by inject.ts) |

## Operations Reference

### 1. Add Operation (`add.ts`)

**Triggered by:** `to:` attribute without `inject:`

**Purpose:** Create new files or overwrite existing ones

**Attributes:**
```yaml
to: path/to/file              # Required - destination file path
force: true                   # Optional - skip confirmation prompts
unless_exists: true           # Optional - skip if file exists
skip_if: "some_condition"     # Optional - skip if condition is "true"
from: other/template          # Optional - read file content from another template
```

**Behavior:**
- Creates parent directories if needed
- Prompts user for confirmation if file exists (unless `force: true` or `HYPERGEN_OVERWRITE` env var)
- Respects `unless_exists` flag to skip existing files without prompting
- Supports conditional skipping via `skip_if`
- Can import content from another template file via `from:`

**Example:**
```ejs
---
to: src/utils/helpers.ts
force: true
---
export const helper = () => {
  // implementation
}
```

### 2. Inject Operation (`inject.ts`)

**Triggered by:** `to:` + `inject:` attributes

**Purpose:** Insert code into an existing file at a specific location

**Location Attributes (pick one):**
```yaml
at_line: 5              # Insert at specific line number
before: "pattern"       # Insert before text matching pattern (regex supported)
after: "pattern"        # Insert after text matching pattern (regex supported)
prepend: true          # Insert at file start
append: true           # Insert at file end
```

**Other Attributes:**
```yaml
inject: true           # Required - enables inject mode
skip_if: "pattern"     # Skip injection if pattern exists in file (regex)
eof_last: true         # Ensure newline at end of injection
eof_last: false        # Remove trailing newline from injection
```

**Behavior:**
- Target file must exist or operation fails
- Supports regex patterns for location matching (can span multiple lines)
- `skip_if` prevents injection if pattern already found (idempotent)
- Intelligently handles line endings (auto-detects from file content)
- `eof_last` controls trailing newline behavior

**Example:**
```ejs
---
to: src/middleware/index.ts
inject: true
after: "import type { Request }"
---
import type { Auth } from './auth'
```

### 3. Shell Operation (`shell.ts`)

**Triggered by:** `sh:` attribute

**Purpose:** Execute shell commands during generation

**Attributes:**
```yaml
sh: "npm install"                    # Required - shell command to execute
spinner: "Installing..."             # Optional - show spinner with message
spinner: true                        # Optional - show default spinner
sh_ignore_exit: true                 # Optional - don't fail on non-zero exit
```

**Behavior:**
- Executes in the CWD context
- Supports optional visual spinner feedback
- By default, fails if command returns non-zero exit code
- Can ignore exit codes via `sh_ignore_exit: true`
- Respects dry-run mode (no actual execution)

**Example:**
```ejs
---
sh: npm run build
spinner: Building TypeScript...
---
```

### 4. Setup Operation (`setup.ts`)

**Triggered by:** `setup:` attribute

**Purpose:** Clone or download git repositories as project scaffolding

**Attributes:**
```yaml
setup: "user/repo"              # Required - GitHub repo reference
mode: "tar"                     # Optional - clone mode (default: "tar")
force: true                     # Optional - overwrite existing target
verbose: true                   # Optional - verbose output
```

**Behavior:**
- Uses `degit` library for fast repo cloning (no git history)
- Clones into current directory or specified `to:` path
- Respects `force` flag to overwrite
- Useful for scaffolding projects from templates

**Example:**
```ejs
---
setup: user/boilerplate
to: ./new-project
force: true
---
```

### 5. Echo Operation (`echo.ts`)

**Triggered by:** `echo:` attribute

**Purpose:** Display colored messages to the user

**Attributes:**
```yaml
echo: "Component created successfully!"
```

**Behavior:**
- Outputs to logger (supports colored text via chalk)
- Useful for post-generation feedback
- Non-blocking, informational only

**Example:**
```ejs
---
to: src/components/Button.tsx
---
export const Button = () => { }
---
echo: "✅ Button component created!"
```

## Architecture & Design Patterns

### Operation Interface

All operations follow this async function signature:

```typescript
type Operation = (
  action: RenderedAction,
  args: Record<string, any>,
  config: RunnerConfig,
) => Promise<ActionResult>
```

**Parameters:**
- `action` - The rendered action with attributes and body
- `args` - Command-line arguments and template variables
- `config` - Logger, CWD, prompter, etc.

**Returns:** `ActionResult` object with execution metadata

### The Resolver Pattern (`index.ts`)

The resolver examines frontmatter attributes and builds an array of operations to execute:

```typescript
// Simplified logic:
const ops = []
if (attributes.to && !attributes.inject) ops.push(add)
if (attributes.to && attributes.inject) ops.push(inject)
if (attributes.echo) ops.push(echo)
if (attributes.sh) ops.push(shell)
if (attributes.setup) ops.push(setup)
return ops
```

**Key Points:**
- Operations are discovered dynamically based on attributes
- Multiple operations can run for a single template (e.g., `add` + `echo`)
- Operations are executed in priority order (add/inject first, then shell, setup, echo)
- Each operation is lazy-loaded via dynamic imports

### Result Tracking (`result.ts`)

Results are created using a factory function that captures timing data:

```typescript
const result = createResult('add', 'path/to/file')
// Returns a function that creates result objects:
result('added', payload)  // => { type: 'add', subject: 'path/to/file', status: 'added', timing: 123, payload: {...} }
```

**Result Statuses:**
- `'added'` / `'inject'` / `'executed'` / `'ignored'` - Success states
- `'skipped'` / `'error'` - Other outcomes
- `'missing "to" attribute'` - Error messages

## Injection Algorithm (`injector.ts`)

The injector is the most complex operation. It intelligently inserts code into files:

### Location Finding Algorithm

```
1. Try single-line pattern match
2. If not found, try multi-line pattern match in full text
3. Return appropriate line index for insertion
```

**Pattern Matching:**
- Supports full regex syntax
- Can span multiple lines
- Platform-agnostic (handles CRLF and LF)

### Line Ending Preservation

The injector auto-detects line endings from the target file:

```typescript
const NL = newline(content)  // Returns '\r\n' or '\n'
const lines = content.split(NL)
// ... modifications ...
return lines.join(NL)
```

This ensures the file maintains its original line ending style.

### EOF Handling

```yaml
eof_last: true   # Ensure injected code ends with newline
eof_last: false  # Remove trailing newline from injection body
```

## Dependencies

| Dependency | Purpose |
|------------|---------|
| **fs-extra** | File system operations (promises-based) |
| **chalk** | Terminal color support |
| **ora** | Spinner/loading indicators |
| **degit** | Git repo cloning without history |
| **debug** | Conditional debug logging |
| **enquirer** | User prompts for confirmations |

## How to Contribute/Work with Ops

### Adding a New Operation

1. **Create a new file** in `src/ops/my-operation.ts`

2. **Implement the operation function:**
   ```typescript
   import type { ActionResult, RenderedAction, RunnerConfig } from '../types.js'
   import createResult from './result.js'
   
   const myOp = async (
     action: RenderedAction,
     args: Record<string, any>,
     { logger, cwd }: RunnerConfig,
   ): Promise<ActionResult> => {
     const { attributes: { myAttribute } } = action
     const result = createResult('my-op', myAttribute)
     
     // Check if operation should run
     if (!myAttribute) {
       return result('ignored')
     }
     
     // Do work
     try {
       // ... implementation ...
       return result('executed', payload)
     } catch (error) {
       return result('error', { error: error.message })
     }
   }
   
   export default myOp
   ```

3. **Register in the resolver** (`index.ts`):
   ```typescript
   if (attributes.myAttribute) {
     const myOp = (await import('./my-operation.js')).default
     ops.push(myOp)
   }
   ```

4. **Add tests** in `tests/my-operation.spec.ts`

5. **Update documentation** with the new operation

### Testing Operations

Use the provided test utilities:

```typescript
import { describe, it, expect } from 'bun:test'
import myOp from '~/ops/my-operation.js'
import Logger from '~/logger.js'

describe('my-operation', () => {
  const logger = new Logger(console.log)
  
  it('should execute successfully', async () => {
    const result = await myOp(
      {
        attributes: { myAttribute: 'value' },
        body: 'content',
      },
      {},
      {
        logger,
        cwd: '/tmp/test',
        createPrompter: () => new MockPrompter(),
      },
    )
    
    expect(result.status).toBe('executed')
  })
})
```

### Best Practices

1. **Always create result objects** using `createResult()` for consistent output
2. **Return early** if the operation is not applicable (status: `'ignored'`)
3. **Handle errors gracefully** - return error results instead of throwing
4. **Support dry-run mode** - check `args.dry` before making changes
5. **Provide user feedback** via `logger` methods (ok, warn, err, notice, colorful)
6. **Use debug logging** for development insights: `debug('message %o', data)`
7. **Document attributes** in operation code and README

### Dry-Run Mode

Operations should respect the `args.dry` flag:

```typescript
if (!args.dry) {
  // Make actual changes
  await fs.writeFile(path, content)
} else {
  // Simulate without making changes
  logger.ok(`Would write to: ${path}`)
}
```

## Integration Points

### With render.ts

The ops module receives `RenderedAction[]` produced by render.ts, which:
- Processes EJS templates in template files
- Parses YAML frontmatter into attributes
- Provides context with template variables

### With execute.ts

The execute module:
- Calls the resolver to get operations
- Iterates through operations sequentially
- Collects results with timing data
- Logs operation messages via logger

### With RunnerConfig

Operations rely on the config object for:
- **logger** - User-facing output
- **cwd** - Current working directory context
- **createPrompter** - User confirmation dialogs
- **exec** - Shell command execution (for shell op)
- **helpers** - Custom template functions (for rendering)

## Performance Considerations

1. **Lazy Loading** - Operations are dynamically imported only when needed (faster startup)
2. **Sequential Execution** - Operations run one at a time (predictable, debuggable)
3. **File I/O** - Uses fs-extra for efficient async operations
4. **Regex Caching** - Pattern matching uses compiled regex (in injector)

## Common Issues & Debugging

### Injection not working
- Check that the target file exists
- Verify pattern syntax (supports regex, multiline)
- Check `skip_if` isn't preventing the injection
- Use debug mode: `DEBUG=hypergen:ops:* hypergen ...`

### File overwrite prompts
- Set `force: true` to skip prompts
- Set `HYPERGEN_OVERWRITE=1` environment variable
- Use `unless_exists: true` to silently skip existing files

### Shell commands failing
- Check command syntax and available tools
- Use `sh_ignore_exit: true` to allow non-zero exits
- Check CWD context matches expectations

### Line ending issues
- Injector auto-detects from target file
- All operations preserve original line endings
- Check `eof_last` attribute for EOF handling

## Related Documentation

- **render.ts** - Template rendering and frontmatter parsing
- **execute.ts** - Orchestrates operation pipeline
- **types.ts** - TypeScript interfaces
- **Template Syntax** - Guide to frontmatter attributes (in docs/)

## Migration Notes (Hygen → Hypergen)

This operations system is forked from Hygen with enhancements:
- Added `unless_exists` for safer generation
- Improved `skip_if` handling
- Better line ending detection
- Enhanced error reporting
- Dynamic operation registration

The operation signatures and attributes remain largely compatible with Hygen templates.
## TODO

-   [ ] **Setup (`setup.ts`)**:
    *   Rename `setup` attribute to `from` for clarity.
    *   Add support for `--setup|from` argument overriding `setup`.
    *   Add support for `--mode` argument.
    *   Add support for `--verbose`, `--cache` arguments.
    *   Improve testing infrastructure for `setup` operation.
    *   Rework test generation for better separation to individual tests.