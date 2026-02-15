# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `bun run build` - Build TypeScript and generate changelog
- `bun run build:lib` - Compile TypeScript only (no changelog)
- `bun run hypergen` - Run hypergen locally from source during development
- `bun run hypergen:build` - Run the built version of hypergen
- `bun run watch` - Run tests in watch mode for TDD

### Testing
- `bun test` - Run full test suite with coverage
- `bun test --watch` - Run tests in watch mode
- `bun test tests/specific-file.test.ts` - Run a single test file
- `bun test recipe` - Run tests matching a pattern
- Tests use Vitest and are in `tests/` directory

### Documentation
- `bun run typedoc:generate` - Generate TypeDoc HTML documentation
- `bun run tsdoc:all` - Generate Mintlify-compatible MDX docs (extract + generate)

## Architecture Overview

Hypergen is a scalable code generator built with TypeScript. It uses decorators for action definitions and Jig (Edge.js fork) for templating.

### Core Flow

**Entry**: `bin.ts` → `HypergenCLI` (in `cli/cli.ts`) → command routing

Commands route to:
- **Actions**: Decorator-based generators (`@action` decorator)
- **Recipes**: YAML multi-step workflows
- **Templates**: Jig rendering with YAML frontmatter

### Key Systems

**CLI** (`src/cli/`):
- `cli.ts` - Command routing (action, discover, list, info, url, template, recipe, step, init, system)
- `scaffolding.ts` - Generator initialization

**Actions** (`src/actions/`):
- `decorator.ts` - `@action` decorator
- `executor.ts` - Action execution with parameter resolution
- `parameter-resolver.ts` - Parameter validation
- `registry.ts` - Action discovery
- `lifecycle.ts` - Pre/post/error hooks
- `pipelines.ts` - Sequential execution

**Recipe Engine** (`src/recipe-engine/`):
- `recipe-engine.ts` - Workflow orchestrator
- `step-executor.ts` - Step execution
- `tools/` - 7 tool implementations:
  - `template-tool.ts` - Process templates
  - `action-tool.ts` - Execute actions
  - `recipe-tool.ts` - Nested recipes
  - `shell-tool.ts` - Shell commands
  - `prompt-tool.ts` - Interactive prompts
  - `sequence-tool.ts` - Sequential steps
  - `parallel-tool.ts` - Parallel steps
- `registry.ts` - Tool registration/resolution

**Template Engine** (`src/template-engines/`):
- `jig-engine.ts` - Jig (Edge.js) engine singleton with filters and globals
- `ai-jig-tag.ts` - Custom `@ai` tag for AI-generated content
- Extensions: `.jig`, `.jig.t`

**Configuration** (`src/config/`):
- `hypergen-config.ts` - Config loading (cosmiconfig)
- `template-parser.ts` - `template.yml` parsing
- `template-composition.ts` - Template inheritance/includes
- `url-resolution/` - GitHub/npm/local template resolution with caching

**Operations** (`src/ops/`):
- `add.ts` - Create files
- `inject.ts` - Inject into existing files
- `shell.ts` - Run shell commands
- `injector.ts` - Injection strategies

**Other**:
- `indexed-store/` - Hash-indexed template storage for fast lookups
- `prompts/interactive-prompts.ts` - Clack-based interactive prompts
- `errors/hypergen-errors.ts` - Centralized error handling with codes

### Template Processing Pipeline
1. Arguments parsed (`params.ts`)
2. Config loaded (`hypergen-config.ts`)
3. Templates discovered
4. Variables resolved (prompts if needed)
5. Jig renders templates
6. File operations executed (`execute.ts`)

### Configuration Hierarchy
1. `hypergen.config.js` - Project config
2. `template.yml` - Template config with variables
3. Environment variables
4. CLI flags (highest priority)

## Implementation Details

### Decorator-Based Actions
```typescript
@action({
  name: 'create-component',
  description: 'Create a React component',
  parameters: [/* ... */]
})
async function createComponent(context) { /* ... */ }
```

### Recipe Steps
Steps can be: `template`, `action`, `codemod`, `recipe`, `shell`, `prompt`, `sequence`, `parallel`

### Template Composition
- `extends:` - Inherit from another template
- `includes:` - Include other templates
- Conflict strategies: merge, replace, extend, error

### Debugging
```bash
# Recipe tools debugging
DEBUG=hypergen:v8:recipe:tool* bun test

# All hypergen debugging
DEBUG=hypergen:* bun test
```

## TypeScript Config
- Target: ESNext, NodeNext modules
- Path alias: `~/` → `src/`
- Strict mode: disabled (legacy)
- Output: `dist/`
