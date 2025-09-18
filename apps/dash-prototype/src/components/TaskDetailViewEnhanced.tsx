import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { TaskMasterTask } from '../services/taskmaster.service'
import { DependencyVisualization } from './DependencyVisualization'
import { TaskActions } from './TaskActions'

interface TaskDetailViewEnhancedProps {
  task: TaskMasterTask
  allTasks: TaskMasterTask[]
  isVisible: boolean
  onClose: () => void
  onNavigateToTask?: (taskId: string) => void
  onTaskActionExecuted?: (actionId: string, task: TaskMasterTask) => void
  compact?: boolean
}

type ViewMode = 'overview' | 'dependencies' | 'subtasks' | 'metadata' | 'actions'

interface NavigableItem {
  id: string
  type: 'section' | 'dependency' | 'subtask' | 'action'
  data?: any
  label: string
}

export const TaskDetailViewEnhanced: React.FC<TaskDetailViewEnhancedProps> = ({
  task,
  allTasks,
  isVisible,
  onClose,
  onNavigateToTask,
  onTaskActionExecuted,
  compact = false
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [selectedItemIndex, setSelectedItemIndex] = useState(0)
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

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
    } catch {
      return dateString
    }
  }

  // Generate navigable items based on current view mode
  const getNavigableItems = (): NavigableItem[] => {
    const items: NavigableItem[] = []

    // Always add view mode switches
    items.push(
      { id: 'overview', type: 'section', label: '📋 Overview' },
      { id: 'dependencies', type: 'section', label: '🔗 Dependencies' },
      { id: 'subtasks', type: 'section', label: '📝 Subtasks' },
      { id: 'metadata', type: 'section', label: '📊 Metadata' },
      { id: 'actions', type: 'section', label: '⚡ Actions' }
    )

    switch (viewMode) {
      case 'dependencies':
        task.dependencies.forEach(depId => {
          items.push({
            id: `dep_${depId}`,
            type: 'dependency',
            data: depId,
            label: `Navigate to Task #${depId}`
          })
        })
        break

      case 'subtasks':
        task.subtasks?.forEach((subtask, index) => {
          items.push({
            id: `subtask_${subtask.id}`,
            type: 'subtask',
            data: { subtask, index },
            label: `${subtask.status === 'done' ? '✅' : subtask.status === 'in-progress' ? '🔄' : '⭕'} ${subtask.title}`
          })
        })
        break

      case 'actions':
        // Add available actions as navigable items
        // This will be populated by the TaskActions component logic
        break
    }

    return items
  }

  const navigableItems = getNavigableItems()

  // Handle keyboard input
  useInput((input, key) => {
    if (!isVisible) return

    // Close detail view
    if (key.escape || input === 'q') {
      onClose()
      return
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedItemIndex(prev => prev > 0 ? prev - 1 : navigableItems.length - 1)
      return
    }

    if (key.downArrow || input === 'j') {
      setSelectedItemIndex(prev => prev < navigableItems.length - 1 ? prev + 1 : 0)
      return
    }

    // Selection/Action
    if (key.return || input === ' ') {
      const selectedItem = navigableItems[selectedItemIndex]
      if (!selectedItem) return

      switch (selectedItem.type) {
        case 'section':
          setViewMode(selectedItem.id as ViewMode)
          setSelectedItemIndex(0)
          break

        case 'dependency':
          if (onNavigateToTask && selectedItem.data) {
            onNavigateToTask(selectedItem.data)
          }
          break

        case 'subtask':
          // Future: implement subtask actions
          break
      }
      return
    }

    // View mode shortcuts
    if (input === '1') setViewMode('overview')
    if (input === '2') setViewMode('dependencies')
    if (input === '3') setViewMode('subtasks')
    if (input === '4') setViewMode('metadata')
    if (input === '5') setViewMode('actions')
  })

  const complexityInfo = getComplexityIndicator(task.complexity)

  const renderOverview = () => (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>Status: </Text>
        <Text color={getStatusColor(task.status)}>
          {getStatusSymbol(task.status)} {task.status.toUpperCase()}
        </Text>
      </Box>
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>Priority: </Text>
        <Text color={getPriorityColor(task.priority)}>
          {task.priority.toUpperCase()}
        </Text>
      </Box>
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>Complexity: </Text>
        <Text color={complexityInfo.color}>
          {complexityInfo.indicator} {task.complexity || 'N/A'} ({complexityInfo.label})
        </Text>
      </Box>
      {task.description && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Description:</Text>
          <Text wrap="wrap" marginLeft={2}>{task.description}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Summary:</Text>
        <Box marginLeft={2}>
          <Text>• Dependencies: {task.dependencies.length}</Text>
          <Text>• Subtasks: {task.subtasks?.length || 0}</Text>
          <Text>• Tags: {task.tags?.length || 0}</Text>
        </Box>
      </Box>
    </Box>
  )

  const renderDependencies = () => (
    <DependencyVisualization
      task={task}
      allTasks={allTasks}
      onNavigateToTask={onNavigateToTask}
      compact={compact}
      maxDepth={3}
    />
  )

  const renderSubtasks = () => (
    <Box flexDirection="column">
      {!task.subtasks || task.subtasks.length === 0 ? (
        <Text dimColor>No subtasks available</Text>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text bold>
              Progress: {task.subtasks.filter(st => st.status === 'done').length}/{task.subtasks.length} completed
            </Text>
          </Box>
          {task.subtasks.map((subtask, index) => {
            const isSelected = navigableItems[selectedItemIndex]?.data?.index === index
            
            return (
              <Box 
                key={subtask.id} 
                flexDirection="column" 
                marginBottom={1}
                backgroundColor={isSelected ? 'gray' : undefined}
                paddingX={isSelected ? 1 : 0}
              >
                <Box flexDirection="row">
                  <Text>
                    {subtask.status === 'done' ? '✅' : 
                     subtask.status === 'in-progress' ? '🔄' : '⭕'} 
                  </Text>
                  <Text 
                    marginLeft={1}
                    color={isSelected ? 'yellow' : 
                          subtask.status === 'done' ? 'green' : 
                          subtask.status === 'in-progress' ? 'yellow' : 'white'}
                    bold={isSelected}
                  >
                    {subtask.title}
                  </Text>
                </Box>
                {subtask.description && (
                  <Text dimColor wrap="wrap" marginLeft={2}>{subtask.description}</Text>
                )}
                <Box flexDirection="row" marginLeft={2}>
                  {subtask.created_at && (
                    <Text dimColor>Created: {formatDate(subtask.created_at)} </Text>
                  )}
                  {subtask.updated_at && (
                    <Text dimColor>Updated: {formatDate(subtask.updated_at)}</Text>
                  )}
                </Box>
              </Box>
            )
          })}
        </>
      )}
    </Box>
  )

  const renderMetadata = () => (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Timestamps:</Text>
        <Box marginLeft={2}>
          {task.created_at && (
            <Text>Created: {formatDate(task.created_at)}</Text>
          )}
          {task.updated_at && (
            <Text>Updated: {formatDate(task.updated_at)}</Text>
          )}
        </Box>
      </Box>
      
      {task.tags && task.tags.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Tags:</Text>
          <Box flexDirection="row" flexWrap="wrap" marginLeft={2}>
            {task.tags.map((tag, index) => (
              <Box key={index} marginRight={1}>
                <Text color="cyan">🏷️  {tag}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Task Analysis:</Text>
        <Box marginLeft={2}>
          <Text>• ID: {task.id}</Text>
          <Text>• Title Length: {task.title.length} characters</Text>
          <Text>• Has Description: {task.description ? 'Yes' : 'No'}</Text>
          <Text>• Dependency Depth: {task.dependencies.length > 0 ? 'Has dependencies' : 'Independent'}</Text>
          <Text>• Completion Readiness: {
            task.dependencies.length === 0 ? 'Ready to start' :
            task.dependencies.every(depId => {
              const depTask = allTasks.find(t => t.id === depId)
              return depTask?.status === 'done'
            }) ? 'Dependencies satisfied' : 'Blocked by dependencies'
          }</Text>
        </Box>
      </Box>
    </Box>
  )

  const renderActions = () => (
    <TaskActions
      task={task}
      compact={compact}
      selectedActionIndex={viewMode === 'actions' ? selectedItemIndex - 5 : 0}
      onActionExecuted={(action, task) => {
        if (onTaskActionExecuted) {
          onTaskActionExecuted(action.id, task)
        }
      }}
    />
  )

  const renderContent = () => {
    switch (viewMode) {
      case 'overview': return renderOverview()
      case 'dependencies': return renderDependencies()
      case 'subtasks': return renderSubtasks()
      case 'metadata': return renderMetadata()
      case 'actions': return renderActions()
      default: return renderOverview()
    }
  }

  return (
    <Box
      position="absolute"
      top={1}
      left={Math.floor((process.stdout.columns || 80) * 0.05)}
      width={Math.floor((process.stdout.columns || 80) * 0.9)}
      height={Math.floor((process.stdout.rows || 24) * 0.85)}
      borderStyle="double"
      borderColor="cyan"
      backgroundColor="black"
      flexDirection="column"
    >
      {/* Header */}
      <Box 
        flexDirection="row" 
        justifyContent="space-between" 
        paddingX={1}
        paddingY={1}
        borderStyle="single"
        borderColor="gray"
      >
        <Text bold color="cyan">
          📋 Task #{task.id} - {compact && task.title.length > 40 ? 
            task.title.substring(0, 37) + '...' : task.title}
        </Text>
        <Text dimColor>Esc=Close • ↑/↓=Navigate • Enter=Select</Text>
      </Box>

      {/* View Mode Tabs */}
      <Box flexDirection="row" paddingX={1} borderStyle="single" borderColor="gray">
        {[
          { id: 'overview', label: '1️⃣ Overview', mode: 'overview' as ViewMode },
          { id: 'dependencies', label: '2️⃣ Dependencies', mode: 'dependencies' as ViewMode },
          { id: 'subtasks', label: '3️⃣ Subtasks', mode: 'subtasks' as ViewMode },
          { id: 'metadata', label: '4️⃣ Metadata', mode: 'metadata' as ViewMode },
          { id: 'actions', label: '5️⃣ Actions', mode: 'actions' as ViewMode }
        ].map((tab, index) => {
          const isSelected = navigableItems[selectedItemIndex]?.id === tab.mode && 
                            navigableItems[selectedItemIndex]?.type === 'section'
          const isActive = viewMode === tab.mode
          
          return (
            <Box key={tab.id} marginRight={2}>
              <Text 
                color={isActive ? 'cyan' : isSelected ? 'yellow' : 'white'}
                bold={isActive}
                underline={isSelected}
              >
                {tab.label}
              </Text>
            </Box>
          )
        })}
      </Box>

      {/* Content Area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} overflowY="hidden">
        {renderContent()}
      </Box>

      {/* Navigation Indicator */}
      {navigableItems.length > 5 && (
        <Box 
          flexDirection="row" 
          justifyContent="center" 
          paddingX={1}
          borderStyle="single"
          borderColor="gray"
        >
          <Text dimColor>
            Item {selectedItemIndex + 1} of {navigableItems.length}
            {selectedItemIndex >= 5 && viewMode !== 'overview' && 
              ` • ${navigableItems[selectedItemIndex]?.label}`}
          </Text>
        </Box>
      )}

      {/* Action Bar */}
      <Box 
        flexDirection="row" 
        justifyContent="space-between" 
        paddingX={1}
        borderStyle="single" 
        borderColor="gray"
      >
        <Text bold color="white">Actions: </Text>
        <Text dimColor>
          1-5=Tabs • Esc=Close • ↑/↓=Navigate • Enter/Space=Select
          {task.dependencies.length > 0 && viewMode === 'dependencies' && ' • Enter=Go to Dependency'}
          {viewMode === 'actions' && ' • Enter=Execute Action'}
        </Text>
      </Box>
    </Box>
  )
}

export default TaskDetailViewEnhanced