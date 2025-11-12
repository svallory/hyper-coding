/**
 * Utility exports for security and validation
 */

export { SecurityUtils } from './SecurityUtils';
export { Utilities } from './Utilities';
export { DocumentationHelper } from './DocumentationHelper';
export { ObjectTypeAnalyzer } from './ObjectTypeAnalyzer';

/**
 * Error handling exports
 */
export {
  DocumentationError,
  SecurityError,
  FileSystemError,
  ValidationError,
  ApiModelError,
  ErrorCode,
  type ErrorContext
} from '../errors/DocumentationError';

export {
  ErrorBoundary,
  GlobalErrorBoundary,
  withErrorBoundary,
  type ErrorBoundaryOptions,
  type ErrorResult
} from '../errors/ErrorBoundary';