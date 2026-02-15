# Test Migration Mapping

## Overview
Total test files: 67 files across 59 test files
Current location: `packages/hypergen/tests/`

## @hypercli/core Tests (12 files)

**Config System:**
- `config.test.ts` - Main config loader tests
- `config/cookbook-parser.test.ts` - Cookbook parsing
- `config/kit-parser.test.ts` - Kit parsing
- `config/path-resolver.test.ts` - Path resolution algorithm

**Parsers:**
- `template-parser.test.ts` - Template YAML parsing
- `recipe-step-parser.test.ts` - Recipe step parsing

**Utilities:**
- `utils/find-project-root.test.ts` - Project root detection
- `util/fixtures.spec.ts` - Test fixture utilities

**Errors:**
- `error-handling.test.ts` - Error system tests

**Versioning:**
- `versioning-dependencies.test.ts` - Dependency management

**Example Parsing:**
- `example-recipe-parsing.test.ts` - Example recipe validation

**Total:** 12 test files → `packages/core/tests/`

---

## @hypercli/kit Tests (3 files)

**Kit Management:**
- `suites/kit-install-integration.test.ts` - Kit installation workflow
- `suites/kit-source-resolver.test.ts` - Source resolution (npm, GitHub, local)

**URL Resolution:**
- `url-resolution.spec.ts` - URL caching and resolution

**Total:** 3 test files → `packages/kit/tests/`

---

## @hypercli/gen Tests (49 files)

### Recipe Engine Core (8 files)
- `recipe-engine.test.ts` - Core recipe execution
- `recipe-engine/group-executor.test.ts` - Topological sort, parallel execution
- `recipe-engine/output-evaluator.test.ts` - Step output piping
- `recipe-engine/variable-resolution.test.ts` - Variable resolution
- `suites/recipe-engine/condition-helpers.test.ts` - Conditional helpers
- `recipe-step-system-integration.test.ts` - Step integration
- `conditional-inclusion.test.ts` - Conditional template inclusion
- `cross-action-communication.test.ts` - Cross-action data flow

### Recipe Engine Tools (8 files)
- `recipe-engine/tools/template-tool.test.ts` - Template rendering tool
- `suites/recipe-engine/ensure-dirs-tool.test.ts` - Directory creation tool
- `suites/recipe-engine/install-tool.test.ts` - Package manager tool
- `suites/recipe-engine/patch-tool.test.ts` - File patching tool
- `suites/recipe-engine/query-tool.test.ts` - File query tool
- `suites/recipe-engine/shell-tool-jig-rendering.test.ts` - Shell command tool
- `suites/recipe-engine/on-success-message.test.ts` - Success message rendering
- `suites/recipe-engine/template-tool-collector.test.ts` - Template collector

### Template Engine (3 files)
- `template-engines.spec.ts` - Jig engine tests
- `template-engines/ai-tags.test.ts` - AI tag implementation
- `suites/template-engines/ai-tags-state-access.test.ts` - AI tag state

### AI Integration (16 files)
- `ai/ai-variable-resolver.test.ts` - AI variable resolution
- `suites/ai/ai-collector.test.ts` - AI block collection
- `suites/ai/ai-tool.test.ts` - AI tool step
- `suites/ai/context-collector.test.ts` - Context gathering
- `suites/ai/cost-tracker.test.ts` - Budget tracking
- `suites/ai/e2e-edit-page-recipe.test.ts` - E2E AI recipe
- `suites/ai/e2e-recipe-with-helpers.test.ts` - E2E with helpers
- `suites/ai/env.test.ts` - Environment configuration
- `suites/ai/output-validator.test.ts` - Output validation
- `suites/ai/prompt-assembler.test.ts` - Prompt assembly
- `suites/ai/prompt-pipeline.test.ts` - Prompt pipeline
- `suites/ai/transports/api-transport.test.ts` - API transport
- `suites/ai/transports/command-transport.test.ts` - Command transport
- `suites/ai/transports/resolve-transport.test.ts` - Transport resolution
- `suites/ai/transports/stdout-transport.test.ts` - Stdout transport
- `suites/ai/transports/transport-integration.test.ts` - Transport integration
- `suites/ai/two-pass-integration.test.ts` - 2-pass system

### Actions System (5 files)
- `v8-actions.spec.ts` - Action decorator tests
- `v8-codemod-tool.test.ts` - Codemod tool
- `v8-discovery.spec.ts` - Action discovery
- `v8-integration/action-tool.test.ts` - Action tool integration
- `v8-recipe-tool-integration.test.ts` - Recipe tool integration

### File Operations (2 files)
- `add.spec.ts` - File creation (auto-mkdir)
- `injector.spec.ts` - Content injection

### Prompts (3 files)
- `prompts.test.ts` - Clack prompts
- `interactive-parameter-resolution.test.ts` - Interactive resolution
- `parameter-resolver-prompts.test.ts` - Parameter prompts

### Scaffolding (1 file)
- `scaffolding.test.ts` - Template scaffolding

### E2E Tests (5 files)
- `e2e/cli-output.test.ts` - CLI output validation
- `e2e/full-workflow.test.ts` - Complete workflow (17 tests)
- `e2e/generated-file-content.test.ts` - Generated file validation
- `e2e/nested-sequence-step-counting.test.ts` - Step counting
- `e2e/nextjs-recipe-real.test.ts` - Real Next.js recipe

**Total:** 49 test files → `packages/gen/tests/`

---

## @hypercli/cli Tests (0 files)

**Note:** No dedicated CLI tests found in current test suite. CLI commands were likely not fully implemented yet. Future tests would include:
- Command routing tests
- Plugin loading tests
- CoreBaseCommand tests
- Config/system command tests

**Total:** 0 test files → `packages/cli/tests/`

---

## Fixtures and Shared Test Utilities

The `fixtures/` directory contains test data used across multiple packages. Strategy:

1. **Core fixtures** → `packages/core/tests/fixtures/`
   - Config files
   - Kit/cookbook YAML files
   - Template YAML files

2. **Gen fixtures** → `packages/gen/tests/fixtures/`
   - Recipe YAML files
   - Template files (.jig)
   - AI test data

3. **Kits fixtures** → `packages/kit/tests/fixtures/`
   - Kit manifest files
   - Source resolution test data

## Migration Strategy

### Phase 1: Core Tests
Move 12 files to `packages/core/tests/`
- Update imports: `../../src/` → `../src/`
- Update package imports: `hypergen` → `@hypercli/core`

### Phase 2: Kits Tests
Move 3 files to `packages/kit/tests/`
- Update imports: `../../src/` → `../src/`
- Update package imports: `hypergen` → `@hypercli/kit`

### Phase 3: Gen Tests
Move 49 files to `packages/gen/tests/`
- Update imports: `../../src/` → `../src/`
- Update package imports: `hypergen` → `@hypercli/gen`
- Update cross-package imports to use `@hypercli/core`, `@hypercli/kit`

### Phase 4: Shared Fixtures
- Duplicate fixtures to each package as needed
- Or create shared test fixtures package (optional)

### Phase 5: Test Configuration
- Add `vitest.config.ts` to each package
- Configure coverage settings
- Update `package.json` test scripts
- Verify all tests pass

## Import Path Update Patterns

**Before (monolithic):**
```typescript
import { RecipeEngine } from '../../src/recipe-engine'
import { HypergenError } from '../../src/errors'
import type { RecipeConfig } from '../../src/types/recipe'
```

**After (in gen package):**
```typescript
import { RecipeEngine } from '../src/recipe-engine'
import { HypergenError } from '@hypercli/core'
import type { RecipeConfig } from '@hypercli/core'
```

**After (in core package):**
```typescript
import { HypergenConfigLoader } from '../src/config/config-loader'
import { parseKitConfig } from '../src/parsers/kit-parser'
import type { KitConfig } from '../src/types/kit'
```

## Test Count Summary

| Package        | Test Files | Percentage |
| -------------- | ---------- | ---------- |
| @hypercli/core | 12         | 18%        |
| @hypercli/kit  | 3          | 4%         |
| @hypercli/gen  | 49         | 73%        |
| @hypercli/cli  | 0          | 0%         |
| **Total**      | **64**     | **100%**   |

**Note:** Excludes 3 fixture utility files which will be distributed as needed.
