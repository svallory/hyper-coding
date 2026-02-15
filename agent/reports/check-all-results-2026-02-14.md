# Code Quality Check Report - 2026-02-14

## Summary

Ran `biome check`, `tsc`, and `bun test` across all projects. **All 5 packages have issues**.

---

## Package Report: @hypercli/core

**Status**: ❌ FAILED - Lint: 310 errors | Tests: 1 failed (146 passed)

### Biome Lint Issues (310 errors)

**Formatter Issues (3 files)**:
- `tsconfig.json` - Indentation format (spaces → tabs)
- `biome.json` - Format issues
- `package.json` - Format issues

**Linting Issues**:
- `src/helpers.ts:12` - `noExplicitAny` - Parameter `str: any` should have explicit type
- `vitest.config.ts:1` - `useNodejsImportProtocol` - Import should use `node:path`
- `src/config/load-helpers.ts:8-10` - `useNodejsImportProtocol` - Multiple Node.js imports missing `node:` protocol
- `src/config/load-helpers.ts` - `noBannedTypes` - Function type should be explicit, not bare `Function`
- `src/helpers.ts` - `organizeImports` - Import order incorrect
- `vitest.config.ts` - `organizeImports` - Import order incorrect

**Quote Style Issues**: Many files using single quotes need double quotes and semicolons

### Test Failures

**File**: `tests/util/fixtures.spec.ts`
- Test: "should copy fixtures to destination"
- Error at `Module.withTempFixtures` - Setup failed
- **Root cause**: An error is being thrown during fixture setup

### Type Checking
- No explicit tsc errors shown, but formatter issues indicate type configuration problems

---

## Package Report: @hypercli/cli

**Status**: ❌ FAILED - Lint: multiple errors | Tests: No test files

### Biome Lint Issues

Similar to @hypercli/core:
- Node.js import protocol missing
- Import organization issues
- Format/indentation problems
- TypeScript type strictness issues

### Tests
- No test files found (`tests/` likely empty or misconfigured)

---

## Package Report: @hypercli/gen (gen)

**Status**: ❌ FAILED - Lint: multiple errors | Tests: 2 failed (114 passed), 48 test files failed to compile

### Biome Lint Issues

Same patterns as other packages:
- Node.js import protocol missing
- Import organization
- Format issues
- Type strictness

### Test Failures

**Summary**: 48 test files failed to compile | 2 test failures | 114 passed

**Primary Issue**: Module resolution/compilation errors in many test files

Example test files showing failures:
- `injector.spec.ts` - Multiple failing injector tests
- Various other spec files with compilation issues

---

## Package Report: @hypercli/kit (kit)

**Status**: ❌ FAILED - Lint: multiple errors | Tests: 1 test file failed, 155 passed

### Biome Lint Issues

Standard issues across all packages

### Test Failures

**File**: `tests/url-resolution.spec.ts`
- Error: Module resolution failure - `ERR_MODULE_NOT_FOUND`
- **Root cause**: Path aliases not resolving (likely Vitest config issue)
- Message: "If you rely on tsconfig.json's 'paths' to resolve modules, please install 'vite-tsconfig-paths' plugin"
- 155 other tests passed

---

## Package Report: @hypercli/cli (cli)

**Status**: ❌ FAILED - Lint: multiple errors | Tests: No test files

### Biome Lint Issues

Same formatting and import protocol issues

### Tests
- No test files found

---

## Common Issues Across All Packages

### 1. **Code Formatting** (Fixable with `biome format --write`)
- Indentation using spaces instead of tabs
- Single quotes instead of double quotes
- Missing semicolons
- Incorrect import order

### 2. **Node.js Import Protocol** (Fixable, ~20-30 instances across packages)
```typescript
// ❌ Current
import fs from 'fs'
import path from 'path'

// ✅ Should be
import fs from 'node:fs'
import path from 'node:path'
```

### 3. **Type Strictness Issues** (Requires manual fixes)
- `any` types need explicit definitions
- Bare `Function` type should be replaced with explicit function signatures

### 4. **Test Infrastructure Issues**
- **core**: Fixture setup errors in tests
- **gen**: 48 test files with compilation errors
- **kit**: Module resolution errors for path aliases
- **cli**: No test files found

### 5. **Module Resolution** (Vitest Configuration)
- `vite-tsconfig-paths` needed but missing or misconfigured
- Path aliases defined in `tsconfig.json` not resolving in Vitest

---

## Recommended Priority Fixes

### High Priority (Blocking tests)
1. **Test compilation errors** in gen (48 files)
2. **Module resolution** in kit (url-resolution test)
3. **Fixture setup** in core

### Medium Priority (Fixable with automation)
1. Run `biome format --write .` in each package
2. Add `node:` protocol to all Node.js imports
3. Update import ordering to biome's expected format

### Low Priority (Type refinement)
1. Replace `any` types with explicit types
2. Replace bare `Function` with specific function signatures

---

## Commands to Fix Issues

### For each package:
```bash
# Format all files
biome format --write .

# Fix linting issues (unsafe fixes)
biome check --fix --unsafe .

# Run tests
bun test
```

### Global issue fixes needed:
1. Configure Vitest path alias resolution in `vitest.config.ts`
2. Ensure `vite-tsconfig-paths` is installed
3. Update TypeScript compiler options for stricter checking

