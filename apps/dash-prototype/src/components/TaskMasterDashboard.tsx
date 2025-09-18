import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useTaskMaster } from '../hooks/useTaskMaster'
import { TaskMasterStatus } from './TaskMasterStatus'
import { TaskMasterTasks } from './TaskMasterTasks'
import { TaskMasterStatsComponent } from './TaskMasterStats'
import { TaskDetailViewEnhanced } from './TaskDetailViewEnhanced'
import { ErrorDisplay } from './ErrorDisplay'
import { ErrorBoundary } from './ErrorBoundary'
import { TaskMasterTask } from '../services/taskmaster.service'
import { errorHandler, TaskMasterError } from '../services/error-handler.service'
import { fallbackDataService } from '../services/fallback-data.service'
import { recoveryService } from '../services/recovery.service'

interface TaskMasterDashboardProps {
  compact?: boolean
  maxTasks?: number
  showComplexity?: boolean
  showDependencies?: boolean
  selectedTaskIndex?: number
  focusSection?: 'tasks' | 'stats' | 'status'
  onTaskDetailRequested?: (task: TaskMasterTask) => void
  showDetailView?: boolean
}

export const TaskMasterDashboard: React.FC<TaskMasterDashboardProps> = ({
  compact = false,
  maxTasks = 10,
  showComplexity = true,
  showDependencies = false,
  selectedTaskIndex = -1,
  focusSection,
  onTaskDetailRequested,
  showDetailView = false
}) => {
  const [detailTask, setDetailTask] = useState<TaskMasterTask | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [state, actions] = useTaskMaster({
    autoRefresh: true,
    enableBackgroundRefresh: true,
    autoRefreshInterval: 30000,
    fallbackData: {
      tasks: [],
      stats: null,
      nextTask: null,
      error: 'TaskMaster CLI not available - showing Epic workflow data only'
    }
  })

  const {
    tasks,
    stats,
    nextTask,
    cliAvailability,
    isLoading,
    isRefreshing,
    error,
    lastUpdate,
    cacheStats
  } = state

  const handleTaskSelected = (task: TaskMasterTask) => {
    setDetailTask(task)
    setShowDetail(true)
    if (onTaskDetailRequested) {
      onTaskDetailRequested(task)
    }
  }

  const handleCloseDetail = () => {
    setShowDetail(false)
    setDetailTask(null)
  }

  const handleNavigateToTask = (taskId: string) => {
    const foundTask = tasks.find(t => t.id === taskId)
    if (foundTask) {
      setDetailTask(foundTask)
      // Keep detail view open for navigation
    }
  }

  const handleTaskActionExecuted = (actionId: string, task: TaskMasterTask) => {
    // Handle task action execution
    console.log(`Executing action ${actionId} on task ${task.id}`)
    
    // Trigger a refresh of TaskMaster data after action execution
    actions.refreshAll()
    
    // Close detail view after action execution (optional)
    // setShowDetail(false)
    // setDetailTask(null)
  }

  // If CLI is not available, show a simplified status
  if (!cliAvailability?.available && !isLoading) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <TaskMasterStatus
            availability={cliAvailability}
            isLoading={isLoading}
            error={error}
            lastUpdate={lastUpdate}
            cacheSize={cacheStats.size}
            compact={compact}
          />
        </Box>
        
        {!compact && (
          <Box marginTop={1}>
            <Text dimColor>
              TaskMaster CLI integration unavailable. Using Epic workflow data only.
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  if (isLoading && tasks.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">⏳ Loading TaskMaster data...</Text>
        </Box>
      </Box>
    )
  }

  // Compact view for smaller terminals
  if (compact) {
    return (
      <Box flexDirection="column">
        {/* Status header */}
        <TaskMasterStatus
          availability={cliAvailability}
          isLoading={isLoading || isRefreshing}
          error={error}
          lastUpdate={lastUpdate}
          cacheSize={cacheStats.size}
          compact={true}
        />
        
        {/* Quick stats */}
        {stats && (
          <Box marginTop={1}>
            <TaskMasterStatsComponent
              stats={stats}
              compact={true}
              showProgressBar={false}
            />
          </Box>
        )}
        
        {/* Next task only */}
        {nextTask && nextTask.available && (
          <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
            <Text bold color="cyan">Next: </Text>
            <Text>{nextTask.title || `Task #${nextTask.id}`}</Text>
          </Box>
        )}
      </Box>
    )
  }

  // Full dashboard view
  return (
    <Box flexDirection="column">
      {/* Status Section */}
      <Box 
        borderStyle="round" 
        borderColor={focusSection === 'status' ? 'yellow' : 'cyan'}
        marginBottom={1}
        paddingX={1}
      >
        <TaskMasterStatus
          availability={cliAvailability}
          isLoading={isLoading || isRefreshing}
          error={error}
          lastUpdate={lastUpdate}
          cacheSize={cacheStats.size}
          compact={false}
        />
      </Box>

      {/* Two-column layout for larger screens */}
      <Box flexDirection="row">
        {/* Left Column - Tasks */}
        <Box 
          width="60%" 
          borderStyle="single" 
          borderColor={focusSection === 'tasks' ? 'yellow' : 'white'}
          marginRight={1}
          paddingX={1}
        >
          <Text bold underline>TaskMaster Tasks:</Text>
          <Box marginTop={1}>
            <TaskMasterTasks
              tasks={tasks}
              nextTask={nextTask}
              selectedIndex={focusSection === 'tasks' ? selectedTaskIndex : -1}
              maxItems={maxTasks}
              compact={false}
              showComplexity={showComplexity}
              showDependencies={showDependencies}
              onTaskSelected={handleTaskSelected}
              showDetailHint={focusSection === 'tasks'}
            />
          </Box>
        </Box>

        {/* Right Column - Statistics */}
        <Box 
          width="40%" 
          borderStyle="single" 
          borderColor={focusSection === 'stats' ? 'yellow' : 'white'}
          paddingX={1}
        >
          <Text bold underline>TaskMaster Statistics:</Text>
          <Box marginTop={1}>
            <TaskMasterStatsComponent
              stats={stats}
              compact={false}
              showProgressBar={true}
            />
          </Box>
        </Box>
      </Box>

      {/* Refresh indicator */}
      {isRefreshing && (
        <Box marginTop={1}>
          <Text color="yellow">🔄 Refreshing TaskMaster data...</Text>
        </Box>
      )}
      
      {/* Error indicator */}
      {error && !isLoading && (
        <Box marginTop={1}>
          <Text color="red">⚠️  {error}</Text>
        </Box>
      )}

      {/* Task Detail View Overlay */}
      {(showDetail || showDetailView) && detailTask && (
        <TaskDetailViewEnhanced
          task={detailTask}
          allTasks={tasks}
          isVisible={showDetail || showDetailView}
          onClose={handleCloseDetail}
          onNavigateToTask={handleNavigateToTask}
          onTaskActionExecuted={handleTaskActionExecuted}
          compact={compact}
        />
      )}
    </Box>
  )
}

export default TaskMasterDashboard