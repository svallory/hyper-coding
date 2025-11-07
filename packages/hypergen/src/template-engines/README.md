# Template Engines Module

## Overview

The `template-engines` module provides a pluggable, abstraction layer for template rendering in Hypergen. It decouples the core generation engine from specific template engine implementations, enabling support for multiple templating systems (LiquidJS, EJS, and custom engines) without tight coupling.

This module is a core architectural component that allows Hypergen to be flexible about which templating language users employ, while maintaining consistent behavior and a unified API.

## Purpose

The template engines module serves three primary purposes:

1. **Engine Abstraction**: Defines a clean interface (`TemplateEngine`) that all template engines must implement
2. **Centralized Management**: Provides a factory pattern for registering, discovering, and accessing template engines
3. **Plugin Support**: Enables extensibility through a plugin system for custom template engines

## Key Files and Their Purposes

### `types.ts`
Defines the core TypeScript interfaces for the template engines system:

- **`TemplateEngine`**: The main interface that all template engines implement. Defines:
  - `name`: Unique identifier for the engine (e.g., 'liquidjs', 'ejs')
  - `supportedExtensions`: Array of file extensions the engine handles (e.g., ['.liquid', '.liquid.t'])
  - `render()`: Renders a template string with a context object
  - `renderFile()`: Renders a template file with a context object
  - `supports()`: Checks if the engine handles a given file extension
  - `configure()`: Allows runtime configuration of engine-specific options

- **`TemplateEngineFactory`**: Interface for managing template engine registration and retrieval:
  - `register()`: Register a new template engine
  - `get()`: Retrieve engine by name
  - `getForExtension()`: Retrieve engine by file extension (with auto-detection)
  - `getDefault()`: Get the default template engine
  - `setDefault()`: Override the default engine
  - `list()`: Get all registered engine names

- **`TemplateEngineConfig`**: Configuration structure for template engines

### `factory.ts`
Implements the default factory pattern for engine management:

- **`DefaultTemplateEngineFactory`**: Concrete implementation of `TemplateEngineFactory`
  - Maintains a `Map` of registered engines keyed by name
  - Tracks the default engine (LiquidJS by default)
  - Auto-detects engines by file extension
  - Provides singleton access via the exported `templateEngineFactory` instance
  - Throws descriptive errors for missing engines or misconfiguration

### `liquid-engine.ts`
Implements LiquidJS template engine support:

- **`LiquidTemplateEngine`**: Production-ready implementation using the LiquidJS library
  - **Default engine** for Hypergen
  - Supports `.liquid`, `.liquid.t`, `.liq`, `.liq.t` extensions
  - **Key features**:
    - Safe template rendering (no arbitrary code execution)
    - File system integration for includes and layouts
    - Comprehensive filter support matching Hypergen's helpers:
      - Case transformations: `camelCase`, `pascalCase`, `snakeCase`, `kebabCase`, `constantCase`, `dotCase`, `pathCase`, `paramCase`
      - Inflections: `pluralize`, `singularize`
      - Utilities: `capitalize`, `titleize`, `humanize`
    - Async rendering support
    - Caching for performance
    - Configurable with custom filters and tags via:
      - `registerFilter()`: Register custom filters
      - `registerTag()`: Register custom tags
      - `getLiquidInstance()`: Access underlying Liquid instance for advanced usage

### `ejs-engine.ts`
Implements EJS template engine support for backward compatibility:

- **`EJSTemplateEngine`**: Implementation using the EJS library
  - Supports `.ejs`, `.ejs.t`, `.t` extensions
  - **Key features**:
    - Full JavaScript expression support
    - View path configuration for includes
    - Async rendering
    - Configurable options matching EJS API:
      - `setRoot()`: Set root directory for includes
      - `addViewPath()`: Add a view directory
      - `setViewPaths()`: Configure multiple view directories
      - `setOptions()` / `configure()`: Set EJS-specific options
    - Production-mode debug settings

### `index.ts`
Main module export and initialization:

- **`initializeTemplateEngines()`**: Registers the default engines (LiquidJS and EJS)
- **`initializeTemplateEnginesWithPlugins()`**: Initializes engines and loads plugin system
- **Convenience exports**:
  - `getTemplateEngineFactory()`: Get the factory instance
  - `getTemplateEngine(name)`: Get engine by name
  - `getTemplateEngineForFile(extension)`: Get engine for file extension
  - `getDefaultTemplateEngine()`: Get the default engine

## Architecture and Design Patterns

### Factory Pattern
The module uses the factory pattern to manage template engine instantiation and lifecycle:

```
TemplateEngineFactory (interface)
    ↓
DefaultTemplateEngineFactory (implementation)
    ↓
Map<string, TemplateEngine>
    ├─ LiquidTemplateEngine
    ├─ EJSTemplateEngine
    └─ [Plugin engines...]
```

### Strategy Pattern
Each template engine implements the `TemplateEngine` interface, allowing runtime selection of the appropriate strategy based on file extension or configuration.

### Singleton Pattern
The factory is exported as a singleton (`templateEngineFactory`), ensuring a single source of truth for engine management across the application.

## How the Code Works (High-Level Flow)

### 1. Initialization
```typescript
// At application startup
initializeTemplateEngines()
  → DefaultTemplateEngineFactory registers LiquidTemplateEngine
  → DefaultTemplateEngineFactory registers EJSTemplateEngine
  → LiquidJS set as default
```

### 2. Template Rendering
```typescript
// When a template needs rendering
const engine = getTemplateEngineForFile('.liquid')  // or .ejs
  ↓
engine.render(templateString, contextObject)
  ↓
LiquidTemplateEngine.render()
  → liquid.parseAndRender(template, context)
  → Returns rendered string
```

### 3. Engine Selection
Three selection strategies (in priority order):

1. **Explicit file extension**: Check file extension and find matching engine
2. **Auto-detection**: Parse template content for syntax hints ({{ }} for Liquid, <% %> for EJS)
3. **Default**: Use LiquidJS as fallback

### 4. Context Processing
Templates receive context objects with:
- User variables (provided during generation)
- Built-in helpers (inflection, case transformation, utilities)
- Engine-specific filters and functions
- Step/recipe context (when used in recipe engine)

## Dependencies and Module Relationships

### External Dependencies
- **liquidjs** (v10.21.1): Default template engine
  - Safe, sandbox-friendly rendering
  - No arbitrary code execution
  - Async-first design
  - Filter and tag customization

- **ejs** (v3.1.9): EJS template engine
  - Full JavaScript expression support
  - Legacy compatibility
  - Async rendering support

- **fs-extra**: File system operations for template includes
- **type-fest**: Type utilities for JSON values
- **debug**: Debug logging

### Internal Dependencies
- **context.ts**: Provides template context helpers (case transformations, inflections)
- **render.ts**: Consumes template engines for rendering templates with frontmatter
- **recipe-engine/tools/template-tool.ts**: Uses template engines in recipe step execution
- **plugin-system/index.ts**: Integrates with plugin discovery for custom engines

### Module Integration Points

```
render.ts (Main rendering)
  ↓
initializeTemplateEngines()
getDefaultTemplateEngine()
getTemplateEngineForFile(extension)
engine.render(template, context)

recipe-engine/template-tool.ts (Recipe steps)
  ↓
getTemplateEngineFactory()
getTemplateEngineForFile(extension)
engine.render(template, context)

plugin-system/discovery.ts (Plugin loading)
  ↓
templateEngineFactory (singleton access)
factory.register(customEngine)
```

## How to Contribute/Work with This Code

### Adding a New Template Engine

1. **Create a new engine class** that implements `TemplateEngine`:

```typescript
import type { TemplateEngine } from './types.js'

export class MyTemplateEngine implements TemplateEngine {
  readonly name = 'myengine'
  readonly supportedExtensions = ['.my', '.my.t']
  
  private options: any = {}

  async render(template: string, context: Record<string, any>): Promise<string> {
    // Implementation
    return rendered
  }

  async renderFile(filePath: string, context: Record<string, any>): Promise<string> {
    // Implementation
    return rendered
  }

  supports(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  configure(options: Record<string, any>): void {
    this.options = { ...this.options, ...options }
  }
}
```

2. **Register the engine** in `index.ts`:

```typescript
export function initializeTemplateEngines(): void {
  templateEngineFactory.register(new LiquidTemplateEngine())
  templateEngineFactory.register(new EJSTemplateEngine())
  templateEngineFactory.register(new MyTemplateEngine())  // Add here
}
```

3. **Test the engine**:

```typescript
// tests/template-engines.spec.ts
describe('MyTemplateEngine', () => {
  let engine: MyTemplateEngine
  
  beforeEach(() => {
    engine = new MyTemplateEngine()
  })

  it('should render templates', async () => {
    const result = await engine.render('template', { var: 'value' })
    expect(result).toBe('expected')
  })
  
  it('should support required extensions', () => {
    expect(engine.supports('.my')).toBe(true)
  })
})
```

### Configuring Engines

Configure engines at runtime:

```typescript
const engine = getTemplateEngine('liquidjs') as LiquidTemplateEngine

// Register custom filter
liquidEngine.registerFilter('uppercase', (str: string) => str.toUpperCase())

// Or for EJS
const ejsEngine = getTemplateEngine('ejs') as EJSTemplateEngine
ejsEngine.setRoot('/path/to/templates')
ejsEngine.addViewPath('/another/path')
```

### Extending with Filters/Tags (LiquidJS)

```typescript
const liquidEngine = getTemplateEngine('liquidjs') as LiquidTemplateEngine

// Register custom filter
liquidEngine.registerFilter('reverse', (str: string) => str.split('').reverse().join(''))

// Register custom tag (requires LiquidJS Tag)
import { Tag } from 'liquidjs'
class MyTag extends Tag { /* ... */ }
liquidEngine.registerTag('mytag', new MyTag())
```

### Error Handling

Engines throw descriptive errors:

```typescript
try {
  const result = await engine.render(template, context)
} catch (error) {
  // Error messages include:
  // - "LiquidJS template rendering failed: ..."
  // - "EJS template rendering failed: ..."
  // Allows catching and handling engine-specific errors
}
```

## Important Implementation Details

### Performance Considerations

1. **Lazy Initialization**: Template engines are only initialized when needed
2. **Caching**: LiquidJS has caching enabled by default for compiled templates
3. **Extension Matching**: File extension lookup is O(n) where n = number of engines (typically 2-3)
4. **Context Building**: Context object creation is synchronized but template rendering is async

### Security Model

- **LiquidJS** (Default): Sandbox-safe, no code execution
  - Strictness: `strictFilters: false` (non-existent filters don't throw)
  - Variables: `strictVariables: false` (undefined variables output empty)
  - No function definitions in templates

- **EJS**: Full JavaScript execution
  - Suitable only for trusted template sources
  - Used for backward compatibility with Hygen templates
  - Has `compileDebug` disabled in production

### Template Context

All templates receive a unified context object with:

```typescript
{
  // User variables (from generator options)
  [variableName]: value,
  
  // Built-in helpers (via context.ts)
  changeCase: { camelCase, pascalCase, ... },
  inflection: { pluralize, singularize, ... },
  
  // Engine-specific features
  // LiquidJS: filters via | operator
  // EJS: full JavaScript access
}
```

### Supported File Extensions

| Engine | Extensions | Use Case |
|--------|-----------|----------|
| LiquidJS | `.liquid`, `.liquid.t`, `.liq`, `.liq.t` | Safe, recommended |
| EJS | `.ejs`, `.ejs.t`, `.t` | Legacy Hygen compatibility |
| Custom | Defined by engine | Plugin extensions |

### Plugin System Integration

Custom template engines can be registered via the plugin system:

```typescript
// In a plugin package
export function createTemplateEngine(): TemplateEngine {
  return new MyCustomEngine()
}

// Plugin discovery automatically registers via:
templateEngineFactory.register(customEngine)
```

## Testing

The module includes comprehensive tests in `tests/template-engines.spec.ts`:

- Factory registration and retrieval
- Default engine selection
- Extension-based engine detection
- Engine-specific rendering
- Filter and tag support
- Error handling
- Integration scenarios

Run tests with:

```bash
bun test tests/template-engines.spec.ts
```

## Related Documentation

- **Hygen/Hypergen**: Original template generator (Hypergen is a fork)
- **LiquidJS**: https://liquidjs.com/ - Official documentation
- **EJS**: https://ejs.co/ - Template syntax and features
- **Hypergen Render Module**: `render.ts` - Main integration point
- **Recipe Engine**: `recipe-engine/` - V8-based recipe execution with template support