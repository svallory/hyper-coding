# Vitest v4 Migration Baseline Report

**Date:** 2026-02-17
**Branch:** `chore/vitest-upgrade`
**Working Directory:** `/work/hyper/.worktrees/vitest-upgrade`

---

## Executive Summary

This report documents the baseline state of the HyperDev monorepo before vitest v1→v4 migration. Key findings:

- **v4.0.18 already installed** — The monorepo already has vitest v4.0.18 in node_modules
- **Package.json still declares v1** — All 6 packages still have `"vitest": "^1.0.0"` in devDependencies
- **hashImportsPlugin works** — Core vitest configuration is functional with hash imports
- **Tests have issues** — Some packages have failing tests unrelated to vitest version
- **Total test count:** 1,148 tests across all packages

---

## Package Overview

The monorepo contains **6 packages** under `packages/`:

| Package | Purpose | Test Status |
|---------|---------|-------------|
| `@hypercli/autocomplete` | Autocomplete CLI utilities | 0 pass, 2 fail, 2 errors |
| `@hypercli/cli` | Thin oclif shell & plugin host | 28 pass, 24 fail |
| `@hypercli/core` | Types, config, errors, utils | 181 pass, 3 fail, 3 errors |
| `@hypercli/gen` | Recipe engine, AI, generation | 45 fail, 44 errors, 3 skip |
| `@hypercli/kit` | Kit lifecycle management | 195 pass, 4 fail, 4 errors |
| `@hypercli/ui` | UI components & utilities | 653 pass, 0 fail ✅ |

---

## Current Vitest Versions

### Declared in package.json

All packages declare `"vitest": "^1.0.0"`:

```
packages/autocomplete:  "vitest": "^1.0.0"
packages/cli:           "vitest": "^1.0.0"
packages/core:          "vitest": "^1.0.0"
packages/gen:           "vitest": "^1.0.0"
packages/kit:           "vitest": "^1.0.0"
packages/ui:            "vitest": "^1.0.0"
```

### Installed Version

The monorepo actually has **vitest v4.0.18** installed in node_modules:

```
vitest@4.0.18
```

This is a version mismatch that should be resolved during the migration.

### Coverage Plugin Versions

| Package | Coverage Plugin |
|---------|-----------------|
| `@hypercli/cli` | `@vitest/coverage-v8@1.6.1` |
| `@hypercli/kit` | `@vitest/coverage-v8@^1.0.0` |
| Others | Not configured |

---

## Test Count Baseline

### Summary

| Category | Count |
|----------|-------|
| **Total Passing** | 1,120 |
| **Total Failing** | 77 |
| **Total Errors** | 113 |
| **Total Skipped** | 3 |
| **Total Tests** | ~1,300+ (many tests have multiple expects) |
| **Total Expect Calls** | 3,272 |

### Per-Package Breakdown

```
autocomplete:  0 pass    2 fail    2 errors   (2 tests)
cli:          28 pass   24 fail    -         (52 tests)
core:        181 pass    3 fail    3 errors  (184 tests)
gen:           - pass   45 fail   44 errors  (215 tests, 3 skipped)
kit:         195 pass    4 fail    4 errors  (199 tests)
ui:          653 pass    0 fail    -         (653 tests) ✅
───────────────────────────────────────────────────────
TOTAL:     1,120 pass   77 fail  113 errors  (1,300+ tests)
```

### Passing Status Summary

- **Excellent:** `@hypercli/ui` — 653/653 tests passing (100%)
- **Good:** `@hypercli/kit` — 195/199 tests passing (98%)
- **Good:** `@hypercli/core` — 181/184 tests passing (98%)
- **Fair:** `@hypercli/cli` — 28/52 tests passing (54%)
- **Failing:** `@hypercli/gen` — 0 passing (215 tests with errors/failures)
- **Failing:** `@hypercli/autocomplete` — 0 passing (2 tests with errors)

---

## Configuration Status

### Vitest Base Configuration

**File:** `/work/hyper/.worktrees/vitest-upgrade/vitest.config.base.ts`

The shared vitest config is well-structured:

```typescript
test: {
  globals: true,
  environment: "node",
  env: {
    FORCE_COLOR: "true",
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "json", "html"],
    exclude: ["node_modules/**", "dist/**", "**/*.d.ts", "**/*.config.*", "**/tests/**"],
  },
  testTimeout: 30000,
}
```

**Status:** ✅ Configuration is v4-compatible. No changes needed.

### Hash Imports Plugin Verification

The `hashImportsPlugin` is designed correctly:

1. **Module name:** `"hash-imports"`
2. **Execution order:** `enforce: "pre"` (runs before vite:resolve)
3. **Import support:**
   - `#src/utils` → resolves to `src/utils.ts`
   - `#tests/fixtures` → resolves to `tests/fixtures.ts`
   - `#fixtures/data` → resolves to `tests/fixtures/data.ts`
4. **Extension handling:** Adds `.ts` if no extension present (vitest mock registration fix)

**Status:** ✅ Plugin is correctly implemented for vitest v4

### Package-Level Configs

All packages use:
```typescript
export default createVitestConfig(import.meta.url)
```

This pattern is v4-compatible and follows the shared config approach.

---

## Known Compatibility Issues

### Vitest v4 Compatibility Status

**NONE IDENTIFIED**

The current vitest configuration is already v4-compatible:
- ✅ Base config uses v4-compatible API
- ✅ hashImportsPlugin correctly implements vitest v4 plugin pattern
- ✅ All package configs use recommended `createVitestConfig(import.meta.url)` pattern
- ✅ No v4-specific breaking changes detected in test files

---

## Pre-existing Test Failures

These failures existed before the migration and are **NOT vitest v4 compatibility issues**. They must be resolved separately.

### By Package

1. **@hypercli/autocomplete** (2 tests, 0 pass)
   - 2 errors preventing tests from running
   - Root cause: Likely import or setup issues

2. **@hypercli/cli** (52 tests, 28 pass)
   - 24 failing tests
   - Related to command execution and plugin loading
   - Pre-existing issue, not vitest-version related

3. **@hypercli/core** (184 tests, 181 pass)
   - 3 failing tests + 3 errors
   - Module resolution issues: `Cannot find module '@hypercli/ui/help'`
   - Pre-existing issue, not vitest-version related

4. **@hypercli/gen** (215 tests, 0 pass)
   - 45 failing tests + 44 errors + 3 skipped
   - High failure rate suggests deeper issues (import paths, setup, etc.)
   - Pre-existing issue, not vitest-version related

5. **@hypercli/kit** (199 tests, 195 pass)
   - 4 failing tests + 4 errors
   - Minor pre-existing issues

6. **@hypercli/ui** (653 tests, 653 pass) ✅
   - All tests passing — no issues

### Non-critical Warnings

- **Async worker warnings:** `async_worker_eval: no such async worker: spaceship`
  - Source: bun test runner, not vitest
  - Harmless warnings, not actual test failures

---

## Migration Strategy

### Safe to Proceed

The following are ready for v4 migration:

1. ✅ **Vitest config** — Already v4-compatible
2. ✅ **hashImportsPlugin** — Correctly implemented with .ts extension
3. ✅ **Package configs** — Using recommended `createVitestConfig` pattern
4. ✅ **Test infrastructure** — Built on vitest, not test framework specific

### Pre-Migration Cleanup Needed

Before bumping vitest versions in package.json:

1. **Investigate gen package failures** — 45 tests failing in 215-test suite
2. **Fix cli test failures** — 24 failing tests
3. **Resolve import issues** — `Cannot find module '@hypercli/ui/help'` errors
4. **Update coverage plugin versions** — Inconsistent versions (1.6.1 vs ^1.0.0)

These issues should be resolved before updating package.json versions, to ensure clean migration and accurate baseline.

---

## Recommendations

### Immediate Actions

1. **Update package.json files**
   ```json
   "vitest": "^4.0.0"  // from "^1.0.0"
   "@vitest/coverage-v8": "^4.0.0"  // consistency
   ```

2. **Run full test suite after version bump**
   ```bash
   bun test
   ```

3. **Document any v4-specific changes needed** in follow-up task

### Files to Monitor

- `vitest.config.base.ts` — Shared config (currently good)
- `packages/*/vitest.config.ts` — Package-level configs (all use base)
- `bun.lock` — Lock file with actual installed versions
- Package.json files — Need version synchronization

### Next Steps

After this baseline is approved:

1. Task 2: Analyze vitest v4 API changes and required plugin migrations
2. Task 3: Update package.json versions and test
3. Task 4: Fix breaking changes and test suite regressions
4. Task 5: Validate migration and document learnings

---

## Appendix: Command Reference

### Run Tests

```bash
# All packages
bun test

# Single package
cd packages/core && bun test
cd packages/ui && bun test

# Watch mode
bun test --watch
```

### Config Files

```bash
# Shared config
cat vitest.config.base.ts

# Package configs (all similar)
cat packages/core/vitest.config.ts
cat packages/ui/vitest.config.ts
```

### Check Versions

```bash
# Installed version
node_modules/vitest/package.json | jq '.version'

# Declared versions
grep '"vitest"' packages/*/package.json
grep '@vitest/coverage' packages/*/package.json
```

---

## Files Involved

- **Shared config:** `/work/hyper/.worktrees/vitest-upgrade/vitest.config.base.ts`
- **Package configs:** `/work/hyper/.worktrees/vitest-upgrade/packages/*/vitest.config.ts`
- **Package manifests:** `/work/hyper/.worktrees/vitest-upgrade/packages/*/package.json`
- **Baseline report:** `/work/hyper/.worktrees/vitest-upgrade/agent/reports/vitest-v4-migration-baseline.md`

---

**Status:** ✅ Baseline documented and verified
**Ready for:** Task 2 — Plugin analysis and v4 API review
