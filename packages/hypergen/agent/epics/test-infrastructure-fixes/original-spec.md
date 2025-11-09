# Original Specification: Test Infrastructure Fixes

## User Request

"Create an epic plan to resolve all the issues"

## Context

After completing testing infrastructure improvements (fixing file organization, tsconfig, bunfig), a full test run revealed 23 failing tests in the `recipe-step-system-integration.test.ts` file.

## Test Failure Summary

### Critical Issues (15 tests)

- **Tool Resolution Failures**: Tests reference `test-component` and `test-action` tools that don't exist
- Error: "Tool not found: test-component (template)"
- Location: `recipe-engine/tools/registry.ts:299`

### High Priority Issues (7 tests)

- **Computed Variable Type**: Validation rejects "computed" type (3 tests)
- **Test Timeouts**: Tests waiting for tools that never resolve (4 tests)

### Medium Priority Issues (5 tests)

- **Error Object Structure**: Arrays contain objects, tests expect strings (2 tests)
- **Type Mismatches**: CLI error assertions fail (2 tests)
- **Missing Validation**: Circular dependency detection not implemented (1 test)

## Goals

1. Fix all 23 failing tests
2. Create proper test infrastructure
3. Enable confident recipe engine development
4. Unblock CI/CD pipeline

## Success Criteria

- `bun test` runs without failures
- Recipe engine functionality properly tested
- Developer confidence in modifications
- Green CI/CD status
