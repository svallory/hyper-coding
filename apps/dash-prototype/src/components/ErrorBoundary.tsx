import React, { Component, ReactNode } from 'react'
import { Box, Text } from 'ink'
import { errorHandler, TaskMasterError, ErrorType } from '../services/error-handler.service'
import { ErrorDisplay } from './ErrorDisplay'

interface ErrorBoundaryState {
  hasError: boolean
  error: TaskMasterError | null
  errorInfo: React.ErrorInfo | null
  retryCount: number
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: TaskMasterError, errorInfo: React.ErrorInfo) => void
  maxRetries?: number
  resetOnPropsChange?: boolean
  resetKeys?: Array<string | number>
}

/**
 * Enhanced error boundary with TaskMaster error handling integration
 * 
 * Features:
 * - Automatic error classification and recovery
 * - Retry mechanisms with exponential backoff
 * - Graceful fallback UI
 * - Error reporting and diagnostics
 * - Integration with centralized error handling
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null
  private previousResetKeys: Array<string | number>

  constructor(props: ErrorBoundaryProps) {
    super(props)
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    }

    this.previousResetKeys = props.resetKeys || []
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // This will trigger componentDidCatch
    return {
      hasError: true
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const context = {
      component: 'ErrorBoundary',
      operation: 'render',
      retryCount: this.state.retryCount,
      componentStack: errorInfo.componentStack,
      errorBoundary: this.constructor.name
    }

    // Create TaskMaster error from React error
    const taskMasterError = errorHandler.createError(error, context)
    
    this.setState({
      error: taskMasterError,
      errorInfo
    })

    // Call onError prop if provided
    if (this.props.onError) {
      this.props.onError(taskMasterError, errorInfo)
    }

    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKeys } = this.props
    const hasResetKeysChanged = resetKeys && 
      (resetKeys.length !== this.previousResetKeys.length ||
       resetKeys.some((key, index) => key !== this.previousResetKeys[index]))

    if (hasResetKeysChanged && this.state.hasError) {
      this.resetErrorBoundary()
    }

    this.previousResetKeys = resetKeys || []
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }
  }

  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    })
  }

  handleRetry = () => {
    const maxRetries = this.props.maxRetries || 3
    
    if (this.state.retryCount >= maxRetries) {
      return
    }

    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1
    }))

    // Set a timeout to reset error boundary if retry fails
    this.resetTimeoutId = window.setTimeout(() => {
      if (this.state.hasError) {
        // If still has error after retry, escalate
        this.setState(prevState => ({
          retryCount: prevState.retryCount + 1
        }))
      }
    }, 1000)
  }

  handleRecoveryAction = async (action: any) => {
    try {
      if (action.action) {
        await action.action()
      }
      
      // Reset error boundary after successful recovery
      this.resetErrorBoundary()
    } catch (recoveryError) {
      console.error('Recovery action failed:', recoveryError)
      // Could update state to show recovery failure
    }
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props
      const { error, retryCount } = this.state
      const maxRetries = this.props.maxRetries || 3

      // If a custom fallback is provided, use it
      if (fallback) {
        return fallback
      }

      // Determine if we should show retry option
      const canRetry = retryCount < maxRetries && error.isTransient

      return (
        <Box flexDirection="column" padding={1}>
          <Box borderStyle="double" borderColor="red" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text color="redBright" bold>
                🚨 Application Error
              </Text>
              
              <Box marginTop={1}>
                <Text>
                  An unexpected error occurred in the dashboard component.
                </Text>
              </Box>

              {retryCount > 0 && (
                <Box marginTop={1}>
                  <Text color="yellow">
                    Retry attempt {retryCount} of {maxRetries}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>

          <Box marginTop={1}>
            <ErrorDisplay
              error={error}
              compact={false}
              showTechnicalDetails={true}
              showRecoveryActions={true}
              onRecoveryAction={this.handleRecoveryAction}
            />
          </Box>

          <Box marginTop={1} flexDirection="row">
            {canRetry && (
              <Box 
                borderStyle="single" 
                borderColor="yellow" 
                paddingX={1}
                marginRight={1}
              >
                <Text 
                  color="yellow"
                  onClick={this.handleRetry}
                >
                  🔄 Retry ({maxRetries - retryCount} attempts left)
                </Text>
              </Box>
            )}

            <Box 
              borderStyle="single" 
              borderColor="blue" 
              paddingX={1}
              marginRight={1}
            >
              <Text 
                color="blue"
                onClick={this.resetErrorBoundary}
              >
                🔄 Reset Dashboard
              </Text>
            </Box>

            <Box 
              borderStyle="single" 
              borderColor="red" 
              paddingX={1}
            >
              <Text 
                color="red"
                onClick={() => process.exit(1)}
              >
                ❌ Exit Application
              </Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Error ID: {error.id} | Time: {new Date(error.context.timestamp).toLocaleString()}
            </Text>
          </Box>
        </Box>
      )
    }

    return this.props.children
  }
}

/**
 * Higher-order component to wrap components with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  )

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`
  
  return WrappedComponent
}

/**
 * Hook to manually trigger error boundary
 */
export function useErrorHandler() {
  return (error: Error, errorInfo?: any) => {
    // This will trigger the nearest error boundary
    throw error
  }
}

export default ErrorBoundary