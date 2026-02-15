# Test Migration Report

## Migration Date
2026-02-14

## Source
`packages/hypergen/tests/` → `packages/hyper-core/tests/`

## Files Migrated (12 total)

### Configuration Tests (4)
1. ✅ `config.test.ts` - HypergenConfigLoader tests
2. ✅ `config/cookbook-parser.test.ts` - Cookbook parsing and discovery tests
3. ✅ `config/kit-parser.test.ts` - Kit parsing and discovery tests
4. ✅ `config/path-resolver.test.ts` - CLI path resolution algorithm tests

### Parser Tests (3)
5. ✅ `template-parser.test.ts` - Template YAML parsing and validation tests
6. ✅ `recipe-step-parser.test.ts` - Recipe step system parsing tests
7. ✅ `example-recipe-parsing.test.ts` - V8 recipe example validation tests

### Utility Tests (2)
8. ✅ `utils/find-project-root.test.ts` - Project root and monorepo detection tests
9. ✅ `util/fixtures.spec.ts` - Fixture helper utilities tests
10. ✅ `util/fixtures.ts` - Fixture helper implementation (copied)

### Error & Dependency Tests (2)
11. ✅ `error-handling.test.ts` - Error system and formatting tests
12. ✅ `versioning-dependencies.test.ts` - Template dependency resolution tests

## Import Path Updates

All test files have been updated with correct import paths for hyper-core:

### Changed Imports
- `from '../src/config/hypergen-config'` → `from '../src/config/config-loader'`
- `from '../src/config/template-parser'` → `from '../src/parsers/template-parser'`
- `from '../src/config/cookbook-parser'` → `from '../src/parsers/cookbook-parser'`
- `from '../src/config/kit-parser'` → `from '../src/parsers/kit-parser'`
- `from '../src/config/path-resolver'` → `from '../src/parsers/path-resolver'`
- `from '../src/config/dependency-manager'` → `from '../src/parsers/dependency-manager'`
- `from '../src/recipe-engine/types'` → `from '../src/types/recipe'`

### Unchanged Imports
- `from '../src/errors/hypergen-errors'` - Already correct
- `from '../../src/utils/find-project-root'` - Already correct

## Directory Structure

```
packages/hyper-core/tests/
├── config/
│   ├── cookbook-parser.test.ts
│   ├── kit-parser.test.ts
│   └── path-resolver.test.ts
├── util/
│   ├── fixtures.spec.ts
│   └── fixtures.ts
├── utils/
│   └── find-project-root.test.ts
├── fixtures/
│   ├── app/
│   ├── templates/
│   └── empty.jig.t
├── config.test.ts
├── error-handling.test.ts
├── example-recipe-parsing.test.ts
├── recipe-step-parser.test.ts
├── template-parser.test.ts
└── versioning-dependencies.test.ts
```

## Test Framework

- Most tests use: `bun:test` (vitest-compatible)
- Some tests use: `vitest` directly
- Both frameworks are compatible via bun's vitest compatibility layer

## Fixtures

Minimal fixture structure created:
- `fixtures/empty.jig.t` - Empty template for testing
- `fixtures/app/` - App fixture directory
- `fixtures/templates/` - Templates fixture directory

Tests create most fixtures dynamically in temp directories, so minimal static fixtures needed.

## Next Steps

1. ✅ Files copied to hyper-core/tests
2. ✅ Import paths updated
3. ✅ Directory structure created
4. ✅ Fixture helpers copied
5. ⏭️ Run tests to verify they pass: `cd packages/hyper-core && bun test`
6. ⏭️ Original files in hypergen/tests can be deleted once tests pass

## Test Coverage

These tests cover core domain functionality:
- **Config System**: Loading, validation, merging, environment-specific config
- **Parsers**: Kit.yml, cookbook.yml, template.yml, recipe.yml parsing
- **Path Resolution**: CLI routing, greedy matching, kit/cookbook/recipe resolution
- **Error Handling**: 83 error codes, formatting, suggestions, context extraction
- **Dependencies**: Template dependencies, versioning, conflict detection
- **Utilities**: Project root detection, monorepo support, fixture helpers
