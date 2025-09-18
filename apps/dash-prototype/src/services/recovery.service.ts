import { EventEmitter } from 'events'
import { TaskMasterError, ErrorType, RecoveryStrategy, RecoveryAction } from './error-handler.service'

export interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
  jitter: boolean
  retryableErrors: ErrorType[]
}

export interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeout: number
  halfOpenMaxCalls: number
}

export interface RecoveryState {
  retryCount: number
  lastRetryAt: number
  totalRecoveryAttempts: number
  successfulRecoveries: number
  failedRecoveries: number
  averageRecoveryTime: number
  circuitBreakerState: 'closed' | 'open' | 'half-open'
  lastCircuitBreakerStateChange: number
}

export interface RecoveryResult {
  success: boolean
  strategy: RecoveryStrategy
  executionTime: number
  error?: Error
  recoveredData?: any
  fallbackUsed?: boolean
}

/**
 * Advanced error recovery service with intelligent retry strategies,
 * circuit breaker pattern, and fallback mechanisms
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern for cascading failures
 * - Context-aware recovery strategies
 * - Fallback data management
 * - Recovery analytics and optimization
 * - Automatic strategy selection based on success rates
 */
export class RecoveryService extends EventEmitter {
  private recoveryState: RecoveryState = {
    retryCount: 0,
    lastRetryAt: 0,
    totalRecoveryAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    averageRecoveryTime: 0,
    circuitBreakerState: 'closed',
    lastCircuitBreakerStateChange: Date.now()
  }

  private readonly defaultRetryConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: [
      ErrorType.CLI_TIMEOUT,
      ErrorType.NETWORK_TIMEOUT,
      ErrorType.NETWORK_UNAVAILABLE,
      ErrorType.CLI_PARSE_ERROR,
      ErrorType.CACHE_CORRUPTED
    ]
  }

  private readonly defaultCircuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    halfOpenMaxCalls: 3
  }

  private fallbackDataStore = new Map<string, {
    data: any
    timestamp: number
    ttl: number
    source: string
  }>()

  private operationHistory = new Map<string, Array<{
    timestamp: number
    success: boolean
    executionTime: number
    strategy: RecoveryStrategy
  }>>()

  constructor(
    private retryConfig: Partial<RetryConfig> = {},
    private circuitBreakerConfig: Partial<CircuitBreakerConfig> = {}
  ) {
    super()
    this.retryConfig = { ...this.defaultRetryConfig, ...retryConfig }
    this.circuitBreakerConfig = { ...this.defaultCircuitBreakerConfig, ...circuitBreakerConfig }
  }

  /**
   * Execute an operation with comprehensive error recovery
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    operationId: string,
    recoveryActions: RecoveryAction[] = [],
    context: any = {}
  ): Promise<T> {
    const startTime = Date.now()
    
    // Check circuit breaker state
    if (this.recoveryState.circuitBreakerState === 'open') {
      if (this.shouldTryCircuitBreaker()) {
        this.recoveryState.circuitBreakerState = 'half-open'
        this.recoveryState.lastCircuitBreakerStateChange = Date.now()
        this.emit('circuitBreakerStateChanged', 'half-open')
      } else {
        // Circuit breaker is open, try fallback immediately
        const fallbackData = this.getFallbackData(operationId)
        if (fallbackData) {
          this.emit('fallbackDataUsed', operationId, fallbackData)
          return fallbackData as T
        }
        throw new Error('Circuit breaker is open and no fallback data available')
      }
    }

    let lastError: Error | null = null
    let attemptCount = 0
    const maxAttempts = this.retryConfig.maxAttempts!

    while (attemptCount < maxAttempts) {
      try {
        attemptCount++
        this.recoveryState.retryCount++
        this.recoveryState.lastRetryAt = Date.now()

        const result = await operation()
        
        // Operation succeeded
        const executionTime = Date.now() - startTime
        this.recordOperationSuccess(operationId, executionTime, RecoveryStrategy.NONE)
        this.updateCircuitBreaker(true)
        
        // Store as fallback data for future use
        this.storeFallbackData(operationId, result, context)
        
        return result

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        const errorType = this.classifyErrorForRetry(lastError)
        
        // Check if error is retryable
        if (!this.isRetryableError(errorType) || attemptCount >= maxAttempts) {
          break
        }

        // Calculate delay for next retry
        const delay = this.calculateRetryDelay(attemptCount)
        
        this.emit('retryAttempt', {
          operationId,
          attempt: attemptCount,
          maxAttempts,
          delay,
          error: lastError.message
        })

        await this.sleep(delay)
      }
    }

    // All retries failed, try recovery actions
    this.recoveryState.totalRecoveryAttempts++
    
    for (const action of recoveryActions) {
      try {
        const recoveryResult = await this.executeRecoveryAction(action, operationId, context)
        
        if (recoveryResult.success) {
          this.recoveryState.successfulRecoveries++
          this.recordOperationSuccess(operationId, recoveryResult.executionTime, action.strategy)
          this.updateCircuitBreaker(true)
          
          if (recoveryResult.recoveredData !== undefined) {
            return recoveryResult.recoveredData as T
          }
          
          // Try the original operation again after successful recovery
          try {
            const result = await operation()
            this.storeFallbackData(operationId, result, context)
            return result
          } catch {
            // Continue to next recovery action
          }
        }
      } catch (recoveryError) {
        this.emit('recoveryActionFailed', action, recoveryError)
      }
    }

    // All recovery attempts failed
    this.recoveryState.failedRecoveries++
    this.updateCircuitBreaker(false)
    
    const executionTime = Date.now() - startTime
    this.recordOperationFailure(operationId, executionTime)

    // Try fallback data as last resort
    const fallbackData = this.getFallbackData(operationId)
    if (fallbackData) {
      this.emit('fallbackDataUsed', operationId, fallbackData)
      return fallbackData as T
    }

    // Everything failed
    throw lastError || new Error('Operation failed and no recovery options available')
  }

  /**
   * Execute a specific recovery action
   */
  async executeRecoveryAction(
    action: RecoveryAction,
    operationId: string,
    context: any = {}
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    try {
      switch (action.strategy) {
        case RecoveryStrategy.RETRY:
          return await this.executeRetryRecovery(action, operationId, context)
          
        case RecoveryStrategy.FALLBACK:
          return await this.executeFallbackRecovery(action, operationId, context)
          
        case RecoveryStrategy.CACHE:
          return await this.executeCacheRecovery(action, operationId, context)
          
        case RecoveryStrategy.OFFLINE:
          return await this.executeOfflineRecovery(action, operationId, context)
          
        case RecoveryStrategy.USER_ACTION:
          return await this.executeUserActionRecovery(action, operationId, context)
          
        default:
          throw new Error(`Unknown recovery strategy: ${action.strategy}`)
      }
    } catch (error) {
      return {
        success: false,
        strategy: action.strategy,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  /**
   * Store fallback data for future use
   */
  storeFallbackData(
    key: string,
    data: any,
    context: any = {},
    ttl = 300000 // 5 minutes default
  ): void {
    this.fallbackDataStore.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      source: context.source || 'operation'
    })

    this.emit('fallbackDataStored', key, data)
  }

  /**
   * Get fallback data if available and not expired
   */
  getFallbackData(key: string): any | null {
    const entry = this.fallbackDataStore.get(key)
    
    if (!entry) {
      return null
    }

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.fallbackDataStore.delete(key)
      return null
    }

    return entry.data
  }

  /**
   * Clear expired fallback data
   */
  clearExpiredFallbackData(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [key, entry] of this.fallbackDataStore.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        expiredKeys.push(key)
      }
    }

    expiredKeys.forEach(key => this.fallbackDataStore.delete(key))
    
    if (expiredKeys.length > 0) {
      this.emit('fallbackDataCleared', expiredKeys)
    }
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStatistics(): {
    state: RecoveryState
    fallbackDataCount: number
    operationSuccessRates: Array<{
      operationId: string
      totalAttempts: number
      successRate: number
      averageExecutionTime: number
    }>
    circuitBreakerStats: {
      state: string
      timeSinceLastStateChange: number
      totalStateChanges: number
    }
  } {
    const operationSuccessRates = Array.from(this.operationHistory.entries())
      .map(([operationId, history]) => {
        const totalAttempts = history.length
        const successfulAttempts = history.filter(h => h.success).length
        const totalExecutionTime = history.reduce((sum, h) => sum + h.executionTime, 0)
        
        return {
          operationId,
          totalAttempts,
          successRate: totalAttempts > 0 ? successfulAttempts / totalAttempts : 0,
          averageExecutionTime: totalAttempts > 0 ? totalExecutionTime / totalAttempts : 0
        }
      })

    return {
      state: { ...this.recoveryState },
      fallbackDataCount: this.fallbackDataStore.size,
      operationSuccessRates,
      circuitBreakerStats: {
        state: this.recoveryState.circuitBreakerState,
        timeSinceLastStateChange: Date.now() - this.recoveryState.lastCircuitBreakerStateChange,
        totalStateChanges: 0 // This would need to be tracked separately
      }
    }
  }

  /**
   * Reset recovery state and clear data
   */
  reset(): void {
    this.recoveryState = {
      retryCount: 0,
      lastRetryAt: 0,
      totalRecoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      averageRecoveryTime: 0,
      circuitBreakerState: 'closed',
      lastCircuitBreakerStateChange: Date.now()
    }
    
    this.fallbackDataStore.clear()
    this.operationHistory.clear()
    
    this.emit('recoveryServiceReset')
  }

  // Private implementation methods

  private async executeRetryRecovery(
    action: RecoveryAction,
    operationId: string,
    context: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    if (action.action) {
      await action.action()
    }
    
    return {
      success: true,
      strategy: RecoveryStrategy.RETRY,
      executionTime: Date.now() - startTime
    }
  }

  private async executeFallbackRecovery(
    action: RecoveryAction,
    operationId: string,
    context: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    // Try to get fallback data
    const fallbackData = this.getFallbackData(operationId)
    
    if (fallbackData) {
      return {
        success: true,
        strategy: RecoveryStrategy.FALLBACK,
        executionTime: Date.now() - startTime,
        recoveredData: fallbackData,
        fallbackUsed: true
      }
    }

    // Execute custom fallback action if available
    if (action.action) {
      await action.action()
      return {
        success: true,
        strategy: RecoveryStrategy.FALLBACK,
        executionTime: Date.now() - startTime
      }
    }

    throw new Error('No fallback data or action available')
  }

  private async executeCacheRecovery(
    action: RecoveryAction,
    operationId: string,
    context: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    // Try cache recovery
    const cachedData = this.getFallbackData(`cache_${operationId}`)
    
    if (cachedData) {
      return {
        success: true,
        strategy: RecoveryStrategy.CACHE,
        executionTime: Date.now() - startTime,
        recoveredData: cachedData
      }
    }

    if (action.action) {
      await action.action()
    }

    return {
      success: true,
      strategy: RecoveryStrategy.CACHE,
      executionTime: Date.now() - startTime
    }
  }

  private async executeOfflineRecovery(
    action: RecoveryAction,
    operationId: string,
    context: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    // Switch to offline mode
    this.emit('offlineModeActivated', operationId)
    
    if (action.action) {
      await action.action()
    }

    return {
      success: true,
      strategy: RecoveryStrategy.OFFLINE,
      executionTime: Date.now() - startTime
    }
  }

  private async executeUserActionRecovery(
    action: RecoveryAction,
    operationId: string,
    context: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    
    // Emit user action required event
    this.emit('userActionRequired', {
      operationId,
      action,
      message: action.userMessage || action.description
    })

    if (action.action) {
      await action.action()
    }

    return {
      success: true,
      strategy: RecoveryStrategy.USER_ACTION,
      executionTime: Date.now() - startTime
    }
  }

  private classifyErrorForRetry(error: Error): ErrorType {
    const message = error.message.toLowerCase()
    
    if (message.includes('timeout')) {
      return ErrorType.CLI_TIMEOUT
    }
    if (message.includes('network') || message.includes('connection')) {
      return ErrorType.NETWORK_UNAVAILABLE
    }
    if (message.includes('parse') || message.includes('json')) {
      return ErrorType.CLI_PARSE_ERROR
    }
    
    return ErrorType.UNKNOWN
  }

  private isRetryableError(errorType: ErrorType): boolean {
    return this.retryConfig.retryableErrors!.includes(errorType)
  }

  private calculateRetryDelay(attemptNumber: number): number {
    const { baseDelay, maxDelay, backoffMultiplier, jitter } = this.retryConfig
    
    let delay = baseDelay! * Math.pow(backoffMultiplier!, attemptNumber - 1)
    delay = Math.min(delay, maxDelay!)
    
    // Add jitter to prevent thundering herd
    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5)
    }
    
    return Math.round(delay)
  }

  private shouldTryCircuitBreaker(): boolean {
    const timeSinceLastChange = Date.now() - this.recoveryState.lastCircuitBreakerStateChange
    return timeSinceLastChange >= this.circuitBreakerConfig.resetTimeout!
  }

  private updateCircuitBreaker(success: boolean): void {
    const { failureThreshold } = this.circuitBreakerConfig
    
    if (success) {
      if (this.recoveryState.circuitBreakerState === 'half-open') {
        this.recoveryState.circuitBreakerState = 'closed'
        this.recoveryState.lastCircuitBreakerStateChange = Date.now()
        this.emit('circuitBreakerStateChanged', 'closed')
      }
    } else {
      if (this.recoveryState.circuitBreakerState === 'closed') {
        if (this.recoveryState.failedRecoveries >= failureThreshold!) {
          this.recoveryState.circuitBreakerState = 'open'
          this.recoveryState.lastCircuitBreakerStateChange = Date.now()
          this.emit('circuitBreakerStateChanged', 'open')
        }
      } else if (this.recoveryState.circuitBreakerState === 'half-open') {
        this.recoveryState.circuitBreakerState = 'open'
        this.recoveryState.lastCircuitBreakerStateChange = Date.now()
        this.emit('circuitBreakerStateChanged', 'open')
      }
    }
  }

  private recordOperationSuccess(
    operationId: string,
    executionTime: number,
    strategy: RecoveryStrategy
  ): void {
    if (!this.operationHistory.has(operationId)) {
      this.operationHistory.set(operationId, [])
    }
    
    const history = this.operationHistory.get(operationId)!
    history.push({
      timestamp: Date.now(),
      success: true,
      executionTime,
      strategy
    })
    
    // Keep only last 100 entries per operation
    if (history.length > 100) {
      history.splice(0, history.length - 100)
    }
  }

  private recordOperationFailure(operationId: string, executionTime: number): void {
    if (!this.operationHistory.has(operationId)) {
      this.operationHistory.set(operationId, [])
    }
    
    const history = this.operationHistory.get(operationId)!
    history.push({
      timestamp: Date.now(),
      success: false,
      executionTime,
      strategy: RecoveryStrategy.NONE
    })
    
    // Keep only last 100 entries per operation
    if (history.length > 100) {
      history.splice(0, history.length - 100)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Export default instance
export const recoveryService = new RecoveryService()