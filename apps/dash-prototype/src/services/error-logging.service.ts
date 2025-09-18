import * as path from 'path'
import { EventEmitter } from 'events'
import { fileSystemHandler } from './filesystem-handler.service'
import { TaskMasterError, ErrorType, ErrorSeverity } from './error-handler.service'
import { offlineCache } from './offline-cache.service'

export interface LoggingConfig {
  logDirectory?: string
  logLevel?: LogLevel
  enableFileLogging?: boolean
  enableConsoleLogging?: boolean
  enableAnalytics?: boolean
  maxLogFileSize?: number
  maxLogFiles?: number
  rotateOnStartup?: boolean
  includeStackTrace?: boolean
  anonymizeData?: boolean
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  category: string
  message: string
  data?: any
  error?: {
    type: string
    message: string
    stack?: string
    code?: string
  }
  context: {
    component?: string
    operation?: string
    sessionId: string
    userAgent?: string
    platform: string
    nodeVersion: string
    workingDirectory: string
  }
  performance?: {
    duration?: number
    memoryUsage?: NodeJS.MemoryUsage
    cpuUsage?: NodeJS.CpuUsage
  }
  correlation?: {
    traceId?: string
    spanId?: string
    parentId?: string
  }
}

export interface DiagnosticReport {
  id: string
  timestamp: number
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  sections: DiagnosticSection[]
  metadata: {
    version: string
    environment: Record<string, string>
    system: {
      platform: string
      arch: string
      nodeVersion: string
      memory: NodeJS.MemoryUsage
      uptime: number
    }
    application: {
      name: string
      version: string
      startTime: number
      workingDirectory: string
    }
  }
  attachments?: Array<{
    name: string
    type: 'log' | 'config' | 'data' | 'screenshot'
    data: string
    encoding: 'base64' | 'utf8'
  }>
}

export interface DiagnosticSection {
  title: string
  content: string
  data?: any
  severity?: 'info' | 'warning' | 'error'
}

export interface ErrorPattern {
  pattern: string
  count: number
  firstSeen: number
  lastSeen: number
  errorType: ErrorType
  severity: ErrorSeverity
  contexts: string[]
  resolved: boolean
}

export interface LogAnalytics {
  totalLogs: number
  logsByLevel: Record<LogLevel, number>
  errorPatterns: ErrorPattern[]
  topErrorTypes: Array<{ type: ErrorType; count: number }>
  performanceMetrics: {
    averageResponseTime: number
    slowestOperations: Array<{ operation: string; avgDuration: number }>
    memoryTrends: Array<{ timestamp: number; usage: number }>
  }
  timeline: Array<{
    timestamp: number
    level: LogLevel
    count: number
  }>
}

/**
 * Comprehensive error logging and diagnostics collection service
 * 
 * Features:
 * - Structured logging with multiple output targets
 * - Log rotation and retention management
 * - Error pattern detection and analysis
 * - Performance monitoring and metrics
 * - Diagnostic report generation
 * - Data anonymization and privacy protection
 * - Cross-session error tracking
 * - Log analytics and insights
 */
export class ErrorLoggingService extends EventEmitter {
  private config: Required<LoggingConfig>
  private sessionId: string
  private startTime: number
  private logBuffer: LogEntry[] = []
  private errorPatterns = new Map<string, ErrorPattern>()
  private performanceMetrics: Array<{ timestamp: number; operation: string; duration: number }> = []
  private memorySnapshots: Array<{ timestamp: number; usage: NodeJS.MemoryUsage }> = []

  private readonly defaultConfig: Required<LoggingConfig> = {
    logDirectory: path.join(process.cwd(), 'logs'),
    logLevel: LogLevel.INFO,
    enableFileLogging: true,
    enableConsoleLogging: true,
    enableAnalytics: true,
    maxLogFileSize: 10 * 1024 * 1024, // 10MB
    maxLogFiles: 10,
    rotateOnStartup: true,
    includeStackTrace: true,
    anonymizeData: false
  }

  constructor(config: Partial<LoggingConfig> = {}) {
    super()
    this.config = { ...this.defaultConfig, ...config }
    this.sessionId = this.generateSessionId()
    this.startTime = Date.now()
    
    this.initialize()
  }

  /**
   * Initialize the logging service
   */
  private async initialize(): Promise<void> {
    try {
      if (this.config.enableFileLogging) {
        // Ensure log directory exists
        await fileSystemHandler.ensureDirectoryExists(this.config.logDirectory)
        
        // Rotate logs if needed
        if (this.config.rotateOnStartup) {
          await this.rotateLogs()
        }
      }

      // Start memory monitoring
      if (this.config.enableAnalytics) {
        this.startMemoryMonitoring()
      }

      // Log service startup
      await this.info('ErrorLoggingService', 'Service initialized', {
        config: {
          logLevel: LogLevel[this.config.logLevel],
          fileLogging: this.config.enableFileLogging,
          analytics: this.config.enableAnalytics
        }
      })

      this.emit('initialized')

    } catch (error) {
      console.error('Failed to initialize ErrorLoggingService:', error)
      this.emit('initializationError', error)
    }
  }

  /**
   * Log a debug message
   */
  async debug(category: string, message: string, data?: any, context?: Partial<LogEntry['context']>): Promise<void> {
    await this.log(LogLevel.DEBUG, category, message, data, context)
  }

  /**
   * Log an info message
   */
  async info(category: string, message: string, data?: any, context?: Partial<LogEntry['context']>): Promise<void> {
    await this.log(LogLevel.INFO, category, message, data, context)
  }

  /**
   * Log a warning message
   */
  async warn(category: string, message: string, data?: any, context?: Partial<LogEntry['context']>): Promise<void> {
    await this.log(LogLevel.WARN, category, message, data, context)
  }

  /**
   * Log an error message
   */
  async error(category: string, message: string, error?: Error, data?: any, context?: Partial<LogEntry['context']>): Promise<void> {
    const errorData = error ? {
      type: error.constructor.name,
      message: error.message,
      stack: this.config.includeStackTrace ? error.stack : undefined,
      code: (error as any).code
    } : undefined

    await this.log(LogLevel.ERROR, category, message, data, context, errorData)
  }

  /**
   * Log a fatal error
   */
  async fatal(category: string, message: string, error?: Error, data?: any, context?: Partial<LogEntry['context']>): Promise<void> {
    const errorData = error ? {
      type: error.constructor.name,
      message: error.message,
      stack: this.config.includeStackTrace ? error.stack : undefined,
      code: (error as any).code
    } : undefined

    await this.log(LogLevel.FATAL, category, message, data, context, errorData)
  }

  /**
   * Log a TaskMaster error with enhanced context
   */
  async logTaskMasterError(taskMasterError: TaskMasterError): Promise<void> {
    const category = `TaskMaster.${taskMasterError.type}`
    const context = {
      component: taskMasterError.context.component,
      operation: taskMasterError.context.operation
    }

    // Track error patterns
    this.trackErrorPattern(taskMasterError)

    await this.error(
      category,
      taskMasterError.userFriendlyMessage,
      taskMasterError.originalError,
      {
        errorId: taskMasterError.id,
        errorType: taskMasterError.type,
        severity: taskMasterError.severity,
        canRecover: taskMasterError.canRecover,
        isTransient: taskMasterError.isTransient,
        recoveryActions: taskMasterError.recoveryActions.map(action => ({
          strategy: action.strategy,
          description: action.description,
          autoExecute: action.autoExecute
        })),
        context: taskMasterError.context,
        diagnostics: taskMasterError.diagnostics
      },
      context
    )
  }

  /**
   * Log performance metrics
   */
  async logPerformance(operation: string, duration: number, additionalData?: any): Promise<void> {
    if (this.config.enableAnalytics) {
      this.performanceMetrics.push({
        timestamp: Date.now(),
        operation,
        duration
      })

      // Keep only recent metrics
      if (this.performanceMetrics.length > 1000) {
        this.performanceMetrics = this.performanceMetrics.slice(-1000)
      }
    }

    if (duration > 1000) { // Log slow operations
      await this.warn('Performance', `Slow operation detected: ${operation}`, {
        duration,
        threshold: 1000,
        ...additionalData
      })
    }
  }

  /**
   * Generate comprehensive diagnostic report
   */
  async generateDiagnosticReport(
    title: string,
    description: string,
    severity: DiagnosticReport['severity'] = 'medium'
  ): Promise<DiagnosticReport> {
    const report: DiagnosticReport = {
      id: this.generateReportId(),
      timestamp: Date.now(),
      title,
      description,
      severity,
      sections: [],
      metadata: {
        version: '1.0.0',
        environment: this.getEnvironmentInfo(),
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          memory: process.memoryUsage(),
          uptime: process.uptime()
        },
        application: {
          name: 'TaskMaster Dashboard',
          version: '1.0.0',
          startTime: this.startTime,
          workingDirectory: process.cwd()
        }
      }
    }

    // Add error summary section
    const errorSummary = await this.generateErrorSummarySection()
    if (errorSummary) {
      report.sections.push(errorSummary)
    }

    // Add performance section
    const performanceSection = this.generatePerformanceSection()
    if (performanceSection) {
      report.sections.push(performanceSection)
    }

    // Add recent logs section
    const recentLogsSection = this.generateRecentLogsSection()
    if (recentLogsSection) {
      report.sections.push(recentLogsSection)
    }

    // Add system info section
    report.sections.push(this.generateSystemInfoSection())

    // Add log files as attachments
    if (this.config.enableFileLogging) {
      const logAttachments = await this.generateLogAttachments()
      report.attachments = logAttachments
    }

    // Save report
    await this.saveDiagnosticReport(report)

    this.emit('diagnosticReportGenerated', report.id)
    return report
  }

  /**
   * Get error analytics and patterns
   */
  async getAnalytics(): Promise<LogAnalytics> {
    const analytics: LogAnalytics = {
      totalLogs: this.logBuffer.length,
      logsByLevel: {
        [LogLevel.DEBUG]: 0,
        [LogLevel.INFO]: 0,
        [LogLevel.WARN]: 0,
        [LogLevel.ERROR]: 0,
        [LogLevel.FATAL]: 0
      },
      errorPatterns: Array.from(this.errorPatterns.values()),
      topErrorTypes: [],
      performanceMetrics: {
        averageResponseTime: 0,
        slowestOperations: [],
        memoryTrends: this.memorySnapshots.slice(-50)
      },
      timeline: []
    }

    // Count logs by level
    for (const entry of this.logBuffer) {
      analytics.logsByLevel[entry.level]++
    }

    // Calculate performance metrics
    if (this.performanceMetrics.length > 0) {
      const totalDuration = this.performanceMetrics.reduce((sum, metric) => sum + metric.duration, 0)
      analytics.performanceMetrics.averageResponseTime = totalDuration / this.performanceMetrics.length

      // Group by operation and calculate averages
      const operationGroups = new Map<string, number[]>()
      for (const metric of this.performanceMetrics) {
        if (!operationGroups.has(metric.operation)) {
          operationGroups.set(metric.operation, [])
        }
        operationGroups.get(metric.operation)!.push(metric.duration)
      }

      analytics.performanceMetrics.slowestOperations = Array.from(operationGroups.entries())
        .map(([operation, durations]) => ({
          operation,
          avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length
        }))
        .sort((a, b) => b.avgDuration - a.avgDuration)
        .slice(0, 10)
    }

    // Generate timeline
    const timelineMap = new Map<number, { [key in LogLevel]?: number }>()
    const hourMs = 60 * 60 * 1000

    for (const entry of this.logBuffer) {
      const hour = Math.floor(entry.timestamp / hourMs) * hourMs
      if (!timelineMap.has(hour)) {
        timelineMap.set(hour, {})
      }
      const hourData = timelineMap.get(hour)!
      hourData[entry.level] = (hourData[entry.level] || 0) + 1
    }

    analytics.timeline = Array.from(timelineMap.entries())
      .map(([timestamp, levelCounts]) => ({
        timestamp,
        level: LogLevel.ERROR, // Placeholder
        count: Object.values(levelCounts).reduce((sum, count) => sum + (count || 0), 0)
      }))
      .sort((a, b) => a.timestamp - b.timestamp)

    return analytics
  }

  /**
   * Clear all logs and analytics data
   */
  async clearLogs(): Promise<void> {
    this.logBuffer = []
    this.errorPatterns.clear()
    this.performanceMetrics = []
    this.memorySnapshots = []

    if (this.config.enableFileLogging) {
      // Clear log files
      try {
        const fs = require('fs').promises
        const files = await fs.readdir(this.config.logDirectory)
        const logFiles = files.filter(file => file.endsWith('.log'))
        
        for (const file of logFiles) {
          await fs.unlink(path.join(this.config.logDirectory, file)).catch(() => {})
        }
      } catch {
        // Ignore errors
      }
    }

    await this.info('ErrorLoggingService', 'Logs cleared')
    this.emit('logsCleared')
  }

  // Private implementation methods

  private async log(
    level: LogLevel,
    category: string,
    message: string,
    data?: any,
    context?: Partial<LogEntry['context']>,
    error?: LogEntry['error']
  ): Promise<void> {
    if (level < this.config.logLevel) {
      return // Skip logs below configured level
    }

    const entry: LogEntry = {
      id: this.generateLogId(),
      timestamp: Date.now(),
      level,
      category,
      message: this.config.anonymizeData ? this.anonymizeMessage(message) : message,
      data: this.config.anonymizeData ? this.anonymizeData(data) : data,
      error,
      context: {
        sessionId: this.sessionId,
        platform: process.platform,
        nodeVersion: process.version,
        workingDirectory: process.cwd(),
        ...context
      }
    }

    // Add performance data if available
    if (this.config.enableAnalytics) {
      entry.performance = {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    }

    // Add to buffer
    this.logBuffer.push(entry)
    
    // Keep buffer size reasonable
    if (this.logBuffer.length > 10000) {
      this.logBuffer = this.logBuffer.slice(-10000)
    }

    // Output to targets
    if (this.config.enableConsoleLogging) {
      this.logToConsole(entry)
    }

    if (this.config.enableFileLogging) {
      await this.logToFile(entry)
    }

    this.emit('logEntry', entry)
  }

  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString()
    const levelName = LogLevel[entry.level].padEnd(5)
    const prefix = `[${timestamp}] ${levelName} [${entry.category}]`
    
    const logFunction = this.getConsoleLogFunction(entry.level)
    
    if (entry.error) {
      logFunction(`${prefix} ${entry.message}`, entry.error, entry.data)
    } else {
      logFunction(`${prefix} ${entry.message}`, entry.data)
    }
  }

  private async logToFile(entry: LogEntry): Promise<void> {
    try {
      const logLine = JSON.stringify(entry) + '\n'
      const logFile = this.getCurrentLogFile()
      
      // Check if log rotation is needed
      const logPath = path.join(this.config.logDirectory, logFile)
      try {
        const fileInfo = await fileSystemHandler.getFileInfo(logPath)
        if (fileInfo.exists && fileInfo.size > this.config.maxLogFileSize) {
          await this.rotateLogs()
        }
      } catch {
        // File doesn't exist yet, which is fine
      }

      // Append to log file
      const fs = require('fs').promises
      await fs.appendFile(logPath, logLine)

    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Failed to write to log file:', error)
    }
  }

  private getConsoleLogFunction(level: LogLevel): (...args: any[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug
      case LogLevel.INFO:
        return console.info
      case LogLevel.WARN:
        return console.warn
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        return console.error
      default:
        return console.log
    }
  }

  private getCurrentLogFile(): string {
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return `taskmaster-${date}.log`
  }

  private async rotateLogs(): Promise<void> {
    try {
      const fs = require('fs').promises
      const files = await fs.readdir(this.config.logDirectory)
      const logFiles = files
        .filter(file => file.match(/^taskmaster-\d{4}-\d{2}-\d{2}\.log$/))
        .sort()

      // Keep only the most recent files
      if (logFiles.length >= this.config.maxLogFiles) {
        const filesToDelete = logFiles.slice(0, logFiles.length - this.config.maxLogFiles + 1)
        
        for (const file of filesToDelete) {
          await fs.unlink(path.join(this.config.logDirectory, file)).catch(() => {})
        }
      }

    } catch (error) {
      console.error('Failed to rotate logs:', error)
    }
  }

  private trackErrorPattern(taskMasterError: TaskMasterError): void {
    const patternKey = `${taskMasterError.type}:${taskMasterError.message.substring(0, 100)}`
    
    const existing = this.errorPatterns.get(patternKey)
    if (existing) {
      existing.count++
      existing.lastSeen = Date.now()
      existing.contexts.push(taskMasterError.context.component || 'unknown')
    } else {
      this.errorPatterns.set(patternKey, {
        pattern: patternKey,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        errorType: taskMasterError.type,
        severity: taskMasterError.severity,
        contexts: [taskMasterError.context.component || 'unknown'],
        resolved: false
      })
    }
  }

  private startMemoryMonitoring(): void {
    setInterval(() => {
      this.memorySnapshots.push({
        timestamp: Date.now(),
        usage: process.memoryUsage()
      })

      // Keep only recent snapshots
      if (this.memorySnapshots.length > 1000) {
        this.memorySnapshots = this.memorySnapshots.slice(-1000)
      }
    }, 60000) // Every minute
  }

  private async generateErrorSummarySection(): Promise<DiagnosticSection | null> {
    const recentErrors = this.logBuffer.filter(entry => 
      entry.level >= LogLevel.ERROR && 
      Date.now() - entry.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    )

    if (recentErrors.length === 0) {
      return null
    }

    const errorsByType = new Map<string, number>()
    for (const error of recentErrors) {
      const key = error.error?.type || 'Unknown'
      errorsByType.set(key, (errorsByType.get(key) || 0) + 1)
    }

    const content = [
      `Total errors in last 24 hours: ${recentErrors.length}`,
      '',
      'Errors by type:',
      ...Array.from(errorsByType.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type}: ${count}`)
    ].join('\n')

    return {
      title: 'Error Summary',
      content,
      severity: recentErrors.length > 10 ? 'error' : 'warning'
    }
  }

  private generatePerformanceSection(): DiagnosticSection | null {
    if (this.performanceMetrics.length === 0) {
      return null
    }

    const avgResponseTime = this.performanceMetrics.reduce((sum, m) => sum + m.duration, 0) / this.performanceMetrics.length
    const slowOperations = this.performanceMetrics.filter(m => m.duration > 1000)

    const content = [
      `Average response time: ${avgResponseTime.toFixed(2)}ms`,
      `Slow operations (>1s): ${slowOperations.length}`,
      '',
      'Recent memory usage:',
      `  RSS: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
      `  Heap Used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  External: ${(process.memoryUsage().external / 1024 / 1024).toFixed(2)} MB`
    ].join('\n')

    return {
      title: 'Performance Metrics',
      content,
      severity: slowOperations.length > 0 ? 'warning' : 'info'
    }
  }

  private generateRecentLogsSection(): DiagnosticSection | null {
    const recentLogs = this.logBuffer.slice(-20)
    
    if (recentLogs.length === 0) {
      return null
    }

    const content = recentLogs
      .map(log => {
        const timestamp = new Date(log.timestamp).toISOString()
        const level = LogLevel[log.level]
        return `[${timestamp}] ${level} ${log.category}: ${log.message}`
      })
      .join('\n')

    return {
      title: 'Recent Log Entries',
      content
    }
  }

  private generateSystemInfoSection(): DiagnosticSection {
    const memory = process.memoryUsage()
    const uptime = process.uptime()

    const content = [
      `Platform: ${process.platform} ${process.arch}`,
      `Node.js: ${process.version}`,
      `Process ID: ${process.pid}`,
      `Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      `Working Directory: ${process.cwd()}`,
      '',
      'Memory Usage:',
      `  RSS: ${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
      `  Heap Used: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  Heap Total: ${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      `  External: ${(memory.external / 1024 / 1024).toFixed(2)} MB`
    ].join('\n')

    return {
      title: 'System Information',
      content
    }
  }

  private async generateLogAttachments(): Promise<DiagnosticReport['attachments']> {
    const attachments: DiagnosticReport['attachments'] = []

    try {
      const fs = require('fs').promises
      const logFile = this.getCurrentLogFile()
      const logPath = path.join(this.config.logDirectory, logFile)
      
      const logData = await fs.readFile(logPath, 'utf8')
      attachments.push({
        name: logFile,
        type: 'log',
        data: Buffer.from(logData).toString('base64'),
        encoding: 'base64'
      })

    } catch {
      // Log file doesn't exist or can't be read
    }

    return attachments
  }

  private async saveDiagnosticReport(report: DiagnosticReport): Promise<void> {
    const reportPath = path.join(this.config.logDirectory, `diagnostic-${report.id}.json`)
    
    try {
      await fileSystemHandler.writeFileSafe(reportPath, JSON.stringify(report, null, 2))
    } catch (error) {
      console.error('Failed to save diagnostic report:', error)
    }
  }

  private getEnvironmentInfo(): Record<string, string> {
    const env: Record<string, string> = {}
    
    // Include only non-sensitive environment variables
    const safeVars = ['NODE_ENV', 'PATH', 'USER', 'HOME', 'PWD', 'SHELL']
    
    for (const varName of safeVars) {
      if (process.env[varName]) {
        env[varName] = process.env[varName]!
      }
    }

    return env
  }

  private anonymizeMessage(message: string): string {
    // Remove potentially sensitive information
    return message
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_ADDRESS]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
      .replace(/\/Users\/[^\/\s]+/g, '/Users/[USER]')
      .replace(/\/home\/[^\/\s]+/g, '/home/[USER]')
  }

  private anonymizeData(data: any): any {
    if (!data) return data
    
    // Deep clone and anonymize
    const anonymized = JSON.parse(JSON.stringify(data))
    
    const anonymizeObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return this.anonymizeMessage(obj)
      } else if (Array.isArray(obj)) {
        return obj.map(anonymizeObject)
      } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {}
        for (const [key, value] of Object.entries(obj)) {
          result[key] = anonymizeObject(value)
        }
        return result
      }
      return obj
    }

    return anonymizeObject(anonymized)
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateReportId(): string {
    return `diag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.removeAllListeners()
  }
}

// Export default instance
export const errorLogging = new ErrorLoggingService()