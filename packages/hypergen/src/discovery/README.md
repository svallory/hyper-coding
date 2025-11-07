# Generator Discovery Module

## Overview

The **Discovery Module** is a core subsystem in Hypergen that automatically discovers and catalogs generators from multiple sources. This module enables Hypergen to support a flexible, scalable architecture where generators can be stored locally, in npm packages, within monorepo workspaces, or in git repositories.

### What It Does

The `GeneratorDiscovery` system:
- **Auto-discovers** generators from local directories, npm packages, and workspace structures
- **Identifies actions** within generators using TypeScript decorators
- **Catalogs generators** with metadata (name, source, path, available actions)
- **Integrates with ActionRegistry** to make discovered actions executable
- **Provides queries** to filter and retrieve generators by source or other criteria

### Key Insight

Instead of requiring explicit generator registration, Hypergen can automatically find and load generators following established conventions. This makes adding new generators as simple as placing them in the right directory structure.

---

## Architecture

### Directory Structure

```
src/discovery/
├── index.ts                    # Module exports (public API)
└── generator-discovery.ts      # Main GeneratorDiscovery class
```

### Core Component: GeneratorDiscovery

The `GeneratorDiscovery` class is a service that orchestrates the discovery process:

```typescript
export class GeneratorDiscovery {
  // Discovery methods for different sources
  discoverAll()              // Run all enabled sources
  discoverLocal()            // Local template directories
  discoverWorkspace()        // Monorepo packages
  discoverNpm()              // Installed npm packages
  discoverGit()              // Git repositories (future)
  
  // Query and retrieval
  getGenerator(name)         // Get single generator
  getGenerators()            // Get all discovered generators
  getGeneratorsBySource()    // Filter by source type
  
  // Action registration
  registerDiscoveredActions() // Register found actions with ActionRegistry
}
```

### Type Definitions

#### DiscoverySource

```typescript
type DiscoverySource = 'local' | 'npm' | 'git' | 'workspace'
```

Identifies where a generator was discovered from.

#### DiscoveredGenerator

```typescript
interface DiscoveredGenerator {
  name: string                    // Generator identifier
  source: DiscoverySource        // Origin (local/npm/workspace/git)
  path: string                   // Filesystem path to generator
  actions: string[]              // Names of @action-decorated functions
  metadata?: {                   // Optional metadata
    description?: string
    version?: string
    author?: string
    tags?: string[]
  }
}
```

#### GeneratorDiscoveryOptions

```typescript
interface GeneratorDiscoveryOptions {
  directories?: string[]          // Template directories to scan (default: ['recipes', 'cookbooks'])
  patterns?: string[]             // File patterns to search (default: includes .js, .ts, .mjs, template.yml)
  excludePatterns?: string[]      // Patterns to ignore (default: node_modules, dist, tests)
  enabledSources?: DiscoverySource[] // Which sources to scan (default: ['local', 'workspace'])
}
```

---

## How It Works

### Discovery Flow

```
GeneratorDiscovery.discoverAll()
    ↓
    ├─→ discoverLocal()        [if 'local' enabled]
    │   ├─ Scan configured directories
    │   ├─ Find action files (*.js, *.ts, *.mjs)
    │   ├─ Find template files (template.yml)
    │   └─ Group by generator name
    │
    ├─→ discoverWorkspace()    [if 'workspace' enabled]
    │   ├─ Search workspace patterns (packages/*/generators, apps/*/generators)
    │   ├─ Extract package name from path
    │   └─ Find action files
    │
    ├─→ discoverNpm()          [if 'npm' enabled]
    │   ├─ Scan node_modules
    │   ├─ Check package.json for hypergen markers
    │   └─ Load generators/ subdirectory
    │
    └─→ discoverGit()          [if 'git' enabled]
        └─ [Future implementation for git-based generators]

    Then: registerDiscoveredActions()
        └─ Load each action file to trigger @action decorators
            └─ Actions auto-register with ActionRegistry
```

### Key Operations

#### 1. Finding Action Files
- Searches for TypeScript/JavaScript files matching patterns
- Excludes node_modules, dist, test files
- Returns absolute file paths

#### 2. Extracting Actions
- Imports each module dynamically
- Uses `isActionFunction()` to identify @action-decorated exports
- Collects action names from decorated functions

#### 3. Grouping by Generator
- Groups files by first directory level
- Associates action files with corresponding template files
- Creates generator records

#### 4. Registering Actions
- Imports each discovered action file
- @action decorators trigger automatic registration with ActionRegistry
- Makes actions executable via ActionExecutor

---

## Discovery Sources

### Local Discovery

Scans local template directories configured in options.

**Directories scanned:**
- `recipes/` (default)
- `cookbooks/` (default)
- Custom directories via options

**File structure:**
```
recipes/
├── my-generator/
│   ├── template.yml
│   ├── actions.ts          # @action-decorated functions
│   └── other-files.ts
└── another-generator/
    ├── template.yml
    └── actions.ts
```

### Workspace Discovery

Scans monorepo packages in structured locations.

**Patterns searched:**
- `packages/*/generators/**`
- `apps/*/generators/**`
- `tools/generators/**`

**Metadata:**
- Package name derived from path
- Description indicates workspace origin

### NPM Discovery

Scans installed npm packages for Hypergen generators.

**Identification criteria:**
- Package has `hypergen` or `generator` keyword
- Package name starts with `hypergen-`
- Package contains `hypergen` field in package.json
- Contains `generators/` subdirectory

**Metadata extracted:**
- Package name, version, description, author from package.json

### Git Discovery

**Status:** Not yet implemented

**Future capability:** Clone and scan git repositories containing generators.

---

## Integration Points

### Action Registry Integration

```typescript
// After discovery, actions are registered with ActionRegistry
await discovery.discoverAll()
await discovery.registerDiscoveredActions()

// Actions become available for execution
const registry = ActionRegistry.getInstance()
registry.get('action-name')  // Now available
```

### CLI Integration

The `HypergenCLI` class uses discovery for the `discover` command:

```typescript
private discovery = new GeneratorDiscovery()

async discoverGenerators(args: string[]) {
  const generators = await this.discovery.discoverAll()
  await this.discovery.registerDiscoveredActions()
  // Results displayed to user
}
```

### ActionExecutor Integration

Discovered and registered actions can be executed:

```typescript
const executor = new ActionExecutor()
// Action is available because it was discovered and registered
await executor.execute(actionName, context)
```

---

## Usage Examples

### Basic Discovery

```typescript
import { GeneratorDiscovery } from './discovery/index.js'

const discovery = new GeneratorDiscovery()
const generators = await discovery.discoverAll()

console.log(`Found ${generators.length} generators`)
for (const gen of generators) {
  console.log(`- ${gen.name} (${gen.source}): ${gen.actions.join(', ')}`)
}
```

### Custom Configuration

```typescript
const discovery = new GeneratorDiscovery({
  directories: ['custom-templates', 'local-generators'],
  patterns: ['**/*.action.{js,ts}'],
  enabledSources: ['local', 'workspace'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/*.spec.*']
})

const generators = await discovery.discoverAll()
```

### Source-Specific Discovery

```typescript
const discovery = new GeneratorDiscovery({
  enabledSources: ['npm']  // Only scan npm packages
})

const npmGenerators = await discovery.discoverAll()
const npmOnly = discovery.getGeneratorsBySource('npm')
```

### Generator Lookup

```typescript
const discovery = new GeneratorDiscovery()
await discovery.discoverAll()

// Get specific generator
const generator = discovery.getGenerator('my-generator')
if (generator) {
  console.log(`Generator: ${generator.name}`)
  console.log(`Actions: ${generator.actions.join(', ')}`)
  console.log(`From: ${generator.source}`)
}
```

### Action Registration and Execution

```typescript
const discovery = new GeneratorDiscovery()
const generators = await discovery.discoverAll()

// Make actions available for execution
await discovery.registerDiscoveredActions()

// Now execute discovered actions
const executor = new ActionExecutor()
const result = await executor.execute('create-component', context)
```

---

## Dependencies and Relationships

### External Dependencies
- **fs-extra** - File system operations
- **path** - Path manipulation
- **glob** - Pattern-based file matching
- **debug** - Debug logging

### Internal Dependencies
- **ActionRegistry** - Central registry for discovered actions
- **ActionDecorator** - @action decorator system
- **isActionFunction()** - Validation function for decorated functions

### Modules That Use This
- **HypergenCLI** - CLI command handling
- **ActionExecutor** - Executes discovered actions
- **TemplateStore** - Template discovery/loading (related but separate)

### Related Systems
- **Action System** - Discovered actions are registered here
- **Configuration System** - Uses config for template directories
- **Template System** - Works alongside template discovery

---

## Important Implementation Details

### Lazy Module Loading

Modules are dynamically imported during discovery:

```typescript
private async importModule(filePath: string): Promise<any> {
  // Uses file:// protocol for consistent TypeScript support
  const fileUrl = `file://${absolutePath}`
  const module = await import(fileUrl)
  return module
}
```

**Why:** Allows loading TypeScript files and proper decorator execution without pre-compilation.

### Decorator-Based Discovery

Actions are identified via the `@action` decorator symbol:

```typescript
// In user code
@action({
  name: 'create-component',
  description: 'Create a new component',
  category: 'ui'
})
export async function createComponent(context) {
  // ...
}

// Discovery checks for this symbol
if (isActionFunction(exportValue)) {
  actions.push(exportName)
}
```

**Why:** Declarative, self-documenting, enables metadata extraction.

### Error Handling

Discovery gracefully handles errors:
- Missing directories don't cause failure
- Failed module imports are logged but don't stop discovery
- Missing package.json files are skipped
- Invalid metadata is logged and skipped

### Path Resolution

All discovered generator paths are stored as absolute paths:

```typescript
const fullPath = path.resolve(baseDir, generatorName)
```

**Why:** Ensures paths work correctly regardless of current working directory.

### File Grouping Strategy

Generators are grouped by first-level directory:

```typescript
const relativePath = path.relative(baseDir, file)
const generatorName = relativePath.split(path.sep)[0]
```

**Why:** Maps directory structure to generator hierarchy naturally.

---

## Discovery Configuration

### Default Behavior

Without options, discovery:
- Scans `recipes/` and `cookbooks/` directories
- Looks for `.js`, `.ts`, `.mjs` files and `template.yml`
- Ignores `node_modules/`, `dist/`, test files
- Enables `local` and `workspace` sources

### Common Patterns

#### Monorepo Setup
```typescript
const discovery = new GeneratorDiscovery({
  enabledSources: ['local', 'workspace'],
  directories: ['templates']
})
```

#### NPM Package Registry
```typescript
const discovery = new GeneratorDiscovery({
  enabledSources: ['npm'],
  directories: []  // Not needed for npm discovery
})
```

#### Development Mode
```typescript
const discovery = new GeneratorDiscovery({
  enabledSources: ['local'],
  directories: ['./src/generators'],
  patterns: ['**/*.{ts,js}']  // Include all scripts
})
```

---

## Contributing and Development

### Adding a New Discovery Source

1. **Create the method:**
```typescript
async discoverCustomSource(): Promise<DiscoveredGenerator[]> {
  debug('Discovering from custom source')
  
  const generators: DiscoveredGenerator[] = []
  // Implementation
  
  debug('Found %d generators from custom source', generators.length)
  return generators
}
```

2. **Add to DiscoverySource type:**
```typescript
export type DiscoverySource = 'local' | 'npm' | 'git' | 'workspace' | 'custom'
```

3. **Add to discoverAll():**
```typescript
if (this.options.enabledSources?.includes('custom')) {
  const customGenerators = await this.discoverCustomSource()
  discoveries.push(...customGenerators)
}
```

### Testing Discovery

The test suite validates:
- Default initialization
- Custom options
- All discovery sources
- Generator lookup
- Error handling
- Metadata extraction
- Workspace patterns
- Action registry integration

See `tests/v8-discovery.spec.ts` for comprehensive test examples.

### Debugging

Use the debug module to see discovery details:

```bash
DEBUG=hypergen:discovery npm run hygen discover
```

Debug output shows:
- Discovery sources being scanned
- Patterns being used
- Files being matched
- Modules being imported
- Actions being registered

---

## Best Practices

1. **Use appropriate sources** - Only enable sources you need
2. **Configure patterns carefully** - Balance coverage vs. performance
3. **Follow naming conventions** - Use kebab-case for action names
4. **Organize generators** - Group by functionality in directories
5. **Include metadata** - Use decorators for complete action documentation
6. **Handle errors gracefully** - Let discovery continue on failures
7. **Register before using** - Always call `registerDiscoveredActions()` before executing

---

## Troubleshooting

### Generators Not Found

**Check:**
- Correct directories configured
- Files match patterns (`.js`, `.ts`, `.mjs`)
- Correct source enabled
- Not in excluded patterns

**Debug:**
```bash
DEBUG=hypergen:discovery bun run hygen discover
```

### Actions Not Registered

**Check:**
- Module imports successfully
- Functions decorated with `@action`
- `registerDiscoveredActions()` called
- No module import errors in debug output

### Performance Issues

**Optimize:**
- Limit directories to actual generator locations
- Use excludePatterns to skip node_modules early
- Disable unused discovery sources
- Consider caching results if called frequently

---

## Future Enhancements

1. **Git Discovery** - Load generators directly from git repositories
2. **Discovery Caching** - Cache results for repeated calls
3. **Parallel Discovery** - Scan multiple sources concurrently
4. **Discovery Hooks** - Allow plugins to add discovery sources
5. **Remote Generators** - Load from remote registries
6. **Generator Validation** - Validate generator structure and metadata

## TODO

-   [ ] **Generator Discovery (`generator-discovery.ts`)**:
    *   Implement `discoverGit()` method for git-based generators.
    *   Integrate with `template.yml` parser for more robust metadata extraction in `extractGeneratorMetadata()` (currently returns basic metadata).