import React from 'react'
import { Box, Text } from 'ink'
import { TaskMasterStats } from '../services/taskmaster.service'

interface TaskMasterStatsProps {
  stats: TaskMasterStats | null
  compact?: boolean
  showProgressBar?: boolean
}

export const TaskMasterStatsComponent: React.FC<TaskMasterStatsProps> = ({
  stats,
  compact = false,
  showProgressBar = true
}) => {
  if (!stats) {
    return (
      <Box>
        <Text dimColor>No statistics available</Text>
      </Box>
    )
  }

  const progressBar = showProgressBar && !compact ? 
    '█'.repeat(Math.floor(stats.progressPercentage / 5)) +
    '░'.repeat(20 - Math.floor(stats.progressPercentage / 5)) : null

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'green'
    if (percentage >= 70) return 'yellow'
    if (percentage >= 50) return 'cyan'
    return 'red'
  }

  if (compact) {
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={getProgressColor(stats.progressPercentage)}>
            {stats.progressPercentage}%
          </Text>
          <Text dimColor> ({stats.completedTasks}/{stats.totalTasks})</Text>
        </Box>
        <Box flexDirection="row">
          {stats.inProgressTasks > 0 && (
            <>
              <Text color="yellow">▶ {stats.inProgressTasks}</Text>
              <Text dimColor> </Text>
            </>
          )}
          {stats.pendingTasks > 0 && (
            <>
              <Text color="white">○ {stats.pendingTasks}</Text>
              <Text dimColor> </Text>
            </>
          )}
          {stats.blockedTasks > 0 && (
            <Text color="red">⚠ {stats.blockedTasks}</Text>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Main Progress */}
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>Task Progress:</Text>
          <Text color={getProgressColor(stats.progressPercentage)} bold>
            {stats.progressPercentage}%
          </Text>
        </Box>
        
        {progressBar && (
          <Box marginTop={1}>
            <Text color={getProgressColor(stats.progressPercentage)}>
              [{progressBar}]
            </Text>
          </Box>
        )}
        
        <Box marginTop={1} flexDirection="row" justifyContent="space-between">
          <Text dimColor>Completed: </Text>
          <Text color="green">{stats.completedTasks}/{stats.totalTasks}</Text>
        </Box>
      </Box>

      {/* Status Breakdown */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Status Breakdown:</Text>
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Box flexDirection="column">
            {stats.inProgressTasks > 0 && (
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="yellow">In Progress:</Text>
                <Text color="yellow">{stats.inProgressTasks}</Text>
              </Box>
            )}
            {stats.pendingTasks > 0 && (
              <Box flexDirection="row" justifyContent="space-between">
                <Text>Pending:</Text>
                <Text>{stats.pendingTasks}</Text>
              </Box>
            )}
            {stats.blockedTasks > 0 && (
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="red">Blocked:</Text>
                <Text color="red">{stats.blockedTasks}</Text>
              </Box>
            )}
          </Box>
          <Box flexDirection="column">
            {stats.deferredTasks > 0 && (
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="gray">Deferred:</Text>
                <Text color="gray">{stats.deferredTasks}</Text>
              </Box>
            )}
            {stats.cancelledTasks > 0 && (
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="red">Cancelled:</Text>
                <Text color="red">{stats.cancelledTasks}</Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Priority Breakdown */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Priority Breakdown:</Text>
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color="red">High Priority:</Text>
            <Text color="red">{stats.priorityBreakdown.high}</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color="yellow">Medium Priority:</Text>
            <Text color="yellow">{stats.priorityBreakdown.medium}</Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color="green">Low Priority:</Text>
            <Text color="green">{stats.priorityBreakdown.low}</Text>
          </Box>
        </Box>
      </Box>

      {/* Subtask Statistics */}
      {stats.subtaskStats.total > 0 && (
        <Box flexDirection="column">
          <Text bold underline>Subtasks:</Text>
          <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
            <Text dimColor>Completed:</Text>
            <Text color="green">
              {stats.subtaskStats.completed}/{stats.subtaskStats.total}
            </Text>
          </Box>
          {stats.subtaskStats.inProgress > 0 && (
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor>In Progress:</Text>
              <Text color="yellow">{stats.subtaskStats.inProgress}</Text>
            </Box>
          )}
          {stats.subtaskStats.pending > 0 && (
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor>Pending:</Text>
              <Text>{stats.subtaskStats.pending}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

export default TaskMasterStatsComponent