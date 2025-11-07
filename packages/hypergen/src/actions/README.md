# Actions Module

## Overview

The Actions module is Hypergen's V8 action system - a decorator-based, TypeScript-first system for defining and executing reusable, composable actions within templates and workflows. Actions are the core building blocks for template-driven code generation, enabling templates to perform complex operations like file creation, code injection, dependency installation, and git operations.

Think of actions as "smart template operations" - they go beyond simple file templating by allowing templates to execute arbitrary logic, ask users for input, communicate with other actions, and compose into complex workflows.

## Module Purposes

1. **Action Definition**: Decorate TypeScript functions with metadata to make them discoverable and executable
2. **Parameter Resolution**: Interactive and programmatic parameter validation, prompting, and type coercion
3. **Execution Management**: Execute actions with context, error handling, and lifecycle hooks
4. **Lifecycle Control**: Pre-hooks, post-hooks, and error handlers for action execution
5. **Inter-Action Communication**: Enable actions to send messages, share data, and wait for other actions
6. **Pipeline Composition**: Build complex multi-step workflows with dependency management and parallel execution
7. **Utilities**: File operations, command execution, and package management helpers

## Architecture & Design Patterns

### Core Architecture

```
┌─────────────────────────────────────────┐
│     User/Template/CLI Entry Point        │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │ ActionExecutor │  ◄── Main orchestrator
         └───┬────────────┘
             │
      ┌──────┼──────┬──────────────┐
      │             │              │
┌─────▼──────┐ ┌────▼──────────┐ ┌▼──────────┐
│  Registry  │ │  Parameter    │ │Lifecycle  │
│            │ │  Resolver     │ │ Manager   │
└────────────┘ └───────────────┘ └───────────┘
      │             │                  │
      └─────┬───────┴──────┬───────────┘
            │              │
     ┌──────▼──┐      ┌─────▼─────────┐
     │ Decorator│      │Communication │
     │          │      │ Manager       │
     └──────────┘      └───────────────┘
            │              │
     ┌──────▼──────────────▼──┐
     │    ActionPipeline      │
     │    Manager             │
     └────────────────────────┘
```

### Key Design Patterns

**1. Decorator Pattern**
- `@action()` decorator attaches metadata to functions
- Metadata stored as Symbol on function for type safety
- Automatic registration with ActionRegistry upon decoration

**2. Registry Pattern**
- Singleton ActionRegistry for centralized action management
- Indexed storage for fast lookup by name, category, or tags
- Supports discovery queries and statistics

**3. Context-Based Execution**
- Rich ActionContext with variables, utilities, logger, and communication
- Passed to all hooks and the main action function
- Allows actions to access everything they need

**4. Hook-Based Lifecycle**
- Pre-execution, post-execution, and error hooks
- Global hooks apply to all actions, action-specific hooks for targeted execution
- Priority-based ordering for deterministic execution
- Timeout support prevents hanging hooks

**5. Pipeline Orchestration**
- Multi-step workflows with dependency graphs
- Parallel and sequential execution modes
- Conditional step execution based on pipeline variables
- Built-in retry logic with exponential backoff

**6. Pub/Sub Communication**
- Event-driven messaging between actions
- Shared data store for cross-action state
- Message history and correlation tracking
- Channel-based message routing

## Key Files and Their Purposes

### Core System Files

#### `types.ts`
Comprehensive type definitions for the entire action system:
- `ActionMetadata`: Decorator configuration (name, description, parameters, category, tags, examples)
- `ActionParameter`: Parameter definition with type, validation, and constraints
- `ActionContext`: Execution environment with variables, utils, logger, and communication
- `ActionResult`: Return value with success status, files modified, and metadata
- `ActionFunction`: The signature all actions must follow: `(context: ActionContext) => Promise<ActionResult>`
- `ActionLogger`: Logging interface used throughout
- `ActionUtils`: File operations and command execution interface
- Error classes: `ActionExecutionError`, `ActionParameterError`

#### `decorator.ts`
Decorator implementation for defining actions:
- `@action(metadata)`: Main decorator factory
- `getActionMetadata(fn)`: Extract metadata from decorated function
- `isActionFunction(fn)`: Type guard to check if function is decorated
- Metadata validation ensuring proper naming and parameter definitions
- Automatic registration with ActionRegistry upon decoration

#### `registry.ts`
Singleton registry for action discovery and management:
- `ActionRegistry.getInstance()`: Get or create the singleton
- `register(fn, metadata)`: Add decorated action to registry
- `get(name)`: Retrieve action by name
- `getAll()`: Get all registered actions
- `getByCategory(category)`: Filter actions by category
- `getByTags(tags)`: Filter actions by tags (OR operation)
- `query(options)`: Advanced filtering by category, tags, or search term
- Index management for fast lookups
- Statistics tracking

#### `executor.ts`
Main action execution engine:
- `ActionExecutor`: Orchestrates parameter resolution, lifecycle, and execution
- `executeInteractively()`: Execute with interactive prompting for missing parameters
- `execute()`: Non-interactive execution using defaults
- `executeSequence()`: Run multiple actions sequentially
- `executeParallel()`: Run multiple actions in parallel
- `executeWorkflow()`: Run actions with dependency management and communication
- `executeTemplate()`: Execute template with composition support
- `validateParameters()`: Validate without executing
- Lifecycle hook management and registration
- Communication manager integration

### Parameter and Input Handling

#### `parameter-resolver.ts`
Handles all parameter resolution and validation:
- `resolveParametersInteractively()`: Resolve with interactive prompts
- `resolveParameters()`: Resolve without prompts using defaults
- Parameter precedence: command-line → defaults → prompts
- Type validation for all parameter types
- Pattern matching for strings
- Range validation for numbers
- Enum validation
- File and directory path validation
- Conversion of action parameters to template variables for prompting

### Execution Management

#### `lifecycle.ts`
Manages action execution lifecycle:
- `ActionLifecycleManager`: Manages pre-hooks, post-hooks, and error hooks
- `LifecycleHook`: Hook definition with phase, action, condition, and priority
- `registerHook(actionName, hook)`: Register hooks globally or per-action
- Hook execution with timeout protection
- Priority-based ordering (higher priority runs first)
- Conditional hook execution based on context
- Built-in hooks for common operations (formatting, dependencies, git, backups)
- Comprehensive lifecycle tracking and reporting

### Communication and Workflows

#### `communication.ts`
Cross-action communication and state management:
- `ActionCommunicationManager`: Extends EventEmitter for pub/sub messaging
- `ActionMessage`: Typed messages with source, target, type, and payload
- `ActionState`: Per-action state tracking (status, data, metadata, timing)
- Shared data store for cross-action state
- Communication channels (broadcast, direct, topic)
- Message history and correlation tracking
- `registerAction()`, `updateActionState()`, `completeAction()`, `failAction()`: State management
- `sendMessage()`, `subscribeToMessages()`: Messaging
- `setSharedData()`, `getSharedData()`: Shared state
- `waitForAction()`: Wait for specific action completion
- Global manager singleton with configuration

#### `pipelines.ts`
Complex workflow composition and execution:
- `ActionPipelineManager`: Orchestrates multi-step workflows
- `PipelineConfig`: Workflow definition with steps, variables, hooks, and settings
- `PipelineStep`: Individual step with id, name, parameters, condition, dependencies, retries
- `PipelineExecution`: Tracks pipeline run with step results and metadata
- `executePipeline()`: Run complete workflow
- Dependency graph resolution for step ordering
- Parallel and sequential execution modes
- Conditional step execution via expression evaluation
- Retry logic with exponential backoff
- Pipeline-level and step-level hooks
- Progress tracking and error aggregation
- Circular dependency detection

### Utilities

#### `utils.ts`
Practical utilities for action implementations:
- `DefaultActionUtils`: File and command execution utilities
  - File operations: exists, read, write, copy, delete, glob
  - Directory creation
  - Command execution via execa
  - Package manager detection and installation (bun/yarn/pnpm/npm)
- `ConsoleActionLogger`: Console output with emoji indicators
- `SilentActionLogger`: No-op logger for testing

### Module Exports

#### `index.ts`
Public API surface:
- Type exports: All interfaces and types
- Decorator: `@action`, `getActionMetadata()`, `isActionFunction()`
- Registry: `ActionRegistry` class
- Executor: `ActionExecutor` class
- Parameter Resolution: `ActionParameterResolver` class
- Utilities: `DefaultActionUtils`, `ConsoleActionLogger`, `SilentActionLogger`
- Error Classes: `ActionExecutionError`, `ActionParameterError`

## High-Level Flow

### Simple Action Execution Flow

```
1. Define Action (Developer)
   ├─ Create async function
   ├─ Add @action({metadata})
   └─ Function auto-registers with ActionRegistry

2. Discovery (Runtime)
   └─ ActionRegistry has action available

3. Execution (User/Template)
   ├─ executor.executeInteractively(actionName, params)
   ├─ ActionParameterResolver resolves missing params
   ├─ Create ActionContext with vars, utils, logger, communication
   ├─ ActionLifecycleManager executes pre-hooks
   ├─ Execute main action function
   ├─ ActionLifecycleManager executes post-hooks
   └─ Return ActionResult

4. Communication
   └─ ActionCommunicationManager tracks state and messages
```

### Pipeline Execution Flow

```
1. Register Pipeline
   ├─ Define PipelineConfig with steps
   ├─ Validate configuration
   ├─ Register with ActionPipelineManager
   └─ Validate dependencies, detect cycles

2. Execute Pipeline
   ├─ Create PipelineExecution to track run
   ├─ Execute beforePipeline hooks
   ├─ Process steps:
   │  ├─ Build dependency graph
   │  ├─ Execute ready steps (parallel or sequential)
   │  ├─ Handle retries with exponential backoff
   │  ├─ Update pipeline variables with step results
   │  ├─ Execute beforeStep/afterStep hooks per step
   │  └─ Track step results and timing
   ├─ Execute afterPipeline hooks
   └─ Return full PipelineExecution with all results
```

## How the Code Works

### Action Definition Example

```typescript
import { action, ActionContext, ActionResult } from './actions'

// Define and decorate an action
@action({
  name: 'create-component',
  description: 'Create a React component',
  category: 'templates',
  tags: ['react', 'component'],
  parameters: [
    {
      name: 'componentName',
      type: 'string',
      required: true,
      description: 'Name of the component',
      pattern: '^[A-Z][a-zA-Z0-9]*$' // PascalCase
    },
    {
      name: 'withStyles',
      type: 'boolean',
      default: true,
      description: 'Include CSS module'
    },
    {
      name: 'exportType',
      type: 'enum',
      values: ['default', 'named'],
      default: 'default'
    }
  ],
  examples: [
    {
      title: 'Create simple component',
      parameters: { componentName: 'Button', withStyles: false }
    }
  ]
})
export async function createComponent(context: ActionContext): Promise<ActionResult> {
  const { componentName, withStyles } = context.variables
  const { fileExists, writeFile, createDirectory } = context.utils
  const { projectRoot } = context
  
  context.logger.info(`Creating component: ${componentName}`)
  
  const componentDir = `${projectRoot}/src/components/${componentName}`
  createDirectory(componentDir)
  
  // Create component file
  const componentContent = `export const ${componentName} = () => {
    return <div>${componentName}</div>
  }`
  writeFile(`${componentDir}/index.tsx`, componentContent)
  
  // Create styles if requested
  if (withStyles) {
    const styleContent = `.${componentName} {}`
    writeFile(`${componentDir}/styles.module.css`, styleContent)
  }
  
  context.logger.info(`Component created successfully`)
  
  return {
    success: true,
    message: `Created ${componentName} component`,
    filesCreated: [
      `${componentDir}/index.tsx`,
      withStyles ? `${componentDir}/styles.module.css` : null
    ].filter(Boolean),
    metadata: {
      componentName,
      withStyles
    }
  }
}
```

### Action Execution Example

```typescript
import { ActionExecutor } from './actions'

// Create executor
const executor = new ActionExecutor()

// Execute with interactive prompts
const result = await executor.executeInteractively(
  'create-component',
  { componentName: 'Card' }, // Some params pre-filled
  {
    projectRoot: process.cwd(),
    logger: new ConsoleActionLogger()
  },
  {
    useDefaults: false, // Prompt for all
    skipOptional: false
  }
)

console.log(result.filesCreated)
```

### Pipeline Example

```typescript
import { ActionPipelineManager } from './actions'

const pipelineManager = new ActionPipelineManager()

// Register a pipeline
pipelineManager.registerPipeline({
  name: 'setup-project',
  description: 'Setup new project with components and configs',
  steps: [
    {
      id: 'init',
      name: 'init-project',
      parameters: { projectName: 'my-app' }
    },
    {
      id: 'components',
      name: 'create-component',
      parameters: { componentName: 'Layout', withStyles: true },
      dependsOn: ['init'] // Wait for init to complete
    },
    {
      id: 'docs',
      name: 'generate-docs',
      parallel: true, // Can run alongside other steps at same level
      dependsOn: ['components']
    },
    {
      id: 'install',
      name: 'install-dependencies',
      dependsOn: ['docs'],
      retries: 2 // Retry up to 2 times on failure
    }
  ],
  hooks: {
    beforePipeline: ['validate-prerequisites'],
    afterPipeline: ['format-files', 'open-editor']
  },
  settings: {
    timeout: 60000,
    continueOnError: false
  }
})

// Execute the pipeline
const execution = await pipelineManager.executePipeline('setup-project', {
  projectName: 'my-awesome-app'
})

console.log(`Pipeline execution took ${execution.duration}ms`)
console.log(`Created ${execution.metadata.completedSteps} steps`)
```

## Dependencies and Relationships

### Internal Dependencies

- **errors/hypergen-errors.ts**: Error handling and ErrorHandler class
- **config/template-composition.ts**: Template composition engine used in `executeTemplate()`
- **config/template-parser.ts**: Template parsing and TemplateVariable types
- **prompts/interactive-prompts.ts**: InteractivePrompter for parameter prompts
- **recipe-engine/**: Uses actions for recipe execution
- **discovery/**: Template discovery integrates with action system
- **cli/**: CLI commands use ActionExecutor

### External Dependencies

- **debug**: Logging via `createDebug('hypergen:v8:action:*')`
- **fs-extra**: File system operations
- **path**: Path manipulation
- **glob**: Glob pattern matching
- **execa**: Command execution
- **events**: EventEmitter for ActionCommunicationManager

### Usage Points

1. **Templates**: Execute actions during template generation
2. **CLI**: Commands can trigger actions
3. **Recipe Engine**: Uses actions as tools in recipes
4. **Generator Discovery**: Discovers and manages actions
5. **Scaffolding**: Scaffolding commands use action system

## How to Contribute/Work With This Code

This module is central to Hypergen's functionality. Contributions are welcome, and understanding its structure is key.

### Adding a New Action

1.  Create an async function with the signature `(context: ActionContext) => Promise<ActionResult>`.
2.  Decorate it with `@action()` providing relevant metadata (name, description, parameters, etc.).
3.  Utilize `context.utils` for file operations and `context.logger` for output.
4.  Return an `ActionResult` object indicating success/failure, messages, and file changes.
5.  The action will automatically register with `ActionRegistry` upon decoration.

    ```typescript
    @action({
      name: 'my-action',
      description: 'Does something useful',
      parameters: [/* ... */]
    })
    export async function myAction(context: ActionContext): Promise<ActionResult> {
      // implementation
      return { success: true, message: 'Done!' }
    }
    ```

### Adding a Lifecycle Hook

Lifecycle hooks allow you to inject logic at different phases of an action's execution (pre, post, error).

```typescript
executor.registerLifecycleHook('my-action', {
  name: 'my-hook',
  phase: 'pre', // 'pre', 'post', or 'error'
  priority: 100, // Higher runs first
  condition: (context) => context.variables.something === true, // Optional
  action: async (context) => ({
    success: true,
    message: 'Hook executed'
  })
})
```

### Creating a Pipeline

Pipelines compose multiple actions into complex workflows with dependencies and conditional execution.

```typescript
const pipeline: PipelineConfig = {
  name: 'my-workflow',
  steps: [
    { id: '1', name: 'action-a' },
    { id: '2', name: 'action-b', dependsOn: ['1'] }
  ]
}
pipelineManager.registerPipeline(pipeline)
await pipelineManager.executePipeline('my-workflow')
```

### Testing Actions

When testing actions, you can mock the `ActionContext` to control variables, utilities, and logging behavior.

```typescript
// Mock context
const mockContext: ActionContext = {
  variables: { /* ... */ },
  projectRoot: '/test',
  logger: new SilentActionLogger(),
  utils: new DefaultActionUtils()
}

// Execute directly
const result = await myAction(mockContext)
expect(result.success).toBe(true)
```

### Debugging

Enable debug output for the entire action system or specific modules:

```bash
# All action-related debug output
DEBUG=hypergen:v8:action:* bun run hypergen <command>

# Specific module, e.g., executor
DEBUG=hypergen:v8:action:executor bun run hypergen <command>
```

## TODO

-   [ ] **Communication Module (`communication.ts`)**:
    *   Implement smart merging for variable conflicts in `mergeVariables` function.
    *   Implement user prompting for conflicts in `mergeVariables` function.
    *   Make `maxHistory` configurable per channel in `trimChannelHistory` function.
-   [ ] **Parameter Resolver (`parameter-resolver.ts`)**:
    *   Add file existence validation for `file` and `directory` parameter types.
-   [ ] **Executor (`executor.ts`)**:
    *   Implement template rendering for computed variables in `executeTemplate` function.
-   [ ] **Pipelines (`pipelines.ts`)**:
    *   Replace simple expression evaluation with a proper expression parser in `evaluateCondition` function.
-   [ ] **Registry (`registry.ts`)**:
    *   Improve module path extraction from function for better error reporting in `getModulePath` function.
-   [ ] **Types (`types.ts`)**:
    *   Refine `ActionCommunicationManager` type in `ActionCommunication` interface.


## Implementation Details

### Parameter Resolution Process

1. Start with provided parameters
2. Validate provided parameters against definitions
3. If `useDefaults=true`, fill missing with defaults
4. Identify parameters still needing values
5. For missing required params: prompt user (or error in test mode)
6. For missing optional params (if `skipOptional=false`): prompt user
7. Final validation of all provided values
8. Return complete resolved parameters

### Lifecycle Execution

1. Collect all applicable hooks (global + action-specific)
2. Sort by phase and priority
3. Execute pre-hooks with condition checks
4. Execute main action
5. On error: execute error-hooks, then throw
6. On success: execute post-hooks
7. Return main result + lifecycle metadata

### Pipeline Dependency Resolution

1. Validate all dependencies reference existing steps
2. Detect circular dependencies via depth-first search
3. Build execution plan with topological sort
4. Process steps in waves, waiting for dependencies
5. Support parallel execution of independent steps
6. Retry failed steps with exponential backoff (1s, 2s, 4s, etc.)

### Message Correlation

- Messages can have correlationId for linking related messages
- Tracked in a separate map for efficient lookup
- Used for understanding action interaction chains

### Channel-Based Routing

- Broadcast channels: all messages go to persistent history
- Direct messages: routed only to specified target
- Topic channels: support pub/sub patterns (extensible)

## Important Implementation Notes

- **Async Throughout**: All operations are async - no blocking calls
- **Type Safe**: Full TypeScript types throughout
- **Error Handling**: Rich error messages with context
- **Logging**: Debug logging at all key points
- **Performance**: No polling - event-driven communication
- **Testable**: SilentActionLogger and DefaultActionUtils can be mocked
- **Extensible**: Custom hooks, utilities, and communication channels
- **Timeout Protection**: All async operations can timeout
- **Idempotent Utilities**: File operations handle existing files gracefully

## Testing Strategy

The module has comprehensive test coverage:
- `v8-actions.spec.ts`: Core action system tests
- `action-pipelines.test.ts`: Pipeline composition and execution
- `cross-action-communication.test.ts`: Inter-action messaging
- `v8-integration/action-tool.test.ts`: Integration with recipe engine

Tests cover:
- Action definition and registration
- Parameter resolution with different options
- Lifecycle hook execution
- Pipeline execution with dependencies
- Message passing and shared data
- Error handling and recovery
- Parallel and sequential execution
