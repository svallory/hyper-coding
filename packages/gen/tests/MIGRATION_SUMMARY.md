# Test Migration Summary

**Date:** 2026-02-14
**Source:** `packages/hypergen/tests/`
**Destination:** `packages/gen/tests/`

## Files Migrated

### Total Counts
- **Test files:** 60 (*.test.ts, *.spec.ts)
- **Total files:** 206 (including fixtures, snapshots, utilities)

### Test Categories Migrated

#### Recipe Engine Core (8 files)
- recipe-engine.test.ts
- recipe-engine/group-executor.test.ts
- recipe-engine/output-evaluator.test.ts
- recipe-engine/variable-resolution.test.ts
- suites/recipe-engine/condition-helpers.test.ts
- recipe-step-system-integration.test.ts
- conditional-inclusion.test.ts
- cross-action-communication.test.ts

#### Recipe Engine Tools (8 files)
- recipe-engine/tools/template-tool.test.ts (→ suites/recipe-engine/template-tool.test.ts)
- suites/recipe-engine/ensure-dirs-tool.test.ts
- suites/recipe-engine/install-tool.test.ts
- suites/recipe-engine/patch-tool.test.ts
- suites/recipe-engine/query-tool.test.ts
- suites/recipe-engine/shell-tool-jig-rendering.test.ts
- suites/recipe-engine/on-success-message.test.ts
- suites/recipe-engine/template-tool-collector.test.ts

#### Template Engine (3 files)
- template-engines.spec.ts
- template-engines/ai-tags.test.ts
- suites/template-engines/ai-tags-state-access.test.ts

#### AI Integration (16 files)
- ai/ai-variable-resolver.test.ts
- suites/ai/ai-collector.test.ts
- suites/ai/ai-tool.test.ts
- suites/ai/context-collector.test.ts
- suites/ai/cost-tracker.test.ts
- suites/ai/e2e-edit-page-recipe.test.ts
- suites/ai/e2e-recipe-with-helpers.test.ts
- suites/ai/env.test.ts
- suites/ai/output-validator.test.ts
- suites/ai/prompt-assembler.test.ts
- suites/ai/prompt-pipeline.test.ts
- suites/ai/two-pass-integration.test.ts
- suites/ai/transports/api-transport.test.ts
- suites/ai/transports/command-transport.test.ts
- suites/ai/transports/resolve-transport.test.ts
- suites/ai/transports/stdout-transport.test.ts
- suites/ai/transports/transport-integration.test.ts

#### Actions System (5 files)
- v8-actions.spec.ts
- v8-codemod-tool.test.ts
- v8-discovery.spec.ts
- v8-integration/action-tool.test.ts
- v8-recipe-tool-integration.test.ts

#### File Operations (2 files)
- add.spec.ts
- injector.spec.ts

#### Prompts (3 files)
- prompts.test.ts
- interactive-parameter-resolution.test.ts
- parameter-resolver-prompts.test.ts

#### Scaffolding (1 file)
- scaffolding.test.ts

#### E2E Tests (5 files)
- e2e/cli-output.test.ts
- e2e/full-workflow.test.ts
- e2e/generated-file-content.test.ts
- e2e/nested-sequence-step-counting.test.ts
- e2e/nextjs-recipe-real.test.ts

### Supporting Files Migrated

#### Fixtures
- fixtures/ directory (complete copy)
  - ai-2pass/ templates
  - app/ action fixtures
  - metaverse/ hygen templates
  - params/ template overrides
  - templates/ test templates
  - Various .jig.t test templates

#### Test Utilities
- util/enquirer.ts
- util/fixtures.ts
- util/fixtures.spec.ts

#### Snapshots
- __snapshots__/add.spec.ts.snap
- __snapshots__/context.spec.ts.snap
- __snapshots__/injector.spec.ts.snap

## Import Path Updates

### Package Import Changes
- `@hypergen/core` → `@hypercli/core` (1 occurrence in recipe-step-system-integration.test.ts)

### Relative Import Paths
All relative imports remain unchanged as the directory structure was preserved:
- Tests at root: `../src/...`
- Tests in subdirs: `../../src/...` or `../../../src/...`
- Test utilities: `./util/fixtures.js`, etc.

## Files NOT Migrated

The following test files from hypergen/tests/ were NOT included in the migration spec and were not copied:
- config/ directory tests (3 files: cookbook-parser, kit-parser, path-resolver)
- utils/ directory tests (1 file: find-project-root)
- Other legacy test files not in the spec

## Next Steps

1. ✅ Create directory structure
2. ✅ Copy all 49+ specified test files
3. ✅ Copy fixtures directory
4. ✅ Copy test utilities (util/)
5. ✅ Copy snapshots
6. ✅ Update package imports (@hypergen/core → @hypercli/core)
7. ⏳ Verify tests run: `bun test` (not executed yet)
8. ⏳ Delete files from hypergen/tests/ (per instruction: "DO NOT delete files from hypergen/tests yet")

## Verification Commands

```bash
# Count test files
find packages/gen/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) | wc -l

# List all test files
find packages/gen/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) | sort

# Run tests
cd packages/gen && bun test
```
