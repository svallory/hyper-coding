/**
 * Error boundary system for handling and recovering from errors during documentation generation.
 * Provides centralized error handling with fallback strategies and error reporting.
 */

import { FileSystem } from '@rushstack/node-core-library';
import { DocumentationError, ErrorContext, ErrorCode } from './DocumentationError';
import * as path from 'path';

export interface ErrorBoundaryOptions {
  /**
   * Whether to continue processing when encountering non-critical errors
   */
  continueOnError?: boolean;

  /**
   * Maximum number of errors before failing completely
   */
  maxErrors?: number;

  /**
   * Whether to log detailed error information
   */
  logErrors?: boolean;

  /**
   * Path to log error details (optional)
   */
  errorLogPath?: string;

  /**
   * Whether to include stack traces in error logs
   */
  includeStackTraces?: boolean;
}

export interface ErrorResult<T> {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * The result data if successful
   */
  data?: T;

  /**
   * The error if failed
   */
  error?: DocumentationError;

  /**
   * Whether this was recovered from a previous error
   */
  recovered?: boolean;
}

/**
 * Error boundary for handling errors during documentation generation.
 */
export class ErrorBoundary {
  private errorCount: number = 0;
  private recoveredCount: number = 0;
  private errors: DocumentationError[] = [];
  private readonly options: Required<ErrorBoundaryOptions>;

  constructor(options: ErrorBoundaryOptions = {}) {
    this.options = {
      continueOnError: options.continueOnError ?? true,
      maxErrors: options.maxErrors ?? 10,
      logErrors: options.logErrors ?? true,
      errorLogPath: options.errorLogPath || '',
      includeStackTraces: options.includeStackTraces ?? false
    };
  }

  /**
   * Execute a function with error boundary protection.
   *
   * @param operation - The function to execute
   * @param context - Context information for error reporting
   * @param fallback - Optional fallback function to try on error
   * @returns ErrorResult with either success data or error information
   */
  public async executeAsync<T>(
    operation: () => Promise<T>,
    context: ErrorContext = {},
    fallback?: () => Promise<T>
  ): Promise<ErrorResult<T>> {
    try {
      const result = await operation();
      return { success: true, data: result };
    } catch (error) {
      return await this.handleError(error, context, fallback);
    }
  }

  /**
   * Execute a synchronous function with error boundary protection.
   *
   * @param operation - The function to execute
   * @param context - Context information for error reporting
   * @param fallback - Optional fallback function to try on error
   * @returns ErrorResult with either success data or error information
   */
  public executeSync<T>(
    operation: () => T,
    context: ErrorContext = {},
    fallback?: () => T
  ): ErrorResult<T> {
    try {
      const result = operation();
      return { success: true, data: result };
    } catch (error) {
      return this.handleErrorSync(error, context, fallback);
    }
  }

  /**
   * Handle an error and optionally recover using a fallback.
   */
  private async handleError<T>(
    error: unknown,
    context: ErrorContext,
    fallback?: () => Promise<T>
  ): Promise<ErrorResult<T>> {
    const docError = this.wrapError(error, context);

    // Log the error
    this.logError(docError);

    // Try fallback if available
    if (fallback && this.options.continueOnError && this.errorCount < this.options.maxErrors) {
      try {
        const fallbackResult = await fallback();
        this.recoveredCount++;
        return { success: true, data: fallbackResult, recovered: true };
      } catch (fallbackError) {
        const fallbackDocError = this.wrapError(fallbackError, {
          ...context,
          operation: `${context.operation} (fallback)`
        });
        this.logError(fallbackDocError);
        return { success: false, error: fallbackDocError };
      }
    }

    // Check if we should continue or fail
    if (!this.options.continueOnError || this.errorCount >= this.options.maxErrors) {
      return { success: false, error: docError };
    }

    return { success: false, error: docError };
  }

  /**
   * Handle a synchronous error and optionally recover using a fallback.
   */
  private handleErrorSync<T>(
    error: unknown,
    context: ErrorContext,
    fallback?: () => T
  ): ErrorResult<T> {
    const docError = this.wrapError(error, context);

    // Log the error
    this.logError(docError);

    // Try fallback if available
    if (fallback && this.options.continueOnError && this.errorCount < this.options.maxErrors) {
      try {
        const fallbackResult = fallback();
        this.recoveredCount++;
        return { success: true, data: fallbackResult, recovered: true };
      } catch (fallbackError) {
        const fallbackDocError = this.wrapError(fallbackError, {
          ...context,
          operation: `${context.operation} (fallback)`
        });
        this.logError(fallbackDocError);
        return { success: false, error: fallbackDocError };
      }
    }

    // Check if we should continue or fail
    if (!this.options.continueOnError || this.errorCount >= this.options.maxErrors) {
      return { success: false, error: docError };
    }

    return { success: false, error: docError };
  }

  /**
   * Wrap an unknown error in a DocumentationError.
   */
  private wrapError(error: unknown, context: ErrorContext): DocumentationError {
    if (error instanceof DocumentationError) {
      return error;
    }

    if (error instanceof Error) {
      return new DocumentationError(
        error.message,
        ErrorCode.UNKNOWN_ERROR,
        { ...context, cause: error }
      );
    }

    return new DocumentationError(
      String(error),
      ErrorCode.UNKNOWN_ERROR,
      context
    );
  }

  /**
   * Log an error to console and optionally to file.
   */
  private logError(error: DocumentationError): void {
    this.errorCount++;
    this.errors.push(error);

    if (!this.options.logErrors) {
      return;
    }

    // Log to console
    console.error(`[ERROR] ${error.getDetailedMessage()}`);

    // Log to file if path is specified
    if (this.options.errorLogPath) {
      try {
        const logEntry = {
          timestamp: new Date().toISOString(),
          error: error.toJSON(),
          ...(this.options.includeStackTraces && { stack: error.stack })
        };

        const logContent = JSON.stringify(logEntry, null, 2) + '\n';

        // Ensure directory exists
        const logDir = path.dirname(this.options.errorLogPath);
        FileSystem.ensureFolder(logDir);

        // Append to log file
        const existingContent = FileSystem.exists(this.options.errorLogPath)
          ? FileSystem.readFile(this.options.errorLogPath)
          : '';

        FileSystem.writeFile(this.options.errorLogPath, existingContent + logContent);
      } catch (logError) {
        console.error(`[ERROR] Failed to write error log: ${logError instanceof Error ? logError.message : String(logError)}`);
      }
    }
  }

  /**
   * Get statistics about errors encountered.
   */
  public getStats(): {
    totalErrors: number;
    recoveredCount: number;
    errors: DocumentationError[];
    shouldContinue: boolean;
  } {
    return {
      totalErrors: this.errorCount,
      recoveredCount: this.recoveredCount,
      errors: [...this.errors],
      shouldContinue: this.options.continueOnError && this.errorCount < this.options.maxErrors
    };
  }

  /**
   * Reset error counters and history.
   */
  public reset(): void {
    this.errorCount = 0;
    this.recoveredCount = 0;
    this.errors = [];
  }

  /**
   * Create a summary report of all errors.
   */
  public generateErrorReport(): string {
    if (this.errors.length === 0) {
      return 'No errors encountered.';
    }

    const stats = this.getStats();
    let report = `Error Summary:\n`;
    report += `Total Errors: ${stats.totalErrors}\n`;
    report += `Recovered: ${stats.recoveredCount}\n`;
    report += `Should Continue: ${stats.shouldContinue}\n\n`;

    report += `Error Details:\n`;
    this.errors.forEach((error, index) => {
      report += `\n${index + 1}. ${error.getDetailedMessage()}\n`;
    });

    return report;
  }
}

/**
 * Global error boundary instance for the application.
 */
export class GlobalErrorBoundary {
  private static instance: ErrorBoundary | null = null;

  /**
   * Get the global error boundary instance.
   */
  public static getInstance(options?: ErrorBoundaryOptions): ErrorBoundary {
    if (!this.instance) {
      this.instance = new ErrorBoundary(options);
    }
    return this.instance;
  }

  /**
   * Reset the global error boundary instance.
   */
  public static reset(): void {
    this.instance = null;
  }
}

/**
 * Decorator for adding error boundary protection to methods.
 */
export function withErrorBoundary<T extends (...args: any[]) => any>(
  context: ErrorContext = {}
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (this: any, ...args: Parameters<T>): ReturnType<T> {
      const errorBoundary = GlobalErrorBoundary.getInstance();

      if (originalMethod.constructor.name === 'AsyncFunction') {
        return errorBoundary.executeAsync(
          () => originalMethod.apply(this, args),
          { ...context, operation: `${target.constructor.name}.${propertyKey}` }
        ) as ReturnType<T>;
      } else {
        return errorBoundary.executeSync(
          () => originalMethod.apply(this, args),
          { ...context, operation: `${target.constructor.name}.${propertyKey}` }
        ) as ReturnType<T>;
      }
    };

    return descriptor;
  };
}