import React from 'react'
import { Box, Text } from 'ink'
import { EpicSelector } from './EpicSelector'
import { EpicMetadata } from '../services/epic-discovery.service'

interface EpicSwitchPanelProps {
  isVisible: boolean
  isLoading: boolean
  availableEpics: EpicMetadata[]
  currentEpic: EpicMetadata | null
  selectedIndex: number
  onEpicSelect: (epic: EpicMetadata) => void
  onClose: () => void
  isCompact?: boolean
  layout?: {
    width: number
    height: number
    isCompact: boolean
  }
}

export const EpicSwitchPanel: React.FC<EpicSwitchPanelProps> = ({
  isVisible,
  isLoading,
  availableEpics,
  currentEpic,
  selectedIndex,
  onEpicSelect,
  onClose,
  isCompact = false,
  layout
}) => {
  if (!isVisible) return null

  const panelWidth = layout ? Math.min(layout.width - 4, 100) : 80
  const panelHeight = layout ? Math.min(layout.height - 4, 30) : 20

  return (
    <Box
      position="absolute"
      top={2}
      left={2}
      width={panelWidth}
      height={panelHeight}
      borderStyle="double"
      borderColor="cyan"
      backgroundColor="black"
      flexDirection="column"
      padding={1}
    >
      {/* Panel Header */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">🔄 Epic Context Switcher</Text>
        {currentEpic && (
          <Text dimColor>
            Current: <Text color="yellow">{currentEpic.displayName}</Text>
          </Text>
        )}
      </Box>

      {/* Epic Selector */}
      <Box flexGrow={1}>
        <EpicSelector
          epics={availableEpics}
          selectedIndex={selectedIndex}
          onSelect={onEpicSelect}
          onCancel={onClose}
          isLoading={isLoading}
          isCompact={isCompact || (layout?.isCompact ?? false)}
          showDetails={!isCompact && !(layout?.isCompact ?? false)}
          isFocused={true}
        />
      </Box>
    </Box>
  )
}

export default EpicSwitchPanel