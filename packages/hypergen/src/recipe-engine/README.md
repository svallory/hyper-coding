# Recipe Engine - Hypergen V8 Recipe Step System

The Recipe Engine is a comprehensive orchestration system for coordinating complex, multi-step code generation and transformation workflows in Hypergen V8. It unifies templates, actions, codemods, and sub-recipes through a standardized step-based execution model.

## Overview

The Recipe Engine provides:

- **Unified Step System**: A single, consistent interface for templates, actions, codemods, and recipes
- **Orchestration & Dependency Management**: Automatic handling of step dependencies, parallel execution, and execution planning
- **Conditional Logic**: Support for conditional step execution based on dynamic expressions
- **Error Handling & Retries**: Built-in retry logic with exponential backoff and comprehensive error tracking
- **Progress Tracking & Metrics**: Real-time execution progress and detailed performance metrics
- **Tool Registry**: Centralized management of tool instances with lifecycle management and caching
- **Recipe Composition**: Support for nested recipe execution with variable inheritance patterns

## Architecture Overview

The Recipe Engine is organized into several interconnected components:

```
RecipeEngine (recipe-engine.ts)
    ↓
StepExecutor (step-executor.ts)
    ↓
ToolRegistry ← Tool Base Class (tools/)
    ↓
Concrete Tools:
  ├── TemplateTool (template-tool.ts)
  ├── ActionTool (action-tool.ts)
  ├── CodeModTool (codemod-tool.ts)
  └── RecipeTool (recipe-tool.ts)
```

## Directory Structure

```
recipe-engine/
├── index.ts                    # Central export point & initialization utilities
├── types.ts                    # Complete TypeScript type definitions
├── recipe-engine.ts            # Main orchestrator & entry point
├── step-executor.ts            # Step execution and dependency orchestration
│
└── tools/
    ├── index.ts                # Tools framework exports
    ├── base.ts                 # Tool abstract base class and factories
    ├── registry.ts             # Centralized tool registry system
    ├── template-tool.ts        # Template file processing tool
    ├── action-tool.ts          # Action execution tool
    ├── codemod-tool.ts         # Code transformation tool
    └── recipe-tool.ts          # Sub-recipe composition tool
```

## Core Components

### 1. RecipeEngine (recipe-engine.ts)

**Purpose**: Main orchestrator and public API for the Recipe Step System

**Key Responsibilities**:
- Recipe discovery and loading from multiple sources (files, URLs, packages, inline content)
- Recipe validation and preprocessing
- Variable resolution with interactive prompting
- Step execution coordination through StepExecutor
- Result aggregation and error handling
- Event emission for monitoring execution

**Key Methods**:
- `executeRecipe(source, options)`: Execute a recipe from any source
- `loadRecipe(source)`: Load and validate without execution
- `validateRecipe(recipe)`: Validate recipe configuration
- `cancelExecution(executionId)`: Cancel running execution
- `cleanup()`: Release all resources

**Configuration**:
```typescript
interface RecipeEngineConfig {
  stepExecutor?: Partial<StepExecutorConfig>
  toolRegistry?: { maxCacheSize, cacheTimeoutMs, enableInstanceReuse }
  workingDir?: string
  defaultTimeout?: number
  enableDebugLogging?: boolean
  cache?: { enabled, directory, ttl }
  security?: { allowExternalSources, trustedSources, validateSignatures }
}
```

### 2. StepExecutor (step-executor.ts)

**Purpose**: Orchestrates the execution of recipe steps with proper dependency and parallel execution management

**Key Responsibilities**:
- Dependency graph construction and validation
- Circular dependency detection
- Execution phase planning (topological sort)
- Sequential and parallel step execution
- Conditional expression evaluation
- Retry logic with exponential backoff
- Metrics and progress tracking

**Key Methods**:
- `executeSteps(steps, context, options)`: Execute multiple steps
- `executeStep(step, context, options)`: Execute a single step
- `getMetrics()`: Get execution metrics
- `getProgress()`: Get execution progress
- `cancelExecution(executionId)`: Cancel execution

**Execution Flow**:
1. Validate steps and context
2. Build dependency graph
3. Detect circular dependencies
4. Create execution phases (topological sort)
5. Execute phases sequentially
6. Within each phase, execute steps in parallel (respecting max concurrency)
7. Track progress and metrics
8. Handle errors and retries

**Configuration**:
```typescript
interface StepExecutorConfig {
  maxConcurrency: number              // Default: 10
  defaultTimeout: number              // Default: 30000ms
  defaultRetries: number              // Default: 3
  continueOnError: boolean            // Default: false
  enableParallelExecution: boolean    // Default: true
  collectMetrics: boolean             // Default: true
  enableProgressTracking: boolean     // Default: true
  memoryWarningThreshold: number      // Default: 1024MB
  timeoutSafetyFactor: number        // Default: 1.2
}
```

### 3. Tool Framework (tools/)

#### Base Tool Class (base.ts)

**Purpose**: Abstract base class providing common functionality for all tool types

**Key Features**:
- Lifecycle management (initialize, execute, cleanup)
- Error handling with context
- Resource management and cleanup
- Retry logic with backoff
- Performance metrics and event tracking
- Memory usage monitoring

**Lifecycle**:
1. `initialize()`: One-time setup
2. `validate(step, context)`: Validate configuration
3. `execute(step, context, options)`: Execute the step
4. `cleanup()`: Release resources

**Tool Resource Management**:
```typescript
interface ToolResource {
  id: string                          // Unique identifier
  type: 'file' | 'process' | 'network' | 'memory' | 'cache'
  cleanup: () => Promise<void> | void
  metadata?: Record<string, any>
}
```

#### Tool Registry (registry.ts)

**Purpose**: Centralized registry for managing tool instances with caching and lifecycle management

**Key Features**:
- Tool registration and discovery
- Instance caching with TTL
- Tool search by type, name, category, tags
- Statistics and health monitoring
- Automatic cache cleanup and eviction

**Key Methods**:
- `register(toolType, name, factory, metadata)`: Register a tool
- `unregister(toolType, name)`: Unregister a tool
- `resolve(toolType, name, options)`: Get or create a tool instance
- `release(toolType, name, instance)`: Mark instance as available
- `search(criteria)`: Find tools by criteria
- `getStats()`: Get registry statistics

**Caching Strategy**:
- LRU eviction when cache size exceeded
- Configurable TTL (default: 30 minutes)
- Instance reuse within TTL
- Cleanup timer runs every 10 minutes

#### TemplateTool (template-tool.ts)

**Purpose**: Process template files and generate output files

**Features**:
- Integration with EJS and LiquidJS engines
- Frontmatter processing (to:, skip_if:, inject:, unless_exists:, force:)
- Template discovery and resolution
- Variable substitution and context helpers
- Template composition support
- File generation with conflict handling

**Execution Flow**:
1. Resolve template file
2. Parse frontmatter
3. Render template with context
4. Apply frontmatter directives
5. Generate output files
6. Track created/modified files

#### ActionTool (action-tool.ts)

**Purpose**: Execute TypeScript decorator-based actions

**Features**:
- Integration with ActionExecutor and ActionRegistry
- Parameter resolution and validation
- Context preparation from step to action context
- Action communication and lifecycle
- Performance tracking

**Execution Flow**:
1. Resolve action from registry
2. Prepare context
3. Resolve parameters
4. Execute action
5. Track results

#### CodeModTool (codemod-tool.ts)

**Purpose**: Perform AST-based code transformations

**Features**:
- TypeScript AST transformations
- Support for add-import, add-export, modify-function, add-property, replace-text
- Fallback text-based transformations for non-TS files
- File backup support
- Syntax validation

**Supported Transformations**:
- `add-import`: Add import statements
- `add-export`: Add export statements
- `modify-function`: Modify function signatures and bodies
- `add-property`: Add properties to classes or objects
- `replace-text`: Find and replace text patterns
- `custom`: Custom transformation functions

#### RecipeTool (recipe-tool.ts)

**Purpose**: Handle recipe composition by executing sub-recipes

**Features**:
- Recipe discovery from multiple sources
- Variable inheritance and overrides
- Sub-recipe execution with isolation
- Circular dependency detection
- Recipe caching
- Result aggregation

**Execution Flow**:
1. Resolve sub-recipe
2. Prepare context with variable inheritance
3. Execute sub-recipe steps
4. Aggregate results
5. Return to parent recipe

## Type System (types.ts)

The Recipe Engine defines a comprehensive type hierarchy for step-based recipes:

### Core Types

```typescript
// Tool types
type ToolType = 'template' | 'action' | 'codemod' | 'recipe'
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'

// Discriminated union of all step types
type RecipeStepUnion = TemplateStep | ActionStep | CodeModStep | RecipeStep

// Core configuration
interface RecipeConfig {
  name: string
  description?: string
  version?: string
  variables: Record<string, TemplateVariable>
  steps: RecipeStepUnion[]
  examples?: RecipeExample[]
  dependencies?: RecipeDependency[]
  hooks?: {
    beforeRecipe?: string[]
    afterRecipe?: string[]
    beforeStep?: string[]
    afterStep?: string[]
    onError?: string[]
    onStepError?: string[]
  }
  settings?: {
    timeout?: number
    retries?: number
    continueOnError?: boolean
    maxParallelSteps?: number
  }
  composition?: {
    extends?: string
    includes?: Array<{ recipe: string; version?: string }>
  }
}
```

### Step Types

Each step type extends `BaseRecipeStep`:

```typescript
interface BaseRecipeStep {
  name: string                    // Unique step identifier
  description?: string
  when?: string                   // Conditional expression
  dependsOn?: string[]            // Step dependencies
  parallel?: boolean              // Can run in parallel
  continueOnError?: boolean       // Continue if this step fails
  timeout?: number                // Step timeout
  retries?: number                // Retry count
  tags?: string[]
  variables?: Record<string, any> // Step-specific variables
  environment?: Record<string, string>
}

// TemplateStep: Generate files from templates
interface TemplateStep extends BaseRecipeStep {
  tool: 'template'
  template: string
  engine?: 'ejs' | 'liquid' | 'auto'
  outputDir?: string
  overwrite?: boolean
  exclude?: string[]
  templateConfig?: { variables, composition }
}

// ActionStep: Execute actions
interface ActionStep extends BaseRecipeStep {
  tool: 'action'
  action: string
  parameters?: Record<string, any>
  dryRun?: boolean
  force?: boolean
  actionConfig?: { communication }
}

// CodeModStep: Transform code
interface CodeModStep extends BaseRecipeStep {
  tool: 'codemod'
  codemod: string
  files: string[]
  backup?: boolean
  parser?: 'typescript' | 'javascript' | 'json' | 'auto'
  parameters?: Record<string, any>
  force?: boolean
  codemodConfig?: { transform, validation }
}

// RecipeStep: Execute sub-recipes
interface RecipeStep extends BaseRecipeStep {
  tool: 'recipe'
  recipe: string
  version?: string
  inheritVariables?: boolean
  variableOverrides?: Record<string, any>
  recipeConfig?: { execution, variableMapping }
}
```

### Execution Context & Results

```typescript
interface StepContext {
  step: RecipeStepUnion
  variables: Record<string, any>
  projectRoot: string
  recipeVariables: Record<string, any>
  stepResults: Map<string, StepResult>
  recipe: { id, name, version, startTime }
  stepData: Record<string, any>
  evaluateCondition: (expression, context) => boolean
  dryRun?: boolean
  force?: boolean
  logger?: ActionLogger
  utils?: ActionUtils
  communication?: { send, receive, waitForStep }
}

interface StepResult {
  status: StepStatus
  stepName: string
  toolType: ToolType
  startTime: Date
  endTime?: Date
  duration?: number
  retryCount: number
  dependenciesSatisfied: boolean
  conditionResult?: boolean
  toolResult?: ActionResult | TemplateExecutionResult | CodeModExecutionResult | RecipeExecutionResult
  filesCreated?: string[]
  filesModified?: string[]
  filesDeleted?: string[]
  error?: { message, code?, stack?, cause? }
  output?: Record<string, any>
  metadata?: Record<string, any>
}
```

## How It Works: Execution Flow

### 1. Recipe Loading and Validation

```
User calls executeRecipe(source)
    ↓
Normalize source (file/URL/package/content)
    ↓
Load recipe content
    ↓
Parse YAML/JSON
    ↓
Validate recipe structure
    ↓
Load and validate dependencies
    ↓
Cache valid recipe
```

### 2. Variable Resolution

```
For each recipe variable:
    ↓
Check if value provided
    ↓
Use default if available
    ↓
If required and missing:
    - If skipPrompts: error
    - Otherwise: prompt user
    ↓
Validate value against type/constraints
    ↓
Merge provided + resolved variables
```

### 3. Execution Planning

```
Build dependency graph (name → dependencies)
    ↓
Detect circular dependencies (DFS)
    ↓
Calculate priority/depth for each step
    ↓
Create execution phases via topological sort:
    Phase 1: [steps with no dependencies]
    Phase 2: [steps whose deps are in phase 1]
    ...
    ↓
Determine which phases can parallelize
```

### 4. Step Execution

```
For each phase sequentially:
    ↓
    For each step (parallel if applicable):
        ↓
        Evaluate condition (skip if false)
        ↓
        Resolve tool from registry
        ↓
        Initialize tool if needed
        ↓
        Validate step configuration
        ↓
        Retry loop (up to maxRetries):
            ↓
            Execute step through tool.execute()
            ↓
            On success: return result
            ↓
            On failure: retry with backoff
        ↓
        Update step results
        ↓
        Update progress and metrics
```

### 5. Result Aggregation

```
Collect all step results
    ↓
Aggregate file changes (created/modified/deleted)
    ↓
Collect errors and warnings
    ↓
Calculate execution duration
    ↓
Finalize metrics
    ↓
Return RecipeExecutionResult
```

## Integration Points

### With Hypergen Core

- **Templates**: Uses existing template engine factories (EJS/LiquidJS)
- **Actions**: Integrates with ActionExecutor and ActionRegistry
- **Context**: Leverages context helpers for variable substitution
- **Operations**: Uses existing file operations (add, inject)
- **Errors**: Uses HypergenError framework with ErrorHandler

### External Integrations

- **Configuration**: Works with existing config resolver system
- **Template Parser**: Uses TemplateVariable and TemplateParser for validation
- **URL Management**: Integrates with TemplateURLManager for recipe discovery
- **Logging**: Uses Logger interface for consistent output

## Contributing & Working with Recipe Engine

### Adding a New Tool Type

1. **Create tool class** extending `Tool<TStep>`:
```typescript
export class MyTool extends Tool<MyStep> {
  constructor(name: string, options?: Record<string, any>) {
    super('mytool', name, options)
  }
  
  protected async onValidate(step: MyStep, context: StepContext): Promise<ToolValidationResult> {
    // Validation logic
  }
  
  protected async onExecute(step: MyStep, context: StepContext): Promise<StepResult> {
    // Execution logic
  }
}
```

2. **Create factory**:
```typescript
export class MyToolFactory extends BaseToolFactory<MyStep> {
  constructor() { super('mytool') }
  
  create(name: string, options?: Record<string, any>): Tool<MyStep> {
    return new MyTool(name, options)
  }
}
```

3. **Register in ToolRegistry**:
```typescript
registry.register('mytool', 'my-tool', new MyToolFactory(), {
  description: 'My tool description',
  category: 'transformations'
})
```

4. **Export from tools/index.ts**

### Creating a Recipe

```yaml
name: my-recipe
description: Recipe description
version: 1.0.0

variables:
  projectName:
    type: string
    description: Project name
    required: true
  useTypescript:
    type: boolean
    default: true

steps:
  - name: generate-base
    tool: template
    template: ./templates/base
    variables:
      projectName: "{{ projectName }}"
    
  - name: configure-ts
    tool: action
    action: setup-typescript
    when: "{{ useTypescript }}"
    dependsOn: [generate-base]
    parameters:
      strictMode: true
    
  - name: format-code
    tool: codemod
    codemod: prettier-format
    files: ["src/**/*.ts"]
    dependsOn: [generate-base, configure-ts]
    
  - name: setup-ci
    tool: recipe
    recipe: ./recipes/ci-setup
    inheritVariables: true
    parallelizable: false
```

### Testing Recipe Steps

```typescript
const engine = new RecipeEngine({ enableDebugLogging: true })
const result = await engine.executeRecipe('path/to/recipe.yml', {
  variables: { projectName: 'test' },
  dryRun: true,
  skipPrompts: true
})
```

## Performance Considerations

### Parallelization

- Steps without dependencies run in parallel
- Concurrency limited by `maxConcurrency` (default: 10)
- Parallel execution speeds up multi-tool workflows

### Caching

- Tool instances cached by registry (reduces initialization overhead)
- Recipes cached after validation (accelerates repeated runs)
- Configurable TTL for cache entries

### Memory Management

- Resource cleanup in tool lifecycle
- Cache eviction using LRU strategy
- Memory monitoring and warnings
- Cleanup timer prevents unbounded cache growth

### Timeouts

- Per-step timeouts prevent hung steps
- Retry backoff respects timeouts
- Overall recipe timeout available

## Error Handling

### Validation Errors
- Configuration validation fails recipe execution
- Detailed error messages with location info
- Suggestions for fixes

### Execution Errors
- Automatic retry with exponential backoff
- `continueOnError` option for partial failures
- Detailed error context and stack traces

### Circular Dependencies
- Detected during planning phase
- Prevents infinite loops
- Clear error messages showing cycle

### Resource Cleanup
- Errors don't prevent cleanup
- All resources released in finally blocks
- Cleanup errors logged but don't mask original error

## Monitoring & Debugging

### Progress Tracking
- Real-time progress percentage
- Current phase description
- Running/completed/failed/skipped step counts
- Estimated remaining time

### Metrics Collection
- Total execution time
- Per-step execution times
- Memory usage (peak, average)
- Parallelization statistics
- Retry and error statistics
- Dependency resolution time

### Debug Logging
- Enable with `DEBUG=hypergen:v8:recipe:*`
- Separate namespaces:
  - `hypergen:v8:recipe:engine` - RecipeEngine
  - `hypergen:v8:recipe:step-executor` - StepExecutor
  - `hypergen:v8:recipe:tool` - Tool base
  - `hypergen:v8:recipe:tool:template` - TemplateTool
  - `hypergen:v8:recipe:tool:action` - ActionTool
  - `hypergen:v8:recipe:tool:codemod` - CodeModTool
  - `hypergen:v8:recipe:tool:recipe` - RecipeTool
  - `hypergen:v8:recipe:registry` - ToolRegistry

## Key Design Patterns

### Discriminated Union Types
All step types use discriminated unions with `tool` discriminant for type safety

### Strategy Pattern
Tool framework allows plugging in different tool implementations

### Registry Pattern
Central tool registry manages instances with factory pattern

### Observer Pattern
Event emitters for progress tracking and monitoring

### Dependency Injection
Context provides services to steps (logger, utils, condition evaluator)

### Graceful Degradation
Retry logic, continue-on-error, optional dependencies

## Dependencies

- `debug`: Debug logging
- `js-yaml`: YAML parsing
- `front-matter`: Frontmatter processing
- `glob`: File pattern matching
- `typescript`: AST transformations
- `fs-extra`: Enhanced file operations
- `events`: EventEmitter for progress/monitoring

## Related Documentation

- **Hypergen Core**: Main orchestrator using Recipe Engine
- **Action System**: Decorator-based action execution
- **Template Engines**: EJS and LiquidJS integration
- **Config System**: Recipe configuration loading
- **Type System**: TypeScript types for recipes

---

**Version**: 8.0.0  
**Status**: Production Ready  
**Last Updated**: 2024
## TODO

-   [ ] **Recipe Engine (`recipe-engine.ts`)**:
    *   Implement `node-fetch` as a dependency for URL sources.
    *   Implement full NPM/Yarn APIs for `loadPackageContent`.
    *   Enhance `file` and `directory` prompt types with file/directory pickers.
    *   Implement a safer evaluation method for `createConditionEvaluator`.
    *   Implement `template.yml` parser for more robust metadata extraction in `extractGeneratorMetadata()`.
-   [ ] **Step Executor (`step-executor.ts`)**:
    *   Implement continuous memory monitoring for accurate peak memory usage.
-   [ ] **Recipe Engine Types (`types.ts`)**:
    *   Add `templatePath` to `ValidationContext` in `validateVariableValue` function.