import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import Spinner from 'ink-spinner'
import { EpicMetadata } from '../services/epic-discovery.service'

interface EpicSelectorProps {
  epics: EpicMetadata[]
  selectedIndex: number
  onSelect: (epic: EpicMetadata) => void
  onCancel: () => void
  isLoading: boolean
  isCompact?: boolean
  showDetails?: boolean
  isFocused?: boolean
}

interface EpicListItemProps {
  epic: EpicMetadata
  isSelected: boolean
  isCompact: boolean
  showDetails: boolean
}

const EpicListItem: React.FC<EpicListItemProps> = ({ 
  epic, 
  isSelected, 
  isCompact, 
  showDetails 
}) => {
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

  const getValidityIcon = (epic: EpicMetadata) => {
    if (!epic.isValid) return '❌'
    if (epic.hasWorkflowState && epic.hasManifest) return '✅'
    if (epic.hasWorkflowState || epic.hasManifest) return '⚠️'
    return '❓'
  }

  const formatLastActivity = (lastActivity?: string) => {
    if (!lastActivity) return 'Unknown'
    try {
      const date = new Date(lastActivity)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return lastActivity
    }
  }

  const formatProgress = (progress?: EpicMetadata['progress']) => {
    if (!progress) return 'No progress data'
    return `${progress.percentage}% (${progress.completedSteps.length}/${progress.totalSteps})`
  }

  return (
    <Box
      flexDirection="column"
      backgroundColor={isSelected ? 'blue' : undefined}
      paddingX={1}
      paddingY={isCompact ? 0 : 1}
      borderStyle={isSelected ? 'single' : undefined}
      borderColor={isSelected ? 'cyan' : undefined}
    >
      {/* Main epic info */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text>{getValidityIcon(epic)} </Text>
          <Text bold color={isSelected ? 'white' : 'cyan'}>
            {epic.displayName || epic.name}
          </Text>
        </Box>
        <Text color={getStatusColor(epic.status)}>
          {epic.status}
        </Text>
      </Box>

      {/* Progress bar (compact mode) */}
      {isCompact && epic.progress && (
        <Box flexDirection="row" marginTop={0}>
          <Text dimColor>Progress: </Text>
          <Text color="yellow">{epic.progress.percentage}%</Text>
          <Text dimColor> ({epic.progress.completedSteps.length}/{epic.progress.totalSteps})</Text>
        </Box>
      )}

      {/* Detailed information (non-compact mode) */}
      {!isCompact && showDetails && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {/* Description */}
          {epic.description && (
            <Box>
              <Text dimColor>
                {epic.description.length > 80 
                  ? epic.description.substring(0, 77) + '...'
                  : epic.description
                }
              </Text>
            </Box>
          )}
          
          {/* Progress details */}
          {epic.progress && (
            <Box flexDirection="row" marginTop={1}>
              <Text dimColor>Progress: </Text>
              <Text color="yellow">{formatProgress(epic.progress)}</Text>
            </Box>
          )}
          
          {/* Last activity */}
          <Box flexDirection="row" marginTop={1}>
            <Text dimColor>Last Activity: </Text>
            <Text>{formatLastActivity(epic.lastActivity)}</Text>
          </Box>
          
          {/* File status */}
          <Box flexDirection="row" marginTop={1}>
            <Text dimColor>Files: </Text>
            <Text color={epic.hasWorkflowState ? 'green' : 'gray'}>
              {epic.hasWorkflowState ? '●' : '○'} State
            </Text>
            <Text> </Text>
            <Text color={epic.hasManifest ? 'green' : 'gray'}>
              {epic.hasManifest ? '●' : '○'} Manifest
            </Text>
            <Text> </Text>
            <Text color={epic.hasLogs ? 'green' : 'gray'}>
              {epic.hasLogs ? '●' : '○'} Logs
            </Text>
          </Box>
          
          {/* Errors */}
          {epic.errors.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red">Errors:</Text>
              {epic.errors.slice(0, 2).map((error, index) => (
                <Text key={index} color="red" dimColor marginLeft={2}>
                  • {error}
                </Text>
              ))}
              {epic.errors.length > 2 && (
                <Text color="red" dimColor marginLeft={2}>
                  ... and {epic.errors.length - 2} more
                </Text>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Path (always shown, but dimmed) */}
      <Box marginTop={isCompact ? 0 : 1}>
        <Text dimColor fontSize={10}>
          {epic.path}
        </Text>
      </Box>
    </Box>
  )
}

export const EpicSelector: React.FC<EpicSelectorProps> = ({
  epics,
  selectedIndex,
  onSelect,
  onCancel,
  isLoading,
  isCompact = false,
  showDetails = true,
  isFocused = true
}) => {
  const [localSelectedIndex, setLocalSelectedIndex] = useState(selectedIndex)
  const [showHelp, setShowHelp] = useState(false)

  // Update local selected index when prop changes
  useEffect(() => {
    setLocalSelectedIndex(selectedIndex)
  }, [selectedIndex])

  // Input handling
  useInput((input, key) => {
    if (!isFocused) return

    // Help toggle
    if (input === 'h' || input === '?') {
      setShowHelp(!showHelp)
      return
    }

    // Close help on any other key
    if (showHelp) {
      setShowHelp(false)
      return
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setLocalSelectedIndex(prev => 
        prev > 0 ? prev - 1 : epics.length - 1
      )
    } else if (key.downArrow || input === 'j') {
      setLocalSelectedIndex(prev => 
        prev < epics.length - 1 ? prev + 1 : 0
      )
    }

    // Selection
    else if (key.return || input === ' ') {
      if (epics[localSelectedIndex]) {
        onSelect(epics[localSelectedIndex])
      }
    }

    // Cancel
    else if (key.escape || input === 'q') {
      onCancel()
    }

    // Quick navigation
    else if (input >= '1' && input <= '9') {
      const index = parseInt(input) - 1
      if (index < epics.length) {
        setLocalSelectedIndex(index)
      }
    }
  })

  if (isLoading) {
    return (
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="row">
          <Spinner type="dots" />
          <Text> Discovering epics...</Text>
        </Box>
      </Box>
    )
  }

  if (epics.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color="yellow">❓ No epics found</Text>
        <Text dimColor marginTop={1}>
          Check your epic directories or create a new epic to get started.
        </Text>
        <Text dimColor marginTop={1}>
          Press 'q' or 'Esc' to return to the dashboard.
        </Text>
      </Box>
    )
  }

  // Filter valid epics first, then show invalid ones
  const validEpics = epics.filter(epic => epic.isValid)
  const invalidEpics = epics.filter(epic => !epic.isValid)
  const orderedEpics = [...validEpics, ...invalidEpics]

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box 
        borderStyle="double" 
        borderColor="cyan" 
        paddingX={1} 
        marginBottom={1}
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="cyan">📚 Select Epic Context</Text>
          <Text dimColor>{epics.length} epic{epics.length !== 1 ? 's' : ''} found</Text>
        </Box>
      </Box>

      {/* Epic list */}
      <Box flexDirection="column" marginBottom={1}>
        {orderedEpics.map((epic, index) => (
          <EpicListItem
            key={epic.path}
            epic={epic}
            isSelected={index === localSelectedIndex}
            isCompact={isCompact}
            showDetails={showDetails && !isCompact}
          />
        ))}
      </Box>

      {/* Help panel */}
      {showHelp && (
        <Box 
          borderStyle="single" 
          borderColor="yellow" 
          paddingX={1} 
          marginTop={1}
        >
          <Box flexDirection="column">
            <Text bold color="yellow">Epic Selector Help:</Text>
            <Text dimColor>↑/↓ or j/k: Navigate list</Text>
            <Text dimColor>Enter/Space: Select epic</Text>
            <Text dimColor>1-9: Quick select by number</Text>
            <Text dimColor>q/Esc: Cancel and return</Text>
            <Text dimColor>h/?: Toggle this help</Text>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box 
        borderStyle="single" 
        borderColor="gray" 
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {localSelectedIndex + 1}/{epics.length}
          </Text>
          <Text dimColor>
            Enter=Select • q=Cancel • h=Help
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

export default EpicSelector