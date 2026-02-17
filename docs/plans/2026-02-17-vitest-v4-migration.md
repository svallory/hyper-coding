# Vitest v1 to v4 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade HyperDev monorepo from vitest v1.0.0 to v4.0.18 with full breaking change handling, validation, and optimization.

**Architecture:** Single coordinated upgrade across all 6 packages (core, kit, gen, cli, ui, autocomplete) with shared config verification first, then simultaneous package updates, breaking change fixes, and comprehensive validation including TypeScript, build, and moon checks.

**Tech Stack:** vitest 4.0.18, @vitest/coverage-v8 (latest for v4), bun workspace, moon build system, vite custom plugins

---

## Breaking Changes Reference

From vitest v1 → v4 migration:

1. **Pool Architecture**: `poolOptions` removed, `threads`/`vm` moved to top level, environment vars renamed (`VITEST_MAX_THREADS` → `VITEST_MAX_WORKERS`)
2. **Coverage**: `coverage.all` removed, `coverage.ignoreEmptyLines` removed, recommend defining `coverage.include`
3. **Mock API**: `vi.restoreAllMocks()` no longer resets `vi.fn()` automocks, `vi.fn().mock.invocationCallOrder` now starts at 1 (not 0)
4. **Reporter**: Basic reporter removed, use default + `summary: false`
5. **Browser Mode**: Built-in now, no need for `@vitest/browser` package
6. **Default Exclusions**: Now only excludes `node_modules` and `.git` by default

Our config uses v8 coverage provider with exclude list and testTimeout - all compatible with v4.
Our custom `hashImportsPlugin` uses vite's resolver - needs verification for v4 compatibility.

---

## Task 1: Document Current State & Create Baseline

**Files:**
- Read: `vitest.config.base.ts`
- Read: `packages/*/package.json` (all 6 packages)
- Document: Create `agent/reports/vitest-v4-migration-baseline.md`

**Step 1: Document current vitest versions**

Run in worktree:
```bash
cd /work/hyper/.worktrees/vitest-upgrade
grep -r '"vitest"' packages/*/package.json | grep -v node_modules
grep -r '@vitest/coverage' packages/*/package.json | grep -v node_modules
```

Expected output: All show `"vitest": "^1.0.0"` and coverage packages at v1.x.x

**Step 2: Document current test count**

Run:
```bash
bun test 2>&1 | tail -20
```

Expected: Shows total test count (e.g., "47 passing") - capture this number.

**Step 3: Verify hashImportsPlugin behavior**

Run:
```bash
cd packages/core
bun test 2>&1 | head -50
```

Expected: Tests pass, no errors related to hash imports (#tests/, #fixtures/, #src/)

**Step 4: Create baseline report**

Write to `agent/reports/vitest-v4-migration-baseline.md`:
```markdown
# Vitest v4 Migration Baseline Report

**Date:** 2026-02-17
**Starting Version:** vitest ^1.0.0, @vitest/coverage-v8 1.x.x
**Target Version:** vitest 4.0.18, @vitest/coverage-v8 latest-for-v4

## Packages
- packages/core ✓
- packages/kit ✓
- packages/gen ✓
- packages/cli ✓
- packages/ui ✓
- packages/autocomplete ✓

## Current Test Count
[INSERT: total test count from bun test output]

## Configuration Status
- hashImportsPlugin: Working ✓
- coverage.provider: v8 ✓
- testTimeout: 30000ms ✓
- globals: true ✓

## Known Compatibility Issues
[NONE IDENTIFIED - Config is minimal and v4-compatible]

## Migration Tasks
- [ ] Update vitest.config.base.ts for v4 (if needed)
- [ ] Bump all package.json versions
- [ ] Run full test suite
- [ ] Verify coverage configuration
- [ ] Validate with moon check
```

**Step 5: Commit baseline**

```bash
git add agent/reports/vitest-v4-migration-baseline.md
git commit -m "docs: add vitest v4 migration baseline report"
```

---

## Task 2: Research & Verify hashImportsPlugin Compatibility with Vitest v4

**Files:**
- Read: `vitest.config.base.ts` (lines 10-40, the plugin definition)
- Research: Vite resolver changes between v4 and v1 of vitest

**Step 1: Understand the plugin**

Read `vitest.config.base.ts` and document:
- What the plugin does: Resolves `#` imports to src/ during tests
- Key methods: `resolveId()` (Vite plugin hook)
- Why it matters: Mock registration must use same path as import loading

Expected: The plugin uses standard Vite `resolveId()` hook which is stable across versions.

**Step 2: Check Vite compatibility**

Run:
```bash
cd /work/hyper/.worktrees/vitest-upgrade
bun pm ls vite
```

Expected: vitest 4.0.18 depends on vite ^5.x (check output)

**Step 3: Verify resolver hook API didn't change**

Search vitest 4.0 release notes:
```bash
curl -s https://github.com/vitest-dev/vitest/releases/tag/v4.0.0 | grep -i "resolver\|resolveId\|plugin" | head -10
```

Expected: No breaking changes to `resolveId()` hook signature

**Step 4: Update baseline report**

Add to baseline report:
```markdown
## Plugin Analysis
- Plugin uses: Vite `resolveId()` hook (stable API)
- Returns: Absolute path with `.ts` extension (critical for mock registration)
- Compatibility: v4 compatible, no changes needed to plugin itself
```

**Step 5: No commit yet** - Just documentation

---

## Task 3: Update vitest.config.base.ts for v4 Compatibility

**Files:**
- Modify: `vitest.config.base.ts`

**Step 1: Review current config**

Current config:
```typescript
// Line 4: Import already uses v4-compatible API
import { defineConfig } from "vitest/config";

// Lines 51-64: Coverage and test config
test: {
    globals: true,
    environment: "node",
    env: { FORCE_COLOR: "true" },
    coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: [...],
    },
    testTimeout: 30000,
}
```

Status: ✓ Already v4-compatible, no changes needed!

**Step 2: Verify exports are correct**

The function `createVitestConfig()` already exports correctly for v4:
- Uses `defineConfig()` (correct for v4)
- Returns `UserConfig` type (correct)
- Plugin array format compatible

**Step 3: Documentation**

Add comment at top of file:
```typescript
/**
 * Vitest v4 compatible configuration factory.
 *
 * Breaking changes addressed:
 * - Uses top-level environment/globals (not poolOptions)
 * - Uses coverage.provider v8 without coverage.all
 * - Custom plugin uses stable Vite resolveId() hook
 * - Plugin returns path WITH .ts extension for mock/import alignment
 */
```

Actually, let's NOT add comments since the code is already working. Skip this step.

**Step 4: No file changes needed**

The config is already v4-compatible. Proceed to package updates.

---

## Task 4: Update All 6 Package.json Files to Vitest 4.0.18

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/kit/package.json`
- Modify: `packages/gen/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/ui/package.json`
- Modify: `packages/autocomplete/package.json`

**Step 1: Update packages/core/package.json**

Find line with `"vitest": "^1.0.0"` and change to:
```json
"vitest": "4.0.18"
```

Also find and update if present:
- `@vitest/coverage-v8`: change to `"4.0.18"` (if version pinned)

Expected: Exact version pinning for consistency

**Step 2: Update packages/kit/package.json**

Same changes as Step 1.

Note: Kit has `@vitest/coverage-v8`: update to `"4.0.18"`

**Step 3: Update packages/gen/package.json**

Same changes as Step 1.

**Step 4: Update packages/cli/package.json**

Same changes as Step 1.

Note: CLI has `@vitest/coverage-v8": "1.6.1"` - update to `"4.0.18"`

**Step 5: Update packages/ui/package.json**

Same changes as Step 1.

**Step 6: Update packages/autocomplete/package.json**

Same changes as Step 1.

**Step 7: Verify all changes**

Run:
```bash
grep -r '"vitest"' packages/*/package.json | grep -v node_modules
grep -r '@vitest/coverage' packages/*/package.json | grep -v node_modules
```

Expected output: All show `"vitest": "4.0.18"` and coverage at `"4.0.18"`

**Step 8: Install dependencies**

Run:
```bash
bun install
```

Expected: Dependencies lock file updated, vitest 4.0.18 installed

**Step 9: Commit**

```bash
git add packages/*/package.json bun.lock
git commit -m "chore(deps): upgrade vitest to 4.0.18 across all packages"
```

---

## Task 5: Run Tests & Verify All Pass

**Files:**
- Test: All tests across 6 packages

**Step 1: Run full test suite**

```bash
cd /work/hyper/.worktrees/vitest-upgrade
bun test 2>&1 | tee /tmp/vitest-upgrade-output.txt
```

Expected: All tests pass with same count as baseline (or more if tests were added)

**Step 2: Check for deprecation warnings**

```bash
cat /tmp/vitest-upgrade-output.txt | grep -i "deprecat\|warning\|error"
```

Expected: No deprecation warnings about vitest APIs

**Step 3: Verify mock behavior**

Look for any test failures related to:
- `vi.fn().mock.invocationCallOrder` (now starts at 1, not 0)
- `vi.restoreAllMocks()` (no longer resets automocks)
- Getter/setter automocks (now return undefined instead of calling original)

Fix any test assertions that relied on old behavior.

Expected: All tests pass without assertion changes

**Step 4: Check coverage output**

```bash
bun test -- --coverage 2>&1 | head -30
```

Expected: Coverage report generated successfully with v8 provider

**Step 5: No commit yet** - Tests must pass with next step

---

## Task 6: TypeScript Validation & Build Check

**Files:**
- All source files (tsconfig validation)

**Step 1: Run typecheck**

```bash
cd /work/hyper/.worktrees/vitest-upgrade
moon run :typecheck
```

Expected: All packages typecheck successfully, 0 errors

**Step 2: Run build**

```bash
moon run :build
```

Expected: All packages build successfully to dist/ folders

**Step 3: Run full moon check**

```bash
moon check --all
```

Expected: All checks pass (build, typecheck, test, lint, format)

If any failures:
- Document the error
- Fix the issue
- Re-run check

**Step 4: Commit if all green**

```bash
git add -A
git commit -m "chore: verify vitest 4.0.18 upgrade with moon check"
```

---

## Task 7: Generate Migration Report & Documentation

**Files:**
- Modify: `agent/reports/vitest-v4-migration-baseline.md` (add final section)
- Create: `agent/reports/vitest-v4-migration-summary.md`

**Step 1: Update baseline report with results**

Add "Final Status" section:
```markdown
## Final Status ✓

**Migration Completed:** 2026-02-17
**Final Version:** vitest 4.0.18, @vitest/coverage-v8 4.0.18

### Verification Results
- Test Suite: [INSERT: final test count] passing (baseline: [INSERT: baseline count])
- TypeScript: ✓ 0 errors
- Build: ✓ All packages built successfully
- Moon Check: ✓ All checks passing
- Coverage: ✓ Generated with v8 provider

### Breaking Changes Applied
- ✓ Config already v4-compatible (no changes needed)
- ✓ hashImportsPlugin verified working with v4
- ✓ Coverage configuration unchanged (compatible with v4)
- ✓ Test suite: No API changes required
- ✓ Mock behavior: All tests passing (no vi.fn() changes needed)

### Performance Notes
[Add any observations about test speed or coverage changes]

### Optimizations for V4
[List any v4 features we could leverage in future]
```

**Step 2: Create summary document**

Write to `agent/reports/vitest-v4-migration-summary.md`:
```markdown
# Vitest v4 Migration - Executive Summary

## What Changed
- **Version:** vitest ^1.0.0 → 4.0.18
- **Scope:** 6 packages (core, kit, gen, cli, ui, autocomplete)
- **Approach:** Single coordinated upgrade (big bang)

## What Stayed the Same
- Test suite structure (globals: true)
- Coverage configuration (v8 provider)
- Custom hashImportsPlugin (uses stable Vite API)
- No test code changes required

## Why v4 is Better
- Improved performance
- Better error messages
- More stable plugin architecture
- Simplified pool configuration
- Built-in browser mode

## Migration Effort
- **Time:** ~30 minutes
- **Files Modified:** 6 package.json files
- **Config Changes:** 0 (already compatible)
- **Test Changes:** 0 (all tests pass as-is)
- **Risk Level:** Low (backward compatible for our use case)

## Verification
- ✓ All tests passing
- ✓ TypeScript clean
- ✓ Build successful
- ✓ Moon checks passing
- ✓ Coverage working
```

**Step 3: Commit reports**

```bash
git add agent/reports/vitest-v4-migration-*.md
git commit -m "docs: add vitest v4 migration reports"
```

---

## Task 8: Final Integration Commit & Cleanup

**Files:**
- Root level (cleanup if needed)

**Step 1: Verify worktree is clean**

```bash
git status
```

Expected: Only committed files, nothing uncommitted

**Step 2: Check commit history**

```bash
git log --oneline -5
```

Expected:
```
[new] docs: add vitest v4 migration reports
[new] chore: verify vitest 4.0.18 upgrade with moon check
[new] chore(deps): upgrade vitest to 4.0.18 across all packages
[new] docs: add vitest v4 migration baseline report
d7a506b chore: ensure all tests use import paths
```

**Step 3: Run one final full check**

```bash
moon check --all
```

Expected: All green ✓

**Step 4: View final test count**

```bash
bun test 2>&1 | tail -5
```

Record the final passing count.

**Step 5: Done!**

Worktree is ready for merging or PR creation. No additional commits needed.

---

## Success Criteria Checklist

- [ ] Task 1: Baseline documented
- [ ] Task 2: Plugin compatibility verified
- [ ] Task 3: Config verified (no changes needed)
- [ ] Task 4: All package.json files updated to 4.0.18
- [ ] Task 5: All tests passing
- [ ] Task 6: TypeScript, build, and moon checks passing
- [ ] Task 7: Migration reports generated
- [ ] Task 8: Final verification complete

**Done when:** All checkboxes ✓ and ready to merge/PR

---

## References

- [Vitest Migration Guide](https://vitest.dev/guide/migration.html)
- [Vitest 4.0 Release Notes](https://vitest.dev/blog/vitest-4)
- [Vitest 4.0.0 GitHub Release](https://github.com/vitest-dev/vitest/releases/tag/v4.0.0)
