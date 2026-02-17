# Test Fix: ActionUtils glob pattern test

**Date:** 2026-02-16
**Issue:** Test failure in `packages/gen/tests/actions.spec.ts` - "should handle glob patterns"
**Status:** Fixed

## Problem

The test was failing with:
```
AssertionError: expected 0 to be greater than 0
```

The glob pattern `*.spec.ts` with `cwd: "./tests"` was returning 0 files.

## Root Cause

The test used a relative path `./tests` for the `cwd` option, which caused different behavior depending on where the test runner was invoked:

- **From package directory** (`/work/hyper/packages/gen`): `./tests` resolved to `/work/hyper/packages/gen/tests` ✓
- **From monorepo root** (`/work/hyper`): `./tests` resolved to `/work/hyper/tests` ✗ (doesn't exist)

Build systems like Moon often run tests from the monorepo root, causing the failure.

## Solution

Changed the test to use an absolute path constructed from `__dirname`:

```typescript
const testDir = path.join(__dirname, "../tests");
const files = utils.globFiles("*.spec.ts", { cwd: testDir });
```

This ensures the path is always relative to the test file's location, not the process working directory.

## Files Changed

- `/work/hyper/packages/gen/tests/actions.spec.ts`
  - Added `import path from "node:path"`
  - Changed relative path to absolute path using `__dirname`

## Verification

Test now passes from both locations:
- ✓ From monorepo root: `cd /work/hyper && bun test packages/gen/tests/actions.spec.ts`
- ✓ From package directory: `bun test tests/actions.spec.ts`

All 25 tests in the file pass successfully.
