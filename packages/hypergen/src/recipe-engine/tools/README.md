# Recipe Step System - Tools Framework

This directory contains the core tools framework for the Recipe Step System, a modern orchestration engine that coordinates template generation, action execution, code modifications, and recipe composition.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Files](#key-files)
- [Design Patterns](#design-patterns)
- [Tool Implementations](#tool-implementations)
- [Tool Registry System](#tool-registry-system)
- [How It Works](#how-it-works)
- [Contributing](#contributing)
- [Dependencies](#dependencies)

---

## Overview

The Recipe Step System represents a fundamental shift in how code generation is orchestrated. Instead of complex configuration inheritance and template composition through file system hierarchies, it uses a **step-based execution model** where recipes declare sequential (or parallel) steps that use different tools.

### Core Concept

**Composition over Inheritance**: Rather than inheriting and merging configurations, recipes simply execute other recipes as steps. This makes the system more intuitive, easier to debug, and more flexible.

### Supported Tool Types

1. **Template Tool** - Processes EJS/LiquidJS templates with frontmatter to generate files
2. **Action Tool** - Executes TypeScript decorator-based actions with the V8 action system
3. **CodeMod Tool** - Performs AST-based and text-based code transformations
4. **Recipe Tool** - Executes sub-recipes with variable inheritance and composition

---

## Architecture

### High-Level Flow

```
RecipeEngine
    ↓
StepExecutor
    ↓
ToolRegistry → Tool (base class)
    ├── TemplateTool
    ├── ActionTool
    ├── CodeModTool
    └── RecipeTool
```

### Execution Lifecycle

Each tool follows a consistent lifecycle managed by the base `Tool` class:

1. **Initialize** - One-time setup, resource allocation
2. **Validate** - Configuration validation before execution
3. **Execute** - Core tool functionality with retry logic
4. **Cleanup** - Resource cleanup and disposal

### Resource Management

Tools use a resource registration system for automatic cleanup:

- File handles
- Network connections
- Cache entries
- Process handles
- Memory allocations

Resources are tracked and cleaned up automatically, even in error scenarios.

---

## Key Files

### `index.ts`

**Purpose**: Central export point for the tools framework

**Exports**:

- Base classes: `Tool`, `BaseToolFactory`
- Tool implementations: `TemplateTool`, `ActionTool`, `CodeModTool`, `RecipeTool`
- Tool factories: Individual factory instances for each tool
- Registry functions: `getToolRegistry()`, `registerTool()`, `resolveTool()`
- Utility functions: `createTool()`, `resolveTools()`, `checkRegistryHealth()`
- Framework initialization: `initializeToolsFramework()`
- Constants: `TOOL_FRAMEWORK_VERSION`, `SUPPORTED_TOOL_TYPES`

**Usage**:

```typescript
import { createTool, initializeToolsFramework, TemplateTool, } from './tools';

// Initialize framework
initializeToolsFramework({ enableDebugLogging: true, },);

// Create tools
const tool = await createTool('template', 'my-tool',);
```

### `base.ts`

**Purpose**: Abstract base class and core interfaces for all tools

**Key Classes**:

- `Tool<TStep>` - Abstract base class implementing common lifecycle
- `BaseToolFactory<TStep>` - Abstract base class for tool factories

**Key Interfaces**:

- `ToolResource` - Resource management
- `ToolLifecycleMetrics` - Performance tracking
- `ToolValidationResult` - Validation feedback
- `ToolPhase` - Lifecycle phase tracking

**Features**:

- Automatic retry logic with exponential backoff
- Comprehensive error wrapping with context
- Resource registration and cleanup
- Memory usage tracking
- Lifecycle event logging
- Execution metrics collection

**Protected Methods for Subclasses**:

```typescript
protected async onInitialize(): Promise<void>
protected abstract onValidate(step: TStep, context: StepContext): Promise<ToolValidationResult>
protected abstract onExecute(step: TStep, context: StepContext, options?: StepExecutionOptions): Promise<StepResult>
protected async onCleanup(): Promise<void>
```

### `registry.ts`

**Purpose**: Centralized singleton registry for tool management

**Key Features**:

- Singleton pattern for global tool access
- Tool factory registration and resolution
- Instance caching with LRU eviction
- Expired instance cleanup (10-minute intervals)
- Search and discovery capabilities
- Health monitoring and statistics

**Core Methods**:

```typescript
register(toolType, name, factory, metadata?)
unregister(toolType, name)
resolve(toolType, name, options?) → Tool instance
search(criteria) → ToolRegistration[]
getStats() → ToolRegistryStats
clearCache()
```

**Registry Configuration**:

- `maxCacheSize` - Maximum cached instances (default: 100)
- `cacheTimeoutMs` - Cache expiration time (default: 30 minutes)
- `enableInstanceReuse` - Whether to reuse instances (default: true)

### `template-tool.ts`

**Purpose**: Template processing and file generation

**Key Features**:

- Integration with existing EJS and LiquidJS engines
- Frontmatter processing (`to:`, `skip_if:`, `inject:`, `unless_exists:`, `force:`)
- Template composition (includes, extends)
- Variable substitution and context management
- File operation integration (`addOp`, `injectOp`)
- Template caching for performance

**Template Resolution Strategy**:

1. Absolute path
2. Relative to project root
3. Relative to template path (if available)
4. With common extensions (.liquid, .ejs, .liquid.t, .ejs.t)

**Validation Checks**:

- Template file existence
- Engine configuration validity
- Output directory accessibility
- Variable type definitions
- Exclude pattern syntax

### `action-tool.ts`

**Purpose**: TypeScript decorator-based action execution

**Key Features**:

- Integration with `ActionExecutor`, `ActionRegistry`, `ActionParameterResolver`
- Interactive parameter resolution with prompts
- Action communication and lifecycle management
- Context transformation (StepContext → ActionContext)
- Rich execution statistics and workflow status

**Action Resolution**:

- Validates action exists in registry
- Resolves parameters interactively with defaults
- Configures communication channels (subscribeTo, reads, writes)
- Executes with full retry and timeout support

**Execution Statistics**:

```typescript
getExecutionStats() → {
  totalActions: number
  activeActions: number
  completedActions: number
  failedActions: number
  communicationStats: any
}
```

### `codemod-tool.ts`

**Purpose**: AST-based and text-based code transformations

**Key Features**:

- TypeScript/JavaScript AST transformations using TypeScript compiler API
- Built-in transformations: `add-import`, `add-export`, `add-property`, `modify-function`, `replace-text`
- Custom transformation functions
- Automatic backup creation before modifications
- Batch processing with glob patterns
- Parser auto-detection (TypeScript, JavaScript, JSON, text)

**Built-in Transformations**:

- **add-import** - Add import statements with proper placement
- **add-export** - Add export declarations
- **add-property** - Add properties to classes or objects
- **replace-text** - String/regex-based text replacement
- **custom** - Execute custom transformation functions

**Safety Features**:

- Syntax validation before transformation
- Backup file creation (optional)
- Dry-run mode support
- Rollback capability on failure

### `recipe-tool.ts`

**Purpose**: Recipe composition and sub-recipe execution

**Key Features**:

- Recipe discovery from multiple sources (local, npm, GitHub, URLs)
- Variable inheritance with override patterns
- Variable mapping and transformation
- Circular dependency detection
- Sub-recipe execution with context isolation
- Result aggregation from child recipes
- Recipe caching for performance

**Recipe Resolution Sources**:

1. **Local Files** - Relative/absolute paths to recipe files
2. **npm Packages** - `@scope/package` or `package-name`
3. **GitHub Repos** - `github:user/repo` or `user/repo`
4. **URLs** - Direct HTTP/HTTPS URLs to recipe files

**Variable Inheritance**:

```yaml
- name: sub-recipe-step
  tool: recipe
  recipe: my-sub-recipe
  inheritVariables: true  # Inherit from parent (default)
  variableOverrides:      # Override specific variables
    environment: production
  recipeConfig:
    variableMapping:      # Map parent vars to different names
      apiKey: api_secret
```

**Circular Dependency Detection**:
Automatically detects and prevents circular recipe dependencies with clear error messages showing the dependency chain.

---

## Design Patterns

### 1. Abstract Base Class Pattern

All tools extend the `Tool<TStep>` base class, which provides:

- Consistent lifecycle management
- Error handling with context
- Resource cleanup
- Metrics collection
- Retry logic

### 2. Factory Pattern

Each tool has a corresponding factory class:

- `TemplateToolFactory`
- `ActionToolFactory`
- `CodeModToolFactory`
- `RecipeToolFactory`

Factories handle:

- Tool instantiation
- Configuration validation
- Default options

### 3. Registry Pattern

The `ToolRegistry` singleton provides:

- Centralized tool management
- Instance caching and reuse
- Search and discovery
- Health monitoring

### 4. Resource Management Pattern

Tools register resources for automatic cleanup:

```typescript
this.registerResource({
  id: 'cache',
  type: 'cache',
  cleanup: () => {
    this.cache.clear();
  },
},);
```

### 5. Type-Safe Step Discrimination

TypeScript discriminated unions ensure type safety:

```typescript
type RecipeStepUnion = TemplateStep | ActionStep | CodeModStep | RecipeStep;
```

Type guards validate step types:

```typescript
if (isTemplateStep(step,)) {
  // TypeScript knows step is TemplateStep
}
```

---

## Tool Implementations

### TemplateTool Execution Flow

```
1. Initialize template engines (EJS, LiquidJS)
2. Validate template exists and is accessible
3. Resolve template file path
4. Process template composition (includes, extends)
5. Render frontmatter and template body
6. Check skip conditions (skip_if, unless_exists)
7. Generate files using addOp/injectOp
8. Return step result with generated files
```

### ActionTool Execution Flow

```
1. Initialize action executor and registry
2. Validate action exists in registry
3. Prepare action context from step context
4. Resolve parameters interactively
5. Configure communication channels
6. Execute action with retry logic
7. Transform ActionResult to StepResult
8. Track execution statistics
```

### CodeModTool Execution Flow

```
1. Initialize TypeScript compiler API
2. Validate codemod type and parameters
3. Resolve file patterns using glob
4. For each file:
   a. Parse source code (AST or text)
   b. Apply transformation
   c. Create backup (if enabled)
   d. Write modified content
5. Aggregate results and statistics
```

### RecipeTool Execution Flow

```
1. Initialize URL manager for remote recipes
2. Validate recipe exists (local/npm/GitHub/URL)
3. Check for circular dependencies
4. Resolve recipe configuration
5. Build sub-recipe context with variable inheritance
6. Execute each sub-recipe step sequentially
7. Aggregate results from all steps
8. Return combined step result
```

---

## Tool Registry System

### Registration

Register tools at startup:

```typescript
import { registerTool, templateToolFactory, } from './tools';

registerTool(
  'template',
  'default-template-tool',
  templateToolFactory,
  {
    version: '1.0.0',
    description: 'Default template processor',
    category: 'generation',
    tags: ['template', 'ejs', 'liquid',],
  },
);
```

### Resolution

Resolve tool instances:

```typescript
import { resolveTool, } from './tools';

// Get cached or create new instance
const tool = await resolveTool('template', 'default-template-tool',);

// Force new instance
const tool = await resolveTool('template', 'default-template-tool', {
  forceNew: true,
  instanceOptions: { cacheEnabled: true, },
},);
```

### Search and Discovery

Find tools by criteria:

```typescript
import { getToolRegistry, } from './tools';

const registry = getToolRegistry();

// Search by type
const templateTools = registry.getByType('template',);

// Search by criteria
const tools = registry.search({
  type: 'action',
  category: 'database',
  tags: ['migration',],
  enabledOnly: true,
},);

// Get statistics
const stats = registry.getStats();
console.log(`Total registrations: ${stats.totalRegistrations}`,);
console.log(`Cached instances: ${stats.cachedInstances}`,);
```

### Health Monitoring

Check registry health:

```typescript
import { checkRegistryHealth, } from './tools';

const health = checkRegistryHealth();
if (!health.healthy) {
  console.error('Registry issues:', health.issues,);
}
console.log('Registry stats:', health.stats,);
```

---

## How It Works

### Example: Template Generation Recipe

```yaml
name: Generate API Endpoint
version: 1.0.0
description: Scaffolds a complete REST API endpoint

variables:
  entityName:
    type: string
    required: true
    prompt: Entity name (e.g., User, Product)
  
steps:
  # Step 1: Generate model file
  - name: generate-model
    tool: template
    template: ./templates/model.ejs.t
    outputDir: ./src/models
    variables:
      entityName: "{{ entityName }}"
  
  # Step 2: Generate controller file
  - name: generate-controller
    tool: template
    template: ./templates/controller.ejs.t
    outputDir: ./src/controllers
    dependsOn:
      - generate-model
  
  # Step 3: Register routes
  - name: register-routes
    tool: codemod
    codemod: add-import
    files:
      - ./src/routes/index.ts
    parameters:
      import: "{{ entityName }}Controller"
      from: "../controllers/{{ entityName | camelCase }}Controller"
  
  # Step 4: Run database migration
  - name: run-migration
    tool: action
    action: database:migrate
    parameters:
      entity: "{{ entityName }}"
      generateMigration: true
    continueOnError: true
```

### Execution Steps

1. **Recipe Engine** loads and parses the recipe YAML
2. **Step Executor** processes steps sequentially (or in parallel if configured)
3. For each step:
   - **Tool Registry** resolves the appropriate tool
   - **Tool** validates step configuration
   - **Tool** executes with full lifecycle management
   - Results are collected and made available to subsequent steps
4. **Recipe Engine** aggregates all results and returns combined output

### Variable Flow

```
Recipe Variables (top-level)
    ↓
Step Variables (step-level)
    ↓
Tool Context (execution context)
    ↓
Template Rendering / Action Execution
```

Variables are merged at each level, with inner scopes overriding outer scopes.

### Error Handling

```
Step Fails
    ↓
Tool wraps error with context
    ↓
Retry logic (if configured)
    ↓
If continueOnError: true
    → Log error, continue to next step
If continueOnError: false
    → Stop execution, cleanup resources, return failure
```

---

## Contributing

### Adding a New Tool

1. **Create tool class** extending `Tool<TStep>`:

```typescript
export class MyTool extends Tool<MyStep> {
  constructor(name: string, options: Record<string, any>,) {
    super('mytool', name, options,);
  }

  protected async onInitialize(): Promise<void> {
    // Setup logic
  }

  protected async onValidate(
    step: MyStep,
    context: StepContext,
  ): Promise<ToolValidationResult> {
    // Validation logic
  }

  protected async onExecute(
    step: MyStep,
    context: StepContext,
    options?: StepExecutionOptions,
  ): Promise<StepResult> {
    // Execution logic
  }

  protected async onCleanup(): Promise<void> {
    // Cleanup logic
  }
}
```

2. **Create factory class**:

```typescript
export class MyToolFactory extends BaseToolFactory<MyStep> {
  constructor() {
    super('mytool',);
  }

  create(name: string, options?: Record<string, any>,): MyTool {
    return new MyTool(name, options,);
  }

  validateConfig(config: Record<string, any>,): ToolValidationResult {
    // Factory-level config validation
  }
}

export const myToolFactory = new MyToolFactory();
```

3. **Add to index.ts**:

```typescript
export { MyTool, MyToolFactory, myToolFactory, } from './my-tool.js';
```

4. **Register tool**:

```typescript
registerTool('mytool', 'default', myToolFactory, {
  version: '1.0.0',
  description: 'My custom tool',
},);
```

### Testing Guidelines

- Test initialization, validation, execution, and cleanup phases
- Test error scenarios and retry logic
- Test resource cleanup
- Test with various step configurations
- Mock external dependencies
- Validate type safety with TypeScript

### Code Style

- Use TypeScript strict mode
- Document all public APIs with JSDoc
- Use debug logging: `this.debug('message', ...args)`
- Follow existing error handling patterns
- Register all resources for cleanup
- Include comprehensive validation

---

## Dependencies

### Internal Dependencies

- `../../errors/hypergen-errors.js` - Error handling system
- `../../logger.js` - Logging infrastructure
- `../types.js` - Recipe step type definitions
- `../../template-engines/index.js` - Template engine integration (TemplateTool)
- `../../actions/*` - Action system integration (ActionTool)
- `../../ops/*` - File operations (TemplateTool)
- `../../config/*` - Configuration and URL resolution (RecipeTool)

### External Dependencies

- `debug` - Debug logging
- `fs-extra` - File system operations
- `typescript` - TypeScript compiler API (CodeModTool)
- `glob` - File pattern matching (CodeModTool)
- `front-matter` - Frontmatter parsing (TemplateTool)
- `js-yaml` - YAML parsing (RecipeTool)

### Related Modules

- **Recipe Engine** (`../recipe-engine.ts`) - Orchestrates recipe execution
- **Step Executor** (`../step-executor.ts`) - Executes individual steps
- **Types** (`../types.js`) - Type definitions for the recipe system

---

## Framework Constants

```typescript
TOOL_FRAMEWORK_VERSION = '8.0.0';
SUPPORTED_TOOL_TYPES = ['template', 'action', 'codemod', 'recipe',];
TOOL_EXECUTION_PHASES = ['validate', 'execute', 'cleanup',];

DEFAULT_REGISTRY_CONFIG = {
  maxCacheSize: 100,
  cacheTimeoutMs: 30 * 60 * 1000, // 30 minutes
  enableInstanceReuse: true,
};

TOOL_FRAMEWORK_CONSTANTS = {
  DEFAULT_TOOL_TIMEOUT: 30000, // 30 seconds
  DEFAULT_VALIDATION_TIMEOUT: 5000, // 5 seconds
  DEFAULT_CLEANUP_TIMEOUT: 10000, // 10 seconds
  DEFAULT_MAX_RETRIES: 3,
  MEMORY_WARNING_THRESHOLD: 512 * 1024 * 1024, // 512MB
  MEMORY_ERROR_THRESHOLD: 1024 * 1024 * 1024, // 1GB
};
```

---

## Debug Logging

Enable debug logging for tools:

```bash
# All tools
DEBUG=hypergen:v8:recipe:tool* npm start

# Specific tool
DEBUG=hypergen:v8:recipe:tool:template npm start

# Tool + registry
DEBUG=hypergen:v8:recipe:tool*,hypergen:v8:recipe:registry npm start
```

Or programmatically:

```typescript
import { DevUtils, } from './tools';

// Enable for specific tool types
DevUtils.enableDebugLogging(['template', 'action',],);

// Get debug information
const debugInfo = DevUtils.getRegistryDebugInfo();
console.log(debugInfo,);
```

---

## Performance Considerations

### Caching

- Template resolutions are cached
- Action executor caches metadata
- CodeMod caches TypeScript configurations
- Recipe configurations are cached
- Tool instances are cached and reused

### Resource Management

- Automatic cleanup prevents memory leaks
- LRU cache eviction for tool instances
- Periodic cleanup of expired instances (10-minute intervals)
- Memory usage tracking with warnings

### Optimization Tips

- Enable instance reuse in registry
- Use appropriate cache timeouts
- Enable caching in tool options
- Batch file operations when possible
- Use parallel execution for independent steps

---

## Error Codes

Common error codes used by tools:

- `TEMPLATE_NOT_FOUND` - Template file not found
- `TEMPLATE_EXECUTION_ERROR` - Template rendering failed
- `TEMPLATE_MISSING_VARIABLES` - Required variables not provided
- `ACTION_NOT_FOUND` - Action not registered
- `ACTION_EXECUTION_FAILED` - Action execution failed
- `CODEMOD_TRANSFORMATION_FAILED` - Code transformation failed
- `VALIDATION_ERROR` - Validation failed
- `INTERNAL_ERROR` - Internal tool error

---

## License

Part of the Hypergen project. See main project LICENSE file.
