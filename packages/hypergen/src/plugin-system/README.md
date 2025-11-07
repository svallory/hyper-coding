# Plugin System

The plugin system is a core infrastructure component of Hypergen that enables extensibility through a discoverable, loadable, and registerable plugin architecture. It allows third-party developers and teams to extend Hypergen's functionality with custom template engines, validators, formatters, and other capabilities without modifying the core codebase.

## Overview

The plugin system provides:

- **Automatic Discovery**: Find plugins in `node_modules` and local directories using conventional naming (`hypergen-plugin-*`)
- **Lazy Loading**: Load plugins on-demand without impacting startup performance
- **Plugin Registration**: Register plugins with the appropriate factory systems (currently template engines)
- **Configuration Support**: Enable/disable plugins and pass options via Hypergen configuration
- **Type Safety**: Full TypeScript interfaces for plugin development and integration
- **Caching**: Plugin metadata and modules are cached to avoid redundant file I/O and imports

## Architecture

### Core Components

#### 1. **types.ts** - Plugin Type Definitions

Defines the contracts and interfaces for the plugin system:

- **`PluginInfo`**: Metadata about a discovered plugin (name, type, version, description)
- **`PluginModule`**: The loaded plugin with factory functions and metadata
- **`PluginManager`**: Interface for plugin discovery, loading, and registration
- **`PluginDiscoveryOptions`**: Configuration options for discovery behavior
- **`PluginConfig`**: User-facing configuration structure for enabling/disabling plugins and passing options

#### 2. **discovery.ts** - Plugin Discovery and Loading

Implements `DefaultPluginManager`, the core plugin management engine:

- **Discovery Pipeline**:
  - Searches `node_modules` using glob patterns for matching packages
  - Searches local directories (current and parent directories up to filesystem root)
  - Reads `package.json` files to extract plugin metadata from `hypergen` configuration field
  - Validates plugin structure and caches results

- **Loading**:
  - Uses `require.resolve()` to locate plugin modules
  - Dynamically imports plugin modules using `import()`
  - Validates plugin module structure (checks for required exports)
  - Caches loaded modules to avoid redundant imports

- **Plugin Validation**:
  - Checks for default export with `type` and `name` fields
  - Falls back to named exports like `createTemplateEngine`
  - Extracts plugin metadata from `package.json` hypergen configuration

- **Caching Strategy**:
  - `pluginCache`: Maps plugin names to loaded `PluginModule` instances
  - `infoCache`: Maps plugin names to `PluginInfo` metadata

#### 3. **index.ts** - Public API and Initialization

Provides the high-level public API for working with plugins:

- **`initializePluginSystem(config)`**: Main entry point for plugin system initialization
  - Discovers plugins matching criteria (e.g., `template-engine` type)
  - Respects `enabled: false` configuration to skip disabled plugins
  - Registers each loaded plugin with appropriate factory
  - Handles errors gracefully, logging failures without crashing

- **`getPluginManager()`**: Returns the global `DefaultPluginManager` instance
- **`discoverPlugins(options)`**: Delegates to plugin manager discovery
- **`loadPlugin(pluginName)`**: Loads a single plugin by name
- **`getPluginInfo(pluginName)`**: Retrieves cached plugin metadata
- **`registerPlugin(plugin, options)`**: Manually registers a plugin with the system

## How the Code Works

### Plugin Discovery Flow

```
initializePluginSystem(config)
  ↓
pluginManager.loadAll(options)
  ↓
pluginManager.discover(options)
  ├─ searchNodeModules()
  │  └─ glob("node_modules/hypergen-plugin-*")
  │     └─ Read package.json → Extract hypergen config
  └─ searchLocalDirectories()
     └─ glob(".../hypergen-plugin-*/package.json")
        └─ Extract hypergen config
  ↓
For each discovered plugin:
  pluginManager.load(pluginName)
    ├─ require.resolve() → Get module path
    ├─ import() → Load module
    └─ validatePlugin() → Ensure correct structure
        └─ Cache in pluginCache & infoCache
```

### Plugin Registration Flow

```
For each loaded plugin:
  1. Check if enabled in PluginConfig
  2. Extract plugin-specific options from config
  3. Call pluginManager.register(plugin, options)
     ├─ Check plugin.type (e.g., "template-engine")
     ├─ Call plugin.createTemplateEngine(options)
     └─ Register engine with templateEngineFactory
```

### Plugin Structure

Plugins follow a specific structure in their `package.json`:

```json
{
  "name": "hypergen-plugin-my-engine",
  "version": "1.0.0",
  "description": "Custom template engine for Hypergen",
  "hypergen": {
    "type": "template-engine",
    "name": "my-engine",
    "config": {}
  },
  "main": "dist/index.js"
}
```

The plugin module (default export or named exports) should export:

```typescript
export default {
  type: "template-engine",
  name: "my-engine",
  createTemplateEngine: (options?: Record<string, any>) => {
    // Return a TemplateEngine instance
  }
}
```

## Integration with Template Engines

The plugin system is designed to extend the **template engine factory** system:

1. **Discovery & Loading**: Plugin system finds and loads `hypergen-plugin-*` packages
2. **Registration**: Plugins expose a `createTemplateEngine()` factory function
3. **Factory Integration**: Created engines are registered with `templateEngineFactory`
4. **Usage**: The template rendering pipeline gets engines from the factory

Flow in `template-engines/index.ts`:
```typescript
export async function initializeTemplateEnginesWithPlugins(config?: any): Promise<void> {
  initializeTemplateEngines()  // Register built-in EJS and LiquidJS
  const { initializePluginSystem } = await import('../plugin-system/index.js')
  await initializePluginSystem(config)  // Load and register plugins
}
```

## Configuration

Plugins are configured in `hypergen.json` or via the `PluginConfig` interface:

```json
{
  "plugins": ["my-plugin"],
  "plugins": {
    "template-engine": {
      "my-engine": {
        "enabled": true,
        "options": {
          "strictMode": true,
          "delimiters": ["<%", "%>"]
        }
      }
    }
  }
}
```

## Dependencies and Relationships

### Internal Dependencies
- **`template-engines/factory.ts`**: The `DefaultTemplateEngineFactory` that plugins register with
- **`config/`**: Configuration system for reading plugin settings
- **`debug`**: Debug logging for troubleshooting plugin issues

### External Dependencies
- **`glob`**: File pattern matching for discovering plugins in node_modules and local directories
- **`fs-extra`**: File system operations for reading package.json and checking paths
- **`debug`**: Debug logging with `hypergen:plugin-*` namespace

### Related Modules
- **`template-engines/`**: Provides the factory system that plugins extend
- **`config/hypergen-config.ts`**: Defines the `plugins` configuration field
- **`bin.ts`**: May initialize the plugin system during CLI startup

## Important Implementation Details

### Performance Considerations

1. **Lazy Loading**: Plugins are loaded on-demand, not all at startup
2. **Caching Strategy**: Both plugin modules and metadata are cached to avoid:
   - Redundant file I/O operations
   - Repeated imports and module evaluation
   - Multiple `require.resolve()` calls
3. **Selective Discovery**: Only plugins matching specific types (e.g., `template-engine`) are discovered by default

### Error Handling

The system is defensive and non-blocking:

1. **Discovery Failures**: If a plugin directory is malformed, discovery continues
2. **Loading Failures**: Failed plugin loads are logged but don't crash the system
3. **Registration Failures**: Plugin registration errors are caught and logged
4. **Validation Failures**: Invalid plugins are skipped gracefully

### Plugin Validation

Plugins are validated at load time:

1. **Module Structure**: Must export either default or named exports with type/name
2. **Factory Functions**: For template engines, must export `createTemplateEngine()`
3. **Package Metadata**: `package.json` must contain `hypergen` configuration with `type` and `name`

### Caching Details

- **`pluginCache`**: `Map<string, PluginModule>` - Stores loaded module instances
- **`infoCache`**: `Map<string, PluginInfo>` - Stores extracted metadata
- Cache keys use plugin name from `package.json`
- Caches prevent redundant file reads, imports, and metadata extraction

## How to Contribute/Work with This Code

### Adding a New Plugin Type

1. Add new factory interface/class (e.g., `ValidatorFactory`)
2. Export it from the relevant module (e.g., `src/validators/factory.ts`)
3. Extend `DefaultPluginManager.register()` to handle new type:
   ```typescript
   if (plugin.type === 'validator' && plugin.createValidator) {
     const { validatorFactory } = require('../validators/factory.js')
     const validator = plugin.createValidator(options)
     validatorFactory.register(validator)
   }
   ```
4. Add new type to `PluginDiscoveryOptions.types` documentation

### Creating a Plugin

1. Create a new package: `hypergen-plugin-my-feature`
2. Add plugin metadata to `package.json`:
   ```json
   {
     "hypergen": {
       "type": "template-engine",
       "name": "my-engine"
     }
   }
   ```
3. Export plugin module with factory function:
   ```typescript
   export default {
     type: "template-engine",
     name: "my-engine",
     createTemplateEngine: (options) => new MyTemplateEngine(options)
   }
   ```
4. Implement required interfaces from `src/template-engines/types.ts`
5. Document plugin usage and configuration

### Testing Plugin System

Currently, no dedicated tests exist for the plugin system. When adding tests:

1. Mock `require.resolve()` and `import()` for unit testing
2. Create sample plugin packages in test fixtures
3. Test discovery in `node_modules` and local directories
4. Verify caching behavior prevents redundant operations
5. Test configuration parsing and selective plugin loading
6. Verify error handling for malformed plugins

### Debugging Plugin Issues

Enable debug logging:
```bash
DEBUG=hypergen:plugin* node your-script.js
```

This will show:
- Plugin discovery results
- Loading attempts and outcomes
- Registration successes/failures
- Cache hits and misses

### Common Patterns

**Conditional Plugin Loading**:
```typescript
const plugins = config.plugins?.[type]?.[name]
if (pluginConfig?.enabled === false) continue
```

**Error-Safe Loading**:
```typescript
try {
  const plugin = await pluginManager.load(name)
  if (!plugin) return null
} catch (error) {
  debug('Failed: %s', error.message)
}
```

**Directory Traversal**:
The local directory search walks up the filesystem tree until reaching root, allowing plugins in parent project directories or monorepo roots.

## Key Files and Their Purposes

| File | Purpose |
|------|---------|
| `types.ts` | Plugin type definitions and interfaces |
| `discovery.ts` | Plugin discovery, loading, and management implementation |
| `index.ts` | Public API and initialization logic |

## Summary

The plugin system provides a robust, extensible foundation for Hypergen customization. It balances discoverability with performance, offers strong typing for developer experience, and integrates seamlessly with the template engine factory pattern. The system is designed to be non-intrusive—plugins don't impact core performance when unused, and plugin failures don't break the application.
## TODO

-   [ ] **Discovery (`discovery.ts`)**:
    *   Add support for `hypergen` field in `package.json` for plugin discovery.
    *   Improve error handling for `package.json` parsing.
-   [ ] **Index (`index.ts`)**:
    *   Add support for other plugin types beyond `template-engine`.