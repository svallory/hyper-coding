import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { DashboardMode, preferencesService } from '../services/preferences.service'
import { ModeConfig, ModeTransition, ModeUtils } from '../types/mode.types'

interface ModeToggleProps {
  currentMode: DashboardMode
  onModeChange: (mode: DashboardMode) => void
  isVisible: boolean
  onClose: () => void
  compact?: boolean
}

/**
 * Mode toggle component with transition preview and confirmation
 */
export const ModeToggle: React.FC<ModeToggleProps> = ({
  currentMode,
  onModeChange,
  isVisible,
  onClose,
  compact = false
}) => {
  const [selectedMode, setSelectedMode] = useState<DashboardMode>(currentMode)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [transitionInfo, setTransitionInfo] = useState<ModeTransition | null>(null)

  useEffect(() => {
    if (isVisible) {
      const oppositeMode = ModeUtils.getOppositeMode(currentMode)
      setSelectedMode(oppositeMode)
      const transition = ModeUtils.getTransition(currentMode, oppositeMode)
      setTransitionInfo(transition || null)
    }
  }, [isVisible, currentMode])

  if (!isVisible) {
    return null
  }

  const currentConfig = ModeUtils.getConfig(currentMode)
  const targetConfig = ModeUtils.getConfig(selectedMode)
  const featureDiff = ModeUtils.getFeatureDifferences(currentMode, selectedMode)

  const handleConfirm = () => {
    onModeChange(selectedMode)
    preferencesService.setMode(selectedMode)
    onClose()
  }

  const handleCancel = () => {
    setShowConfirmation(false)
    onClose()
  }

  const handleToggle = () => {
    if (selectedMode === currentMode) {
      onClose()
    } else {
      setShowConfirmation(true)
    }
  }

  if (showConfirmation) {
    return (
      <Box
        position="absolute"
        top={2}
        left={2}
        right={2}
        bottom={2}
        flexDirection="column"
        borderStyle="double"
        borderColor="yellow"
        backgroundColor="black"
        padding={1}
      >
        <Box flexDirection="column" alignItems="center">
          <Text bold color="yellow">
            🔄 Mode Switch Confirmation
          </Text>
          <Text dimColor>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="column" width="45%">
              <Text bold color="red">
                Current: {currentConfig.icon} {currentConfig.displayName}
              </Text>
              <Text dimColor wrap="wrap">
                {currentConfig.description}
              </Text>
            </Box>
            
            <Box justifyContent="center" alignItems="center" width="10%">
              <Text bold color="cyan">→</Text>
            </Box>
            
            <Box flexDirection="column" width="45%">
              <Text bold color="green">
                Target: {targetConfig.icon} {targetConfig.displayName}
              </Text>
              <Text dimColor wrap="wrap">
                {targetConfig.description}
              </Text>
            </Box>
          </Box>

          {!compact && featureDiff && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold underline>Changes:</Text>
              
              {featureDiff.enabled.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold color="green">✅ Features Enabled:</Text>
                  {featureDiff.enabled.slice(0, 5).map((feature, index) => (
                    <Text key={index} color="green" dimColor>
                      • {feature.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </Text>
                  ))}
                  {featureDiff.enabled.length > 5 && (
                    <Text dimColor>
                      ... and {featureDiff.enabled.length - 5} more
                    </Text>
                  )}
                </Box>
              )}

              {featureDiff.disabled.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold color="red">❌ Features Disabled:</Text>
                  {featureDiff.disabled.slice(0, 5).map((feature, index) => (
                    <Text key={index} color="red" dimColor>
                      • {feature.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </Text>
                  ))}
                  {featureDiff.disabled.length > 5 && (
                    <Text dimColor>
                      ... and {featureDiff.disabled.length - 5} more
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          )}

          {!compact && transitionInfo && transitionInfo.warnings.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="yellow">⚠️  Important Notes:</Text>
              {transitionInfo.warnings.map((warning, index) => (
                <Text key={index} color="yellow" dimColor>
                  • {warning}
                </Text>
              ))}
            </Box>
          )}

          {!compact && transitionInfo && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="cyan">📋 Preserved Data:</Text>
              <Text dimColor>
                {transitionInfo.preserveState.join(', ')}
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="row" justifyContent="center" marginTop={1} gap={2}>
          <Box borderStyle="single" borderColor="green" paddingX={1}>
            <Text bold color="green">
              Enter = Confirm Switch
            </Text>
          </Box>
          
          <Box borderStyle="single" borderColor="red" paddingX={1}>
            <Text bold color="red">
              Esc = Cancel
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      position="absolute"
      top={3}
      left={5}
      right={5}
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      backgroundColor="black"
      padding={1}
    >
      <Box flexDirection="column" alignItems="center">
        <Text bold color="cyan">
          ⚙️  Mode Selection
        </Text>
        <Text dimColor>Press 'm' again to switch or Esc to cancel</Text>
      </Box>

      <Box flexDirection="row" justifyContent="space-around" marginTop={1}>
        {Object.values(DashboardMode).map((mode) => {
          const config = ModeUtils.getConfig(mode)
          const isSelected = mode === selectedMode
          const isCurrent = mode === currentMode
          
          return (
            <Box
              key={mode}
              flexDirection="column"
              alignItems="center"
              borderStyle={isSelected ? "bold" : isCurrent ? "single" : undefined}
              borderColor={isSelected ? "yellow" : isCurrent ? "green" : undefined}
              paddingX={1}
              paddingY={compact ? 0 : 1}
            >
              <Text bold color={isSelected ? "yellow" : isCurrent ? "green" : "white"}>
                {config.icon} {config.displayName}
              </Text>
              
              {!compact && (
                <Text dimColor wrap="wrap" textAlign="center">
                  {config.description}
                </Text>
              )}
              
              {isCurrent && (
                <Text bold color="green" dimColor>
                  CURRENT
                </Text>
              )}
              
              {isSelected && !isCurrent && (
                <Text bold color="yellow" dimColor>
                  TARGET
                </Text>
              )}
            </Box>
          )
        })}
      </Box>

      {!compact && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Available Shortcuts:</Text>
          <Box flexDirection="column">
            {targetConfig.keyboardShortcuts.slice(0, 6).map((shortcut, index) => (
              <Box key={index} flexDirection="row" justifyContent="space-between">
                <Text color="cyan">{shortcut.key}</Text>
                <Text dimColor>{shortcut.description}</Text>
              </Box>
            ))}
            {targetConfig.keyboardShortcuts.length > 6 && (
              <Text dimColor>
                ... and {targetConfig.keyboardShortcuts.length - 6} more shortcuts
              </Text>
            )}
          </Box>
        </Box>
      )}

      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Text dimColor>
          Press 'm' to confirm • Esc to cancel
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Compact mode indicator component
 */
export const ModeIndicator: React.FC<{
  mode: DashboardMode
  showIcon?: boolean
  showText?: boolean
}> = ({ mode, showIcon = true, showText = true }) => {
  const config = ModeUtils.getConfig(mode)
  
  return (
    <Box flexDirection="row" alignItems="center">
      {showIcon && (
        <Text>{config.icon}</Text>
      )}
      {showText && (
        <Text bold color={mode === DashboardMode.INTERACTIVE ? "cyan" : "green"}>
          {showIcon && " "}{config.displayName}
        </Text>
      )}
    </Box>
  )
}

/**
 * Quick mode switch button component
 */
export const QuickModeSwitch: React.FC<{
  currentMode: DashboardMode
  onToggle: () => void
  compact?: boolean
}> = ({ currentMode, onToggle, compact = false }) => {
  const oppositeMode = ModeUtils.getOppositeMode(currentMode)
  const oppositeConfig = ModeUtils.getConfig(oppositeMode)
  
  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      paddingX={1}
      onClick={onToggle}
    >
      <Text color="yellow">
        {compact ? 'm' : 'Press m'}: Switch to {oppositeConfig.icon} {oppositeConfig.displayName}
      </Text>
    </Box>
  )
}