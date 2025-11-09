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

- `initialize()` - Initialize CLI with configuration and recipe engine.
- `execute(argv)` - Routes commands to dedicated command handler classes (e.g., `ActionCommand`, `ConfigCommand`, etc.) for processing.
- Private utilities: `parseFlags()`, `parseParameters()` - Parse CLI arguments.

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

## CLI Commands Reference



### `config`

*   **Purpose**: Manages Hypergen's configuration files. It allows users to initialize, view, validate, and get information about their Hypergen configuration.
*   **Usage**: `hypergen config <subcommand> [args...]`
*   **Subcommands**:
    *   `init`: Initializes a new Hypergen configuration file (`hypergen.config.js` or `hypergen.config.json`) in the current project root.
        *   **Parameters**: `--format <js|json>` (optional, defaults to `js`).
        *   **Example**: `hypergen config init --format json`
    *   `show`: Displays the currently loaded Hypergen configuration, including details about templates, environment, engine, conflict strategy, cache, validation, discovery sources, plugins, and helpers.
        *   **Example**: `hypergen config show`
    *   `validate`: Validates the Hypergen configuration file. It checks for correctness and consistency.
        *   **Parameters**: `[config-path]` (optional, path to a specific config file to validate).
        *   **Example**: `hypergen config validate`
    *   `info`: Provides a summary of the Hypergen configuration, including its source, environment, number of templates, cache status, and counts of loaded plugins and helpers.
        *   **Example**: `hypergen config info`
*   **Description**: The `config` command is essential for setting up and managing how Hypergen operates within a project. It helps users ensure their generators and recipes are discovered and executed correctly by providing tools to inspect and verify the configuration.

### `discover`

*   **Purpose**: Discovers and registers Hypergen generators from all configured sources. This command helps users see what generators are available for use.
*   **Usage**: `hypergen discover [sources...]`
*   **Parameters**:
    *   `[sources...]`: (Optional) A space-separated list of specific discovery sources to use (e.g., `npm`, `file`, `github`). If omitted, all configured sources will be used.
*   **Description**: The `discover` command scans various locations (like local file paths, npm packages, or even GitHub repositories if configured) to find Hypergen generators. It then registers the actions provided by these generators, making them available for execution via the `hypergen action` command. The output provides a detailed list of discovered generators, their source, path, and the actions they provide. If no generators are found, it offers tips on how to make them discoverable.

### `info`

*   **Purpose**: Displays detailed information about a specific Hypergen action, including its description, category, tags, parameters (with types, requirements, and defaults), and usage examples.
*   **Usage**: `hypergen info <action-name>`
*   **Parameters**:
    *   `action-name`: The name of the action for which to display information.
*   **Description**: This command is invaluable for understanding how to use a particular Hypergen action. It provides a comprehensive overview, helping users to correctly formulate their `hypergen action` commands by detailing all available parameters and illustrating common use cases with examples. If the action is not immediately found, it attempts to discover it from all configured sources.

### `help`

*   **Purpose**: Displays a comprehensive help message listing all available Hypergen commands, their usage, and examples.
*   **Usage**: `hypergen help`
*   **Description**: This command provides quick access to information about all available Hypergen commands, their usage, and examples, helping users to effectively utilize the CLI.

### `version`

*   **Purpose**: Displays the current version of Hypergen and other related information like the project website and repository.
*   **Usage**: `hypergen version`
*   **Description**: This command provides quick access to the installed Hypergen version and related project information.

### `cookbook`

*   **Purpose**: Runs a recipe from the cookbook.
*   **Usage**: `hypergen cookbook [RECIPE] [--use-defaults] [...VARS]`
*   **Parameters**:
    *   `RECIPE`: (Optional) The name of the recipe to run. If not specified, runs the default recipe if one is defined.
    *   `--use-defaults`: Automatically skips prompts for variables that have default values defined in the recipe config.
    *   `VARS`: Pairs of variables (defined in the recipe config) and their values. Each required variable that is not specified shows a prompt.
*   **Description**: This command allows users to execute predefined recipes. If no recipe is specified, it attempts to run a default recipe. If no default recipe is configured, it will explain that there isn't one and list available recipes. The `--use-defaults` flag streamlines execution by using default values for variables, avoiding interactive prompts.

### `init`

*   **Purpose**: Initializes new Hypergen generators or a complete Hypergen workspace with scaffolding. This command helps users quickly set up the basic structure for their code generation projects.
*   **Usage**: `hypergen init <type> [options...]`
*   **Subcommands**:
    *   `generator`: Initializes a new Hypergen generator.
        *   **Parameters**:
            *   `--name=<generator-name>` (required): The name of the generator. Must be alphanumeric with dashes and underscores, starting with a letter.
            *   `--description=<description>` (optional): A description for the generator (defaults to `Generator for <name>`).
            *   `--category=<category>` (optional): A category for the generator (defaults to `custom`).
            *   `--author=<author>` (optional): The author of the generator (defaults to `Unknown`).
            *   `--directory=<directory>` (optional): The directory where the generator will be created (defaults to `recipes`).
            *   `--type=<action|template|both>` (optional): The type of generator to create (`action`, `template`, or `both`, defaults to `both`).
            *   `--framework=<react|vue|node|cli|api|generic>` (optional): The framework for which to generate example templates (defaults to `generic`).
            *   `--withExamples=<true|false>` (optional): Whether to include example templates (defaults to `true`).
            *   `--withTests=<true|false>` (optional): Whether to include test files (defaults to `true`).
        *   **Example**: `hypergen init generator --name=my-component --framework=react --type=action`
    *   `workspace`: Initializes a complete Hypergen workspace.
        *   **Parameters**:
            *   `--directory=<directory>` (optional): The directory where the workspace will be created (defaults to `recipes`).
            *   `--withExamples=<true|false>` (optional): Whether to include example generators (defaults to `true`).
        *   **Example**: `hypergen init workspace --withExamples`
*   **Description**: The `init` command streamlines the creation of Hypergen projects. Whether you need a single generator for a specific task or a full workspace with example generators, this command provides the necessary boilerplate. It supports various frameworks and generator types, making it flexible for different development needs.

### `list`

*   **Purpose**: Lists all available Hypergen actions, optionally filtered by category. This command helps users discover what code generation capabilities are at their disposal.
*   **Usage**: `hypergen list [category]`
*   **Parameters**:
    *   `[category]`: (Optional) A specific category name to filter the listed actions. If provided, only actions belonging to that category will be displayed.
*   **Description**: The `list` command provides an overview of all actions that Hypergen can execute. For each action, it shows its name, a brief description (if available), and any required parameters. If no actions are immediately available, it automatically attempts to discover them. Users can also filter the list by category to find relevant actions more easily.







### `template`

*   **Purpose**: Provides utilities for managing and inspecting Hypergen template files. This command helps users validate, get information about, list, and view examples for their templates.
*   **Usage**: `hypergen template <subcommand> [args...]`
*   **Subcommands**:
    *   `validate`: Validates a specified `template.yml` file for correct syntax and structure.
        *   **Parameters**:
            *   `<template-path>` (required): The path to the `template.yml` file.
        *   **Description**: Checks if a template file adheres to Hypergen's schema, reporting any errors or warnings. This is crucial for ensuring templates will function correctly during code generation.
        *   **Example**: `hypergen template validate recipes/my-component/template.yml`
    *   `info`: Displays detailed information about a specified `template.yml` file, including its name, description, version, author, category, tags, variables (with types, requirements, and defaults), and examples.
        *   **Parameters**:
            *   `<template-path>` (required): The path to the `template.yml` file.
        *   **Description**: Provides a comprehensive overview of a template's configuration, helping users understand its purpose and how to use its variables.
        *   **Example**: `hypergen template info recipes/my-component/template.yml`
    *   `list`: Lists all `template.yml` files found in a specified directory (defaults to `recipes`).
        *   **Parameters**:
            *   `[directory]` (optional): The directory to search for template files.
        *   **Description**: Helps users discover available templates within their project, showing their names, descriptions, and indicating if any are invalid.
        *   **Example**: `hypergen template list my-templates`
    *   `examples`: Shows usage examples for a specified `template.yml` file, demonstrating how to invoke the template with different parameters.
        *   **Parameters**:
            *   `<template-path>` (required): The path to the `template.yml` file.
        *   **Description**: Provides practical command-line examples for executing a template, making it easier for users to get started with new templates.
        *   **Example**: `hypergen template examples recipes/my-component/template.yml`
*   **Description**: The `template` command is a powerful tool for developers working with Hypergen templates, offering functionalities to ensure template quality, understand their capabilities, and facilitate their usage.



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
RunnerConfig; // Base configuration
HypergenCliConfig; // CLI-specific config
RecipeExecutionOptions; // Recipe execution settings
ResolvedConfig; // Loaded configuration
RecipeEngineConfig; // Recipe engine configuration
ActionContext; // Action execution context
ScaffoldingOptions; // Scaffolding parameters
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
    return { success: false, message: ErrorHandler.formatError(error,), };
  } else {
    // Convert to HypergenError and format
    const hypergenError = ErrorHandler.createError(
      ErrorCode,
      message,
      context,
    );
    return {
      success: false,
      message: ErrorHandler.formatError(hypergenError,),
    };
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

1.  **Create a new command class** in `src/cli/commands/` (e.g., `MyNewCommand.ts`):
    ```typescript
    // src/cli/commands/MyNewCommand.ts
    export class MyNewCommand {
      async execute(args: string[]): Promise<{ success: boolean; message?: string }> {
        // Implementation for your new command
      }
    }
    ```

2.  **Import and initialize** your new command class in `src/cli/cli.ts`:
    ```typescript
    // src/cli/cli.ts
    import { MyNewCommand } from './commands/MyNewCommand';

    export class HypergenCLI {
      private myNewCommand: MyNewCommand;

      constructor(...) {
        // ... other initializations
        this.myNewCommand = new MyNewCommand();
      }

      async execute(argv: string[]): Promise<{ success: boolean; message?: string }> {
        const [command, ...args] = argv;
        switch (command) {
          case 'mynewcommand':
            return this.myNewCommand.execute(args);
          // ... other cases
        }
      }
    }
    ```

3.  **Update help text** in `SystemCommand.showSystemHelp()` method (located in `src/cli/commands/system.ts`).

4.  **Add error handling** using `ErrorHandler.createError()` within your new command class.

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


- [ ] **Scaffolding (`scaffolding.ts`)**:
  - Implement `getFrameworkImports` function for all frameworks.
  - Implement `getFrameworkImplementation` function for all frameworks.
  - Implement `getFrameworkHelperFunctions` function for all frameworks.
