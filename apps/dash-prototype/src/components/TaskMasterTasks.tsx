import React from 'react'
import { Box, Text } from 'ink'
import { TaskMasterTask, TaskMasterNextTask } from '../services/taskmaster.service'

interface TaskMasterTasksProps {
  tasks: TaskMasterTask[]
  nextTask: TaskMasterNextTask | null
  selectedIndex?: number
  maxItems?: number
  compact?: boolean
  showComplexity?: boolean
  showDependencies?: boolean
  onTaskSelected?: (task: TaskMasterTask) => void
  showDetailHint?: boolean
}

export const TaskMasterTasks: React.FC<TaskMasterTasksProps> = ({
  tasks,
  nextTask,
  selectedIndex = -1,
  maxItems = 10,
  compact = false,
  showComplexity = true,
  showDependencies = false,
  onTaskSelected,
  showDetailHint = false
}) => {
  const getStatusSymbol = (status: TaskMasterTask['status']) => {
    switch (status) {
      case 'done': return '✅'
      case 'in-progress': return '🔄'
      case 'review': return '👀'
      case 'deferred': return '⏸️'
      case 'cancelled': return '❌'
      default: return '⭕'
    }
  }

  const getStatusColor = (status: TaskMasterTask['status']) => {
    switch (status) {
      case 'done': return 'green'
      case 'in-progress': return 'yellow'
      case 'review': return 'blue'
      case 'deferred': return 'gray'
      case 'cancelled': return 'red'
      default: return 'white'
    }
  }

  const getPriorityColor = (priority: TaskMasterTask['priority']) => {
    switch (priority) {
      case 'high': return 'red'
      case 'medium': return 'yellow'
      case 'low': return 'green'
      default: return 'white'
    }
  }

  const getComplexityIndicator = (complexity: number | null) => {
    if (!complexity) return ''
    if (complexity >= 8) return '🔴'
    if (complexity >= 6) return '🟡'
    if (complexity >= 4) return '🟢'
    return '⚪'
  }

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength - 3) + '...'
  }

  // Show recent tasks (in-progress, pending, review) first, then completed
  const sortedTasks = [...tasks].sort((a, b) => {
    const statusPriority = {
      'in-progress': 1,
      'pending': 2,
      'review': 3,
      'done': 4,
      'deferred': 5,
      'cancelled': 6
    }
    return statusPriority[a.status] - statusPriority[b.status]
  })

  const displayTasks = sortedTasks.slice(0, maxItems)

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No tasks available</Text>
        {nextTask && !nextTask.available && (
          <Text dimColor>Reason: {nextTask.reason}</Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Next Task Highlight */}
      {nextTask && nextTask.available && nextTask.id && (
        <Box marginBottom={1}>
          <Box borderStyle="bold" borderColor="cyan" paddingX={1}>
            <Text bold color="cyan">⚡ NEXT: </Text>
            <Text bold>{nextTask.title || `Task #${nextTask.id}`}</Text>
            {nextTask.priority && (
              <Text color={getPriorityColor(nextTask.priority as any)}>
                {' '}({nextTask.priority})
              </Text>
            )}
          </Box>
        </Box>
      )}

      {/* Task List */}
      {displayTasks.map((task, index) => {
        const isSelected = index === selectedIndex
        const isNextTask = nextTask?.id === task.id
        
        return (
          <Box 
            key={task.id} 
            flexDirection={compact ? "row" : "column"}
            backgroundColor={isSelected ? 'gray' : undefined}
            marginBottom={compact ? 0 : 1}
          >
            <Box flexDirection="row" alignItems="center">
              {/* Status and Priority */}
              <Text color={getStatusColor(task.status)}>
                {getStatusSymbol(task.status)}
              </Text>
              
              <Text bold marginLeft={1} color={isNextTask ? 'cyan' : 'white'}>
                #{task.id}
              </Text>
              
              <Text 
                marginLeft={1} 
                color={isSelected ? 'yellow' : (isNextTask ? 'cyan' : 'white')}
              >
                {compact ? truncateText(task.title, 30) : task.title}
              </Text>
              
              {/* Priority indicator */}
              <Text 
                marginLeft={1} 
                color={getPriorityColor(task.priority)}
                dimColor={!isSelected}
              >
                [{task.priority.charAt(0).toUpperCase()}]
              </Text>
              
              {/* Complexity indicator */}
              {showComplexity && task.complexity && (
                <Text marginLeft={1}>
                  {getComplexityIndicator(task.complexity)} {task.complexity}
                </Text>
              )}
              
              {/* Detail view hint */}
              {isSelected && showDetailHint && onTaskSelected && (
                <Text marginLeft={2} dimColor>
                  Press Enter for details
                </Text>
              )}
            </Box>
            
            {/* Dependencies (if shown and available) */}
            {!compact && showDependencies && task.dependencies.length > 0 && (
              <Box marginLeft={2} marginTop={1}>
                <Text dimColor>
                  Depends on: {task.dependencies.join(', ')}
                </Text>
              </Box>
            )}
            
            {/* Subtasks count */}
            {!compact && task.subtasks && task.subtasks.length > 0 && (
              <Box marginLeft={2} marginTop={1}>
                <Text dimColor>
                  Subtasks: {task.subtasks.filter(st => st.status === 'done').length}/{task.subtasks.length} completed
                </Text>
              </Box>
            )}
          </Box>
        )
      })}
      
      {/* Show count if there are more tasks */}
      {tasks.length > maxItems && (
        <Box marginTop={1}>
          <Text dimColor>
            ... and {tasks.length - maxItems} more tasks
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default TaskMasterTasks