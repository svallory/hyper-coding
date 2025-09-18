import React from 'react'
import { Box, Text } from 'ink'
import { TaskMasterCLIAvailability } from '../services/taskmaster.service'

interface TaskMasterStatusProps {
  availability: TaskMasterCLIAvailability | null
  isLoading: boolean
  error: string | null
  lastUpdate: Date | null
  cacheSize: number
  compact?: boolean
}

export const TaskMasterStatus: React.FC<TaskMasterStatusProps> = ({
  availability,
  isLoading,
  error,
  lastUpdate,
  cacheSize,
  compact = false
}) => {
  const getStatusColor = () => {
    if (isLoading) return 'yellow'
    if (error) return 'red'
    if (availability?.available) return 'green'
    return 'gray'
  }

  const getStatusSymbol = () => {
    if (isLoading) return '⏳'
    if (error) return '❌'
    if (availability?.available) return '✅'
    return '⚪'
  }

  const getStatusText = () => {
    if (isLoading) return 'Loading...'
    if (error) return `Error: ${error}`
    if (availability?.available) return `Connected (v${availability.version || 'unknown'})`
    return 'Disconnected'
  }

  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={getStatusColor()}>{getStatusSymbol()}</Text>
        <Text dimColor> TM: </Text>
        <Text color={getStatusColor()}>{availability?.available ? 'OK' : 'N/A'}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={getStatusColor()}>{getStatusSymbol()} TaskMaster CLI: </Text>
          <Text color={getStatusColor()}>{getStatusText()}</Text>
        </Box>
        {cacheSize > 0 && (
          <Text dimColor>Cache: {cacheSize} entries</Text>
        )}
      </Box>
      
      {lastUpdate && (
        <Box marginTop={1}>
          <Text dimColor>Last Update: {lastUpdate.toLocaleTimeString()}</Text>
        </Box>
      )}
      
      {error && !compact && (
        <Box marginTop={1}>
          <Text color="red">⚠️  {error}</Text>
        </Box>
      )}
    </Box>
  )
}

export default TaskMasterStatus