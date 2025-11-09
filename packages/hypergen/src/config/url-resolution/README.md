# URL Resolution System

The URL Resolution system provides a robust, extensible framework for resolving template references from multiple sources (local files, GitHub repositories, npm packages, HTTP endpoints) with intelligent caching, security controls, and integrity verification.

## Overview

This module enables Hypergen to reference templates from diverse sources using a unified resolution interface. It supports:

- **Multiple URL types**: Local files, GitHub repositories, GitHub Gists, npm packages, and HTTP(S) endpoints
- **Intelligent caching**: TTL-based caching with integrity checks and automatic cleanup
- **Security controls**: Domain allowlists/blocklists, HTTPS enforcement, file size limits
- **Parallel resolution**: Efficient batch resolution of multiple templates
- **Extensibility**: Plugin architecture for custom URL resolvers

The system is used by the Template Composition Engine and Dependency Manager to resolve template inheritance, includes, and dependencies from various sources.

## Architecture

### Core Components

```
url-resolution/
├── index.ts              # Public API exports
├── types.ts              # TypeScript type definitions
├── manager.ts            # Main orchestrator (TemplateURLManager)
├── cache.ts              # Caching system (URLCache)
└── resolvers/           # URL resolver implementations
    ├── local.ts          # Local file system resolver
    ├── github.ts         # GitHub repository resolver
    └── [future resolvers: gist.ts, npm.ts, http.ts]
```

### Component Relationships

```
┌─────────────────────────────────────┐
│   Template Composition Engine       │
│   Template Dependency Manager       │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│    TemplateURLManager               │
│    - URL parsing & routing          │
│    - Resolver orchestration         │
│    - Cache integration              │
└──────────┬──────────────────────────┘
           │
           ├─────────────┬──────────────┬──────────────┐
           ▼             ▼              ▼              ▼
    ┌────────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐
    │ URLCache   │  │  Local   │  │ GitHub  │  │  [More   │
    │            │  │ Resolver │  │Resolver │  │Resolvers]│
    └────────────┘  └──────────┘  └─────────┘  └──────────┘
```

## Key Files and Their Purposes

### `types.ts`

Defines the core type system for URL resolution.

**Key Types:**

- `TemplateURLResolver`: Interface that all resolvers must implement
- `ResolvedTemplate`: Result of template resolution (content + metadata)
- `URLManagerConfig`: Configuration for the URL manager
- `SecurityConfig`: Security policies and constraints
- `URLCacheConfig`: Cache configuration (TTL, size limits, integrity checks)
- `URLType`: Union type of supported URL types ('github' | 'gist' | 'npm' | 'http' | 'local')

**Custom Error Types:**

- `URLResolutionError`: Specialized error with URL context

### `manager.ts` - TemplateURLManager

Main orchestrator that coordinates URL parsing, resolver selection, and caching.

**Key Responsibilities:**

1. Parse URLs to determine their type
2. Route to appropriate resolver
3. Manage caching layer
4. Coordinate parallel resolution
5. Provide cache management utilities

**Public API:**

```typescript
class TemplateURLManager {
  async initialize(): Promise<void>;
  async resolveURL(url: string, basePath?: string,): Promise<ResolvedTemplate>;
  async resolveMultiple(
    urls: string[],
    basePath?: string,
  ): Promise<ResolvedTemplate[]>;
  async clearCache(): Promise<void>;
  async getCacheInfo(): Promise<CacheInfo>;
  async validateCache(): Promise<ValidationResult>;
  addResolver(type: URLType, resolver: TemplateURLResolver,): void;
  setConfig(config: Partial<URLManagerConfig>,): void;
}
```

**Configuration:**

```typescript
{
  cache: {
    cacheDir: string,        // Default: ~/.hypergen/cache
    ttl: number,             // Default: 24 hours
    maxSize: number,         // Default: 100MB
    integrityCheck: boolean  // Default: true
  },
  security: {
    allowedDomains: string[],     // Default: github.com, gist.github.com, raw.githubusercontent.com
    blockedDomains: string[],     // Optional
    allowPrivateRepos: boolean,   // Default: undefined
    requireHttps: boolean,        // Default: true
    maxFileSize: number          // Default: 1MB
  },
  timeout: number                 // Default: 30000ms
}
```

### `cache.ts` - URLCache

Implements the caching layer with TTL management, integrity verification, and automatic cleanup.

**Key Features:**

- **SHA-256 based cache keys**: Deterministic, collision-resistant
- **TTL expiration**: Automatic invalidation of old entries
- **Integrity verification**: SHA-256 checksums for cache entries
- **Size management**: LRU eviction when cache exceeds maxSize
- **Atomic operations**: Safe concurrent access

**Cache Structure:**

```
<cacheDir>/
  <sha256-hash-of-url>/
    template.yml       # Template content
    metadata.json      # Metadata + timestamps
```

**Public API:**

```typescript
class URLCache {
  async initialize(): Promise<void>;
  async get(url: string,): Promise<ResolvedTemplate | null>;
  async set(url: string, resolved: ResolvedTemplate,): Promise<void>;
  async delete(url: string,): Promise<void>;
  async clear(): Promise<void>;
  async getInfo(): Promise<CacheInfo>;
  async validate(): Promise<ValidationResult>;
}
```

**Cache Lifecycle:**

1. Check expiration (TTL-based)
2. Verify integrity (checksum comparison)
3. Return cached content or null
4. On cache miss, resolver fetches and caches result
5. Automatic cleanup when size limit exceeded

### `resolvers/local.ts` - LocalResolver

Resolves templates from the local file system.

**Supported URL Formats:**

- `./relative/path` - Relative to basePath
- `../relative/path` - Parent directory relative
- `/absolute/path` - Absolute file system path
- `file:///absolute/path` - File URL protocol
- `relative/path` - Relative to current working directory

**Resolution Strategy:**

1. Normalize URL (strip `file://` prefix if present)
2. Resolve path relative to basePath or cwd
3. Locate `template.yml` or `template.yaml`
4. Read and return content with checksum

**Template Discovery:**

- If URL ends with `template.yml/yaml`, use directly
- If URL is directory, look for `template.yml` or `template.yaml` inside
- Otherwise, append `template.yml` to path

### `resolvers/github.ts` - GitHubResolver

Resolves templates from GitHub repositories via raw.githubusercontent.com.

**Supported URL Formats:**

- `github:owner/repo` - Main branch, root template.yml
- `github:owner/repo@version` - Specific branch/tag/commit
- `github:owner/repo@version/path/to/template` - Nested template
- `https://github.com/owner/repo/tree/branch/path` - Full GitHub URL
- `https://raw.githubusercontent.com/owner/repo/branch/path/template.yml` - Raw content URL

**Resolution Strategy:**

1. Parse URL to extract owner, repo, ref (branch/tag/commit), and path
2. Validate against security policies
3. Construct raw.githubusercontent.com URL
4. Fetch via HTTPS with timeout and size limits
5. Create temporary directory for template files
6. Return content with metadata

**Security Features:**

- Domain allowlist/blocklist checking
- HTTPS enforcement (configurable)
- File size limits (prevents memory attacks)
- Streaming with size validation during download
- Timeout protection

**Future Resolvers:**

- `resolvers/gist.ts` - GitHub Gists
- `resolvers/npm.ts` - npm packages
- `resolvers/http.ts` - Generic HTTP(S) endpoints

## Design Patterns

### Strategy Pattern

Each resolver implements the `TemplateURLResolver` interface, allowing the manager to delegate resolution without knowing implementation details.

```typescript
interface TemplateURLResolver {
  supports(url: string,): boolean;
  resolve(url: string, basePath?: string,): Promise<ResolvedTemplate>;
}
```

### Decorator Pattern

The cache acts as a transparent decorator around resolvers, intercepting requests and responses.

### Factory Pattern

The manager acts as a factory, creating and managing resolver instances based on URL type.

### Chain of Responsibility

When a resolver doesn't support a URL, the manager tries the next resolver until one succeeds.

## How It Works

### Resolution Flow

```
User/System
    │
    ├─> resolveURL(url, basePath)
    │        │
    │        ├─> Check cache
    │        │       │
    │        │       └─> Cache hit? Return cached
    │        │
    │        ├─> Parse URL → determine type
    │        │
    │        ├─> Find resolver for type
    │        │       │
    │        │       ├─> LocalResolver.supports(url)?
    │        │       ├─> GitHubResolver.supports(url)?
    │        │       └─> [Other resolvers...]
    │        │
    │        ├─> Resolver.resolve(url, basePath)
    │        │       │
    │        │       ├─> Fetch/read template
    │        │       ├─> Validate
    │        │       └─> Return ResolvedTemplate
    │        │
    │        └─> Cache result
    │                │
    │                └─> Return ResolvedTemplate
```

### Parallel Resolution Flow

```typescript
await manager.resolveMultiple([
  'github:hypergen/templates@main',
  './local/template',
  'npm:@hypergen/react-templates',
],);
```

```
Promise.all([
  resolveURL('github:...'),  // Parallel
  resolveURL('./local...'),   // Parallel
  resolveURL('npm:...')       // Parallel
])
    │
    └─> Each follows standard resolution flow
```

### Cache Management

**Cache Hit:**

```
URL → Hash → Check existence → Verify TTL → Verify integrity → Return
```

**Cache Miss:**

```
URL → Hash → Not found/Expired/Corrupted → Return null → Trigger resolution → Cache result
```

**Cache Cleanup:**

```
Check total size > maxSize?
    │
    └─> Yes: Sort by age → Remove oldest until size < (maxSize * 0.8)
```

## Usage Examples

### Basic Resolution

```typescript
import { TemplateURLManager, } from './url-resolution';

const manager = new TemplateURLManager();
await manager.initialize();

// Resolve a local template
const local = await manager.resolveURL('./templates/component',);

// Resolve a GitHub template
const github = await manager.resolveURL(
  'github:hypergen/templates@v1.0.0/react/component',
);

// Access resolved content
console.log(local.content,); // template.yml content
console.log(local.basePath,); // Local path where template files are
console.log(local.metadata.type,); // 'local'
```

### Custom Configuration

```typescript
const manager = new TemplateURLManager({
  cache: {
    cacheDir: '/custom/cache/path',
    ttl: 60 * 60 * 1000, // 1 hour
    maxSize: 50 * 1024 * 1024, // 50MB
    integrityCheck: true,
  },
  security: {
    allowedDomains: ['github.com', 'internal-git.company.com',],
    requireHttps: true,
    maxFileSize: 512 * 1024, // 512KB
  },
  timeout: 10000, // 10 seconds
},);

await manager.initialize();
```

### Parallel Resolution

```typescript
const urls = [
  'github:hypergen/templates@main/react/component',
  'github:hypergen/templates@main/react/page',
  './local/custom-template',
];

const templates = await manager.resolveMultiple(urls, process.cwd(),);

templates.forEach((template,) => {
  console.log(`Resolved: ${template.metadata.url}`,);
},);
```

### Cache Management

```typescript
// Get cache statistics
const info = await manager.getCacheInfo();
console.log(`Cache entries: ${info.entryCount}`,);
console.log(`Total size: ${info.totalSize} bytes`,);
console.log(`Hit rate: ${(info.hitRate * 100).toFixed(2,)}%`,);

// Validate cache integrity
const validation = await manager.validateCache();
if (!validation.valid) {
  console.error('Cache validation failed:', validation.errors,);
}

// Clear cache
await manager.clearCache();
```

### Custom Resolver

```typescript
import { ResolvedTemplate, TemplateURLResolver, } from './url-resolution';

class CustomResolver implements TemplateURLResolver {
  supports(url: string,): boolean {
    return url.startsWith('custom:',);
  }

  async resolve(url: string, basePath?: string,): Promise<ResolvedTemplate> {
    // Custom resolution logic
    const content = await fetchFromCustomSource(url,);
    return {
      content,
      basePath: '/tmp/custom',
      metadata: {
        url,
        type: 'http',
        lastFetched: new Date(),
        checksum: calculateChecksum(content,),
      },
    };
  }
}

// Register custom resolver
manager.addResolver('http', new CustomResolver(),);
```

## Integration with Other Modules

### Template Composition Engine

The composition engine uses URL resolution to load parent templates and includes:

```typescript
// From template-composition.ts
private async resolveInheritance(result: ComposedTemplate, context: CompositionContext) {
  const parentTemplate = await this.urlManager.resolveURL(
    context.baseTemplate.extends,
    context.projectRoot
  )
  // Apply inheritance...
}
```

### Dependency Manager

The dependency manager uses URL resolution to fetch template dependencies:

```typescript
// From dependency-manager.ts
private async resolveSingleDependency(dep: TemplateDependency, options) {
  const resolved = await this.urlManager.resolveURL(dep.url || dep.name, options.projectRoot)
  // Process dependency...
}
```

### Recipe Tool

The recipe tool system uses URL resolution to load external recipe definitions:

```typescript
// Resolve recipe template from URL
const recipeTemplate = await urlManager.resolveURL(recipeUrl,);
const recipe = parseRecipe(recipeTemplate.content,);
```

## Dependencies

### External Libraries

- **fs-extra**: Enhanced file system operations with promise support
- **debug**: Hierarchical debug logging (`hypergen:v8:url-manager`, `hypergen:v8:cache`, `hypergen:v8:resolver:*`)
- **crypto**: SHA-256 hashing for cache keys and integrity checks
- **https**: Native Node.js HTTPS client for GitHub fetching

### Internal Dependencies

- Used by: `config/template-composition.ts`, `config/dependency-manager.ts`, `recipe-engine/tools/recipe-tool.ts`
- Uses: `errors/hypergen-errors.ts` (indirectly via composition/dependency managers)

## Testing

The URL resolution system is thoroughly tested in `tests/url-resolution.spec.ts`.

**Test Coverage:**

- URLCache: caching, expiration, integrity verification, statistics
- LocalResolver: path resolution, relative/absolute paths, file:// URLs
- GitHubResolver: URL parsing, security validation (mocked fetching)
- TemplateURLManager: integration, parallel resolution, cache management

**Running Tests:**

```bash
cd packages/hypergen
bun test tests/url-resolution.spec.ts
```

**Test Strategy:**

- Unit tests for individual components
- Integration tests for manager orchestration
- Temporary directories for isolated testing
- Mock HTTP requests for GitHub resolver (future enhancement)

## Performance Considerations

### Caching Strategy

- **Hash-based keys**: O(1) lookup with SHA-256 hashing
- **TTL expiration**: Reduces stale data without manual invalidation
- **LRU eviction**: Automatic cleanup keeps cache size bounded
- **Integrity checks**: Optional for performance-sensitive use cases

### Parallel Resolution

- Uses `Promise.all()` for concurrent resolution
- Independent resolvers can run in parallel
- Shared cache prevents duplicate fetches

### Lazy Loading

- Resolvers instantiated on-demand
- Cache initialized only when needed
- Debug logging disabled by default (controlled by DEBUG env var)

### Optimization Opportunities

- Connection pooling for HTTP requests
- Compression for cached entries
- Incremental cache validation
- Background cache warming

## Security Considerations

### Input Validation

- URL parsing with error handling
- Path traversal prevention in local resolver
- Size limits on remote fetches

### Domain Control

- Allowlist/blocklist for external domains
- HTTPS enforcement (configurable)
- Private repository access control

### Integrity Verification

- SHA-256 checksums for all cached entries
- Corruption detection and automatic re-fetch
- Atomic cache operations

### Resource Limits

- File size limits prevent memory exhaustion
- Timeout protection for network requests
- Cache size limits prevent disk exhaustion

## Contributing

### Adding a New Resolver

1. Create resolver file: `resolvers/your-resolver.ts`

```typescript
import type { ResolvedTemplate, TemplateURLResolver, } from '../types.js';
import { URLResolutionError, } from '../types.js';

export class YourResolver implements TemplateURLResolver {
  supports(url: string,): boolean {
    // Return true if this resolver handles the URL
    return url.startsWith('your-prefix:',);
  }

  async resolve(url: string, basePath?: string,): Promise<ResolvedTemplate> {
    try {
      // Resolution logic
      const content = await fetchContent(url,);
      const checksum = calculateChecksum(content,);

      return {
        content,
        basePath: '/path/to/template',
        metadata: {
          url,
          type: 'your-type',
          lastFetched: new Date(),
          checksum,
        },
      };
    } catch (error) {
      throw new URLResolutionError(
        `Failed to resolve: ${error.message}`,
        url,
        'your-type',
        error,
      );
    }
  }
}
```

2. Register in `manager.ts`:

```typescript
private setupDefaultResolvers(): void {
  // ... existing resolvers ...
  this.resolvers.set('your-type', new YourResolver(this.config.security, this.config.timeout))
}
```

3. Update `types.ts`:

```typescript
export type URLType =
  | 'github'
  | 'gist'
  | 'npm'
  | 'http'
  | 'local'
  | 'your-type';
```

4. Export from `index.ts`:

```typescript
export { YourResolver, } from './resolvers/your-resolver.js';
```

5. Add tests in `tests/url-resolution.spec.ts`

### Code Style Guidelines

- Use debug logging with appropriate namespace
- Always calculate checksums for integrity
- Throw `URLResolutionError` for resolver failures
- Use async/await for async operations
- Include TypeScript types for all functions
- Document complex logic with comments

### Testing Requirements

- Unit tests for resolver logic
- Integration tests with manager
- Edge case coverage (missing files, network errors, etc.)
- Security validation tests

## Troubleshooting

### Enable Debug Logging

```bash
DEBUG=hypergen:v8:url-manager,hypergen:v8:cache,hypergen:v8:resolver:* bun run hygen
```

### Common Issues

**Cache corruption:**

```typescript
// Validate and clear if needed
const validation = await manager.validateCache();
if (!validation.valid) {
  await manager.clearCache();
}
```

**GitHub rate limiting:**

- Use authenticated requests (future enhancement)
- Implement exponential backoff
- Cache aggressively

**Network timeouts:**

```typescript
// Increase timeout in configuration
const manager = new TemplateURLManager({
  timeout: 60000, // 60 seconds
},);
```

**Cache size issues:**

```typescript
// Reduce maxSize or clear cache
const manager = new TemplateURLManager({
  cache: {
    maxSize: 10 * 1024 * 1024, // 10MB
  },
},);
```

## Future Enhancements

### Planned Features

- [ ] Gist resolver implementation
- [ ] npm resolver implementation
- [ ] Generic HTTP resolver with custom headers
- [ ] Authentication support (GitHub tokens, npm tokens)
- [ ] Rate limiting and retry logic
- [ ] Cache compression
- [ ] Background cache warming
- [ ] Cache analytics and monitoring
- [ ] Webhook-based cache invalidation
- [ ] Template signature verification

### API Stability

- **Current Status**: Stable V8 API
- **Breaking Changes**: Will be communicated via changelog
- **Deprecation Policy**: 2 major versions notice

## Related Documentation

- [Configuration System Overview](../README.md)
- [Template Composition Engine](../template-composition.ts)
- [Template Dependency Manager](../dependency-manager.ts)
- [Template Parser](../template-parser.ts)
- [Recipe Engine](../../recipe-engine/README.md)

## License

Part of the Hypergen project. See main LICENSE file for details.
