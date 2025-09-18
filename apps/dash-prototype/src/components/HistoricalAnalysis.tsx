import React, { useState, useMemo } from 'react'
import { Box, Text } from 'ink'
import { Sparkline, BarChart, ChartDataPoint, SparklineDataPoint } from './charts/ChartRenderer'
import { TaskMasterHistoricalData } from '../services/taskmaster.service'

export interface HistoricalAnalysisProps {
  historicalData: TaskMasterHistoricalData[]
  compact?: boolean
  timeRange?: {
    start: Date
    end: Date
  }
}

export interface TrendAnalysis {
  direction: 'up' | 'down' | 'stable'
  magnitude: number
  description: string
}

/**
 * Historical Analysis Component
 * Analyzes and displays historical trends and patterns
 */
export const HistoricalAnalysis: React.FC<HistoricalAnalysisProps> = ({
  historicalData,
  compact = false,
  timeRange
}) => {
  const [selectedMetric, setSelectedMetric] = useState<'progress' | 'complexity' | 'velocity'>('progress')

  // Filter data by time range if provided
  const filteredData = useMemo(() => {
    if (!timeRange) return historicalData

    return historicalData.filter(point => {
      const pointDate = new Date(point.timestamp)
      return pointDate >= timeRange.start && pointDate <= timeRange.end
    })
  }, [historicalData, timeRange])

  // Calculate trends and insights
  const analysis = useMemo(() => {
    if (filteredData.length < 2) {
      return {
        progressTrend: { direction: 'stable' as const, magnitude: 0, description: 'Insufficient data' },
        complexityTrend: { direction: 'stable' as const, magnitude: 0, description: 'Insufficient data' },
        velocityTrend: { direction: 'stable' as const, magnitude: 0, description: 'Insufficient data' },
        insights: ['Need more historical data for trend analysis']
      }
    }

    // Progress trend analysis
    const progressData = filteredData.map(point => point.stats.progressPercentage)
    const progressTrend = calculateTrend(progressData)

    // Complexity trend analysis
    const complexityData = filteredData.map(point => 
      point.complexityReport?.averageComplexity || 0
    )
    const complexityTrend = calculateTrend(complexityData)

    // Velocity trend analysis (tasks completed per period)
    const velocityData = filteredData.map(point => point.stats.completedTasks)
    const velocityTrend = calculateTrend(velocityData)

    // Generate insights
    const insights = generateInsights(progressTrend, complexityTrend, velocityTrend, filteredData)

    return {
      progressTrend,
      complexityTrend,
      velocityTrend,
      insights
    }
  }, [filteredData])

  // Prepare chart data based on selected metric
  const chartData = useMemo(() => {
    const sparklineData: SparklineDataPoint[] = []
    const barData: ChartDataPoint[] = []

    switch (selectedMetric) {
      case 'progress':
        filteredData.forEach((point, index) => {
          sparklineData.push({
            value: point.stats.progressPercentage,
            timestamp: point.timestamp
          })
          
          if (index < 7) { // Last 7 data points for bar chart
            barData.push({
              label: `Day ${index + 1}`,
              value: point.stats.progressPercentage,
              color: point.stats.progressPercentage > 75 ? 'green' : 
                     point.stats.progressPercentage > 50 ? 'yellow' : 'red'
            })
          }
        })
        break

      case 'complexity':
        filteredData.forEach((point, index) => {
          const complexity = point.complexityReport?.averageComplexity || 0
          sparklineData.push({
            value: complexity,
            timestamp: point.timestamp
          })
          
          if (index < 7) {
            barData.push({
              label: `Day ${index + 1}`,
              value: complexity,
              color: complexity > 7 ? 'red' : complexity > 4 ? 'yellow' : 'green'
            })
          }
        })
        break

      case 'velocity':
        filteredData.forEach((point, index) => {
          sparklineData.push({
            value: point.stats.completedTasks,
            timestamp: point.timestamp
          })
          
          if (index < 7) {
            barData.push({
              label: `Day ${index + 1}`,
              value: point.stats.completedTasks,
              color: 'blue'
            })
          }
        })
        break
    }

    return { sparklineData, barData }
  }, [filteredData, selectedMetric])

  if (filteredData.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Historical Analysis</Text>
        <Text dimColor>No historical data available</Text>
      </Box>
    )
  }

  const currentTrend = analysis[`${selectedMetric}Trend` as keyof typeof analysis] as TrendAnalysis

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline>Historical Analysis</Text>
        <Text dimColor> ({filteredData.length} data points)</Text>
      </Box>

      {/* Metric Selection */}
      <Box marginBottom={1} flexDirection="row">
        <Text>Metric: </Text>
        <Text 
          color={selectedMetric === 'progress' ? 'green' : 'gray'}
          bold={selectedMetric === 'progress'}
        >
          Progress
        </Text>
        <Text> | </Text>
        <Text 
          color={selectedMetric === 'complexity' ? 'yellow' : 'gray'}
          bold={selectedMetric === 'complexity'}
        >
          Complexity
        </Text>
        <Text> | </Text>
        <Text 
          color={selectedMetric === 'velocity' ? 'cyan' : 'gray'}
          bold={selectedMetric === 'velocity'}
        >
          Velocity
        </Text>
      </Box>

      <Box flexDirection={compact ? "column" : "row"}>
        {/* Trend Sparkline */}
        <Box width={compact ? "100%" : "60%"} marginRight={compact ? 0 : 2}>
          <Sparkline
            data={chartData.sparklineData}
            title={`${selectedMetric.charAt(0).toUpperCase() + selectedMetric.slice(1)} Trend`}
            width={compact ? 30 : 50}
            showMinMax={!compact}
          />
          
          <Box marginTop={1}>
            <Text>
              Trend: <Text color={
                currentTrend.direction === 'up' ? 'green' : 
                currentTrend.direction === 'down' ? 'red' : 'gray'
              }>
                {currentTrend.direction.toUpperCase()}
              </Text>
              {' '}({currentTrend.magnitude.toFixed(1)}% change)
            </Text>
          </Box>
          
          <Box>
            <Text dimColor>{currentTrend.description}</Text>
          </Box>
        </Box>

        {/* Recent Values Bar Chart */}
        <Box width={compact ? "100%" : "40%"} marginTop={compact ? 1 : 0}>
          <BarChart
            data={chartData.barData.slice(-7)}
            title="Recent Values"
            maxWidth={compact ? 20 : 25}
            compact={compact}
            showValues={!compact}
          />
        </Box>
      </Box>

      {/* Trend Summary */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>All Trends:</Text>
        <Box marginLeft={2}>
          <Text>
            Progress: <Text color={
              analysis.progressTrend.direction === 'up' ? 'green' : 
              analysis.progressTrend.direction === 'down' ? 'red' : 'gray'
            }>
              {analysis.progressTrend.direction === 'up' ? '↗' : 
               analysis.progressTrend.direction === 'down' ? '↘' : '→'}
            </Text>
            {' '}{analysis.progressTrend.magnitude.toFixed(1)}%
          </Text>
        </Box>
        <Box marginLeft={2}>
          <Text>
            Complexity: <Text color={
              analysis.complexityTrend.direction === 'down' ? 'green' : 
              analysis.complexityTrend.direction === 'up' ? 'red' : 'gray'
            }>
              {analysis.complexityTrend.direction === 'up' ? '↗' : 
               analysis.complexityTrend.direction === 'down' ? '↘' : '→'}
            </Text>
            {' '}{analysis.complexityTrend.magnitude.toFixed(1)}%
          </Text>
        </Box>
        <Box marginLeft={2}>
          <Text>
            Velocity: <Text color={
              analysis.velocityTrend.direction === 'up' ? 'green' : 
              analysis.velocityTrend.direction === 'down' ? 'red' : 'gray'
            }>
              {analysis.velocityTrend.direction === 'up' ? '↗' : 
               analysis.velocityTrend.direction === 'down' ? '↘' : '→'}
            </Text>
            {' '}{analysis.velocityTrend.magnitude.toFixed(1)}%
          </Text>
        </Box>
      </Box>

      {/* Key Insights */}
      {!compact && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Key Insights:</Text>
          {analysis.insights.slice(0, 3).map((insight, index) => (
            <Box key={index} marginLeft={2}>
              <Text dimColor>• {insight}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Statistics */}
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor>
          Data Range: {filteredData.length} points
        </Text>
        <Text dimColor>
          From: {new Date(filteredData[0]?.timestamp).toLocaleDateString()}
        </Text>
        <Text dimColor>
          To: {new Date(filteredData[filteredData.length - 1]?.timestamp).toLocaleDateString()}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Calculate trend direction and magnitude
 */
function calculateTrend(values: number[]): TrendAnalysis {
  if (values.length < 2) {
    return { direction: 'stable', magnitude: 0, description: 'Insufficient data' }
  }

  // Simple linear regression to determine trend
  const n = values.length
  const xSum = (n * (n - 1)) / 2 // Sum of indices 0 to n-1
  const ySum = values.reduce((sum, val) => sum + val, 0)
  const xySum = values.reduce((sum, val, index) => sum + (index * val), 0)
  const xSquaredSum = values.reduce((sum, _, index) => sum + (index * index), 0)

  const slope = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum)
  const intercept = (ySum - slope * xSum) / n

  // Calculate percentage change from first to last predicted value
  const firstPredicted = intercept
  const lastPredicted = intercept + slope * (n - 1)
  const percentageChange = firstPredicted !== 0 ? ((lastPredicted - firstPredicted) / Math.abs(firstPredicted)) * 100 : 0

  let direction: 'up' | 'down' | 'stable'
  let description: string

  if (Math.abs(percentageChange) < 5) {
    direction = 'stable'
    description = 'Values remain relatively stable over time'
  } else if (percentageChange > 0) {
    direction = 'up'
    description = `Values showing ${percentageChange > 20 ? 'strong' : 'moderate'} upward trend`
  } else {
    direction = 'down'
    description = `Values showing ${percentageChange < -20 ? 'strong' : 'moderate'} downward trend`
  }

  return {
    direction,
    magnitude: Math.abs(percentageChange),
    description
  }
}

/**
 * Generate insights based on trend analysis
 */
function generateInsights(
  progressTrend: TrendAnalysis,
  complexityTrend: TrendAnalysis,
  velocityTrend: TrendAnalysis,
  data: TaskMasterHistoricalData[]
): string[] {
  const insights: string[] = []

  // Progress insights
  if (progressTrend.direction === 'up' && progressTrend.magnitude > 10) {
    insights.push('Strong progress acceleration detected - team momentum is building')
  } else if (progressTrend.direction === 'down' && progressTrend.magnitude > 5) {
    insights.push('Progress rate declining - investigate potential blockers')
  }

  // Complexity insights
  if (complexityTrend.direction === 'up' && complexityTrend.magnitude > 15) {
    insights.push('Task complexity increasing over time - consider process improvements')
  } else if (complexityTrend.direction === 'down' && complexityTrend.magnitude > 10) {
    insights.push('Task complexity decreasing - good sign of learning and optimization')
  }

  // Velocity insights
  if (velocityTrend.direction === 'up' && velocityTrend.magnitude > 20) {
    insights.push('Team velocity improving significantly - sustainable pace achieved')
  } else if (velocityTrend.direction === 'down' && velocityTrend.magnitude > 15) {
    insights.push('Team velocity declining - may indicate burnout or process issues')
  }

  // Combined insights
  if (progressTrend.direction === 'up' && velocityTrend.direction === 'up') {
    insights.push('Positive momentum: both progress and velocity trending upward')
  } else if (progressTrend.direction === 'down' && velocityTrend.direction === 'down') {
    insights.push('Concerning pattern: both progress and velocity declining')
  }

  // Data quality insights
  const avgDataPointsPerWeek = data.length / Math.max(1, Math.ceil((Date.now() - new Date(data[0]?.timestamp).getTime()) / (7 * 24 * 60 * 60 * 1000)))
  if (avgDataPointsPerWeek < 2) {
    insights.push('Limited data frequency - consider more frequent data collection for better insights')
  }

  return insights
}