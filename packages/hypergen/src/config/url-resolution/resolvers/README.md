# URL Resolution Resolvers

This directory contains the resolver implementations for Hypergen's template URL resolution system. Resolvers are responsible for fetching and resolving template configurations from various sources (local filesystem, GitHub repositories, npm packages, etc.).

## Overview

The resolver system is part of Hypergen's template discovery mechanism, enabling templates to be sourced from multiple locations and formats. Each resolver implements the `TemplateURLResolver` interface and handles a specific URL type or protocol.

### Purpose

- **Multi-source template loading**: Support templates from local files, GitHub repositories, npm packages, and HTTP endpoints
- **Security**: Enforce security policies for remote template fetching (HTTPS enforcement, file size limits, domain allowlists)
- **Caching**: Work with the URL cache system to minimize redundant network requests
- **Consistency**: Provide a uniform interface for resolving templates regardless of source

## Architecture

### Design Pattern: Strategy Pattern

The resolver system uses the Strategy pattern, where:

- `TemplateURLResolver` is the strategy interface
- Each resolver (`LocalResolver`, `GitHubResolver`, etc.) is a concrete strategy
- `TemplateURLManager` is the context that selects and uses the appropriate resolver

```
┌─────────────────────────┐
│  TemplateURLManager     │
│  (Context)              │
└───────────┬─────────────┘
            │
            │ uses
            ▼
┌─────────────────────────┐
│ TemplateURLResolver     │
│ (Strategy Interface)    │
├─────────────────────────┤
│ + supports(url): bool   │
│ + resolve(url): Promise │
└───────────┬─────────────┘
            │
            │ implements
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌──────────┐   ┌──────────┐
│  Local   │   │  GitHub  │
│ Resolver │   │ Resolver │
└──────────┘   └──────────┘
```

### Key Files

| File        | Purpose                              | Lines of Code |
| ----------- | ------------------------------------ | ------------- |
| `local.ts`  | Resolves local filesystem templates  | ~110          |
| `github.ts` | Resolves GitHub repository templates | ~263          |

## Resolver Implementations

### LocalResolver (`local.ts`)

Handles local template resolution from the filesystem.

**Supported URL formats:**

- Relative paths: `./templates/component`, `../shared/template`
- Absolute paths: `/home/user/templates/component`
- File URLs: `file:///home/user/templates/component`

**Key features:**

- Path resolution relative to a base path or current working directory
- Automatic discovery of `template.yml` or `template.yaml` files
- Integrity checking via SHA-256 checksums
- Support for both file and directory paths

**Flow:**

1. Parse and normalize the URL (remove `file://` prefix if present)
2. Resolve path (absolute or relative to basePath)
3. Find template configuration file (`template.yml` or `template.yaml`)
4. Read configuration content
5. Calculate checksum for integrity verification
6. Return resolved template with metadata

**Example usage:**

```typescript
const resolver = new LocalResolver();

// Resolve a relative path
const template = await resolver.resolve('./my-template', '/project/templates',);

// Resolve an absolute path
const template2 = await resolver.resolve('/home/user/templates/component',);
```

### GitHubResolver (`github.ts`)

Fetches templates from GitHub repositories with caching and security features.

**Supported URL formats:**

- Shorthand: `github:owner/repo@version`
- Shorthand with path: `github:owner/repo@version/path/to/template`
- Full GitHub URL: `https://github.com/owner/repo/tree/branch/path`
- Raw content URL: `https://raw.githubusercontent.com/owner/repo/branch/path/template.yml`

**Key features:**

- Multiple URL format parsing (shorthand and full URLs)
- Security validation (HTTPS enforcement, domain allowlists, file size limits)
- Timeout handling for network requests
- Streaming download with size limit enforcement
- Temporary directory creation for cached templates
- SHA-256 checksum calculation for integrity

**Security configuration:**

```typescript
interface SecurityConfig {
  requireHttps?: boolean; // Default: true
  maxFileSize?: number; // Default: 1MB
  allowedDomains?: string[]; // Optional domain allowlist
  blockedDomains?: string[]; // Optional domain blocklist
}
```

**Flow:**

1. Parse GitHub URL (shorthand or full format)
2. Validate security constraints
3. Construct raw content URL
4. Fetch template content via HTTPS with timeout
5. Verify file size limits during download
6. Calculate checksum
7. Create temporary directory for caching
8. Return resolved template with metadata

**Example usage:**

```typescript
const resolver = new GitHubResolver(
  { maxFileSize: 2 * 1024 * 1024, }, // 2MB limit
  30000, // 30 second timeout
);

// Shorthand format
const template1 = await resolver.resolve('github:hyperdev/templates@v1.0.0',);

// Full URL format
const template2 = await resolver.resolve(
  'https://github.com/hyperdev/templates/tree/main/components',
);
```

## Integration with URL Resolution System

### How Resolvers Work with the Manager

The `TemplateURLManager` (in `../manager.ts`) orchestrates resolver usage:

1. **URL parsing**: Manager parses the URL to determine type (`local`, `github`, `npm`, etc.)
2. **Resolver selection**: Manager selects appropriate resolver using `supports()` method
3. **Cache check**: Manager checks cache before invoking resolver
4. **Resolution**: If not cached, manager calls resolver's `resolve()` method
5. **Caching**: Manager caches the resolved template for future use

```typescript
// Manager initialization with default resolvers
const manager = new TemplateURLManager({
  cache: { cacheDir: '~/.hypergen/cache', ttl: 86400000, },
  security: { requireHttps: true, maxFileSize: 1048576, },
},);

await manager.initialize();

// Resolution flow
const resolved = await manager.resolveURL('github:owner/repo@v1.0.0',);
// 1. Check cache -> miss
// 2. Parse URL -> type: 'github'
// 3. Find resolver -> GitHubResolver
// 4. Call resolver.resolve()
// 5. Cache result
// 6. Return resolved template
```

### Resolver Interface

All resolvers must implement `TemplateURLResolver`:

```typescript
interface TemplateURLResolver {
  // Determine if this resolver can handle the given URL
  supports(url: string,): boolean;

  // Resolve the URL and return template information
  resolve(url: string, basePath?: string,): Promise<ResolvedTemplate>;
}
```

### Resolved Template Structure

```typescript
interface ResolvedTemplate {
  content: string; // template.yml content
  basePath: string; // local path where template is cached
  metadata: {
    url: string; // original URL
    type: URLType; // 'local', 'github', 'npm', etc.
    version?: string; // template version if available
    lastFetched: Date; // when template was fetched
    checksum: string; // SHA-256 checksum for integrity
  };
}
```

## How to Contribute

### Adding a New Resolver

To add support for a new template source (e.g., npm, gist, HTTP):

1. **Create resolver file** in this directory (e.g., `npm.ts`, `gist.ts`)

2. **Implement the interface**:

```typescript
import createDebug from 'debug';
import type { ResolvedTemplate, TemplateURLResolver, } from '../types.js';
import { URLResolutionError, } from '../types.js';

const debug = createDebug('hypergen:v8:resolver:npm',);

export class NpmResolver implements TemplateURLResolver {
  private security: SecurityConfig;
  private timeout: number;

  constructor(security: SecurityConfig = {}, timeout = 30000,) {
    this.security = security;
    this.timeout = timeout;
  }

  supports(url: string,): boolean {
    return url.startsWith('npm:',) || url.includes('npmjs.com',);
  }

  async resolve(url: string, basePath?: string,): Promise<ResolvedTemplate> {
    debug('Resolving npm package: %s', url,);

    try {
      // 1. Parse npm package URL
      // 2. Fetch from npm registry
      // 3. Validate security
      // 4. Calculate checksum
      // 5. Return resolved template
    } catch (error) {
      throw new URLResolutionError(
        `Failed to resolve npm package: ${error.message}`,
        url,
        'npm',
        error,
      );
    }
  }
}
```

3. **Add to manager** in `../manager.ts`:

```typescript
import { NpmResolver } from './resolvers/npm.js'

private setupDefaultResolvers(): void {
  // ... existing resolvers
  this.resolvers.set('npm', new NpmResolver(this.config.security, this.config.timeout))
}
```

4. **Export from index** in `../index.ts`:

```typescript
export { NpmResolver, } from './resolvers/npm.js';
```

5. **Add URL type** to `../types.ts` if needed:

```typescript
export type URLType = 'github' | 'gist' | 'npm' | 'http' | 'local';

export interface NpmURLInfo extends URLInfo {
  type: 'npm';
  packageName: string;
  version?: string;
  path?: string;
}
```

6. **Write tests** in `../../../tests/url-resolution.spec.ts`:

```typescript
describe('NpmResolver', () => {
  let resolver: NpmResolver;

  beforeEach(() => {
    resolver = new NpmResolver({}, 5000,);
  },);

  it('should support npm URLs', () => {
    expect(resolver.supports('npm:package-name',),).toBe(true,);
    expect(resolver.supports('https://npmjs.com/package/name',),).toBe(true,);
  });

  it('should resolve npm packages', async () => {
    // Test implementation
  });
});
```

### Best Practices

**Security:**

- Always validate security constraints before fetching
- Enforce HTTPS when `requireHttps` is true
- Check file size limits to prevent memory exhaustion
- Respect domain allowlists and blocklists
- Use timeout for network operations

**Error handling:**

- Use `URLResolutionError` for resolver-specific errors
- Include original error as cause for debugging
- Provide clear, actionable error messages
- Log errors using debug namespace

**Performance:**

- Calculate checksums for integrity verification
- Support streaming downloads for large files
- Minimize memory usage
- Use efficient path operations

**Debugging:**

- Use debug namespace following pattern: `hypergen:v8:resolver:<type>`
- Log important operations (fetch start, cache hit, errors)
- Include relevant context in debug messages

## Dependencies

### External Dependencies

- `fs-extra`: Enhanced filesystem operations (both resolvers)
- `path`: Path manipulation (both resolvers)
- `crypto`: SHA-256 checksum calculation (both resolvers)
- `debug`: Structured logging (both resolvers)
- `https`: HTTP/HTTPS requests (GitHubResolver only)
- `url`: URL parsing (GitHubResolver only)

### Internal Dependencies

- `../types.js`: Type definitions and error classes
  - `TemplateURLResolver` interface
  - `ResolvedTemplate` interface
  - `SecurityConfig` interface
  - `GitHubURLInfo` interface
  - `URLResolutionError` class

### Related Modules

- `../manager.ts`: Orchestrates resolver selection and usage
- `../cache.ts`: Caches resolved templates to minimize network requests
- `../index.ts`: Public API and exports

## Implementation Details

### GitHub URL Parsing

The GitHubResolver supports multiple URL formats by parsing them into a standardized `GitHubURLInfo` structure:

**Shorthand format:**

```
github:owner/repo@version/path/to/template
       ───┬─── ──┬── ──┬── ─────┬────────
          │      │     │        └─ optional path
          │      │     └────────── version/ref
          │      └──────────────── repository
          └─────────────────────── owner
```

**Full GitHub URL:**

```
https://github.com/owner/repo/tree/branch/path/to/template
                   ───┬─── ──┬──      ──┬── ─────┬────────
                      │      │         │        └─ optional path
                      │      │         └────────── branch/ref
                      │      └──────────────────── repository
                      └─────────────────────────── owner
```

**Raw content URL:**

```
https://raw.githubusercontent.com/owner/repo/branch/path/template.yml
                                   ───┬─── ──┬── ──┬── ─────┬────────
                                      │      │     │        └─ file path
                                      │      │     └────────── branch
                                      │      └──────────────── repository
                                      └─────────────────────── owner
```

### Local Path Resolution

The LocalResolver handles various path formats:

1. **File URLs**: `file:///path/to/template` → `/path/to/template`
2. **Absolute paths**: `/path/to/template` → `/path/to/template`
3. **Relative paths with basePath**: `./template` + `/base` → `/base/template`
4. **Relative paths without basePath**: `./template` → `{cwd}/template`

### Template Configuration Discovery

Both resolvers look for template configuration files:

- Primary: `template.yml`
- Fallback: `template.yaml`

The LocalResolver can handle:

- Direct file path: `/path/to/template.yml`
- Directory path: `/path/to/template/` → `/path/to/template/template.yml`

## Error Handling

All resolvers use `URLResolutionError` for consistent error reporting:

```typescript
throw new URLResolutionError(
  'Human-readable error message',
  url, // Original URL
  'github', // URL type
  originalError, // Cause (optional)
);
```

Common error scenarios:

- **Template not found**: Configuration file doesn't exist
- **Network errors**: Timeout, connection refused, DNS failure
- **Security violations**: Blocked domain, file too large, HTTP instead of HTTPS
- **Integrity failures**: Checksum mismatch, corrupted data
- **Parse errors**: Invalid URL format, malformed configuration

## Testing

Tests are located in `/work/hyperdev/packages/hypergen/tests/url-resolution.spec.ts`.

**Test coverage includes:**

- URL format support detection (`supports()` method)
- Local template resolution (relative and absolute paths)
- GitHub URL parsing (shorthand and full formats)
- Error handling (missing templates, network failures)
- Integration with `TemplateURLManager`
- Caching behavior
- Security validation

**Running tests:**

```bash
cd /work/hyperdev/packages/hypergen
bun test url-resolution
```

## Future Enhancements

Planned resolver implementations (see TODOs in `manager.ts`):

- **GistResolver**: Support for GitHub Gists (`gist:username/gist-id`)
- **NpmResolver**: Support for npm packages (`npm:package-name@version`)
- **HttpResolver**: Generic HTTP/HTTPS endpoint support

Additional features:

- Authentication support for private repositories
- Progress reporting for large downloads
- Retry logic with exponential backoff
- Parallel template fetching with connection pooling
- Template signature verification (GPG/PGP)

## Troubleshooting

### Enable debug logging

```bash
DEBUG=hypergen:v8:resolver:* hypergen generate
```

Namespaces:

- `hypergen:v8:resolver:local` - Local resolver operations
- `hypergen:v8:resolver:github` - GitHub resolver operations
- `hypergen:v8:url-manager` - Manager orchestration
- `hypergen:v8:cache` - Cache operations

### Common issues

**"Template configuration not found"**

- Verify the path is correct and template.yml exists
- Check file permissions
- For relative paths, ensure basePath is correct

**"Request timeout"**

- Check network connectivity
- Increase timeout in resolver configuration
- Verify GitHub is accessible from your network

**"Template file too large"**

- Increase `maxFileSize` in security configuration
- Consider splitting large templates into smaller ones

**"Cache integrity check failed"**

- Cache may be corrupted, clear it: `await manager.clearCache()`
- Disable integrity checking if not needed: `integrityCheck: false`

## Related Documentation

- [URL Resolution System Overview](../README.md) - Parent directory documentation
- [Configuration System](../../README.md) - Broader configuration context
- [Template Discovery](../../../discovery/README.md) - Template discovery system
- [Hypergen Configuration](../../hypergen-config.ts) - Main configuration

## Version Information

- **Hypergen Version**: Refer to package.json
- **API Stability**: V8 (experimental, may change)
- **Debug Namespace**: `hypergen:v8:resolver:*`
