# RecipeEngine Refactoring Analysis

**Date**: 2025-11-09
**File**: `/work/hyperdev/packages/hypergen/src/recipe-engine/recipe-engine.ts`
**Lines of Code**: ~1411
**Current Architecture**: Class-based with EventEmitter inheritance

---

## Executive Summary

**Verdict**: The `RecipeEngine` class is **NOT justified** and should be refactored to a functional architecture.

**Key Finding**: While the class manages state (caching, active executions), this state management is:
1. Not inherently object-oriented (no polymorphism, inheritance benefits)
2. Could be better handled through functional patterns (closures, pure functions)
3. Creates unnecessary coupling between concerns
4. Makes testing and composition more difficult

**Recommendation**: Refactor to a functional architecture with:
- Pure functions for core logic
- Closures for state management where needed
- Separate modules for distinct concerns
- Clear public API via index.ts exports

---

## Detailed Analysis

### Current Class Responsibilities

The `RecipeEngine` class currently handles 8 distinct concerns:

1. **Recipe Loading** (lines 451-502)
   - File/URL/package content loading
   - Recipe parsing and caching
   - Dependency loading

2. **Recipe Validation** (lines 507-613)
   - Structure validation
   - Variable validation
   - Step validation
   - Dependency validation

3. **Variable Resolution** (lines 872-942)
   - User prompting
   - Default value handling
   - Type validation

4. **Execution Orchestration** (lines 305-446)
   - Context creation
   - StepExecutor coordination
   - Result aggregation

5. **Caching** (lines 232-235, 1340-1366)
   - Recipe cache management
   - TTL-based cleanup

6. **Lifecycle Management** (lines 625-675)
   - Execution tracking
   - Cancellation
   - Cleanup

7. **Event Emission** (lines 266-290)
   - Progress events
   - Lifecycle events
   - StepExecutor event forwarding

8. **Configuration Management** (lines 237-265)
   - Config initialization
   - Debug logging setup
   - Component initialization

### EventEmitter Inheritance Analysis

**Current Usage**:
```typescript
export class RecipeEngine extends EventEmitter {
  // Emits: recipe:started, recipe:completed, recipe:failed, recipe:cancelled
  // Forwards: execution:*, step:*, phase:*
}
```

**Problems**:
1. **Tight Coupling**: Forces all consumers to deal with EventEmitter API
2. **Hidden Dependencies**: Event listeners are global state
3. **Testing Complexity**: Need to mock/spy on events
4. **No Type Safety**: Event names and payloads are strings/any
5. **Inheritance Tax**: Gets all EventEmitter methods (addListener, removeAllListeners, etc.)

**Better Alternative**: Accept optional event callbacks in configuration or return event streams

### State Management Analysis

**Current State**:
- `activeExecutions`: Map<string, RecipeExecution> - Execution tracking
- `executionCounter`: number - ID generation
- `recipeCache`: Map<string, {recipe, timestamp}> - Caching
- `config`: RecipeEngineConfig - Configuration
- `toolRegistry`: ToolRegistry - Dependency
- `stepExecutor`: StepExecutor - Dependency

**Key Insight**: Only `activeExecutions`, `executionCounter`, and `recipeCache` are truly stateful. The rest are dependencies or configuration.

### Private Methods Analysis

**Pure Functions** (can be extracted immediately):
- `normalizeSource()` - Pure transformation
- `getCacheKey()` - Pure computation
- `recipeSourceToString()` - Pure formatting
- `validateVariable()` - Pure validation
- `validateStep()` - Pure validation (with side effect to Set parameter)
- `validateStepDependencies()` - Pure validation
- `dependencyToSource()` - Pure transformation
- `getPromptType()` - Pure mapping

**Stateful Operations** (need state management):
- `loadRecipeContent()` - I/O operation
- `loadFileContent()` - I/O operation
- `loadUrlContent()` - I/O operation
- `loadPackageContent()` - I/O operation
- `parseRecipeContent()` - I/O + parsing
- `resolveVariables()` - I/O (prompting) + validation
- `promptForVariable()` - I/O
- `createExecutionContext()` - Context creation
- `createLoggerAdapter()` - Factory function
- `createConditionEvaluator()` - Factory function
- `aggregateResults()` - Data aggregation
- `loadDependencies()` - I/O operation
- `validateDependency()` - I/O + validation
- `generateExecutionId()` - State mutation
- `startCacheCleanup()` - Side effect

### Type Safety Issues

1. **Unsafe Type Assertions**:
   ```typescript
   recipe: {} as RecipeConfig  // Line 412 - should use proper optional type
   ```

2. **Any Types**:
   ```typescript
   const parsed = yaml.load(content) as any;  // Line 835 - should use proper type guard
   ```

3. **Missing Generic Constraints**:
   - `RecipeSource` union could benefit from branded types
   - Cache key generation lacks type-level guarantee of uniqueness

4. **Weak Function Signature**:
   ```typescript
   new Function(...keys, `return ${expression}`)  // Line 1066 - eval-like, unsafe
   ```

---

## Proposed Functional Architecture

### Directory Structure

```
recipe-engine/
├── index.ts                          # Public API exports
├── config.ts                         # Configuration types and defaults
├── types.ts                          # Shared types (already exists)
│
├── loading/
│   ├── index.ts                      # Public: loadRecipe, loadRecipeContent
│   ├── source-normalization.ts       # normalizeSource, getCacheKey
│   ├── content-loaders.ts            # loadFile, loadUrl, loadPackage
│   ├── recipe-parser.ts              # parseRecipeContent
│   └── dependency-loader.ts          # loadDependencies
│
├── validation/
│   ├── index.ts                      # Public: validateRecipe
│   ├── recipe-validator.ts           # Core recipe validation
│   ├── variable-validator.ts         # validateVariable, validateVariableValue
│   ├── step-validator.ts             # validateStep, validateStepDependencies
│   └── dependency-validator.ts       # validateDependency
│
├── variables/
│   ├── index.ts                      # Public: resolveVariables
│   ├── variable-resolver.ts          # Main resolution logic
│   ├── variable-prompter.ts          # promptForVariable, getPromptType
│   └── variable-utils.ts             # Helper functions
│
├── execution/
│   ├── index.ts                      # Public: executeRecipe
│   ├── executor.ts                   # Main execution orchestration
│   ├── context-builder.ts            # createExecutionContext
│   ├── result-aggregator.ts          # aggregateResults
│   ├── execution-tracker.ts          # Track active executions (stateful)
│   └── cancellation.ts               # Cancellation logic
│
├── caching/
│   ├── index.ts                      # Public: createCache
│   ├── recipe-cache.ts               # Cache implementation
│   └── cache-cleanup.ts              # TTL cleanup logic
│
├── utils/
│   ├── id-generator.ts               # generateExecutionId
│   ├── logger-adapter.ts             # createLoggerAdapter
│   ├── condition-evaluator.ts        # createConditionEvaluator (safer impl)
│   └── source-utils.ts               # Source type helpers
│
└── step-executor/                    # Already exists
    └── ...
```

### Key Functional Patterns

#### 1. Pure Core Functions

```typescript
// loading/source-normalization.ts
export function normalizeSource(source: RecipeSource | string): RecipeSource {
  if (typeof source === 'string') {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return { type: 'url', url: source };
    }
    if (
      source.includes('/') ||
      source.includes('\\') ||
      source.endsWith('.yml') ||
      source.endsWith('.yaml')
    ) {
      return { type: 'file', path: source };
    }
    return { type: 'package', name: source };
  }
  return source;
}

export function getCacheKey(source: RecipeSource): string {
  switch (source.type) {
    case 'file':
      return `file:${source.path}`;
    case 'url':
      return `url:${source.url}${source.version ? `@${source.version}` : ''}`;
    case 'package':
      return `package:${source.name}${source.version ? `@${source.version}` : ''}`;
    case 'content':
      return `content:${source.name}`;
  }
}
```

#### 2. State Management via Closures

```typescript
// caching/recipe-cache.ts
export interface RecipeCache {
  get(key: string): RecipeCacheEntry | undefined;
  set(key: string, recipe: RecipeConfig): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
  cleanup(): void;
  destroy(): void;
}

export interface RecipeCacheEntry {
  recipe: RecipeConfig;
  timestamp: number;
}

export interface RecipeCacheConfig {
  enabled: boolean;
  ttl: number;
  cleanupIntervalMs?: number;
}

export function createRecipeCache(config: RecipeCacheConfig): RecipeCache {
  const cache = new Map<string, RecipeCacheEntry>();
  let cleanupTimer: NodeJS.Timeout | undefined;

  // Start cleanup timer if enabled
  if (config.enabled && config.cleanupIntervalMs) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, entry] of cache) {
        if (now - entry.timestamp > config.ttl) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        cache.delete(key);
      }
    }, config.cleanupIntervalMs);

    // Prevent timer from keeping process alive
    cleanupTimer.unref();
  }

  return {
    get(key: string) {
      if (!config.enabled) return undefined;

      const entry = cache.get(key);
      if (!entry) return undefined;

      // Check TTL
      if (Date.now() - entry.timestamp > config.ttl) {
        cache.delete(key);
        return undefined;
      }

      return entry;
    },

    set(key: string, recipe: RecipeConfig) {
      if (!config.enabled) return;

      cache.set(key, {
        recipe,
        timestamp: Date.now(),
      });
    },

    delete(key: string) {
      cache.delete(key);
    },

    clear() {
      cache.clear();
    },

    size() {
      return cache.size;
    },

    cleanup() {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, entry] of cache) {
        if (now - entry.timestamp > config.ttl) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        cache.delete(key);
      }
    },

    destroy() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }
      cache.clear();
    },
  };
}
```

#### 3. Event Handling via Callbacks

```typescript
// execution/executor.ts
export interface ExecutionCallbacks {
  onRecipeStarted?: (event: { executionId: string; source: RecipeSource }) => void;
  onRecipeCompleted?: (event: { executionId: string; result: RecipeExecutionResult }) => void;
  onRecipeFailed?: (event: { executionId: string; error: Error; duration: number }) => void;
  onRecipeCancelled?: (event: { executionId: string }) => void;
  onProgress?: (progress: { step: string; phase: string; percentage: number }) => void;
  onStepComplete?: (result: StepResult) => void;
}

export interface RecipeExecutorConfig {
  workingDir: string;
  defaultTimeout: number;
  security: SecurityConfig;
  cache: RecipeCacheConfig;
  stepExecutor: StepExecutorConfig;
  toolRegistry: ToolRegistry;
  callbacks?: ExecutionCallbacks;
}

export async function executeRecipe(
  source: RecipeSource | string,
  options: RecipeExecutionOptions,
  config: RecipeExecutorConfig,
): Promise<RecipeExecutionResult> {
  const executionId = generateExecutionId();
  const startTime = Date.now();

  config.callbacks?.onRecipeStarted?.({ executionId, source: normalizeSource(source) });

  try {
    // Load recipe
    const loadResult = await loadRecipe(source, {
      workingDir: config.workingDir,
      security: config.security,
      cache: createRecipeCache(config.cache),
    });

    // Validate
    const validation = await validateRecipe(loadResult.recipe);
    if (!validation.isValid) {
      throw new RecipeValidationError(
        `Recipe validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
        validation.errors,
      );
    }

    // Resolve variables
    const resolvedVariables = await resolveVariables(
      loadResult.recipe,
      options.variables || {},
      options.skipPrompts || false,
      options.logger,
    );

    // Create execution context
    const context = await createExecutionContext(
      loadResult.recipe,
      resolvedVariables,
      options,
      executionId,
      config.workingDir,
    );

    // Execute through step executor
    const stepResults = await config.stepExecutor.executeSteps(
      loadResult.recipe.steps,
      context,
      {
        timeout: options.stepOptions?.timeout || config.defaultTimeout,
        continueOnError: options.continueOnError,
        dryRun: options.dryRun,
        ...options.stepOptions,
      },
    );

    // Aggregate results
    const result = aggregateResults(
      executionId,
      loadResult.recipe,
      stepResults,
      resolvedVariables,
      startTime,
      context,
    );

    config.callbacks?.onRecipeCompleted?.({ executionId, result });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    config.callbacks?.onRecipeFailed?.({
      executionId,
      error: error instanceof Error ? error : new Error(String(error)),
      duration
    });
    throw error;
  }
}
```

#### 4. Execution Tracking

```typescript
// execution/execution-tracker.ts
export interface ExecutionTracker {
  start(executionId: string, execution: RecipeExecution): void;
  get(executionId: string): RecipeExecution | undefined;
  getAll(): RecipeExecution[];
  update(executionId: string, updates: Partial<RecipeExecution>): void;
  cancel(executionId: string): void;
  complete(executionId: string): void;
  clear(): void;
}

export function createExecutionTracker(): ExecutionTracker {
  const executions = new Map<string, RecipeExecution>();

  return {
    start(executionId: string, execution: RecipeExecution) {
      executions.set(executionId, execution);
    },

    get(executionId: string) {
      return executions.get(executionId);
    },

    getAll() {
      return Array.from(executions.values());
    },

    update(executionId: string, updates: Partial<RecipeExecution>) {
      const execution = executions.get(executionId);
      if (execution) {
        executions.set(executionId, { ...execution, ...updates });
      }
    },

    cancel(executionId: string) {
      const execution = executions.get(executionId);
      if (execution) {
        executions.set(executionId, {
          ...execution,
          status: 'cancelled',
          endTime: new Date(),
        });
      }
    },

    complete(executionId: string) {
      executions.delete(executionId);
    },

    clear() {
      executions.clear();
    },
  };
}
```

#### 5. Main Public API

```typescript
// index.ts
import { createRecipeCache } from './caching/recipe-cache.js';
import { DEFAULT_CONFIG } from './config.js';
import { executeRecipe as executeRecipeCore } from './execution/executor.js';
import { createExecutionTracker } from './execution/execution-tracker.js';
import { loadRecipe as loadRecipeCore } from './loading/index.js';
import { getToolRegistry } from './tools/registry.js';
import { validateRecipe as validateRecipeCore } from './validation/index.js';
import { StepExecutor } from './step-executor/index.js';

export * from './types.js';
export * from './execution/executor.js';
export * from './loading/index.js';
export * from './validation/index.js';
export * from './variables/index.js';

/**
 * Create a recipe executor instance with managed state
 */
export interface RecipeEngineInstance {
  executeRecipe(
    source: RecipeSource | string,
    options?: RecipeExecutionOptions,
  ): Promise<RecipeExecutionResult>;

  loadRecipe(source: RecipeSource | string): Promise<RecipeLoadResult>;

  validateRecipe(recipe: RecipeConfig): Promise<RecipeValidationResult>;

  getExecutions(): RecipeExecution[];

  cancelExecution(executionId: string): Promise<void>;

  cancelAllExecutions(): Promise<void>;

  cleanup(): Promise<void>;
}

export interface RecipeEngineConfig {
  stepExecutor?: Partial<StepExecutorConfig>;
  toolRegistry?: ToolRegistryConfig;
  workingDir?: string;
  defaultTimeout?: number;
  enableDebugLogging?: boolean;
  cache?: RecipeCacheConfig;
  security?: SecurityConfig;
  callbacks?: ExecutionCallbacks;
}

/**
 * Create a recipe engine instance (replaces class instantiation)
 */
export function createRecipeEngine(
  config: RecipeEngineConfig = {},
): RecipeEngineInstance {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Create managed state
  const cache = createRecipeCache(mergedConfig.cache);
  const executionTracker = createExecutionTracker();
  const toolRegistry = getToolRegistry();
  const stepExecutor = new StepExecutor(toolRegistry, mergedConfig.stepExecutor);

  // Set up debug logging
  if (mergedConfig.enableDebugLogging) {
    const existing = process.env.DEBUG || '';
    const recipeDebug = 'hypergen:v8:recipe:*';
    process.env.DEBUG = existing ? `${existing},${recipeDebug}` : recipeDebug;
  }

  return {
    async executeRecipe(source, options = {}) {
      return executeRecipeCore(source, options, {
        workingDir: mergedConfig.workingDir,
        defaultTimeout: mergedConfig.defaultTimeout,
        security: mergedConfig.security,
        cache: mergedConfig.cache,
        stepExecutor,
        toolRegistry,
        callbacks: {
          ...mergedConfig.callbacks,
          ...options,
        },
      });
    },

    async loadRecipe(source) {
      return loadRecipeCore(source, {
        workingDir: mergedConfig.workingDir,
        security: mergedConfig.security,
        cache,
      });
    },

    async validateRecipe(recipe) {
      return validateRecipeCore(recipe);
    },

    getExecutions() {
      return executionTracker.getAll();
    },

    async cancelExecution(executionId) {
      const execution = executionTracker.get(executionId);
      if (!execution) {
        throw new Error(`Execution not found: ${executionId}`);
      }

      await stepExecutor.cancelExecution(executionId);
      executionTracker.cancel(executionId);
    },

    async cancelAllExecutions() {
      const executions = executionTracker.getAll();
      await Promise.allSettled(
        executions.map(e => stepExecutor.cancelExecution(e.id))
      );
      executionTracker.clear();
    },

    async cleanup() {
      await this.cancelAllExecutions();
      cache.destroy();
      await stepExecutor.cancelAllExecutions();
    },
  };
}

/**
 * Execute a recipe with default configuration (convenience function)
 */
export async function executeRecipe(
  source: RecipeSource | string,
  options?: RecipeExecutionOptions,
): Promise<RecipeExecutionResult> {
  const engine = createRecipeEngine();
  try {
    return await engine.executeRecipe(source, options);
  } finally {
    await engine.cleanup();
  }
}

/**
 * Load and validate a recipe without executing (convenience function)
 */
export async function loadRecipe(
  source: RecipeSource | string,
  config?: RecipeEngineConfig,
): Promise<RecipeLoadResult> {
  const cache = createRecipeCache(config?.cache || DEFAULT_CONFIG.cache);
  try {
    return await loadRecipeCore(source, {
      workingDir: config?.workingDir || DEFAULT_CONFIG.workingDir,
      security: config?.security || DEFAULT_CONFIG.security,
      cache,
    });
  } finally {
    cache.destroy();
  }
}

/**
 * Validate a recipe configuration (convenience function)
 */
export async function validateRecipe(
  recipe: RecipeConfig,
): Promise<RecipeValidationResult> {
  return validateRecipeCore(recipe);
}
```

---

## Benefits of Functional Refactoring

### 1. Improved Testability

**Before** (class-based):
```typescript
describe('RecipeEngine', () => {
  it('should load recipe', async () => {
    const engine = new RecipeEngine(config);
    const spy = jest.spyOn(engine, 'loadRecipe');
    // Need to mock EventEmitter, private methods, etc.
  });
});
```

**After** (functional):
```typescript
describe('loadRecipe', () => {
  it('should load recipe from file', async () => {
    const cache = createRecipeCache({ enabled: false, ttl: 0 });
    const result = await loadRecipe('recipe.yml', { cache, ... });
    expect(result.recipe.name).toBe('test');
    // Pure function, easy to test
  });
});
```

### 2. Better Composition

```typescript
// Can compose functions easily
const loadAndValidate = async (source: RecipeSource) => {
  const loaded = await loadRecipe(source, config);
  const validation = await validateRecipe(loaded.recipe);
  return { loaded, validation };
};

// Can partially apply configurations
const loadWithCache = (cache: RecipeCache) =>
  (source: RecipeSource) => loadRecipe(source, { cache, ...defaultConfig });
```

### 3. Clearer Separation of Concerns

- Each module has a single, well-defined responsibility
- Dependencies are explicit (function parameters)
- No hidden state or side effects
- Easier to understand and maintain

### 4. Type Safety Improvements

```typescript
// Branded types for execution IDs
type ExecutionId = string & { readonly brand: unique symbol };

function generateExecutionId(): ExecutionId {
  return `recipe_${Date.now()}_${counter++}` as ExecutionId;
}

// Type-safe source normalization
type NormalizedSource<T extends RecipeSource['type']> =
  Extract<RecipeSource, { type: T }>;

function normalizeSource(source: RecipeSource | string): RecipeSource {
  // Returns properly typed RecipeSource
}
```

### 5. Easier to Extend

```typescript
// Add new source type without modifying existing code
import { loadRecipe } from './loading';

// Custom loader
async function loadFromGitHub(repo: string): Promise<RecipeConfig> {
  const source: RecipeSource = { type: 'url', url: `https://github.com/${repo}` };
  const result = await loadRecipe(source, config);
  return result.recipe;
}
```

### 6. Reduced Bundle Size

- Tree-shaking works better with pure functions
- No EventEmitter inheritance overhead
- Only import what you need

---

## Migration Strategy

### Phase 1: Extract Pure Functions (Week 1)

1. Create new directory structure
2. Extract all pure functions to utils/
3. Add comprehensive tests for each function
4. Keep existing class as-is (calls new functions internally)

**Example**:
```typescript
// Before
class RecipeEngine {
  private normalizeSource(source: RecipeSource | string): RecipeSource {
    // implementation
  }
}

// After
// utils/source-utils.ts
export function normalizeSource(source: RecipeSource | string): RecipeSource {
  // implementation
}

// recipe-engine.ts (temporary)
class RecipeEngine {
  private normalizeSource(source: RecipeSource | string): RecipeSource {
    return normalizeSource(source); // Delegate to pure function
  }
}
```

### Phase 2: Extract I/O Operations (Week 2)

1. Create loading/ module with all I/O functions
2. Refactor to accept dependencies as parameters
3. Update class to use new functions
4. Add tests

**Example**:
```typescript
// loading/content-loaders.ts
export async function loadFileContent(
  filePath: string,
  workingDir: string,
): Promise<string> {
  const fullPath = path.resolve(workingDir, filePath);
  if (!fs.existsSync(fullPath)) {
    throw new RecipeLoadError(`Recipe file not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}
```

### Phase 3: Extract Validation Logic (Week 2)

1. Create validation/ module
2. Extract all validation functions
3. Update class to use new functions
4. Add comprehensive validation tests

### Phase 4: Extract State Management (Week 3)

1. Create caching/ and execution/ modules
2. Implement closure-based state management
3. Update class to use new state managers
4. Add state management tests

### Phase 5: Create Functional API (Week 3-4)

1. Implement new functional API in index.ts
2. Create compatibility layer for existing class
3. Update documentation
4. Mark class as deprecated

### Phase 6: Migration and Cleanup (Week 4)

1. Update all consumers to use functional API
2. Remove old class implementation
3. Update tests
4. Update documentation

---

## Risk Mitigation

### Backward Compatibility

Create a compatibility wrapper:

```typescript
// recipe-engine-legacy.ts
import { createRecipeEngine, type RecipeEngineConfig } from './index.js';
import { EventEmitter } from 'node:events';

/**
 * @deprecated Use createRecipeEngine() instead
 */
export class RecipeEngine extends EventEmitter {
  private engine: ReturnType<typeof createRecipeEngine>;

  constructor(config: RecipeEngineConfig = {}) {
    super();

    this.engine = createRecipeEngine({
      ...config,
      callbacks: {
        onRecipeStarted: (e) => this.emit('recipe:started', e),
        onRecipeCompleted: (e) => this.emit('recipe:completed', e),
        onRecipeFailed: (e) => this.emit('recipe:failed', e),
        onRecipeCancelled: (e) => this.emit('recipe:cancelled', e),
      },
    });
  }

  async executeRecipe(...args: Parameters<typeof this.engine.executeRecipe>) {
    return this.engine.executeRecipe(...args);
  }

  // ... other methods
}
```

### Testing Strategy

1. **Parallel Testing**: Keep existing class tests, add new functional tests
2. **Property-Based Testing**: Use fast-check for pure functions
3. **Integration Tests**: Test both APIs produce same results
4. **Performance Tests**: Ensure no regression

### Rollout Plan

1. **Week 1-2**: Internal refactoring (no API changes)
2. **Week 3**: New API available, old API still default
3. **Week 4**: Documentation update, migration guide
4. **Week 5-6**: Gradual migration of internal code
5. **Week 7-8**: New API becomes default, old API deprecated
6. **Week 9-10**: Remove old API in next major version

---

## Code Examples

### Example 1: Loading Recipe (Functional)

```typescript
// loading/index.ts
import { createRecipeCache, type RecipeCache } from '../caching/recipe-cache.js';
import { loadRecipeContent } from './content-loaders.js';
import { parseRecipeContent } from './recipe-parser.js';
import { normalizeSource, getCacheKey } from './source-normalization.js';
import { loadDependencies } from './dependency-loader.js';
import { validateRecipe } from '../validation/index.js';

export interface RecipeLoadConfig {
  workingDir: string;
  security: SecurityConfig;
  cache: RecipeCache;
}

export interface RecipeLoadResult {
  recipe: RecipeConfig;
  source: RecipeSource;
  validation: RecipeValidationResult;
  dependencies: RecipeConfig[];
}

export async function loadRecipe(
  source: RecipeSource | string,
  config: RecipeLoadConfig,
): Promise<RecipeLoadResult> {
  const normalizedSource = normalizeSource(source);
  const cacheKey = getCacheKey(normalizedSource);

  // Check cache
  const cached = config.cache.get(cacheKey);
  if (cached) {
    const validation = await validateRecipe(cached.recipe);
    return {
      recipe: cached.recipe,
      source: normalizedSource,
      validation,
      dependencies: [],
    };
  }

  // Load fresh
  const content = await loadRecipeContent(normalizedSource, config);
  const recipe = await parseRecipeContent(content, normalizedSource);
  const validation = await validateRecipe(recipe);
  const dependencies = await loadDependencies(recipe, config);

  // Cache if valid
  if (validation.isValid) {
    config.cache.set(cacheKey, recipe);
  }

  return {
    recipe,
    source: normalizedSource,
    validation,
    dependencies,
  };
}
```

### Example 2: Variable Resolution (Functional)

```typescript
// variables/variable-resolver.ts
import { TemplateParser } from '../../config/template-parser.js';
import { promptForVariable } from './variable-prompter.js';

export interface VariableResolutionConfig {
  skipPrompts: boolean;
  logger?: ActionLogger;
}

export async function resolveVariables(
  recipe: RecipeConfig,
  providedVariables: Record<string, any>,
  config: VariableResolutionConfig,
): Promise<Record<string, any>> {
  const resolved: Record<string, any> = {};
  const missingRequired: string[] = [];

  // Process all defined variables
  for (const [varName, varConfig] of Object.entries(recipe.variables)) {
    let value = providedVariables[varName];

    // Use default if no value provided
    if (value === undefined) {
      value = varConfig.default;
    }

    // Check if required variable is missing
    if (
      varConfig.required &&
      (value === undefined || value === null || value === '')
    ) {
      if (config.skipPrompts) {
        missingRequired.push(varName);
        continue;
      }
      value = await promptForVariable(varName, varConfig, config.logger);
    }

    // Validate the value
    if (value !== undefined) {
      const validation = TemplateParser.validateVariableValue(
        varName,
        value,
        varConfig,
      );
      if (!validation.isValid) {
        throw new RecipeValidationError(
          validation.error || `Invalid value for variable: ${varName}`,
          'INVALID_VARIABLE_VALUE',
          { variable: varName, value },
        );
      }
    }

    resolved[varName] = TemplateParser.getResolvedValue(value, varConfig);
  }

  if (missingRequired.length > 0) {
    throw new RecipeValidationError(
      `Missing required variables: ${missingRequired.join(', ')}`,
      'MISSING_REQUIRED_VARIABLES',
      { missingVariables: missingRequired },
    );
  }

  // Add any additional provided variables not defined in recipe
  for (const [varName, value] of Object.entries(providedVariables)) {
    if (!recipe.variables[varName]) {
      resolved[varName] = value;
    }
  }

  return resolved;
}
```

### Example 3: Recipe Validation (Functional)

```typescript
// validation/recipe-validator.ts
import { validateVariable } from './variable-validator.js';
import { validateStep, validateStepDependencies } from './step-validator.js';
import { validateDependency } from './dependency-validator.js';

export async function validateRecipe(
  recipe: RecipeConfig,
): Promise<RecipeValidationResult> {
  const errors: RecipeValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Basic structure validation
  errors.push(...validateRecipeStructure(recipe));

  // Variable validation
  if (recipe.variables) {
    for (const [varName, varConfig] of Object.entries(recipe.variables)) {
      const result = validateVariable(varName, varConfig);
      if (result.error) {
        errors.push(
          new RecipeValidationError(
            result.error,
            'INVALID_VARIABLE',
            { field: `variables.${varName}` },
          ),
        );
      }
    }
  }

  // Step validation
  if (recipe.steps) {
    const stepNames = new Set<string>();
    for (const [index, step] of recipe.steps.entries()) {
      errors.push(...validateStep(step, index, stepNames));
    }
    errors.push(...validateStepDependencies(recipe.steps));
  }

  // Dependency validation
  if (recipe.dependencies) {
    for (const dep of recipe.dependencies) {
      const result = await validateDependency(dep);
      if (!result.isValid) {
        errors.push(
          new RecipeValidationError(
            `Dependency validation failed: ${dep.name}`,
            'INVALID_DEPENDENCY',
            { dependency: dep.name },
          ),
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recipe,
    context: {
      timestamp: new Date(),
      validatorVersion: '8.0.0',
      scope: 'full',
    },
  };
}

function validateRecipeStructure(recipe: RecipeConfig): RecipeValidationError[] {
  const errors: RecipeValidationError[] = [];

  if (!recipe.name || typeof recipe.name !== 'string') {
    errors.push(
      new RecipeValidationError(
        'Recipe name is required and must be a string',
        'MISSING_NAME',
      ),
    );
  }

  if (!recipe.variables || typeof recipe.variables !== 'object') {
    errors.push(
      new RecipeValidationError(
        'Recipe variables section is required',
        'MISSING_VARIABLES',
      ),
    );
  }

  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push(
      new RecipeValidationError(
        'Recipe must have at least one step',
        'MISSING_STEPS',
      ),
    );
  }

  return errors;
}
```

---

## Conclusion

The `RecipeEngine` class should be refactored to a functional architecture because:

1. **No Real OOP Benefits**: The class doesn't leverage inheritance, polymorphism, or encapsulation in meaningful ways
2. **EventEmitter is a Code Smell**: Event-based communication should be explicit, not inherited
3. **State Can Be Managed Better**: Closures and explicit state objects are clearer than private fields
4. **Testing Improves**: Pure functions are trivial to test
5. **Composition Improves**: Functions compose better than classes
6. **Type Safety Improves**: Functional patterns enable better TypeScript usage
7. **Bundle Size Reduces**: Tree-shaking works better
8. **Maintenance Improves**: Clear separation of concerns, explicit dependencies

The proposed functional architecture:
- Maintains all current functionality
- Improves testability and maintainability
- Enables better composition and reuse
- Provides backward compatibility during migration
- Follows modern TypeScript best practices
- Aligns with the project's architectural preferences

**Recommendation**: Proceed with the phased migration strategy outlined above.
