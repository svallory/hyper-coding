# Errors Module

**Structured error handling and recovery system for documentation generation**

## Overview

The errors module provides a comprehensive error handling framework that enables structured error reporting, error recovery, and centralized error management. It includes custom error types with rich context, an error boundary system for fault tolerance, and utilities for error logging and reporting.

## Architecture

### Component Hierarchy

```
DocumentationError (Base)
├── SecurityError - Security violations
├── FileSystemError - File I/O errors
├── ValidationError - Input validation errors
└── ApiModelError - API model loading errors

ErrorBoundary - Error handling wrapper
└── GlobalErrorBoundary - Singleton instance

withErrorBoundary - Method decorator
```

### Design Patterns

- **Error Hierarchy**: Specialized error classes for different error categories
- **Error Boundary**: Try/catch wrapper with fallback and recovery
- **Singleton**: Global error boundary for application-wide error handling
- **Decorator**: Method-level error protection (experimental)
- **Context Object**: Rich error metadata using ErrorContext

## Files

### `DocumentationError.ts`

Custom error types with structured error information.

**Key Components:**

#### `ErrorCode` Enum

Standardized error codes for programmatic error handling:

```typescript
enum ErrorCode {
  // File system errors (7 codes)
  FILE_NOT_FOUND,
  FILE_READ_ERROR,
  FILE_WRITE_ERROR,
  DIRECTORY_NOT_FOUND,
  PATH_TRAVERSAL,
  INVALID_FILENAME,

  // API model errors (3 codes)
  API_LOAD_ERROR,
  API_PARSE_ERROR,
  INVALID_API_JSON,

  // Configuration errors (3 codes)
  INVALID_CONFIGURATION,
  MISSING_REQUIRED_PARAMETER,
  INVALID_PARAMETER_VALUE,

  // Security errors (3 codes)
  SECURITY_VIOLATION,
  COMMAND_INJECTION,
  DANGEROUS_INPUT,

  // Navigation errors (3 codes)
  NAVIGATION_ERROR,
  DOCS_JSON_PARSE_ERROR,
  DOCS_JSON_WRITE_ERROR,

  // Template/rendering errors (6 codes)
  TEMPLATE_ERROR,
  TEMPLATE_NOT_FOUND,
  TEMPLATE_RENDER_ERROR,
  TEMPLATE_COMPILE_ERROR,
  RENDER_ERROR,
  INVALID_MARKDOWN,

  // Type analysis errors (1 code)
  TYPE_ANALYSIS_ERROR,

  // General errors (2 codes)
  UNKNOWN_ERROR,
  VALIDATION_ERROR
}
```

#### `ErrorContext` Interface

Structured metadata for errors:

```typescript
interface ErrorContext {
  resource?: string;      // File/resource that caused the error
  operation?: string;     // Operation being performed
  data?: Record<string, unknown>;  // Additional context
  cause?: Error;          // Original error (for chaining)
  suggestion?: string;    // How to fix the error
}
```

#### `DocumentationError` Class

Base error class with rich context:

```typescript
class DocumentationError extends Error {
  code: ErrorCode;
  context: ErrorContext;
  timestamp: Date;
  isUserError: boolean;  // User error vs system error

  getDetailedMessage(): string;  // Formatted error message
  toJSON(): Record<string, unknown>;  // Serialization
}
```

**Usage Example:**

```typescript
import { DocumentationError, ErrorCode } from '../errors/DocumentationError';

throw new DocumentationError(
  'Template not found',
  ErrorCode.TEMPLATE_NOT_FOUND,
  {
    resource: 'class.liquid',
    operation: 'renderTemplate',
    suggestion: 'Ensure template exists in the template directory'
  }
);
```

#### Specialized Error Classes

**1. SecurityError** - Security violations

```typescript
throw new SecurityError(
  'Path traversal detected',
  ErrorCode.PATH_TRAVERSAL,
  { resource: '../../../etc/passwd', operation: 'validatePath' }
);
```

**2. FileSystemError** - File I/O errors

```typescript
throw new FileSystemError(
  'Failed to write output file',
  ErrorCode.FILE_WRITE_ERROR,
  {
    resource: '/path/to/file.mdx',
    operation: 'writeFile',
    cause: originalError
  }
);
```

**3. ValidationError** - Input validation errors

```typescript
throw new ValidationError(
  'Invalid parameter value',
  {
    operation: 'validateCliInput',
    data: { parameter: 'output-folder', value: '../../etc' }
  }
);
```

**4. ApiModelError** - API model loading errors

```typescript
throw new ApiModelError(
  'Failed to load API package',
  ErrorCode.API_LOAD_ERROR,
  {
    resource: 'my-package.api.json',
    operation: 'loadApiPackage',
    cause: parseError,
    suggestion: 'Ensure the .api.json file is valid'
  }
);
```

**Code Quality:** ⭐⭐⭐⭐⭐
- Well-structured error hierarchy
- Rich context information
- Good serialization support
- Proper prototype chain handling

---

### `ErrorBoundary.ts`

Error boundary system for handling and recovering from errors.

**Key Components:**

#### `ErrorBoundary` Class

Wraps operations with try/catch and optional fallback:

```typescript
const errorBoundary = new ErrorBoundary({
  continueOnError: true,
  maxErrors: 10,
  logErrors: true,
  errorLogPath: './errors.log',
  includeStackTraces: false
});

// Async operation
const result = await errorBoundary.executeAsync(
  async () => {
    // Your operation
    return await processFile(file);
  },
  { resource: file, operation: 'processFile' },
  // Optional fallback
  async () => {
    return await processFileWithDefaults(file);
  }
);

if (result.success) {
  console.log('Success:', result.data);
  if (result.recovered) {
    console.log('Recovered from error using fallback');
  }
} else {
  console.error('Failed:', result.error);
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `continueOnError` | boolean | `true` | Continue processing on errors |
| `maxErrors` | number | `10` | Max errors before failing |
| `logErrors` | boolean | `true` | Log errors to console |
| `errorLogPath` | string | `''` | Path for error log file |
| `includeStackTraces` | boolean | `false` | Include stack traces in logs |

**ErrorResult Interface:**

```typescript
interface ErrorResult<T> {
  success: boolean;
  data?: T;
  error?: DocumentationError;
  recovered?: boolean;  // True if fallback was used
}
```

#### `GlobalErrorBoundary` Singleton

Application-wide error boundary:

```typescript
import { GlobalErrorBoundary } from '../errors/ErrorBoundary';

// Get global instance (creates if needed)
const errorBoundary = GlobalErrorBoundary.getInstance({
  continueOnError: false,
  logErrors: true
});

// Use it
const result = errorBoundary.executeSync(() => {
  return riskyOperation();
});

// Reset (useful for testing)
GlobalErrorBoundary.reset();
```

#### `@withErrorBoundary` Decorator (Experimental)

Add error boundary protection to methods:

```typescript
class MyClass {
  @withErrorBoundary({ operation: 'processData' })
  async processData(data: any): Promise<Result> {
    // Your code - errors are automatically caught
    return await heavyProcessing(data);
  }
}
```

**⚠️ Warning**: The decorator implementation has issues (see Known Issues section).

**Statistics and Reporting:**

```typescript
// Get error statistics
const stats = errorBoundary.getStats();
console.log(`Total errors: ${stats.totalErrors}`);
console.log(`Recovered: ${stats.recoveredCount}`);
console.log(`Should continue: ${stats.shouldContinue}`);

// Generate full error report
const report = errorBoundary.generateErrorReport();
console.log(report);

// Reset counters
errorBoundary.reset();
```

**Code Quality:** ⭐⭐⭐⭐ (see issues below)

## Usage for Contributors

### Throwing Errors

**Basic Error:**
```typescript
throw new DocumentationError(
  'Something went wrong',
  ErrorCode.UNKNOWN_ERROR
);
```

**Error with Context:**
```typescript
throw new DocumentationError(
  'Template rendering failed',
  ErrorCode.TEMPLATE_RENDER_ERROR,
  {
    resource: templatePath,
    operation: 'renderTemplate',
    data: { templateName, variables: Object.keys(data) },
    suggestion: 'Check template syntax for errors'
  }
);
```

**Error with Cause (Chaining):**
```typescript
try {
  JSON.parse(content);
} catch (error) {
  throw new ValidationError(
    'Invalid JSON content',
    {
      resource: filePath,
      operation: 'parseJson',
      cause: error instanceof Error ? error : new Error(String(error))
    }
  );
}
```

### Catching Errors

**Check Error Type:**
```typescript
try {
  await operation();
} catch (error) {
  if (error instanceof SecurityError) {
    console.error('Security violation:', error.getDetailedMessage());
    // Handle security error
  } else if (error instanceof FileSystemError) {
    console.error('File system error:', error.getDetailedMessage());
    // Handle file error
  } else {
    throw error; // Re-throw unknown errors
  }
}
```

**Check Error Code:**
```typescript
try {
  await operation();
} catch (error) {
  if (error instanceof DocumentationError) {
    switch (error.code) {
      case ErrorCode.TEMPLATE_NOT_FOUND:
        console.log('Using default template instead');
        break;
      case ErrorCode.FILE_WRITE_ERROR:
        console.log('Retrying with different path');
        break;
      default:
        throw error;
    }
  }
}
```

### Using Error Boundary

**Simple Async Operation:**
```typescript
const errorBoundary = new ErrorBoundary({ continueOnError: false });

const result = await errorBoundary.executeAsync(
  async () => {
    return await generateDocumentation();
  },
  { operation: 'generateDocumentation' }
);

if (!result.success) {
  throw result.error;
}
```

**With Fallback:**
```typescript
const result = await errorBoundary.executeAsync(
  async () => {
    // Try custom template
    return await renderWithCustomTemplate(data);
  },
  { operation: 'renderTemplate' },
  async () => {
    // Fallback to default template
    return await renderWithDefaultTemplate(data);
  }
);

if (result.recovered) {
  console.warn('Used fallback template');
}
```

**Batch Processing:**
```typescript
const errorBoundary = new ErrorBoundary({
  continueOnError: true,  // Keep processing other files
  maxErrors: 50
});

const results = [];
for (const file of files) {
  const result = await errorBoundary.executeAsync(
    () => processFile(file),
    { resource: file, operation: 'processFile' }
  );

  if (result.success) {
    results.push(result.data);
  }
}

const stats = errorBoundary.getStats();
console.log(`Processed ${results.length}/${files.length} files`);
console.log(`Errors: ${stats.totalErrors}, Recovered: ${stats.recoveredCount}`);
```

### Error Logging

**Console Logging Only:**
```typescript
const errorBoundary = new ErrorBoundary({
  logErrors: true,
  errorLogPath: ''  // No file logging
});
```

**File Logging:**
```typescript
const errorBoundary = new ErrorBoundary({
  logErrors: true,
  errorLogPath: './logs/errors.json',
  includeStackTraces: true  // For debugging
});
```

**Custom Logging:**
```typescript
try {
  await operation();
} catch (error) {
  if (error instanceof DocumentationError) {
    // Log to your custom logger
    logger.error({
      message: error.message,
      code: error.code,
      context: error.context,
      timestamp: error.timestamp,
      json: error.toJSON()
    });
  }
}
```

### Best Practices

**1. Choose Appropriate Error Type**
```typescript
// ✅ Good: Specific error type
throw new FileSystemError('Cannot read file', ErrorCode.FILE_READ_ERROR, ...);

// ❌ Avoid: Generic error for specific case
throw new DocumentationError('Cannot read file', ErrorCode.UNKNOWN_ERROR);
```

**2. Provide Context**
```typescript
// ✅ Good: Rich context
throw new DocumentationError('Validation failed', ErrorCode.VALIDATION_ERROR, {
  resource: inputFile,
  operation: 'validateInput',
  data: { validator: 'JSONSchema', errors: validationErrors },
  suggestion: 'Check input file against schema'
});

// ❌ Avoid: No context
throw new DocumentationError('Validation failed');
```

**3. Chain Errors**
```typescript
// ✅ Good: Preserve error chain
try {
  await lowLevelOperation();
} catch (error) {
  throw new DocumentationError(
    'High-level operation failed',
    ErrorCode.UNKNOWN_ERROR,
    { cause: error instanceof Error ? error : new Error(String(error)) }
  );
}

// ❌ Avoid: Losing original error
catch (error) {
  throw new DocumentationError('High-level operation failed');
}
```

**4. Use isUserError Flag**
```typescript
// User error - validation, missing files
throw new ValidationError('Invalid input', { ... });  // isUserError = true

// System error - unexpected crash, network error
throw new DocumentationError('Unexpected error', ErrorCode.UNKNOWN_ERROR);  // isUserError = false
```

### Testing Error Handling

**Test Error Throwing:**
```typescript
import { DocumentationError, ErrorCode, ValidationError } from '../errors/DocumentationError';

describe('MyClass', () => {
  it('should throw ValidationError for invalid input', () => {
    const instance = new MyClass();

    expect(() => instance.validate('')).toThrow(ValidationError);
    expect(() => instance.validate('')).toThrow(/Invalid input/);

    try {
      instance.validate('');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.isUserError).toBe(true);
    }
  });
});
```

**Test Error Boundary:**
```typescript
describe('ErrorBoundary', () => {
  it('should catch and wrap errors', async () => {
    const errorBoundary = new ErrorBoundary({ continueOnError: false });

    const result = await errorBoundary.executeAsync(
      async () => {
        throw new Error('Test error');
      },
      { operation: 'test' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(DocumentationError);
    expect(result.error?.code).toBe(ErrorCode.UNKNOWN_ERROR);
  });

  it('should use fallback on error', async () => {
    const errorBoundary = new ErrorBoundary({ continueOnError: true });

    const result = await errorBoundary.executeAsync(
      async () => {
        throw new Error('Primary failed');
      },
      { operation: 'test' },
      async () => {
        return 'fallback result';
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('fallback result');
    expect(result.recovered).toBe(true);
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **Broken Decorator Implementation** (ErrorBoundary.ts:334-357)
   - **Issue**: `@withErrorBoundary` decorator doesn't work correctly
   - **Problems**:
     - Checks `originalMethod.constructor.name === 'AsyncFunction'` which is unreliable
     - Changes method return type to `ErrorResult<T>`, breaking existing code
     - Should check if return value is a Promise instead
   - **Impact**: Decorator is unusable
   - **Fix**: Rewrite decorator to preserve return type:
   ```typescript
   export function withErrorBoundary(context: ErrorContext = {}) {
     return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
       const originalMethod = descriptor.value;

       descriptor.value = async function (this: any, ...args: any[]) {
         try {
           const result = originalMethod.apply(this, args);
           // Check if it's a promise
           if (result && typeof result.then === 'function') {
             return await result;
           }
           return result;
         } catch (error) {
           throw new DocumentationError(
             error instanceof Error ? error.message : String(error),
             ErrorCode.UNKNOWN_ERROR,
             { ...context, operation: `${target.constructor.name}.${propertyKey}`, cause: error }
           );
         }
       };

       return descriptor;
     };
   }
   ```

2. **GlobalErrorBoundary Singleton Issues** (ErrorBoundary.ts:310-329)
   - **Issue**: Singleton pattern creates problems
   - **Problems**:
     - Makes testing difficult (shared state)
     - Cannot reconfigure after first `getInstance()` call
     - Tight coupling throughout codebase
   - **Impact**: Testing and flexibility issues
   - **Fix**: Use dependency injection instead:
   ```typescript
   // Pass error boundary as parameter
   class MarkdownDocumenter {
     constructor(
       options: Options,
       private errorBoundary = new ErrorBoundary()
     ) {}
   }
   ```

3. **File Logging Race Condition** (ErrorBoundary.ts:247-251)
   - **Issue**: Multiple processes could corrupt error log
   - **Problem**: Read-modify-write without locking
   - **Impact**: Corrupted error logs in concurrent scenarios
   - **Fix**: Use append mode or locking library:
   ```typescript
   import * as fs from 'fs';
   fs.appendFileSync(this.options.errorLogPath, logContent);
   ```

4. **No Log Rotation** (ErrorBoundary.ts:232-255)
   - **Issue**: Error log can grow unbounded
   - **Impact**: Disk space issues, slow log writes
   - **Fix**: Add log rotation:
   ```typescript
   private rotateLogIfNeeded(): void {
     const maxSize = 10 * 1024 * 1024; // 10MB
     if (FileSystem.exists(this.options.errorLogPath)) {
       const stats = fs.statSync(this.options.errorLogPath);
       if (stats.size > maxSize) {
         const backup = `${this.options.errorLogPath}.${Date.now()}`;
         fs.renameSync(this.options.errorLogPath, backup);
       }
     }
   }
   ```

### 🟢 Minor

5. **toJSON Serialization Issues** (DocumentationError.ts:156-172)
   - **Issue**: No handling for non-serializable values or circular references
   - **Impact**: JSON.stringify could throw
   - **Fix**: Add safe serialization:
   ```typescript
   public toJSON(): Record<string, unknown> {
     return {
       // ...
       context: {
         // ...
         data: this.safeStringify(this.context.data)
       }
     };
   }

   private safeStringify(obj: any): any {
     const seen = new WeakSet();
     return JSON.parse(JSON.stringify(obj, (key, value) => {
       if (typeof value === 'object' && value !== null) {
         if (seen.has(value)) return '[Circular]';
         seen.add(value);
       }
       return value;
     }));
   }
   ```

6. **Error Code Duplication Risk** (DocumentationError.ts:6-49)
   - **Issue**: Enum values match their keys (`FILE_NOT_FOUND = 'FILE_NOT_FOUND'`)
   - **Impact**: Typos in keys won't be caught
   - **Mitigation**: This is intentional for clarity, but could use const object:
   ```typescript
   export const ErrorCode = {
     FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
     FILE_READ_ERROR: 'ERR_FILE_READ',
     // ...
   } as const;
   ```

7. **No Retry Logic** (ErrorBoundary.ts)
   - **Issue**: No built-in retry mechanism for transient errors
   - **Impact**: One-time failures cause permanent errors
   - **Enhancement**: Add retry support:
   ```typescript
   async executeWithRetry<T>(
     operation: () => Promise<T>,
     options: { maxRetries: number; retryDelay: number }
   ): Promise<ErrorResult<T>>
   ```

8. **Missing Error Recovery Guidance** (ErrorBoundary.ts)
   - **Issue**: No documentation on what fallbacks to use
   - **Impact**: Developers might provide ineffective fallbacks
   - **Fix**: Document common fallback patterns in README

## Performance Characteristics

### Error Creation

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Create error | O(1) | Stack trace capture is expensive |
| getDetailedMessage() | O(1) | String concatenation |
| toJSON() | O(n) | n = context.data size |

### Error Boundary

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| executeAsync/Sync | O(1) + O(operation) | Minimal overhead |
| Fallback execution | O(1) + O(fallback) | Only if primary fails |
| Error logging | O(1) | File I/O is slow |
| File logging | O(n) | n = log file size (read) |

### Optimization Opportunities

1. **Lazy Stack Traces**: Only capture stack trace when requested
2. **Batch Error Logging**: Buffer errors and write in batches
3. **Streaming Log Writes**: Avoid reading entire log file
4. **Error Code Interning**: Reuse error code strings

## Dependencies

### External Dependencies
- `@rushstack/node-core-library` - FileSystem utilities

### Internal Dependencies
- None - standalone module

## Related Modules

- **`cli/`** - Uses errors for CLI error handling
- **`documenters/`** - Uses errors for generation errors
- **`templates/`** - Uses errors for template errors
- **`utils/SecurityUtils`** - Throws security errors

## References

- [Error Handling Best Practices](https://nodejs.org/en/docs/guides/error-handling/)
- [Error.captureStackTrace](https://nodejs.org/api/errors.html#errors_error_capturestacktrace_targetobject_constructoropt)
- [TypeScript Error Handling](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#custom-errors)

---

## Quick Reference

### Creating Errors

```typescript
// Basic
throw new DocumentationError('Message', ErrorCode.UNKNOWN_ERROR);

// With context
throw new DocumentationError('Message', ErrorCode.TEMPLATE_ERROR, {
  resource: 'file.liquid',
  operation: 'render',
  suggestion: 'Check template syntax'
});

// Specialized types
throw new SecurityError('Path traversal detected', ErrorCode.PATH_TRAVERSAL);
throw new FileSystemError('Cannot write', ErrorCode.FILE_WRITE_ERROR);
throw new ValidationError('Invalid input');
throw new ApiModelError('Load failed', ErrorCode.API_LOAD_ERROR);
```

### Using Error Boundary

```typescript
// Simple
const result = await errorBoundary.executeAsync(
  () => operation(),
  { operation: 'operationName' }
);

// With fallback
const result = await errorBoundary.executeAsync(
  () => primaryOperation(),
  { operation: 'operationName' },
  () => fallbackOperation()
);

// Check result
if (!result.success) {
  console.error(result.error.getDetailedMessage());
}
```

### Error Codes by Category

**File System**: `FILE_NOT_FOUND`, `FILE_READ_ERROR`, `FILE_WRITE_ERROR`, `DIRECTORY_NOT_FOUND`, `PATH_TRAVERSAL`, `INVALID_FILENAME`

**Security**: `SECURITY_VIOLATION`, `COMMAND_INJECTION`, `DANGEROUS_INPUT`, `PATH_TRAVERSAL`

**API Model**: `API_LOAD_ERROR`, `API_PARSE_ERROR`, `INVALID_API_JSON`

**Template**: `TEMPLATE_ERROR`, `TEMPLATE_NOT_FOUND`, `TEMPLATE_RENDER_ERROR`, `TEMPLATE_COMPILE_ERROR`

**Validation**: `VALIDATION_ERROR`, `INVALID_PARAMETER_VALUE`, `MISSING_REQUIRED_PARAMETER`
