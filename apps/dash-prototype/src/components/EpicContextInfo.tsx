import React from 'react'
import { Box, Text } from 'ink'
import { EpicContext } from '../services/epic-context.service'

interface EpicContextInfoProps {
  context: EpicContext | null
  isCompact?: boolean
  isFocused?: boolean
  showSwitchHint?: boolean
}

export const EpicContextInfo: React.FC<EpicContextInfoProps> = ({
  context,
  isCompact = false,
  isFocused = false,
  showSwitchHint = true
}) => {
  if (!context) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠️  No Epic Context Selected</Text>
        {showSwitchHint && (
          <Text dimColor>Press 'e' to select an epic</Text>
        )}
      </Box>
    )
  }

  const { epic } = context

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return 'green'
      case 'in-progress': 
      case 'ready-for-tasks': return 'yellow'
      case 'planning': return 'blue'
      case 'on-hold': return 'gray'
      case 'failed': return 'red'
      default: return 'white'
    }
  }

  const formatLastActivity = (lastActivity?: string) => {
    if (!lastActivity) return 'Unknown'
    try {
      const date = new Date(lastActivity)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffDays = Math.floor(diffHours / 24)
      
      if (diffDays > 0) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
      } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
      } else {
        return 'Recently'
      }
    } catch {
      return 'Unknown'
    }
  }

  if (isCompact) {
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="cyan">📂 </Text>
          <Text bold>{epic.displayName}</Text>
          {epic.progress && (
            <>
              <Text dimColor> • </Text>
              <Text color="yellow">{epic.progress.percentage}%</Text>
            </>
          )}
        </Box>
        <Text color={getStatusColor(epic.status)}>{epic.status}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="cyan">📂 Epic: </Text>
          <Text bold color={isFocused ? 'yellow' : 'white'}>
            {epic.displayName || epic.name}
          </Text>
        </Box>
        <Text color={getStatusColor(epic.status)}>
          {epic.status}
        </Text>
      </Box>

      {/* Description */}
      {epic.description && (
        <Box marginTop={1}>
          <Text dimColor>
            {epic.description.length > 100 
              ? epic.description.substring(0, 97) + '...'
              : epic.description
            }
          </Text>
        </Box>
      )}

      {/* Progress Information */}
      {epic.progress && (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            <Text dimColor>Progress: </Text>
            <Text color="yellow" bold>{epic.progress.percentage}%</Text>
            <Text dimColor> ({epic.progress.completedSteps.length}/{epic.progress.totalSteps} steps)</Text>
          </Box>
          
          {/* Progress bar */}
          <Box marginTop={1}>
            <Text color="yellow">
              [{'█'.repeat(Math.floor(epic.progress.percentage / 5))}
              {'░'.repeat(20 - Math.floor(epic.progress.percentage / 5))}]
            </Text>
          </Box>
        </Box>
      )}

      {/* File status and last activity */}
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Box flexDirection="row">
          <Text dimColor>Files: </Text>
          <Text color={epic.hasWorkflowState ? 'green' : 'gray'}>
            {epic.hasWorkflowState ? '●' : '○'}
          </Text>
          <Text color={epic.hasManifest ? 'green' : 'gray'}>
            {epic.hasManifest ? '●' : '○'}
          </Text>
          <Text color={epic.hasLogs ? 'green' : 'gray'}>
            {epic.hasLogs ? '●' : '○'}
          </Text>
        </Box>
        <Text dimColor>
          Last: {formatLastActivity(epic.lastActivity)}
        </Text>
      </Box>

      {/* TaskMaster status */}
      {context.taskMasterService && (
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Box flexDirection="row">
            <Text dimColor>TaskMaster: </Text>
            <Text color={context.error ? 'red' : 'green'}>
              {context.error ? 'Error' : 'Connected'}
            </Text>
          </Box>
          <Text dimColor>
            Tasks: {context.tasks.length}
          </Text>
        </Box>
      )}

      {/* Context error */}
      {context.error && (
        <Box marginTop={1}>
          <Text color="red">⚠️  {context.error}</Text>
        </Box>
      )}

      {/* Validation errors */}
      {epic.errors.length > 0 && (
        <Box marginTop={1}>
          <Text color="red">
            ⚠️  {epic.errors.length} validation error{epic.errors.length !== 1 ? 's' : ''}
          </Text>
        </Box>
      )}

      {/* Switch hint */}
      {showSwitchHint && !isFocused && (
        <Box marginTop={1}>
          <Text dimColor>Press 'e' to switch epics • 'r' to refresh</Text>
        </Box>
      )}
    </Box>
  )
}

export default EpicContextInfo