import React from 'react'
import { Box, Text } from 'ink'

export interface ChartDataPoint {
  label: string
  value: number
  color?: string
}

export interface SparklineDataPoint {
  value: number
  timestamp?: string
}

export interface HeatMapDataPoint {
  x: number
  y: number
  value: number
  label?: string
}

export interface BarChartProps {
  data: ChartDataPoint[]
  title?: string
  maxWidth?: number
  showValues?: boolean
  horizontal?: boolean
  compact?: boolean
}

export interface SparklineProps {
  data: SparklineDataPoint[]
  title?: string
  width?: number
  height?: number
  showMinMax?: boolean
}

export interface HeatMapProps {
  data: HeatMapDataPoint[]
  title?: string
  width?: number
  height?: number
  colorScale?: string[]
}

/**
 * ASCII Bar Chart Component
 * Renders horizontal or vertical bar charts using Unicode characters
 */
export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  maxWidth = 50,
  showValues = true,
  horizontal = true,
  compact = false
}) => {
  if (!data || data.length === 0) {
    return (
      <Box flexDirection="column">
        {title && <Text bold>{title}</Text>}
        <Text dimColor>No data available</Text>
      </Box>
    )
  }

  const maxValue = Math.max(...data.map(d => d.value))
  const minValue = Math.min(...data.map(d => d.value))
  const range = maxValue - minValue || 1

  const renderHorizontalBar = (item: ChartDataPoint, index: number) => {
    const percentage = (item.value - minValue) / range
    const barLength = Math.round(percentage * maxWidth)
    const bar = '█'.repeat(barLength) + '░'.repeat(maxWidth - barLength)
    
    return (
      <Box key={index} flexDirection="row" marginBottom={compact ? 0 : 1}>
        <Box width={20}>
          <Text>{item.label.slice(0, 18)}</Text>
        </Box>
        <Box width={maxWidth + 2}>
          <Text color={item.color}>{bar}</Text>
        </Box>
        {showValues && (
          <Box marginLeft={1}>
            <Text dimColor>{item.value.toFixed(1)}</Text>
          </Box>
        )}
      </Box>
    )
  }

  const renderVerticalBar = (item: ChartDataPoint, index: number) => {
    const percentage = (item.value - minValue) / range
    const barHeight = Math.round(percentage * 10) // Max height of 10
    const spaces = 10 - barHeight
    
    return (
      <Box key={index} flexDirection="column" marginRight={2}>
        {/* Bar */}
        <Box flexDirection="column" height={10}>
          {Array.from({ length: spaces }, (_, i) => (
            <Text key={i}> </Text>
          ))}
          {Array.from({ length: barHeight }, (_, i) => (
            <Text key={i} color={item.color}>█</Text>
          ))}
        </Box>
        
        {/* Label */}
        <Box marginTop={1}>
          <Text>{item.label.slice(0, 8)}</Text>
        </Box>
        
        {/* Value */}
        {showValues && (
          <Text dimColor>{item.value.toFixed(1)}</Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold underline>{title}</Text>
        </Box>
      )}
      
      <Box flexDirection={horizontal ? "column" : "row"}>
        {data.map((item, index) => 
          horizontal ? renderHorizontalBar(item, index) : renderVerticalBar(item, index)
        )}
      </Box>
      
      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>
            Range: {minValue.toFixed(1)} - {maxValue.toFixed(1)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * ASCII Sparkline Component
 * Renders a compact line chart using Unicode block characters
 */
export const Sparkline: React.FC<SparklineProps> = ({
  data,
  title,
  width = 50,
  height = 8,
  showMinMax = true
}) => {
  if (!data || data.length === 0) {
    return (
      <Box flexDirection="column">
        {title && <Text bold>{title}</Text>}
        <Text dimColor>No data available</Text>
      </Box>
    )
  }

  const values = data.map(d => d.value)
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)
  const range = maxValue - minValue || 1

  // Unicode characters for different fill levels
  const chars = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  
  const renderSparkline = () => {
    const step = Math.max(1, Math.floor(data.length / width))
    const sampledData = data.filter((_, i) => i % step === 0).slice(0, width)
    
    return sampledData.map((point, index) => {
      const normalizedValue = (point.value - minValue) / range
      const charIndex = Math.round(normalizedValue * (chars.length - 1))
      return chars[charIndex]
    }).join('')
  }

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}
      
      <Box>
        <Text>{renderSparkline()}</Text>
      </Box>
      
      {showMinMax && (
        <Box marginTop={1} justifyContent="space-between">
          <Text dimColor>Min: {minValue.toFixed(1)}</Text>
          <Text dimColor>Max: {maxValue.toFixed(1)}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * ASCII Heat Map Component
 * Renders a 2D heat map using Unicode intensity characters
 */
export const HeatMap: React.FC<HeatMapProps> = ({
  data,
  title,
  width = 20,
  height = 10,
  colorScale = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
}) => {
  if (!data || data.length === 0) {
    return (
      <Box flexDirection="column">
        {title && <Text bold>{title}</Text>}
        <Text dimColor>No data available</Text>
      </Box>
    )
  }

  const maxValue = Math.max(...data.map(d => d.value))
  const minValue = Math.min(...data.map(d => d.value))
  const range = maxValue - minValue || 1

  // Create 2D grid
  const grid: string[][] = Array.from({ length: height }, () => 
    Array.from({ length: width }, () => ' ')
  )

  // Fill grid with data
  data.forEach(point => {
    const x = Math.min(Math.floor(point.x), width - 1)
    const y = Math.min(Math.floor(point.y), height - 1)
    const normalizedValue = (point.value - minValue) / range
    const charIndex = Math.floor(normalizedValue * (colorScale.length - 1))
    
    if (x >= 0 && y >= 0 && x < width && y < height) {
      grid[y][x] = colorScale[charIndex]
    }
  })

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}
      
      <Box flexDirection="column">
        {grid.map((row, y) => (
          <Box key={y}>
            <Text>{row.join('')}</Text>
          </Box>
        ))}
      </Box>
      
      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>Low</Text>
        <Text>{colorScale.join('')}</Text>
        <Text dimColor>High</Text>
      </Box>
    </Box>
  )
}

/**
 * Progress Bar Component
 * Simple progress bar with percentage display
 */
export interface ProgressBarProps {
  value: number
  max: number
  width?: number
  showPercentage?: boolean
  color?: string
  label?: string
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max,
  width = 30,
  showPercentage = true,
  color = 'green',
  label
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  const filledWidth = Math.round((percentage / 100) * width)
  const emptyWidth = width - filledWidth
  
  const filled = '█'.repeat(filledWidth)
  const empty = '░'.repeat(emptyWidth)
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text>{label}</Text>
        </Box>
      )}
      
      <Box flexDirection="row">
        <Text color={color}>{filled}</Text>
        <Text dimColor>{empty}</Text>
        {showPercentage && (
          <Box marginLeft={1}>
            <Text>{percentage.toFixed(1)}%</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * Gauge Component
 * Circular gauge using Unicode characters
 */
export interface GaugeProps {
  value: number
  max: number
  min?: number
  label?: string
  color?: string
  size?: 'small' | 'medium' | 'large'
}

export const Gauge: React.FC<GaugeProps> = ({
  value,
  max,
  min = 0,
  label,
  color = 'cyan',
  size = 'medium'
}) => {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  
  // Simple gauge representation
  const segments = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  const activeSegments = Math.floor((percentage / 100) * segments.length)
  
  const gaugeDisplay = segments.map((segment, index) => (
    <Text key={index} color={index < activeSegments ? color : 'gray'}>
      {segment}
    </Text>
  ))
  
  return (
    <Box flexDirection="column" alignItems="center">
      {label && (
        <Box marginBottom={1}>
          <Text bold>{label}</Text>
        </Box>
      )}
      
      <Box>
        {gaugeDisplay}
      </Box>
      
      <Box marginTop={1}>
        <Text>{value.toFixed(1)} / {max}</Text>
      </Box>
    </Box>
  )
}