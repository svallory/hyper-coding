import React from 'react'
import { Box, Text } from 'ink'
import { DashboardMode } from '../services/preferences.service'
import { ModeUtils, KeyboardShortcut } from '../types/mode.types'

interface HelpPanelProps {
  isVisible: boolean
  mode: DashboardMode
  onClose: () => void
  compact?: boolean
}

/**
 * Mode-aware help panel component
 */
export const HelpPanel: React.FC<HelpPanelProps> = ({
  isVisible,
  mode,
  onClose,
  compact = false
}) => {
  if (!isVisible) {
    return null
  }

  const config = ModeUtils.getConfig(mode)
  const shortcuts = config.keyboardShortcuts
  
  // Group shortcuts by category
  const basicShortcuts = shortcuts.filter(s => 
    ['quit', 'help', 'refresh'].includes(s.action)
  )
  
  const navigationShortcuts = shortcuts.filter(s => 
    ['epic-switch', 'mode-toggle', 'nav-section', 'nav-items'].includes(s.action)
  )
  
  const advancedShortcuts = shortcuts.filter(s => 
    !basicShortcuts.includes(s) && !navigationShortcuts.includes(s)
  )

  const features = config.features
  const availableFeatures = Object.entries(features)
    .filter(([_, enabled]) => enabled)
    .map(([feature, _]) => feature)

  return (
    <Box
      position="absolute"
      top={1}
      left={2}
      right={2}
      bottom={1}
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      backgroundColor="black"
      padding={1}
    >
      {/* Header */}
      <Box flexDirection="column" alignItems="center">
        <Text bold color="cyan">
          📖 Epic Dashboard Help - {config.displayName}
        </Text>
        <Text dimColor>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
      </Box>

      <Box flexDirection={compact ? 'column' : 'row'} marginTop={1}>
        {/* Left column - Keyboard shortcuts */}
        <Box flexDirection="column" width={compact ? '100%' : '50%'}>
          <Text bold underline color="yellow">Keyboard Shortcuts:</Text>
          
          {/* Basic shortcuts */}
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="green">Basic Controls:</Text>
            {basicShortcuts.map((shortcut, index) => (
              <Box key={index} flexDirection="row" justifyContent="space-between">
                <Text color="cyan">{shortcut.key}</Text>
                <Text dimColor>{shortcut.description}</Text>
              </Box>
            ))}
          </Box>

          {/* Navigation shortcuts */}
          {navigationShortcuts.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="magenta">Navigation:</Text>
              {navigationShortcuts.map((shortcut, index) => (
                <Box key={index} flexDirection="row" justifyContent="space-between">
                  <Text color="cyan">{shortcut.key}</Text>
                  <Text dimColor>{shortcut.description}</Text>
                </Box>
              ))}
            </Box>
          )}

          {/* Advanced shortcuts */}
          {advancedShortcuts.length > 0 && !compact && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="yellow">Advanced:</Text>
              {advancedShortcuts.slice(0, 5).map((shortcut, index) => (
                <Box key={index} flexDirection="row" justifyContent="space-between">
                  <Text color="cyan">{shortcut.key}</Text>
                  <Text dimColor>{shortcut.description}</Text>
                </Box>
              ))}
              {advancedShortcuts.length > 5 && (
                <Text dimColor>... and {advancedShortcuts.length - 5} more</Text>
              )}
            </Box>
          )}
        </Box>

        {/* Right column - Mode information and features */}
        {!compact && (
          <Box flexDirection="column" width="50%" marginLeft={2}>
            <Text bold underline color="yellow">Current Mode:</Text>
            
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" alignItems="center">
                <Text>{config.icon}</Text>
                <Text bold color={mode === DashboardMode.INTERACTIVE ? "cyan" : "green"}>
                  {" "}{config.displayName}
                </Text>
              </Box>
              <Text dimColor wrap="wrap" marginTop={1}>
                {config.description}
              </Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              <Text bold color="cyan">Available Features:</Text>
              <Box flexDirection="column">
                {availableFeatures.slice(0, 8).map((feature, index) => (
                  <Text key={index} color="green" dimColor>
                    ✓ {feature.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </Text>
                ))}
                {availableFeatures.length > 8 && (
                  <Text dimColor>
                    ... and {availableFeatures.length - 8} more features
                  </Text>
                )}
              </Box>
            </Box>

            {mode === DashboardMode.SIMPLE && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="yellow">💡 Tip:</Text>
                <Text dimColor wrap="wrap">
                  Press 'm' to switch to Interactive Mode for advanced features like keyboard navigation, task details, and analytics.
                </Text>
              </Box>
            )}

            {mode === DashboardMode.INTERACTIVE && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="yellow">💡 Tip:</Text>
                <Text dimColor wrap="wrap">
                  Use Tab/Shift+Tab to navigate between sections. Arrow keys navigate within sections. Press 'm' for Simple Mode.
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Compact mode tips */}
      {compact && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">💡 Quick Tips:</Text>
          <Text dimColor>• Use 'm' to switch between Simple and Interactive modes</Text>
          <Text dimColor>• Press 'e' to switch between different epics</Text>
          <Text dimColor>• All changes are automatically saved</Text>
        </Box>
      )}

      {/* Footer */}
      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">
            Press 'h' or Esc to close help
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Quick help hint component
 */
export const HelpHint: React.FC<{
  mode: DashboardMode
  compact?: boolean
}> = ({ mode, compact = false }) => {
  const config = ModeUtils.getConfig(mode)
  
  return (
    <Box flexDirection="row" alignItems="center">
      <Text color="yellow">💡</Text>
      <Text dimColor>
        {compact 
          ? " Press 'h' for help"
          : ` ${config.displayName} - Press 'h' for help and shortcuts`
        }
      </Text>
    </Box>
  )
}