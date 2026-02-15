# @hypercli/gen

Code generation engine for HyperDev - the core recipe execution system with AI integration.

## Purpose

This package is an **oclif plugin** that provides the code generation engine. It includes the recipe executor, Jig template engine integration, AI 2-pass system, actions framework, and all generation commands.

## What's Inside

### Commands (`src/commands/`)

- **gen.ts** - `hyper gen <recipe-path>` or `hyper run <recipe-path>` - Main generation command
  - Discovers recipes from installed kits
  - Resolves recipe paths with greedy matching
  - Executes recipe with variable collection
  - `command_not_found` hook rewrites `hyper nextjs crud` to `hyper run nextjs/crud`

**Recipe commands** (`commands/recipe/`):
- `hyper recipe list` - List all available recipes
- `hyper recipe show <path>` - Show recipe details
- `hyper recipe validate <path>` - Validate recipe syntax

**Cookbook commands** (`commands/cookbook/`):
- `hyper cookbook list` - List all cookbooks
- `hyper cookbook run <path>` - Execute cookbook

### Recipe Engine (`src/recipe-engine/`)

13 tool types for recipe steps:

**Core Tools:**
- **template-tool.ts** - Render Jig templates
- **action-tool.ts** - Execute @action decorated functions
- **recipe-tool.ts** - Call other recipes
- **shell-tool.ts** - Run shell commands

**AI Tools:**
- **prompt-tool.ts** - Interactive prompts (clack)
- **ai-tool.ts** - AI variable generation

**Package Tools:**
- **install-tool.ts** - Install npm packages (auto-detects package manager)
- **query-tool.ts** - Query installed packages

**File Tools:**
- **patch-tool.ts** - Patch existing files
- **ensure-dirs-tool.ts** - Create directory structure

**Control Flow Tools:**
- **sequence-tool.ts** - Sequential execution
- **parallel-tool.ts** - Parallel execution
- **conditional-tool.ts** - Conditional execution (if/else)

**Execution:**
- **executor.ts** - Main recipe executor with topological sort
- **group-executor.ts** - Parallel batch executor
- **tool-registry.ts** - Tool registration and lookup

### Template Engines (`src/template-engines/`)

- **jig.ts** - Jig template engine wrapper (Edge.js fork)
  - Singleton instance with helper registration
  - 13 built-in filters: camelCase, pascalCase, snakeCase, kebabCase, etc.
  - Custom `@ai` tag for 2-pass AI generation
  - YAML frontmatter support (`to:`, `inject:`, `when:`, `after:`)

### AI System (`src/ai/`)

**2-pass AI generation:**
- **ai-variable-resolver.ts** - Resolves @ai tags in templates
- **ai-collector.ts** - Collects AI variables from templates
- **context-collector.ts** - Gathers project context for AI
- **model-router.ts** - Routes requests to AI providers

**Transports** (`ai/transports/`):
- **api-transport.ts** - Direct API calls to AI providers
- **command-transport.ts** - Execute AI via CLI commands
- **stdout-transport.ts** - Parse AI output from stdout
- **resolve-transport.ts** - Resolve transport from config

### Actions Framework (`src/actions/`)

- **action-decorator.ts** - `@action` decorator for marking generator functions
- **action-loader.ts** - Discovers and loads actions
- **action-context.ts** - Action execution context
- **action-pipeline.ts** - Action lifecycle (before/execute/after)
- **action-discovery.ts** - Find actions in kits
- **action-validator.ts** - Validate action metadata

Actions are TypeScript functions decorated with `@action`:

```typescript
@action({
  name: 'create-component',
  description: 'Create a React component',
  variables: [...]
})
export async function createComponent(context: ActionContext) {
  // Implementation
}
```

### File Operations (`src/ops/`)

- **add.ts** - Add new files (auto-creates parent directories)
- **inject.ts** - Inject content into existing files
- **patch.ts** - Apply patches to files

### Discovery (`src/discovery/`)

- **discover-recipes.ts** - Find all recipes in installed kits
- **discover-cookbooks.ts** - Find all cookbooks
- **path-matching.ts** - Greedy path matching algorithm

### Prompts (`src/prompts/`)

Interactive user prompts using clack:
- Text input
- Select/multi-select
- Confirm
- Spinner/progress

### Hooks (`src/hooks/`)

- **command-not-found.ts** - Rewrites `hyper kit-name recipe-name` to `hyper run kit-name/recipe-name`

### Base Command (`src/base-command.ts`)

GenBaseCommand extends CoreBaseCommand and adds:
- Recipe engine initialization
- Template engine setup
- Tool registry
- Action discovery
- AI system configuration

## Dependencies

- **@hypercli/core** - Types, config, errors, parsers, utilities
- **@hypercli/kit** - Kit resolution and manifest loading
- **@jig-lang/jig** - Template engine (Edge.js fork)
- **@clack/prompts** - Interactive CLI prompts
- **ai** - AI SDK for provider integration
- **@oclif/core** - CLI framework
- **front-matter** - YAML frontmatter parsing
- **fs-extra** - File system utilities
- **glob** - File pattern matching
- **js-yaml** - YAML parsing
- **zod** - Schema validation

## Usage by CLI

CLI loads this package as an oclif plugin:

```json
{
  "oclif": {
    "plugins": ["@hypercli/gen"],
    "hooks": {
      "command_not_found": "./dist/hooks/command-not-found"
    }
  }
}
```

## Recipe Format

Recipes are YAML files with steps:

```yaml
name: Create CRUD
description: Generate CRUD operations
variables:
  - name: entityName
    type: string
    prompt: Entity name?

steps:
  - tool: template
    template: model.ts.jig
    to: src/models/{{ entityName }}.ts

  - tool: action
    action: create-routes
    variables:
      entity: "{{ entityName }}"

  - tool: shell
    command: npm run format
```

## Template Format

Templates use Jig syntax with YAML frontmatter:

```jig
---
to: src/components/{{ pascalCase :: name }}.tsx
inject: true
after: "// Components"
when: "{{ exists :: 'src/components/index.ts' }}"
---
export const {{ pascalCase :: name }} = () => {
  return <div>{{ name }}</div>
}
```

## AI 2-Pass System

1. **First pass**: Collect all `@ai` tags from templates
2. **Generate**: Send prompts to AI provider
3. **Second pass**: Render templates with AI-generated values

```jig
export const description = "@ai(Generate a user-friendly description for {{ entityName }})"
```

## Build

```bash
bun install
bun run build       # Builds to dist/
bun run typecheck   # TypeScript validation
```

Note: DTS generation is disabled due to inflection types incompatibility.

## Architecture Notes

- **Plugin architecture** - oclif discovers commands automatically
- **Tool-based execution** - Recipe steps use registered tools
- **Topological sort** - Handles step dependencies automatically
- **Parallel execution** - Independent steps run in parallel batches
- **Jig templates** - NOT EJS, uses Edge.js-based Jig
- **2-pass AI** - Efficient AI generation with context collection
- **Action discovery** - Finds @action decorated functions in kits
- **Package manager agnostic** - Auto-detects bun/npm/pnpm/yarn
