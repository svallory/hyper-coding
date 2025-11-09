# Test Infrastructure Fixes - Product Requirements Document

## Executive Summary

**Problem**: The Hypergen package has 23 failing integration tests in the recipe engine test suite, preventing confident development and deployment of recipe-related features. Tests fail due to missing test fixtures, incomplete validation logic, and error structure inconsistencies.

**Solution**: Create proper test infrastructure with real minimal test tools, extend validation schema to support computed variables, fix error object structures, and implement missing validation logic in a phased approach.

**Value**:

- Enables confident recipe engine development and refactoring
- Provides regression detection for multi-step code generation workflows
- Unblocks CI/CD pipeline
- Improves developer experience and velocity

## Requirements Analysis

### Functional Requirements

**Core Features**:

1. **Test Tool Fixtures** - Enable recipe engine testing - PASS when real tools execute in test environment
   - Create minimal `test-component` template tool
   - Create minimal `test-action` action tool
   - Register tools with test tool registry
   - Support variable passing and file generation
   - Provide predictable, deterministic output

2. **Computed Variable Support** - Allow dynamic variable types - PASS when validation accepts computed variables
   - Extend recipe validation schema to include "computed" type
   - Document computed variable semantics
   - Ensure type safety in recipe execution
   - Maintain backward compatibility with existing variable types

3. **Error Structure Consistency** - Standardize error reporting - PASS when all error assertions match
   - Normalize validation error array structures (strings vs objects)
   - Fix CLI error output to match test expectations
   - Ensure error.stdout/stderr are always strings
   - Document error structure patterns

4. **Circular Dependency Detection** - Validate recipe dependencies - PASS when circular deps rejected
   - Implement dependency graph analysis
   - Detect cycles in step dependencies
   - Provide clear error messages for circular references
   - Integrate with existing validation flow

**User Workflows**:

1. **Developer runs tests** - `bun test` → All tests pass → Developer confidence increased
2. **CI/CD pipeline** - Push commit → Tests run → Green status → Merge allowed
3. **Recipe development** - Modify recipe engine → Run tests → Validate behavior → Deploy safely

### Technical Requirements

**Performance**:

- Individual tests complete within 5000ms timeout
- Full test suite completes in under 5 minutes
- Test fixtures add minimal overhead (<100ms per test)
- No performance regression in production code

**Security**:

- Test fixtures do not execute arbitrary code
- No sensitive data in test fixtures
- Test isolation prevents cross-test pollution
- No test-only backdoors in production

**Scalability**:

- Test fixtures support all tested features
- Validation schema extensible for future types
- Error handling scales to additional validation rules
- Pattern reusable for future recipe tests

**Integration**:

- Test tools integrate with existing tool registry
- Validation uses existing schema system
- Error handling follows HypergenError patterns
- No breaking changes to public APIs

### Non-Functional Requirements

**Usability**:

- Test fixtures are simple and readable
- Error messages are clear and actionable
- Test failures provide diagnostic information
- Documentation explains fixture usage

**Reliability**:

- Tests are deterministic and repeatable
- No flaky tests due to timing issues
- Test fixtures behave consistently
- Error handling is comprehensive

**Maintainability**:

- Test fixtures follow existing patterns
- Code is well-documented
- Changes are localized and minimal
- Future developers can extend fixtures

**Compliance**:

- Follows TypeScript best practices
- Adheres to Bun test conventions
- Maintains project coding standards
- No breaking changes to APIs

## Implementation Strategy

### Technical Architecture

**Components**:

1. **Test Fixtures** (`tests/fixtures/recipe-tools/`)
   - `test-component-tool.ts` - Minimal template tool implementation
   - `test-action-tool.ts` - Minimal action tool implementation
   - `registry-setup.ts` - Test tool registry configuration
   - Responsibilities: Provide real minimal tools for testing

2. **Validation Schema Extensions** (`src/recipe-engine/schema/`)
   - `recipe-schema.ts` - Add computed type to variable schema
   - `validation.ts` - Update validation logic
   - `types.ts` - Add ComputedVariable type
   - Responsibilities: Support computed variable type

3. **Error Handling Fixes** (`src/errors/`)
   - `hypergen-errors.ts` - Normalize error structures
   - `validation-errors.ts` - Ensure string error messages
   - CLI error handlers - Fix stdout/stderr handling
   - Responsibilities: Consistent error structures

4. **Validation Logic** (`src/recipe-engine/validation/`)
   - `dependency-validator.ts` - Circular dependency detection
   - `step-validator.ts` - Step name uniqueness
   - `validators/index.ts` - Validator orchestration
   - Responsibilities: Complete validation rules

**Data Model**:

```typescript
// Test Tool Interface
interface TestTool {
  name: string;
  type: 'template' | 'action';
  execute(context: ToolContext,): Promise<ToolResult>;
  validate(params: unknown,): ValidationResult;
}

// Computed Variable Type
interface ComputedVariable {
  type: 'computed';
  name: string;
  expression: string;
  dependencies?: string[];
}

// Error Structure
interface ValidationError {
  code: string;
  message: string; // Always a string
  context?: Record<string, unknown>;
}
```

**API Design**:

No new public APIs - internal test infrastructure only:

- Test tools registered via `registerTestTools(registry)`
- Validation schema extended in-place
- Error handling maintains existing signatures

**Frontend**: N/A - Backend/testing infrastructure only

### Development Phases

**Phase 1 - Critical Infrastructure (1-2 days)**:

- Create `tests/fixtures/recipe-tools/` directory structure
- Implement `test-component` minimal template tool
- Implement `test-action` minimal action tool
- Create registry setup helper
- Update tests to use fixture tools
- **Outcome**: 15 tool resolution failures fixed

**Phase 2 - Validation Enhancements (1 day)**:

- Extend recipe schema with computed variable type
- Update validation logic to support computed
- Fix validation error array structures
- Fix CLI error stdout/stderr handling
- **Outcome**: 5 validation failures fixed

**Phase 3 - Complete Validation (0.5 days)**:

- Implement circular dependency detection
- Add step name uniqueness validation
- Fix remaining edge case assertions
- **Outcome**: 3 remaining failures fixed

### Dependencies & Risks

**Technical Dependencies**:

- Bun test framework (already in use)
- Existing tool registry system
- Recipe validation schema
- HypergenError system

**Business Dependencies**:

- None - internal development infrastructure

**Risk Mitigation**:

| Risk                                  | Likelihood | Impact | Mitigation                                                     |
| ------------------------------------- | ---------- | ------ | -------------------------------------------------------------- |
| Test fixtures diverge from real tools | Medium     | Medium | Document fixture limitations, review against real tools        |
| Validation changes break production   | Low        | High   | Extensive testing, backward compatibility checks               |
| Performance regression                | Low        | Medium | Performance benchmarks, timeout monitoring                     |
| Incomplete fixture implementation     | Medium     | High   | Start with minimal viable fixture, iterate based on test needs |

## Success Criteria

**Measurable Outcomes**:

- 23/23 tests in recipe-step-system-integration.test.ts pass
- Zero new test failures introduced
- Test suite completes in under 5 minutes
- All tests complete within individual timeouts
- No performance regression in production code

**Acceptance Criteria**:

- [ ] Tool resolution works for all recipe tests
- [ ] Computed variables validate correctly
- [ ] Error structures are consistent
- [ ] Circular dependencies are detected
- [ ] CLI error output matches test expectations
- [ ] Test fixtures follow existing patterns
- [ ] Code is documented and maintainable
- [ ] Full test suite passes with `bun test`

**Testing Strategy**:

1. **Unit Tests**: Each fixture component tested individually
2. **Integration Tests**: Recipe engine tests pass with fixtures
3. **Regression Tests**: Existing tests remain green
4. **Manual Validation**: Run full test suite locally
5. **CI/CD Validation**: Verify pipeline passes

## Implementation Notes

### For Task Generation

**Expected Task Breakdown** (18-25 tasks):

**Infrastructure Tasks** (4-5 tasks):

- Create test fixtures directory structure
- Set up test tool registry helper
- Document fixture usage patterns
- Add fixture type definitions

**Test Tool Implementation** (6-8 tasks):

- Implement test-component tool execute method
- Implement test-component tool validation
- Implement test-action tool execute method
- Implement test-action tool validation
- Add tool fixture documentation
- Create tool factory helpers
- Update test imports to use fixtures
- Add integration test for fixtures

**Validation Enhancement** (4-5 tasks):

- Add computed variable type to schema
- Update validation logic for computed
- Fix validation error structures
- Fix CLI error handling
- Add validation tests

**Complete Validation** (4-5 tasks):

- Implement circular dependency detection
- Add dependency graph builder
- Implement step name validator
- Fix remaining test assertions
- Add edge case tests

**Testing & Documentation** (2-3 tasks):

- Run full test suite and verify
- Update test documentation
- Add troubleshooting guide

### Technical Guidance

**Leverage existing patterns**:

- Follow tool implementation patterns from `src/recipe-engine/tools/template-tool.ts`
- Use HypergenError for all error handling
- Follow test patterns from `tests/util/fixtures.spec.ts`
- Use Bun test API: `describe`, `it`, `expect`, `beforeEach`

**Follow established conventions**:

- TypeScript strict null checks
- Async/await for all async operations
- Comprehensive JSDoc documentation
- Test fixtures in `tests/fixtures/`
- Clear error messages with context

**Integration considerations**:

- Test fixtures must work with step executor
- Validation changes must be backward compatible
- Error handling must maintain existing signatures
- Tool registry must support test tools alongside real tools

**Testing approach**:

- Test each fixture component individually
- Integration test with step executor
- Regression test existing functionality
- Manual validation of full suite
