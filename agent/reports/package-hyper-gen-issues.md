# Package Report: @hypercli/gen (gen)

**Location**: `packages/gen/`

---

## Status Summary

- **Lint**: ❌ FAILED - Multiple formatting and linting errors
- **Tests**: ❌ FAILED - 2 test failures | 48 test files failed to compile | 114 passed
- **TypeCheck**: Not explicitly checked

---

## Critical Issues

### 1. Test Compilation Failures (48 files)

**Severity**: 🔴 HIGH - This blocks 48 test files from even running

**Error Pattern**:
```
Test Files  48 failed | 6 passed | 1 skipped (55)
Tests  2 failed | 114 passed | 3 skipped (119)
```

**Probable Causes**:
1. **Module resolution errors** - Similar to kit issue
2. **Import path problems** - Path aliases not resolving
3. **Missing dependencies** - Required test dependencies not installed
4. **TypeScript compilation errors** - Build errors preventing test execution

**Investigation needed**:
- Run `bun test` with verbose output to see individual compilation errors
- Check `vitest.config.ts` for path alias configuration
- Verify `vite-tsconfig-paths` plugin is installed and configured
- Check that all dependencies listed in imports are available

### 2. Biome Lint Issues

**Same issues as other packages**:
- ❌ Node.js import protocol missing (`import fs from 'fs'`)
- ❌ Quote style inconsistent
- ❌ Import ordering incorrect
- ❌ Formatting/indentation issues

### 3. Test Failures (2 tests)

**From output sample**:
```
injector.spec.ts tests:
- injector after rails 1 ❌
- injector append bottom of file 1 ✅
- injector at_index 2 (below "source") 1 ✅
- injector before rails 1 ❌
- [... more injector tests ...]
```

**Pattern**: Injector-related tests are failing
- Likely related to file injection logic
- May be dependency on formatter fixes first

---

## Specific Files to Review

### Vitest Configuration
**File**: `vitest.config.ts`
- Verify path alias configuration
- Ensure `vite-tsconfig-paths()` plugin is properly configured
- Check that all necessary dependencies are available

### Test Files with Failures
Based on output, focus on:
- `tests/injector.spec.ts` - Multiple injector test failures
- Files with import/module issues

---

## Biome Lint Details

**Similar to core**:
- Node.js imports need `node:` protocol
- Quote consistency (single → double)
- Semicolons on exports
- Import ordering

**Scale**: Likely 200-400+ errors across all files

---

## Recommended Fix Sequence

### Phase 1: Auto-fixable issues
```bash
cd packages/gen

# Auto-fix formatting
biome format --write .

# Auto-fix safe linting issues
biome check --fix --unsafe .
```

### Phase 2: Investigate compilation errors
```bash
# Run tests with verbose output to see actual errors
bun test --reporter=verbose 2>&1 | head -100

# Check specific test file
bun test tests/injector.spec.ts --reporter=verbose
```

### Phase 3: Manual fixes
1. Add `node:` protocol to imports
2. Fix injector test failures (may require logic review)
3. Resolve any remaining module resolution issues

---

## Test Statistics

- **Test Files**: 55 total
  - ✅ 6 passed
  - ❌ 48 failed to compile (HIGH PRIORITY)
  - ⏭️ 1 skipped

- **Individual Tests**: 119 total
  - ✅ 114 passed
  - ❌ 2 failed
  - ⏭️ 3 skipped

---

## Action Items

| Priority | Item                                          | Status      |
| -------- | --------------------------------------------- | ----------- |
| 🔴 HIGH   | Investigate 48 test file compilation failures | Not started |
| 🟠 MEDIUM | Fix biome formatting and linting              | Not started |
| 🟠 MEDIUM | Debug injector test failures                  | Not started |
| 🟡 LOW    | Add `node:` protocol to imports               | Not started |

---

## Notes

The 48 test file compilation failures are the critical blocker. Once those are resolved, the package should be in much better shape. The 2 remaining test failures are likely related to injector logic or may be resolved by addressing the compilation issues first.

