import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { TaskMasterTask } from '../services/taskmaster.service'

interface TaskAction {
  id: string
  label: string
  description: string
  command?: string
  available: boolean
  destructive?: boolean
}

interface TaskActionsProps {
  task: TaskMasterTask
  onActionExecuted?: (action: TaskAction, task: TaskMasterTask) => void
  compact?: boolean
  selectedActionIndex?: number
}

export const TaskActions: React.FC<TaskActionsProps> = ({
  task,
  onActionExecuted,
  compact = false,
  selectedActionIndex = 0
}) => {
  const [executingAction, setExecutingAction] = useState<string | null>(null)

  // Define available actions based on task state
  const getAvailableActions = (): TaskAction[] => {
    const actions: TaskAction[] = []

    // Status transitions
    switch (task.status) {
      case 'pending':
        actions.push({
          id: 'start',
          label: '🚀 Start Task',
          description: 'Mark task as in-progress',
          command: `task-master update ${task.id} --status in-progress`,
          available: true
        })
        break

      case 'in-progress':
        actions.push({
          id: 'complete',
          label: '✅ Mark Complete',
          description: 'Mark task as done',
          command: `task-master update ${task.id} --status done`,
          available: true
        })
        actions.push({
          id: 'review',
          label: '👀 Send to Review',
          description: 'Mark task as ready for review',
          command: `task-master update ${task.id} --status review`,
          available: true
        })
        actions.push({
          id: 'pause',
          label: '⏸️ Pause Task',
          description: 'Mark task as deferred',
          command: `task-master update ${task.id} --status deferred`,
          available: true
        })
        break

      case 'review':
        actions.push({
          id: 'approve',
          label: '✅ Approve & Complete',
          description: 'Approve and mark as done',
          command: `task-master update ${task.id} --status done`,
          available: true
        })
        actions.push({
          id: 'reject',
          label: '🔄 Send Back to Progress',
          description: 'Send back to in-progress',
          command: `task-master update ${task.id} --status in-progress`,
          available: true
        })
        break

      case 'deferred':
        actions.push({
          id: 'resume',
          label: '▶️ Resume Task',
          description: 'Resume task (mark as in-progress)',
          command: `task-master update ${task.id} --status in-progress`,
          available: true
        })
        break

      case 'done':
        actions.push({
          id: 'reopen',
          label: '🔄 Reopen Task',
          description: 'Reopen task for changes',
          command: `task-master update ${task.id} --status in-progress`,
          available: true
        })
        break
    }

    // Priority changes
    if (task.priority !== 'high') {
      actions.push({
        id: 'priority-high',
        label: '🔴 Set High Priority',
        description: 'Change priority to high',
        command: `task-master update ${task.id} --priority high`,
        available: true
      })
    }

    if (task.priority !== 'medium') {
      actions.push({
        id: 'priority-medium',
        label: '🟡 Set Medium Priority',
        description: 'Change priority to medium',
        command: `task-master update ${task.id} --priority medium`,
        available: true
      })
    }

    if (task.priority !== 'low') {
      actions.push({
        id: 'priority-low',
        label: '🟢 Set Low Priority',
        description: 'Change priority to low',
        command: `task-master update ${task.id} --priority low`,
        available: true
      })
    }

    // Destructive actions
    if (task.status !== 'cancelled') {
      actions.push({
        id: 'cancel',
        label: '❌ Cancel Task',
        description: 'Cancel this task permanently',
        command: `task-master update ${task.id} --status cancelled`,
        available: true,
        destructive: true
      })
    }

    // Information actions (always available)
    actions.push({
      id: 'refresh',
      label: '🔄 Refresh Data',
      description: 'Reload task information',
      available: true
    })

    actions.push({
      id: 'show-details',
      label: '📋 Show in CLI',
      description: 'Show task details in TaskMaster CLI',
      command: `task-master show ${task.id}`,
      available: true
    })

    return actions
  }

  const actions = getAvailableActions()

  const executeAction = async (action: TaskAction) => {
    if (!action.available || executingAction) return

    setExecutingAction(action.id)
    
    try {
      // Here you would typically call the TaskMaster CLI or service
      // For now, we'll just notify the parent component
      if (onActionExecuted) {
        onActionExecuted(action, task)
      }
      
      // Simulate some execution time
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error) {
      // Handle error
      console.error('Action execution failed:', error)
    } finally {
      setExecutingAction(null)
    }
  }

  const getActionColor = (action: TaskAction, isSelected: boolean = false) => {
    if (executingAction === action.id) return 'yellow'
    if (isSelected) return 'cyan'
    if (action.destructive) return 'red'
    if (!action.available) return 'gray'
    return 'white'
  }

  if (compact) {
    // Compact view - show only primary actions
    const primaryActions = actions.filter(a => 
      ['start', 'complete', 'review', 'approve', 'resume'].includes(a.id)
    ).slice(0, 2)

    return (
      <Box flexDirection="column">
        <Text bold>Quick Actions:</Text>
        {primaryActions.length === 0 ? (
          <Text dimColor>No quick actions available</Text>
        ) : (
          primaryActions.map((action, index) => {
            const isSelected = index === selectedActionIndex
            return (
              <Box key={action.id} flexDirection="row" alignItems="center">
                <Text color={getActionColor(action, isSelected)}>
                  {isSelected ? '► ' : '  '}{action.label}
                </Text>
                {executingAction === action.id && (
                  <Text color="yellow" marginLeft={1}>⏳</Text>
                )}
              </Box>
            )
          })
        )}
      </Box>
    )
  }

  // Full view - show all actions organized by category
  const statusActions = actions.filter(a => 
    ['start', 'complete', 'review', 'approve', 'reject', 'resume', 'reopen', 'pause'].includes(a.id)
  )
  const priorityActions = actions.filter(a => a.id.startsWith('priority-'))
  const destructiveActions = actions.filter(a => a.destructive)
  const infoActions = actions.filter(a => 
    ['refresh', 'show-details'].includes(a.id)
  )

  const renderActionGroup = (title: string, groupActions: TaskAction[], startIndex: number) => {
    if (groupActions.length === 0) return null

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">{title}:</Text>
        {groupActions.map((action, index) => {
          const globalIndex = startIndex + index
          const isSelected = globalIndex === selectedActionIndex
          
          return (
            <Box key={action.id} flexDirection="row" alignItems="center" marginLeft={2}>
              <Text color={getActionColor(action, isSelected)}>
                {isSelected ? '► ' : '  '}{action.label}
              </Text>
              {executingAction === action.id && (
                <Text color="yellow" marginLeft={1}>⏳</Text>
              )}
              {!action.available && (
                <Text dimColor marginLeft={1}>(Unavailable)</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Available Actions:</Text>
      <Box marginTop={1} flexDirection="column">
        {renderActionGroup('Status Changes', statusActions, 0)}
        {renderActionGroup('Priority Changes', priorityActions, statusActions.length)}
        {renderActionGroup('Information', infoActions, statusActions.length + priorityActions.length)}
        {renderActionGroup('Destructive Actions', destructiveActions, 
          statusActions.length + priorityActions.length + infoActions.length)}
      </Box>
      
      {actions.length === 0 && (
        <Text dimColor>No actions available for this task</Text>
      )}
      
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          Use ↑/↓ to select action, Enter to execute, Esc to close
          {selectedActionIndex < actions.length && actions[selectedActionIndex] && (
            ` • ${actions[selectedActionIndex].description}`
          )}
        </Text>
      </Box>
    </Box>
  )
}

export default TaskActions