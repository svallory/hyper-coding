# Plan: Fix Debug Log Pollution & Implement Comprehensive Output Testing

## Context

**User Issue:** Running `hypergen run crud edit-page --model Organization` produces polluted output with debug logs instead of clean, formatted prompts:

```
[CONTEXT] config.helpers enumerable: [ 'listModelFields', ... ]
[RECIPE-ENGINE] baseContext.h: [ 'capitalize', ... ]
✓ Recipe completed successfully
```

**Expected Output:** Clean AI prompt like:
```
# Hypergen AI Generation Request

### `handlerDeps`
Given the Organization fields and relations, list the service dependencies...

### `editPageHandler`
Write the GET handler body for the Organization edit page...

To complete generation, create answers.json and run:
  hypergen run crud edit-page --model Organization --answers ./answers.json
```

**Critical Problems:**
1. ❌ Debug logs pollute user output (not behind DEBUG env var)
2. ❌ No AI prompt displayed to users
3. ❌ Tests don't verify actual CLI output or generated file content
4. ❌ Tests may be testing implementation details, not behavior

## Investigation Findings

### Finding 1: Hardcoded console.log() Statements

**Source files with debug pollution:**
- `src/context.ts:42-46` - 4 console.log for helpers debugging
- `src/recipe-engine/recipe-engine.ts:981,986` - 2 console.log for helpers
- `src/template-engines/ai-tags.ts:70,78` - 2 console.log for AI debugging

**These are NOT behind DEBUG** - they always print to stdout.

### Finding 2: Missing AI Prompt Output

From `tests/suites/ai/two-pass-integration.test.ts`, we see the expected prompt format:

```typescript
const prompt = assembler.assemble(collector, {
  originalCommand: 'hypergen run ./test --name=User',
  answersPath: './answers.json',
})

expect(prompt).toContain('# Hypergen AI Generation Request')
expect(prompt).toContain('### `listFields`')
expect(prompt).toContain('--answers ./answers.json')
```

**Current behavior:** Recipe completes silently, no prompt shown.
**Root cause:** CLI doesn't call `PromptAssembler` after Pass 1 collection.

### Finding 3: No Output Verification in Tests

**What tests currently verify:**
- ✅ Internal state: `collector.hasEntries()`, `entry.key`, `entry.contexts`
- ✅ Spy calls: `renderSpy.toHaveBeenCalled()`
- ❌ CLI stdout: What users see
- ❌ Generated files: File contents

**Gap:** We test implementation, not user-facing outcomes.

## Implementation Plan

### Phase 1: Remove Debug Log Pollution (15 min)

**Files to modify:**

**1. `src/context.ts` (lines 42-46)** - Remove 4 debug lines:
```typescript
// DELETE:
console.log('[CONTEXT] config.helpers enumerable:', Object.keys(config.helpers || {}))
console.log('[CONTEXT] config.helpers all props:', Object.getOwnPropertyNames(config.helpers || {}))
console.log('[CONTEXT] hValue enumerable:', Object.keys(hValue))
console.log('[CONTEXT] hValue all props:', Object.getOwnPropertyNames(hValue))
```

**2. `src/recipe-engine/recipe-engine.ts` (lines 981, 986)** - Remove 2 debug lines:
```typescript
// DELETE:
console.log('[RECIPE-ENGINE] this.config.helpers:', Object.keys(this.config.helpers || {}))
console.log('[RECIPE-ENGINE] baseContext.h:', Object.keys(baseContext.h || {}))
```

**3. `src/template-engines/ai-tags.ts` (lines 70, 78)** - Convert to debug():
```typescript
// REPLACE:
console.log('[AI TAG] __hypergenCollectMode:', ...)
// WITH:
debug('collectMode=%s key=%s', state.__hypergenCollectMode, __aiBlock.key)
```

### Phase 2: Add AI Prompt Output to CLI (30 min)

**Goal:** Display assembled prompt after Pass 1 collection.

**Location:** Find where recipe execution completes in CLI.

**Step 1:** Identify CLI entry point:
```bash
grep -r "executeRecipe" src/cli/ src/bin.ts
```

**Step 2:** Add prompt output after collectMode execution:

```typescript
// After recipe execution:
if (collectMode && collector.hasEntries()) {
  const assembler = new PromptAssembler()
  const prompt = assembler.assemble(collector, {
    originalCommand: process.argv.slice(2).join(' '),
    answersPath: options.answersPath || './answers.json'
  })

  // Output to stdout
  console.log('\n' + prompt + '\n')

  // Exit after Pass 1
  process.exit(0)
}
```

**Files likely to modify:**
- `src/cli/cli.ts` or `src/bin.ts` - Add prompt output logic
- Import `PromptAssembler` from `src/ai/prompt-assembler.ts`

### Phase 3: Add CLI Output Verification Tests (45 min)

**New test file:** `tests/e2e/cli-output.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('CLI Output E2E', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'hypergen-cli-test-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should display clean AI prompt without debug logs', () => {
    // Setup test recipe
    setupTestRecipe(testDir)

    // Execute CLI (Pass 1)
    const stdout = execSync(
      `bun run ${CLI_PATH} crud edit-page --model User`,
      { encoding: 'utf8', cwd: testDir }
    )

    // Verify NO debug logs
    expect(stdout).not.toContain('[CONTEXT]')
    expect(stdout).not.toContain('[RECIPE-ENGINE]')
    expect(stdout).not.toContain('[AI TAG]')

    // Verify clean prompt output
    expect(stdout).toContain('# Hypergen AI Generation Request')
    expect(stdout).toContain('###')
    expect(stdout).toContain('To complete generation')
    expect(stdout).toContain('--answers')
  })

  it('should generate correct files in Pass 2', () => {
    setupTestRecipe(testDir)

    // Pass 1: Collect (should exit with prompt)
    execSync(`bun run ${CLI_PATH} crud edit-page --model User`, { cwd: testDir })

    // Create answers
    writeFileSync(join(testDir, 'answers.json'), JSON.stringify({
      handlerCode: 'export function handler() { return "test"; }'
    }))

    // Pass 2: Generate
    execSync(
      `bun run ${CLI_PATH} crud edit-page --model User --answers ./answers.json`,
      { cwd: testDir }
    )

    // Verify file created
    const outputPath = join(testDir, 'handlers/user-edit.ts')
    expect(existsSync(outputPath)).toBe(true)

    // Verify file content
    const content = readFileSync(outputPath, 'utf8')
    expect(content).toContain('export function handler()')
    expect(content).toContain('return "test"')
  })

  it('should show error for missing answers in Pass 2', () => {
    setupTestRecipe(testDir)

    expect(() => {
      execSync(
        `bun run ${CLI_PATH} crud edit-page --model User --answers ./missing.json`,
        { cwd: testDir, encoding: 'utf8' }
      )
    }).toThrow(/answers file not found/i)
  })
})

function setupTestRecipe(dir: string) {
  // Create minimal recipe structure
  // ...
}
```

### Phase 4: Test Quality Audit (60 min)

**Goal:** Identify tests that don't add value, remove or strengthen them.

**Audit Process:**

1. **List all test files:**
```bash
find tests -name "*.test.ts" | wc -l  # Count total
```

2. **For each test file, evaluate:**
   - Does it test behavior or implementation?
   - Does it test our code or the framework?
   - Is it redundant with other tests?
   - Does it verify user-facing outcomes?

3. **Classification:**
   - **HIGH VALUE** - Keep, maybe strengthen
   - **MEDIUM VALUE** - Keep but simplify
   - **LOW VALUE** - Remove

**Files to audit (priority order):**

Priority 1 - Likely need review:
- `tests/suites/recipe-engine/template-tool-collector.test.ts` - Tests spies, not output
- `tests/suites/template-engines/ai-tags-state-access.test.ts` - Tests Edge.js, not our logic?
- `tests/suites/ai/e2e-recipe-with-helpers.test.ts` - E2E or unit?

Priority 2 - Check for redundancy:
- All tests in `tests/suites/ai/` - Do they overlap?
- `tests/v8-integration/` - Real integration or mocked?

**Output:** Create `agent/reports/test-audit-2026-02-09.md` with:
```markdown
# Test Suite Audit Report

## Summary
- Total tests: 127
- High value: 89
- Medium value: 23
- Low value (removed): 15

## Removed Tests
### tests/xyz.test.ts
**Reason:** Tests Vitest mocking, not our code
**Lines:** 45-89

## Strengthened Tests
### tests/abc.test.ts
**Change:** Added file content verification
**Before:** expect(filesCreated.length).toBe(1)
**After:** expect(readFileSync(files[0])).toContain('expected content')
```

### Phase 5: Add Missing Test Coverage (30 min)

Based on audit, add tests for critical gaps:

**New test file:** `tests/e2e/generated-file-content.test.ts`

```typescript
describe('Generated File Content Verification', () => {
  it('generates handler with correct structure', async () => {
    // Run full 2-pass generation
    await runFullGeneration({
      recipe: 'crud/edit-page',
      model: 'Organization',
      answers: mockAnswers
    })

    // Verify file structure
    const content = readFileSync('./handlers/organization-edit.go', 'utf8')

    expect(content).toMatch(/func \(h \*OrganizationEditHandler\) EditPage/)
    expect(content).toMatch(/func \(h \*OrganizationEditHandler\) Update/)
    expect(content).toContain('slog.Error')
    expect(content).not.toContain('undefined')
    expect(content).not.toContain('// TODO')
  })

  it('generates valid Go code', async () => {
    await runFullGeneration({ recipe: 'crud/edit-page', model: 'User' })

    // Verify Go syntax
    execSync('go fmt ./handlers/user-edit.go')  // Will fail if invalid Go
    execSync('go vet ./handlers/user-edit.go')  // Static analysis
  })
})
```

**Test Matrix (Coverage Gaps):**

| Scenario | Current | Needed |
|----------|---------|--------|
| Pass 1 clean output | ❌ | ✅ CLI stdout test |
| Pass 2 file creation | ❌ | ✅ File exists test |
| Pass 2 file content | ❌ | ✅ Content verification |
| No AI blocks | ✅ | - |
| Invalid answers | ❌ | ✅ Error message test |
| Debug log removal | ❌ | ✅ Negative assertion |

## Verification Steps

### Step 1: Clean Output ✅
```bash
cd /work/hyperdev/packages/hypergen/sandbox/go
bun run ../../src/bin.ts crud edit-page --model Organization 2>&1 | grep '\[CONTEXT\]'
# Expected: NO OUTPUT (grep finds nothing)
```

### Step 2: Prompt Displayed ✅
```bash
cd /work/hyperdev/packages/hypergen/sandbox/go
bun run ../../src/bin.ts crud edit-page --model Organization
# Expected output starts with:
# # Hypergen AI Generation Request
```

### Step 3: All Tests Pass ✅
```bash
cd /work/hyperdev/packages/hypergen
bun test --run
# Expected: 0 failures
```

### Step 4: E2E CLI Tests ✅
```bash
bun test tests/e2e/cli-output.test.ts --run
bun test tests/e2e/generated-file-content.test.ts --run
# Expected: All pass
```

### Step 5: Manual Full Workflow ✅
```bash
cd sandbox/go
bun run ../../src/bin.ts crud edit-page --model Organization > prompt.txt

# Review prompt (should be clean)
cat prompt.txt

# Create answers (via LLM or manually)
# Edit answers.json with AI responses

# Pass 2
bun run ../../src/bin.ts crud edit-page --model Organization --answers answers.json

# Verify generated files
ls -la handlers/
cat handlers/organization-edit.go
go fmt handlers/organization-edit.go  # Verify valid Go
```

## Success Criteria

1. ✅ **Zero debug logs** - No `[CONTEXT]`, `[RECIPE-ENGINE]`, `[AI TAG]` in user output
2. ✅ **Clean prompt displayed** - Formatted, readable, with instructions
3. ✅ **All E2E tests pass** - CLI output and file content verified
4. ✅ **Test audit complete** - Report written, low-value tests removed
5. ✅ **High confidence** - Tests verify what users see, not just internal state

## Files to Modify

### Production (Phase 1-2)
- `src/context.ts` - Remove 4 console.log lines
- `src/recipe-engine/recipe-engine.ts` - Remove 2 console.log, find CLI hook
- `src/template-engines/ai-tags.ts` - Convert 2 console.log to debug()
- `src/cli/cli.ts` or `src/bin.ts` - Add PromptAssembler output

### Tests (Phase 3-5)
- **New:** `tests/e2e/cli-output.test.ts`
- **New:** `tests/e2e/generated-file-content.test.ts`
- **New:** `agent/reports/test-audit-2026-02-09.md`
- **Modify:** Various tests identified in audit

## Risk Assessment

**Low Risk:**
- Removing console.log - Debug pollution, shouldn't be there
- Adding E2E tests - Only increases coverage

**Medium Risk:**
- Removing tests - Need careful analysis
- CLI output changes - Users might parse output (unlikely for this tool)

**Mitigation:**
- Atomic commits (one logical change each)
- Run full test suite after each phase
- Manual testing in sandbox before completion

## Time Estimate

- Phase 1: 15 min (remove debug logs)
- Phase 2: 30 min (add prompt output)
- Phase 3: 45 min (E2E tests)
- Phase 4: 60 min (audit)
- Phase 5: 30 min (fill gaps)

**Total:** ~2.5 hours

## Questions for User

None - Requirements are clear from the issue description and expected behavior.
