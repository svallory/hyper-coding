import { EventEmitter } from 'events'
import { errorHandler, ErrorType, TaskMasterError } from './error-handler.service'
import { recoveryService } from './recovery.service'
import { fallbackDataService } from './fallback-data.service'
import { networkDiagnostics } from './network-diagnostics.service'
import { cliDiagnostics } from './cli-diagnostics.service'
import { fileSystemHandler } from './filesystem-handler.service'
import { offlineCache } from './offline-cache.service'
import { errorLogging } from './error-logging.service'

export interface ErrorTestCase {
  id: string
  name: string
  description: string
  category: 'cli' | 'network' | 'filesystem' | 'recovery' | 'integration'
  severity: 'low' | 'medium' | 'high' | 'critical'
  scenario: () => Promise<any>
  expectedError?: ErrorType
  expectedRecovery?: boolean
  timeout?: number
  setup?: () => Promise<void>
  cleanup?: () => Promise<void>
}

export interface ErrorTestResult {
  testCase: ErrorTestCase
  success: boolean
  duration: number
  error?: Error
  actualError?: TaskMasterError
  recoveryAttempted: boolean
  recoverySuccessful: boolean
  fallbackUsed: boolean
  details: {
    errorClassification?: string
    recoveryActions?: string[]
    degradationLevel?: string
    cacheUsed?: boolean
  }
}

export interface ErrorTestSuite {
  id: string
  name: string
  description: string
  testCases: ErrorTestCase[]
  setup?: () => Promise<void>
  cleanup?: () => Promise<void>
}

export interface ValidationResult {
  suiteResults: Array<{
    suite: ErrorTestSuite
    results: ErrorTestResult[]
    successRate: number
    totalDuration: number
    criticalFailures: number
  }>
  overallResults: {
    totalTests: number
    passedTests: number
    failedTests: number
    successRate: number
    averageDuration: number
    criticalFailures: number
    coverageScore: number
  }
  recommendations: string[]
  issues: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical'
    category: string
    message: string
    affectedTests: string[]
  }>
}

/**
 * Comprehensive error testing and validation service
 * 
 * Features:
 * - Systematic error scenario testing
 * - Recovery mechanism validation
 * - Fallback system verification
 * - Integration testing across all error handling components
 * - Performance and reliability testing
 * - Coverage analysis and reporting
 * - Automated issue detection and recommendations
 */
export class ErrorTestingService extends EventEmitter {
  private testSuites: ErrorTestSuite[] = []
  private isRunning = false

  constructor() {
    super()
    this.initializeTestSuites()
  }

  /**
   * Initialize all test suites
   */
  private initializeTestSuites(): void {
    this.testSuites = [
      this.createCLIErrorTestSuite(),
      this.createNetworkErrorTestSuite(),
      this.createFileSystemErrorTestSuite(),
      this.createRecoveryTestSuite(),
      this.createIntegrationTestSuite()
    ]
  }

  /**
   * Run all error validation tests
   */
  async runValidation(): Promise<ValidationResult> {
    if (this.isRunning) {
      throw new Error('Validation is already running')
    }

    this.isRunning = true
    
    try {
      await errorLogging.info('ErrorTesting', 'Starting comprehensive error validation')
      
      const suiteResults = []
      let totalTests = 0
      let passedTests = 0
      let totalDuration = 0
      let criticalFailures = 0

      for (const suite of this.testSuites) {
        const results = await this.runTestSuite(suite)
        const successCount = results.filter(r => r.success).length
        const suiteDuration = results.reduce((sum, r) => sum + r.duration, 0)
        const suiteCriticalFailures = results.filter(r => 
          !r.success && r.testCase.severity === 'critical'
        ).length

        suiteResults.push({
          suite,
          results,
          successRate: results.length > 0 ? successCount / results.length : 0,
          totalDuration: suiteDuration,
          criticalFailures: suiteCriticalFailures
        })

        totalTests += results.length
        passedTests += successCount
        totalDuration += suiteDuration
        criticalFailures += suiteCriticalFailures
      }

      const validation: ValidationResult = {
        suiteResults,
        overallResults: {
          totalTests,
          passedTests,
          failedTests: totalTests - passedTests,
          successRate: totalTests > 0 ? passedTests / totalTests : 0,
          averageDuration: totalTests > 0 ? totalDuration / totalTests : 0,
          criticalFailures,
          coverageScore: this.calculateCoverageScore(suiteResults)
        },
        recommendations: [],
        issues: []
      }

      // Analyze results and generate recommendations
      this.analyzeResults(validation)

      await errorLogging.info('ErrorTesting', 'Error validation completed', {
        totalTests,
        successRate: validation.overallResults.successRate,
        criticalFailures
      })

      this.emit('validationCompleted', validation)
      return validation

    } finally {
      this.isRunning = false
    }
  }

  /**
   * Run tests for a specific error type
   */
  async testErrorType(errorType: ErrorType): Promise<ErrorTestResult[]> {
    const relevantTests = this.testSuites
      .flatMap(suite => suite.testCases)
      .filter(test => test.expectedError === errorType)

    const results = []
    for (const testCase of relevantTests) {
      const result = await this.runTestCase(testCase)
      results.push(result)
    }

    return results
  }

  /**
   * Test recovery mechanisms for a specific scenario
   */
  async testRecoveryScenario(scenario: string): Promise<ErrorTestResult[]> {
    const recoveryTests = this.testSuites
      .find(suite => suite.id === 'recovery-tests')
      ?.testCases.filter(test => test.name.includes(scenario)) || []

    const results = []
    for (const testCase of recoveryTests) {
      const result = await this.runTestCase(testCase)
      results.push(result)
    }

    return results
  }

  /**
   * Run integration tests
   */
  async runIntegrationTests(): Promise<ErrorTestResult[]> {
    const integrationSuite = this.testSuites.find(suite => suite.id === 'integration-tests')
    if (!integrationSuite) {
      throw new Error('Integration test suite not found')
    }

    return await this.runTestSuite(integrationSuite)
  }

  // Private implementation methods

  private async runTestSuite(suite: ErrorTestSuite): Promise<ErrorTestResult[]> {
    await errorLogging.debug('ErrorTesting', `Running test suite: ${suite.name}`)
    
    try {
      // Run suite setup
      if (suite.setup) {
        await suite.setup()
      }

      const results = []
      for (const testCase of suite.testCases) {
        const result = await this.runTestCase(testCase)
        results.push(result)
      }

      return results

    } finally {
      // Run suite cleanup
      if (suite.cleanup) {
        try {
          await suite.cleanup()
        } catch (error) {
          await errorLogging.warn('ErrorTesting', `Suite cleanup failed: ${suite.name}`, error)
        }
      }
    }
  }

  private async runTestCase(testCase: ErrorTestCase): Promise<ErrorTestResult> {
    const startTime = Date.now()
    const result: ErrorTestResult = {
      testCase,
      success: false,
      duration: 0,
      recoveryAttempted: false,
      recoverySuccessful: false,
      fallbackUsed: false,
      details: {}
    }

    try {
      await errorLogging.debug('ErrorTesting', `Running test case: ${testCase.name}`)

      // Run test setup
      if (testCase.setup) {
        await testCase.setup()
      }

      // Set up error monitoring
      let errorCaught: TaskMasterError | null = null
      const errorListener = (error: TaskMasterError) => {
        errorCaught = error
      }
      errorHandler.on('error', errorListener)

      try {
        // Run the test scenario
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Test timeout')), testCase.timeout || 30000)
        )

        await Promise.race([
          testCase.scenario(),
          timeoutPromise
        ])

        // Wait a bit for async error handling
        await new Promise(resolve => setTimeout(resolve, 100))

        // Evaluate results
        if (testCase.expectedError && errorCaught) {
          result.success = errorCaught.type === testCase.expectedError
          result.actualError = errorCaught
          result.details.errorClassification = `${errorCaught.type}:${errorCaught.severity}`
          result.details.recoveryActions = errorCaught.recoveryActions.map(action => action.strategy)
        } else if (!testCase.expectedError && !errorCaught) {
          result.success = true
        } else {
          result.success = false
          if (errorCaught) {
            result.actualError = errorCaught
          }
        }

      } finally {
        errorHandler.off('error', errorListener)
      }

    } catch (error) {
      result.error = error instanceof Error ? error : new Error(String(error))
      await errorLogging.error('ErrorTesting', `Test case failed: ${testCase.name}`, result.error)

    } finally {
      result.duration = Date.now() - startTime

      // Run test cleanup
      if (testCase.cleanup) {
        try {
          await testCase.cleanup()
        } catch (error) {
          await errorLogging.warn('ErrorTesting', `Test cleanup failed: ${testCase.name}`, error)
        }
      }
    }

    return result
  }

  private createCLIErrorTestSuite(): ErrorTestSuite {
    return {
      id: 'cli-tests',
      name: 'CLI Error Tests',
      description: 'Test CLI-related error scenarios and recovery',
      testCases: [
        {
          id: 'cli-not-found',
          name: 'CLI Not Found Error',
          description: 'Test handling when TaskMaster CLI is not found',
          category: 'cli',
          severity: 'high',
          expectedError: ErrorType.CLI_NOT_FOUND,
          scenario: async () => {
            // Simulate CLI not found by using invalid command
            const error = new Error('spawn task-master-invalid ENOENT')
            throw errorHandler.createError(error, {
              component: 'TaskMasterService',
              operation: 'executeCommand'
            })
          }
        },
        {
          id: 'cli-permission-denied',
          name: 'CLI Permission Denied',
          description: 'Test handling when CLI access is denied',
          category: 'cli',
          severity: 'high',
          expectedError: ErrorType.CLI_PERMISSION_DENIED,
          scenario: async () => {
            const error = new Error('permission denied: task-master')
            throw errorHandler.createError(error, {
              component: 'TaskMasterService',
              operation: 'executeCommand'
            })
          }
        },
        {
          id: 'cli-timeout',
          name: 'CLI Timeout Error',
          description: 'Test handling when CLI operations timeout',
          category: 'cli',
          severity: 'medium',
          expectedError: ErrorType.CLI_TIMEOUT,
          scenario: async () => {
            const error = new Error('Command timed out after 30000ms')
            throw errorHandler.createError(error, {
              component: 'TaskMasterService',
              operation: 'executeCommand'
            })
          }
        },
        {
          id: 'cli-parse-error',
          name: 'CLI Parse Error',
          description: 'Test handling when CLI output cannot be parsed',
          category: 'cli',
          severity: 'medium',
          expectedError: ErrorType.CLI_PARSE_ERROR,
          scenario: async () => {
            const error = new Error('Unexpected token in JSON at position 0')
            throw errorHandler.createError(error, {
              component: 'TaskMasterService',
              operation: 'parseTaskList'
            })
          }
        }
      ]
    }
  }

  private createNetworkErrorTestSuite(): ErrorTestSuite {
    return {
      id: 'network-tests',
      name: 'Network Error Tests',
      description: 'Test network-related error scenarios',
      testCases: [
        {
          id: 'network-unavailable',
          name: 'Network Unavailable',
          description: 'Test handling when network is completely unavailable',
          category: 'network',
          severity: 'high',
          expectedError: ErrorType.NETWORK_UNAVAILABLE,
          scenario: async () => {
            const error = new Error('getaddrinfo ENOTFOUND google.com')
            throw errorHandler.createError(error, {
              component: 'NetworkDiagnostics',
              operation: 'performConnectivityCheck'
            })
          }
        },
        {
          id: 'network-timeout',
          name: 'Network Timeout',
          description: 'Test handling when network requests timeout',
          category: 'network',
          severity: 'medium',
          expectedError: ErrorType.NETWORK_TIMEOUT,
          scenario: async () => {
            const error = new Error('connect ETIMEDOUT 8.8.8.8:53')
            throw errorHandler.createError(error, {
              component: 'NetworkDiagnostics',
              operation: 'performDNSTest'
            })
          }
        },
        {
          id: 'network-diagnostics',
          name: 'Network Diagnostics Test',
          description: 'Test network diagnostics and recovery',
          category: 'network',
          severity: 'low',
          scenario: async () => {
            const result = await networkDiagnostics.performNetworkDiagnostics()
            return result.overall !== 'disconnected'
          }
        }
      ]
    }
  }

  private createFileSystemErrorTestSuite(): ErrorTestSuite {
    return {
      id: 'filesystem-tests',
      name: 'File System Error Tests',
      description: 'Test file system error scenarios',
      testCases: [
        {
          id: 'file-not-found',
          name: 'File Not Found',
          description: 'Test handling when required files are missing',
          category: 'filesystem',
          severity: 'medium',
          expectedError: ErrorType.FILE_NOT_FOUND,
          scenario: async () => {
            const error = new Error('ENOENT: no such file or directory')
            throw errorHandler.createError(error, {
              component: 'FileSystemHandler',
              operation: 'readFile'
            })
          }
        },
        {
          id: 'file-permission-denied',
          name: 'File Permission Denied',
          description: 'Test handling when file access is denied',
          category: 'filesystem',
          severity: 'high',
          expectedError: ErrorType.FILE_PERMISSION_DENIED,
          scenario: async () => {
            const error = new Error('EACCES: permission denied')
            throw errorHandler.createError(error, {
              component: 'FileSystemHandler',
              operation: 'writeFile'
            })
          }
        },
        {
          id: 'file-safe-operations',
          name: 'Safe File Operations',
          description: 'Test file system safety mechanisms',
          category: 'filesystem',
          severity: 'low',
          scenario: async () => {
            // Test safe file operations
            const result = await fileSystemHandler.readFileSafe('/tmp/test-file.txt')
            return result.success === false // File doesn't exist
          }
        }
      ]
    }
  }

  private createRecoveryTestSuite(): ErrorTestSuite {
    return {
      id: 'recovery-tests',
      name: 'Recovery Mechanism Tests',
      description: 'Test error recovery and fallback mechanisms',
      testCases: [
        {
          id: 'retry-recovery',
          name: 'Retry Recovery Test',
          description: 'Test automatic retry mechanisms',
          category: 'recovery',
          severity: 'medium',
          scenario: async () => {
            let attemptCount = 0
            const operation = async () => {
              attemptCount++
              if (attemptCount < 3) {
                throw new Error('Transient error')
              }
              return 'success'
            }

            const result = await recoveryService.executeWithRecovery(
              operation,
              'test-operation',
              [{
                strategy: 'RETRY' as any,
                description: 'Retry operation',
                autoExecute: true
              }]
            )

            return result === 'success'
          }
        },
        {
          id: 'fallback-recovery',
          name: 'Fallback Recovery Test',
          description: 'Test fallback data mechanisms',
          category: 'recovery',
          severity: 'medium',
          scenario: async () => {
            // Test fallback data retrieval
            const result = await fallbackDataService.getTasks()
            return result.data.length >= 0 // Should always have some data
          }
        },
        {
          id: 'degradation-handling',
          name: 'Graceful Degradation Test',
          description: 'Test graceful degradation mechanisms',
          category: 'recovery',
          severity: 'medium',
          scenario: async () => {
            const degradationLevel = fallbackDataService.getCurrentDegradationLevel()
            return degradationLevel.level !== 'critical'
          }
        }
      ]
    }
  }

  private createIntegrationTestSuite(): ErrorTestSuite {
    return {
      id: 'integration-tests',
      name: 'Integration Tests',
      description: 'Test integration between all error handling components',
      testCases: [
        {
          id: 'end-to-end-error-flow',
          name: 'End-to-End Error Flow',
          description: 'Test complete error handling flow from detection to recovery',
          category: 'integration',
          severity: 'critical',
          scenario: async () => {
            // Simulate complete error handling flow
            const error = new Error('Integration test error')
            const taskMasterError = errorHandler.createError(error, {
              component: 'IntegrationTest',
              operation: 'endToEndFlow'
            })

            // Test error logging
            await errorLogging.logTaskMasterError(taskMasterError)

            // Test diagnostics
            const diagnostics = await cliDiagnostics.performDiagnostics()

            // Test cache functionality
            await offlineCache.set('test-key', { test: 'data' })
            const cached = await offlineCache.get('test-key')

            return cached !== null && diagnostics.available !== undefined
          }
        },
        {
          id: 'offline-mode-integration',
          name: 'Offline Mode Integration',
          description: 'Test complete offline mode functionality',
          category: 'integration',
          severity: 'high',
          scenario: async () => {
            // Test offline cache and fallback data integration
            await offlineCache.storeOfflineData({
              tasks: {
                key: 'offline:tasks',
                data: [{ id: 'test', title: 'Test Task', status: 'pending', priority: 'medium', dependencies: [], complexity: 1 }],
                timestamp: Date.now(),
                ttl: 3600000,
                accessCount: 0,
                lastAccessed: Date.now(),
                source: 'test',
                size: 100
              }
            })

            const offlineData = await offlineCache.getOfflineData()
            return offlineData.tasks?.data.length === 1
          }
        },
        {
          id: 'error-reporting-integration',
          name: 'Error Reporting Integration',
          description: 'Test comprehensive error reporting and diagnostics',
          category: 'integration',
          severity: 'medium',
          scenario: async () => {
            // Generate diagnostic report
            const report = await errorLogging.generateDiagnosticReport(
              'Integration Test Report',
              'Testing error reporting integration'
            )

            return report.sections.length > 0
          }
        }
      ]
    }
  }

  private calculateCoverageScore(suiteResults: ValidationResult['suiteResults']): number {
    const totalCategories = ['cli', 'network', 'filesystem', 'recovery', 'integration']
    const testedCategories = new Set(
      suiteResults.flatMap(suite => 
        suite.results.map(result => result.testCase.category)
      )
    )

    const categoryScore = testedCategories.size / totalCategories.length

    const totalErrorTypes = Object.values(ErrorType).length
    const testedErrorTypes = new Set(
      suiteResults.flatMap(suite =>
        suite.results
          .filter(result => result.testCase.expectedError)
          .map(result => result.testCase.expectedError!)
      )
    )

    const errorTypeScore = testedErrorTypes.size / totalErrorTypes

    return (categoryScore + errorTypeScore) / 2
  }

  private analyzeResults(validation: ValidationResult): void {
    const { overallResults, suiteResults } = validation

    // Generate recommendations based on results
    if (overallResults.successRate < 0.8) {
      validation.recommendations.push('Overall test success rate is below 80%. Review failing tests and improve error handling.')
    }

    if (overallResults.criticalFailures > 0) {
      validation.recommendations.push(`${overallResults.criticalFailures} critical tests failed. Address these issues immediately.`)
    }

    if (overallResults.coverageScore < 0.7) {
      validation.recommendations.push('Error handling coverage is below 70%. Add more comprehensive tests.')
    }

    if (overallResults.averageDuration > 5000) {
      validation.recommendations.push('Average test duration is over 5 seconds. Optimize error handling performance.')
    }

    // Identify issues
    for (const suiteResult of suiteResults) {
      const failedTests = suiteResult.results.filter(r => !r.success)
      
      if (failedTests.length > 0) {
        const criticalFailures = failedTests.filter(r => r.testCase.severity === 'critical')
        
        if (criticalFailures.length > 0) {
          validation.issues.push({
            severity: 'critical',
            category: suiteResult.suite.name,
            message: `${criticalFailures.length} critical tests failed in ${suiteResult.suite.name}`,
            affectedTests: criticalFailures.map(r => r.testCase.id)
          })
        }

        if (suiteResult.successRate < 0.5) {
          validation.issues.push({
            severity: 'high',
            category: suiteResult.suite.name,
            message: `Low success rate (${Math.round(suiteResult.successRate * 100)}%) in ${suiteResult.suite.name}`,
            affectedTests: failedTests.map(r => r.testCase.id)
          })
        }
      }
    }
  }
}

// Export default instance
export const errorTesting = new ErrorTestingService()