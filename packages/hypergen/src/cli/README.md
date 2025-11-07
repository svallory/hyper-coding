# Hypergen CLI Module

The CLI module is the command-line interface layer for Hypergen, providing the primary user-facing commands and interactions for the code generator. It orchestrates template execution, recipe management, generator discovery, and configuration handling.

## Overview

The CLI module serves as the bridge between user input (from `bin.ts`) and Hypergen's internal systems. It:

- **Parses and routes commands** to appropriate handlers
- **Manages generator and template lifecycle** (discovery, execution, validation)
- **Executes recipes** using the V8 Recipe System
- **Handles configuration** loading, creation, and validation
- **Provides scaffolding** for new generators and workspaces
- **Manages URLs and caching** for template resolution

## Directory Structure

```
src/cli/
├── index.ts           # Module exports
├── cli.ts             # Main HypergenCLI class with all command handlers
└── scaffolding.ts     # Generator scaffolding and workspace initialization
```

## Key Files and Their Purposes

### `index.ts`
**Purpose**: Module exports

Exports the public API of the CLI module:
- `HypergenCLI` - Main CLI class
- `HypergenCliConfig` - Configuration interface for the CLI

### `cli.ts` (2,270 lines)
**Purpose**: Core CLI implementation with all command handlers

**Main Class**: `HypergenCLI`

Contains:
- Command routing logic
- Command-specific implementations
- Parameter and flag parsing utilities
- Integration with other Hypergen systems

**Key Methods**:
- `initialize()` - Initialize CLI with configuration and recipe engine
- `execute(argv)` - Route commands to handlers
- `executeAction()` - Execute a single action or recipe
- `discoverGenerators()` - Find generators from all sources
- `listActions()` / `listRecipes()` - List available items
- `showActionInfo()` / `showRecipeInfo()` - Display detailed information
- `initGenerator()` / `initWorkspace()` - Scaffold new generators
- `validateTemplate()` / `validateRecipe()` - Validate files
- `executeRecipe()` / `executeRecipeStep()` - Execute recipes
- `handleConfigCommand()` - Manage configuration
- `handleUrlCommand()` - Manage URL resolution and caching
- `showSystemHelp()` / `showSystemStatus()` / `showVersion()` - System info
- Private utilities: `parseFlags()`, `parseParameters()` - Parse CLI args

### `scaffolding.ts` (1,019 lines)
**Purpose**: Generator and workspace scaffolding system

**Main Class**: `GeneratorScaffolding`

Provides:
- Template code generation for different frameworks
- Generator and workspace initialization
- Example template creation
- Test file generation

**Key Methods**:
- `initGenerator()` - Create a new generator with scaffolding
- `initWorkspace()` - Initialize a complete workspace with optional examples
- Framework-specific generators: React, Vue, Node, API, CLI, generic

## Architecture and Design Patterns

### Command Routing Pattern

The CLI uses a command-based routing system:

```
argv → execute() → switch(command) → handler method → result
```

**Commands Supported**:
- `action` - Execute actions and recipes
- `discover` - Find generators
- `list` - List available actions
- `info` - Show action information
- `url` - URL resolution and caching
- `template` - Template validation and info
- `recipe` - Recipe management (V8 system)
- `step` - Individual recipe step execution
- `init` - Generator/workspace scaffolding
- `system` - System information
- `config` - Configuration management

### Integration Architecture

```
HypergenCLI
├── ActionExecutor      (actions/index.js)       - Execute registered actions
├── GeneratorDiscovery  (discovery/index.js)     - Find generators
├── TemplateURLManager  (config/url-resolution/) - Resolve template URLs
├── TemplateParser      (config/template-parser) - Parse template files
├── RecipeEngine        (recipe-engine/)         - Execute recipes (V8)
├── HypergenConfigLoader (config/hypergen-config) - Load configuration
├── ErrorHandler        (errors/hypergen-errors) - Handle errors
├── GeneratorScaffolding (scaffolding.ts)        - Scaffold generators
└── Logger              (logger.ts)              - Log messages
```

### Dual System Support

The CLI supports **two execution systems**:

1. **V7 Action System** - Direct action execution via `ActionExecutor`
   - Uses registered action decorators
   - Synchronous parameter resolution
   - Direct file operations

2. **V8 Recipe System** - Orchestrated recipe execution
   - YAML-based recipe definitions
   - Multi-step workflows with dependencies
   - Advanced features: conditions, error handling, progress tracking

The CLI intelligently routes between them:
- If `.yml`/`.yaml` file is provided → use Recipe System
- If action name is provided → use Action System
- Auto-discovery attempts both

## How the Code Works

### High-Level Execution Flow

```
bin.ts (entry point)
  ↓
HypergenCLI.initialize()
  - Load configuration
  - Initialize recipe engine
  ↓
HypergenCLI.execute(argv)
  - Parse command name
  - Route to handler
  ↓
Handler Method (e.g., executeAction)
  - Parse parameters/flags
  - Execute action or recipe
  - Return result
  ↓
Return result to bin.ts
  - Exit with code (0 = success, 1 = failure)
```

### Command Execution: Action Example

```typescript
// User: hypergen action my-component --name=Button --dryRun

executeAction(['my-component', '--name=Button', '--dryRun'])
  ↓
1. Parse flags: { 'dryRun': true }
2. Parse parameters: { 'name': 'Button' }
3. Check if action exists (auto-discover if needed)
4. Execute via ActionExecutor.executeInteractively()
5. Format result message with file changes
6. Return { success: true, message: "..." }
```

### Recipe Execution Flow

```typescript
// User: hypergen recipe execute my-recipe.yml --name=Button

executeRecipe(['my-recipe.yml', '--name=Button'])
  ↓
1. Parse parameters: { 'name': 'Button' }
2. Load recipe via RecipeEngine.loadRecipe()
3. Execute recipe with options:
   - variables: parsed parameters
   - dryRun: flag status
   - workingDir: project directory
4. Recipe engine:
   - Loads recipe YAML
   - Validates configuration
   - Executes steps in order
   - Handles dependencies
   - Manages error handling
5. Collect results:
   - Success/failure status
   - Files created/modified/deleted
   - Execution duration
   - Step summaries
6. Format detailed message
7. Return { success: true, message: "..." }
```

### Parameter Parsing

The CLI implements flexible parameter parsing:

```typescript
// Supported formats:
--name=Button              // key=value
--name Button              // key value (space-separated)
--dryRun                   // boolean flag
--tags=["tag1","tag2"]     // JSON parsing for complex values

parseParameters(args)
  - Filter out known flags
  - Parse --key=value or --key value formats
  - Attempt JSON parsing for complex values
  - Fall back to string values
```

### Scaffolding System

The scaffolding system generates complete generators with:

```
Generator Structure:
├── actions.ts           - Decorated action function
├── template.yml         - Variable definitions
├── templates/           - EJS template files
├── README.md            - Documentation
└── [name].test.ts       - Test file (optional)

Framework Support:
- React     (functional/class components with Storybook)
- Vue       (composition/options APIs)
- Node      (modules, classes, functions)
- API       (Express routes with models)
- CLI       (Commander.js commands)
- Generic   (Plain TypeScript)
```

## Dependencies and Relationships

### Internal Dependencies

**Actions Module** (`src/actions/`)
- Provides action execution and registration
- Used for direct action invocation

**Discovery Module** (`src/discovery/`)
- Generator discovery from multiple sources
- Auto-registration of discovered actions

**Recipe Engine** (`src/recipe-engine/`)
- V8 recipe execution system
- Step execution and dependency management
- Tool registry and validation

**Configuration System** (`src/config/`)
- Configuration loading and validation
- Template parsing and composition
- URL resolution and caching

**Error Handling** (`src/errors/`)
- Standardized error creation
- Error formatting with suggestions

**Logger** (`src/logger.ts`)
- Centralized logging utility

### Type Dependencies

```typescript
// Key types used:
RunnerConfig                    // Base configuration
HypergenCliConfig              // CLI-specific config
RecipeExecutionOptions         // Recipe execution settings
ResolvedConfig                 // Loaded configuration
RecipeEngineConfig             // Recipe engine configuration
ActionContext                  // Action execution context
ScaffoldingOptions             // Scaffolding parameters
```

## Important Implementation Details

### Error Handling Strategy

The CLI wraps all operations in try-catch blocks:

```typescript
try {
  // Operation
} catch (error) {
  if (error instanceof HypergenError) {
    // Use formatted error from Hypergen
    return { success: false, message: ErrorHandler.formatError(error) }
  } else {
    // Convert to HypergenError and format
    const hypergenError = ErrorHandler.createError(ErrorCode, message, context)
    return { success: false, message: ErrorHandler.formatError(hypergenError) }
  }
}
```

### Configuration Initialization

```typescript
async initialize() {
  // 1. Try to load config file (optional)
  try {
    this.hypergenConfig = await HypergenConfigLoader.loadConfig(
      undefined,
      this.config.cwd || process.cwd()
    )
  } catch {
    // Continue without config - it's optional
  }

  // 2. Initialize recipe engine
  const recipeConfig: RecipeEngineConfig = {
    workingDir: this.config.cwd || process.cwd(),
    enableDebugLogging: process.env.DEBUG?.includes('hypergen') || false
  }
  this.recipeEngine = new RecipeEngine(recipeConfig)
}
```

### Lazy Initialization

Components are created once and reused:

```typescript
private executor = new ActionExecutor()
private discovery = new GeneratorDiscovery()
private urlManager = new TemplateURLManager()
private scaffolding = new GeneratorScaffolding()
```

### Result Message Formatting

Results include structured messages with:
- Status indicators (✅, ❌, 🔍)
- Summary information
- File lists (created, modified, deleted)
- Execution metrics (duration, step counts)
- Helpful suggestions and next steps

### Flag vs. Parameter Distinction

**Flags** (boolean options):
- `--dryRun` - Don't actually write files
- `--force` - Override conflicts
- `--defaults` - Use default values
- `--skipPrompts` - Skip interactive prompts
- `--continueOnError` - Continue on step failures

**Parameters** (values passed to actions/recipes):
- `--name=Button` - Variable value
- `--type=functional` - Configuration option
- JSON values with `--tags=["tag1","tag2"]`

## How to Contribute/Work with This Code

### Adding a New Command

1. **Add handler method** to `HypergenCLI` class:
   ```typescript
   private async handleMyCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
     // Implementation
   }
   ```

2. **Add routing** in the `execute()` switch statement:
   ```typescript
   case 'mycommand':
     return this.handleMyCommand(args)
   ```

3. **Update help text** in `showSystemHelp()` method

4. **Add error handling** using `ErrorHandler.createError()`

### Adding a New Scaffolding Framework

1. Add framework name to `ScaffoldingOptions.framework` type
2. Implement framework parameters in `getFrameworkParameters()`
3. Create template generators: `get<Framework>ComponentTemplate()`, etc.
4. Update `generateExampleTemplates()` switch statement
5. Add to `getFrameworkFileList()` for file listing

### Testing Commands Locally

```bash
# From packages/hypergen directory:
bun run hygen [command] [args...]

# Examples:
bun run hygen action my-component --name=Button
bun run hygen discover
bun run hygen list
bun run hygen init generator --name=test --framework=react
bun run hygen recipe validate my-recipe.yml
```

### Debugging

Enable debug logging:

```bash
DEBUG=hypergen bun run hygen [command]
DEBUG=hypergen:* bun run hygen [command]
```

Check logs in the result messages and console output.

## Key Design Decisions

1. **Dual System Support**: Maintains backward compatibility with V7 actions while introducing V8 recipes
2. **Lazy Initialization**: Components only created when needed
3. **Comprehensive Error Messages**: Include suggestions and helpful context
4. **Flexible Parameter Parsing**: Supports multiple formats for user convenience
5. **Async-First**: All operations are async-safe for future scaling
6. **Framework Templates**: Pre-built scaffolding for common use cases reduces boilerplate

## Common Tasks

### List all available commands
```bash
hypergen system help
```

### Execute an action with parameters
```bash
hypergen action component-generator --name=Button --type=functional
```

### Run a recipe
```bash
hypergen recipe execute my-recipe.yml --var1=value1 --var2=value2
```

### Validate before execution
```bash
hypergen recipe validate my-recipe.yml
hypergen template validate path/to/template.yml
```

### Create a new generator
```bash
hypergen init generator --name=my-gen --framework=react --category=components
```

### Initialize a workspace
```bash
hypergen init workspace --withExamples
```

### View configuration
```bash
hypergen config show
hypergen config info
```

## Summary

The CLI module is a comprehensive command-line interface that:

- Routes user commands to appropriate handlers
- Supports both V7 actions and V8 recipes
- Provides rich discovery, validation, and execution capabilities
- Includes scaffolding for rapid generator development
- Integrates all major Hypergen subsystems
- Provides helpful error messages and suggestions
- Supports flexible parameter and flag parsing

It's designed to be extensible, maintainable, and user-friendly while supporting both simple one-off actions and complex multi-step recipes.
## TODO

-   [ ] **CLI (`cli.ts`)**:
    *   Implement `listRecipeSteps` function.
    *   Implement `executeRecipeStep` function.
    *   Implement `parseFlags` function.
    *   Implement `parseParameters` function.
-   [ ] **Scaffolding (`scaffolding.ts`)**:
    *   Implement `getFrameworkImports` function for all frameworks.
    *   Implement `getFrameworkImplementation` function for all frameworks.
    *   Implement `getFrameworkHelperFunctions` function for all frameworks.