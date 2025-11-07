# Configuration System Module

This module provides the comprehensive configuration management system for Hypergen. It handles loading, parsing, validating, and composing template configurations from multiple sources with support for inheritance, composition, dependency management, and URL resolution.

## Overview

The config module is responsible for:

- **Configuration Loading**: Loading and merging project, package, and template configurations from multiple file formats (JS, JSON, YAML)
- **Template Parsing**: Parsing and validating template.yml files with rich variable definitions and recipe step systems
- **Template Composition**: Handling template inheritance, includes, and composition with conflict resolution
- **Dependency Management**: Resolving template dependencies from various sources (NPM, GitHub, local, HTTP)
- **URL Resolution**: Resolving template references from different URL types with caching and security controls
- **Variable Management**: Supporting multiple variable types with validation, defaults, and computed values

## Key Files and Their Purposes

### Core Configuration Files

#### `hypergen-config.ts`
Manages project-level configuration loading and resolution.

**Key Components:**
- `HypergenConfigLoader`: Main class for loading and merging configurations
- `HypergenConfig`: Interface defining project-level config structure
- `ResolvedConfig`: Fully resolved configuration with all paths and helpers loaded

**Supported Config Files:**
- `hypergen.config.js` (ES module)
- `hypergen.config.mjs` (ES module)
- `hypergen.config.cjs` (CommonJS)
- `hypergen.config.json` (JSON)
- `.hypergenrc` (JSON)
- `.hypergenrc.js` (JavaScript)
- `.hypergenrc.json` (JSON)

**Configuration Search Strategy:**
1. Explicit path (if provided)
2. Environment variable `HYPERGEN_CONFIG`
3. Current project directory
4. Parent directories (walks up to root)
5. Home directory

**Features:**
- Merges configuration from multiple sources
- Environment-specific overrides
- Helper function loading
- Cache configuration
- Plugin system support

#### `types.ts`
Core type definitions for the V8 template configuration system.

**Main Types:**
- `TemplateConfig`: Rich template configuration interface
- `VariableDefinition`: Variable type and validation definitions
- `TemplateInclude`: Template composition includes
- `TemplateHooks`: Lifecycle hooks (before/after/error)
- `ParserOptions`: Configuration for the parser
- `TemplateConfigError`: Custom error class for config errors

**Variable Types Supported:**
- `string`: Text with optional regex pattern validation
- `number`: Numeric values with min/max constraints
- `boolean`: True/false values
- `enum`: Choice from predefined values
- `array`: Array of values
- `object`: Complex objects

#### `parser.ts`
Implements the TemplateConfigParser for YAML-based template configuration.

**Key Components:**
- `TemplateConfigParser`: Main parser class
- `parseConfig()`: Parse YAML configuration files
- `parseConfigFromString()`: Parse inline YAML content
- `resolveVariables()`: Process and validate template variables
- `validateConfig()`: Schema validation with detailed error reporting

**Capabilities:**
- YAML parsing with schema validation
- Variable merging and conflict resolution
- Include resolution and caching
- Variable type validation
- Custom validators support
- Comprehensive error handling with field-level diagnostics

### Template Management Files

#### `template-parser.ts`
Advanced template configuration parser supporting the V8 Recipe Step System.

**Key Components:**
- `TemplateParser`: Main template parsing class
- `TemplateConfig`: Extended template configuration
- `TemplateDependency`: Dependency definition interface
- `RecipeStepUnion`: Union type for various recipe step types

**Supported Features:**
- Template variables with rich type system
- Template examples and documentation
- Dependencies array (string[] or TemplateDependency[])
- V8 Recipe steps for advanced automation
- Template inheritance (`extends`)
- Template composition (`includes`)
- Lifecycle hooks (pre, post, error)
- Conflict resolution strategies
- Engine and version requirements

**Recipe Steps Validation:**
- Template steps (EJS template rendering)
- Action steps (custom action execution)
- CodeMod steps (code transformation)
- Recipe steps (nested recipe execution)
- Dependency tracking and cycle detection

#### `template-composition.ts`
Handles template inheritance, composition, and conflict resolution.

**Key Components:**
- `TemplateCompositionEngine`: Main composition orchestrator
- `ComposedTemplate`: Result of composition with conflicts tracked
- `CompositionContext`: Context for tracking resolution state

**Composition Features:**
- **Inheritance**: Single parent template support with variable merging
- **Includes**: Multiple template composition with conditional inclusion
- **Conflict Resolution**: Four strategies available:
  - `fail`: Throw error on conflicts
  - `merge`: Override with new values
  - `extend`: Additive merge (useful for arrays)
  - `error`: Similar to fail
- **Safe Evaluation**: Condition expressions evaluated safely without eval()
- **Variable Overrides**: Apply variable overrides to included templates
- **Caching**: Resolves templates once and caches in composition context

**Conflict Handling:**
- Variables (overrides from child templates)
- Dependencies (de-duplicated)
- Outputs (merged)
- Tags (merged)

#### `dependency-manager.ts`
Manages template dependency resolution and installation.

**Key Components:**
- `TemplateDependencyManager`: Main dependency resolver
- `DependencyGraph`: Complete dependency graph with conflicts
- `ResolvedDependency`: Individual resolved dependency info

**Dependency Types Supported:**
- `npm`: NPM registry packages
- `github`: GitHub repositories
- `local`: Local file system paths
- `http`: HTTP/HTTPS URLs
- `auto`: Automatic detection

**Features:**
- Parallel dependency resolution
- Caching of resolved dependencies
- Dependency conflict detection
- Version compatibility checking
- Optional and dev dependencies
- Comprehensive error handling

**Resolution Process:**
1. Normalize dependencies (convert strings to objects)
2. Filter by options (skip dev, filter optional)
3. Resolve each dependency independently
4. Track missing and conflicting dependencies
5. Cache resolved paths

### URL Resolution Module (`url-resolution/`)

#### `manager.ts`
Orchestrates template URL resolution with pluggable resolvers.

**Key Components:**
- `TemplateURLManager`: Main URL resolution orchestrator
- Resolver management and routing
- Cache integration
- Security configuration

**Features:**
- URL type detection (github, gist, npm, http, local)
- Pluggable resolver system
- Parallel URL resolution
- Cache hit checking
- Resolver selection and fallback

#### `types.ts`
Type definitions for URL resolution system.

**Main Types:**
- `TemplateURLResolver`: Interface for custom resolvers
- `ResolvedTemplate`: Resolved template with content and metadata
- `URLManagerConfig`: Manager configuration
- `SecurityConfig`: Security constraints
- `URLCacheConfig`: Cache configuration
- `URLResolutionError`: Custom error class

#### `cache.ts`
Implements caching for resolved templates with TTL and integrity checking.

**Features:**
- File-based cache storage
- TTL (time-to-live) expiration
- Checksum-based integrity verification
- Cache statistics and info
- Configurable max size with cleanup
- Automatic cache initialization

#### `resolvers/local.ts`
Resolves local template references (relative and absolute paths).

**Features:**
- Supports file:// URLs
- Relative path resolution
- Absolute path resolution
- Automatic template.yml discovery
- Checksum calculation

#### `resolvers/github.ts`
Resolves templates from GitHub repositories.

**Features:**
- Multiple URL format support:
  - `github:owner/repo@version`
  - `github:owner/repo@version/path`
  - Full GitHub URLs
  - Raw GitHub content URLs
- Security validation
- HTTPS enforcement
- File size limits
- Branch/tag/commit reference resolution

#### `index.ts`
Exports public API for URL resolution module.

## Architecture and Design Patterns

### Configuration Hierarchy

Configurations are loaded in order of precedence (lowest to highest):

```
1. Default configuration (built-in)
   ↓
2. Explicitly specified config file
   ↓
3. Environment variable `HYPERGEN_CONFIG`
   ↓
4. Project config (hypergen.config.js, etc.)
   ↓
5. Environment-specific config (e.g., production overrides)
   ↓
6. Runtime parameter overrides
```

### Template Composition Pipeline

```
Base Template (template.yml)
    ↓
[1] Resolve Inheritance
    - Load parent template
    - Merge variables
    - Handle conflicts
    ↓
[2] Resolve Includes
    - For each include:
      - Check condition
      - Load template
      - Apply variable overrides
      - Merge into result
    ↓
[3] Resolve Conflicts
    - De-duplicate dependencies
    - De-duplicate outputs
    - De-duplicate tags
    ↓
Composed Template (ready for execution)
```

### Dependency Resolution Strategy

```
Template Dependencies
    ↓
Normalize (string[] → TemplateDependency[])
    ↓
Filter (by dev, optional flags)
    ↓
Resolve in Parallel
    ├─ NPM → check node_modules
    ├─ GitHub → use URL manager
    ├─ Local → resolve relative/absolute path
    └─ HTTP → use URL manager
    ↓
Detect Conflicts & Missing
    ↓
Return DependencyGraph
```

### URL Resolution Flow

```
URL Input
    ↓
Check Cache
    ├─ Hit → return cached
    └─ Miss → continue
    ↓
Detect URL Type
    ├─ github:* or github.com → GitHub Resolver
    ├─ gist: or gist.github.com → Gist Resolver (future)
    ├─ npm: → NPM Resolver (future)
    ├─ http:// or https:// → HTTP Resolver (future)
    └─ local file path → Local Resolver
    ↓
Resolve with Selected Resolver
    ├─ Security checks
    ├─ Fetch/Load content
    └─ Calculate checksum
    ↓
Cache Result
    ↓
Return ResolvedTemplate
```

## How the Code Works (High-Level Flow)

### Configuration Loading Flow

```typescript
// User calls loadConfig
HypergenConfigLoader.loadConfig(configPath?, projectRoot?, environment?)
  ├─ 1. Search for config file in multiple locations
  ├─ 2. Load found config file (JSON or JS)
  ├─ 3. Merge with default configuration
  ├─ 4. Apply environment-specific overrides
  ├─ 5. Load helper functions
  ├─ 6. Resolve template paths
  └─ 7. Return ResolvedConfig
```

### Template Parsing Flow

```typescript
TemplateParser.parseTemplateFile(filePath)
  ├─ 1. Read YAML file
  ├─ 2. Parse YAML content
  ├─ 3. Validate schema
  │    ├─ Check required fields
  │    ├─ Validate variable definitions
  │    ├─ Validate recipe steps
  │    └─ Collect warnings
  ├─ 4. Build TemplateConfig object
  └─ 5. Return ParsedTemplate with errors/warnings
```

### Variable Resolution Flow

```typescript
parser.resolveVariables(config, providedValues)
  ├─ 1. Iterate through all variables
  ├─ 2. For each variable:
  │    ├─ Check if provided
  │    ├─ Apply default if not provided
  │    ├─ Validate type and constraints
  │    ├─ Run custom validators
  │    └─ Track resolution source
  ├─ 3. Handle internal (computed) variables
  └─ 4. Return ResolvedVariables with metadata
```

### Template Composition Flow

```typescript
compositionEngine.compose(baseTemplate, context)
  ├─ 1. Resolve inheritance (if extends)
  │    ├─ Load parent template
  │    ├─ Merge variables
  │    └─ Handle conflicts
  ├─ 2. Resolve includes (if includes)
  │    ├─ For each include:
  │    │  ├─ Check condition
  │    │  ├─ Load template
  │    │  ├─ Apply overrides
  │    │  └─ Merge variables
  │    └─ Track conflicts
  ├─ 3. Resolve conflicts
  │    ├─ De-duplicate dependencies
  │    ├─ De-duplicate outputs
  │    └─ De-duplicate tags
  └─ 4. Return ComposedTemplate
```

## Key Data Structures

### VariableDefinition
```typescript
{
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object'
  required?: boolean
  default?: any
  description?: string
  pattern?: string (for string type)
  values?: string[] (for enum type)
  min?: number (for number type)
  max?: number (for number type)
  validation?: {
    required?: boolean
    custom?: string
    message?: string
  }
  internal?: boolean (computed/derived)
}
```

### ResolvedTemplate
```typescript
{
  content: string // template.yml content
  basePath: string // directory where template lives
  metadata: {
    url: string
    type: URLType
    version?: string
    lastFetched: Date
    etag?: string
    checksum: string
  }
}
```

### ComposedTemplate
```typescript
{
  config: TemplateConfig
  variables: Record<string, VariableDefinition>
  resolvedIncludes: Array<{
    url: string
    config: TemplateConfig
    included: boolean
    reason?: string
  }>
  conflicts: Array<{
    type: 'variable' | 'dependency' | 'output'
    name: string
    sources: string[]
    resolution: 'merge' | 'replace' | 'extend' | 'error'
  }>
}
```

## Dependencies and Relationships

### Internal Dependencies

- **parser.ts** depends on:
  - `types.ts` (type definitions)
  - `url-resolution/index.ts` (dynamic import for URL manager)

- **template-composition.ts** depends on:
  - `url-resolution/index.ts` (TemplateURLManager)
  - `template-parser.ts` (TemplateParser)
  - Error handling utilities

- **dependency-manager.ts** depends on:
  - `url-resolution/index.ts` (TemplateURLManager)
  - `template-parser.ts` (for types)

- **url-resolution/** depends on:
  - `types.ts` (URL-specific types)
  - `cache.ts` (URLCache)
  - `resolvers/*` (specific resolvers)

### External Dependencies

- `yaml`: YAML parsing and dumping
- `fs-extra`: File system operations with promises
- `debug`: Debug logging
- `js-yaml`: YAML parsing (in template-parser.ts)
- `cosmiconfig`: Configuration file discovery (referenced in CLAUDE.md)

## Important Implementation Details

### Error Handling

The module uses a custom error hierarchy:

```
Error
├─ TemplateConfigError (invalid configuration)
├─ URLResolutionError (URL resolution failures)
└─ ErrorHandler utilities (create errors with codes)
```

### Validation Strategy

Two-pass validation approach:

1. **Schema Validation**: Structure and type checking
2. **Value Validation**: Type coercion, constraint checking, custom validators

### Caching Strategy

Multiple levels of caching:

1. **Include Cache**: Template includes are cached during composition
2. **URL Cache**: Resolved URLs cached with TTL
3. **Dependency Cache**: Resolved dependencies cached

All caches are instance-level (not shared globally) to avoid state issues.

### Security Features

- **Safe Expression Evaluation**: Conditions evaluated without `eval()`, with restricted scope
- **Domain Whitelisting**: GitHub URLs validated against allowed domains
- **HTTPS Enforcement**: Can require HTTPS for remote templates
- **File Size Limits**: Maximum file size constraints for downloads
- **Checksum Verification**: Integrity checking via SHA256

### Performance Optimizations

- **Lazy Loading**: URL manager imported dynamically to avoid circular dependencies
- **Parallel Resolution**: Multiple URLs/dependencies resolved in parallel
- **Caching at Multiple Levels**: Reduces redundant work
- **Early Termination**: Stops processing on fatal errors when appropriate

## Contributing and Working with This Code

### Adding a New URL Resolver

1. Create new file in `url-resolution/resolvers/` (e.g., `npm.ts`)
2. Implement `TemplateURLResolver` interface
3. Add to default resolvers in `TemplateURLManager.setupDefaultResolvers()`
4. Export from `url-resolution/index.ts`

### Adding a New Variable Type

1. Add type to `VariableType` union in `types.ts`
2. Add validation logic in `TemplateParser.validateVariableDefinition()`
3. Add value validation in `TemplateParser.validateVariableValue()`
4. Update documentation in variable definition interfaces

### Adding Configuration Options

1. Add property to `HypergenConfig` interface
2. Set default in `HypergenConfigLoader.DEFAULT_CONFIG`
3. Add loading logic in `loadConfigFile()`
4. Update config validation in `validateConfig()`

### Testing

The module includes comprehensive validation and testing considerations:

- **Parser Tests**: Validate YAML parsing and schema validation
- **Composition Tests**: Test inheritance, includes, and conflict resolution
- **Dependency Tests**: Test resolution from various sources
- **URL Resolution Tests**: Test different URL types and caching
- **Integration Tests**: End-to-end config loading and usage

## Code Organization Best Practices

1. **Single Responsibility**: Each class handles one concern
2. **Dependency Injection**: Configuration and managers are injected
3. **Interface-Based**: Public APIs use interfaces for flexibility
4. **Error Context**: Errors include relevant context for debugging
5. **Debug Logging**: Extensive use of debug namespace for troubleshooting
6. **Type Safety**: Full TypeScript types throughout

## Future Enhancements

Based on TODO comments in the code:

- [ ] User prompting for variable conflicts in composition
- [ ] Template rendering for computed/internal variables
- [ ] NPM resolver implementation
- [ ] Gist resolver implementation
- [ ] HTTP resolver implementation
- [ ] Smart variable merging strategies
- [ ] Template version compatibility checking
- [ ] Codemod and Recipe step system integration

## TODO

-   [ ] **Parser (`parser.ts`)**:
    *   Implement actual prompting when integrating with the CLI for required variables.
    *   Implement template rendering for computed variables.
    *   Pass actual template path to `ValidationContext` in `validateVariableValue` function.
    *   Implement smart merging for variable conflicts in `mergeVariables` function.
    *   Implement user prompting for conflicts in `mergeVariables` function.
-   [ ] **Template Composition (`template-composition.ts`)**:
    *   Implement user prompting for variable conflicts.
-   [ ] **Dependency Manager (`dependency-manager.ts`)**:
    *   Implement full NPM registry check, download, and installation.
-   [ ] **Hypergen Config (`hypergen-config.ts`)**:
    *   Add support for `handlebars` and `mustache` engine types.
-   [ ] **Template Parser (`template-parser.ts`)**:
    *   Add more sophisticated validation for condition expressions.
    *   Implement `validateStepToolConfiguration` for each tool type.