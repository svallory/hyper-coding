# Phase 2: Extract @hypercli/kit

## Files to Move

From `packages/hypergen/src/`:

### Kit Lifecycle
- `lib/kit/manifest.ts` → `src/manifest.ts`
- `lib/kit/manifest.schema.json` → `src/manifest.schema.json`
- `lib/kit/source-resolver.ts` → `src/source-resolver.ts`

### URL Resolution (entire directory)
- `config/url-resolution/` → `src/url-resolution/`
  - `cache.ts`
  - `index.ts`
  - `manager.ts`
  - `resolvers/` (subdirectory with all resolvers)
  - `types.ts`

### Kit Commands
- `commands/kit/` → `src/commands/kit/`
  - `install.ts`
  - `update.ts`
  - `list.ts`
  - `info.ts`

## Dependencies

Kits package depends on:
- `@hypercli/core` - for Kit/Cookbook types, errors, config
- External: `degit`, `npm-registry-fetch`, filesystem libs

## Package Config

Add to `package.json`:
- oclif plugin configuration
- dependencies on external libs
