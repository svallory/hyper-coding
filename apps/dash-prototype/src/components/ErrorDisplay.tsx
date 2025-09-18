import React, { useState, useEffect } from 'react'
import { Box, Text, Spacer } from 'ink'
import { TaskMasterError, ErrorSeverity, RecoveryAction, RecoveryStrategy } from '../services/error-handler.service'
import { DegradationLevel } from '../services/fallback-data.service'

interface ErrorDisplayProps {
  error: TaskMasterError | null
  degradationLevel?: DegradationLevel
  compact?: boolean
  showTechnicalDetails?: boolean
  showRecoveryActions?: boolean
  onRecoveryAction?: (action: RecoveryAction) => Promise<void>
  onDismiss?: () => void
}

interface RecoveryActionButtonProps {
  action: RecoveryAction
  onExecute: (action: RecoveryAction) => Promise<void>
  isExecuting: boolean
}

const RecoveryActionButton: React.FC<RecoveryActionButtonProps> = ({ 
  action, 
  onExecute, 
  isExecuting 
}) => {
  const [isHovered, setIsHovered] = useState(false)
  
  const getActionSymbol = (strategy: RecoveryStrategy): string => {
    switch (strategy) {
      case RecoveryStrategy.RETRY: return '🔄'
      case RecoveryStrategy.FALLBACK: return '📋'
      case RecoveryStrategy.CACHE: return '💾'
      case RecoveryStrategy.OFFLINE: return '📱'
      case RecoveryStrategy.USER_ACTION: return '⚠️'
      default: return '🔧'
    }
  }

  const getActionColor = (strategy: RecoveryStrategy): string => {
    switch (strategy) {
      case RecoveryStrategy.RETRY: return 'yellow'
      case RecoveryStrategy.FALLBACK: return 'blue'
      case RecoveryStrategy.CACHE: return 'cyan'
      case RecoveryStrategy.OFFLINE: return 'magenta'
      case RecoveryStrategy.USER_ACTION: return 'red'
      default: return 'white'
    }
  }

  return (
    <Box 
      borderStyle="single" 
      borderColor={isHovered ? 'yellow' : getActionColor(action.strategy)}
      paddingX={1}
      marginRight={1}
    >
      <Text color={getActionColor(action.strategy)}>
        {isExecuting ? '⏳' : getActionSymbol(action.strategy)} {action.description}
      </Text>
    </Box>
  )
}

interface ErrorSummaryProps {
  error: TaskMasterError
  compact: boolean
}

const ErrorSummary: React.FC<ErrorSummaryProps> = ({ error, compact }) => {
  const getSeverityColor = (severity: ErrorSeverity): string => {
    switch (severity) {
      case ErrorSeverity.LOW: return 'yellow'
      case ErrorSeverity.MEDIUM: return 'orange'
      case ErrorSeverity.HIGH: return 'red'
      case ErrorSeverity.CRITICAL: return 'redBright'
      default: return 'white'
    }
  }

  const getSeveritySymbol = (severity: ErrorSeverity): string => {
    switch (severity) {
      case ErrorSeverity.LOW: return 'ℹ️'
      case ErrorSeverity.MEDIUM: return '⚠️'
      case ErrorSeverity.HIGH: return '❌'
      case ErrorSeverity.CRITICAL: return '🚨'
      default: return '❓'
    }
  }

  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={getSeverityColor(error.severity)}>
          {getSeveritySymbol(error.severity)}
        </Text>
        <Text dimColor> Error: </Text>
        <Text>{error.userFriendlyMessage.substring(0, 50)}...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={getSeverityColor(error.severity)}>
          {getSeveritySymbol(error.severity)} {error.severity} ERROR
        </Text>
        <Spacer />
        <Text dimColor>ID: {error.id.split('_')[1]}</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color={getSeverityColor(error.severity)}>
          {error.userFriendlyMessage}
        </Text>
      </Box>
      
      <Box marginTop={1} flexDirection="row">
        <Text dimColor>Type: </Text>
        <Text>{error.type}</Text>
        <Text dimColor> | Component: </Text>
        <Text>{error.context.component || 'Unknown'}</Text>
        <Text dimColor> | </Text>
        <Text>{error.isTransient ? 'Transient' : 'Persistent'}</Text>
      </Box>
    </Box>
  )
}

interface DegradationIndicatorProps {
  degradationLevel: DegradationLevel
  compact: boolean
}

const DegradationIndicator: React.FC<DegradationIndicatorProps> = ({ 
  degradationLevel, 
  compact 
}) => {
  const getLevelColor = (level: DegradationLevel['level']): string => {
    switch (level) {
      case 'none': return 'green'
      case 'minimal': return 'yellow'
      case 'moderate': return 'orange'
      case 'severe': return 'red'
      case 'critical': return 'redBright'
      default: return 'white'
    }
  }

  const getLevelSymbol = (level: DegradationLevel['level']): string => {
    switch (level) {
      case 'none': return '✅'
      case 'minimal': return '🟡'
      case 'moderate': return '🟠'
      case 'severe': return '🔴'
      case 'critical': return '🚨'
      default: return '❓'
    }
  }

  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={getLevelColor(degradationLevel.level)}>
          {getLevelSymbol(degradationLevel.level)}
        </Text>
        <Text dimColor> Mode: </Text>
        <Text color={getLevelColor(degradationLevel.level)}>
          {degradationLevel.level.toUpperCase()}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={getLevelColor(degradationLevel.level)} paddingX={1}>
      <Box flexDirection="row">
        <Text color={getLevelColor(degradationLevel.level)}>
          {getLevelSymbol(degradationLevel.level)} SERVICE STATUS: {degradationLevel.level.toUpperCase()}
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text>{degradationLevel.description}</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color={getLevelColor(degradationLevel.level)}>
          {degradationLevel.userMessage}
        </Text>
      </Box>
      
      {degradationLevel.disabledFeatures.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Unavailable: </Text>
          <Text color="red">{degradationLevel.disabledFeatures.join(', ')}</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text dimColor>Available: </Text>
        <Text color="green">{degradationLevel.availableFeatures.join(', ')}</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>Data Quality: </Text>
        <Text color={degradationLevel.dataQuality === 'high' ? 'green' : 
                     degradationLevel.dataQuality === 'medium' ? 'yellow' : 'red'}>
          {degradationLevel.dataQuality.toUpperCase()}
        </Text>
      </Box>
    </Box>
  )
}

interface TechnicalDetailsProps {
  error: TaskMasterError
}

const TechnicalDetails: React.FC<TechnicalDetailsProps> = ({ error }) => {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text 
          color="blue" 
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? '▼' : '▶'} Technical Details
        </Text>
      </Box>
      
      {showDetails && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {error.technicalDetails && (
            <Box flexDirection="column">
              <Text dimColor>Technical Information:</Text>
              <Text>{error.technicalDetails}</Text>
            </Box>
          )}
          
          {error.diagnostics && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Diagnostics:</Text>
              <Text>{JSON.stringify(error.diagnostics, null, 2)}</Text>
            </Box>
          )}
          
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Context:</Text>
            <Text>Operation: {error.context.operation}</Text>
            <Text>Timestamp: {new Date(error.context.timestamp).toLocaleString()}</Text>
            <Text>Working Directory: {error.context.workingDirectory}</Text>
            {error.context.retryCount && (
              <Text>Retry Count: {error.context.retryCount}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

interface RecoveryActionsProps {
  actions: RecoveryAction[]
  onExecute: (action: RecoveryAction) => Promise<void>
}

const RecoveryActions: React.FC<RecoveryActionsProps> = ({ actions, onExecute }) => {
  const [executingActions, setExecutingActions] = useState<Set<string>>(new Set())

  const handleExecute = async (action: RecoveryAction) => {
    const actionId = `${action.strategy}_${action.description}`
    
    setExecutingActions(prev => new Set(prev).add(actionId))
    
    try {
      await onExecute(action)
    } finally {
      setExecutingActions(prev => {
        const newSet = new Set(prev)
        newSet.delete(actionId)
        return newSet
      })
    }
  }

  const autoExecutableActions = actions.filter(action => action.autoExecute)
  const manualActions = actions.filter(action => !action.autoExecute)

  return (
    <Box flexDirection="column">
      {autoExecutableActions.length > 0 && (
        <Box flexDirection="column">
          <Text color="cyan">🔄 Automatic Recovery Options:</Text>
          <Box flexDirection="row" marginTop={1}>
            {autoExecutableActions.map((action, index) => (
              <RecoveryActionButton
                key={index}
                action={action}
                onExecute={handleExecute}
                isExecuting={executingActions.has(`${action.strategy}_${action.description}`)}
              />
            ))}
          </Box>
        </Box>
      )}
      
      {manualActions.length > 0 && (
        <Box flexDirection="column" marginTop={autoExecutableActions.length > 0 ? 1 : 0}>
          <Text color="yellow">⚠️ Manual Recovery Required:</Text>
          <Box flexDirection="column" marginTop={1}>
            {manualActions.map((action, index) => (
              <Box key={index} flexDirection="column" marginBottom={1}>
                <Box flexDirection="row">
                  <Text color="yellow">• </Text>
                  <Text>{action.description}</Text>
                </Box>
                {action.userMessage && (
                  <Box marginLeft={2}>
                    <Text dimColor>{action.userMessage}</Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  degradationLevel,
  compact = false,
  showTechnicalDetails = false,
  showRecoveryActions = true,
  onRecoveryAction,
  onDismiss
}) => {
  const [isExpanded, setIsExpanded] = useState(!compact)

  // Auto-dismiss low severity errors after a timeout
  useEffect(() => {
    if (error && error.severity === ErrorSeverity.LOW && onDismiss) {
      const timer = setTimeout(onDismiss, 10000) // 10 seconds
      return () => clearTimeout(timer)
    }
  }, [error, onDismiss])

  // Show degradation level if no specific error
  if (!error && degradationLevel && degradationLevel.level !== 'none') {
    return <DegradationIndicator degradationLevel={degradationLevel} compact={compact} />
  }

  if (!error) {
    return null
  }

  // Compact view for minimal space
  if (compact && !isExpanded) {
    return (
      <Box flexDirection="column">
        <Box 
          flexDirection="row" 
          onClick={() => setIsExpanded(true)}
          borderStyle="single"
          borderColor={error.severity === ErrorSeverity.CRITICAL ? 'red' : 'yellow'}
          paddingX={1}
        >
          <ErrorSummary error={error} compact={true} />
          <Spacer />
          <Text dimColor>Click to expand</Text>
        </Box>
      </Box>
    )
  }

  // Full error display
  return (
    <Box flexDirection="column">
      {/* Main error information */}
      <Box 
        borderStyle="double" 
        borderColor={error.severity === ErrorSeverity.CRITICAL ? 'red' : 'yellow'}
        paddingX={1}
      >
        <ErrorSummary error={error} compact={false} />
      </Box>

      {/* Recovery actions */}
      {showRecoveryActions && error.recoveryActions.length > 0 && onRecoveryAction && (
        <Box marginTop={1}>
          <RecoveryActions 
            actions={error.recoveryActions} 
            onExecute={onRecoveryAction}
          />
        </Box>
      )}

      {/* Technical details */}
      {showTechnicalDetails && (
        <Box marginTop={1}>
          <TechnicalDetails error={error} />
        </Box>
      )}

      {/* Degradation level indicator */}
      {degradationLevel && degradationLevel.level !== 'none' && (
        <Box marginTop={1}>
          <DegradationIndicator degradationLevel={degradationLevel} compact={false} />
        </Box>
      )}

      {/* Dismiss button for expandable compact view */}
      {compact && isExpanded && (
        <Box marginTop={1} flexDirection="row">
          <Text 
            color="blue" 
            onClick={() => setIsExpanded(false)}
          >
            ▲ Collapse
          </Text>
          {onDismiss && (
            <>
              <Text> | </Text>
              <Text 
                color="red" 
                onClick={onDismiss}
              >
                ✕ Dismiss
              </Text>
            </>
          )}
        </Box>
      )}
    </Box>
  )
}

export default ErrorDisplay