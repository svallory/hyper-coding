import React from 'react'
import { Box, Text } from 'ink'
import { TaskMasterTask } from '../services/taskmaster.service'

interface DependencyNode {
  id: string
  title: string
  status: TaskMasterTask['status']
  priority: TaskMasterTask['priority']
  dependencies: string[]
  depth: number
}

interface DependencyVisualizationProps {
  task: TaskMasterTask
  allTasks: TaskMasterTask[]
  selectedPath?: string[]
  onNavigateToTask?: (taskId: string) => void
  maxDepth?: number
  compact?: boolean
}

export const DependencyVisualization: React.FC<DependencyVisualizationProps> = ({
  task,
  allTasks,
  selectedPath = [],
  onNavigateToTask,
  maxDepth = 3,
  compact = false
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

  const getPrioritySymbol = (priority: TaskMasterTask['priority']) => {
    switch (priority) {
      case 'high': return '🔴'
      case 'medium': return '🟡'
      case 'low': return '🟢'
      default: return '⚪'
    }
  }

  // Build dependency tree recursively
  const buildDependencyTree = (taskId: string, depth: number = 0, visited: Set<string> = new Set()): DependencyNode | null => {
    if (depth >= maxDepth || visited.has(taskId)) return null
    
    const foundTask = allTasks.find(t => t.id === taskId)
    if (!foundTask) return null

    visited.add(taskId)
    
    return {
      id: foundTask.id,
      title: foundTask.title,
      status: foundTask.status,
      priority: foundTask.priority,
      dependencies: foundTask.dependencies,
      depth
    }
  }

  // Build reverse dependency tree (what depends on this task)
  const buildReverseDependencyTree = (taskId: string, depth: number = 0, visited: Set<string> = new Set()): DependencyNode[] => {
    if (depth >= maxDepth || visited.has(taskId)) return []
    
    visited.add(taskId)
    const dependents = allTasks.filter(t => t.dependencies.includes(taskId))
    
    return dependents.map(depTask => ({
      id: depTask.id,
      title: depTask.title,
      status: depTask.status,
      priority: depTask.priority,
      dependencies: depTask.dependencies,
      depth
    }))
  }

  // Get all dependency paths
  const getAllDependencies = (taskId: string, depth: number = 0, visited: Set<string> = new Set()): DependencyNode[] => {
    if (depth >= maxDepth || visited.has(taskId)) return []
    
    const foundTask = allTasks.find(t => t.id === taskId)
    if (!foundTask) return []

    visited.add(taskId)
    const nodes: DependencyNode[] = []
    
    for (const depId of foundTask.dependencies) {
      const depNode = buildDependencyTree(depId, depth, new Set(visited))
      if (depNode) {
        nodes.push(depNode)
        // Recursively get dependencies of dependencies
        nodes.push(...getAllDependencies(depId, depth + 1, new Set(visited)))
      }
    }
    
    return nodes
  }

  const dependencyNodes = getAllDependencies(task.id)
  const reverseDependencies = buildReverseDependencyTree(task.id)

  const renderDependencyNode = (node: DependencyNode, isSelected: boolean = false, prefix: string = '') => {
    const truncatedTitle = compact && node.title.length > 25 ? 
      node.title.substring(0, 22) + '...' : node.title

    return (
      <Box key={node.id} flexDirection="row" alignItems="center">
        <Text>{prefix}</Text>
        <Text>{getStatusSymbol(node.status)} </Text>
        <Text>{getPrioritySymbol(node.priority)} </Text>
        <Text 
          color={isSelected ? 'yellow' : getStatusColor(node.status)}
          underline={onNavigateToTask ? true : false}
        >
          #{node.id} {truncatedTitle}
        </Text>
        {onNavigateToTask && isSelected && (
          <Text dimColor> ← Press Enter to navigate</Text>
        )}
      </Box>
    )
  }

  // Group dependencies by depth for better visualization
  const dependenciesByDepth = dependencyNodes.reduce((acc, node) => {
    if (!acc[node.depth]) acc[node.depth] = []
    acc[node.depth].push(node)
    return acc
  }, {} as Record<number, DependencyNode[]>)

  return (
    <Box flexDirection="column">
      {/* Current Task */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">📋 Current Task:</Text>
        <Box marginLeft={2}>
          {renderDependencyNode({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            dependencies: task.dependencies,
            depth: 0
          })}
        </Box>
      </Box>

      {/* Dependencies (What this task depends on) */}
      {Object.keys(dependenciesByDepth).length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="red">🔗 Dependencies (blocks this task):</Text>
          {Object.entries(dependenciesByDepth)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([depth, nodes]) => (
              <Box key={depth} flexDirection="column" marginLeft={parseInt(depth) + 1}>
                {nodes.map((node) => {
                  const isSelected = selectedPath.includes(node.id)
                  const prefix = '│  '.repeat(parseInt(depth)) + '├─ '
                  return renderDependencyNode(node, isSelected, prefix)
                })}
              </Box>
            ))}
        </Box>
      )}

      {/* Reverse Dependencies (What depends on this task) */}
      {reverseDependencies.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">🔄 Reverse Dependencies (blocked by this task):</Text>
          <Box marginLeft={2}>
            {reverseDependencies.map((node) => {
              const isSelected = selectedPath.includes(node.id)
              return renderDependencyNode(node, isSelected, '├─ ')
            })}
          </Box>
        </Box>
      )}

      {/* Dependency Analysis */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="yellow">📊 Dependency Analysis:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            • Direct dependencies: {task.dependencies.length}
          </Text>
          <Text>
            • Total dependency chain: {dependencyNodes.length}
          </Text>
          <Text>
            • Tasks blocked by this: {reverseDependencies.length}
          </Text>
          {dependencyNodes.length > 0 && (
            <Text>
              • Max dependency depth: {Math.max(...dependencyNodes.map(n => n.depth)) + 1}
            </Text>
          )}
          
          {/* Blocking analysis */}
          {task.dependencies.length > 0 && (
            <Box marginTop={1}>
              <Text color="red">
                ⚠️  This task is blocked by {task.dependencies.filter(depId => {
                  const depTask = allTasks.find(t => t.id === depId)
                  return depTask && depTask.status !== 'done'
                }).length} incomplete dependencies
              </Text>
            </Box>
          )}
          
          {reverseDependencies.length > 0 && (
            <Box marginTop={1}>
              <Text color="green">
                ✅ Completing this task will unblock {reverseDependencies.length} other task(s)
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Legend */}
      {!compact && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold dimColor>Legend:</Text>
          <Box flexDirection="row">
            <Text dimColor>Status: ✅ Done • 🔄 In Progress • 👀 Review • ⏸️ Deferred • ❌ Cancelled • ⭕ Pending</Text>
          </Box>
          <Box flexDirection="row">
            <Text dimColor>Priority: 🔴 High • 🟡 Medium • 🟢 Low • ⚪ None</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

export default DependencyVisualization