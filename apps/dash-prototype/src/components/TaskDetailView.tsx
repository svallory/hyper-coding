import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { TaskMasterTask, TaskMasterSubtask } from '../services/taskmaster.service'

interface TaskDetailViewProps {
  task: TaskMasterTask
  isVisible: boolean
  onClose: () => void
  onNavigateToDependency?: (taskId: string) => void
  compact?: boolean
  selectedItem?: number
  onItemSelection?: (index: number) => void
}

interface DetailSection {
  id: string
  title: string
  content: React.ReactNode
  collapsible?: boolean
  collapsed?: boolean
}

export const TaskDetailView: React.FC<TaskDetailViewProps> = ({
  task,
  isVisible,
  onClose,
  onNavigateToDependency,
  compact = false,
  selectedItem = 0,
  onItemSelection
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  if (!isVisible) return null

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
    if (!complexity) return { indicator: '⚪', color: 'gray', label: 'Unknown' }
    if (complexity >= 8) return { indicator: '🔴', color: 'red', label: 'Very High' }
    if (complexity >= 6) return { indicator: '🟡', color: 'yellow', label: 'High' }
    if (complexity >= 4) return { indicator: '🟢', color: 'green', label: 'Medium' }
    return { indicator: '⚪', color: 'blue', label: 'Low' }
  }

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

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    try {
      return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString()
    } catch {
      return dateString
    }
  }

  const complexityInfo = getComplexityIndicator(task.complexity)

  // Build sections for the detail view
  const sections: DetailSection[] = [
    {
      id: 'overview',
      title: 'Overview',
      content: (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold>Status: </Text>
            <Text color={getStatusColor(task.status)}>
              {getStatusSymbol(task.status)} {task.status.toUpperCase()}
            </Text>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Text bold>Priority: </Text>
            <Text color={getPriorityColor(task.priority)}>
              {task.priority.toUpperCase()}
            </Text>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Text bold>Complexity: </Text>
            <Text color={complexityInfo.color}>
              {complexityInfo.indicator} {task.complexity || 'N/A'} ({complexityInfo.label})
            </Text>
          </Box>
          {task.created_at && (
            <Box flexDirection="row" marginTop={1}>
              <Text bold>Created: </Text>
              <Text>{formatDate(task.created_at)}</Text>
            </Box>
          )}
          {task.updated_at && (
            <Box flexDirection="row" marginTop={1}>
              <Text bold>Updated: </Text>
              <Text>{formatDate(task.updated_at)}</Text>
            </Box>
          )}
        </Box>
      )
    },
    {
      id: 'description',
      title: 'Description',
      content: (
        <Box flexDirection="column">
          <Text wrap="wrap">
            {task.description || 'No description available.'}
          </Text>
        </Box>
      ),
      collapsible: true
    },
    {
      id: 'dependencies',
      title: `Dependencies (${task.dependencies.length})`,
      content: (
        <Box flexDirection="column">
          {task.dependencies.length === 0 ? (
            <Text dimColor>No dependencies</Text>
          ) : (
            task.dependencies.map((depId, index) => (
              <Box key={depId} flexDirection="row" alignItems="center">
                <Text>📎 </Text>
                <Text 
                  color={selectedItem === index && onItemSelection ? 'yellow' : 'cyan'}
                  underline={onNavigateToDependency ? true : false}
                >
                  Task #{depId}
                </Text>
                {onNavigateToDependency && (
                  <Text dimColor> (Press Enter to view)</Text>
                )}
              </Box>
            ))
          )}
        </Box>
      ),
      collapsible: true
    },
    {
      id: 'subtasks',
      title: `Subtasks (${task.subtasks?.length || 0})`,
      content: (
        <Box flexDirection="column">
          {!task.subtasks || task.subtasks.length === 0 ? (
            <Text dimColor>No subtasks</Text>
          ) : (
            <>
              <Box marginBottom={1}>
                <Text>
                  Progress: {task.subtasks.filter(st => st.status === 'done').length}/{task.subtasks.length} completed
                </Text>
              </Box>
              {task.subtasks.map((subtask, index) => (
                <Box key={subtask.id} flexDirection="row" marginBottom={1}>
                  <Text>
                    {subtask.status === 'done' ? '✅' : 
                     subtask.status === 'in-progress' ? '🔄' : '⭕'} 
                  </Text>
                  <Box flexDirection="column" marginLeft={1}>
                    <Text 
                      color={subtask.status === 'done' ? 'green' : 
                            subtask.status === 'in-progress' ? 'yellow' : 'white'}
                    >
                      {subtask.title}
                    </Text>
                    {subtask.description && (
                      <Text dimColor wrap="wrap">{subtask.description}</Text>
                    )}
                    {subtask.updated_at && (
                      <Text dimColor>Updated: {formatDate(subtask.updated_at)}</Text>
                    )}
                  </Box>
                </Box>
              ))}
            </>
          )}
        </Box>
      ),
      collapsible: true
    },
    {
      id: 'tags',
      title: 'Tags',
      content: (
        <Box flexDirection="row" flexWrap="wrap">
          {!task.tags || task.tags.length === 0 ? (
            <Text dimColor>No tags</Text>
          ) : (
            task.tags.map((tag, index) => (
              <Box key={index} marginRight={1} marginBottom={1}>
                <Text color="cyan">🏷️  {tag}</Text>
              </Box>
            ))
          )}
        </Box>
      ),
      collapsible: true
    }
  ]

  const actionableItems = [
    ...task.dependencies.map((depId, index) => ({
      type: 'dependency' as const,
      id: depId,
      index,
      label: `Navigate to Task #${depId}`
    }))
  ]

  return (
    <Box
      position="absolute"
      top={2}
      left={Math.floor(process.stdout.columns ? process.stdout.columns * 0.1 : 8)}
      width={Math.floor(process.stdout.columns ? process.stdout.columns * 0.8 : 60)}
      height={Math.floor(process.stdout.rows ? process.stdout.rows * 0.8 : 20)}
      borderStyle="double"
      borderColor="cyan"
      backgroundColor="black"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
    >
      {/* Header */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          📋 Task #{task.id} - {compact && task.title.length > 30 ? 
            task.title.substring(0, 27) + '...' : task.title}
        </Text>
        <Text dimColor>Press 'Esc' to close</Text>
      </Box>

      {/* Content - Scrollable sections */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {sections.map((section) => {
          const isCollapsed = collapsedSections.has(section.id)
          
          return (
            <Box key={section.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" alignItems="center">
                {section.collapsible && (
                  <Text color="yellow">
                    {isCollapsed ? '▶️ ' : '▼️ '}
                  </Text>
                )}
                <Text bold color="white" underline>
                  {section.title}
                </Text>
                {section.collapsible && (
                  <Text dimColor> (Press Space to toggle)</Text>
                )}
              </Box>
              
              {!isCollapsed && (
                <Box marginLeft={section.collapsible ? 2 : 0} marginTop={1}>
                  {section.content}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      {/* Action Bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
        <Text bold>Actions: </Text>
        <Text dimColor>
          Esc=Close{actionableItems.length > 0 ? ' • Enter=Navigate • ↑/↓=Select' : ''}
          {sections.some(s => s.collapsible) ? ' • Space=Toggle Section' : ''}
        </Text>
      </Box>
    </Box>
  )
}

export default TaskDetailView