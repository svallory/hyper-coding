/**
 * Custom error types for documentation generation errors.
 * Provides structured error information for better error handling and debugging.
 */

export enum ErrorCode {
  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  INVALID_FILENAME = 'INVALID_FILENAME',

  // API model errors
  API_LOAD_ERROR = 'API_LOAD_ERROR',
  API_PARSE_ERROR = 'API_PARSE_ERROR',
  INVALID_API_JSON = 'INVALID_API_JSON',

  // Configuration errors
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  MISSING_REQUIRED_PARAMETER = 'MISSING_REQUIRED_PARAMETER',
  INVALID_PARAMETER_VALUE = 'INVALID_PARAMETER_VALUE',

  // Security errors
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  COMMAND_INJECTION = 'COMMAND_INJECTION',
  DANGEROUS_INPUT = 'DANGEROUS_INPUT',

  // Navigation errors
  NAVIGATION_ERROR = 'NAVIGATION_ERROR',
  DOCS_JSON_PARSE_ERROR = 'DOCS_JSON_PARSE_ERROR',
  DOCS_JSON_WRITE_ERROR = 'DOCS_JSON_WRITE_ERROR',

  // Template/rendering errors
  TEMPLATE_ERROR = 'TEMPLATE_ERROR',
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  TEMPLATE_RENDER_ERROR = 'TEMPLATE_RENDER_ERROR',
  TEMPLATE_COMPILE_ERROR = 'TEMPLATE_COMPILE_ERROR',
  RENDER_ERROR = 'RENDER_ERROR',
  INVALID_MARKDOWN = 'INVALID_MARKDOWN',

  // Type analysis errors
  TYPE_ANALYSIS_ERROR = 'TYPE_ANALYSIS_ERROR',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}

export interface ErrorContext {
  /**
   * The file or resource that caused the error
   */
  resource?: string;

  /**
   * The operation being performed when the error occurred
   */
  operation?: string;

  /**
   * Additional context data relevant to the error
   */
  data?: Record<string, unknown>;

  /**
   * The original error that caused this error (for error chaining)
   */
  cause?: Error;

  /**
   * Suggestion for how to fix the error
   */
  suggestion?: string;
}

/**
 * Base class for all documentation generation errors.
 */
export class DocumentationError extends Error {
  /**
   * Standardized error code for programmatic handling
   */
  public readonly code: ErrorCode;

  /**
   * Additional context about the error
   */
  public readonly context: ErrorContext;

  /**
   * Timestamp when the error occurred
   */
  public readonly timestamp: Date;

  /**
   * Whether this error represents a user error (vs system error)
   */
  public readonly isUserError: boolean;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    context: ErrorContext = {},
    isUserError: boolean = false
  ) {
    super(message);
    this.name = 'DocumentationError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.isUserError = isUserError;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, DocumentationError.prototype);

    // Capture stack trace if available
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DocumentationError);
    }
  }

  /**
   * Get a detailed error message including context
   */
  public getDetailedMessage(): string {
    let detailedMessage = `[${this.code}] ${this.message}`;

    if (this.context.resource) {
      detailedMessage += `\n  Resource: ${this.context.resource}`;
    }

    if (this.context.operation) {
      detailedMessage += `\n  Operation: ${this.context.operation}`;
    }

    if (this.context.suggestion) {
      detailedMessage += `\n  Suggestion: ${this.context.suggestion}`;
    }

    if (this.context.cause) {
      detailedMessage += `\n  Caused by: ${this.context.cause.message}`;
    }

    if (this.context.data && Object.keys(this.context.data).length > 0) {
      detailedMessage += `\n  Context: ${JSON.stringify(this.context.data, null, 2)}`;
    }

    return detailedMessage;
  }

  /**
   * Convert error to JSON for logging or transmission
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      isUserError: this.isUserError,
      context: {
        resource: this.context.resource,
        operation: this.context.operation,
        suggestion: this.context.suggestion,
        data: this.context.data,
        cause: this.context.cause?.message
      },
      stack: this.stack
    };
  }
}

/**
 * Security-related errors
 */
export class SecurityError extends DocumentationError {
  constructor(message: string, code: ErrorCode = ErrorCode.SECURITY_VIOLATION, context: ErrorContext = {}) {
    super(message, code, context, true);
    this.name = 'SecurityError';
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}

/**
 * File system-related errors
 */
export class FileSystemError extends DocumentationError {
  constructor(message: string, code: ErrorCode = ErrorCode.FILE_WRITE_ERROR, context: ErrorContext = {}) {
    super(message, code, context);
    this.name = 'FileSystemError';
    Object.setPrototypeOf(this, FileSystemError.prototype);
  }
}

/**
 * Validation errors for user input
 */
export class ValidationError extends DocumentationError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, ErrorCode.VALIDATION_ERROR, context, true);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * API model-related errors
 */
export class ApiModelError extends DocumentationError {
  constructor(message: string, code: ErrorCode = ErrorCode.API_LOAD_ERROR, context: ErrorContext = {}) {
    super(message, code, context);
    this.name = 'ApiModelError';
    Object.setPrototypeOf(this, ApiModelError.prototype);
  }
}