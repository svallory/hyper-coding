# Fix Hanging Test: interactive-parameter-resolution.test.ts

**Date:** 2026-02-16
**Issue:** Test file hanging indefinitely
**Status:** ✅ Fixed

---

## Root Cause Analysis

The test file `/work/hyper/packages/gen/tests/interactive-parameter-resolution.test.ts` was hanging because it called `resolveParametersInteractively()` which prompts for user input using `@clack/prompts`, but the prompts were not mocked.

### Evidence

1. **Location of failure:** Lines 132-148 in `parameter-resolver.ts`
   - When required parameters are missing and `NODE_ENV !== "test"`, the code creates an `InteractivePrompter` instance
   - Calls `prompter.promptForParameters()` which uses `@clack/prompts` for actual terminal prompts
   - This causes the test to wait for user input, hanging indefinitely

2. **Partial mitigation existed:**
   - The implementation had `NODE_ENV === "test"` checks (lines 140, 188)
   - Some tests properly set `NODE_ENV=test` (lines 397-411)
   - But most test cases didn't set this variable, triggering the interactive prompt code path

3. **Why it wasn't caught earlier:**
   - Tests that provided all required parameters didn't trigger prompts
   - Tests that set `NODE_ENV=test` worked correctly
   - Only tests with missing required parameters AND no `NODE_ENV=test` hung

### Contributing Factors

- The test file didn't mock the `InteractivePrompter` class
- No global test setup to prevent interactive prompts
- The `NODE_ENV` check was a safety mechanism but not consistently used

---

## Specific Solution

Added mocking for `InteractivePrompter` at the top of the test file:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionParameterResolver } from "#actions/parameter-resolver";
import type { ActionMetadata } from "#actions/types";

// Mock InteractivePrompter to prevent actual prompts during tests
vi.mock("#prompts/interactive-prompts", () => ({
	InteractivePrompter: vi.fn().mockImplementation(() => ({
		promptForParameters: vi.fn().mockResolvedValue({
			completed: true,
			cancelled: false,
			values: {},
			errors: [],
		}),
	})),
	performInteractivePrompting: vi.fn().mockResolvedValue({}),
}));
```

### Why This Fix Works

1. **Prevents real prompts:** Mock implementation returns immediately without waiting for user input
2. **Maintains test behavior:** Tests still verify the logic flow and parameter resolution
3. **Follows existing patterns:** Uses the same mocking approach as `/work/hyper/packages/gen/tests/recipe-engine/variable-resolution.test.ts`
4. **No changes needed to production code:** The fix is purely in the test setup

---

## Testing Strategy

### Verification Steps

1. ✅ Run the fixed test file multiple times to ensure stability
2. ✅ Verify related test file (`parameter-resolver-prompts.test.ts`) still works
3. ✅ Confirm tests complete quickly (44-61ms vs. hanging indefinitely)

### Test Results

```bash
# First run
bun test packages/gen/tests/interactive-parameter-resolution.test.ts --run
✓ 14 pass, 0 fail, 24 expect() calls [61.00ms]

# Second run
✓ 14 pass, 0 fail, 24 expect() calls [44.00ms]

# Third run
✓ 14 pass, 0 fail, 24 expect() calls [44.00ms]

# Related test
bun test packages/gen/tests/parameter-resolver-prompts.test.ts --run
✓ 9 pass, 0 fail, 20 expect() calls [43.00ms]
```

### Edge Cases Validated

- ✅ Tests with all parameters provided
- ✅ Tests with missing required parameters (now throws error instead of prompting)
- ✅ Tests with `useDefaults` flag
- ✅ Tests with `skipOptional` flag
- ✅ Tests with validation errors

---

## Prevention Recommendations

### Immediate Actions

1. ✅ **Fixed:** Mock `InteractivePrompter` in this test file

### Long-term Improvements

1. **Global test setup:** Add a vitest setup file that mocks interactive prompts by default
   - Create `packages/gen/tests/setup.ts`
   - Configure in `vitest.config.ts`
   - Mock `@clack/prompts` globally for all tests

2. **Test naming convention:** Add `*.interactive.test.ts` for tests that intentionally need prompts
   - Use separate vitest config to allow prompts only in these files
   - Makes intent clear and prevents accidental hangs

3. **Documentation:** Update test writing guidelines
   - Document the mocking pattern for interactive prompts
   - Add to `packages/gen/CLAUDE.md`

4. **Timeout configuration:** Add global test timeout in `vitest.config.ts`
   - Set reasonable timeout (e.g., 10 seconds) to catch hanging tests early
   - Currently tests can hang indefinitely

5. **CI/CD enhancement:** Add timeout to test commands in CI
   - Ensures hanging tests fail fast in CI
   - Prevents wasted compute resources

---

## Files Modified

- `/work/hyper/packages/gen/tests/interactive-parameter-resolution.test.ts` - Added mock for InteractivePrompter

---

## Debugging Process

1. ✅ Read and analyzed the hanging test file
2. ✅ Searched for prompt-related files and imports
3. ✅ Examined the `ActionParameterResolver` implementation
4. ✅ Found the `InteractivePrompter` usage that caused hanging
5. ✅ Identified existing mocking patterns in other tests
6. ✅ Applied the same pattern to fix the issue
7. ✅ Verified the fix with multiple test runs

**Time to fix:** < 5 minutes after understanding the root cause
