import { EventEmitter } from 'events'

// Error Classification System
export enum ErrorType {
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  CLI_PERMISSION_DENIED = 'CLI_PERMISSION_DENIED', 
  CLI_TIMEOUT = 'CLI_TIMEOUT',
  CLI_PARSE_ERROR = 'CLI_PARSE_ERROR',
  CLI_INVALID_RESPONSE = 'CLI_INVALID_RESPONSE',
  CLI_VERSION_MISMATCH = 'CLI_VERSION_MISMATCH',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_PERMISSION_DENIED = 'FILE_PERMISSION_DENIED',
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  CACHE_CORRUPTED = 'CACHE_CORRUPTED',
  SYSTEM_RESOURCE_EXHAUSTED = 'SYSTEM_RESOURCE_EXHAUSTED',
  UNKNOWN = 'UNKNOWN'
}

export enum ErrorSeverity {
  LOW = 'LOW',           // Informational, no action needed
  MEDIUM = 'MEDIUM',     // Feature degradation, fallback available
  HIGH = 'HIGH',         // Major functionality impacted
  CRITICAL = 'CRITICAL'  // Application unusable
}

export enum RecoveryStrategy {
  RETRY = 'RETRY',
  FALLBACK = 'FALLBACK',
  CACHE = 'CACHE',
  OFFLINE = 'OFFLINE',
  USER_ACTION = 'USER_ACTION',
  NONE = 'NONE'
}

export interface ErrorContext {
  component?: string
  operation?: string
  timestamp: number
  userAgent?: string
  workingDirectory?: string
  environment?: Record<string, string>
  cacheState?: {
    size: number
    entries: string[]
    lastCleared?: number
  }
  retryCount?: number
  previousErrors?: string[]
}

export interface RecoveryAction {
  strategy: RecoveryStrategy
  description: string
  action?: () => Promise<void> | void
  autoExecute?: boolean
  timeout?: number
  userMessage?: string
}

export interface TaskMasterError {
  id: string
  type: ErrorType
  severity: ErrorSeverity
  message: string
  originalError?: Error
  context: ErrorContext
  recoveryActions: RecoveryAction[]
  canRecover: boolean
  isTransient: boolean
  userFriendlyMessage: string
  technicalDetails?: string
  diagnostics?: Record<string, any>
}

export interface ErrorHandlerConfig {
  maxRetries?: number
  retryDelay?: number
  enableDiagnostics?: boolean
  enableLogging?: boolean
  fallbackDataTTL?: number
  offlineMode?: boolean
}

/**
 * Centralized error handling and classification system for TaskMaster CLI integration
 * 
 * Features:
 * - Error type classification and severity assessment
 * - Automatic recovery strategy determination
 * - Context-aware error reporting
 * - User-friendly error messages with actionable suggestions
 * - Diagnostic information collection
 * - Error aggregation and patterns detection
 */
export class ErrorHandlerService extends EventEmitter {
  private config: Required<ErrorHandlerConfig>
  private errorHistory: TaskMasterError[] = []
  private errorPatterns = new Map<string, number>()
  private readonly maxHistorySize = 100

  private readonly defaultConfig: Required<ErrorHandlerConfig> = {
    maxRetries: 3,
    retryDelay: 1000,
    enableDiagnostics: true,
    enableLogging: true,
    fallbackDataTTL: 300000, // 5 minutes
    offlineMode: false
  }

  constructor(config: ErrorHandlerConfig = {}) {
    super()
    this.config = { ...this.defaultConfig, ...config }
  }

  /**
   * Create a TaskMaster error from various error sources
   */
  createError(
    rawError: Error | string | unknown,
    context: Partial<ErrorContext> = {}
  ): TaskMasterError {
    const id = this.generateErrorId()
    const timestamp = Date.now()
    
    // Extract error information
    const originalError = rawError instanceof Error ? rawError : undefined
    const message = this.extractErrorMessage(rawError)
    
    // Classify error
    const type = this.classifyError(message, originalError)
    const severity = this.determineSeverity(type, context)
    
    // Build full context
    const fullContext: ErrorContext = {
      timestamp,
      component: 'TaskMaster',
      operation: 'unknown',
      workingDirectory: process.cwd(),
      retryCount: 0,
      ...context
    }

    // Determine recovery strategies
    const recoveryActions = this.determineRecoveryActions(type, severity, fullContext)
    
    // Generate user-friendly messages
    const userFriendlyMessage = this.generateUserFriendlyMessage(type, message)
    const technicalDetails = this.generateTechnicalDetails(type, originalError, fullContext)
    
    // Collect diagnostics if enabled
    const diagnostics = this.config.enableDiagnostics 
      ? this.collectDiagnostics(type, fullContext)
      : undefined

    const taskMasterError: TaskMasterError = {
      id,
      type,
      severity,
      message,
      originalError,
      context: fullContext,
      recoveryActions,
      canRecover: recoveryActions.length > 0,
      isTransient: this.isTransientError(type),
      userFriendlyMessage,
      technicalDetails,
      diagnostics
    }

    // Track error patterns
    this.trackErrorPattern(type, message)
    
    // Add to history
    this.addToHistory(taskMasterError)
    
    // Log if enabled
    if (this.config.enableLogging) {
      this.logError(taskMasterError)
    }

    // Emit error event
    this.emit('error', taskMasterError)

    return taskMasterError
  }

  /**
   * Handle an error with automatic recovery attempt
   */
  async handleError(
    rawError: Error | string | unknown,
    context: Partial<ErrorContext> = {}
  ): Promise<TaskMasterError> {
    const error = this.createError(rawError, context)
    
    // Attempt automatic recovery if possible
    if (error.canRecover) {
      const autoRecoveryAction = error.recoveryActions.find(action => action.autoExecute)
      
      if (autoRecoveryAction) {
        try {
          await this.executeRecoveryAction(autoRecoveryAction, error)
          this.emit('recoverySuccessful', error, autoRecoveryAction)
        } catch (recoveryError) {
          this.emit('recoveryFailed', error, autoRecoveryAction, recoveryError)
        }
      }
    }

    return error
  }

  /**
   * Execute a specific recovery action
   */
  async executeRecoveryAction(action: RecoveryAction, error: TaskMasterError): Promise<void> {
    if (!action.action) {
      throw new Error('Recovery action has no executable function')
    }

    const timeout = action.timeout || 10000
    
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Recovery action timed out')), timeout)
    )

    try {
      await Promise.race([
        Promise.resolve(action.action()),
        timeoutPromise
      ])
    } catch (recoveryError) {
      throw new Error(`Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown error'}`)
    }
  }

  /**
   * Check if error is recoverable automatically
   */
  isRecoverable(error: TaskMasterError): boolean {
    return error.canRecover && error.recoveryActions.some(action => action.autoExecute)
  }

  /**
   * Get error statistics and patterns
   */
  getErrorStatistics(): {
    totalErrors: number
    errorsByType: Record<ErrorType, number>
    errorsBySeverity: Record<ErrorSeverity, number>
    commonPatterns: Array<{ pattern: string; count: number }>
    recentErrors: TaskMasterError[]
  } {
    const errorsByType = {} as Record<ErrorType, number>
    const errorsBySeverity = {} as Record<ErrorSeverity, number>

    for (const error of this.errorHistory) {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1
    }

    const commonPatterns = Array.from(this.errorPatterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      totalErrors: this.errorHistory.length,
      errorsByType,
      errorsBySeverity,
      commonPatterns,
      recentErrors: this.errorHistory.slice(-10)
    }
  }

  /**
   * Clear error history and patterns
   */
  clearHistory(): void {
    this.errorHistory = []
    this.errorPatterns.clear()
    this.emit('historyCleared')
  }

  /**
   * Get recent errors of specific type or severity
   */
  getErrorsByType(type: ErrorType): TaskMasterError[] {
    return this.errorHistory.filter(error => error.type === type)
  }

  getErrorsBySeverity(severity: ErrorSeverity): TaskMasterError[] {
    return this.errorHistory.filter(error => error.severity === severity)
  }

  /**
   * Check if error pattern indicates systemic issue
   */
  isSystemicIssue(type: ErrorType, threshold = 5): boolean {
    const recentErrors = this.errorHistory
      .filter(error => error.type === type && Date.now() - error.context.timestamp < 300000) // 5 minutes
    
    return recentErrors.length >= threshold
  }

  // Private implementation methods

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    return 'Unknown error occurred'
  }

  private classifyError(message: string, originalError?: Error): ErrorType {
    const lowerMessage = message.toLowerCase()
    
    // CLI-specific errors
    if (lowerMessage.includes('command not found') || lowerMessage.includes('not found') || 
        lowerMessage.includes('spawn') && lowerMessage.includes('enoent')) {
      return ErrorType.CLI_NOT_FOUND
    }
    
    if (lowerMessage.includes('permission denied') || lowerMessage.includes('eacces')) {
      return ErrorType.CLI_PERMISSION_DENIED
    }
    
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return ErrorType.CLI_TIMEOUT
    }
    
    if (lowerMessage.includes('parse') || lowerMessage.includes('syntax') || 
        lowerMessage.includes('invalid json') || lowerMessage.includes('unexpected token')) {
      return ErrorType.CLI_PARSE_ERROR
    }
    
    if (lowerMessage.includes('invalid response') || lowerMessage.includes('malformed')) {
      return ErrorType.CLI_INVALID_RESPONSE
    }

    if (lowerMessage.includes('version') && (lowerMessage.includes('incompatible') || 
        lowerMessage.includes('unsupported'))) {
      return ErrorType.CLI_VERSION_MISMATCH
    }

    // File system errors
    if (lowerMessage.includes('no such file') || lowerMessage.includes('enoent')) {
      return ErrorType.FILE_NOT_FOUND
    }
    
    if (lowerMessage.includes('file') && lowerMessage.includes('permission')) {
      return ErrorType.FILE_PERMISSION_DENIED
    }
    
    if (lowerMessage.includes('corrupted') || lowerMessage.includes('invalid format')) {
      return ErrorType.FILE_CORRUPTED
    }

    // Network errors
    if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
      return lowerMessage.includes('timeout') ? ErrorType.NETWORK_TIMEOUT : ErrorType.NETWORK_UNAVAILABLE
    }

    // System resource errors  
    if (lowerMessage.includes('memory') || lowerMessage.includes('disk') || 
        lowerMessage.includes('resource') || lowerMessage.includes('enomem')) {
      return ErrorType.SYSTEM_RESOURCE_EXHAUSTED
    }

    // Cache errors
    if (lowerMessage.includes('cache')) {
      return ErrorType.CACHE_CORRUPTED
    }

    return ErrorType.UNKNOWN
  }

  private determineSeverity(type: ErrorType, context: Partial<ErrorContext>): ErrorSeverity {
    // Critical errors that make the app unusable
    const criticalTypes = [
      ErrorType.SYSTEM_RESOURCE_EXHAUSTED,
      ErrorType.CLI_VERSION_MISMATCH
    ]
    
    // High severity errors that impact major functionality
    const highSeverityTypes = [
      ErrorType.CLI_NOT_FOUND,
      ErrorType.CLI_PERMISSION_DENIED,
      ErrorType.FILE_PERMISSION_DENIED
    ]
    
    // Medium severity errors with available fallbacks
    const mediumSeverityTypes = [
      ErrorType.CLI_TIMEOUT,
      ErrorType.CLI_PARSE_ERROR,
      ErrorType.NETWORK_UNAVAILABLE,
      ErrorType.FILE_NOT_FOUND
    ]

    if (criticalTypes.includes(type)) {
      return ErrorSeverity.CRITICAL
    }
    
    if (highSeverityTypes.includes(type)) {
      return ErrorSeverity.HIGH
    }
    
    if (mediumSeverityTypes.includes(type)) {
      return ErrorSeverity.MEDIUM
    }

    // Consider retry count for escalation
    const retryCount = context.retryCount || 0
    if (retryCount > 2) {
      return ErrorSeverity.HIGH
    }

    return ErrorSeverity.LOW
  }

  private determineRecoveryActions(
    type: ErrorType, 
    severity: ErrorSeverity, 
    context: ErrorContext
  ): RecoveryAction[] {
    const actions: RecoveryAction[] = []

    switch (type) {
      case ErrorType.CLI_NOT_FOUND:
        actions.push({
          strategy: RecoveryStrategy.USER_ACTION,
          description: 'Install or configure TaskMaster CLI',
          userMessage: 'Please install TaskMaster CLI or check your PATH configuration'
        })
        actions.push({
          strategy: RecoveryStrategy.FALLBACK,
          description: 'Use Epic workflow data only',
          autoExecute: true,
          userMessage: 'Switching to Epic workflow mode'
        })
        break

      case ErrorType.CLI_PERMISSION_DENIED:
        actions.push({
          strategy: RecoveryStrategy.USER_ACTION,
          description: 'Fix CLI permissions',
          userMessage: 'Please check file permissions for TaskMaster CLI'
        })
        break

      case ErrorType.CLI_TIMEOUT:
        actions.push({
          strategy: RecoveryStrategy.RETRY,
          description: 'Retry with increased timeout',
          autoExecute: true,
          timeout: 15000
        })
        actions.push({
          strategy: RecoveryStrategy.CACHE,
          description: 'Use cached data',
          autoExecute: true
        })
        break

      case ErrorType.CLI_PARSE_ERROR:
        actions.push({
          strategy: RecoveryStrategy.RETRY,
          description: 'Retry command execution',
          autoExecute: true
        })
        actions.push({
          strategy: RecoveryStrategy.FALLBACK,
          description: 'Use fallback data parsing',
          autoExecute: true
        })
        break

      case ErrorType.FILE_NOT_FOUND:
        actions.push({
          strategy: RecoveryStrategy.RETRY,
          description: 'Retry file access',
          autoExecute: true
        })
        actions.push({
          strategy: RecoveryStrategy.FALLBACK,
          description: 'Use default configuration',
          autoExecute: true
        })
        break

      case ErrorType.NETWORK_UNAVAILABLE:
        actions.push({
          strategy: RecoveryStrategy.OFFLINE,
          description: 'Switch to offline mode',
          autoExecute: true
        })
        actions.push({
          strategy: RecoveryStrategy.CACHE,
          description: 'Use cached data',
          autoExecute: true
        })
        break

      case ErrorType.CACHE_CORRUPTED:
        actions.push({
          strategy: RecoveryStrategy.RETRY,
          description: 'Clear and rebuild cache',
          autoExecute: true
        })
        break
    }

    // Add generic retry for transient errors
    if (this.isTransientError(type) && (context.retryCount || 0) < this.config.maxRetries) {
      actions.unshift({
        strategy: RecoveryStrategy.RETRY,
        description: 'Retry operation',
        autoExecute: true,
        timeout: this.config.retryDelay
      })
    }

    return actions
  }

  private generateUserFriendlyMessage(type: ErrorType, message: string): string {
    const friendlyMessages: Record<ErrorType, string> = {
      [ErrorType.CLI_NOT_FOUND]: 'TaskMaster CLI is not installed or not found in your system PATH. The dashboard will continue using Epic workflow data only.',
      [ErrorType.CLI_PERMISSION_DENIED]: 'Permission denied when accessing TaskMaster CLI. Please check your file permissions.',
      [ErrorType.CLI_TIMEOUT]: 'TaskMaster CLI is taking longer than expected to respond. Using cached data where available.',
      [ErrorType.CLI_PARSE_ERROR]: 'Unable to parse TaskMaster CLI response. The output format may have changed.',
      [ErrorType.CLI_INVALID_RESPONSE]: 'TaskMaster CLI returned an unexpected response format.',
      [ErrorType.CLI_VERSION_MISMATCH]: 'TaskMaster CLI version is incompatible with this dashboard.',
      [ErrorType.FILE_NOT_FOUND]: 'Required configuration file not found. Using default settings.',
      [ErrorType.FILE_PERMISSION_DENIED]: 'Permission denied when accessing configuration files.',
      [ErrorType.FILE_CORRUPTED]: 'Configuration file appears to be corrupted or invalid.',
      [ErrorType.NETWORK_UNAVAILABLE]: 'Network connection unavailable. Running in offline mode.',
      [ErrorType.NETWORK_TIMEOUT]: 'Network request timed out. Retrying with cached data.',
      [ErrorType.CACHE_CORRUPTED]: 'Cache data is corrupted. Clearing cache and refreshing.',
      [ErrorType.SYSTEM_RESOURCE_EXHAUSTED]: 'System resources exhausted. Please close other applications.',
      [ErrorType.UNKNOWN]: 'An unexpected error occurred. The dashboard will attempt to continue with limited functionality.'
    }

    return friendlyMessages[type] || `An error occurred: ${message}`
  }

  private generateTechnicalDetails(
    type: ErrorType, 
    originalError?: Error, 
    context?: ErrorContext
  ): string {
    const details: string[] = []
    
    details.push(`Error Type: ${type}`)
    
    if (originalError) {
      details.push(`Original Error: ${originalError.name}: ${originalError.message}`)
      if (originalError.stack) {
        details.push(`Stack Trace: ${originalError.stack}`)
      }
    }
    
    if (context) {
      details.push(`Component: ${context.component || 'Unknown'}`)
      details.push(`Operation: ${context.operation || 'Unknown'}`)
      details.push(`Working Directory: ${context.workingDirectory || 'Unknown'}`)
      details.push(`Timestamp: ${new Date(context.timestamp).toISOString()}`)
      
      if (context.retryCount) {
        details.push(`Retry Count: ${context.retryCount}`)
      }
    }

    return details.join('\n')
  }

  private collectDiagnostics(type: ErrorType, context: ErrorContext): Record<string, any> {
    const diagnostics: Record<string, any> = {
      timestamp: new Date(context.timestamp).toISOString(),
      errorType: type,
      platform: process.platform,
      nodeVersion: process.version,
      workingDirectory: context.workingDirectory,
      environment: {
        PATH: process.env.PATH,
        USER: process.env.USER || process.env.USERNAME,
        HOME: process.env.HOME || process.env.USERPROFILE
      }
    }

    // Add CLI-specific diagnostics
    if (type.startsWith('CLI_')) {
      diagnostics.cliDiagnostics = {
        pathExists: this.checkPathExists('task-master'),
        permissions: this.checkFilePermissions('task-master')
      }
    }

    // Add file system diagnostics
    if (type.startsWith('FILE_')) {
      diagnostics.fileSystemDiagnostics = {
        workingDirExists: this.checkDirectoryExists(context.workingDirectory || process.cwd()),
        workingDirWritable: this.checkDirectoryWritable(context.workingDirectory || process.cwd())
      }
    }

    return diagnostics
  }

  private isTransientError(type: ErrorType): boolean {
    const transientTypes = [
      ErrorType.CLI_TIMEOUT,
      ErrorType.NETWORK_TIMEOUT,
      ErrorType.NETWORK_UNAVAILABLE,
      ErrorType.CACHE_CORRUPTED
    ]
    
    return transientTypes.includes(type)
  }

  private trackErrorPattern(type: ErrorType, message: string): void {
    const pattern = `${type}:${message.substring(0, 50)}`
    this.errorPatterns.set(pattern, (this.errorPatterns.get(pattern) || 0) + 1)
  }

  private addToHistory(error: TaskMasterError): void {
    this.errorHistory.push(error)
    
    // Trim history if it gets too large
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize)
    }
  }

  private logError(error: TaskMasterError): void {
    const logEntry = {
      id: error.id,
      type: error.type,
      severity: error.severity,
      message: error.message,
      timestamp: new Date(error.context.timestamp).toISOString(),
      component: error.context.component,
      operation: error.context.operation
    }

    console.error('[TaskMaster Error]', JSON.stringify(logEntry, null, 2))
    
    if (error.technicalDetails) {
      console.error('[Technical Details]', error.technicalDetails)
    }
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Utility methods for diagnostics
  private checkPathExists(command: string): boolean {
    try {
      require('child_process').execSync(`which ${command}`, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private checkFilePermissions(filename: string): string {
    try {
      const fs = require('fs')
      const stats = fs.statSync(filename)
      return stats.mode.toString(8)
    } catch {
      return 'unknown'
    }
  }

  private checkDirectoryExists(dirPath: string): boolean {
    try {
      const fs = require('fs')
      return fs.existsSync(dirPath)
    } catch {
      return false
    }
  }

  private checkDirectoryWritable(dirPath: string): boolean {
    try {
      const fs = require('fs')
      fs.accessSync(dirPath, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  }
}

// Export default instance
export const errorHandler = new ErrorHandlerService()