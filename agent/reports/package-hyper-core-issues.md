# Package Report: @hypercli/core

**Location**: `packages/core/`

---

## Status Summary

- **Lint**: ❌ FAILED - 310 errors found
- **Tests**: ❌ FAILED - 1 test failure (146 passed, 20 skipped)
- **TypeCheck**: Not explicitly checked

---

## Issue Breakdown

### Biome Lint: 310 Errors

**Files with formatting issues** (will be fixed by formatter):
- `tsconfig.json` - Indentation format
- `biome.json` - Format issues
- `package.json` - Format issues

**Critical lint issues**:

#### 1. Type Strictness - `src/helpers.ts:12`
```typescript
❌ capitalize(str: any): string {
✅ capitalize(str: string): string {
```
**Issue**: Parameter uses `any` type
**Severity**: Medium
**Fix**: Replace `any` with explicit type

#### 2. Node.js Import Protocol - Multiple files
```typescript
❌ import fs from 'fs'
✅ import fs from 'node:fs'
```
**Files affected**:
- `vitest.config.ts:1` - `path`
- `src/config/load-helpers.ts:8-10` - `fs`, `path`, `url`

**Severity**: Low (code works, but not explicit)
**Fix**: Add `node:` prefix

#### 3. Banned Types - `src/config/load-helpers.ts:18,20`
```typescript
❌ Record<string, Function>
✅ Record<string, (...args: unknown[]) => unknown>
```
**Issue**: Function type is too broad
**Severity**: Low
**Fix**: Use explicit function signature

#### 4. Import Organization
**Files**:
- `src/helpers.ts` - `inflection` and `change-case` imports out of order
- `vitest.config.ts` - Imports incorrectly ordered

**Fix**: Reorder imports alphabetically/per Biome rules

#### 5. Quote Style & Semicolons
- Many files use single quotes, need double quotes
- Missing semicolons on export statements
- Inconsistent indentation (spaces vs tabs)

---

## Test Failures

### Failed Test: "should copy fixtures to destination"

**File**: `tests/util/fixtures.spec.ts:90`
**Error**:
```
Error: Setup failed
at Module.withTempFixtures (tests/util/fixtures.ts:97:11)
```

**Analysis**:
- Fixture setup is throwing an error
- The test is using `withTempFixtures` utility
- Line 97 in `fixtures.ts` has an error handler that's throwing

**Potential causes**:
1. Temp directory creation failed
2. Permission issues
3. File system error during setup
4. Async error in fixture setup

**Next steps**:
- Review `tests/util/fixtures.ts` lines 90-100
- Check if directory operations are failing
- Verify permissions on temp directory

---

## Fixed by Formatter (Safe)

```bash
cd packages/core
biome format --write .
```

This will automatically fix:
- ✅ Indentation issues
- ✅ Quote style
- ✅ Semicolons
- ✅ Import ordering

---

## Manual Fixes Required

### 1. Replace `any` with specific type
**File**: `src/helpers.ts:12`
```typescript
// Before
capitalize(str: any): string {

// After
capitalize(str: string): string {
```

### 2. Add `node:` protocol
**Files**:
- `vitest.config.ts:1`
- `src/config/load-helpers.ts:8-10`

```typescript
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
```

### 3. Replace `Function` type
**File**: `src/config/load-helpers.ts:18,20`
```typescript
// Before
helpers: string | Record<string, Function> | undefined
): Promise<Record<string, Function>>

// After
helpers: string | Record<string, (...args: unknown[]) => unknown> | undefined
): Promise<Record<string, (...args: unknown[]) => unknown>>
```

### 4. Debug fixture failure
**File**: `tests/util/fixtures.ts`
- Add logging to line 97 to see what error is being thrown
- Check that temp directories can be created

---

## Recommended Fix Sequence

1. **Auto-fix formatting** (safe, no logic changes)
   ```bash
   biome format --write .
   ```

2. **Fix type strictness** (requires understanding the code)
   - Replace `any` with proper type
   - Replace `Function` with explicit signature

3. **Add node: protocol** (straightforward replacements)
   - Add `node:` to all Node.js imports

4. **Debug fixture test** (requires investigation)
   - Add console logs to understand failure
   - Ensure temp directory can be created
   - Check for async/await issues

---

## Test Statistics

- **Total Tests**: 167
- **Passed**: 146 (87.4%)
- **Failed**: 1 (0.6%)
- **Skipped**: 20 (12%)

**Acceptable state**: Only 1 failing test after fixing formatter and type issues should resolve it.

