# Hypergen Error System

This module provides comprehensive error handling and validation for Hypergen, with user-friendly messages, actionable suggestions, and context-aware error reporting.

## Overview

The error system consists of:

- **ErrorCode enum** - Standardized error codes for different failure scenarios
- **HypergenError class** - Custom error class with context, suggestions, and severity levels
- **ErrorHandler class** - Static utility for creating and formatting errors
- **Validation utilities** - Functions for parameter and input validation
- **Error recovery helpers** - Utilities for wrapping async operations with error handling

This module is fundamental to Hypergen's reliability and user experience, ensuring that users receive clear, actionable guidance when something goes wrong.

## Architecture and Design Patterns

### Error Classification

Errors are organized into logical categories based on their domain:

- **Configuration errors** - Config file loading and validation issues
- **Template errors** - Template parsing, rendering, and execution failures
- **Action errors** - Action discovery and parameter validation
- **CodeMod errors** - Code transformation and AST parsing failures
- **File system errors** - File and directory operations
- **Generator errors** - Generator discovery and structure validation
- **URL/Network errors** - Template resolution and network communication
- **General errors** - Validation and unknown errors

### Error Hierarchy

```
Error (JavaScript)
  └── HypergenError
       ├── code: ErrorCode
       ├── context: ErrorContext
       ├── suggestions: ErrorSuggestion[]
       ├── isUserError: boolean
       └── severity: 'low' | 'medium' | 'high' | 'critical'
```

### Error Response Strategy

The system uses a **context-aware suggestion model**:

1. **Identify** the error with a specific code
2. **Contextualize** with relevant metadata (files, parameters, templates)
3. **Suggest** actionable solutions specific to the error code
4. **Format** user-friendly output for CLI display

## Key Files and Purposes

### hypergen-errors.ts

The single comprehensive file containing all error handling logic:

#### ErrorCode Enum (lines 8-71)
Defines 50+ error codes organized by category:
- Configuration (CONFIG_*)
- Templates (TEMPLATE_*)
- Actions (ACTION_*)
- CodeMods (CODEMOD_*)
- File system (FILE_*, DIRECTORY_*)
- Generators (GENERATOR_*)
- URLs and network (URL_*, NETWORK_*)

#### ErrorContext Interface (lines 80-131)
Rich context object with optional properties for:
- Location information (file, line, column)
- Execution context (action, function, phase)
- Template context (templatePath, extends, variables)
- CodeMod context (codemodPath, parser, transformation)
- Tool context (toolType, toolName)
- Generic values (expected, received, value)

Allows capturing detailed information about what went wrong and where.

#### HypergenError Class (lines 133-156)
Custom Error subclass with properties:
- `code` - ErrorCode identifying the specific error
- `context` - ErrorContext with failure details
- `suggestions` - ErrorSuggestion[] with actionable guidance
- `isUserError` - Boolean flag (true = user error, false = internal bug)
- `severity` - Classification as low/medium/high/critical

#### ErrorHandler Class (lines 158-984)
Static utility class with comprehensive error management:

**ERROR_MESSAGES** (lines 159-212)
- Maps each ErrorCode to a default message
- Used when custom messages not provided

**ERROR_SUGGESTIONS** (lines 214-712)
- Maps each ErrorCode to array of ErrorSuggestion objects
- Each suggestion has:
  - `title` - Short action title
  - `description` - Explanation of the suggestion
  - `command` - Optional CLI command to try
  - `url` - Optional documentation link

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `createError()` | Factory method to create HypergenError with suggestions |
| `formatError()` | Renders error as formatted CLI output with emojis and structure |
| `handleError()` | Universal error handler that converts any error type to formatted output |
| `createParameterError()` | Specialized method for parameter validation failures |
| `createTemplateError()` | Creates errors for template validation with location info |
| `createActionNotFoundError()` | Specific handler for missing action errors |
| `createFileError()` | Converts file operation errors to HypergenError |
| `extractFileFromError()` | Extracts file paths from Node.js error messages |

#### Validation Utilities (lines 989-1062)

**withErrorHandling()** (lines 989-1010)
- Async wrapper function for error handling
- Catches and converts errors to HypergenError
- Merges error context when needed
- Pattern: `await withErrorHandling(() => operation(), { errorContext })`

**validateParameter()** (lines 1015-1062)
- Validates individual parameters with comprehensive checks
- Supports: type validation, pattern matching, allowed values
- Throws HypergenError on validation failure
- Checks: required, type (string/number/boolean/array), pattern, allowed values

## How the Code Works

### Error Creation Flow

```typescript
// Basic error creation
const error = ErrorHandler.createError(
  ErrorCode.TEMPLATE_NOT_FOUND,
  'Custom message about what happened',
  { file: 'template.ejs.t', templatePath: '_templates/gen' },
  [{ title: 'Solution', description: 'What to do' }]
)

// Using specialized factory methods
const actionError = ErrorHandler.createActionNotFoundError('my-action')
const paramError = ErrorHandler.createParameterError('name', value, 'string')

// Handling Node.js errors
const jsError = new Error('ENOENT: no such file or directory, open /path/file')
const formatted = ErrorHandler.handleError(jsError)
```

### Error Formatting for CLI

```typescript
const error = ErrorHandler.createError(
  ErrorCode.ACTION_NOT_FOUND,
  'Action not found',
  { action: 'test-action' }
)

const output = ErrorHandler.formatError(error)
// Output:
// ❌ Action not found
//    Code: ACTION_NOT_FOUND
//    Action: test-action
//
// 💡 Suggestions:
//    1. List available actions
//       See all available actions
//       $ hypergen list
//    2. Discover generators
//       ...
```

### Parameter Validation

```typescript
// Validate a required string parameter
validateParameter('name', userInput, 'string', true)

// Validate with pattern and allowed values
validateParameter('level', input, 'string', true, '^[a-z]+$', ['low', 'medium', 'high'])

// Throws HypergenError if validation fails
```

### Async Error Wrapping

```typescript
async function loadTemplate(path: string) {
  return withErrorHandling(
    async () => {
      // Load template logic
      return await fs.promises.readFile(path, 'utf-8')
    },
    { file: path, action: 'load_template' }
  )
}
```

## Integration with Other Modules

### Primary Users (18+ modules)

1. **Actions System** (`src/actions/`)
   - `executor.ts` - Validates action execution and parameters
   - `parameter-resolver.ts` - Resolves and validates action parameters
   - `pipelines.ts` - Error handling in action pipelines
   - `lifecycle.ts` - Lifecycle hook error handling

2. **Config System** (`src/config/`)
   - `hypergen-config.ts` - Configuration file loading errors
   - `template-parser.ts` - Template.yml parsing and validation
   - `template-composition.ts` - Template inheritance errors
   - `dependency-manager.ts` - Dependency resolution errors

3. **Recipe Engine** (`src/recipe-engine/`)
   - `recipe-engine.ts` - Recipe execution orchestration
   - `step-executor.ts` - Individual step execution errors
   - Multiple tool implementations - Tool-specific errors

4. **CLI** (`src/cli/cli.ts`)
   - Command execution and error reporting
   - User-facing error output formatting

5. **Other Systems**
   - `src/prompts/interactive-prompts.ts` - Interactive input validation
   - `src/actions/communication.ts` - Communication error handling

### Error Flow Example

```
User runs CLI command
  ↓
CLI validates input → validateParameter()
  ↓
Config loads → ErrorHandler.createError()
  ↓
Template renders → withErrorHandling()
  ↓
Action executes → Catch and format with ErrorHandler.formatError()
  ↓
Output to user with suggestions
```

## Dependencies and Relationships

### No External Dependencies
The error system has **zero external dependencies** - it only uses TypeScript and built-in types. This keeps it lightweight and ensures it's always available.

### Exported Public API

```typescript
// Error types and enums
export enum ErrorCode { ... }
export interface ErrorSuggestion { ... }
export interface ErrorContext { ... }
export class HypergenError extends Error { ... }
export class ErrorHandler { ... }

// Utilities
export async function withErrorHandling<T>(...): Promise<T>
export function validateParameter(...): void
```

### How Modules Use These Exports

1. **Error Creation**: Most modules use `ErrorHandler.createError()` with specific error codes
2. **Error Formatting**: CLI uses `ErrorHandler.formatError()` to display errors
3. **Validation**: Parameter handling uses `validateParameter()` for input validation
4. **Error Wrapping**: Async operations wrapped with `withErrorHandling()` for safety
5. **Type Checking**: Modules check `instanceof HypergenError` to distinguish error types

## Important Implementation Details

### Error Message Curation

Each ErrorCode has:
11. A **base message** in ERROR_MESSAGES - clear, concise, no jargon
12. A **suggestion array** in ERROR_SUGGESTIONS - 1-3 actionable steps

The base message should be:
- 5-10 words maximum
- Descriptive but not verbose
- Free of technical jargon

Suggestions should:
- Offer concrete solutions
- Include commands when applicable
- Link to documentation when helpful

### Severity Levels

- **low** - Non-critical issues that don't prevent operation
- **medium** - Default level; operation failed but not catastrophic
- **high** - Significant failure affecting multiple operations
- **critical** - System-level failure, data loss risk, security issue

Currently defaulted to 'medium' but available for future enhancement.

### User Error vs Internal Error

- **isUserError: true** - User did something wrong (invalid config, missing file, bad parameter)
- **isUserError: false** - Internal bug (null pointer, unexpected state, framework issue)

This distinction helps with:
- Error reporting and metrics
- Support prioritization
- Feature requests vs bug reports

### Error Context Design

Context is **flexible and optional** - only include relevant fields:
- Don't pollute context with null/undefined values
- Use specific fields for domain concepts
- Falls back to generic `cause` field for exceptions

```typescript
// Good: Specific context
ErrorHandler.createError(ErrorCode.TEMPLATE_NOT_FOUND, 
  'Template missing', 
  { templatePath: '_templates/gen', template: 'action' }
)

// Less ideal: Generic context
ErrorHandler.createError(ErrorCode.TEMPLATE_NOT_FOUND, 
  'Template missing', 
  { cause: 'Could not find template at path' }
)
```

### Node.js Error Detection

`ErrorHandler.handleError()` detects common Node.js errors by pattern matching:
- ENOENT → FILE_NOT_FOUND
- EACCES → FILE_PERMISSION_DENIED
- EEXIST → FILE_ALREADY_EXISTS
- ENOTDIR → DIRECTORY_NOT_FOUND
- Others → UNKNOWN_ERROR

This allows graceful handling of Node.js errors with proper suggestions.

## How to Contribute

### Adding a New Error Code

1. **Add to ErrorCode enum** in hypergen-errors.ts
   ```typescript
   enum ErrorCode {
     // Existing codes...
     MY_NEW_ERROR = 'MY_NEW_ERROR'
   }
   ```

2. **Add to ERROR_MESSAGES**
   ```typescript
   [ErrorCode.MY_NEW_ERROR]: 'Clear, concise message'
   ```

3. **Add to ERROR_SUGGESTIONS**
   ```typescript
   [ErrorCode.MY_NEW_ERROR]: [
     {
       title: 'Solution 1',
       description: 'What to do',
       command: 'hypergen command' // optional
     }
   ]
   ```

4. **Write tests** in `/work/hyperdev/packages/hypergen/tests/error-handling.test.ts`

### Adding Context Fields

1. **Add to ErrorContext interface** if not already present
2. **Document in error-related comments** what the field represents
3. **Use in error creation** when that context is relevant
4. **Format in ErrorHandler.formatError()** if it's user-facing

### Adding Validation Rules

1. **Create domain-specific validator** if needed
2. **Use `validateParameter()`** for parameter validation
3. **Throw from validator** - don't return boolean
4. **Include helpful error message** in context

### Testing Error Handling

```typescript
import { ErrorHandler, ErrorCode, HypergenError } from '../src/errors/hypergen-errors'
import { describe, it, expect } from 'bun:test'

describe('MyFeature Error Handling', () => {
  it('should throw specific error for X', () => {
    expect(() => {
      // Your code that throws
    }).toThrow(HypergenError)
    
    // Or for async:
    expect(async () => {
      await myAsyncOperation()
    }).rejects.toThrow()
  })
  
  it('should format error with suggestions', () => {
    const error = ErrorHandler.createError(ErrorCode.MY_ERROR)
    const formatted = ErrorHandler.formatError(error)
    expect(formatted).toContain('💡 Suggestions:')
  })
})
```

## Best Practices

### Do

- Use `ErrorHandler.createError()` for custom errors
- Include rich context when available
- Use specific error codes, not generic ones
- Throw early when validation fails
- Add suggestions that are actually helpful
- Format errors before CLI output
- Wrap async operations with `withErrorHandling()`

### Don't

- Catch and ignore errors silently
- Re-throw errors without adding context
- Use generic UNKNOWN_ERROR when a specific code exists
- Create errors with empty suggestions
- Leave error messages in English that don't match error domain
- Pass undefined/null in ErrorContext
- Use error codes for flow control (use try/catch instead)

## Related Files and Resources

- **Tests**: `/work/hyperdev/packages/hypergen/tests/error-handling.test.ts`
- **Main CLI**: `/work/hyperdev/packages/hypergen/src/bin.ts`
- **Action Executor**: `/work/hyperdev/packages/hypergen/src/actions/executor.ts`
- **Template Parser**: `/work/hyperdev/packages/hypergen/src/config/template-parser.ts`
- **Documentation**: https://hypergen.dev/docs/error-handling

## Summary

The Hypergen error system is a centralized, extensible framework for:

1. **Consistent error handling** across the entire codebase
2. **User-friendly messages** with domain-specific context
3. **Actionable suggestions** that guide users toward solutions
4. **Rich debugging information** for developers
5. **Flexible severity levels** for error prioritization

By standardizing error handling, the system improves the user experience, reduces support burden, and makes the codebase more maintainable.
## TODO

-   [ ] **Error Context (`hypergen-errors.ts`)**:
    *   Add `templatePath` to `ValidationContext` in `validateVariableValue` function.