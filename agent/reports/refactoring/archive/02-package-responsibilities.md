# Package Responsibilities and Features

## @hypercli/core

**Purpose:** Foundation types, configuration, and utilities. NO CLI commands, NO runtime execution.

### Responsibilities

1. **Type Definitions**
   - Kit and Cookbook configuration types
   - Template variable and configuration types
   - Complete recipe domain model (RecipeConfig, all step types)
   - Action metadata and context types
   - AI service configuration types
   - Common shared types (Logger, Prompter, etc.)

2. **Error System**
   - HypergenError class with context and suggestions
   - ErrorHandler with specialized error creators
   - 83 error codes covering all domain areas:
     - Configuration (3 codes)
     - Templates (8 codes)
     - Actions (6 codes)
     - CodeMods (8 codes)
     - File system (5 codes)
     - Generator discovery (3 codes)
     - URL resolution (3 codes)
     - Network (3 codes)
     - AI (10 codes)
     - General (3 codes)

3. **Configuration System**
   - Load hypergen.config.js with cosmiconfig
   - Callback pattern for helper registration
   - No dependency on template engine
   - Environment-aware configuration

4. **Parsers**
   - Parse kit.yml files
   - Parse cookbook.yml files
   - Parse template.yml files with frontmatter
   - Path resolution with greedy matching algorithm

5. **Utilities**
   - Find project root and .hyper/kits directory
   - Platform-aware newline handling
   - String helpers (capitalize, inflection, changeCase)
   - Constants (version, default action, etc.)

6. **Logger**
   - Chalk-based colored console output
   - ActionLogger interface (minimal: info, warn, error, debug, trace)
   - ExtendedLogger interface (full: + log, colorful, notice, err, ok)

### Key Features

- **Self-contained:** No dependencies on other @hypercli packages
- **Type-only exports:** Many exports are pure TypeScript types
- **Callback pattern:** Returns loaded helpers instead of registering them
- **Error-first design:** Rich error types with context and suggestions

### Dependencies

- chalk (terminal colors)
- debug (debug logging)
- inflection (string inflection)
- change-case (case conversion)
- cosmiconfig (config loading)

### Exports

```typescript
// Types
export * from './types'
  KitConfig, CookbookConfig, VariableDefinition
  TemplateVariable, TemplateConfig
  RecipeConfig, RecipeStep, RecipeStepUnion
  ActionMetadata, ActionContext, ActionResult
  AiServiceConfig, AIExecutionResult
  Logger, Prompter, RenderedAction, RunnerConfig

// Errors
export * from './errors'
  HypergenError, ErrorHandler, ErrorCode
  withErrorHandling, validateParameter

// Config
export * from './config'
  HypergenConfigLoader, loadHelpers
  ConfigLoaderOptions, ResolvedConfig

// Parsers
export * from './parsers'
  parseKitConfig, parseCookbookConfig
  parseTemplateConfig, resolveRecipePath

// Utils
export * from './utils'
  findProjectRoot, getKitsDirectory, ProjectRootInfo
  newline

export { default as helpers } from './helpers'
export * from './constants'
export * from './logger'
```

### NOT in Core

- Recipe execution engine (in gen)
- Template rendering (in gen)
- Kit installation (in kits)
- CLI commands (in cli/gen/kits)
- File operations (in gen)

---

## @hypercli/kit

**Purpose:** Kit lifecycle management. oclif plugin with kit commands.

### Responsibilities

1. **Kit Manifest Management**
   - Load and validate kit.yml
   - Manage kit metadata (name, version, author, etc.)
   - Track installed kits
   - Kit manifest schema validation

2. **Source Resolution**
   - Resolve kit sources from multiple locations:
     - npm registry (@kit/nextjs)
     - GitHub repos (github:kit/nextjs)
     - Local paths (./kits/nextjs)
   - Source priority and fallback logic

3. **URL Resolution & Caching**
   - Cache manager for downloaded kits
   - NPM resolver with registry API
   - GitHub resolver with degit
   - Local filesystem resolver
   - Cache invalidation and updates

4. **Kit Commands**
   - `hyper kit install <source>` - Install kit from source
   - `hyper kit update <name>` - Update installed kit
   - `hyper kit list` - List installed kits
   - `hyper kit info <name>` - Show kit information

### Key Features

- **Multi-source support:** npm, GitHub, local with unified API
- **Intelligent caching:** Avoid re-downloads, cache invalidation
- **Manifest validation:** JSON schema validation for kit.yml
- **Dependency resolution:** Handle kit dependencies (planned)

### Dependencies

- @hypercli/core (types, errors, config)
- degit (GitHub repo cloning)
- npm-registry-fetch (npm API)
- fs-extra (file operations)

### Exports

```typescript
export * from './manifest'
  KitManifest, loadKitManifest, validateKitManifest

export * from './source-resolver'
  resolveKitSource, KitSource

export * from './url-resolution'
  ResolvedKitUrl, CacheManager
  NpmResolver, GitHubResolver, LocalResolver
```

### NOT in Kits

- Recipe execution (in gen)
- Code generation (in gen)
- Template rendering (in gen)

---

## @hypercli/gen

**Purpose:** Code generation engine. oclif plugin with generation commands.

### Responsibilities

1. **Recipe Engine**
   - Execute recipes with multiple steps
   - Dependency resolution (topological sort)
   - Parallel execution where possible
   - Step output piping and variable exports
   - 13 tool implementations:
     - template (render Jig templates)
     - action (execute @action functions)
     - recipe (nested recipe execution)
     - shell (run shell commands)
     - prompt (interactive user input)
     - ai (AI-powered generation)
     - install (package manager operations)
     - query (read file content)
     - patch (modify file content)
     - ensure-dirs (create directories)
     - sequence (sequential steps)
     - parallel (parallel steps)
     - conditional (if/else logic)

2. **Template Engine**
   - Jig (Edge.js fork) integration
   - Singleton pattern with registerHelpers
   - 13 built-in filters (camelCase, pascalCase, etc.)
   - Custom @ai tag for 2-pass AI generation
   - Template frontmatter parsing (to, inject, when, after)

3. **AI Integration**
   - 2-pass scaffold+complete system
   - Pass 1: Collect @ai blocks with @context, @prompt, @output, @example
   - Pass 2: Resolve AI answers and render final output
   - Support for multiple AI providers (Anthropic, OpenAI, Ollama)
   - Three modes: api, command, stdout
   - Budget tracking and guardrails

4. **Actions System**
   - @action decorator for TypeScript functions
   - Parameter resolution with type validation
   - Lifecycle hooks (pre, post, error)
   - Action pipelines (sequential composition)
   - Action registry with discovery

5. **File Operations**
   - add.ts: Create files with auto-mkdir
   - inject.ts: Inject content into existing files
     - after/before markers
     - at start/end
     - skip_if conditions

6. **Interactive Prompts**
   - Clack-based prompts
   - Type-safe input validation
   - Suggestions from variable definitions

7. **Generator Discovery**
   - Find recipes in kits
   - Cookbook and recipe metadata
   - Default recipe resolution

8. **Commands**
   - `hyper run <recipe>` - Execute recipe
   - `hyper recipe list` - List available recipes
   - `hyper recipe info <name>` - Show recipe details
   - `hyper recipe validate <path>` - Validate recipe YAML
   - `hyper cookbook list` - List cookbooks
   - `hyper cookbook info <name>` - Show cookbook details

9. **Command Routing Hook**
   - command_not_found hook
   - Enables syntax: `hyper nextjs crud update Org`
   - Maps to: `hyper run nextjs/crud/update Org`

### Key Features

- **2-pass AI generation:** Scaffold structure first, complete with AI second
- **Dependency injection for AI:** Circular dependency resolved with renderFn parameter
- **Auto-mkdir:** File creation automatically creates parent directories
- **onSuccess/onError messages:** Jig templates rendered after execution
- **Install tool:** Auto-detects package manager from lockfiles
- **Helper registration:** Loads helpers from kits/cookbooks/config
- **Group execution:** Topological sort with parallel batches

### Dependencies

- @hypercli/core (types, errors, config, parsers)
- @hypercli/kit (kit resolution)
- @jig-lang/jig (template engine)
- @clack/prompts (interactive prompts)
- ai (Vercel AI SDK)
- chalk (colors)
- debug (logging)
- execa (shell execution)
- front-matter (YAML frontmatter)
- fs-extra (file operations)
- glob (file patterns)
- js-yaml (YAML parsing)
- zod (schema validation)

### Exports

```typescript
export * from './recipe-engine'
  RecipeEngine, executeRecipe, executeSteps
  ToolRegistry, registerDefaultTools

export * from './template-engines'
  initializeJig, getJig, renderTemplate, registerHelpers

export * from './ai'
  collectAiBlocks, assemblePrompt, executeAiStep
  AiBlockEntry, AIExecutionResult

export * from './actions'
  action (decorator), executeAction, resolveParameters
  ActionRegistry, registerAction

export * from './ops'
  add, inject

export * from './prompts'
  prompt, confirmAction

export * from './discovery'
  discoverGenerators, findRecipe
```

### NOT in Gen

- Kit installation (in kits)
- Core type definitions (in core)
- CLI plugin loading (in cli)

---

## @hypercli/cli

**Purpose:** Thin shell and plugin host. Provides `hyper` binary.

### Responsibilities

1. **Plugin Host**
   - Load oclif plugins (@hypercli/gen, @hypercli/kit)
   - Route commands to appropriate plugins
   - Aggregate help across all plugins
   - Topic organization (kit, cookbook, recipe, config, system)

2. **Binary Entry Points**
   - bin/run.js - Production entry point
   - bin/dev.js - Development entry point
   - Handle oclif initialization

3. **CoreBaseCommand**
   - Slim base class for all commands
   - Load hypergen config
   - Set up logger with colors
   - Parse base flags:
     - --config: Path to config file
     - --debug: Enable debug output
     - --cwd: Working directory
   - NO recipe engine
   - NO generator discovery
   - NO tool registry

4. **Config Commands**
   - `hyper config init` - Initialize hypergen.config.js
   - `hyper config show` - Display current config
   - `hyper config validate` - Validate config file

5. **System Commands**
   - `hyper system status` - Show system information
   - `hyper system version` - Show version information

6. **Init Command**
   - `hyper init` - Initialize hypergen in project
   - Create .hyper/ directory
   - Install default kits

### Key Features

- **Minimal footprint:** Only essential CLI infrastructure
- **Plugin delegation:** Most functionality in plugins
- **Shared base command:** CoreBaseCommand for consistent UX
- **oclif conventions:** Standard help, version, autocomplete

### Dependencies

- @hypercli/core (types, config, logger)
- @hypercli/gen (loaded as oclif plugin)
- @hypercli/kit (loaded as oclif plugin)
- @oclif/core (CLI framework)
- @oclif/plugin-help (help system)

### oclif Configuration

```json
{
  "bin": "hyper",
  "dirname": "hyper",
  "commands": "./dist/commands",
  "plugins": [
    "@hypercli/gen",
    "@hypercli/kit",
    "@oclif/plugin-help"
  ],
  "topics": {
    "kit": { "description": "Manage kits" },
    "cookbook": { "description": "Manage cookbooks" },
    "recipe": { "description": "Work with recipes" },
    "config": { "description": "Configuration management" },
    "system": { "description": "System information" }
  },
  "topicSeparator": " "
}
```

### Exports

```typescript
export * from './lib'
  CoreBaseCommand, colors, styles, flags
```

### NOT in CLI

- Recipe execution (in gen)
- Template rendering (in gen)
- Kit installation (in kits)
- AI integration (in gen)
- Actions system (in gen)

---

## Future Packages (Planned)

### @hypercli/tools
Code analysis and transformation tools.

**Commands:**
- `hyper tools analyze` - Static code analysis
- `hyper tools format` - Code formatting
- `hyper tools migrate` - Migration scripts
- `hyper tools refactor` - Automated refactoring

### @hypercli/plan
Project planning and architecture design.

**Commands:**
- `hyper plan create` - Create project plan
- `hyper plan validate` - Validate architecture
- `hyper plan estimate` - Effort estimation

### @hypercli/watch
File watching and hot reload.

**Commands:**
- `hyper watch start` - Start watch mode
- `hyper watch status` - Watch status
- `hyper watch stop` - Stop watching

### @hypercli/dash
Development dashboard and UI.

**Commands:**
- `hyper dash start` - Start web dashboard
- `hyper dash open` - Open in browser

All future packages will be oclif plugins loaded by @hypercli/cli.
