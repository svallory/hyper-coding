# Test Suite Improvement Roadmap

**Date:** 2026-02-09
**Source:** Comprehensive test audit (12 parallel agents)
**Current Health:** 68/100 (GOOD but needs work)

---

## Overview

This document provides a complete task breakdown for improving the Hypergen test suite based on the comprehensive audit. Tasks are prioritized into 3 phases with estimated effort and expected outcomes.

**Note:** Many tests may be failing because hypergen is under active development. That's expected and OK. This roadmap focuses on improving test quality, removing dead code, and ensuring tests actually validate behavior.

---

# Phase 0: Immediate Cleanup (P0)
**Goal:** Remove blocking issues and dead code
**Timeline:** This week (1-2 days)
**Effort:** 4-6 hours
**Priority:** CRITICAL - These files block CI and add no value

## P0.1: Delete Completely Broken Test Files

### Task: Delete `tests/cli-flags.test.ts`
**Why:** Tests non-existent module `../src/cli/cli`
**Issue:**
- Imports `HypergenCLI` class that doesn't exist
- References methods `parseFlags()` and `parseParameters()` that don't exist
- 240 lines of dead code
- Tests were written for a CLI architecture that was never implemented

**Steps:**
```bash
git rm tests/cli-flags.test.ts
git commit -m "test: remove cli-flags.test.ts - tests non-existent module"
```

**Validation:** Test suite should run without import errors

---

### Task: Delete `tests/v8-integration.test.ts`
**Why:** Spawns non-existent `bin.ts` file via shell commands
**Issue:**
- Tries to execute `hypergen` CLI by spawning subprocess to `bin.ts`
- All CLI execution tests fail with "Module not found"
- Depends on non-existent `templates/my-test-generator/` fixtures
- 339 lines of non-functional E2E tests
- Uses brittle string-matching for CLI output

**Steps:**
```bash
git rm tests/v8-integration.test.ts
git commit -m "test: remove v8-integration.test.ts - non-functional subprocess tests"
```

**Note:** The recipe step system tests (lines 222-338) that DO work should be moved to a dedicated unit test file first, if valuable.

**Validation:** Test suite should run without spawn errors

---

### Task: Delete `tests/config.spec.ts`
**Why:** Tests deprecated `reversePathsToWalk` utility
**Issue:**
- Only 3 tests for low-level path manipulation
- Functionality is superseded by `HypergenConfigLoader` in `config.test.ts`
- Platform-specific test that may not execute on all systems
- Redundant with comprehensive config tests in `config.test.ts`

**Steps:**
```bash
git rm tests/config.spec.ts
git commit -m "test: remove config.spec.ts - deprecated utility tests"
```

**Validation:** Ensure `config.test.ts` covers config loading comprehensively

---

### Task: Delete `tests/template-composition.test.ts`
**Why:** Tests mock implementations, not actual code
**Issue:**
- Tests MOCK the composition engine instead of testing it
- File comments admit tests will fail: "this will fail" (lines 82-83, 186)
- Tests validate expected behavior, not actual behavior
- 316 lines of false confidence tests
- Uses Bun test runner (inconsistent with project)

**Steps:**
```bash
git rm tests/template-composition.test.ts
git commit -m "test: remove template-composition.test.ts - tests mocks not reality"
```

**Note:** If composition functionality is critical, write integration tests with real files instead.

**Validation:** Test suite should run without mock-based false positives

---

### Expected Impact of P0
```
Files removed:        4
Dead code removed:    ~1,150 LOC
Broken tests removed: ~40 test cases
CI reliability:       Improved (no more import/spawn errors)
Maintenance burden:   Reduced
```

---

## P0.2: Fix Critical Import Errors

### Task: Fix `tests/v8-integration.spec.ts` import error
**File:** `tests/v8-integration.spec.ts` (111 lines)
**Issue:** Imports `runner` from `../src/index.js` but export doesn't exist

**Current Code (line 5):**
```typescript
import { runner } from '../src/index.js'
```

**Investigation Needed:**
1. Check what `src/index.ts` actually exports
2. Determine if `runner` should be imported from `src/engine.ts` or elsewhere
3. Determine if these tests are valuable enough to fix

**Option A: Fix Import**
If `runner` exists in another module:
```typescript
import { runner } from '../src/engine.js'  // or wherever it actually is
```

**Option B: Remove File**
If `runner` doesn't exist or tests aren't valuable:
```bash
git rm tests/v8-integration.spec.ts
git commit -m "test: remove v8-integration.spec.ts - broken imports, superficial tests"
```

**Recommendation:** Inspect the file first. If tests only check "does this not crash?" without validating behavior, remove it.

**Validation:** File either imports correctly or is removed

---

## P0.3: Standardize Test Framework

### Task: Convert Vitest files to bun:test
**Why:** Project uses Bun test runner, but some files use Vitest
**Issue:** Inconsistent test infrastructure makes maintenance harder

**Files to Convert:**
1. `tests/template-engines.spec.ts`
2. `tests/suites/template-engines/ai-tags-state-access.test.ts`
3. `tests/url-resolution.spec.ts` (if keeping it)
4. `tests/v8-config.spec.ts`

**For Each File:**

**Before:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
```

**After:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
```

**Steps:**
```bash
# For each file:
# 1. Change import from 'vitest' to 'bun:test'
# 2. Test that file still runs: bun test path/to/file.test.ts
# 3. Commit

git commit -m "test: standardize on bun:test framework"
```

**Validation:** All test files use consistent test runner

---

# Phase 1: Fix Critical Gaps (P1)
**Goal:** Fix failing tests and strengthen high-value tests
**Timeline:** Week 2 (5 days)
**Effort:** 16-24 hours
**Priority:** HIGH - Core functionality needs working tests

## P1.1: Fix AI Collection System Tests

### Task: Fix `tests/suites/recipe-engine/template-tool-collector.test.ts`
**Status:** FAILING (acknowledged in codebase)
**Issue:** Tests for AI collection system are currently broken

**Investigation Steps:**
1. Run the test file to see actual errors
2. Check if `__hypergenCollectMode` is being passed correctly
3. Verify Jig initialization with `@ai` tags
4. Ensure test templates exist on disk

**Known Issues (from audit):**
- Line 104: Assertion expects `collectMode` in context
- Tests require proper Jig initialization
- May need actual template files on disk
- Spy approach is correct but assertions may be too strict

**Fix Approach:**
```typescript
// Ensure collectMode is properly initialized
beforeEach(() => {
  const collector = AiCollector.getInstance()
  collector.clear()
  collector.collectMode = true
})

// Verify context has required fields
const expectedContext = {
  ...baseContext,
  __hypergenCollectMode: true,
  __hypergenAiCollect: expect.any(Function),
  // ... other required fields
}
```

**Steps:**
1. Run test to identify exact failure
2. Review how collectMode is passed in working tests (e.g., `two-pass-integration.test.ts`)
3. Apply same pattern to template-tool-collector
4. Ensure spies are set up before template rendering
5. Test with real `.jig` template files

**Validation:** All tests in template-tool-collector.test.ts pass

---

### Task: Fix AI collection in E2E tests
**Files:**
- `tests/suites/ai/e2e-recipe-with-helpers.test.ts`
- `tests/suites/ai/e2e-edit-page-recipe.test.ts`

**Issues:**
- Tests may fail if Go parser isn't available
- Hard-coded paths to sandbox/go
- Depends on external Go binary

**Fix for Missing Go Parser:**
```typescript
// Check if Go environment available
const hasGo = existsSync('/usr/local/go/bin/go')

if (!hasGo) {
  // Mock the listModelFields helper
  vi.mock('./helpers', () => ({
    listModelFields: vi.fn(() => ['id: uuid', 'name: string', 'created_at: time.Time']),
    listModelRelations: vi.fn(() => [])
  }))
}
```

**Fix for Hard-coded Paths:**
```typescript
// Before:
const recipeDir = 'sandbox/go/.hypergen/cookbooks/crud/edit-page'

// After:
const recipeDir = path.join(__dirname, '../../fixtures/recipes/crud/edit-page')
```

**Steps:**
1. Create fixtures directory: `tests/fixtures/recipes/crud/edit-page/`
2. Copy recipe.yml and templates from sandbox
3. Mock Go parser or make it optional
4. Update path resolution to use fixtures
5. Test both with and without Go available

**Validation:** Tests pass regardless of Go environment

---

## P1.2: Strengthen High-Value Tests

### Task: Add execution path tests to `ai-tool.test.ts`
**File:** `tests/suites/ai/ai-tool.test.ts`
**Current:** Only tests validation (parameter checks)
**Missing:** Actual tool execution and output handling

**What to Add:**
```typescript
describe('AiTool execution', () => {
  it('should execute and write output to variable', async () => {
    const step = {
      name: 'generate-code',
      tool: 'ai',
      prompt: 'Write a hello world function',
      output: {
        key: 'code',
        type: 'variable' as const
      }
    }

    const context = createMockContext({
      answers: { code: 'function hello() { return "world"; }' }
    })

    const result = await tool.execute(step, context)

    expect(result.success).toBe(true)
    expect(context.variables.code).toBe('function hello() { return "world"; }')
  })

  it('should execute and write output to file', async () => {
    // Test file output type
  })

  it('should execute and inject into existing file', async () => {
    // Test inject output type
  })

  it('should handle API errors gracefully', async () => {
    // Mock API failure
  })

  it('should retry with feedback on validation failure', async () => {
    // Test retry-with-feedback feature
  })
})
```

**Steps:**
1. Review `src/recipe-engine/tools/ai-tool.ts` to understand execution
2. Create proper mock context with answers
3. Add tests for all output types (variable, file, inject, stdout)
4. Add error handling tests
5. Add retry logic tests

**Validation:** ai-tool.test.ts covers both validation AND execution

---

### Task: Fix hook verification in action tests
**Files:**
- `tests/action-pipelines.test.ts`
- `tests/lifecycle-management.test.ts`
- `tests/v8-integration/action-tool.test.ts`

**Issue:** Tests claim to verify hooks run but don't actually capture/verify results

**Current Problem (line 372-391 in action-pipelines.test.ts):**
```typescript
it('should execute pipeline hooks at appropriate times', async () => {
  // ... setup pipeline with hooks ...
  const result = await executor.executePipeline('deploy-pipeline')
  expect(result.success).toBe(true)  // Only checks completion, not hook execution!
})
```

**Fix:**
```typescript
it('should execute pipeline hooks at appropriate times', async () => {
  const hookCalls: string[] = []

  const pipeline = {
    id: 'test-pipeline',
    steps: [
      { id: 'step1', action: 'build', onPre: () => { hookCalls.push('pre-build') } },
      { id: 'step2', action: 'test', onPost: () => { hookCalls.push('post-test') } },
    ]
  }

  await executor.executePipeline(pipeline)

  expect(hookCalls).toEqual(['pre-build', 'post-test'])  // Verify hooks actually ran!
})
```

**Steps:**
1. Add hook tracking to test setup
2. Use arrays or counters to capture hook execution
3. Verify hooks ran in correct order
4. Verify hook results are passed to next step
5. Test error hooks actually run on failures

**Validation:** Hook tests verify hooks ACTUALLY execute, not just that pipeline completes

---

### Task: Add realistic action latencies to pipeline tests
**File:** `tests/action-pipelines.test.ts`
**Issue:** Mock actions use fixed 10ms duration, timeout tests can't work

**Current Mock Actions:**
```typescript
const mockAction = {
  execute: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 10))  // Too fast!
    return { success: true }
  })
}
```

**Better Approach:**
```typescript
function createMockAction(name: string, duration: number) {
  return {
    name,
    execute: vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, duration))
      return { success: true, data: { actionName: name } }
    })
  }
}

// Now tests can use realistic durations
const slowAction = createMockAction('build', 2000)  // 2 seconds
const fastAction = createMockAction('lint', 100)    // 100ms
```

**Fix Timeout Test (lines 504-525):**
```typescript
it('should timeout if action exceeds timeout', async () => {
  const slowAction = createMockAction('slow-build', 5000)  // 5 seconds

  const pipeline = {
    steps: [{ action: 'slow-build', timeout: 1000 }]  // 1 second timeout
  }

  await expect(executor.executePipeline(pipeline))
    .rejects.toThrow(/timeout/i)
})
```

**Steps:**
1. Create configurable mock action factory
2. Update all pipeline tests to use factory
3. Fix timeout test with proper durations
4. Test parallel execution timing
5. Add performance baseline tests

**Validation:** Timeout tests actually validate timeout behavior

---

### Task: Extract large fixtures from E2E tests
**File:** `tests/suites/ai/e2e-edit-page-recipe.test.ts`
**Issue:** 587 lines of template fixtures embedded in test file

**Current Structure:**
```
tests/suites/ai/e2e-edit-page-recipe.test.ts
├─ Lines 1-14:    Imports and setup
├─ Lines 15-587:  Inline template fixtures (!!!)
└─ Lines 588-end: Actual tests
```

**Better Structure:**
```
tests/fixtures/recipes/
├─ crud/
│  └─ edit-page/
│     ├─ recipe.yml
│     ├─ templates/
│     │  ├─ handler.go.jig
│     │  ├─ edit_page.templ.jig
│     │  └─ routes_inject.go.jig
│     └─ helpers/
│        └─ mock_helpers.ts
└─ README.md (explains fixture structure)
```

**Steps:**
1. Create `tests/fixtures/recipes/crud/edit-page/` directory
2. Extract templates to individual `.jig` files
3. Create fixture helper to load recipes
4. Update test to load from fixtures
5. Document fixture structure

**Example:**
```typescript
// tests/helpers/fixture-loader.ts
export function loadRecipeFixture(name: string) {
  const fixturePath = path.join(__dirname, '../fixtures/recipes', name)
  const recipePath = path.join(fixturePath, 'recipe.yml')
  return { recipePath, fixturePath }
}

// In test:
const { recipePath } = loadRecipeFixture('crud/edit-page')
const result = await engine.executeRecipe(recipePath, options)
```

**Validation:** Test file is < 200 lines, fixtures are reusable

---

## P1.3: Fix Test Assertion Issues

### Task: Fix undefined variable handling in E2E tests
**File:** `tests/suites/ai/e2e-edit-page-recipe.test.ts`
**Issue:** Line 516-560 expects error but Edge.js renders undefined as `"undefined"` string

**Current Test:**
```typescript
it('should fail if helper is missing', async () => {
  await expect(engine.executeRecipe(recipe, options))
    .rejects.toThrow()  // This may not work!
})
```

**Issue:** Edge.js doesn't throw on undefined variables, it renders them as the string `"undefined"`

**Fix Option A - Check for "undefined" in output:**
```typescript
it('should detect undefined helpers in output', async () => {
  const result = await engine.executeRecipe(recipe, options)

  // Check if output contains "undefined" string
  const outputFile = path.join(options.workingDir, 'handlers/organization-edit.go')
  const content = readFileSync(outputFile, 'utf8')

  expect(content).not.toContain('undefined')
})
```

**Fix Option B - Mock renderer to throw:**
```typescript
it('should fail if helper is missing', async () => {
  // Mock Jig renderer to throw on undefined
  vi.mock('jig-engine', () => ({
    renderTemplate: vi.fn(() => {
      throw new Error('Undefined variable: listModelFields')
    })
  }))

  await expect(engine.executeRecipe(recipe, options))
    .rejects.toThrow(/Undefined variable/)
})
```

**Recommendation:** Use Option A (check for "undefined" string) as it tests actual behavior

**Steps:**
1. Identify all tests expecting errors for undefined variables
2. Change assertions to check for "undefined" in output
3. Add helper function: `expectNoUndefinedInOutput(filePath)`
4. Test both missing helpers and missing variables

**Validation:** Tests correctly validate Edge.js behavior

---

### Task: Fix prompt assertion in `e2e-recipe-with-helpers.test.ts`
**File:** `tests/suites/ai/e2e-recipe-with-helpers.test.ts`
**Issue:** Line 141 expects `'User model'` but template renders as `'User'`

**Current Test:**
```typescript
expect(prompt).toContain('User model')  // Will fail!
```

**Template Has:**
```jig
Model: {{ model }}
```

**With `model = 'User'`, this renders as:**
```
Model: User
```

**Not:**
```
Model: User model
```

**Fix:**
```typescript
// Option A: Fix expectation
expect(prompt).toContain('Model: User')

// Option B: Fix template to include "model"
// In template: Model: {{ model }} model
```

**Steps:**
1. Run test to see actual prompt output
2. Determine intended behavior
3. Fix either assertion or template
4. Add more specific assertions

**Validation:** Test assertions match actual output

---

# Phase 2: Polish and Maintainability (P2)
**Goal:** Remove boilerplate, improve maintainability
**Timeline:** Weeks 3-4 (10 days)
**Effort:** 20-30 hours
**Priority:** MEDIUM - Quality of life improvements

## P2.1: Remove Boilerplate Tests

### Task: Remove factory instantiation tests
**Issue:** 20+ test files have trivial factory tests

**Pattern to Remove:**
```typescript
describe('Factory', () => {
  it('should create instance', () => {
    const factory = new SomeFactory()
    expect(factory).toBeDefined()
  })

  it('should have create method', () => {
    expect(typeof factory.create).toBe('function')
  })
})
```

**Files with Factory Boilerplate:**
1. `tests/recipe-engine/tools/template-tool.test.ts` (lines 236-306)
2. `tests/v8-recipe-tool-integration.test.ts` (lines 80-112)
3. `tests/v8-integration/action-tool.test.ts` (lines 536-571)
4. And ~15 more files with similar patterns

**Steps:**
1. Search for `describe('Factory'` or `describe('.*Factory')`
2. For each file, remove factory instantiation tests
3. Keep only factory tests that verify complex behavior
4. Commit in batches by category

```bash
# Example:
git add tests/recipe-engine/tools/template-tool.test.ts
git commit -m "test: remove factory boilerplate from template-tool tests"
```

**Expected Removal:** ~200-300 LOC across all files

**Validation:** No factory tests that just check `toBeDefined()` or method existence

---

### Task: Remove trivial cache tests
**File:** `tests/versioning-dependencies.test.ts`
**Issue:** Lines 284-296 test obvious cache behavior

**Tests to Remove:**
```typescript
describe('Cache Statistics', () => {
  it('should return empty cache statistics', () => {
    expect(cache.stats()).toEqual({ size: 0, ... })
  })

  it('should clear cache', () => {
    cache.clear()
    expect(cache.stats().size).toBe(0)
  })
})
```

**These add no value** - they test that `.clear()` clears and empty cache is empty.

**Steps:**
1. Remove trivial cache tests (lines 284-296)
2. Keep tests that verify cache behavior under load
3. Add meaningful cache tests if needed (eviction, persistence)

**Validation:** Only meaningful cache behavior is tested

---

## P2.2: Replace Snapshot Testing

### Task: Replace snapshots in `metaverse.spec.ts` with semantic assertions
**File:** `tests/metaverse.spec.ts`
**Issue:** Snapshot testing is brittle - any output change requires manual review

**Current Approach:**
```typescript
it('should generate correct output', () => {
  const output = metaverse(fixtureName)
  expect(output).toMatchSnapshot()  // Brittle!
})
```

**Better Approach:**
```typescript
it('should generate correct output', () => {
  const output = metaverse('hygen-templates')

  // Semantic assertions
  expect(output.filesCreated).toContain('src/index.js')
  expect(output.filesCreated).toContain('README.md')

  const indexContent = readFileSync('src/index.js', 'utf8')
  expect(indexContent).toMatch(/^export /)  // Starts with export
  expect(indexContent).toContain('function')
  expect(indexContent).not.toContain('undefined')

  // Validate structure, not exact content
  expect(validateJSStructure(indexContent)).toBe(true)
})
```

**Steps:**
1. For each snapshot test, identify what matters
2. Write semantic assertions for structure/behavior
3. Remove `.toMatchSnapshot()` calls
4. Delete snapshot files
5. Test that assertions catch real regressions

**Validation:** Tests verify behavior without snapshot brittleness

---

## P2.3: Add Missing Edge Cases

### Task: Add edge cases to `add.spec.ts`
**File:** `tests/add.spec.ts`
**Current:** Only 2 tests
**Missing:** Empty files, special chars, permissions, conditions

**Tests to Add:**
```typescript
describe('Add operation edge cases', () => {
  it('should handle empty template files', async () => {
    // Test with empty template
  })

  it('should handle special characters in filenames', async () => {
    const filename = 'file with spaces & special-chars.js'
    // Test file creation
  })

  it('should respect unless_exists condition', async () => {
    // Create file
    // Try to recreate with unless_exists
    // Verify not overwritten
  })

  it('should handle skip_if conditions', async () => {
    // Test conditional file creation
  })

  it('should use HYPERGEN_OVERWRITE env var', async () => {
    process.env.HYPERGEN_OVERWRITE = '1'
    // Test that overwrite happens
  })

  it('should handle permission errors gracefully', async () => {
    // Mock fs.writeFile to throw EACCES
    // Verify error message is helpful
  })
})
```

**Steps:**
1. Review `src/ops/add.ts` to see all features
2. Write tests for each condition/option
3. Add error handling tests
4. Test with real file system in temp directories

**Validation:** add.spec.ts has 10+ tests covering all code paths

---

### Task: Add concurrency tests to action system
**Files:**
- `tests/action-pipelines.test.ts`
- `tests/cross-action-communication.test.ts`

**Missing:** Stress tests with many concurrent actions

**Tests to Add:**
```typescript
describe('Concurrent execution', () => {
  it('should handle 20 parallel actions', async () => {
    const actions = Array.from({ length: 20 }, (_, i) => ({
      id: `action-${i}`,
      action: 'fast-action'
    }))

    const start = Date.now()
    const result = await executor.executePipeline({ steps: actions })
    const duration = Date.now() - start

    expect(result.success).toBe(true)
    expect(result.completed).toBe(20)
    expect(duration).toBeLessThan(1000)  // Should be parallel, not 20 * 100ms
  })

  it('should handle message flooding', async () => {
    // Send 1000 messages between actions
    // Verify all delivered correctly
  })

  it('should handle race conditions in shared state', async () => {
    // Multiple actions updating same state
    // Verify no lost updates
  })
})
```

**Steps:**
1. Design concurrency stress scenarios
2. Implement with realistic timing
3. Verify thread safety
4. Test error propagation in parallel execution

**Validation:** Concurrency edge cases are tested

---

## P2.4: Improve Test Organization

### Task: Move recipe step tests from broken v8-integration.test.ts
**Issue:** v8-integration.test.ts has some working tests (lines 222-338) mixed with broken E2E tests

**Working Tests to Extract:**
- Recipe step type guards
- Step validation helpers
- Step parsing utilities

**Steps:**
```bash
# 1. Create new test file
touch tests/recipe-step-types.test.ts

# 2. Copy working tests from v8-integration.test.ts (lines 222-338)

# 3. Fix imports and setup

# 4. Verify tests pass

# 5. Remove v8-integration.test.ts
git rm tests/v8-integration.test.ts
git add tests/recipe-step-types.test.ts
git commit -m "test: extract recipe step tests to dedicated file"
```

**Validation:** Recipe step tests exist in proper location

---

### Task: Consolidate duplicate tests
**Issue:** `e2e-recipe-with-helpers.test.ts` duplicates `e2e-edit-page-recipe.test.ts`

**Duplicate Test:**
- Lines 34-147 in `e2e-recipe-with-helpers.test.ts`
- Overlaps with Pass 1 tests in `e2e-edit-page-recipe.test.ts`

**Fix:**
```bash
# Option A: Remove duplicate test case 1, keep test case 2 (multiple entries)
# Edit e2e-recipe-with-helpers.test.ts, remove lines 34-147

# Option B: Merge files
# Move unique tests to e2e-edit-page-recipe.test.ts
# Delete e2e-recipe-with-helpers.test.ts
```

**Steps:**
1. Compare both files to identify unique tests
2. Keep unique test (multiple AI entries scenario)
3. Remove or merge duplicate tests
4. Ensure no coverage loss

**Validation:** No duplicate test coverage

---

### Task: Add test documentation
**File:** `tests/README.md` (create new)

**Content:**
```markdown
# Hypergen Test Suite

## Structure

- `tests/e2e/` - End-to-end tests (full workflows)
- `tests/suites/` - Organized by feature
  - `ai/` - AI integration tests
  - `recipe-engine/` - Recipe execution tests
  - `template-engines/` - Template rendering tests
- `tests/fixtures/` - Shared test fixtures
  - `recipes/` - Recipe YAML and templates
  - `templates/` - Standalone template files
- `tests/util/` - Test utilities and helpers

## Running Tests

```bash
# Run all tests
bun test

# Run specific category
bun test tests/suites/ai/

# Run single file
bun test tests/suites/ai/two-pass-integration.test.ts

# Watch mode
bun test --watch
```

## Writing Tests

### Test File Naming
- Use `.test.ts` suffix (e.g., `foo.test.ts`)
- Use descriptive names matching what's tested

### Test Framework
- Use `bun:test` (NOT vitest)
- Import from `bun:test`: `import { describe, it, expect } from 'bun:test'`

### E2E Tests
- Use temp directories (via `mkdtempSync`)
- Clean up with `rmSync` in `afterEach`
- Test real file I/O, not mocks
- Validate file content, not just existence

### Unit Tests
- Mock external dependencies (fs, APIs)
- Test behavior, not implementation details
- Use semantic assertions, avoid snapshots
- Focus on edge cases and error paths

## Test Fixtures

See `tests/fixtures/README.md` for fixture structure and usage.

## Common Patterns

### Testing Template Rendering
[Examples]

### Testing Recipe Execution
[Examples]

### Testing File Operations
[Examples]
```

**Steps:**
1. Create `tests/README.md`
2. Create `tests/fixtures/README.md`
3. Document common patterns
4. Add examples from actual tests

**Validation:** New contributors can understand test structure

---

# Summary: Complete Task Checklist

## P0 Tasks (Week 1) - 4-6 hours

**Deletions (30 min):**
- [ ] Delete `tests/cli-flags.test.ts`
- [ ] Delete `tests/v8-integration.test.ts`
- [ ] Delete `tests/config.spec.ts`
- [ ] Delete `tests/template-composition.test.ts`

**Fixes (2-3 hours):**
- [ ] Fix or remove `tests/v8-integration.spec.ts` (import error)
- [ ] Convert 4-5 files from vitest to bun:test
- [ ] Verify test suite runs without import/spawn errors

**Expected Outcome:**
- 1,150 LOC removed
- All tests executable
- CI green (or only real failures)

---

## P1 Tasks (Week 2) - 16-24 hours

**Critical Fixes (8-12 hours):**
- [ ] Fix AI collection system tests (template-tool-collector.test.ts)
- [ ] Fix E2E tests to work without Go environment
- [ ] Extract large fixtures from e2e-edit-page-recipe.test.ts
- [ ] Add execution path tests to ai-tool.test.ts
- [ ] Fix hook verification in action tests
- [ ] Add realistic latencies to pipeline tests

**Test Improvements (8-12 hours):**
- [ ] Fix undefined variable assertions (expect "undefined" string)
- [ ] Fix prompt assertion in e2e-recipe-with-helpers.test.ts
- [ ] Mock Go parser for reliability
- [ ] Update hard-coded paths to use fixtures

**Expected Outcome:**
- AI tests passing
- High-value tests strengthened
- Tests work on all environments

---

## P2 Tasks (Weeks 3-4) - 20-30 hours

**Cleanup (8-10 hours):**
- [ ] Remove factory boilerplate tests (~200-300 LOC)
- [ ] Remove trivial cache tests
- [ ] Remove duplicate tests between E2E files
- [ ] Extract recipe step tests to dedicated file

**Improvements (8-12 hours):**
- [ ] Replace snapshots in metaverse.spec.ts
- [ ] Add edge cases to add.spec.ts (10+ new tests)
- [ ] Add concurrency tests to action system
- [ ] Add error message validation tests

**Organization (4-8 hours):**
- [ ] Create `tests/README.md`
- [ ] Create `tests/fixtures/README.md`
- [ ] Document common test patterns
- [ ] Consolidate test utilities

**Expected Outcome:**
- 200-300 LOC boilerplate removed
- Comprehensive edge case coverage
- Well-documented test suite
- Test health: 85+/100

---

# Success Metrics

## Before
- Test files: 54
- Test suite health: 68/100
- Broken files: 4
- Dead code: ~1,500 LOC
- Framework consistency: Mixed (Vitest + Bun)
- Documentation: None

## After
- Test files: 50 (4 removed)
- Test suite health: 85+/100
- Broken files: 0
- Dead code: 0 LOC
- Framework consistency: 100% bun:test
- Documentation: Complete

## Measurable Improvements
- CI reliability: +90% (no import/spawn errors)
- Test coverage: Same LOC, better quality
- Maintenance burden: -20% (less boilerplate)
- Onboarding time: -50% (documented patterns)

---

# Notes

1. **Test failures are OK** - Hypergen is under development, tests failing means they're catching issues
2. **Focus on quality over quantity** - 800 good tests > 1000 mixed tests
3. **Prioritize E2E tests** - They catch real regressions
4. **Document as you go** - Update test README with patterns you discover
5. **Commit frequently** - Small commits are easier to review

Good luck! 🚀
